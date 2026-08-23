<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { appWindow } from "@tauri-apps/api/window";
import { getWeatherByCityName, useWidgets } from "@desktopfriends/core";
import type {
  ClockWidgetSettings,
  StandardWeatherData,
  TodoWidgetSettings,
  WeatherWidgetSettings,
  WidgetType,
} from "@desktopfriends/shared";

const params = new URLSearchParams(window.location.search);
const environment = (import.meta as unknown as {
  env?: Record<string, string | undefined>;
}).env;
const requestedType = params.get("type");
const widgetId = params.get("widgetId") || "";
const type = (["clock", "weather", "todo"] as WidgetType[]).includes(
  requestedType as WidgetType,
)
  ? (requestedType as "clock" | "weather" | "todo")
  : "clock";

const {
  widgets,
  todos,
  pendingTodos,
  addWidget,
  removeWidget,
  addTodo,
  removeTodo,
  toggleTodo,
  updateWidgetSettings,
  setWidgetWeather,
} = useWidgets();

const widget = computed(() =>
  widgets.value.find((item) => item.id === widgetId && item.type === type) ||
  widgets.value.find((item) => item.type === type),
);

// A widget window is reused by type. Its original URL may therefore contain
// an ID that has since been removed or replaced. Recover from that stale ID,
// and also handle a new WebView whose storage has not contained this widget.
if (!widget.value) addWidget(type);
const isAlwaysOnTop = ref(true);
const showSettings = ref(false);

const startDrag = () => appWindow.startDragging();
const closeWindow = () => appWindow.close();
const removeFromDesktop = async () => {
  if (widget.value) removeWidget(widget.value.id);
  await appWindow.close();
};
const toggleAlwaysOnTop = async () => {
  isAlwaysOnTop.value = !isAlwaysOnTop.value;
  await appWindow.setAlwaysOnTop(isAlwaysOnTop.value);
};

// Clock
const now = ref(new Date());
let clockTimer: number | null = null;
const clockSettings = computed(
  () => widget.value?.settings as ClockWidgetSettings | undefined,
);
const clockTime = computed(() => {
  const settings = clockSettings.value;
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: settings?.showSeconds ? "2-digit" : undefined,
    hour12: settings?.format === "12h",
  };
  return now.value.toLocaleTimeString("zh-CN", options);
});
const clockDate = computed(() =>
  now.value.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }),
);

const updateClockSetting = (updates: Partial<ClockWidgetSettings>) => {
  if (widget.value) updateWidgetSettings(widget.value.id, updates);
};

// Weather
const weatherSettings = computed(
  () => widget.value?.settings as WeatherWidgetSettings | undefined,
);
const weather = ref<StandardWeatherData | null>(null);
const weatherLoading = ref(false);
const weatherError = ref("");
const locationDraft = ref("");
const apiKeyDraft = ref("");

const weatherIcon = computed(() => {
  const icons: Record<string, string> = {
    sunny: "☀️",
    cloudy: "☁️",
    partlyCloudy: "⛅",
    rainy: "🌧️",
    stormy: "⛈️",
    snowy: "❄️",
    foggy: "🌫️",
    windy: "💨",
  };
  return icons[weather.value?.icon || ""] || "🌤️";
});

const formattedTemperature = computed(() => {
  if (!weather.value) return "--";
  if (weatherSettings.value?.units === "imperial") {
    return `${Math.round((weather.value.temp * 9) / 5 + 32)}°F`;
  }
  return `${weather.value.temp}°C`;
});

const fetchWeather = async () => {
  const settings = weatherSettings.value;
  if (!settings?.location) {
    weather.value = null;
    if (widget.value) setWidgetWeather(widget.value.id, "", null);
    weatherError.value = "请先设置城市";
    return;
  }

  weatherLoading.value = true;
  weatherError.value = "";
  try {
    weather.value = await getWeatherByCityName(
      settings.location,
      settings.apiKey || environment?.VITE_QWEATHER_API_KEY || "",
    );
    if (widget.value) {
      setWidgetWeather(widget.value.id, settings.location, weather.value);
    }
  } catch (error) {
    weather.value = null;
    if (widget.value) {
      setWidgetWeather(widget.value.id, settings.location, null);
    }
    weatherError.value =
      error instanceof Error ? error.message : "获取天气失败";
  } finally {
    weatherLoading.value = false;
  }
};

const saveWeatherSettings = () => {
  if (!widget.value) return;
  updateWidgetSettings(widget.value.id, {
    location: locationDraft.value.trim(),
    apiKey: apiKeyDraft.value.trim() || undefined,
  });
  showSettings.value = false;
  fetchWeather();
};

