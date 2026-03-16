<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

const props = withDefaults(defineProps<{
  message: string
  isThinking?: boolean      // 正在思考（显示加载动画）
  isInnerMonologue?: boolean // 内心独白样式
  speaker?: string | null   // 说话者名称，null 表示自己
  enableMarkdown?: boolean  // 是否启用 Markdown 渲染
  isStreaming?: boolean     // 是否正在流式输出（显示打字光标）
}>(), {
  enableMarkdown: true,
})

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true,
})

const renderedMessage = computed(() => {
  if (props.enableMarkdown === false) {
    return null // 使用纯文本
  }
  try {
    return marked.parse(props.message) as string
  } catch {
    return null // 解析失败时回退纯文本
  }
})
</script>

<template>
  <div
    class="chat-bubble"
    :class="{
      'from-other': speaker,
      'inner-monologue': isInnerMonologue
    }"
  >
    <!-- 说话者名称 -->
    <div v-if="speaker" class="speaker-name">{{ speaker }}</div>

    <!-- 内心独白标签 -->
    <div v-if="isInnerMonologue" class="monologue-label">内心独白</div>

    <div v-if="isThinking" class="thinking">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
    <div v-else-if="renderedMessage" class="message markdown-body" :class="{ streaming: isStreaming }" v-html="renderedMessage"></div>
    <p v-else class="message" :class="{ streaming: isStreaming }">{{ message }}</p>
  </div>
</template>

<style scoped>
.chat-bubble {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  padding: 12px 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  animation: fadeIn 0.3s ease;
  max-height: 50vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.chat-bubble.from-other {
  background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
  border-left: 3px solid #667eea;
}

/* 内心独白样式 */
.chat-bubble.inner-monologue {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.7) 0%, rgba(240, 240, 255, 0.7) 100%);
  border: 1px dashed #a0a0c0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  font-style: italic;
}

.chat-bubble.inner-monologue .message {
  color: #666;
}

.monologue-label {
  font-size: 10px;
  color: #999;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.monologue-label::before {
  content: '💭';
  font-style: normal;
}

.speaker-name {
  font-size: 11px;
  font-weight: 600;
  color: #667eea;
  margin-bottom: 4px;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message {
  margin: 0;
  color: #333;
  font-size: 14px;
  line-height: 1.5;
}

/* 流式光标动画 */
.message.streaming::after {
  content: '▌';
  animation: blink 0.8s step-end infinite;
  color: #667eea;
  font-weight: bold;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* Markdown 样式 */
.markdown-body :deep(p) {
  margin: 0 0 0.5em 0;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(code) {
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
}

.markdown-body :deep(pre) {
  background: rgba(0, 0, 0, 0.06);
  padding: 8px 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.markdown-body :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 12px;
  line-height: 1.4;
}

.markdown-body :deep(strong) {
  font-weight: 600;
  color: #222;
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 4px 0;
  padding-left: 20px;
}

.markdown-body :deep(li) {
  margin: 2px 0;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid #ddd;
  margin: 8px 0;
  padding-left: 12px;
  color: #666;
}

.markdown-body :deep(a) {
  color: #667eea;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid #eee;
  margin: 8px 0;
}

.thinking {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.dot {
  width: 8px;
  height: 8px;
  background: #667eea;
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.dot:nth-child(1) {
  animation-delay: -0.32s;
}

.dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}
</style>
