# 时间表系统

DesktopFriends 的时间表（Timemap）系统让宠物拥有"时间感知"能力——它能自主创建和管理每日计划，在合适的时间主动与主人互动。

## 概念

时间表系统由两个核心模块组成：

- **时间表 (Timemap)** — 一个结构化的当天日程表，由 Agent 通过工具调用创建和管理
- **心跳 (Heartbeat)** — 一个每 60 秒运行一次的本地定时器，检查时间表并在到期时触发 Agent 执行

### 与 OpenClaw 心跳的区别

| | 时间表系统 (Timemap) | OpenClaw 心跳 |
|---|---|---|
| **运行位置** | 客户端（浏览器/App） | 服务端（中继服务器） |
| **目的** | Agent 自主管理的语义化日程 | 连接保活 / 在线检测 |
| **调度方式** | HH:mm 时间匹配（Agent 决定内容） | cron 定时器（固定间隔） |
| **LLM 消耗** | 仅在条目到期时才调用 LLM | 不涉及 LLM |
| **数据来源** | AI 自主创建 + 用户请求 | 系统自动生成 |
| **持久化** | localStorage（跨会话保留） | 内存中（服务重启丢失） |

简单来说：OpenClaw 的心跳是"服务器问客户端：你还在吗？"，而时间表是"宠物问自己：现在该做什么了？"

## 工作原理

```
┌─────────────────────────────────────────────────────┐
│  1. Agent 初始化后自动创建当天计划                      │
│     "09:00 跟主人说早上好"                             │
│     "12:00 提醒主人吃午饭"                             │
│     "18:00 问主人今天过得怎么样"                        │
└──────────┬──────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│  2. 心跳每 60 秒 tick 一次（纯本地，不消耗 Token）     │
│     比较当前时间 >= 条目时间？                          │
│     → 未到期：跳过                                     │
│     → 已到期：触发！                                   │
└──────────┬──────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│  3. 触发 Agent 执行                                    │
│     发送: "[时间表触发: 12:00] 提醒主人吃午饭"         │
│     → Agent 流式回复 → 显示聊天气泡                    │
│     → 条目标记为 done                                  │
└─────────────────────────────────────────────────────┘
```

## 使用方式

### 自动创建计划

Agent 初始化后，如果当天没有时间表条目，会自动创建几个计划。你无需手动操作。

### 对宠物说

你可以通过自然语言让宠物创建提醒：

- "下午3点提醒我喝水"
- "帮我在5点半设个提醒，该下班了"
- "每天早上9点跟我说早安"（使用 `daily` 重复模式）

宠物会调用 `addTimemapEntry` 工具创建对应条目。

### 查看/管理计划

你也可以直接询问宠物：

- "今天有什么计划？"（宠物调用 `viewTimemap`）
- "把下午2点的提醒改成3点"（宠物调用 `updateTimemapEntry`）
- "取消今天所有计划"（宠物调用 `clearTimemap`）

## 工具列表

Agent 拥有以下时间表工具：

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `viewTimemap` | 查看今天的时间表 | 无 |
| `addTimemapEntry` | 添加条目 | `time` (HH:mm), `action` (描述), `repeat?` (daily/once) |
| `updateTimemapEntry` | 修改条目 | `id`, `time?`, `action?` |
| `removeTimemapEntry` | 删除条目 | `id` |
| `clearTimemap` | 清空所有条目 | 无 |

## 数据格式

每条时间表条目包含：

```typescript
interface TimemapEntry {
  id: string          // 唯一标识
  time: string        // "HH:mm" 格式，如 "14:00"
  action: string      // 任务描述，如 "跟主人说下午好"
  status: 'pending' | 'triggered' | 'done' | 'skipped'
  repeat?: 'daily' | 'once'  // 默认 'once'
}
```

## 跨天行为

- 心跳每次 tick 会检查日期是否变更
- 如果跨天：
  - `repeat: 'daily'` 的条目会保留，状态重置为 `pending`
  - `repeat: 'once'` 的条目会被清除
  - Agent 可能会补充新的当天计划

## 持久化

时间表数据存储在 `localStorage`，key 为 `timemap-{宠物名}`。关闭应用后重新打开，时间表仍然存在。

## 技术细节

相关源码位置：

| 文件 | 说明 |
|------|------|
| `packages/shared/src/timemap.ts` | 类型定义 |
| `packages/core/src/tools/timemap.tools.ts` | 5 个工具定义 |
| `packages/core/src/composables/useTimemap.ts` | 数据管理 Composable |
| `packages/core/src/composables/useHeartbeat.ts` | 心跳调度器 |
| `packages/core/src/agent/prompts.ts` | 系统提示词中的时间表技能描述 |

## 下一步

- [AI 对话](/guide/ai-chat) - 配置 AI 服务
- [多设备联动](/guide/multiplayer) - 设置多宠物通信
