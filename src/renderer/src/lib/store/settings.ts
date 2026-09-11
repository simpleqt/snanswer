import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import codingPrompt from './prompts/coding.md?raw'
import englishExamPrompt from './prompts/english-exam.md?raw'
import generalQaPrompt from './prompts/general-qa.md?raw'
import personalityTestPrompt from './prompts/personality-test.md?raw'
import reasoningTestPrompt from './prompts/reasoning-test.md?raw'

export interface PromptScene {
  id: string
  name: string
  prompt: string
  isPreset: boolean
}

export const CODING_SCENE_ID = 'coding'

/** Default prompts for all preset scenes, maintained as Markdown files under ./prompts */
export const PRESET_SCENE_PROMPTS: Record<string, string> = {
  [CODING_SCENE_ID]: codingPrompt,
  'english-exam': englishExamPrompt,
  'general-qa': generalQaPrompt,
  'personality-test': personalityTestPrompt,
  'reasoning-test': reasoningTestPrompt
}

const createPresetScenes = (): PromptScene[] => [
  {
    id: CODING_SCENE_ID,
    name: '解算法题',
    prompt: PRESET_SCENE_PROMPTS[CODING_SCENE_ID],
    isPreset: true
  },
  {
    id: 'english-exam',
    name: '英语考试',
    prompt: PRESET_SCENE_PROMPTS['english-exam'],
    isPreset: true
  },
  {
    id: 'general-qa',
    name: '通用问答',
    prompt: PRESET_SCENE_PROMPTS['general-qa'],
    isPreset: true
  },
  {
    id: 'personality-test',
    name: '性格测评',
    prompt: PRESET_SCENE_PROMPTS['personality-test'],
    isPreset: true
  },
  {
    id: 'reasoning-test',
    name: '逻辑/数字题',
    prompt: PRESET_SCENE_PROMPTS['reasoning-test'],
    isPreset: true
  }
]

/** Derive the `customPrompt` (the system prompt used by the main process) from the active scene */
function composeCustomPrompt(scenes: PromptScene[], activeSceneId: string): string {
  const scene = scenes.find((s) => s.id === activeSceneId)
  if (!scene) return PRESET_SCENE_PROMPTS[CODING_SCENE_ID]
  // An emptied preset scene falls back to its default prompt
  return scene.prompt.trim() || PRESET_SCENE_PROMPTS[scene.id] || ''
}

interface Settings {
  // theme: 'light' | 'dark'an
  apiBaseURL: string
  apiKey: string
  model: string
  customModels: string[]
  customPrompt: string

  scenes: PromptScene[]
  activeSceneId: string

  opacity: number

  /** Answer text color on the coder overlay */
  answerFontColor: string
  /** Fully transparent overlay background: only the answer text floats */
  transparentAnswerMode: boolean

  screenshotAutoSave: boolean
  screenshotDir: string

  dashscopeApiKey: string

  hideDockIcon: boolean

  audioInputDeviceId: string
  audioOutputDeviceId: string

  /** LAN mobile display mode: stream solutions to a phone browser */
  mobileDisplayEnabled: boolean
  mobileServerPort: number
  mobilePairingToken: string

  /** Real-time interview assistant (auto-answer from live transcription) */
  interviewAssistantEnabled: boolean

  /** Global left-button click capture mode: off / double / single */
  clickCaptureMode: 'off' | 'single' | 'double'

  /** Deep-thinking flag (synced to main, read by ai.ts at request time) */
  enableThinking: boolean

  /** Thinking intensity when enabled; mapped per provider */
  thinkingEffort: 'low' | 'medium' | 'high'

  /** Saved provider profiles for one-key switching (URL/Key/model/thinking) */
  providerProfiles: ProviderProfile[]
  activeProviderId: string

  /** Auto-update from GitHub Releases */
  autoUpdateEnabled: boolean
}

