/**
 * @Description 时间表 (Timemap) 工具定义
 * 使用 @langchain/core 的 tool() 函数（浏览器兼容）
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Timemap, TimemapEntry, TimemapRepeat } from '@desktopfriends/shared'

/**
 * 时间表工具上下文接口
 */
export interface TimemapToolContext {
  getTimemap: () => Timemap
  addEntry: (time: string, action: string, repeat?: TimemapRepeat) => TimemapEntry
  updateEntry: (id: string, updates: Partial<Pick<TimemapEntry, 'time' | 'action'>>) => TimemapEntry | null
  removeEntry: (id: string) => boolean
  clearEntries: () => void
}

/**
 * 创建时间表相关工具
 */
export function createTimemapTools(context: TimemapToolContext) {
  const viewTimemapTool = tool(
    async () => {
      const timemap = context.getTimemap()
      const now = new Date()
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      return JSON.stringify({
        date: timemap.date,
        currentTime,
        totalEntries: timemap.entries.length,
        entries: timemap.entries.map(e => ({
          id: e.id,
          time: e.time,
          action: e.action,
          status: e.status,
          repeat: e.repeat || 'once',
        })),
      })
    },
    {
      name: 'viewTimemap',
      description: '查看今天的时间表计划，包括所有条目及其状态',
      schema: z.object({}),
    },
  )

  const addTimemapEntryTool = tool(
    async ({ time, action, repeat }) => {
      // 验证时间格式
      if (!/^\d{2}:\d{2}$/.test(time)) {
        return JSON.stringify({ success: false, error: '时间格式错误，请使用 HH:mm 格式（如 14:00）' })
      }
      const [hours, minutes] = time.split(':').map(Number)
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return JSON.stringify({ success: false, error: '时间范围无效' })
      }

      const entry = context.addEntry(time, action, repeat as TimemapRepeat | undefined)
      return JSON.stringify({
        success: true,
        entry: {
          id: entry.id,
          time: entry.time,
          action: entry.action,
          repeat: entry.repeat || 'once',
        },
      })
    },
    {
      name: 'addTimemapEntry',
      description: '添加一条时间表计划。时间格式为 HH:mm（如 "09:00" 表示上午9点，"14:30" 表示下午2点30分）',
      schema: z.object({
        time: z.string().describe('触发时间，HH:mm 格式（如 "14:00"）'),
        action: z.string().describe('需要执行的任务描述（如 "跟主人说下午好"）'),
        repeat: z.string().optional().describe('重复模式："daily"（每天重复）或 "once"（仅当天，默认）'),
      }),
    },
  )

  const updateTimemapEntryTool = tool(
    async ({ id, time, action }) => {
      if (time && !/^\d{2}:\d{2}$/.test(time)) {
        return JSON.stringify({ success: false, error: '时间格式错误，请使用 HH:mm 格式' })
      }

      const updates: Partial<Pick<TimemapEntry, 'time' | 'action'>> = {}
      if (time) updates.time = time
      if (action) updates.action = action

      const entry = context.updateEntry(id, updates)
      if (!entry) {
        return JSON.stringify({ success: false, error: `未找到 ID 为 "${id}" 的条目` })
      }
      return JSON.stringify({
        success: true,
        entry: {
          id: entry.id,
          time: entry.time,
          action: entry.action,
        },
      })
    },
    {
      name: 'updateTimemapEntry',
      description: '修改已有的时间表条目的时间或任务描述',
      schema: z.object({
        id: z.string().describe('要修改的条目 ID'),
        time: z.string().optional().describe('新的触发时间，HH:mm 格式'),
        action: z.string().optional().describe('新的任务描述'),
      }),
    },
  )

  const removeTimemapEntryTool = tool(
    async ({ id }) => {
      const success = context.removeEntry(id)
      return JSON.stringify({
        success,
        message: success ? `已删除条目 ${id}` : `未找到 ID 为 "${id}" 的条目`,
      })
    },
    {
      name: 'removeTimemapEntry',
      description: '删除一条时间表计划',
      schema: z.object({
        id: z.string().describe('要删除的条目 ID'),
      }),
    },
  )

  const clearTimemapTool = tool(
    async () => {
      context.clearEntries()
      return JSON.stringify({ success: true, message: '已清空今天的时间表' })
    },
    {
      name: 'clearTimemap',
      description: '清空今天的所有时间表计划',
      schema: z.object({}),
    },
  )

  return [
    viewTimemapTool,
    addTimemapEntryTool,
    updateTimemapEntryTool,
    removeTimemapEntryTool,
    clearTimemapTool,
  ]
}
