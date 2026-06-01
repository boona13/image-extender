import {
  ProviderCapability,
  ProviderEndpointConfig,
  ProviderImageRequest,
  ProviderMessagePart,
  ProviderSettings,
  ProviderTextRequest,
  createDefaultProviderSettings,
  isProviderProtocol,
  normalizeProviderSettings,
} from './types'

type ResolveProviderInput = {
  capability: ProviderCapability
  providerSettings: unknown
  legacyApiKey: unknown
  legacyModel: unknown
  defaultModel: string
}

type ResolvedProvider = ProviderEndpointConfig & {
  capability: ProviderCapability
}

type FetchContext = {
  referer: string | null
}

/** 解析请求体和环境变量，得到某类能力最终使用的 provider。 */
export function resolveProvider(input: ResolveProviderInput): ResolvedProvider {
  const settings = normalizeProviderSettings(input.providerSettings, input.defaultModel)
  const endpoint = settings[input.capability]
  const envPrefix = input.capability.toUpperCase()
  const envProtocol = process.env[`${envPrefix}_PROVIDER_PROTOCOL`]
  const protocol = isProviderProtocol(envProtocol) ? envProtocol : endpoint.protocol
  const baseUrl = process.env[`${envPrefix}_PROVIDER_BASE_URL`] || endpoint.baseUrl
  const apiKey =
    endpoint.apiKey ||
    process.env[`${envPrefix}_PROVIDER_API_KEY`] ||
    stringOrEmpty(input.legacyApiKey) ||
    process.env.OPENROUTER_API_KEY ||
    ''
  const legacyModel = input.capability === 'image' ? stringOrEmpty(input.legacyModel) : ''
  const model =
    endpoint.model ||
    process.env[`${envPrefix}_PROVIDER_MODEL`] ||
    legacyModel ||
    input.defaultModel

  return {
    capability: input.capability,
    name: endpoint.name,
    protocol,
    baseUrl: trimTrailingSlash(baseUrl || createDefaultProviderSettings(input.defaultModel)[input.capability].baseUrl),
    apiKey,
    model,
  }
}

/** 检查 provider 是否具备调用所需的 key 和模型。 */
export function assertProviderReady(provider: ResolvedProvider): NextResponseLike | null {
  if (!provider.apiKey) {
    return {
      message: `${provider.name || provider.capability} API key missing. Add one in Settings or configure server env.`,
      status: 401,
    }
  }
  if (!provider.model) {
    return {
      message: `${provider.name || provider.capability} model missing. Configure a model in Settings or server env.`,
      status: 400,
    }
  }
  return null
}

type NextResponseLike = {
  message: string
  status: number
}

/** 调用文本或视觉 provider，并返回规整后的纯文本。 */
export async function callTextProvider(
  provider: ResolvedProvider,
  request: ProviderTextRequest,
  context: FetchContext
): Promise<string> {
  const json = await callProviderJson(provider, {
    body:
      provider.protocol === 'openai-responses'
        ? buildResponsesTextBody(provider, request)
        : buildChatTextBody(provider, request),
    context,
    title: request.title,
    endpointPath: provider.protocol === 'openai-responses' ? '/responses' : '/chat/completions',
  })
  return extractTextFromAny(json)
}

/** 调用图片 provider，并返回规整后的 data URL 或图片 URL。 */
export async function callImageProvider(
  provider: ResolvedProvider,
  request: ProviderImageRequest,
  context: FetchContext
): Promise<{ imageUrl: string; text: string; raw: unknown }> {
  if (provider.protocol === 'openai-images' && request.inputImages.length > 0) {
    throw new Error('The OpenAI Images protocol only supports text-to-image in this app. Use Responses or Chat Images for image inputs.')
  }

  const endpointPath =
    provider.protocol === 'openai-responses'
      ? '/responses'
      : provider.protocol === 'openai-images'
        ? '/images/generations'
        : '/chat/completions'

  const body =
    provider.protocol === 'openai-responses'
      ? buildResponsesImageBody(provider, request)
      : provider.protocol === 'openai-images'
        ? buildImagesBody(provider, request)
        : buildChatImageBody(provider, request)

  const json = await callProviderJson(provider, {
    body,
    context,
    title: request.title,
    endpointPath,
  })
  const imageUrl = extractImageFromAny(json)
  const text = extractTextFromAny(json)
  if (!imageUrl) {
    throw new Error('No image returned from provider. Check the provider protocol and model configuration.')
  }
  return { imageUrl, text, raw: json }
}

