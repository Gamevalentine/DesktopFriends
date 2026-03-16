/**
 * @Description 宠物 Agent 核心类
 * 编排层：组合 LLMClient + ToolManager 完成消息处理
 */
import type { StructuredToolInterface } from '@langchain/core/tools'

import { createPetSystemPrompt } from './prompts'
import { createAgentMemory, generateSessionId, type AgentMessage } from './memory'
import { LLMClient } from './llmClient'
import { ToolManager } from './toolManager'

import type { LLMConfig, PetInfo, TodoItem, WidgetContext, PetMessage } from '@desktopfriends/shared'
import type { TimemapToolContext } from '../tools/timemap.tools'

export interface PetAgentConfig {
  llmConfig: LLMConfig
  petName: string
  customPrompt?: string
  analysisResult?: import('../tools').ModelAnalysisResult
  motions?: string[]
  expressions?: string[]
  callbacks: {
    onPlayMotion: (name: string) => void
    onSetExpression: (name: string) => void
    onResetExpression: () => void
    onThinking: (thought: string) => void
    onDecision: (shouldReply: boolean, reason: string) => void
  }
  widgetContext?: {
    getTodos: () => TodoItem[]
    addTodo: (text: string) => TodoItem
    completeTodo: (id: string) => boolean
    getWidgetContexts: () => WidgetContext[]
  }
  p2pContext?: {
    getOnlinePets: () => PetInfo[]
    getRecentMessages: () => PetMessage[]
    sendMessageToPet: (targetId: string, content: string) => void
    broadcastMessage: (content: string) => void
  }
  timemapContext?: TimemapToolContext
  pluginTools?: StructuredToolInterface[]
  maxIterations?: number
}

export interface AgentResponse {
  content: string | null
  thinking: string | null
  toolCalls: Array<{
    name: string
    arguments: Record<string, unknown>
    result?: string
  }>
  shouldReply: boolean
}

/** 流式事件类型 */
export type AgentStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; result: string }
  | { type: 'thinking'; content: string }
  | { type: 'done'; response: AgentResponse }

/**
 * 宠物 Agent 核心类
 * 编排 LLMClient + ToolManager
 */
export class PetAgent {
  private llmClient: LLMClient
  private toolManager: ToolManager
  private memoryManager: ReturnType<typeof createAgentMemory>
  private config: PetAgentConfig
  private sessionId: string
  private systemPrompt: string = ''

  // 状态追踪
  private lastThinking: string | null = null
  private lastDecision: { shouldReply: boolean; reason: string } | null = null
  private toolCallResults: Array<{ name: string; arguments: Record<string, unknown>; result?: string }> = []

  constructor(config: PetAgentConfig) {
    this.config = config
    this.llmClient = new LLMClient(config.llmConfig)
    this.toolManager = new ToolManager()
    this.memoryManager = createAgentMemory({
      persistKey: `pet-agent-${config.petName}`,
    })
    this.sessionId = generateSessionId()

    // 包装认知工具回调以追踪状态
    const originalOnThinking = config.callbacks.onThinking
    const originalOnDecision = config.callbacks.onDecision
    config.callbacks.onThinking = (thought: string) => {
      this.lastThinking = thought
      originalOnThinking(thought)
    }
    config.callbacks.onDecision = (shouldReply: boolean, reason: string) => {
      this.lastDecision = { shouldReply, reason }
      originalOnDecision(shouldReply, reason)
    }

    this.toolManager.initializeTools(config)
  }

  /**
   * 初始化 Agent（设置系统提示词）
   */
  async initialize() {
    const { petName, customPrompt, widgetContext, timemapContext } = this.config

    let widgetContextStr = ''
    if (widgetContext) {
      const contexts = widgetContext.getWidgetContexts()
      widgetContextStr = contexts.map((c) => `- ${c.type}: ${c.summary}`).join('\n')
    }

    let timemapContextStr = ''
    if (timemapContext) {
      const tm = timemapContext.getTimemap()
      const pending = tm.entries.filter(e => e.status === 'pending')
      if (pending.length > 0) {
        timemapContextStr = pending.map(e => `- ${e.time} ${e.action} (${e.repeat === 'daily' ? '每天' : '仅今天'})`).join('\n')
      } else {
        timemapContextStr = '今天暂无计划'
      }
    }

    this.systemPrompt = createPetSystemPrompt({
      petName,
      customPrompt,
      widgetContext: widgetContextStr,
      timemapContext: timemapContextStr || undefined,
    })
    this.llmClient.setSystemPrompt(this.systemPrompt)
  }

