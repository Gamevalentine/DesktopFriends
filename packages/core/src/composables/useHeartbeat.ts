/**
 * @Description 心跳调度器 Composable
 * 纯本地定时器，周期性检查时间表并在到期时触发回调
 */
import { ref, onUnmounted } from 'vue'
import type { Timemap, TimemapEntry } from '@desktopfriends/shared'

export interface HeartbeatOptions {
  /** 心跳间隔（毫秒），默认 60000 (1分钟) */
  intervalMs?: number
  /** 条目到期时的触发回调 */
  onTrigger: (entry: TimemapEntry) => Promise<void>
  /** 获取当前时间表数据 */
  getTimemap: () => Timemap
  /** 标记条目为已触发 */
  markTriggered: (id: string) => void
  /** 检查并重置跨天日期 */
  checkAndResetDate: () => void
}

/** 获取当前 HH:mm 格式时间 */
function getCurrentHHmm(): string {
  const now = new Date()
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
}

/**
 * 心跳调度器
 * - 每分钟检查时间表是否有到期条目
 * - 到期时调用 onTrigger 回调（异步队列，避免并发）
 * - 不直接调用 LLM，触发逻辑由上层处理
 */
export function useHeartbeat(options: HeartbeatOptions) {
  const {
    intervalMs = 60000,
    onTrigger,
    getTimemap,
    markTriggered,
    checkAndResetDate,
  } = options

  const isRunning = ref(false)
  let intervalId: ReturnType<typeof setInterval> | null = null
  let isProcessing = false

  /**
   * 单次心跳 tick
   * 检查时间表中是否有到期的 pending 条目
   */
  const tick = async () => {
    // 避免并发处理
    if (isProcessing) return
    isProcessing = true

    try {
      // 检查跨天
      checkAndResetDate()

      const timemap = getTimemap()
      const currentTime = getCurrentHHmm()

      // 收集所有到期的 pending 条目
      const dueEntries = timemap.entries.filter(
        e => e.status === 'pending' && e.time <= currentTime,
      )

      // 顺序处理，避免并发 LLM 调用
      for (const entry of dueEntries) {
        markTriggered(entry.id)
        try {
          await onTrigger(entry)
        } catch (e) {
          console.error(`[useHeartbeat] Failed to trigger entry ${entry.id}:`, e)
        }
      }

      // 更新最后心跳时间
      timemap.lastHeartbeat = Date.now()
    } finally {
      isProcessing = false
    }
  }

  const start = () => {
    if (isRunning.value) return
    isRunning.value = true
    // 启动时立即执行一次
    tick()
    intervalId = setInterval(tick, intervalMs)
    console.log(`[useHeartbeat] Started with interval ${intervalMs}ms`)
  }

  const stop = () => {
    if (!isRunning.value) return
    isRunning.value = false
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    console.log('[useHeartbeat] Stopped')
  }

  // 组件卸载自动清理
  onUnmounted(stop)

  return {
    isRunning,
    start,
    stop,
    tick,
  }
}
