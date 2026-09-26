import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppSettings } from '../main/settings'
import type { AppState } from '../main/state'
import type { MobileServerInfo } from '../main/mobile-types'

// Custom APIs for renderer
const api = {
  // Get app settings
  getAppSettings: () => ipcRenderer.invoke('getAppSettings'),
  // Update app settings
  updateAppSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('updateAppSettings', settings),
  // Fetch the model list from an OpenAI-compatible provider
  listModels: (params: { baseURL?: string; apiKey?: string }) =>
    ipcRenderer.invoke('list-models', params) as Promise<
      { success: true; models: string[] } | { success: false; error: string }
    >,

  // Update app state
  updateAppState: (state: Partial<AppState>) => ipcRenderer.invoke('updateAppState', state),
  // Listen for app state
  onSyncAppState: (callback: (state: AppState) => void) => {
    ipcRenderer.on('sync-app-state', (_event, state) => {
      callback(state)
    })
  },
  // Remove app state listener
  removeSyncAppStateListener: () => {
    ipcRenderer.removeAllListeners('sync-app-state')
  },

  // Init shortcuts
  initShortcuts: (shortcuts: Record<string, { action: string; key: string }>) =>
    ipcRenderer.invoke('initShortcuts', shortcuts),
  // Get shortcuts
  getShortcuts: () => ipcRenderer.invoke('getShortcuts'),
  // Update shortcuts
  updateShortcuts: (shortcuts: { action: string; key: string }[]) =>
    ipcRenderer.invoke('updateShortcuts', shortcuts),

  // Listen for prompt scene switch shortcut
  onSwitchPromptScene: (callback: () => void) => {
    ipcRenderer.on('switch-prompt-scene', callback)
  },
  removeSwitchPromptSceneListener: () => {
    ipcRenderer.removeAllListeners('switch-prompt-scene')
  },

  // Listen for provider profile switch shortcut
  onSwitchProviderProfile: (callback: () => void) => {
    ipcRenderer.on('switch-provider-profile', callback)
  },
  removeSwitchProviderProfileListener: () => {
    ipcRenderer.removeAllListeners('switch-provider-profile')
  },

  // Mirror helper toggles that may be changed from the phone
  onThinkingState: (callback: (data: { enabled: boolean }) => void) => {
    ipcRenderer.on('thinking-state', (_event, data) => callback(data))
  },
  removeThinkingStateListener: () => {
    ipcRenderer.removeAllListeners('thinking-state')
  },
  onClickCaptureState: (callback: (data: { mode: 'off' | 'single' | 'double' }) => void) => {
    ipcRenderer.on('double-click-state', (_event, data) => callback(data))
  },
  removeClickCaptureStateListener: () => {
    ipcRenderer.removeAllListeners('double-click-state')
  },

  // Auto-update (GitHub Releases)
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  checkForUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (
    callback: (data: {
      status: string
      currentVersion: string
      version?: string
      progress?: number
      message?: string
    }) => void
  ) => {
    ipcRenderer.on('update-status', (_event, data) => callback(data))
  },
  removeUpdateStatusListener: () => {
    ipcRenderer.removeAllListeners('update-status')
  },

  // Listen for screenshot events
  onScreenshotTaken: (callback: (screenshotData: string) => void) => {
    ipcRenderer.on('screenshot-taken', (_event, screenshotData) => {
      callback(screenshotData)
    })
  },
  // Remove screenshot listener
  removeScreenshotListener: () => {
    ipcRenderer.removeAllListeners('screenshot-taken')
  },

  // Listen for solution chunks
  onSolutionChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('solution-chunk', (_event, chunk) => {
      callback(chunk)
    })
  },
  // Remove solution chunk listener
  removeSolutionChunkListener: () => {
    ipcRenderer.removeAllListeners('solution-chunk')
  },

  // Stop solution stream
  stopSolutionStream: () => ipcRenderer.invoke('stopSolutionStream'),

  // Send follow-up question
  sendFollowUpQuestion: (question: string) => ipcRenderer.invoke('sendFollowUpQuestion', question),

  // Listen for solution completion
  onSolutionComplete: (callback: () => void) => {
    ipcRenderer.on('solution-complete', callback)
  },
  removeSolutionCompleteListener: () => {
    ipcRenderer.removeAllListeners('solution-complete')
  },

  onSolutionStopped: (callback: () => void) => {
    ipcRenderer.on('solution-stopped', callback)
  },
  removeSolutionStoppedListener: () => {
    ipcRenderer.removeAllListeners('solution-stopped')
  },

  onSolutionError: (callback: (message: string) => void) => {
    ipcRenderer.on('solution-error', (_event, message) => {
      callback(message)
    })
  },
  removeSolutionErrorListener: () => {
    ipcRenderer.removeAllListeners('solution-error')
  },

  // Listen for scroll page up
  onScrollPageUp: (callback: () => void) => {
    ipcRenderer.on('scroll-page-up', callback)
  },
  // Remove scroll page up listener
  removeScrollPageUpListener: () => {
    ipcRenderer.removeAllListeners('scroll-page-up')
  },

  // Listen for screenshots-updated (gallery)
  onScreenshotsUpdated: (callback: (screenshots: string[]) => void) => {
    ipcRenderer.on('screenshots-updated', (_event, screenshots) => {
      callback(screenshots)
    })
  },
  removeScreenshotsUpdatedListener: () => {
    ipcRenderer.removeAllListeners('screenshots-updated')
  },

  // Listen for scroll page down
  onScrollPageDown: (callback: () => void) => {
    ipcRenderer.on('scroll-page-down', callback)
  },
  // Remove scroll page down listener
  removeScrollPageDownListener: () => {
    ipcRenderer.removeAllListeners('scroll-page-down')
  },

  // AI loading events
  onAiLoadingStart: (callback: () => void) => {
    ipcRenderer.on('ai-loading-start', callback)
  },
  onAiLoadingEnd: (callback: () => void) => {
    ipcRenderer.on('ai-loading-end', callback)
  },
  removeAiLoadingStartListener: () => {
    ipcRenderer.removeAllListeners('ai-loading-start')
  },
  removeAiLoadingEndListener: () => {
    ipcRenderer.removeAllListeners('ai-loading-end')
  },

  // Solution clear event (new session)
  onSolutionClear: (callback: () => void) => {
    ipcRenderer.on('solution-clear', callback)
  },
  removeSolutionClearListener: () => {
    ipcRenderer.removeAllListeners('solution-clear')
  },

  // Select screenshot save directory
  selectScreenshotDir: () => ipcRenderer.invoke('selectScreenshotDir') as Promise<string | null>,

  // Transcription
  startTranscription: (apiKey: string) => ipcRenderer.invoke('start-transcription', apiKey),
  stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
  sendTranscriptionAudioChunk: (chunk: ArrayBuffer) =>
    ipcRenderer.send('transcription-audio-chunk', chunk),
  getTranscriptionText: () => ipcRenderer.invoke('get-transcription-text') as Promise<string>,

  onToggleTranscription: (callback: () => void) => {
    ipcRenderer.on('toggle-transcription', callback)
  },
  removeToggleTranscriptionListener: () => {
    ipcRenderer.removeAllListeners('toggle-transcription')
  },
  onTranscriptionText: (callback: (data: { text: string; isPartial: boolean }) => void) => {
    ipcRenderer.on('transcription-text', (_event, data) => callback(data))
  },
  removeTranscriptionTextListener: () => {
    ipcRenderer.removeAllListeners('transcription-text')
  },
  onTranscriptionError: (callback: (message: string) => void) => {
    ipcRenderer.on('transcription-error', (_event, message) => callback(message))
  },
  removeTranscriptionErrorListener: () => {
    ipcRenderer.removeAllListeners('transcription-error')
  },
  onTranscriptionStopped: (callback: () => void) => {
    ipcRenderer.on('transcription-stopped', callback)
  },
  removeTranscriptionStoppedListener: () => {
    ipcRenderer.removeAllListeners('transcription-stopped')
  },
  onTranscriptionCleared: (callback: () => void) => {
    ipcRenderer.on('transcription-cleared', callback)
  },
  removeTranscriptionClearedListener: () => {
    ipcRenderer.removeAllListeners('transcription-cleared')
  },

  // Mobile display (LAN phone mode)
  getMobileServerInfo: () => ipcRenderer.invoke('getMobileServerInfo') as Promise<MobileServerInfo>,
  onMobileServerStatus: (callback: (info: MobileServerInfo) => void) => {
    ipcRenderer.on('mobile-server-status', (_event, info) => callback(info))
  },
  removeMobileServerStatusListener: () => {
    ipcRenderer.removeAllListeners('mobile-server-status')
  },

  // Real-time interview assistant
  onInterviewAssistantAudio: (callback: (active: boolean) => void) => {
    ipcRenderer.on('interview-assistant-audio', (_event, active) => callback(active))
  },
  removeInterviewAssistantAudioListener: () => {
    ipcRenderer.removeAllListeners('interview-assistant-audio')
  },
  onAssistantQuestion: (callback: (data: { id: number; question: string }) => void) => {
    ipcRenderer.on('assistant-question', (_event, data) => callback(data))
  },
  removeAssistantQuestionListener: () => {
    ipcRenderer.removeAllListeners('assistant-question')
  },
  onAssistantAnswerChunk: (callback: (data: { id: number; chunk: string }) => void) => {
    ipcRenderer.on('assistant-answer-chunk', (_event, data) => callback(data))
  },
  removeAssistantAnswerChunkListener: () => {
    ipcRenderer.removeAllListeners('assistant-answer-chunk')
  },
  onAssistantAnswerComplete: (callback: (data: { id: number }) => void) => {
    ipcRenderer.on('assistant-answer-complete', (_event, data) => callback(data))
  },
  removeAssistantAnswerCompleteListener: () => {
    ipcRenderer.removeAllListeners('assistant-answer-complete')
  },
  onAssistantAnswerError: (callback: (data: { id: number; message: string }) => void) => {
    ipcRenderer.on('assistant-answer-error', (_event, data) => callback(data))
  },
  removeAssistantAnswerErrorListener: () => {
    ipcRenderer.removeAllListeners('assistant-answer-error')
  },
  onAssistantState: (callback: (data: { enabled: boolean }) => void) => {
    ipcRenderer.on('assistant-state', (_event, data) => callback(data))
  },
  removeAssistantStateListener: () => {
    ipcRenderer.removeAllListeners('assistant-state')
  },
  onAssistantListening: (
    callback: (data: {
      text: string
      partial?: boolean
      /** true while the detector is muted for the candidate's own answer */
      muted?: boolean
    }) => void
  ) => {
    ipcRenderer.on('assistant-listening', (_event, data) => callback(data))
  },
  removeAssistantListeningListener: () => {
    ipcRenderer.removeAllListeners('assistant-listening')
  }
}

export type MainAPI = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
