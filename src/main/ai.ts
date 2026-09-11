import { streamText, generateText, type ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { fetch as undiciFetch, Agent } from 'undici'
import { settings, AppSettings } from './settings'

// Dedicated HTTP agent for LLM streaming: Node's global fetch (undici)
// kills a connection after 300s without body data by default, which cuts
// off deep-thinking models that stay silent for minutes before the first
// token. Disable the body idle timeout entirely and allow 10min to first byte.
const llmAgent = new Agent({
  headersTimeout: 10 * 60 * 1000,
  bodyTimeout: 0
})

function llmFetch(url: string, options?: RequestInit): Promise<Response> {
  const init = {
    ...(options ?? {}),
    dispatcher: llmAgent
  } as unknown as Parameters<typeof undiciFetch>[1]
  return undiciFetch(url, init) as unknown as Promise<Response>
}

// The system prompt is fully managed by the renderer (prompt scenes in the
// settings store) and synced here via updateAppSettings on app startup
function getSystemPrompt(extra?: string) {
  const basePrompt = settings.customPrompt || ''
  return [basePrompt, extra].filter(Boolean).join('\n\n') || undefined
}

// Large output budget so long coding answers (full code + alternatives) are
// not truncated mid-stream. Some models cap this value; keep it high but
// within the context window of the configured model (Kimi-K2.6: 128k).
const MAX_OUTPUT_TOKENS = 100000

function getModel(_settings: AppSettings) {
  const fallbackModel = settings.apiBaseURL.includes('siliconflow')
    ? 'Qwen/Qwen3-VL-32B-Instruct'
    : 'gpt-5-mini'
  return _settings.model || fallbackModel
}

function createOpenAIProvider() {
  const isDashScope =
    settings.apiBaseURL.includes('aliyuncs.com') || settings.apiBaseURL.includes('dashscope')

  return createOpenAI({
    baseURL: settings.apiBaseURL,
    apiKey: settings.apiKey,
    fetch: async (url, options) => {
      if (!options?.body) return llmFetch(url, options)

      try {
        const body = JSON.parse(options.body as string)
        const modelStr = String(body.model || '')
        const isKimi = modelStr.includes('kimi')
        // DeepSeek accepts the standard OpenAI image_url format our pipeline
        // already produces; only its parameter caps and vLLM-only fields differ
        const isDeepSeek = String(url).includes('deepseek.com')

        console.log('[AI Request] URL:', String(url))
        console.log('[AI Request] BEFORE =>', JSON.stringify(body))

        if (isDeepSeek) {
          // DeepSeek caps output tokens at 8k; our 100k budget would 400
          if (typeof body.max_tokens === 'number' && body.max_tokens > 8192) {
            body.max_tokens = 8192
          }
        }

        // Thinking control per provider. DeepSeek thinks by DEFAULT (high
        // effort) and streams reasoning only via reasoning_content — which
        // the text-only stream never surfaces — so without an explicit
        // `thinking: disabled` the UI shows nothing for minutes.
        const thinkingOn = settings.enableThinking
        const effort = settings.thinkingEffort
        if (isDeepSeek) {
          // OpenAI-compat param; effort values are low/high/max
          body.thinking = { type: thinkingOn ? 'enabled' : 'disabled' }
          if (thinkingOn) {
            body.reasoning_effort = effort === 'low' ? 'low' : effort === 'high' ? 'max' : 'high'
          }
        } else if (String(url).includes('bigmodel')) {
          // Zhipu GLM-4.5+: same object shape, enabled/disabled only
          body.thinking = { type: thinkingOn ? 'enabled' : 'disabled' }
        } else if (String(url).includes('api.openai.com')) {
          if (thinkingOn) {
            body.reasoning_effort = effort
          }
        } else if (String(url).includes('openrouter.ai')) {
          if (thinkingOn) {
            body.reasoning = { effort }
          }
        } else if (isKimi || isDashScope) {
          // kimi/kimi-k3 (DashScope) only allows temperature=0.6.
          // Check the MODEL NAME in the request body (always reliable)
          // rather than the base URL, which may be set via UI.
          delete body.temperature
          delete body.top_p
          delete body.top_k
          delete body.frequency_penalty
          delete body.presence_penalty
          body.enable_thinking = thinkingOn
        } else {
          // Self-hosted vLLM-style deployments
          body.extra_body = {
            ...(body.extra_body || {}),
            chat_template_kwargs: {
              enable_thinking: thinkingOn
            }
          }
        }

        console.log('[AI Request] AFTER  =>', JSON.stringify(body))

        return llmFetch(url, {
          ...options,
          body: JSON.stringify(body)
        })
      } catch (e) {
        console.error('[AI Request] Failed to parse/modify body:', e)
        return llmFetch(url, options)
      }
    }
  })
}

type LooseMessage = {
  role?: string
  content?: unknown
}

type LooseContentPart = {
  type?: string
  image?: string
  text?: string
}

function transformMessages(messages: ModelMessage[]): ModelMessage[] {
  return (messages as LooseMessage[]).map((m) => {
    if (Array.isArray(m.content)) {
      return {
        ...m,
        content: (m.content as LooseContentPart[]).map((item) => {
          if (item.type === 'image' && typeof item.image === 'string') {
            const imageData = item.image
            const base64 = imageData.startsWith('data:')
              ? imageData
              : `data:image/png;base64,${imageData}`

            // @ai-sdk/openai converts `type: 'file'` + `mediaType: 'image/*'`
            // to OpenAI `image_url`, but passes `type: 'image'` through as-is,
            // which causes DashScope/compatible providers to reject it.
            return {
              type: 'file',
              data: base64,
              mediaType: 'image/png'
            }
          }
          // DashScope is very picky. Let's ensure text items are exactly as expected.
          if (item.type === 'text') {
            return {
              type: 'text',
              text: item.text
            }
          }
          return item
        })
      } as ModelMessage
    }
    // If content is just a string, leave it as is
    return m as ModelMessage
  })
}

export function getSolutionStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  const modelName = getModel(settings)
  const systemPrompt = getSystemPrompt()

  console.log('API Request Detail:', {
    baseURL: settings.apiBaseURL,
    model: modelName,
    systemPrompt: systemPrompt?.substring(0, 50) + '...',
    messageCount: messages.length
  })

  const openai = createOpenAIProvider()

  // For DashScope multimodal, it's often safer to include system prompt as the first message
  const isDashScope =
    settings.apiBaseURL.includes('aliyuncs.com') || settings.apiBaseURL.includes('dashscope')
  const transformedMessages = transformMessages(messages)
  const finalMessages: ModelMessage[] = isDashScope
    ? [{ role: 'system', content: systemPrompt ?? '' }, ...transformedMessages]
    : transformedMessages

  const { textStream } = streamText({
    model: openai.chat(modelName),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    // temperature omitted: kimi/kimi-k3 only allows 0.6 (its default);
    // let each provider use its own default to avoid API rejection.
    // If we included system in messages, don't pass it here
    system: isDashScope ? undefined : systemPrompt,
    messages: finalMessages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}

export function getFollowUpStream(
  messages: ModelMessage[],
  userQuestion: string,
  abortSignal?: AbortSignal
) {
  const modelName = getModel(settings)
  const systemPrompt = getSystemPrompt()
  const openai = createOpenAIProvider()

  // Add the user's follow-up question to the conversation
  const updatedMessages: ModelMessage[] = [
    ...messages,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: userQuestion
        }
      ]
    }
  ]

  const isDashScope =
    settings.apiBaseURL.includes('aliyuncs.com') || settings.apiBaseURL.includes('dashscope')
  const transformedMessages = transformMessages(updatedMessages)
  const finalMessages: ModelMessage[] = isDashScope
    ? [{ role: 'system', content: systemPrompt ?? '' }, ...transformedMessages]
    : transformedMessages

  const { textStream } = streamText({
    model: openai.chat(modelName),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    system: isDashScope ? undefined : systemPrompt,
    messages: finalMessages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}

export function getGeneralStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  const modelName = getModel(settings)
  const systemPrompt = getSystemPrompt(
    '注意：如果有多张截图，请结合所有截图内容进行完整分析，不要遗漏任何部分。'
  )
  const openai = createOpenAIProvider()

  const isDashScope =
    settings.apiBaseURL.includes('aliyuncs.com') || settings.apiBaseURL.includes('dashscope')
  const transformedMessages = transformMessages(messages)
  const finalMessages: ModelMessage[] = isDashScope
    ? [{ role: 'system', content: systemPrompt ?? '' }, ...transformedMessages]
    : transformedMessages

  const { textStream } = streamText({
    model: openai.chat(modelName),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    system: isDashScope ? undefined : systemPrompt,
    messages: finalMessages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}

/**
 * Real-time interview assistant: text-only answer stream for a detected
 * interviewer question. Small token budget keeps answers snappy.
 */
export function getInterviewAnswerStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  const openai = createOpenAIProvider()
  const { textStream } = streamText({
    model: openai.chat(getModel(settings)),
    maxOutputTokens: 4000,
    messages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}

/**
 * One-shot background call: compress older interview Q&A pairs into a short
 * running summary so long sessions stay within a small context window.
 */
export async function compressInterviewHistory(
  pairs: { question: string; answer: string }[],
  previousSummary: string
): Promise<string> {
  const transcript = pairs.map((p) => `面试官：${p.question}\n回答：${p.answer}`).join('\n\n')
  const openai = createOpenAIProvider()
  const { text } = await generateText({
    model: openai.chat(getModel(settings)),
    maxOutputTokens: 1000,
    messages: [
      {
        role: 'user',
        content: `将下面的面试问答历史压缩成要点摘要（300字以内），保留：考察的技术点、双方的关键结论、未解决的问题。如有此前的旧摘要，把它的信息合并进来，输出最终的新摘要正文，不要任何前后缀。\n\n旧摘要：\n${previousSummary || '（无）'}\n\n问答历史：\n${transcript}`
      }
    ]
  })
  return text.trim()
}
