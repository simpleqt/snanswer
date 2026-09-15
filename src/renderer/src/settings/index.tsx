import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowLeft,
  SquareTerminal,
  Palette,
  Shield,
  Bot,
  Eye,
  EyeOff,
  Keyboard,
  FolderOpen,
  Mic,
  Plus,
  RotateCcw,
  Smartphone,
  MousePointerClick,
  RefreshCw,
  X
} from 'lucide-react'
import QRCode from 'react-qr-code'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useSettingsStore, PRESET_SCENE_PROMPTS } from '@/lib/store/settings'
import { isMac } from '@/lib/utils/env'
import { SelectModel } from './SelectModel'
import { CustomShortcuts, ResetDefaultShortcuts } from './CustomShortcuts'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

/** Derived from the preload API so renderer stays in sync with main automatically */
type MobileServerInfo = Awaited<ReturnType<typeof window.api.getMobileServerInfo>>

/** Built-in OpenAI-compatible provider presets (model = recommended vision model) */
interface ProviderPreset {
  id: string
  name: string
  url: string
  model: string
  note: string
  /** Recommended thinking defaults applied when the preset is selected */
  thinking: { enabled: boolean; effort?: 'low' | 'medium' | 'high' }
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    note: 'deepseek-flash（视觉+思考，旧名 deepseek-v4-flash-vision-exp 仍兼容）',
    // DeepSeek thinks by DEFAULT at high effort (long silent reasoning_content);
    // selecting the preset turns it off for snappy answers — enable + 强度 on demand
    thinking: { enabled: false }
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    url: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-VL-32B-Instruct',
    note: '国内平台，支持支付宝付款',
    thinking: { enabled: false }
  },
  {
    id: 'dashscope',
    name: '阿里百炼',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max',
    note: '通义系列，语音转录也用此平台 Key',
    thinking: { enabled: false }
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    url: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5v',
    note: 'GLM-4.5V 视觉模型，支持 thinking 开关',
    thinking: { enabled: false }
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    url: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    note: 'Kimi K3 旗舰（视觉 + 1M 上下文）',
    thinking: { enabled: false }
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    model: 'gpt-5-mini',
    note: '海外聚合平台，思考强度走 reasoning.effort',
    thinking: { enabled: false }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    url: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
    note: '官方 API，思考强度走 reasoning_effort',
    thinking: { enabled: false }
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    url: '',
    model: '',
    note: '手动填写任意兼容地址',
    thinking: { enabled: false }
  }
]

const MOBILE_TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function generatePairingToken(): string {
  const values = crypto.getRandomValues(new Uint32Array(8))
  return Array.from(values, (n) => MOBILE_TOKEN_CHARS[n % MOBILE_TOKEN_CHARS.length]).join('')
}

