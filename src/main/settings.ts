import { app, dialog, ipcMain } from 'electron'

// NOTE: this module is pulled into the web (renderer) TypeScript program via
// preload/index.ts, so it must not import node-only modules (mobile-server
// etc.). Features that react to settings changes register a hook instead.
type SettingsChangeHook = (changed: Record<string, unknown>) => void
const settingsChangeHooks: SettingsChangeHook[] = []

/** Register a hook fired after settings are updated via the updateAppSettings IPC. */
export function registerSettingsChangeHook(hook: SettingsChangeHook): void {
  settingsChangeHooks.push(hook)
}

/** Fire registered hooks; also used by in-process toggles (phone commands etc.). */
export function notifySettingsChange(changed: Record<string, unknown>): void {
  settingsChangeHooks.forEach((hook) => hook(changed))
}

ipcMain.handle('getAppSettings', () => {
  return settings
})

ipcMain.handle('updateAppSettings', (_event, _settings) => {
  Object.assign(settings, _settings)
  if ('hideDockIcon' in _settings) {
    applyDockVisibility(settings.hideDockIcon)
  }
  settingsChangeHooks.forEach((hook) => hook(_settings))
})

/** Show/hide the macOS dock icon. No-op on other platforms. */
export function applyDockVisibility(hidden: boolean): void {
  if (process.platform !== 'darwin') return
  if (hidden) {
    app.dock?.hide()
  } else {
    app.dock?.show()
  }
}

ipcMain.handle('selectScreenshotDir', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: '选择截图保存目录'
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
})

export const settings = {
  apiBaseURL: process.env.API_BASE_URL || '',
  apiKey: process.env.API_KEY || '',
  model: process.env.MODEL || '',
  customPrompt: '',
  screenshotAutoSave: true,
  screenshotDir: '',
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  hideDockIcon: true,
  audioInputDeviceId: '',
  audioOutputDeviceId: '',
  mobileDisplayEnabled: false,
  mobileServerPort: 3170,
  mobilePairingToken: '',
  /** Session-level thinking toggle (phone 「深度思考」), read by ai.ts at request time */
  enableThinking: false,
  /** Thinking intensity when enabled; mapped per provider in ai.ts */
  thinkingEffort: 'medium' as ThinkingEffort,
  /** Real-time interview assistant: auto-answer detected interviewer questions */
  interviewAssistantEnabled: false,
  /** Global left-button click capture mode */
  clickCaptureMode: 'off' as ClickCaptureMode,
  /** Auto-update from GitHub Releases (Windows; silent install on quit) */
  autoUpdateEnabled: true
}

export type AppSettings = typeof settings

export type ClickCaptureMode = 'off' | 'single' | 'double'

export type ThinkingEffort = 'low' | 'medium' | 'high'
