export type ProviderCapability = 'image' | 'text' | 'vision'

export type ProviderProtocol =
  | 'openrouter-chat-completions'
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'openai-images'

export type ProviderEndpointConfig = {
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  model: string
}

export type ProviderSettings = Record<ProviderCapability, ProviderEndpointConfig>

export type ProviderMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type ProviderTextRequest = {
  capability: Exclude<ProviderCapability, 'image'>
  systemPrompt: string
  userContent: string | ProviderMessagePart[]
  maxTokens: number
  temperature: number
  title: string
}

export type ProviderImageRequest = {
  prompt: string
  inputImages: string[]
  width: number
  height: number
  maxTokens: number
  temperature: number
  title: string
  forceEdit?: boolean
}

export const PROVIDER_STORAGE_KEY = 'extender:provider_settings:v1'

export const PROVIDER_CAPABILITIES: ProviderCapability[] = ['image', 'text', 'vision']

export const PROVIDER_PROTOCOLS: Array<{
  value: ProviderProtocol
  label: string
  description: string
}> = [
  {
    value: 'openrouter-chat-completions',
    label: 'OpenRouter Chat Images',
    description: 'OpenRouter /chat/completions with image modalities and image_config.',
  },
  {
    value: 'openai-chat-completions',
    label: 'OpenAI-Compatible Chat',
    description: 'Generic /chat/completions for text and vision-compatible providers.',
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses',
    description: 'Generic /responses with image_generation tool support for image workflows.',
  },
  {
    value: 'openai-images',
    label: 'OpenAI Images',
    description: 'Generic /images/generations for text-to-image only.',
  },
]

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

/** 创建一份默认 provider 配置，保持旧版本的 OpenRouter 行为不变。 */
export function createDefaultProviderSettings(defaultModel: string): ProviderSettings {
  return {
    image: createDefaultEndpoint('OpenRouter image', defaultModel),
    text: createDefaultEndpoint('OpenRouter text', defaultModel),
    vision: createDefaultEndpoint('OpenRouter vision', defaultModel),
  }
}

/** 创建单类能力的默认 endpoint，避免三个能力的对象共享引用。 */
function createDefaultEndpoint(name: string, defaultModel: string): ProviderEndpointConfig {
  return {
    name,
    protocol: 'openrouter-chat-completions',
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: '',
  }
}

/** 把 localStorage 或请求体里的未知配置规整成完整 ProviderSettings。 */
export function normalizeProviderSettings(
  value: unknown,
  defaultModel: string
): ProviderSettings {
  const defaults = createDefaultProviderSettings(defaultModel)
  if (!value || typeof value !== 'object') return defaults

  const record = value as Partial<Record<ProviderCapability, Partial<ProviderEndpointConfig>>>
  return {
    image: normalizeEndpoint(record.image, defaults.image),
    text: normalizeEndpoint(record.text, defaults.text),
    vision: normalizeEndpoint(record.vision, defaults.vision),
  }
}

/** 规整单个 endpoint，保证协议、base URL、模型和 key 字段都有可用字符串。 */
function normalizeEndpoint(
  value: Partial<ProviderEndpointConfig> | undefined,
  fallback: ProviderEndpointConfig
): ProviderEndpointConfig {
  const protocol = isProviderProtocol(value?.protocol) ? value.protocol : fallback.protocol
  return {
    name: stringOrFallback(value?.name, fallback.name),
    protocol,
    baseUrl: trimTrailingSlash(stringOrFallback(value?.baseUrl, fallback.baseUrl)),
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey.trim() : fallback.apiKey,
    model: stringOrFallback(value?.model, fallback.model),
  }
}

/** 判断字符串是否是受支持的 provider 协议。 */
export function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return (
    value === 'openrouter-chat-completions' ||
    value === 'openai-chat-completions' ||
    value === 'openai-responses' ||
    value === 'openai-images'
  )
}

/** 用于 UI 展示的能力名称，避免把内部 key 直接暴露给用户。 */
export function providerCapabilityLabel(capability: ProviderCapability): string {
  if (capability === 'image') return 'Image'
  if (capability === 'text') return 'Text'
  return 'Vision'
}

/** 轻量遮罩 API key，只保留末尾几位方便用户识别。 */
export function maskProviderSecret(value: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  const tail = trimmed.slice(-4)
  return `${'•'.repeat(Math.max(4, Math.min(20, trimmed.length - 4)))}${tail}`
}

/** 空值保护：只有非空字符串才覆盖 fallback。 */
function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** 移除 base URL 末尾斜杠，拼接路径时保持稳定。 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
