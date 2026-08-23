<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { ChatBubble } from "@desktopfriends/ui";
import { useChatHistory } from "@desktopfriends/core";

const { chatHistory, stats, clearHistory, exportHistory } = useChatHistory();
const listRef = ref<HTMLElement | null>(null);

const scrollToLatest = async () => {
  await nextTick();
  if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight;
};

const confirmClear = () => {
  if (chatHistory.value.length === 0) return;
  if (window.confirm("确定要清空全部对话记录吗？")) clearHistory();
};

watch(() => chatHistory.value.length, scrollToLatest);
onMounted(scrollToLatest);
</script>

<template>
  <main class="history-window">
    <header class="history-toolbar">
      <div>
        <h1>对话记录</h1>
        <p>
          {{ stats.total }} 条消息 · 你 {{ stats.userCount }} · 宠物
          {{ stats.petCount }}
        </p>
      </div>
      <div class="toolbar-actions">
        <button @click="exportHistory('text')">导出 TXT</button>
        <button @click="exportHistory('json')">导出 JSON</button>
        <button class="danger" @click="confirmClear">清空</button>
      </div>
    </header>

    <section ref="listRef" class="message-list">
      <div v-if="chatHistory.length === 0" class="empty-state">
        <span>💬</span>
        <strong>还没有对话记录</strong>
        <p>与桌宠对话后，消息会实时出现在这里。</p>
      </div>

      <article
        v-for="message in chatHistory"
        :key="message.id"
        class="message-row"
        :class="message.speaker"
      >
        <div class="message-meta">
          <span>{{ message.name }}</span>
          <time>{{ new Date(message.timestamp).toLocaleTimeString() }}</time>
        </div>
        <ChatBubble
          :message="message.content"
          :speaker="message.speaker === 'user' ? null : message.name"
          :is-inner-monologue="message.speaker === 'thinking'"
        />
      </article>
    </section>
  </main>
</template>

<style scoped>
.history-window {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #202124;
  background: linear-gradient(160deg, #f7f7fb 0%, #eef1f8 100%);
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.history-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(30, 35, 50, 0.1);
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(16px);
}

h1 {
  font-size: 20px;
  line-height: 1.3;
}

.history-toolbar p {
  margin-top: 3px;
  color: #737785;
  font-size: 12px;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

button {
  border: 1px solid #d9dce5;
  border-radius: 8px;
  padding: 7px 10px;
  color: #4a4e5c;
  background: white;
  cursor: pointer;
}

button:hover {
  border-color: #8b91a7;
  background: #f8f9fc;
}

button.danger {
  color: #c0392b;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 22px;
}

.message-row {
  width: min(82%, 680px);
  margin: 0 0 18px;
}

.message-row.user {
  margin-left: auto;
}

.message-row.thinking {
  opacity: 0.82;
}

.message-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 6px 5px;
  color: #838897;
  font-size: 11px;
}

.message-row.user .message-meta {
  flex-direction: row-reverse;
}

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #858a99;
  text-align: center;
}

.empty-state span {
  font-size: 42px;
}

.empty-state strong {
  color: #545968;
  font-size: 16px;
}

.empty-state p {
  font-size: 13px;
}

@media (max-width: 520px) {
  .history-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .toolbar-actions {
    justify-content: flex-start;
  }

  .message-row {
    width: 94%;
  }
}
</style>