export default function SettingsPage() {
  const {
    opacity,
    answerFontColor,
    transparentAnswerMode,
    apiBaseURL,
    apiKey,
    model,
    maxOutputTokens,
    scenes,
    activeSceneId,
    screenshotAutoSave,
    screenshotDir,
    dashscopeApiKey,
    audioInputDeviceId,
    audioOutputDeviceId,
    hideDockIcon,
    mobileDisplayEnabled,
    mobileServerPort,
    mobilePairingToken,
    interviewAssistantEnabled,
    clickCaptureMode,
    enableThinking,
    thinkingEffort,
    providerProfiles,
    activeProviderId,
    autoUpdateEnabled,
    updateSetting,
    applyProviderProfile,
    saveProviderProfile,
    deleteProviderProfile,
    setActiveScene,
    updateScenePrompt,
    addScene,
    removeScene
  } = useSettingsStore()
  const [showApiKey, setShowApiKey] = useState(false)
  const [showDashscopeApiKey, setShowDashscopeApiKey] = useState(false)
  const [addSceneOpen, setAddSceneOpen] = useState(false)
  const [newSceneName, setNewSceneName] = useState('')
  const [sceneToDelete, setSceneToDelete] = useState<string | null>(null)

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [mobileInfo, setMobileInfo] = useState<MobileServerInfo | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{
    status: string
    currentVersion: string
    version?: string
    progress?: number
    message?: string
  } | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setUpdateInfo(await window.api.getUpdateStatus())
      } catch (err) {
        console.error('Failed to get update status:', err)
      }
    }
    load()
    window.api.onUpdateStatus(setUpdateInfo)
    return () => {
      window.api.removeUpdateStatusListener()
    }
  }, [])

  const updateStatusText =
    updateInfo?.status === 'checking'
      ? '正在检查更新…'
      : updateInfo?.status === 'downloading'
        ? `正在下载 v${updateInfo.version ?? ''}（${updateInfo.progress ?? 0}%）`
        : updateInfo?.status === 'downloaded'
          ? `新版本 v${updateInfo.version ?? ''} 已就绪，退出时自动安装`
          : updateInfo?.status === 'not-available'
            ? '已是最新版本'
            : updateInfo?.status === 'error'
              ? '检查更新失败'
              : updateInfo?.status === 'unsupported'
                ? 'macOS 暂不支持自动更新，请手动下载 dmg'
                : ''

  const updateButtonText =
    updateInfo?.status === 'checking'
      ? '检查中…'
      : updateInfo?.status === 'downloading'
        ? `下载中 ${updateInfo.progress ?? 0}%`
        : updateInfo?.status === 'downloaded'
          ? '重启并更新'
          : '立即检查'

  const activeScene = scenes.find((s) => s.id === activeSceneId)
  const deletingScene = scenes.find((s) => s.id === sceneToDelete)

  useEffect(() => {
    const loadMobileInfo = async () => {
      try {
        setMobileInfo(await window.api.getMobileServerInfo())
      } catch (err) {
        console.error('Failed to get mobile server info:', err)
      }
    }
    loadMobileInfo()
    window.api.onMobileServerStatus(setMobileInfo)
    return () => {
      window.api.removeMobileServerStatusListener()
    }
  }, [])

  useEffect(() => {
    return () => {
      document.body.style.opacity = ''
    }
  }, [])

  useEffect(() => {
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const needsPermission = devices.every((d) => !d.label)
        if (needsPermission) {
          await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        }
        const refreshed = await navigator.mediaDevices.enumerateDevices()
        setAudioDevices(refreshed)
      } catch (err) {
        console.error('Failed to enumerate audio devices:', err)
      }
    }
    loadDevices()
  }, [])

  const handleAddScene = () => {
    const name = newSceneName.trim()
    if (!name) return
    addScene(name)
    setNewSceneName('')
    setAddSceneOpen(false)
  }

  const handleResetScenePrompt = () => {
    if (!activeScene?.isPreset) return
    updateScenePrompt(activeScene.id, PRESET_SCENE_PROMPTS[activeScene.id] ?? '')
  }

  const handleToggleMobile = (checked: boolean) => {
    if (checked && !mobilePairingToken) {
      updateSetting('mobilePairingToken', generatePairingToken())
    }
    updateSetting('mobileDisplayEnabled', checked)
    if (checked) {
      toast.info('已开启手机显示：扫码连接手机后，返回主界面时电脑窗口将自动隐藏')
    }
  }

  const handleRegenToken = () => {
    updateSetting('mobilePairingToken', generatePairingToken())
    toast.success('已重新生成配对码，旧链接已失效')
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('已复制到剪贴板'))
      .catch(() => toast.error('复制失败'))
  }

  return (
    <>
      {/* Header */}
      <div id="app-header" className="flex items-center">
        <div className="actions">
          <Button variant="ghost" asChild size="icon" className="w-12 mr-2 rounded-none">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        </div>
        <h1>设置</h1>
      </div>

      {/* Settings Content */}
      <div id="app-content" className="flex flex-col gap-4 p-8">
        {/* AI Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Bot className="h-5 w-5 mr-2" />
            AI 设置
          </h2>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  供应商配置方案
                  <span className="ml-2 text-xs font-light">
                    保存每家的地址 / Key / 模型 / 思考开关，点击快速切换（快捷键 Alt+O）
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    title={activeProviderId ? '用当前配置覆盖选中的方案' : '把当前配置保存为新方案'}
                    onClick={() => {
                      const p = saveProviderProfile(false)
                      toast.success(
                        activeProviderId ? `已更新方案：${p.name}` : `已保存新方案：${p.name}`
                      )
                    }}
                  >
                    保存当前
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    title="把当前配置另存为一个新方案"
                    onClick={() => {
                      const p = saveProviderProfile(true)
                      toast.success(`已另存新方案：${p.name}`)
                    }}
                  >
                    另存新方案
                  </Button>
                </div>
              </div>
              {providerProfiles.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {providerProfiles.map((p) => (
                    <div
                      key={p.id}
                      className={cn(
                        'group flex items-center rounded-full border text-sm transition-colors cursor-pointer select-none',
                        p.id === activeProviderId
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-gray-300 hover:border-blue-400'
                      )}
                      title={`${p.apiBaseURL} · ${p.model}${p.enableThinking ? ' · 思考开' : ''}`}
                      onClick={() => {
                        const applied = applyProviderProfile(p.id)
                        if (applied) {
                          toast.info(`已切换供应商：${applied.name}（${applied.model}）`)
                        }
                      }}
                    >
                      <span className="py-1 pl-3 pr-1">
                        {p.name}
                        <span
                          className={cn(
                            'ml-1.5 text-xs',
                            p.id === activeProviderId ? 'text-blue-100' : 'text-gray-500'
                          )}
                        >
                          {p.model}
                        </span>
                      </span>
                      <button
                        className="mr-1.5 p-0.5 rounded-full opacity-60 hover:opacity-100 hover:bg-black/10"
                        title="删除该方案"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteProviderProfile(p.id)
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-xs font-light text-gray-600">
                  还没有保存的方案。配置好下方信息后点「保存当前」，之后即可一键切换或用快捷键循环切换。
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                深度思考
                <span className="ml-2 text-xs font-light">
                  开启后模型先推理再作答（更慢更准），会随配置方案一起保存；DeepSeek
                  默认开启思考，此处关闭后会显式禁用
                </span>
              </label>
              <div className="flex items-center gap-2">
                {enableThinking && (
                  <Select
                    value={thinkingEffort}
                    onValueChange={(val) =>
                      updateSetting('thinkingEffort', val as typeof thinkingEffort)
                    }
                  >
                    <SelectTrigger className="w-24 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">低</SelectItem>
                      <SelectItem value="medium">中</SelectItem>
                      <SelectItem value="high">高</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Switch
                  className="scale-y-90"
                  checked={enableThinking}
                  onCheckedChange={(checked) => updateSetting('enableThinking', checked)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                模型服务商
                <span className="ml-2 text-xs font-light">选择后自动填入地址与推荐视觉模型</span>
              </label>
              <Select
                value={PROVIDER_PRESETS.find((p) => p.url && p.url === apiBaseURL)?.id ?? 'custom'}
                onValueChange={(val) => {
                  const preset = PROVIDER_PRESETS.find((p) => p.id === val)
                  if (!preset) return
                  if (preset.url) {
                    updateSetting('apiBaseURL', preset.url)
                    if (preset.model) {
                      updateSetting('model', preset.model)
                    }
                    // Apply the preset's recommended thinking defaults
                    updateSetting('enableThinking', preset.thinking.enabled)
                    if (preset.thinking.effort) {
                      updateSetting('thinkingEffort', preset.thinking.effort)
                    }
                    toast.info(`已切换到 ${preset.name}：${preset.model}`)
                  }
                }}
              >
                <SelectTrigger className="w-60 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                API Base URL
                <span className="ml-2 text-xs font-light">
                  如硅基流动为 https://api.siliconflow.cn/v1
                </span>
              </label>
              <input
                type="text"
                value={apiBaseURL}
                onChange={(e) => updateSetting('apiBaseURL', e.target.value)}
                className="w-60 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="可为空，默认使用 OpenAI 的 API"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <div className="flex items-center w-60">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => updateSetting('apiKey', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入 API Key"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="border border-l-0 rounded-l-none rounded-r-md h-9 w-9 hover:border-none"
                >
                  {showApiKey ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                Model
                <span className="ml-2 text-xs font-light">
                  这里列了几个流行的国内和国外模型，请自行确认你的平台是否支持
                </span>
              </label>
              <SelectModel value={model} onChange={(val) => updateSetting('model', val)} />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                最大输出长度
                <span className="ml-2 text-xs font-light">
                  答案被截断时调高；开启思考时推理也计入此预算（DeepSeek 思考模式最低自动放宽到
                  32K，上限 384K）
                </span>
              </label>
              <input
                type="number"
                min={1024}
                max={128000}
                step={1024}
                value={maxOutputTokens}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  if (Number.isInteger(value) && value >= 1024 && value <= 128000) {
                    updateSetting('maxOutputTokens', value)
                  }
                }}
                className="w-60 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        {/* Transcription Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Mic className="h-5 w-5 mr-2" />
            语音转录
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                百炼平台 API Key
                <span className="ml-2 text-xs font-light">
                  从阿里云
                  <a
                    href="https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-0.5 text-blue-700 hover:underline"
                  >
                    百炼平台
                  </a>
                  获取，如不需要语音转录功能可跳过
                </span>
              </label>
              <div className="flex items-center w-60">
                <input
                  type={showDashscopeApiKey ? 'text' : 'password'}
                  value={dashscopeApiKey}
                  onChange={(e) => updateSetting('dashscopeApiKey', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入百炼平台 API Key"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowDashscopeApiKey(!showDashscopeApiKey)}
                  className="border border-l-0 rounded-l-none rounded-r-md h-9 w-9 hover:border-none"
                >
                  {showDashscopeApiKey ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                音频输入设备
                <span className="ml-2 text-xs font-light">
                  选择麦克风，留空则捕获系统音频
                  {isMac && '；macOS 无法捕获系统声音，将自动使用麦克风'}
                </span>
              </label>
              <Select
                value={audioInputDeviceId || 'system'}
                onValueChange={(val) =>
                  updateSetting('audioInputDeviceId', val === 'system' ? '' : val)
                }
              >
                <SelectTrigger className="w-60 bg-white">
                  <SelectValue placeholder="系统音频（默认）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">系统音频（默认）</SelectItem>
                  {audioDevices
                    .filter((d) => d.kind === 'audioinput')
                    .map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || d.deviceId}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                音频输出设备
                <span className="ml-2 text-xs font-light">用于转录时的监听输出</span>
              </label>
              <Select
                value={audioOutputDeviceId || 'default'}
                onValueChange={(val) =>
                  updateSetting('audioOutputDeviceId', val === 'default' ? '' : val)
                }
              >
                <SelectTrigger className="w-60 bg-white">
                  <SelectValue placeholder="默认设备" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">默认设备</SelectItem>
                  {audioDevices
                    .filter((d) => d.kind === 'audiooutput')
                    .map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || d.deviceId}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        {/* Interview Assistant Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Mic className="h-5 w-5 mr-2" />
            面试实时助手
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                实时监听并自动回答
                <span className="ml-2 text-xs font-light">
                  持续监听面试官提问，自动识别问题并实时生成建议回答，无需按快捷键；也可在手机端开关
                </span>
              </label>
              <Switch
                className="scale-y-90"
                checked={interviewAssistantEnabled}
                onCheckedChange={(checked) => updateSetting('interviewAssistantEnabled', checked)}
              />
            </div>
            <p className="text-xs font-light">
              使用说明：依赖上方「语音转录」的百炼 API
              Key；音频输入设备建议选择「系统音频」，只监听面试官说话，不会录到自己的声音。开启后电脑悬浮窗和手机端都会显示「问题
              → 建议回答」时间线。
            </p>
          </div>
        </div>
        {/* Double Click Capture Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <MousePointerClick className="h-5 w-5 mr-2" />
            双击截图
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                鼠标左键点击触发截图
                <span className="ml-2 text-xs font-light">
                  屏幕任意位置点击/双击左键即可截屏解题
                </span>
              </label>
              <Select
                value={clickCaptureMode}
                onValueChange={(val) =>
                  updateSetting('clickCaptureMode', val as typeof clickCaptureMode)
                }
              >
                <SelectTrigger className="w-60 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">关闭（默认）</SelectItem>
                  <SelectItem value="double">双击截屏</SelectItem>
                  <SelectItem value="single">单击截屏</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs font-light">
              注意：开启后所有软件内的点击操作都会触发截图，可能影响正常操作（如选中文字），请按需开关。
              {isMac && ' macOS 首次开启需在「系统设置 → 隐私与安全性 → 辅助功能」中授权本应用。'}
            </p>
          </div>
        </div>
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <SquareTerminal className="h-5 w-5 mr-2" />
            解题设置
          </h2>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                使用场景
                <span className="ml-2 text-xs font-light">
                  选择场景后可编辑对应的系统提示词，修改会自动保存；也可新增自己的场景
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {scenes.map((scene) => (
                  <div
                    key={scene.id}
                    className={cn(
                      'group flex items-center rounded-full border text-sm transition-colors cursor-pointer select-none',
                      scene.id === activeSceneId
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-300 hover:border-blue-400'
                    )}
                    onClick={() => setActiveScene(scene.id)}
                  >
                    <span className={cn('py-1 pl-3', scene.isPreset ? 'pr-3' : 'pr-1')}>
                      {scene.name}
                    </span>
                    {!scene.isPreset && (
                      <button
                        className="mr-1.5 p-0.5 rounded-full opacity-60 hover:opacity-100 hover:bg-black/10"
                        title="删除该场景"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSceneToDelete(scene.id)
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="flex items-center gap-1 rounded-full border border-dashed border-gray-400 bg-transparent px-3 py-1 text-sm text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
                  onClick={() => setAddSceneOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  新增场景
                </button>
              </div>
            </div>

            {activeScene && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">
                    系统提示词
                    <span className="ml-2 text-xs font-light">「{activeScene.name}」场景</span>
                  </label>
                  {activeScene.isPreset && (
                    <button
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 transition-colors"
                      title="恢复该场景的默认提示词"
                      onClick={handleResetScenePrompt}
                    >
                      <RotateCcw className="h-3 w-3" />
                      恢复默认
                    </button>
                  )}
                </div>
                <Textarea
                  value={activeScene.prompt}
                  onChange={(e) => updateScenePrompt(activeScene.id, e.target.value)}
                  placeholder="请输入该场景的系统提示词, 示例: 你是一个解题助手, 请根据「截图」和「语音转录内容」给出相关回答。"
                  className="w-full min-h-24 max-h-100 bg-white"
                  rows={6}
                />
              </div>
            )}
          </div>
        </div>

        {/* Add scene dialog */}
        <Dialog open={addSceneOpen} onOpenChange={setAddSceneOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>新增场景</DialogTitle>
              <DialogDescription>创建后可为该场景编写专属的系统提示词</DialogDescription>
            </DialogHeader>
            <Input
              value={newSceneName}
              onChange={(e) => setNewSceneName(e.target.value)}
              placeholder="场景名称，如：数学考试"
              maxLength={20}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddScene()
              }}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddSceneOpen(false)}>
                取消
              </Button>
              <Button onClick={handleAddScene} disabled={!newSceneName.trim()}>
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete scene confirm dialog */}
        <Dialog open={!!sceneToDelete} onOpenChange={(open) => !open && setSceneToDelete(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>删除场景</DialogTitle>
              <DialogDescription>
                确定删除场景「{deletingScene?.name}」吗？其提示词内容将一并删除，且无法恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSceneToDelete(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (sceneToDelete) removeScene(sceneToDelete)
                  setSceneToDelete(null)
                }}
              >
                删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Appearance Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Palette className="h-5 w-5 mr-2" />
            外观设置
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                窗口透明度
                <span className="ml-2 text-xs font-light">拖动可实时预览效果</span>
              </label>
              <div className="w-60 flex items-center gap-2">
                <span className="text-xs whitespace-nowrap">透明</span>
                <Slider
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={[opacity]}
                  onValueChange={(value) => {
                    updateSetting('opacity', value[0])
                    document.body.style.opacity = value[0].toString()
                  }}
                />
                <span className="text-xs whitespace-nowrap">不透明</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                答案字体颜色
                <span className="ml-2 text-xs font-light">透明背景下建议选亮色</span>
              </label>
              <div className="w-60 flex items-center justify-end gap-1.5">
                {['#f8fafc', '#4ade80', '#facc15', '#22d3ee', '#f87171'].map((color) => (
                  <button
                    key={color}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 cursor-pointer transition-transform',
                      answerFontColor.toLowerCase() === color
                        ? 'border-blue-500 scale-110'
                        : 'border-gray-400/60 hover:scale-105'
                    )}
                    style={{ backgroundColor: color }}
                    title={color}
                    onClick={() => updateSetting('answerFontColor', color)}
                  />
                ))}
                <input
                  type="color"
                  value={answerFontColor}
                  onChange={(e) => updateSetting('answerFontColor', e.target.value)}
                  className="ml-1 h-7 w-8 cursor-pointer border border-gray-300 rounded bg-white p-0.5"
                  title="自定义颜色"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                背景完全透明
                <span className="ml-2 text-xs font-light">
                  仅答案文字悬浮显示，隐藏标题栏/状态栏/截图预览
                </span>
              </label>
              <Switch
                className="scale-y-90"
                checked={transparentAnswerMode}
                onCheckedChange={(checked) => updateSetting('transparentAnswerMode', checked)}
              />
            </div>
          </div>
        </div>

        {/* Mobile Display Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Smartphone className="h-5 w-5 mr-2" />
            手机显示
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                启用手机显示模式
                <span className="ml-2 text-xs font-light">
                  开启后电脑窗口自动隐藏，答案实时推送到手机浏览器查看
                </span>
              </label>
              <Switch
                className="scale-y-90"
                checked={mobileDisplayEnabled}
                onCheckedChange={handleToggleMobile}
              />
            </div>

            {mobileDisplayEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    服务端口
                    <span className="ml-2 text-xs font-light">修改后会自动重启服务</span>
                  </label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={mobileServerPort}
                    onChange={(e) => {
                      const port = Number(e.target.value)
                      if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
                        updateSetting('mobileServerPort', port)
                      }
                    }}
                    className="w-60 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    配对码
                    <span className="ml-2 text-xs font-light">手机需通过含配对码的链接访问</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm bg-white px-2.5 py-1.5 rounded-md border border-gray-300">
                      {mobilePairingToken || '未生成'}
                    </span>
                    <Button variant="outline" size="sm" onClick={handleRegenToken}>
                      重新生成
                    </Button>
                  </div>
                </div>

                <div className="text-sm">
                  {mobileInfo?.running ? (
                    <span className="text-green-700">
                      服务运行中 · 已连接 {mobileInfo.clientCount} 台设备
                    </span>
                  ) : (
                    <span className="text-gray-600">
                      {mobileInfo?.error ? '服务启动失败' : '服务未启动'}
                    </span>
                  )}
                  {mobileInfo?.error && (
                    <span className="block text-red-600 text-xs mt-1">{mobileInfo.error}</span>
                  )}
                </div>

                {mobileInfo?.running && mobileInfo.urls.length > 0 && (
                  <div className="flex items-start gap-4 pt-2">
                    <div className="bg-white p-2 rounded-lg border border-gray-300 flex-none">
                      <QRCode
                        size={110}
                        value={`${mobileInfo.urls[0]}/?token=${encodeURIComponent(
                          mobilePairingToken
                        )}`}
                      />
                    </div>
                    <div className="text-xs space-y-1.5 min-w-0">
                      <div>手机与电脑连接同一 Wi-Fi，扫码或输入地址访问：</div>
                      {mobileInfo.urls.map((url) => (
                        <div
                          key={url}
                          className="font-mono break-all cursor-pointer hover:text-blue-700 transition-colors"
                          title="点击复制完整链接"
                          onClick={() =>
                            copyToClipboard(
                              `${url}/?token=${encodeURIComponent(mobilePairingToken)}`
                            )
                          }
                        >
                          {url}/?token={mobilePairingToken}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Shortcuts Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Keyboard className="h-5 w-5 mr-2" />
            快捷键设置
            <div className="text-sm font-light ml-2 mt-1">
              只有在主界面时，快捷键才有效。当前页面仅部分快捷键生效。
            </div>
            <ResetDefaultShortcuts />
          </h2>
          <CustomShortcuts />
        </div>

        {/* Screenshot Save Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <FolderOpen className="h-5 w-5 mr-2" />
            保存截图
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                保存截图到本地
                <span className="ml-2 text-xs font-light">
                  开启后，每次截图都会自动保存到指定目录
                </span>
              </label>
              <Switch
                className="scale-y-90"
                checked={screenshotAutoSave}
                onCheckedChange={(checked) => updateSetting('screenshotAutoSave', checked)}
              />
            </div>
            {screenshotAutoSave && (
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  保存目录
                  <span className="ml-2 text-xs font-light">
                    可点击右侧内容重新选择保存目录（选择弹窗可能被本窗口遮挡）
                  </span>
                </label>
                <button
                  className="text-xs text-gray-600 max-w-48 truncate hover:text-gray-900 cursor-pointer transition-colors"
                  title="点击选择保存目录"
                  onClick={async () => {
                    const dir = await window.api.selectScreenshotDir()
                    if (dir) updateSetting('screenshotDir', dir)
                  }}
                >
                  {screenshotDir || '默认: 图片/SnapSolver'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Privacy Settings */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Shield className="h-5 w-5 mr-2" />
            隐私设置
          </h2>

          <div className="space-y-4">
            <p className="text-sm">
              此应用为本地应用，采集的图片直接上传到您配置的 OpenAI
              等大模型公司，不存在隐私泄露风险。
            </p>
            {isMac && (
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  隐藏 Dock 图标
                  <span className="ml-2 text-xs font-light">
                    开启后不在程序坞和 Cmd+Tab 切换器中显示，仅可通过快捷键唤起窗口
                  </span>
                </label>
                <Switch
                  className="scale-y-90"
                  checked={hideDockIcon}
                  onCheckedChange={(checked) => updateSetting('hideDockIcon', checked)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Version & Update */}
        <div className="bg-gray-300/80 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <RefreshCw className="h-5 w-5 mr-2" />
            版本与更新
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                自动更新
                <span className="ml-2 text-xs font-light">
                  自动检查 GitHub 最新版本并后台下载，退出时自动覆盖安装到当前目录（Windows）
                </span>
              </label>
              <Switch
                className="scale-y-90"
                checked={autoUpdateEnabled}
                onCheckedChange={(checked) => updateSetting('autoUpdateEnabled', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                当前版本 v{updateInfo?.currentVersion ?? '--'}
                <span className="ml-2 text-xs font-light">{updateStatusText}</span>
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={updateInfo?.status === 'checking' || updateInfo?.status === 'downloading'}
                onClick={async () => {
                  const st = await window.api.checkForUpdate()
                  if (st.status === 'downloaded') {
                    await window.api.installUpdate()
                  }
                }}
              >
                {updateButtonText}
              </Button>
            </div>
            {updateInfo?.status === 'error' && updateInfo.message && (
              <p className="text-xs text-red-600 break-all">{updateInfo.message}</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
