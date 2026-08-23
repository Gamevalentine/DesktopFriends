---
layout: home

hero:
  name: DesktopFriends
  text: 拥有时间感的 AI 桌面伙伴
  tagline: 不只等待你开口：宠物会自主安排计划，在合适的时间主动问候、提醒与陪伴
  image:
    src: /logo.png
    alt: DesktopFriends 吉祥物
  actions:
    - theme: brand
      text: 了解时间表系统
      link: /guide/timemap
    - theme: alt
      text: 快速开始
      link: /guide/getting-started

features:
  - icon: ⏰
    title: 时间表与本地心跳
    details: Agent 用语义化任务安排每日计划，本地心跳每分钟检查，到期才唤醒 AI 执行
  - icon: 🎭
    title: Live2D 模型
    details: 支持加载自定义 Live2D 模型，让你喜欢的角色陪伴在桌面
  - icon: 🤖
    title: AI Agent 系统
    details: 自研 ReAct 引擎，支持 OpenAI / Claude / DeepSeek，流式输出 + Markdown 渲染 + 工具调用
  - icon: 📱
    title: 多宠物联动
    details: 其他宠物会随时收听到你的对话并会尝试加入对话，他们也会相互交流，通过局域网无缝连接
  - icon: 🎨
    title: 高度可定制
    details: 自定义模型、动作、表情、小组件、背景，打造专属的桌面伙伴
  - icon: 🧩
    title: 小组件系统
    details: 时钟、天气、待办组件按需赋予 Agent 对应能力，桌面端使用独立透明窗口
---

<div class="custom-home">

## 为什么时间表是核心？

聊天让宠物能够回应你，时间表则让它能够主动陪伴你。用户或 Agent 创建语义化计划后，本地心跳只负责低成本检查时间；条目到期才调用大模型，并结合宠物人设完成问候、提醒或互动。

```text
自然语言请求 / Agent 自主计划 → Timemap 持久化 → 60 秒本地心跳 → 到期触发 Agent
```

[深入了解时间表的工具、跨天规则与执行流程 →](/guide/timemap)

## 为什么选择 DesktopFriends?

<div class="features-grid">
  <FeatureCard
    icon="📱"
    title="废旧手机再利用"
    description="让闲置的旧手机焕发新生，变成可爱使用的桌面装饰"
  />
  <FeatureCard
    icon="🤖"
    title="智能 AI 伙伴"
    description="不只是摆设，还能使用表情与动作与你对话，关键是「大家」一起"
  />
  <FeatureCard
    icon="🔗"
    title="无缝联动"
    description="电脑端与手机端一个房间，可以进行跨设备交流"
  />
</div>

## 技术栈

<div class="tech-stack">
  <div class="tech-item">
    <span class="icon">⚡</span>
    <span>Vue 3</span>
  </div>
  <div class="tech-item">
    <span class="icon">📦</span>
    <span>Capacitor</span>
  </div>
  <div class="tech-item">
    <span class="icon">🎭</span>
    <span>PixiJS</span>
  </div>
  <div class="tech-item">
    <span class="icon">🔌</span>
    <span>Socket.IO</span>
  </div>
  <div class="tech-item">
    <span class="icon">🤖</span>
    <span>Multi-AI</span>
  </div>
</div>

<div class="download-section">
  <h2>开始使用</h2>
  <p>下载 APK 安装到你的安卓手机，开启桌面宠物之旅</p>
  <div class="download-buttons">
    <a href="download" class="download-btn primary">
      📥 下载 APK
    </a>
    <a href="guide/getting-started" class="download-btn secondary">
      📖 查看文档
    </a>
  </div>
</div>

</div>
