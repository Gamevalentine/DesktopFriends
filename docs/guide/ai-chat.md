# AI 对话

DesktopFriends 内置了 AI Agent 系统，让你的桌面宠物能够进行智能对话、控制表情动作、管理日程等。

## 支持的 LLM 服务

所有 AI 配置都在 **应用内的设置页面** 完成，无需配置服务器或环境变量。

### OpenAI
- 兼容 GPT-4o、GPT-4o-mini 等模型
- 需要 API Key
- 默认 API 地址：`https://api.openai.com`

### Claude (Anthropic)
- 兼容 Claude 3.5 Sonnet、Claude 3 Haiku 等模型
- 需要 API Key
- 使用 Anthropic Messages API 格式

### DeepSeek
- 兼容 DeepSeek-V3、DeepSeek-Chat 等模型
- 需要 API Key
- OpenAI 兼容格式

### 自定义 API
- 任何兼容 OpenAI Chat Completions 格式的 API
- 可自定义 Base URL
- 适用于本地 Ollama、LM Studio、vLLM 等

## 配置步骤

1. 打开应用，进入 **设置** 页面
2. 在 **AI 配置** 区域：
   - 选择 **服务商**（OpenAI / Claude / DeepSeek / 自定义）
   - 输入 **API Key**
   - （可选）修改 **Base URL** 和 **模型名称**
3. 点击 **测试连接** 验证配置是否正确
4. 返回主页即可开始对话

::: tip 提示
测试连接会自动检测 API Key 是否有效，并列出可用的模型。
:::

## Agent 能力

配置 AI 后，宠物不仅能聊天，还拥有以下能力：

### 表情动作控制
- 宠物会在对话中自动选择合适的表情和动作
- 通过 `playMotion` 和 `setExpression` 工具实现
- 表情 30 秒后自动重置

### 内心独白
- 宠物有时会先思考再回答（`innerThought` 工具）
- 内心想法会以不同样式的气泡展示
- 宠物可以选择不回复（`shouldReply` 工具）

### 小组件交互
- 获取当前时间
- 管理待办事项（查看 / 添加 / 完成）
- 获取小组件状态信息

### 时间表管理
- 自主创建每日计划
- 到期时主动与主人互动
- 详见 [时间表系统](/guide/timemap)

### 流式输出
- 回复内容逐字显示（打字机效果）
- 支持 Markdown 格式渲染（粗体、代码块、列表等）

## 人设设置

在设置页面可以自定义宠物的人设提示词，支持 `{petName}` 占位符：

```
你是一只名叫「{petName}」的可爱桌面宠物。
性格特点：
- 活泼开朗，有点傲娇
- 善良体贴，关心主人
- 回复简洁可爱，不超过 50 字
```

## 下一步

- [时间表系统](/guide/timemap) - 了解宠物的日程管理能力
- [多设备联动](/guide/multiplayer) - 设置设备连接
- [自定义模型](/guide/custom-model) - 更换角色模型