export interface ProviderProfile {
  id: string
  name: string
  apiBaseURL: string
  apiKey: string
  model: string
  enableThinking: boolean
  thinkingEffort: 'low' | 'medium' | 'high'
}

function providerNameFromURL(url: string): string {
  if (url.includes('deepseek.com')) return 'DeepSeek'
  if (url.includes('siliconflow')) return '硅基流动'
  if (url.includes('aliyuncs.com') || url.includes('dashscope')) return '阿里百炼'
  if (url.includes('bigmodel')) return '智谱 GLM'
  if (url.includes('moonshot')) return 'Kimi'
  if (url.includes('openrouter')) return 'OpenRouter'
  if (url.includes('openai.com')) return 'OpenAI'
  try {
    return new URL(url).hostname
  } catch {
    return '自定义'
  }
}

interface SettingsStore extends Settings {
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  syncSettings: (settings: Partial<Settings>) => void
  setActiveScene: (id: string) => void
  cycleActiveScene: () => void
  updateScenePrompt: (id: string, prompt: string) => void
  addScene: (name: string) => string
  removeScene: (id: string) => void
  applyProviderProfile: (id: string) => ProviderProfile | undefined
  saveProviderProfile: (asNew?: boolean) => ProviderProfile
  deleteProviderProfile: (id: string) => void
  cycleProviderProfile: () => ProviderProfile | null
}

