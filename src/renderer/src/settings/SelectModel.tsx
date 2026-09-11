import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronsUpDown, Check, Plus, RefreshCw, X } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/settings'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

const defaultModels = [
  { value: 'deepseek-flash', label: 'deepseek-flash（视觉+思考）' },
  { value: 'kimi-k3', label: 'kimi-k3（视觉）' },
  { value: 'Qwen/Qwen3-VL-32B-Instruct', label: 'Qwen/Qwen3-VL-32B-Instruct' },
  { value: 'Qwen/Qwen3-VL-8B-Thinking', label: 'Qwen/Qwen3-VL-8B-Thinking' },
  { value: 'zai-org/GLM-4.5V', label: 'zai-org/GLM-4.5V' },
  { value: 'glm-4.5v', label: 'glm-4.5v（智谱直连）' },
  { value: 'qwen-vl-max', label: 'qwen-vl-max（百炼）' },
  { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  { value: 'gpt-5.5', label: 'gpt-5.5' }
]

export function SelectModel({
  value,
  onChange,
  disabled,
  className
}: {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const { customModels, apiBaseURL, apiKey, updateSetting } = useSettingsStore()
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')

  const models = useMemo(() => {
    const fetchedItems = fetchedModels
      .filter((m) => !customModels.includes(m))
      .map((m) => ({ value: m, label: m, isCustom: false, isFetched: true }))
    const customItems = customModels.map((m) => ({
      value: m,
      label: m,
      isCustom: true,
      isFetched: false
    }))
    const defaultItems = defaultModels
      .filter((m) => !fetchedModels.includes(m.value) && !customModels.includes(m.value))
      .map((m) => ({ ...m, isCustom: false, isFetched: false }))
    return [...customItems, ...fetchedItems, ...defaultItems]
  }, [customModels, fetchedModels])

  const refreshModels = async () => {
    setFetching(true)
    setFetchError('')
    try {
      const res = await window.api.listModels({ baseURL: apiBaseURL, apiKey })
      if (res.success) {
        setFetchedModels(res.models)
        if (res.models.length === 0) {
          setFetchError('服务商返回了空列表')
        }
      } else {
        setFetchError(res.error)
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '获取失败')
    } finally {
      setFetching(false)
    }
  }

  const addCustomModel = (newModel: string) => {
    const newValue = newModel.trim()
    if (!newValue) return
    const exists = models.some((m) => m.value === newValue)
    if (exists) {
      onChange?.(newValue)
      setOpen(false)
      setSearchValue('')
      return
    }
    updateSetting('customModels', [...customModels, newValue])
    onChange?.(newValue)
    setSearchValue('')
    setOpen(false)
  }

  const deleteCustomModel = (val: string) => {
    updateSetting(
      'customModels',
      customModels.filter((m) => m !== val)
    )
    if (value === val) {
      onChange?.('')
    }
  }

  const filtered = models.filter((m) => m.label.toLowerCase().includes(searchValue.toLowerCase()))
  const showCreate =
    searchValue && !filtered.some((m) => m.label.toLowerCase() === searchValue.toLowerCase())

  const renderItem = (m: (typeof models)[number]) => (
    <div key={m.value} className="group flex">
      <CommandItem
        value={m.value}
        onSelect={(current) => {
          onChange?.(current === value ? '' : current)
          setSearchValue('')
          setOpen(false)
        }}
        className="flex-1"
      >
        {m.label}
        <Check className={cn('ml-auto', value === m.value ? 'opacity-100' : 'opacity-0')} />
      </CommandItem>
      {m.isCustom && (
        <div className="hidden group-hover:flex">
          <button
            className="text-gray-400 hover:text-red-500 cursor-pointer"
            onClick={() => deleteCustomModel(m.value)}
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  )

  const customItems = filtered.filter((m) => m.isCustom)
  const fetchedItems = filtered.filter((m) => m.isFetched)
  const defaultItems = filtered.filter((m) => !m.isCustom && !m.isFetched)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-60 justify-between', className)}
        >
          {value ? (models.find((m) => m.value === value)?.label ?? value) : '选择模型...'}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0">
        <Command>
          <CommandInput
            placeholder="输入以搜索或创建..."
            className="h-9"
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <div className="flex items-center justify-between border-b px-2 py-1.5">
            <span className="text-xs text-gray-500">
              {fetching
                ? '正在获取…'
                : fetchError
                  ? '获取失败'
                  : `${fetchedModels.length} 个来自服务商`}
            </span>
            <button
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 cursor-pointer"
              onClick={refreshModels}
              disabled={fetching}
              title="从当前 API Base URL 拉取模型列表"
            >
              <RefreshCw className={cn('h-3 w-3', fetching && 'animate-spin')} />
              获取模型列表
            </button>
          </div>
          {fetchError && !fetching && (
            <div className="px-2 py-1 text-xs text-red-500 break-all">{fetchError}</div>
          )}
          <CommandList>
            <CommandEmpty>未找到结果</CommandEmpty>
            {customItems.length > 0 && (
              <CommandGroup heading="自定义">{customItems.map(renderItem)}</CommandGroup>
            )}
            {fetchedItems.length > 0 && (
              <CommandGroup heading="来自服务商">{fetchedItems.map(renderItem)}</CommandGroup>
            )}
            <CommandGroup heading="常用">{defaultItems.map(renderItem)}</CommandGroup>
            {showCreate && (
              <CommandGroup>
                <CommandItem
                  value={`create-${searchValue}`}
                  onSelect={() => addCustomModel(searchValue)}
                  className="!text-blue-600"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  创建 “{searchValue}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