  /**
   * 刷新系统提示（包含最新状态）
   */
  private refreshSystemPrompt() {
    const { petName, customPrompt, widgetContext, timemapContext } = this.config

    let widgetContextStr = ''
    if (widgetContext) {
      const contexts = widgetContext.getWidgetContexts()
      widgetContextStr = contexts.map((c) => `- ${c.type}: ${c.summary}`).join('\n')
    }

    let timemapContextStr = ''
    if (timemapContext) {
      const tm = timemapContext.getTimemap()
      const pending = tm.entries.filter(e => e.status === 'pending')
      if (pending.length > 0) {
        timemapContextStr = pending.map(e => `- ${e.time} ${e.action} (${e.repeat === 'daily' ? '每天' : '仅今天'})`).join('\n')
      } else {
        timemapContextStr = '今天暂无计划'
      }
    }

    const expressionState = this.toolManager.getExpressionState()

    this.systemPrompt = createPetSystemPrompt({
      petName,
      customPrompt,
      widgetContext: widgetContextStr,
      expressionState: expressionState.expression
        ? {
          expression: expressionState.expression,
          durationSeconds: expressionState.durationSeconds,
        }
        : undefined,
      timemapContext: timemapContextStr || undefined,
    })
    this.llmClient.setSystemPrompt(this.systemPrompt)
  }

