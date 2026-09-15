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

// --- State ---
let detectorTimer: NodeJS.Timeout | null = null
let pendingText = ''
let lastSpeechTime = 0
let lastTriggerTime = 0

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

function isQuestionish(text: string): boolean {
  return /[？?]\s*[。.]?\s*$/.test(text) || /[吗呢]\s*[。.？?，,]?\s*$/.test(text)
}

function handleSentence(text: string, sentenceEnd: boolean) {
  if (!settings.interviewAssistantEnabled || !text) return
  lastSpeechTime = Date.now()
  if (sentenceEnd) {
    pendingText = (pendingText + text).slice(-PENDING_CAP)
    emit('assistant-listening', { text: pendingText })
  } else {
    // Partials stream live so both ends show what is being heard right now
    emit('assistant-listening', {
      text: (pendingText + text).slice(-PENDING_CAP),
      partial: true
    })
  }
}

function maybeTrigger() {
  if (!settings.interviewAssistantEnabled || !pendingText) return

  const candidate = pendingText.trim()
  if (!candidate) {
    pendingText = ''
    return
  }

  const questionish = isQuestionish(candidate)
  const idleFor = Date.now() - lastSpeechTime
  const threshold = questionish ? QUESTION_SILENCE_TRIGGER_MS : SILENCE_TRIGGER_MS
  if (idleFor < threshold) return

  const stripped = stripNoise(candidate)
  if (stripped.length < MIN_TEXT_LENGTH || FILLER_RE.test(stripped)) {
    pendingText = '' // small talk / noise: drop and keep listening
    return
  }
  if (!questionish && Date.now() - lastTriggerTime < NO_QUESTION_COOLDOWN_MS) {
    return // likely a mid-explanation pause: keep accumulating
  }

  pendingText = ''
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

function startDetector() {
  if (detectorTimer) return
  lastSpeechTime = Date.now()
  detectorTimer = setInterval(maybeTrigger, CHECK_INTERVAL_MS)
}

function stopDetector() {
  if (detectorTimer) {
    clearInterval(detectorTimer)
    detectorTimer = null
  }
}

function applyAssistantState() {
  const enabled = settings.interviewAssistantEnabled
  pendingText = ''
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
    pendingText = ''
  }
})
