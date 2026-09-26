import type { ModelMessage } from 'ai'
import { systemPreferences } from 'electron'
import { getInterviewAnswerStream, compressInterviewHistory } from './ai'
import { settings, registerSettingsChangeHook } from './settings'
import { onTranscriptionSentence, onTranscriptionActive } from './transcription'
import { broadcastToMobile, setMobileInitExtra } from './mobile-server'
import type { InterviewQAItem } from './mobile-types'

/**
 * Real-time interview assistant: watches the live transcription, detects when
 * the interviewer finishes asking a question (silence + question markers),
 * then streams a suggested answer to the desktop overlay and phones without
 * any manual shortcut. New questions silently abort superseded answers.
 *
 * The audio feed hears both sides of the conversation. After each answer the
 * detector mutes itself for the time the candidate needs to read the answer
 * aloud, so the candidate's own speech can neither swallow the interviewer's
 * next question nor fire bogus triggers on itself; question-shaped sentences
 * still break through in case the interviewer interjects mid-answer.
 */

const ASSISTANT_PROMPT = `你是一位资深面试教练，实时为候选人提供应答支持。

你会收到面试官讲话的语音转录原文（可能包含口语噪声和识别错误）。你的任务：

1. 判断面试官意图：提问 / 追问 / 闲聊说明
2. 若是提问或追问，立即给出建议回答：
   - 第一行：一句话核心答案或结论
   - 随后 3~5 条精炼要点，控制在 30 秒内读完
   - 技术题给出关键思路，必要时附核心代码片段（用代码块）
3. 若是闲聊、说明或过渡语，给一两句得体的应答建议即可
4. 转录有明显识别错误时，先自行纠正理解再回答，不要指出错误
5. 结合此前的对话摘要（如有）保持上下文连贯，不要重复已给过的内容

输出 Markdown，直接作答，不要复述问题，不要任何前言后语。`

// --- Detection tuning ---
const CHECK_INTERVAL_MS = 400
const SILENCE_TRIGGER_MS = 1500 // utterance considered complete after this idle
const QUESTION_SILENCE_TRIGGER_MS = 1200 // faster trigger after a question marker
const NO_QUESTION_COOLDOWN_MS = 8000 // without a question marker, require this gap
const MIN_TEXT_LENGTH = 6
const PENDING_CAP = 200 // keep only the tail of very long monologues
const FILLER_RE =
  /^(好的|好嘞|嗯+|哦+|噢+|额+|呃+|对|是的|没错|没问题|可以|行|ok|okay|嗯嗯|收到|明白|了解|谢谢|感谢|辛苦了|不好意思)[。.，,！!？?~\s]*$/i

// --- Candidate-answer suppression ---
// The mic hears BOTH sides: after we stream an answer the candidate reads it
// aloud, and their own spoken answer used to flood the question buffer —
// swallowing the interviewer's next question and later firing a bogus
// incoherent trigger on the candidate's words. Suppress listening for the
// estimated read-aloud time; sentences that still look like questions pass
// through (the interviewer may interject a follow-up at any moment).
const ANSWER_READ_CHARS_PER_SEC = 4.5 // Mandarin read-aloud pace
const SUPPRESS_MIN_MS = 4000
const SUPPRESS_MAX_MS = 90000

// Interviewers often ask without any 吗/？ ending ("介绍一下你的项目",
// "讲讲缓存一致性"). These sentence-opening stems count as questions too.
const QUESTION_STEM_RE =
  /^(?:先|请|麻烦|那|那么|然后|接下来|具体|再|顺便)?(?:你|您)?(?:介绍(?:一|几)?下|讲(?:一)?下|讲讲|说(?:一)?下|说说|谈谈|聊聊|描述(?:一)?下|解释(?:一)?下|对比(?:一)?下|分析(?:一)?下|举例(?:子|说明)?|分享(?:一)?下|评价(?:一)?下|怎么|如何|为什么|是什么|什么是|有哪些|哪个|哪种|有没有|是否|能不能|会不会|可不可以|多少)/

// While suppressed, an interrogative ANYWHERE in the sentence is enough to
// break through ("你说说……是怎么保证的。") — follow-ups during the
// candidate's read-aloud must not be swallowed by the mute window
const INTERROGATIVE_RE =
  /[？?吗呢嘛]|怎么|如何|为什么|怎么样|怎么办|哪些|哪种|哪个|多少|有没有|能不能|会不会|可不可以|是否/

// --- State ---
type PendingSentence = { text: string; questionish: boolean }
let detectorTimer: NodeJS.Timeout | null = null
let pending: PendingSentence[] = []
let pendingChars = 0
let lastSpeechTime = 0
let lastTriggerTime = 0
let suppressUntil = 0

let qaItems: InterviewQAItem[] = []
let nextQaId = 1
let historySummary = ''
let isCompressing = false
let streamContext: { controller: AbortController; id: number } | null = null

