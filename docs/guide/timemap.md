# 时间表系统

DesktopFriends 的时间表（Timemap）系统让宠物拥有“时间感知”能力：它可以理解自然语言中的时间与任务，管理当天计划，并在到期后主动执行，而不必等待主人再次发送消息。

::: tip 核心区别
普通聊天解决“主人说了什么，我该怎么回答”；时间表进一步解决“今天什么时候，我应该主动做什么”。
:::

## 为什么需要时间表

固定闹钟只能播放预设内容，时间表保存的则是语义化任务，例如“提醒主人休息一下”或“用开心的方式说早安”。任务到期后仍由 PetAgent 结合角色人设、上下文、表情和动作能力完成最终表达。

| 能力 | 普通定时器 | DesktopFriends 时间表 |
|---|---|---|
| 任务内容 | 预先写死 | 自然语言描述，由 Agent 理解 |
| 创建方式 | 用户手动配置 | 用户请求或 Agent 自主规划 |
| 时间检查 | 本地 | 本地，每 60 秒一次 |
| LLM 消耗 | 不适用 | 检查不消耗 Token，到期执行才调用 LLM |
| 角色表现 | 固定提示音或文本 | 结合宠物人设、对话、动作与表情 |
| 重复规则 | 依具体实现 | `once` 与 `daily` |

## 系统组成

时间表由四个部分协作完成：

- **Timemap 状态**：保存日期、条目、执行状态和最后心跳时间。
- **Agent 工具**：允许 PetAgent 查看、新增、修改、删除和清空计划。
- **本地心跳**：按分钟检查到期条目，不直接请求 LLM。
- **触发执行器**：把到期任务重新交给 Agent，并以流式聊天气泡展示结果。

```text
用户提醒 / Agent 自主计划
          │
          ▼
  addTimemapEntry 工具
          │
          ▼
 localStorage 持久化 ──── 跨天时保留 daily、清理 once
          │
          ▼
  60 秒本地心跳检查
          │ 未到期：不调用 LLM
          │ 到期
          ▼
  标记 triggered → 唤醒 PetAgent → 流式执行 → 标记 done
```

## 当前平台状态

时间表的数据模型、Agent 工具和心跳调度器位于共享核心包中。当前 **Android 端**已经接入完整的自动建表与到期执行流程。

应用需要保持运行，心跳才能持续工作。Android 后台保活（Foreground Service）仍在开发中，因此应用被系统挂起或彻底关闭时，不应把时间表当作系统级闹钟使用；重新回到应用后，下一次心跳会检查已经到期但仍为 `pending` 的条目。

## 使用方式

### 让宠物设置提醒

直接用自然语言提出要求：

- “下午 3 点提醒我喝水。”
- “17:30 提醒我该下班了。”
- “每天上午 9 点跟我说早安。”

宠物会把时间标准化为 `HH:mm`，并调用 `addTimemapEntry`。未指定重复规则时默认为 `once`；“每天”这类请求会使用 `daily`。

### 查看和调整计划

- “今天有什么计划？”
- “把下午 2 点的提醒改到 3 点。”
- “取消刚才的喝水提醒。”
- “清空今天的所有计划。”

涉及修改或删除时，Agent 会先读取时间表获得条目 ID，再调用相应工具。

### Agent 自主规划

Android 端第一次初始化 Agent 后，如果当天没有任何时间表条目，会发送一条内部系统请求，让宠物为当天剩余时间安排几个问候或休息提示。如果已经存在条目，则不会覆盖现有计划。

## Agent 工具

| 工具名 | 作用 | 主要参数 |
|---|---|---|
| `viewTimemap` | 查看日期、当前时间和所有条目状态 | 无 |
| `addTimemapEntry` | 创建计划 | `time`, `action`, `repeat?` |
| `updateTimemapEntry` | 修改触发时间或任务描述 | `id`, `time?`, `action?` |
| `removeTimemapEntry` | 删除指定计划 | `id` |
| `clearTimemap` | 清空当天全部计划 | 无 |

时间使用 24 小时制 `HH:mm`，例如 `09:00`、`14:30`。当前调度精度为分钟。

## 条目与生命周期

```typescript
interface TimemapEntry {
  id: string
  time: string
  action: string
  status: 'pending' | 'triggered' | 'done' | 'skipped'
  createdAt: number
  triggeredAt?: number
  repeat?: 'daily' | 'once'
}
```

正常执行路径为：

```text
pending → triggered → done
```

- `pending`：等待到期。
- `triggered`：心跳已取出，正在交给 Agent 处理。
- `done`：本次任务处理结束。
- `skipped`：为跳过场景预留的状态。

## 心跳与跨天规则

心跳启动时会立即检查一次，之后每 60 秒检查：

1. 日期是否变化；
2. 是否存在 `status === 'pending'` 且 `time <= 当前时间` 的条目；
3. 将全部到期条目按顺序交给 Agent，避免同时发起多个 LLM 请求；
4. 更新 `lastHeartbeat`。

跨天时：

- `daily` 条目保留并重置为 `pending`；
- `once` 条目清理；
- 时间表日期更新为当天。

因此，即使某次检查略晚于设定分钟，只要条目仍是 `pending`，后续心跳仍会发现它。

## 持久化与隔离

数据保存在浏览器 `localStorage`，键名为 `timemap-{宠物名}`。不同名字的宠物拥有独立时间表；关闭并重新打开应用后，计划仍然存在。

时间表只保存在当前设备，不会通过局域网中继服务器同步到其他设备。

## 使用建议

- 适合问候、喝水、休息、会议准备等陪伴型提醒。
- 不适合必须准点且不能遗漏的服药、航班或系统闹钟场景。
- 创建计划前明确说出时间和是否每天重复，Agent 更容易生成正确条目。
- 如果提醒没有触发，先确认应用仍在运行、AI 配置有效，并询问宠物“今天有什么计划”。

## 相关源码

| 文件 | 说明 |
|---|---|
| `packages/shared/src/timemap.ts` | 时间表与条目类型 |
| `packages/core/src/composables/useTimemap.ts` | CRUD、排序、跨天处理和持久化 |
| `packages/core/src/tools/timemap.tools.ts` | 五个 Agent 工具 |
| `packages/core/src/composables/useHeartbeat.ts` | 本地心跳和顺序触发 |
| `packages/core/src/agent/prompts.ts` | 时间表能力提示词 |
| `apps/mobile/src/views/HomeView.vue` | Android 端初始化与到期执行接入 |

## 下一步

- [快速开始](/guide/getting-started) - 创建第一条提醒
- [AI 对话](/guide/ai-chat) - 配置支持工具调用的模型
- [多设备联动](/guide/multiplayer) - 设置多宠物通信