  /**
   * 执行工具调用循环
   */
  private async executeToolCallLoop(
    initialMessages: AgentMessage[],
    maxIterations: number = 5,
  ): Promise<{
    content: string
    allToolCalls: Array<{ name: string; arguments: Record<string, unknown>; result?: string }>
  }> {
    let currentMessages = [...initialMessages]
    const allToolCalls: Array<{ name: string; arguments: Record<string, unknown>; result?: string }> = []
    let iterations = 0
    let lastContent = ''
    const toolDefs = this.toolManager.getToolDefs()

    while (iterations < maxIterations) {
      iterations++

      const { content, toolCalls } = await this.llmClient.callLLM(currentMessages, toolDefs, true)
      lastContent = content

      console.log('[PetAgent] LLM response:', {
        iteration: iterations,
        contentPreview: content.substring(0, 80),
        toolCallCount: toolCalls.length,
        toolCallNames: toolCalls.map(tc => tc.name),
      })

      if (toolCalls.length === 0) {
        return { content, allToolCalls }
      }

      // 将 AI 响应（含 tool_calls）添加到消息
      const assistantMsg: AgentMessage = {
        role: 'assistant',
        content: content,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      }
      currentMessages.push(assistantMsg)

      // 执行所有工具调用并添加 tool 消息
      for (const toolCall of toolCalls) {
        console.log('[PetAgent] Executing tool:', toolCall.name, toolCall.arguments)
        const result = await this.toolManager.executeToolCall({
          name: toolCall.name,
          args: toolCall.arguments,
          id: toolCall.id,
        })

        allToolCalls.push({
          name: toolCall.name,
          arguments: toolCall.arguments,
          result,
        })

        currentMessages.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
        })
      }
    }

    // 达到最大迭代次数，最后一次不带 tools 获取文字回复
    const { content: finalContent } = await this.llmClient.callLLM(currentMessages, toolDefs, false)
    return { content: finalContent || lastContent, allToolCalls }
  }

  /**
   * 处理最终内容（提取 thinking、no-answer 等）
   */
  private processContent(content: string): {
    finalContent: string
    thinking: string | null
    shouldReply: boolean
  } {
    let finalContent = content
    let thinking = this.lastThinking

    // 检查是否选择不回复
    const decision = this.lastDecision as { shouldReply: boolean; reason: string } | null
    let shouldReply = decision?.shouldReply ?? true

    // 检查 <no-answer> 标签
    if (finalContent?.includes('<no-answer>')) {
      shouldReply = false
      finalContent = ''
    }

    // 提取 <thinking> 标签内容
    const thinkingMatch = finalContent?.match(/<thinking>([\s\S]*?)<\/thinking>/)
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim()
      finalContent = finalContent.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()
    }

    return { finalContent, thinking, shouldReply }
  }

  // ============ 公开方法 ============

  /**
   * 发送消息并获取回复（非流式）
   */
  async sendMessage(content: string): Promise<AgentResponse> {
    if (!this.systemPrompt) {
      await this.initialize()
    }

    // 重置状态
    this.lastThinking = null
    this.lastDecision = null
    this.toolCallResults = []

    // 刷新系统提示
    this.refreshSystemPrompt()

    try {
      // 构建消息列表
      const messages: AgentMessage[] = [
        { role: 'system', content: this.systemPrompt },
        ...this.memoryManager.getMessages(),
        { role: 'user', content },
      ]

      // 保存用户消息到记忆
      this.memoryManager.addUserMessage(content)

      // 执行工具调用循环
      const { content: responseContent, allToolCalls } = await this.executeToolCallLoop(
        messages,
        this.config.maxIterations || 5,
      )

      this.toolCallResults = allToolCalls

      const { finalContent, thinking, shouldReply } = this.processContent(responseContent)

      // 保存 AI 回复到记忆
      if (finalContent) {
        this.memoryManager.addAIMessage(finalContent)
      }

      return {
        content: shouldReply && finalContent ? finalContent : null,
        thinking,
        toolCalls: this.toolCallResults,
        shouldReply,
      }
    } catch (error) {
      console.error('Agent execution error:', error)
      throw error
    }
  }

  /**
   * 发送消息（流式）
   * 所有 LLM 调用都使用流式，文本逐字输出，工具调用收集完后执行
   */
  async *sendMessageStream(content: string): AsyncGenerator<AgentStreamEvent> {
    if (!this.systemPrompt) {
      await this.initialize()
    }

    // 重置状态
    this.lastThinking = null
    this.lastDecision = null
    this.toolCallResults = []

    // 刷新系统提示
    this.refreshSystemPrompt()

    try {
      // 构建消息列表
      const messages: AgentMessage[] = [
        { role: 'system', content: this.systemPrompt },
        ...this.memoryManager.getMessages(),
        { role: 'user', content },
      ]

      // 保存用户消息到记忆
      this.memoryManager.addUserMessage(content)

      const toolDefs = this.toolManager.getToolDefs()
      const maxIterations = this.config.maxIterations || 5
      let currentMessages = [...messages]
      const allToolCalls: Array<{ name: string; arguments: Record<string, unknown>; result?: string }> = []
      let iterations = 0

      while (iterations < maxIterations) {
        iterations++
        const withTools = iterations < maxIterations // 最后一轮不带工具

        // 使用流式调用
        let streamContent = ''
        let streamToolCalls: import('./llmClient').RawToolCall[] = []

        const stream = this.llmClient.callLLMStream(currentMessages, toolDefs, withTools)
        for await (const chunk of stream) {
          switch (chunk.type) {
            case 'text':
              streamContent += chunk.content
              // 实时输出文本 delta
              yield { type: 'text_delta', content: chunk.content }
              break
            case 'tool_call_start':
              yield { type: 'tool_start', name: chunk.name }
              break
            case 'done':
              streamContent = chunk.content || streamContent
              streamToolCalls = chunk.toolCalls
              break
          }
        }

        console.log('[PetAgent] Stream response:', {
          iteration: iterations,
          contentPreview: streamContent.substring(0, 80),
          toolCallCount: streamToolCalls.length,
          toolCallNames: streamToolCalls.map(tc => tc.name),
        })

        if (streamToolCalls.length === 0) {
          // 没有工具调用，这是最终回复
          this.toolCallResults = allToolCalls
          const { finalContent, thinking, shouldReply } = this.processContent(streamContent)

          if (thinking) {
            yield { type: 'thinking', content: thinking }
          }

          if (finalContent) {
            this.memoryManager.addAIMessage(finalContent)
          }

          yield {
            type: 'done',
            response: {
              content: shouldReply && finalContent ? finalContent : null,
              thinking,
              toolCalls: allToolCalls,
              shouldReply,
            },
          }
          return
        }

        // 有工具调用 - 将 AI 响应添加到消息
        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: streamContent,
          tool_calls: streamToolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        }
        currentMessages.push(assistantMsg)

        // 执行所有工具调用
        for (const toolCall of streamToolCalls) {
          console.log('[PetAgent] Executing tool:', toolCall.name, toolCall.arguments)

          const result = await this.toolManager.executeToolCall({
            name: toolCall.name,
            args: toolCall.arguments,
            id: toolCall.id,
          })

          allToolCalls.push({
            name: toolCall.name,
            arguments: toolCall.arguments,
            result,
          })

          yield { type: 'tool_end', name: toolCall.name, result }

          currentMessages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          })
        }
      }

      // 达到最大迭代次数，最终回复（流式，不带工具）
      this.toolCallResults = allToolCalls
      let fullContent = ''

      const finalStream = this.llmClient.callLLMStream(currentMessages, toolDefs, false)
      for await (const chunk of finalStream) {
        if (chunk.type === 'text') {
          fullContent += chunk.content
          yield { type: 'text_delta', content: chunk.content }
        } else if (chunk.type === 'done') {
          fullContent = chunk.content || fullContent
        }
      }

      const { finalContent, thinking, shouldReply } = this.processContent(fullContent)

      if (thinking) {
        yield { type: 'thinking', content: thinking }
      }

      if (finalContent) {
        this.memoryManager.addAIMessage(finalContent)
      }

      yield {
        type: 'done',
        response: {
          content: shouldReply && finalContent ? finalContent : null,
          thinking,
          toolCalls: allToolCalls,
          shouldReply,
        },
      }
    } catch (error) {
      console.error('Agent stream execution error:', error)
      throw error
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(newConfig: Partial<PetAgentConfig>) {
    Object.assign(this.config, newConfig)

    if (newConfig.llmConfig) {
      this.llmClient.updateConfig(newConfig.llmConfig)
    }

    const toolsChanged = !!(newConfig.analysisResult || newConfig.motions || newConfig.expressions || newConfig.callbacks || newConfig.widgetContext || newConfig.p2pContext || newConfig.timemapContext || newConfig.pluginTools)

    if (toolsChanged) {
      this.toolManager.initializeTools(this.config)
    }
  }

  /**
   * 清空对话历史
   */
  clearHistory() {
    this.memoryManager.clearHistory()
    this.sessionId = generateSessionId()
  }

  /**
   * 获取当前工具列表
   */
  getTools() {
    return this.toolManager.getTools()
  }

  /**
   * 获取当前表情状态
   */
  getExpressionState() {
    return this.toolManager.getExpressionState()
  }
}