// Todo
const todoSettings = computed(
  () => widget.value?.settings as TodoWidgetSettings | undefined,
);
const newTodo = ref("");
const visibleTodos = computed(() =>
  todoSettings.value?.showCompleted ? todos.value : pendingTodos.value,
);
const submitTodo = () => {
  const text = newTodo.value.trim();
  if (!text) return;
  addTodo(text);
  newTodo.value = "";
};
const toggleCompletedVisibility = () => {
  if (!widget.value || !todoSettings.value) return;
  updateWidgetSettings(widget.value.id, {
    showCompleted: !todoSettings.value.showCompleted,
  });
};

watch(
  weatherSettings,
  (settings) => {
    locationDraft.value = settings?.location || "";
    apiKeyDraft.value = settings?.apiKey || "";
  },
  { immediate: true },
);

onMounted(() => {
  clockTimer = window.setInterval(() => (now.value = new Date()), 1000);
  if (type === "weather") fetchWeather();
});

onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer);
});
</script>

<template>
  <main class="widget-window" :class="`widget-${type}`">
    <header class="widget-titlebar" data-tauri-drag-region @mousedown="startDrag">
      <div class="widget-heading">
        <span class="heading-icon">{{ type === "clock" ? "◷" : type === "weather" ? "◌" : "✓" }}</span>
        <strong>
          {{ type === "clock" ? "时钟" : type === "weather" ? "天气" : "待办" }}
        </strong>
      </div>
      <div class="window-actions" @mousedown.stop>
        <button
          v-if="type === 'weather'"
          title="天气设置"
          @click="showSettings = !showSettings"
        >
          ⋯
        </button>
        <button
          :class="{ active: isAlwaysOnTop }"
          :title="isAlwaysOnTop ? '取消置顶' : '窗口置顶'"
          @click="toggleAlwaysOnTop"
        >
          ⌖
        </button>
        <button title="移除小组件与对应能力" @click="removeFromDesktop">
          −
        </button>
        <button title="关闭" @click="closeWindow">×</button>
      </div>
    </header>

    <section v-if="!widget" class="missing-widget">
      <span>⚠️</span>
      <p>小组件配置不存在，请从桌宠工具栏重新打开。</p>
    </section>

    <section v-else-if="type === 'clock'" class="clock-content">
      <div class="clock-time">{{ clockTime }}</div>
      <div v-if="clockSettings?.showDate" class="clock-date">{{ clockDate }}</div>
      <div class="inline-settings">
        <label>
          <input
            type="checkbox"
            :checked="clockSettings?.showSeconds"
            @change="updateClockSetting({ showSeconds: !clockSettings?.showSeconds })"
          />
          显示秒
        </label>
        <label>
          <input
            type="checkbox"
            :checked="clockSettings?.format === '12h'"
            @change="
              updateClockSetting({
                format: clockSettings?.format === '12h' ? '24h' : '12h',
              })
            "
          />
          12 小时制
        </label>
      </div>
    </section>

    <section v-else-if="type === 'weather'" class="weather-content">
      <form v-if="showSettings" class="settings-card" @submit.prevent="saveWeatherSettings">
        <label>
          城市
          <input v-model="locationDraft" placeholder="例如：上海" />
        </label>
        <label>
          和风天气 API Key（可选）
          <input v-model="apiKeyDraft" type="password" placeholder="API Key" />
        </label>
        <button class="primary" type="submit">保存并刷新</button>
      </form>
      <div v-else-if="weatherLoading" class="center-state">正在获取天气…</div>
      <div v-else-if="weatherError" class="center-state error">
        <span>⚠️</span>
        <p>{{ weatherError }}</p>
        <button @click="showSettings = true">打开设置</button>
      </div>
      <div v-else-if="weather" class="weather-result">
        <div class="weather-location">{{ weatherSettings?.location }}</div>
        <div class="weather-main">
          <span class="weather-icon">{{ weatherIcon }}</span>
          <div>
            <div class="weather-temp">{{ formattedTemperature }}</div>
            <div class="weather-condition">{{ weather.condition }}</div>
          </div>
        </div>
        <div class="weather-details">
          <span>湿度 {{ weather.humidity }}%</span>
          <span>风速 {{ weather.windSpeed }} km/h</span>
        </div>
      </div>
    </section>

    <section v-else class="todo-content">
      <form class="todo-form" @submit.prevent="submitTodo">
        <input v-model="newTodo" placeholder="添加待办事项…" />
        <button class="primary" type="submit">添加</button>
      </form>
      <div class="todo-list">
        <div
          v-for="todo in visibleTodos"
          :key="todo.id"
          class="todo-item"
          :class="{ completed: todo.completed }"
        >
          <button class="todo-check" @click="toggleTodo(todo.id)">
            {{ todo.completed ? "✓" : "" }}
          </button>
          <span>{{ todo.text }}</span>
          <button class="todo-remove" @click="removeTodo(todo.id)">×</button>
        </div>
        <div v-if="visibleTodos.length === 0" class="center-state">暂无待办事项</div>
      </div>
      <button class="text-button" @click="toggleCompletedVisibility">
        {{ todoSettings?.showCompleted ? "隐藏已完成" : "显示已完成" }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.widget-window {
  --widget-accent: #ffffff;
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px;
  color: rgba(255, 255, 255, 0.94);
  background: transparent;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  user-select: none;
  isolation: isolate;
}

.widget-window::before {
  content: none;
}

.widget-window > * {
  position: relative;
  z-index: 1;
}

.widget-titlebar {
  height: 40px;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  margin: 0 4px;
  padding: 0 6px 0 10px;
  border-bottom: none;
  cursor: grab;
}

.widget-titlebar:active {
  cursor: grabbing;
}

.widget-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.widget-heading strong {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.heading-icon {
  width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 7px;
  color: rgba(255, 255, 255, 0.72);
  background: transparent;
  font-size: 13px;
  font-weight: 700;
}

.window-actions {
  display: flex;
  gap: 2px;
  opacity: 0.48;
  transition: opacity 160ms ease;
}

.widget-window:hover .window-actions,
.window-actions:focus-within {
  opacity: 1;
}

button {
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 9px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
}

button:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.15);
}

