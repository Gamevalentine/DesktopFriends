/**
 * @Description 工具管理器
 * 负责工具初始化、格式转换、执行
 */
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { OpenAIToolDefinition } from './llmClient'
import {
  createLive2DTools,
  createWidgetTools,
  createCognitiveTools,
  createCommunicationTools,
  createTimemapTools,
  type LangChainTool,
} from '../tools'
import type { PetAgentConfig } from './PetAgent'

/**
 * 工具管理器
 */
export class ToolManager {
  private tools: LangChainTool[] = []
  private toolsMap: Map<string, StructuredToolInterface> = new Map()
  /** 原生 OpenAI 格式的工具定义 */
  private nativeToolDefs: OpenAIToolDefinition[] = []

  // 表情状态追踪（通过回调暴露）
  private currentExpression: string | null = null
  private expressionSetAt: number | null = null

  /**
   * 初始化工具集
   */
  initializeTools(config: PetAgentConfig) {
    const { analysisResult, motions, expressions, callbacks, widgetContext, p2pContext } = config
    this.tools = []
    this.toolsMap.clear()
    this.nativeToolDefs = []

    // Live2D 工具
    const live2dTools = createLive2DTools({
      analysisResult,
      motions,
      expressions,
      callbacks: {
        onPlayMotion: callbacks.onPlayMotion,
        onSetExpression: callbacks.onSetExpression,
        onResetExpression: callbacks.onResetExpression,
        onStateChange: (state) => {
          this.currentExpression = state.expression
          this.expressionSetAt = state.expressionSetAt
        },
      },
    })
    this.tools.push(...live2dTools)

    // 认知工具（需要外部传入状态回调）
    const cognitiveTools = createCognitiveTools({
      onThinking: callbacks.onThinking,
      onDecision: callbacks.onDecision,
    })
    this.tools.push(...cognitiveTools)

    // 小组件工具
    if (widgetContext) {
      this.tools.push(...createWidgetTools(widgetContext))
    }

    // 多宠物通信工具
    if (p2pContext) {
      this.tools.push(...createCommunicationTools(p2pContext))
    }

    // 时间表工具
    if (config.timemapContext) {
      this.tools.push(...createTimemapTools(config.timemapContext))
    }

    // 外部插件工具
    if (config.pluginTools?.length) {
      this.tools.push(...config.pluginTools)
    }

    // 构建工具映射
    for (const tool of this.tools) {
      this.toolsMap.set(tool.name, tool)
    }

    // 生成原生 OpenAI 格式的工具定义
    this.nativeToolDefs = this.tools.map(t => this.langchainToolToOpenAI(t))

    console.log('[ToolManager] Tools initialized:', this.nativeToolDefs.map(t => t.function.name))
  }

  /**
   * 将 LangChain tool 转换为原生 OpenAI function calling 格式
   */
  private langchainToolToOpenAI(tool: StructuredToolInterface): OpenAIToolDefinition {
    let parameters: OpenAIToolDefinition['function']['parameters'] = {
      type: 'object',
      properties: {},
      required: [],
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolAny = tool as any
      if (toolAny.schema && typeof toolAny.schema.shape === 'object') {
        const shape = toolAny.schema.shape
        const props: Record<string, unknown> = {}
        const required: string[] = []

        for (const [key, zodField] of Object.entries(shape)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const field = zodField as any
          const prop: Record<string, unknown> = {}

          // 解包 ZodOptional（兼容 Zod v3 和 v4）
          let innerField = field
          let isOptional = false
          const defType = field._def?.typeName || field._def?.type
          if (defType === 'ZodOptional' || defType === 'optional') {
            isOptional = true
            innerField = field._def.innerType
          }

          // 获取内部类型标识（兼容 Zod v3 和 v4）
          const innerType = innerField._def?.typeName || innerField._def?.type

          // 检查是否是 enum 类型
          if (innerType === 'ZodEnum' || innerType === 'enum') {
            prop.type = 'string'
            // Zod v4: field.options (数组); Zod v3: _def.values (数组)
            prop.enum = innerField.options || innerField._def?.values
              || (innerField._def?.entries ? Object.values(innerField._def.entries) : undefined)
          } else if (innerType === 'ZodString' || innerType === 'string') {
            prop.type = 'string'
          } else if (innerType === 'ZodBoolean' || innerType === 'boolean') {
            prop.type = 'boolean'
          } else if (innerType === 'ZodNumber' || innerType === 'number') {
            prop.type = 'number'
          } else {
            prop.type = 'string'
          }

          // 获取描述（Zod v4: field.description; Zod v3: _def.description）
          if (innerField.description) {
            prop.description = innerField.description
          } else if (innerField._def?.description) {
            prop.description = innerField._def.description
          }

          props[key] = prop

          if (!isOptional) {
            required.push(key)
          }
        }

        parameters = { type: 'object', properties: props, required }
      }
    } catch (e) {
      console.warn(`[ToolManager] Failed to convert tool schema for "${tool.name}":`, e)
    }

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    }
  }

  /**
   * 执行单个工具调用
   */
  async executeToolCall(toolCall: {
    name: string
    args: Record<string, unknown>
    id?: string
  }): Promise<string> {
    const tool = this.toolsMap.get(toolCall.name)
    if (!tool) {
      return `Error: Tool "${toolCall.name}" not found`
    }

    try {
      const result = await tool.invoke(toolCall.args)
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (error) {
      console.error(`Tool "${toolCall.name}" execution error:`, error)
      return `Error executing tool: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  /**
   * 获取原生 OpenAI 格式的工具定义
   */
  getToolDefs(): OpenAIToolDefinition[] {
    return this.nativeToolDefs
  }

  /**
   * 获取工具列表（名称+描述）
   */
  getTools() {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
    }))
  }

  /**
   * 获取当前表情状态
   */
  getExpressionState() {
    return {
      expression: this.currentExpression,
      setAt: this.expressionSetAt,
      durationSeconds: this.expressionSetAt
        ? Math.floor((Date.now() - this.expressionSetAt) / 1000)
        : null,
    }
  }
}