/** 统一执行 HTTP 请求，保留 OpenRouter 专属 header，其他 provider 只发标准 Bearer。 */
async function callProviderJson(
  provider: ResolvedProvider,
  options: {
    body: Record<string, unknown>
    context: FetchContext
    title: string
    endpointPath: string
  }
): Promise<unknown> {
  const response = await fetch(`${provider.baseUrl}${options.endpointPath}`, {
    method: 'POST',
    headers: buildHeaders(provider, options.context, options.title),
    body: JSON.stringify(options.body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new ProviderHttpError(provider, response.status, parseProviderError(text))
  }

  return response.json()
}

export class ProviderHttpError extends Error {
  status: number

  /** 保存 provider HTTP 状态码，让 route 能原样返回给前端。 */
  constructor(provider: ResolvedProvider, status: number, message: string) {
    super(`${provider.name || provider.capability}: ${message}`)
    this.status = status
  }
}

/** 根据协议构造请求 header；OpenRouter 需要 referer/title，通用 provider 不强加。 */
function buildHeaders(
  provider: ResolvedProvider,
  context: FetchContext,
  title: string
): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${provider.apiKey}`,
    'Content-Type': 'application/json',
  }
  if (provider.protocol === 'openrouter-chat-completions') {
    headers['HTTP-Referer'] = context.referer || 'http://localhost:3000'
    headers['X-Title'] = title
  }
  return headers
}

/** 构造 chat-completions 文本/视觉请求体。 */
function buildChatTextBody(provider: ResolvedProvider, request: ProviderTextRequest): Record<string, unknown> {
  return {
    model: provider.model,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userContent },
    ],
    max_tokens: request.maxTokens,
    temperature: request.temperature,
  }
}

/** 构造 Responses 文本/视觉请求体，兼容 input_text/input_image 结构。 */
function buildResponsesTextBody(provider: ResolvedProvider, request: ProviderTextRequest): Record<string, unknown> {
  return {
    model: provider.model,
    instructions: request.systemPrompt,
    input: [
      {
        role: 'user',
        content: normalizeResponsesContent(request.userContent),
      },
    ],
    max_output_tokens: request.maxTokens,
    temperature: request.temperature,
  }
}

/** 构造 OpenRouter / chat image 请求体，Nano Banana 需要 modalities 和 image_config。 */
function buildChatImageBody(provider: ResolvedProvider, request: ProviderImageRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [
      {
        role: 'user',
        content: [
          ...request.inputImages.map((url) => ({ type: 'image_url', image_url: { url } })),
          { type: 'text', text: request.prompt },
        ],
      },
    ],
    max_tokens: request.maxTokens,
    temperature: request.temperature,
  }

  if (provider.protocol === 'openrouter-chat-completions') {
    body.modalities = ['image', 'text']
    body.image_config = { aspect_ratio: supportedAspectRatioForSize(request.width, request.height) }
  }

  return body
}

/** 构造 Responses 图片请求体，GPT Image 类输出由 image_generation 工具返回。 */
function buildResponsesImageBody(provider: ResolvedProvider, request: ProviderImageRequest): Record<string, unknown> {
  return {
    model: provider.model,
    input: [
      {
        role: 'user',
        content: [
          ...request.inputImages.map((url) => ({ type: 'input_image', image_url: url })),
          { type: 'input_text', text: request.prompt },
        ],
      },
    ],
    tools: [
      {
        type: 'image_generation',
        action: request.forceEdit || request.inputImages.length > 0 ? 'edit' : 'generate',
        size: sizeForProvider(request.width, request.height),
      },
    ],
    tool_choice: { type: 'image_generation' },
    temperature: request.temperature,
  }
}

/** 构造 Images API 文生图请求体。 */
function buildImagesBody(provider: ResolvedProvider, request: ProviderImageRequest): Record<string, unknown> {
  return {
    model: provider.model,
    prompt: request.prompt,
    size: sizeForProvider(request.width, request.height),
    n: 1,
  }
}

/** 将 chat content 转成 Responses content 需要的 input_text/input_image。 */
function normalizeResponsesContent(content: string | ProviderMessagePart[]): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'input_text', text: content }]
  }
  return content.map((part) => {
    if (part.type === 'image_url') {
      return { type: 'input_image', image_url: part.image_url.url }
    }
    return { type: 'input_text', text: part.text }
  })
}

/** 从任意 OpenRouter/OpenAI/Responses/Images 响应结构中提取第一张图片。 */
export function extractImageFromAny(node: any): string | null {
  if (!node) return null

  if (Array.isArray(node.data) && node.data.length > 0) {
    for (const item of node.data) {
      if (item?.url) return item.url
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
    }
  }

  if (Array.isArray(node.output)) {
    for (const output of node.output) {
      if (output?.type === 'image_generation_call' && output?.result) {
        return `data:image/png;base64,${output.result}`
      }
      const nested = extractImageFromAny(output)
      if (nested) return nested
    }
  }

  if (Array.isArray(node.choices)) {
    for (const choice of node.choices) {
      const nested = extractImageFromAny(choice?.message || choice)
      if (nested) return nested
    }
  }

  if (Array.isArray(node.images) && node.images.length > 0) {
    for (const img of node.images) {
      if (img?.image_url?.url) return img.image_url.url
      if (img?.url) return img.url
      if (img?.b64_json) return `data:image/png;base64,${img.b64_json}`
    }
  }

  if (typeof node.b64_json === 'string' && node.b64_json.length > 100) {
    return `data:image/png;base64,${node.b64_json}`
  }

  const content = node.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'image_url' && part?.image_url?.url) return part.image_url.url
      if (part?.type === 'image' && part?.url) return part.url
      if (part?.image_url?.data) return `data:image/png;base64,${part.image_url.data}`
      if (part?.b64_json) return `data:image/png;base64,${part.b64_json}`
      if (part?.data && typeof part.data === 'string' && part.data.length > 100) {
        return `data:image/png;base64,${part.data}`
      }
      if (part?.inline_data?.data) {
        const mime = part.inline_data.mime_type || 'image/png'
        return `data:${mime};base64,${part.inline_data.data}`
      }
    }
  } else if (typeof content === 'string') {
    if (content.startsWith('data:image') || content.startsWith('http')) return content
    if (content.length > 100 && /^[A-Za-z0-9+/=]+$/.test(content.substring(0, 100))) {
      return `data:image/png;base64,${content}`
    }
    const urlMatch = content.match(/!\[.*?\]\((.*?)\)/)
    if (urlMatch?.[1]) return urlMatch[1]
  } else if (content && typeof content === 'object') {
    if ((content as any).data) return `data:image/png;base64,${(content as any).data}`
    if ((content as any).inline_data?.data) {
      const mime = (content as any).inline_data.mime_type || 'image/png'
      return `data:${mime};base64,${(content as any).inline_data.data}`
    }
  }

  return null
}

/** 从不同响应结构中提取文本，用于 brief / review 和 Props 命名。 */
export function extractTextFromAny(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node

  if (typeof node.output_text === 'string') return node.output_text.trim()

  if (Array.isArray(node.output)) {
    return node.output.map(extractTextFromAny).filter(Boolean).join('').trim()
  }

  if (Array.isArray(node.choices)) {
    return node.choices.map((choice: any) => extractTextFromAny(choice?.message || choice)).filter(Boolean).join('').trim()
  }

  const content = node.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .join('')
      .trim()
  }

  return ''
}

/** 将 provider 错误体解析成短消息，避免把大响应直接丢给前端。 */
function parseProviderError(text: string): string {
  try {
    const json = JSON.parse(text)
    return json?.error?.message || json?.message || text.slice(0, 500) || 'Provider request failed'
  } catch {
    return text.slice(0, 500) || 'Provider request failed'
  }
}

/** 计算 OpenRouter 支持的近似图像比例。 */
function supportedAspectRatioForSize(width: number, height: number): string {
  const target = width / height
  const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
  return ratios
    .map((ratio) => {
      const [w, h] = ratio.split(':').map(Number)
      return { ratio, error: Math.abs(Math.log((w / h) / target)) }
    })
    .sort((a, b) => a.error - b.error)[0].ratio
}

/** 将任意尺寸收敛成 provider 常见的 WIDTHxHEIGHT 字符串。 */
function sizeForProvider(width: number, height: number): string {
  return `${Math.max(256, Math.round(width))}x${Math.max(256, Math.round(height))}`
}

/** 空字符串保护，兼容旧的 apiKey/model 字段。 */
function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** 移除 base URL 尾部斜杠，避免拼接出双斜杠。 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