button:active {
  transform: scale(0.95);
}

button:focus-visible,
input:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.8);
  outline-offset: 2px;
}

.window-actions button {
  width: 27px;
  height: 27px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 12px;
}

.window-actions button:hover,
.window-actions button.active {
  color: white;
  background: rgba(255, 255, 255, 0.12);
}

.window-actions button.active {
  color: white;
}

.clock-content,
.weather-content,
.todo-content,
.missing-widget {
  flex: 1;
  min-height: 0;
}

.clock-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 18px 18px;
}

.clock-time {
  color: white;
  font-size: clamp(40px, 13vw, 64px);
  font-weight: 620;
  line-height: 1;
  letter-spacing: -0.055em;
  font-variant-numeric: tabular-nums;
  text-shadow: none;
}

.clock-date {
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 12px;
  letter-spacing: 0.02em;
}

.inline-settings {
  display: flex;
  gap: 7px;
  margin-top: 14px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 11px;
  opacity: 0.52;
  transition: opacity 160ms ease;
}

.clock-content:hover .inline-settings {
  opacity: 1;
}

.inline-settings label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.inline-settings input {
  width: 12px;
  height: 12px;
  padding: 0;
  accent-color: white;
}

.weather-content {
  padding: 14px 20px 20px;
}

.weather-result {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.weather-location {
  padding: 5px 10px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.64);
  background: transparent;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.weather-main {
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 18px 0 20px;
}

.weather-icon {
  font-size: 60px;
  filter: grayscale(1);
}

.weather-temp {
  color: white;
  font-size: 44px;
  font-weight: 620;
  line-height: 1;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
}

.weather-condition {
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
}

.weather-details {
  display: flex;
  gap: 8px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 11px;
}

.weather-details span {
  padding: 7px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
}

.settings-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 4px;
}

.settings-card label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
}

input {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 10px 11px;
  color: rgba(255, 255, 255, 0.9);
  outline: none;
  background: rgba(255, 255, 255, 0.08);
  transition: border-color 150ms ease, background 150ms ease;
}

input::placeholder {
  color: rgba(255, 255, 255, 0.34);
}

input:focus {
  border-color: rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.11);
}

.primary {
  padding: 9px 14px;
  border-color: white;
  color: #10141d;
  background: white;
  font-weight: 650;
}

.primary:hover {
  background: rgba(255, 255, 255, 0.86);
}

.todo-content {
  display: flex;
  flex-direction: column;
  padding: 12px 16px 16px;
}

.todo-form {
  display: flex;
  gap: 8px;
}

.todo-form input {
  flex: 1;
}

.todo-list {
  flex: 1;
  overflow-y: auto;
  margin: 12px -4px 8px 0;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 6px;
  padding: 9px 8px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  transition: background 150ms ease, border-color 150ms ease;
}

.todo-item:hover {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
}

.todo-item > span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.todo-item.completed > span {
  color: rgba(255, 255, 255, 0.34);
  text-decoration: line-through;
}

.todo-check {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-color: rgba(255, 255, 255, 0.42);
  color: white;
  background: transparent;
}

.todo-remove {
  width: 24px;
  height: 24px;
  border: none;
  color: rgba(255, 255, 255, 0.34);
  background: transparent;
}

.todo-remove:hover {
  color: white;
  background: rgba(255, 255, 255, 0.08);
}

.text-button {
  align-self: flex-start;
  border: none;
  padding: 5px 4px;
  color: rgba(255, 255, 255, 0.68);
  background: transparent;
  font-size: 11px;
}

.center-state,
.missing-widget {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.54);
  text-align: center;
}

.center-state.error {
  height: 100%;
  color: rgba(255, 255, 255, 0.72);
}

.center-state button {
  padding: 7px 12px;
}

.missing-widget {
  padding: 24px;
}
</style>
