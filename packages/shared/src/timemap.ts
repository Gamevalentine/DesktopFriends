/**
 * 时间表 (Timemap) 类型定义
 * 用于宠物 Agent 的定时任务系统
 */

/** 时间表条目状态 */
export type TimemapEntryStatus = 'pending' | 'triggered' | 'done' | 'skipped'

/** 重复模式 */
export type TimemapRepeat = 'daily' | 'once'

/** 单条时间表条目 */
export interface TimemapEntry {
  /** 唯一标识，如 "tm_1710000000_abc" */
  id: string
  /** 触发时间，HH:mm 格式，如 "14:00" */
  time: string
  /** Agent 需要执行的任务描述（自然语言） */
  action: string
  /** 执行状态 */
  status: TimemapEntryStatus
  /** 创建时间戳 */
  createdAt: number
  /** 触发时间戳 */
  triggeredAt?: number
  /** 重复模式，默认 'once'（当天有效） */
  repeat?: TimemapRepeat
}

/** 时间表 */
export interface Timemap {
  /** 所属日期，YYYY-MM-DD 格式 */
  date: string
  /** 条目列表 */
  entries: TimemapEntry[]
  /** 最后一次心跳时间戳 */
  lastHeartbeat?: number
}
