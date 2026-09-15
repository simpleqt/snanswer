import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useSettingsStore } from '@/lib/store/settings'
import { useAppStore } from '@/lib/store/app'
import { useTranscriptionStore } from '@/lib/store/transcription'
import { useSolutionStore } from '@/lib/store/solution'
import { startAudioCapture, stopAudioCapture, getAudioCaptureOwner } from '@/lib/audio-capture'

import { AppHeader } from './AppHeader'
import { AppContent } from './AppContent'
import { AppStatusBar } from './AppStatusBar'
import { PrerequisitesChecker } from './PrerequisitesChecker'
import { TranscriptionBar } from './TranscriptionBar'
import { InterviewAssistantPanel } from './InterviewAssistantPanel'
import { TransparentBar } from './TransparentBar'

export default function CoderPage() {
  const { opacity, dashscopeApiKey, answerFontColor, transparentAnswerMode } = useSettingsStore()
  const { syncAppState } = useAppStore()
  const { isTranscribing, setIsTranscribing, setTranscriptionText, clearText } =
    useTranscriptionStore()
  const { setErrorMessage } = useSolutionStore()

  useEffect(() => {
    // Transparent answer mode always renders fully opaque: the window-level
    // opacity slider would otherwise make code blocks see-through too
    document.body.style.opacity = transparentAnswerMode ? '1' : opacity.toString()
    return () => {
      document.body.style.opacity = ''
    }
  }, [opacity, transparentAnswerMode])

  useEffect(() => {
    document.documentElement.style.setProperty('--answer-color', answerFontColor)
    document.body.classList.toggle('transparent-answer', transparentAnswerMode)
    return () => {
      document.body.classList.remove('transparent-answer')
    }
  }, [answerFontColor, transparentAnswerMode])

  useEffect(() => {
    window.api.updateAppState({ inCoderPage: true })
    return () => {
      window.api.updateAppState({ inCoderPage: false })
    }
  }, [])

  useEffect(() => {
    window.api.onSyncAppState((state) => {
      syncAppState(state)
    })
    return () => {
      window.api.removeSyncAppStateListener()
    }
  }, [syncAppState])

  useEffect(() => {
    const handleToggle = async () => {
      if (isTranscribing) {
        stopAudioCapture()
        await window.api.stopTranscription()
        setIsTranscribing(false)
      } else {
        if (!dashscopeApiKey) {
          setErrorMessage('请先在设置中配置百炼平台 API Key')
          return
        }
        try {
          const mode = await startAudioCapture('user')
          await window.api.startTranscription(dashscopeApiKey)
          setIsTranscribing(true)
          setErrorMessage(null)
          if (mode === 'microphone') {
            toast.info('macOS 不支持捕获系统声音，正在使用麦克风收音')
          }
        } catch (err) {
          console.error('Failed to start transcription:', err)
          stopAudioCapture()
          setErrorMessage('启动语音转录失败，请检查系统音频权限')
        }
      }
    }

    window.api.onToggleTranscription(handleToggle)
    return () => {
      window.api.removeToggleTranscriptionListener()
    }
  }, [isTranscribing, dashscopeApiKey, setIsTranscribing, setErrorMessage])

  useEffect(() => {
    window.api.onTranscriptionText((data) => {
      setTranscriptionText(data.text)
    })
    window.api.onTranscriptionError((message) => {
      setErrorMessage(message)
      setIsTranscribing(false)
      stopAudioCapture()
    })
    window.api.onTranscriptionStopped(() => {
      setIsTranscribing(false)
    })
    window.api.onTranscriptionCleared(() => {
      clearText()
    })

    return () => {
      window.api.removeTranscriptionTextListener()
      window.api.removeTranscriptionErrorListener()
      window.api.removeTranscriptionStoppedListener()
      window.api.removeTranscriptionClearedListener()
    }
  }, [setTranscriptionText, setErrorMessage, setIsTranscribing, clearText])

  useEffect(() => {
    return () => {
      if (useTranscriptionStore.getState().isTranscribing) {
        stopAudioCapture()
        window.api.stopTranscription()
      }
    }
  }, [])

  // Interview assistant audio lifecycle: the main process tells us when the
  // assistant turns on/off; we own the actual getDisplayMedia capture
  const handleAssistantAudio = useRef<(active: boolean) => void>(() => {})
  useEffect(() => {
    const handler = async (active: boolean) => {
      const transcription = useTranscriptionStore.getState()
      if (active) {
        if (transcription.isTranscribing) return
        if (!dashscopeApiKey) {
          setErrorMessage('实时助手需要先在设置中配置百炼平台 API Key')
          return
        }
        try {
          const mode = await startAudioCapture('assistant')
          await window.api.startTranscription(dashscopeApiKey)
          transcription.setIsTranscribing(true)
          if (mode === 'microphone') {
            toast.info('macOS 不支持捕获系统声音，实时助手正在使用麦克风收音')
          }
        } catch (err) {
          console.error('Failed to start interview assistant capture:', err)
          stopAudioCapture()
          setErrorMessage('启动实时助手失败，请检查系统音频权限')
        }
      } else if (getAudioCaptureOwner() === 'assistant') {
        // Only stop what the assistant started; a user-started manual
        // transcription (Alt+T) must survive the assistant being toggled off
        stopAudioCapture()
        await window.api.stopTranscription()
        useTranscriptionStore.getState().setIsTranscribing(false)
      }
    }
    handleAssistantAudio.current = handler
    window.api.onInterviewAssistantAudio(handler)
    return () => {
      handleAssistantAudio.current = () => {}
      window.api.removeInterviewAssistantAudioListener()
    }
  }, [dashscopeApiKey, setErrorMessage])

  // The main-process start/stop events fire when the switch is toggled — but
  // if that happens while this page is unmounted (e.g. toggled from the
  // settings page) nobody receives them. Catch up on mount in both
  // directions: start capture when enabled, stop the assistant-owned capture
  // that outlived a disable-while-unmounted.
  const interviewAssistantEnabled = useSettingsStore((s) => s.interviewAssistantEnabled)
  useEffect(() => {
    if (interviewAssistantEnabled) {
      handleAssistantAudio.current(true)
    } else if (
      useTranscriptionStore.getState().isTranscribing &&
      getAudioCaptureOwner() === 'assistant'
    ) {
      handleAssistantAudio.current(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative h-screen">
      {!transparentAnswerMode && <AppHeader />}
      {transparentAnswerMode && <TransparentBar />}
      <InterviewAssistantPanel />
      <AppContent />
      <TranscriptionBar />
      {!transparentAnswerMode && <AppStatusBar />}
      <PrerequisitesChecker />
    </div>
  )
}
