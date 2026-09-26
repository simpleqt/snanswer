import { useEffect, useRef, useState } from 'react'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { useSettingsStore } from '@/lib/store/settings'

interface QAItem {
  id: number
  question: string
  answer: string
  complete: boolean
}

/**
 * Real-time interview assistant timeline: live caption of what the
 * interviewer is saying, then detected questions with streaming answers.
 */
export function InterviewAssistantPanel() {
  const enabled = useSettingsStore((s) => s.interviewAssistantEnabled)
  const [items, setItems] = useState<QAItem[]>([])
  const [listeningText, setListeningText] = useState('')
  const [listeningMuted, setListeningMuted] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.onAssistantQuestion(({ id, question }) => {
      // A new question supersedes any in-flight answer
      setItems((prev) => [
        ...prev.filter((item) => item.complete),
        { id, question, answer: '', complete: false }
      ])
    })
    window.api.onAssistantAnswerChunk(({ id, chunk }) => {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, answer: i.answer + chunk } : i)))
    })
    window.api.onAssistantAnswerComplete(({ id }) => {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, complete: true } : i)))
    })
    window.api.onAssistantAnswerError(({ id, message }) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, complete: true, answer: i.answer || `生成失败：${message}` } : i
        )
      )
    })
    window.api.onAssistantListening(({ text, muted }) => {
      setListeningMuted(!!muted)
      setListeningText(muted ? '' : text)
    })
    return () => {
      window.api.removeAssistantQuestionListener()
      window.api.removeAssistantAnswerChunkListener()
      window.api.removeAssistantAnswerCompleteListener()
      window.api.removeAssistantAnswerErrorListener()
      window.api.removeAssistantListeningListener()
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setListeningText('')
      setListeningMuted(false)
    }
  }, [enabled])

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [items, listeningText])

  if (!enabled && items.length === 0) return null

  const visible = items.slice(-5)

  return (
    <div ref={scrollRef} className="max-h-72 overflow-y-auto bg-gray-800/20">
      <div className="px-6 py-3 space-y-3">
        {enabled && (
          <div className="flex items-center gap-1.5 text-xs text-gray-300/70 select-none min-h-4">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <span className="truncate">
              {listeningMuted
                ? '🎤 检测到你正在作答，暂停识别新问题…'
                : listeningText || '正在收听面试官说话…'}
            </span>
          </div>
        )}
        {visible.map((item) => (
          <div key={item.id} className="rounded-md border border-gray-500/40 bg-gray-700/30 p-3">
            <div className="mb-1.5 text-xs text-gray-300/70 break-words">🎙 {item.question}</div>
            {item.answer ? (
              <MarkdownRenderer>{item.answer}</MarkdownRenderer>
            ) : (
              !item.complete && (
                <div className="flex items-center gap-2 text-xs text-gray-400/70">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-500/60 border-t-gray-300 animate-spin" />
                  正在思考…
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
