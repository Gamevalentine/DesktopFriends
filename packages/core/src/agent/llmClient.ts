/**
 * @Description LLM API 客户端
 * 负责构建请求、调用 API、解析响应
 * 支持 OpenAI、Claude、DeepSeek 官方 API 及 OpenAI 兼容 API
 */
import type { LLMConfig } from '@desktopfriends/shared'
import type { AgentMessage } from './memory'

/** OpenAI 原生 tools 格式 */
export interface OpenAIToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

/** LLM API 原始响应中的 tool call */
export interface RawToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** 流式响应 chunk 类型 */
export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; arguments: string }
  | { type: 'done'; content: string; toolCalls: RawToolCall[] }

/** 连接测试结果 */
export interface TestConnectionResult {
  success: boolean
  message: string
  /** 可用模型列表（如果 API 支持） */
  models?: string[]
  /** 响应耗时（毫秒） */
  latencyMs?: number
}

// ============ Provider 配置 ============

interface ProviderConfig {
  /** 默认 chat completions URL */
  defaultChatUrl: string
  /** 默认 models 列表 URL */
  defaultModelsUrl: string
  /** 默认模型 */
  defaultModel: string
  /** 构建请求头 */
  buildHeaders: (apiKey: string) => Record<string, string>
  /** 是否使用 Claude Messages API 格式 */
  isClaudeFormat: boolean
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openai: {
    defaultChatUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModelsUrl: 'https://api.openai.com/v1/models',
    defaultModel: 'gpt-4o-mini',
    buildHeaders: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    isClaudeFormat: false,
  },
  deepseek: {
    defaultChatUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModelsUrl: 'https://api.deepseek.com/v1/models',
    defaultModel: 'deepseek-chat',
    buildHeaders: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    isClaudeFormat: false,
  },
  claude: {
    defaultChatUrl: 'https://api.anthropic.com/v1/messages',
    defaultModelsUrl: 'https://api.anthropic.com/v1/models',
    defaultModel: 'claude-3-haiku-20240307',
    buildHeaders: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    }),
    isClaudeFormat: true,
  },
}

/**
 * 获取 provider 配置（custom 使用 OpenAI 兼容格式）
 */
function getProviderConfig(provider: string, apiKey: string, baseUrl?: string): ProviderConfig {
  const known = PROVIDER_CONFIGS[provider]
  if (known) return known

  // custom / 未知 provider → OpenAI 兼容格式
  return {
    defaultChatUrl: baseUrl || 'https://api.openai.com/v1/chat/completions',
    defaultModelsUrl: baseUrl ? baseUrl.replace(/\/chat\/completions\/?$/, '/models') : 'https://api.openai.com/v1/models',
    defaultModel: 'gpt-4o-mini',
    buildHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'api_key': key,
      'Content-Type': 'application/json',
    }),
    isClaudeFormat: false,
  }
}

/**
 * 从 baseUrl 推导出 chat completions URL
 * 支持多种输入格式：
 * - https://api.example.com/v1/chat/completions → 原样
 * - https://api.example.com/v1 → 追加 /chat/completions
 * - https://api.example.com → 追加 /v1/chat/completions
 */
function resolveChatUrl(baseUrl: string, defaultUrl: string): string {
  if (!baseUrl) return defaultUrl
  // 已经是完整的 chat completions URL
  if (baseUrl.includes('/chat/completions')) return baseUrl
  // 以 /v1 结尾
  if (baseUrl.endsWith('/v1') || baseUrl.endsWith('/v1/')) {
    return baseUrl.replace(/\/+$/, '') + '/chat/completions'
  }
  // 其他情况：假设是 base，追加完整路径
  return baseUrl.replace(/\/+$/, '') + '/v1/chat/completions'
}

/**
 * 从 baseUrl 推导出 models URL
 */