function sendToRenderer(channel: string, ...args: unknown[]) {
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function emit(event: string, payload?: unknown) {
  sendToRenderer(event, payload)
  broadcastToMobile(event, payload)
}

// --- Question detection ---

function stripNoise(text: string): string {
  return text.replace(/[\s。，,.、；;！!？?~…"'"「」]/g, '')
}

/** A single finalized sentence counts as a question via ending marker or stem */
function sentenceIsQuestionish(text: string): boolean {
  const trimmed = text.trim()
  if (/[？?]\s*[。.]?\s*$/.test(trimmed)) return true
  if (/[吗呢嘛]\s*[。.，,！!？?]?\s*$/.test(trimmed)) return true
  return QUESTION_STEM_RE.test(trimmed)
}

/**
 * Suppress-window breakthrough: looser than normal classification because a
 * follow-up swallowed here would be lost entirely (regular speech resumes
 * only after the window expires with a clean buffer).
 */
function breaksSuppression(text: string): boolean {
  return sentenceIsQuestionish(text) || INTERROGATIVE_RE.test(text)
}

function pendingText(): string {
  return pending.map((s) => s.text).join('')
}

function clearPending(): void {
  pending = []
  pendingChars = 0
}

function pushPending(text: string, questionish: boolean): void {
  pending.push({ text, questionish })
  pendingChars += text.length
  while (pendingChars > PENDING_CAP && pending.length > 1) {
    pendingChars -= pending[0].text.length
    pending.shift()
  }
}

function isSuppressing(): boolean {
  return suppressUntil > Date.now()
}

function startSuppression(answer: string): void {
  const readMs = (answer.length / ANSWER_READ_CHARS_PER_SEC) * 1000
  suppressUntil = Date.now() + Math.min(Math.max(readMs, SUPPRESS_MIN_MS), SUPPRESS_MAX_MS)
}

function handleSentence(text: string, sentenceEnd: boolean) {
  if (!settings.interviewAssistantEnabled || !text) return
  lastSpeechTime = Date.now()
  if (!sentenceEnd) {
    // Partials stream live so both ends show what is being heard right now
    emit('assistant-listening', {
      text: (pendingText() + text).slice(-PENDING_CAP),
      partial: true,
      muted: isSuppressing()
    })
    return
  }

  const trimmed = text.trim()
  if (!trimmed) return

  if (isSuppressing()) {
    if (!breaksSuppression(trimmed)) {
      // Presumed the candidate reading our answer aloud: swallow it so it
      // cannot pollute the question buffer, and tell the UI why it's quiet
      emit('assistant-listening', { text: '', muted: true })
      return
    }
    // Looks like the interviewer interjecting a follow-up mid-answer
    clearPending()
  }

  const stripped = stripNoise(trimmed)
  // Standalone fillers ("嗯", "好的") must not be appended after a real
  // question — they used to destroy the questionish ending and push the
  // buffer into the slow cooldown path
  if (stripped.length < 2 || FILLER_RE.test(stripped)) return

  pushPending(trimmed, sentenceIsQuestionish(trimmed) || isSuppressing())
  emit('assistant-listening', { text: pendingText().slice(-PENDING_CAP) })
}

function maybeTrigger() {
  if (!settings.interviewAssistantEnabled || pending.length === 0) return

  const questionish = pending[pending.length - 1].questionish
  const idleFor = Date.now() - lastSpeechTime
  const threshold = questionish ? QUESTION_SILENCE_TRIGGER_MS : SILENCE_TRIGGER_MS
  if (idleFor < threshold) return

  const candidate = pendingText()
  const stripped = stripNoise(candidate)
  if (stripped.length < MIN_TEXT_LENGTH || FILLER_RE.test(stripped)) {
    clearPending() // small talk / noise: drop and keep listening
    return
  }
  if (!questionish && Date.now() - lastTriggerTime < NO_QUESTION_COOLDOWN_MS) {
    return // likely a mid-explanation pause: keep accumulating
  }

  clearPending()
  lastTriggerTime = Date.now()
  emit('assistant-listening', { text: '' }) // clear the live caption bar
  void triggerAnswer(candidate)
}

// --- Answer generation ---

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || '生成失败'
  return String(error) || '生成失败'
}

function buildMessages(question: string): ModelMessage[] {
  const systemParts = [ASSISTANT_PROMPT]
  if (historySummary) {
    systemParts.push(`此前面试上下文摘要：\n${historySummary}`)
  }
  const messages: ModelMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }]
  // Recent completed pairs for continuity (current item is the last one)
  for (const item of qaItems.slice(-4, -1)) {
    if (!item.complete || !item.answer) continue
    messages.push({ role: 'user', content: `面试官：${item.question}` })
    messages.push({ role: 'assistant', content: item.answer })
  }
  messages.push({ role: 'user', content: `面试官：${question}` })
  return messages
}

