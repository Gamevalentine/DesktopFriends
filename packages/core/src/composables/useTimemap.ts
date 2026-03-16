/**
 * @Description 时间表数据管理 Composable
 * 负责时间表的 CRUD 操作和 localStorage 持久化
 */
import { ref, computed, watch } from 'vue'
import type { Timemap, TimemapEntry, TimemapRepeat } from '@desktopfriends/shared'
import type { TimemapToolContext } from '../tools/timemap.tools'

/** 获取今天的日期字符串 YYYY-MM-DD */
function todayStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`
}

/** 生成唯一 ID */
function generateId(): string {
  return `tm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 时间表管理 Composable
 */
export function useTimemap(petName: string) {
  const storageKey = `timemap-${petName}`

  // 从 localStorage 加载
  const loadTimemap = (): Timemap => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        return JSON.parse(raw) as Timemap
      }
    } catch (e) {
      console.warn('[useTimemap] Failed to load from localStorage:', e)
    }
    return { date: todayStr(), entries: [] }
  }

  const timemap = ref<Timemap>(loadTimemap())

  // 跨天检查与重置
  const checkAndResetDate = () => {
    const today = todayStr()
    if (timemap.value.date !== today) {
      console.log('[useTimemap] Date changed, resetting timemap')
      // 保留 daily 条目，重置状态
      const dailyEntries = timemap.value.entries
        .filter(e => e.repeat === 'daily')
        .map(e => ({
          ...e,
          status: 'pending' as const,
          triggeredAt: undefined,
        }))
      timemap.value = {
        date: today,
        entries: dailyEntries,
      }
    }
  }

  // 初始化时检查日期
  checkAndResetDate()

  // 自动持久化
  watch(
    timemap,
    (val) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(val))
      } catch (e) {
        console.warn('[useTimemap] Failed to save to localStorage:', e)
      }
    },
    { deep: true },
  )

  // Computed: 当天条目
  const entries = computed(() => timemap.value.entries)

  // Computed: 未执行条目
  const pendingEntries = computed(() =>
    timemap.value.entries.filter(e => e.status === 'pending'),
  )

  // CRUD 方法
  const addEntry = (time: string, action: string, repeat?: TimemapRepeat): TimemapEntry => {
    const entry: TimemapEntry = {
      id: generateId(),
      time,
      action,
      status: 'pending',
      createdAt: Date.now(),
      repeat: repeat || 'once',
    }
    timemap.value.entries.push(entry)
    // 按时间排序
    timemap.value.entries.sort((a, b) => a.time.localeCompare(b.time))
    return entry
  }

  const updateEntry = (
    id: string,
    updates: Partial<Pick<TimemapEntry, 'time' | 'action'>>,
  ): TimemapEntry | null => {
    const entry = timemap.value.entries.find(e => e.id === id)
    if (!entry) return null
    if (updates.time) entry.time = updates.time
    if (updates.action) entry.action = updates.action
    // 重新排序
    timemap.value.entries.sort((a, b) => a.time.localeCompare(b.time))
    return entry
  }

  const removeEntry = (id: string): boolean => {
    const index = timemap.value.entries.findIndex(e => e.id === id)
    if (index === -1) return false
    timemap.value.entries.splice(index, 1)
    return true
  }

  const clearEntries = () => {
    timemap.value.entries = []
  }

  // 状态标记
  const markTriggered = (id: string) => {
    const entry = timemap.value.entries.find(e => e.id === id)
    if (entry) {
      entry.status = 'triggered'
      entry.triggeredAt = Date.now()
    }
  }

  const markDone = (id: string) => {
    const entry = timemap.value.entries.find(e => e.id === id)
    if (entry) {
      entry.status = 'done'
    }
  }

  // 获取时间表摘要（供系统提示词使用）
  const getTimemapSummary = (): string => {
    const pending = pendingEntries.value
    if (pending.length === 0) {
      return '今天暂无计划'
    }
    const lines = pending.map(e => `- ${e.time} ${e.action} (${e.repeat === 'daily' ? '每天' : '仅今天'})`)
    return `今天的待执行计划:\n${lines.join('\n')}`
  }

  // 获取完整时间表数据
  const getTimemap = (): Timemap => timemap.value

  // 导出为 TimemapToolContext
  const toToolContext = (): TimemapToolContext => ({
    getTimemap,
    addEntry,
    updateEntry,
    removeEntry,
    clearEntries,
  })

  return {
    timemap,
    entries,
    pendingEntries,
    addEntry,
    updateEntry,
    removeEntry,
    clearEntries,
    markTriggered,
    markDone,
    checkAndResetDate,
    getTimemapSummary,
    getTimemap,
    toToolContext,
  }
}