function resolveModelsUrl(baseUrl: string, defaultUrl: string): string {
  if (!baseUrl) return defaultUrl
  if (baseUrl.includes('/models')) return baseUrl
  if (baseUrl.includes('/chat/completions')) {
    return baseUrl.replace(/\/chat\/completions\/?$/, '/models')
  }
  if (baseUrl.endsWith('/v1') || baseUrl.endsWith('/v1/')) {
    return baseUrl.replace(/\/+$/, '') + '/models'
  }
  return baseUrl.replace(/\/+$/, '') + '/v1/models'
}

// ============ LLM Client ============

/**
 * LLM API 客户端
 */
export class LLMClient {
  private config: LLMConfig
  private systemPrompt: string = ''

  constructor(config: LLMConfig) {
    this.config = config
  }

  /** 更新 LLM 配置 */
  updateConfig(config: LLMConfig) {
    this.config = config
  }

  /** 设置系统提示词 */
  setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt
  }

  /**
   * 将 OpenAI 工具格式转换为 Claude 工具格式
   */
  openAIToolToClaude(tool: OpenAIToolDefinition) {
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }
  }

  // ============ 请求构建 ============

  /**
   * 获取当前 provider 配置
   */
  private getProviderConfig(): ProviderConfig {
    return getProviderConfig(this.config.provider, this.config.apiKey, this.config.baseUrl)
  }

  /**
   * 构建 API 请求参数
   */
  buildRequestParams(
    messages: AgentMessage[],
    toolDefs: OpenAIToolDefinition[],
    withTools: boolean,
    options?: { stream?: boolean },
  ): {
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
  } {
    const { apiKey, baseUrl, model } = this.config
    const providerCfg = this.getProviderConfig()

    const url = resolveChatUrl(baseUrl || '', providerCfg.defaultChatUrl)
    const headers = providerCfg.buildHeaders(apiKey)

    const streamPayload = options?.stream ? { stream: true } : {}

    if (providerCfg.isClaudeFormat) {
      // Claude Messages API 格式
      const formattedMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => this.formatMessageForClaude(m))

      const toolsPayload = withTools && toolDefs.length > 0
        ? { tools: toolDefs.map(t => this.openAIToolToClaude(t)) }
        : {}

      const body: Record<string, unknown> = {
        model: model || providerCfg.defaultModel,
        max_tokens: 200,
        system: this.systemPrompt,
        messages: formattedMessages,
        ...toolsPayload,
        ...streamPayload,
      }

      return { url, headers, body }
    }

    // OpenAI / DeepSeek / Custom — OpenAI Chat Completions 格式
    const formattedMessages = messages.map(m => this.formatMessageForOpenAI(m))

    const toolsPayload = withTools && toolDefs.length > 0
      ? { tools: toolDefs, tool_choice: 'auto' as const }
      : {}

    const body: Record<string, unknown> = {
      model: model || providerCfg.defaultModel,
      messages: formattedMessages,
      max_tokens: 200,
      ...toolsPayload,
      ...streamPayload,
    }

    return { url, headers, body }
  }

  /**
   * 格式化消息（OpenAI 格式）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatMessageForOpenAI(m: AgentMessage): Record<string, any> {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id }
    }
    if (m.tool_calls) {
      return { role: 'assistant', content: m.content, tool_calls: m.tool_calls }
    }
    return { role: m.role, content: m.content }
  }

  /**
   * 格式化消息（Claude 格式）
   * Claude Messages API 使用 content blocks，tool_result 作为 user 消息
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatMessageForClaude(m: AgentMessage): Record<string, any> {
    if (m.role === 'tool') {
      // Claude: tool_result 是一个 user 角色的 content block
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: m.content,
        }],
      }
    }
    if (m.role === 'assistant' && m.tool_calls) {
      // Claude: assistant 消息中包含 tool_use blocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any[] = []
      if (m.content) {
        content.push({ type: 'text', text: m.content })
      }
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        })
      }
      return { role: 'assistant', content }
    }
    return { role: m.role, content: m.content }
  }

  // ============ 响应解析 ============

  /**
   * 解析 LLM API 响应
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseResponse(data: any): { content: string; toolCalls: RawToolCall[] } {
    const providerCfg = this.getProviderConfig()

    if (providerCfg.isClaudeFormat) {
      return this.parseClaudeResponse(data)
    }
    return this.parseOpenAIResponse(data)
  }

  /**
   * 解析 Claude 响应
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseClaudeResponse(data: any): { content: string; toolCalls: RawToolCall[] } {
    const toolCalls: RawToolCall[] = []
    let content = ''
    let toolIdCounter = 0

    for (const block of data.content) {
      if (block.type === 'text') {
        content += block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || `tool_${toolIdCounter++}`,
          name: block.name,
          arguments: block.input,
        })
      }
    }

    return { content, toolCalls }
  }

  /**
   * 解析 OpenAI / DeepSeek / Custom 响应
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOpenAIResponse(data: any): { content: string; toolCalls: RawToolCall[] } {
    const toolCalls: RawToolCall[] = []
    let toolIdCounter = 0

    const message = data.choices[0].message
    let content = message.content || ''

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id || `tool_${toolIdCounter++}`,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })
      }
    }

    // 解析 DeepSeek DSML 格式
    const dsmlResult = this.parseDSML(content)
    if (dsmlResult.toolCalls.length > 0) {
      toolCalls.push(...dsmlResult.toolCalls)
      content = dsmlResult.content
    }

    return { content, toolCalls }
  }

  // ============ API 调用 ============

  /**
   * 调用 LLM API（非流式）
   */
  async callLLM(
    messages: AgentMessage[],
    toolDefs: OpenAIToolDefinition[],
    withTools: boolean,
  ): Promise<{ content: string; toolCalls: RawToolCall[] }> {
    const { url, headers, body } = this.buildRequestParams(messages, toolDefs, withTools)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`API request failed: ${response.status} - ${JSON.stringify(errorData)}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as any
    console.log('[LLMClient] LLM Raw Response:', JSON.stringify(data, null, 2))

    return this.parseResponse(data)
  }

  /**
   * 调用 LLM API（流式）
   * 返回 AsyncGenerator，每次 yield 一个 StreamChunk
   */
  async *callLLMStream(
    messages: AgentMessage[],
    toolDefs: OpenAIToolDefinition[],
    withTools: boolean,
  ): AsyncGenerator<StreamChunk> {
    const { url, headers, body } = this.buildRequestParams(
      messages, toolDefs, withTools, { stream: true },
    )

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`API request failed: ${response.status} - ${JSON.stringify(errorData)}`)
    }

    if (!response.body) {
      throw new Error('Response body is null, streaming not supported')
    }

    const providerCfg = this.getProviderConfig()

    if (providerCfg.isClaudeFormat) {
      yield* this.parseClaudeStream(response.body)
    } else {
      yield* this.parseOpenAIStream(response.body)
    }
  }

  // ============ 连接测试（静态方法） ============

  /**
   * 测试 LLM API 连接
   * 支持所有 provider：OpenAI、Claude、DeepSeek、Custom
   */
  static async testConnection(config: LLMConfig): Promise<TestConnectionResult> {
    const { provider, apiKey, baseUrl } = config
    const startTime = Date.now()

    if (!apiKey) {
      return { success: false, message: '请先输入 API Key' }
    }

    if (provider === 'custom' && !baseUrl) {
      return { success: false, message: '自定义 API 需要填写 API 地址' }
    }

    const providerCfg = getProviderConfig(provider, apiKey, baseUrl)
    const headers = providerCfg.buildHeaders(apiKey)

    try {
      if (providerCfg.isClaudeFormat) {
        // Claude: 发送一个最小请求来验证 API Key
        const chatUrl = resolveChatUrl(baseUrl || '', providerCfg.defaultChatUrl)
        const response = await fetch(chatUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: config.model || providerCfg.defaultModel,
            max_tokens: 16,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        })

        const latencyMs = Date.now() - startTime

        if (response.ok) {
          return { success: true, message: '连接成功！', latencyMs }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorData = await response.json().catch(() => ({})) as any
        const errorMsg = errorData?.error?.message || `HTTP ${response.status}`
        return { success: false, message: `连接失败: ${errorMsg}`, latencyMs }
      }

      // OpenAI 兼容格式：先尝试 /models 端点
      const modelsUrl = resolveModelsUrl(baseUrl || '', providerCfg.defaultModelsUrl)

      // 移除 Content-Type（GET 请求不需要）
      const getHeaders = { ...headers }
      delete getHeaders['Content-Type']

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: getHeaders,
      })

      const latencyMs = Date.now() - startTime

      if (response.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await response.json().catch(() => ({})) as any
        const models = data?.data?.map((m: { id: string }) => m.id) as string[] | undefined
        return {
          success: true,
          message: models?.length ? `连接成功！可用模型: ${models.length} 个` : '连接成功！',
          models,
          latencyMs,
        }
      }

      // /models 失败时，尝试发送最小 chat 请求
      const chatUrl = resolveChatUrl(baseUrl || '', providerCfg.defaultChatUrl)
      const chatResponse = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model || providerCfg.defaultModel,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      })

      const chatLatencyMs = Date.now() - startTime

      if (chatResponse.ok) {
        return { success: true, message: '连接成功！', latencyMs: chatLatencyMs }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorData = await chatResponse.json().catch(() => ({})) as any
      const errorMsg = errorData?.error?.message || `HTTP ${chatResponse.status}`
      return { success: false, message: `连接失败: ${errorMsg}`, latencyMs: chatLatencyMs }
    } catch (error) {
      const latencyMs = Date.now() - startTime
      const msg = error instanceof Error ? error.message : String(error)

      // 提供更友好的错误信息
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        return { success: false, message: '网络错误，请检查网络连接或代理设置', latencyMs }
      }
      if (msg.includes('CORS')) {
        return { success: false, message: 'CORS 错误，可能需要通过后端代理访问', latencyMs }
      }
      return { success: false, message: `连接失败: ${msg}`, latencyMs }
    }
  }

  // ============ 流式解析 ============

  /**
   * 解析 OpenAI/DeepSeek/Custom SSE 流
   */
  private async *parseOpenAIStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parsed = JSON.parse(data) as any
            const delta = parsed.choices?.[0]?.delta
            if (!delta) continue

            // 文本内容
            if (delta.content) {
              fullContent += delta.content
              yield { type: 'text', content: delta.content }
            }

            // 工具调用
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: tc.id || `tool_${idx}`,
                    name: tc.function?.name || '',
                    arguments: '',
                  })
                  if (tc.function?.name) {
                    yield { type: 'tool_call_start', id: tc.id || `tool_${idx}`, name: tc.function.name }
                  }
                }
                const existing = toolCallsMap.get(idx)!
                if (tc.function?.name && !existing.name) {
                  existing.name = tc.function.name
                }
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments
                  yield { type: 'tool_call_delta', id: existing.id, arguments: tc.function.arguments }
                }
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // 解析完成的工具调用
    const toolCalls: RawToolCall[] = []
    for (const tc of toolCallsMap.values()) {
      if (tc.name) {
        try {
          toolCalls.push({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments ? JSON.parse(tc.arguments) : {},
          })
        } catch {
          toolCalls.push({
            id: tc.id,
            name: tc.name,
            arguments: {},
          })
        }
      }
    }

    // 解析 DSML 格式（同非流式）
    const dsmlResult = this.parseDSML(fullContent)
    if (dsmlResult.toolCalls.length > 0) {
      toolCalls.push(...dsmlResult.toolCalls)
      fullContent = dsmlResult.content
    }

    yield { type: 'done', content: fullContent, toolCalls }
  }

  /**
   * 解析 Claude SSE 流
   */
  private async *parseClaudeStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>()
    let currentBlockIndex = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6)
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const parsed = JSON.parse(data) as any

              switch (parsed.type) {
                case 'content_block_start':
                  if (parsed.content_block?.type === 'tool_use') {
                    const block = parsed.content_block
                    currentBlockIndex = parsed.index
                    toolCallsMap.set(currentBlockIndex, {
                      id: block.id || `tool_${currentBlockIndex}`,
                      name: block.name,
                      arguments: '',
                    })
                    yield { type: 'tool_call_start', id: block.id, name: block.name }
                  }
                  break

                case 'content_block_delta':
                  if (parsed.delta?.type === 'text_delta') {
                    fullContent += parsed.delta.text
                    yield { type: 'text', content: parsed.delta.text }
                  } else if (parsed.delta?.type === 'input_json_delta') {
                    const blockIdx = parsed.index ?? currentBlockIndex
                    const existing = toolCallsMap.get(blockIdx)
                    if (existing) {
                      existing.arguments += parsed.delta.partial_json
                      yield { type: 'tool_call_delta', id: existing.id, arguments: parsed.delta.partial_json }
                    }
                  }
                  break
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // 解析完成的工具调用
    const toolCalls: RawToolCall[] = []
    for (const tc of toolCallsMap.values()) {
      if (tc.name) {
        try {
          toolCalls.push({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments ? JSON.parse(tc.arguments) : {},
          })
        } catch {
          toolCalls.push({
            id: tc.id,
            name: tc.name,
            arguments: {},
          })
        }
      }
    }

    yield { type: 'done', content: fullContent, toolCalls }
  }

  // ============ 工具方法 ============

  /**
   * 解析 DSML 格式的工具调用（从文本内容中提取）
   */
  private parseDSML(content: string): { content: string; toolCalls: RawToolCall[] } {
    const toolCalls: RawToolCall[] = []
    let toolIdCounter = 0

    const dsmlPattern = /<｜DSML｜function_calls>([\s\S]*?)<\/｜DSML｜function_calls>/g
    const dsmlInvokePattern = /<｜DSML｜invoke name="([^"]+)">([\s\S]*?)<\/｜DSML｜invoke>/g
    const dsmlArgPattern1 = /<｜DSML｜function_arg name="([^"]+)">([^<]*)<\/｜DSML｜function_arg>/g
    const dsmlArgPattern2 = /<｜DSML｜parameter name="([^"]+)"[^>]*>([^<]*)<\/｜DSML｜parameter>/g

    let dsmlMatch
    while ((dsmlMatch = dsmlPattern.exec(content)) !== null) {
      const dsmlContent = dsmlMatch[1]
      let invokeMatch
      while ((invokeMatch = dsmlInvokePattern.exec(dsmlContent)) !== null) {
        const funcName = invokeMatch[1]
        const argsContent = invokeMatch[2]
        const args: Record<string, string> = {}

        let argMatch
        dsmlArgPattern1.lastIndex = 0
        while ((argMatch = dsmlArgPattern1.exec(argsContent)) !== null) {
          args[argMatch[1]] = argMatch[2]
        }

        dsmlArgPattern2.lastIndex = 0
        while ((argMatch = dsmlArgPattern2.exec(argsContent)) !== null) {
          args[argMatch[1]] = argMatch[2]
        }

        toolCalls.push({
          id: `dsml_${toolIdCounter++}`,
          name: funcName,
          arguments: args,
        })
      }
    }

    // 移除 DSML 标签
    const cleanedContent = content.replace(dsmlPattern, '').trim()

    return { content: cleanedContent, toolCalls }
  }
}