async function triggerAnswer(question: string) {
  // Interview pace is fast: supersede any in-flight answer silently
  if (streamContext) {
    streamContext.controller.abort()
    streamContext = null
  }

  const id = nextQaId++
  const item: InterviewQAItem = { id, question, answer: '', complete: false }
  qaItems.push(item)
  if (qaItems.length > 50) {
    qaItems = qaItems.slice(-50)
  }
  emit('assistant-question', { id, question })

  const controller = new AbortController()
  streamContext = { controller, id }
  let answer = ''

  try {
    const stream = getInterviewAnswerStream(buildMessages(question), controller.signal)
    for await (const chunk of stream) {
      if (controller.signal.aborted) break
      answer += chunk
      emit('assistant-answer-chunk', { id, chunk })
    }
    if (!controller.signal.aborted) {
      item.answer = answer
      item.complete = true
      // The candidate will now read this answer aloud; mute the detector
      // for the estimated speaking time so their own voice is ignored
      startSuppression(answer)
      emit('assistant-answer-complete', { id })
      scheduleCompression()
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      item.complete = true
      console.error('Interview assistant stream error:', error)
      emit('assistant-answer-error', { id, message: extractErrorMessage(error) })
    }
  } finally {
    if (streamContext?.controller === controller) {
      streamContext = null
    }
  }
}

// --- Async history compression (never blocks answer generation) ---

function scheduleCompression() {
  if (isCompressing) return
  const completed = qaItems.filter((item) => item.complete && item.answer)
  if (completed.length < 6) return

  isCompressing = true
  // Keep the 3 most recent pairs verbatim, compress the older ones
  const older = completed.slice(0, completed.length - 3)
  compressInterviewHistory(older, historySummary)
    .then((summary) => {
      if (summary) {
        historySummary = summary
        qaItems = qaItems.filter((item) => !older.includes(item))
      }
    })
    .catch((error) => {
      console.error('Interview history compression failed:', error)
    })
    .finally(() => {
      isCompressing = false
    })
}

// --- Lifecycle ---

function detectorTick() {
  if (suppressUntil && Date.now() >= suppressUntil) {
    suppressUntil = 0
    if (settings.interviewAssistantEnabled) {
      emit('assistant-listening', { text: '' }) // unmute the caption bar
    }
  }
  maybeTrigger()
}

function startDetector() {
  if (detectorTimer) return
  lastSpeechTime = Date.now()
  detectorTimer = setInterval(detectorTick, CHECK_INTERVAL_MS)
}

function stopDetector() {
  if (detectorTimer) {
    clearInterval(detectorTimer)
    detectorTimer = null
  }
}

function applyAssistantState() {
  const enabled = settings.interviewAssistantEnabled
  clearPending()
  suppressUntil = 0
  stopDetector()
  if (streamContext) {
    streamContext.controller.abort()
    streamContext = null
  }
  if (enabled) {
    startDetector()
    if (process.platform === 'darwin') {
      // Force the macOS TCC microphone prompt up front; without an explicit
      // request the app never appears in System Settings → Microphone and
      // getUserMedia fails silently for the user
      try {
        const granted = systemPreferences.askForMediaAccess('microphone')
        if (granted instanceof Promise) {
          granted.then((ok) => console.log('[assistant] mic access:', ok)).catch(() => {})
        } else {
          console.log('[assistant] mic access:', granted)
        }
      } catch (error) {
        console.error('[assistant] mic access check failed:', error)
      }
    }
  }
  // Renderer owns audio capture (getDisplayMedia); it starts/stops accordingly
  sendToRenderer('interview-assistant-audio', enabled)
  broadcastToMobile('assistant-state', { enabled })
  console.log('[assistant] state:', enabled ? 'enabled' : 'disabled')
}

export function toggleInterviewAssistant(): void {
  setInterviewAssistantEnabled(!settings.interviewAssistantEnabled)
}

export function setInterviewAssistantEnabled(enabled: boolean): void {
  if (settings.interviewAssistantEnabled === enabled) return
  settings.interviewAssistantEnabled = enabled
  applyAssistantState()
}

registerSettingsChangeHook((changed) => {
  if ('interviewAssistantEnabled' in changed) {
    applyAssistantState()
  }
})

// Feeds the phone init snapshot so mid-session connects restore the timeline
setMobileInitExtra(() => ({
  assistant: {
    enabled: settings.interviewAssistantEnabled,
    items: qaItems.slice(-10)
  }
}))

onTranscriptionSentence(handleSentence)

// Paused listening (transcription stopped/failed): drop the pending fragment
onTranscriptionActive((active) => {
  if (!active && settings.interviewAssistantEnabled) {
    clearPending()
  }
})