const defaultSettings: Settings = {
  apiBaseURL: '',
  apiKey: '',
  model: '',
  customModels: [],
  customPrompt: PRESET_SCENE_PROMPTS[CODING_SCENE_ID],
  scenes: createPresetScenes(),
  activeSceneId: CODING_SCENE_ID,

  opacity: 0.8,

  answerFontColor: '#f8fafc',
  transparentAnswerMode: false,

  screenshotAutoSave: true,
  screenshotDir: '',

  dashscopeApiKey: '',

  hideDockIcon: true,

  audioInputDeviceId: '',
  audioOutputDeviceId: '',

  mobileDisplayEnabled: false,
  mobileServerPort: 3170,
  mobilePairingToken: '',

  interviewAssistantEnabled: false,

  clickCaptureMode: 'off',

  enableThinking: false,

  thinkingEffort: 'medium',

  providerProfiles: [],
  activeProviderId: '',

  autoUpdateEnabled: true
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      updateSetting: (key, value) => {
        set({ [key]: value })
      },
      syncSettings: (settings) => {
        set(settings)
      },
      setActiveScene: (id) => {
        set((state) => ({
          activeSceneId: id,
          customPrompt: composeCustomPrompt(state.scenes, id)
        }))
      },
      cycleActiveScene: () => {
        set((state) => {
          const scenes = state.scenes
          if (scenes.length === 0) return state
          const currentIndex = scenes.findIndex((s) => s.id === state.activeSceneId)
          const nextScene = scenes[(currentIndex + 1) % scenes.length]
          return {
            activeSceneId: nextScene.id,
            customPrompt: composeCustomPrompt(scenes, nextScene.id)
          }
        })
      },
      updateScenePrompt: (id, prompt) => {
        set((state) => {
          const scenes = state.scenes.map((s) => (s.id === id ? { ...s, prompt } : s))
          return {
            scenes,
            customPrompt: composeCustomPrompt(scenes, state.activeSceneId)
          }
        })
      },
      addScene: (name) => {
        const id = `custom-${Date.now()}`
        set((state) => {
          const scenes = [...state.scenes, { id, name, prompt: '', isPreset: false }]
          return {
            scenes,
            activeSceneId: id,
            customPrompt: composeCustomPrompt(scenes, id)
          }
        })
        return id
      },
      removeScene: (id) => {
        const scene = get().scenes.find((s) => s.id === id)
        if (!scene || scene.isPreset) return
        set((state) => {
          const scenes = state.scenes.filter((s) => s.id !== id)
          const activeSceneId = state.activeSceneId === id ? CODING_SCENE_ID : state.activeSceneId
          return {
            scenes,
            activeSceneId,
            customPrompt: composeCustomPrompt(scenes, activeSceneId)
          }
        })
      },
      applyProviderProfile: (id) => {
        const profile = get().providerProfiles.find((p) => p.id === id)
        if (!profile) return undefined
        set({
          activeProviderId: id,
          apiBaseURL: profile.apiBaseURL,
          apiKey: profile.apiKey,
          model: profile.model,
          enableThinking: profile.enableThinking,
          thinkingEffort: profile.thinkingEffort ?? 'medium'
        })
        return profile
      },
      saveProviderProfile: (asNew = false) => {
        const s = get()
        const existing = !asNew ? s.providerProfiles.find((p) => p.id === s.activeProviderId) : null
        const profile: ProviderProfile = {
          id: existing?.id ?? `provider-${Date.now()}`,
          name: existing?.name ?? providerNameFromURL(s.apiBaseURL),
          apiBaseURL: s.apiBaseURL,
          apiKey: s.apiKey,
          model: s.model,
          enableThinking: s.enableThinking,
          thinkingEffort: s.thinkingEffort
        }
        set((state) => ({
          providerProfiles: existing
            ? state.providerProfiles.map((p) => (p.id === existing.id ? profile : p))
            : [...state.providerProfiles, profile],
          activeProviderId: profile.id
        }))
        return profile
      },
      deleteProviderProfile: (id) => {
        set((state) => ({
          providerProfiles: state.providerProfiles.filter((p) => p.id !== id),
          activeProviderId: state.activeProviderId === id ? '' : state.activeProviderId
        }))
      },
      cycleProviderProfile: () => {
        const profiles = get().providerProfiles
        if (profiles.length === 0) return null
        const index = profiles.findIndex((p) => p.id === get().activeProviderId)
        const next = profiles[(index + 1) % profiles.length]
        return get().applyProviderProfile(next.id) ?? null
      }
    }),
    {
      name: 'interview-coder-settings',
      version: 9,
      migrate: (persisted, version) => {
        const state = persisted as Partial<Settings>
        // Drop the legacy codeLanguage field (language now lives in the prompt text)
        delete (state as Record<string, unknown>).codeLanguage
        if (version < 9) {
          // Screenshot auto-save becomes the default; flip existing installs on
          state.screenshotAutoSave = true
        }
        if (version < 8) {
          // Refresh the coding scene prompt with the new template for existing users
          state.scenes = (state.scenes ?? []).map((s) =>
            s.id === CODING_SCENE_ID ? { ...s, prompt: PRESET_SCENE_PROMPTS[CODING_SCENE_ID] } : s
          )
        }
        if (version < 5) {
          // Convert the legacy free-form customPrompt into a custom scene
          const scenes = createPresetScenes()
          let activeSceneId = CODING_SCENE_ID
          const legacyPrompt = (state.customPrompt ?? '').trim()
          if (legacyPrompt) {
            const id = `custom-${Date.now()}`
            scenes.push({ id, name: '自定义场景', prompt: legacyPrompt, isPreset: false })
            activeSceneId = id
          }
          return { ...state, scenes, activeSceneId }
        }
        return state
      },
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<Settings>) }
        // Ensure preset scenes always exist (keep user-edited prompts),
        // so presets added in future versions show up for existing users
        const persistedScenes = Array.isArray(state.scenes) ? state.scenes : []
        state.scenes = [
          ...createPresetScenes().map((p) => {
            const saved = persistedScenes.find((s) => s.id === p.id)
            // Restore the default prompt if a preset scene was left empty
            return saved?.prompt.trim() ? saved : p
          }),
          ...persistedScenes.filter((s) => !s.isPreset)
        ]
        if (!state.scenes.some((s) => s.id === state.activeSceneId)) {
          state.activeSceneId = CODING_SCENE_ID
        }
        state.customPrompt = composeCustomPrompt(state.scenes, state.activeSceneId)
        return state
      }
    }
  )
)
