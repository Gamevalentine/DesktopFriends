<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import type {
  WidgetConfig,
  WeatherWidgetSettings,
  StandardWeatherData,
} from "@desktopfriends/shared";
import { getWeatherByCityName, useWidgets } from "@desktopfriends/core";

const props = defineProps<{
  widget: WidgetConfig;
}>();

const settings = computed(() => props.widget.settings as WeatherWidgetSettings);
const { setWidgetWeather } = useWidgets();

// 获取 API Key（优先使用用户自定义的，否则使用环境变量）
const apiKey = computed(() => {
  return settings.value.apiKey || import.meta.env.VITE_QWEATHER_API_KEY || "";
});

// 计算小组件尺寸
const widgetSize = computed(() => {
  const width = props.widget.position.gridWidth;
  const height = props.widget.position.gridHeight;
  return { width, height };
});

// 根据尺寸决定显示模式
const displayMode = computed(() => {
  const { width, height } = widgetSize.value;
  const area = width * height;

  // 小尺寸（面积 <= 4，如 2×2）：紧凑模式
  if (area <= 4) return "compact";

  // 中等尺寸（面积 <= 9，如 3×3）：标准模式
  if (area <= 9) return "standard";

  // 大尺寸：完整模式
  return "full";
});

// Weather data state（使用标准化类型）
const weatherData = ref<StandardWeatherData | null>(null);

const loading = ref(false);
const error = ref<string | null>(null);

// Weather icons mapping
const weatherIcons: Record<string, string> = {
  sunny: "☀️",
  cloudy: "☁️",
  partlyCloudy: "⛅",
  rainy: "🌧️",
  stormy: "⛈️",
  snowy: "❄️",
  foggy: "🌫️",
  windy: "💨",
  default: "🌤️",
};

// Format temperature
const formattedTemp = computed(() => {
  if (!weatherData.value) return "--";
  let temp = weatherData.value.temp;

  // Convert to Fahrenheit if needed
  if (settings.value.units === "imperial") {
    temp = Math.round((temp * 9) / 5 + 32);
    return `${temp}°F`;
  }

  return `${temp}°C`;
});

// Fetch weather data using QWeather API
async function fetchWeather() {
  if (!settings.value.location) {
    error.value = "请设置位置";
    weatherData.value = null;
    setWidgetWeather(props.widget.id, "", null);
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    console.log(`🔍 查询天气: ${settings.value.location}`);

    // 使用和风天气 API（通过城市名直接查询）
    const data = await getWeatherByCityName(
      settings.value.location,
      apiKey.value // 使用 computed 的 API Key
    );

    weatherData.value = data;
    setWidgetWeather(props.widget.id, settings.value.location, data);

    console.log(
      `✅ 天气获取成功: ${settings.value.location}`,
      weatherData.value
    );
  } catch (e: any) {
    console.error("❌ 天气获取失败:", e);

    // Clear weather data on error
    weatherData.value = null;
    setWidgetWeather(props.widget.id, settings.value.location, null);

    // Set specific error message
    error.value = e.message || "获取天气失败";
  } finally {
    loading.value = false;
  }
}

let refreshTimer: number | null = null;

// Watch location changes
watch(
  () => settings.value.location,
  (newLocation, oldLocation) => {
    if (newLocation !== oldLocation) {
      console.log(`📍 位置变更: ${oldLocation} → ${newLocation}`);
      fetchWeather();
    }
  },
  { immediate: false }
);

// Watch units changes
watch(
  () => settings.value.units,
  () => {
    console.log(`🌡️ 温度单位变更: ${settings.value.units}`);
  }
);

onMounted(() => {
  fetchWeather();
  // Refresh every 30 minutes
  refreshTimer = window.setInterval(fetchWeather, 30 * 60 * 1000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
</script>

<template>
  <div class="weather-widget" :class="`mode-${displayMode}`">
    <!-- Loading state -->
    <div v-if="loading && !weatherData" class="weather-loading">
      <span class="loading-icon">🔄</span>
      <span v-if="displayMode !== 'compact'" class="loading-text"
        >加载中...</span
      >
    </div>

    <!-- Error state -->
    <div v-else-if="error && !weatherData" class="weather-error">
      <span class="error-icon">⚠️</span>
      <span v-if="displayMode !== 'compact'" class="error-text">{{
        error
      }}</span>
    </div>

    <!-- Weather data -->
    <template v-else-if="weatherData">
      <!-- 紧凑模式 (2×2) - 精简布局 -->
      <template v-if="displayMode === 'compact'">
        <div class="compact-layout">
          <div class="compact-row">
            <span class="compact-icon">{{
              weatherIcons[weatherData.icon] || weatherIcons.default
            }}</span>
            <div class="compact-temp-wrap">
              <span class="compact-temp">{{ formattedTemp }}</span>
              <span class="compact-condition">{{ weatherData.condition }}</span>
            </div>
          </div>
          <div class="compact-location">
            {{ settings.location || "未设置" }}
          </div>
        </div>
      </template>

      <!-- 标准模式 (3×3) -->
      <template v-else-if="displayMode === 'standard'">
        <div class="standard-layout">
          <div class="standard-location">
            {{ settings.location || "未设置" }}
          </div>
          <div class="standard-main">
            <span class="standard-icon">{{
              weatherIcons[weatherData.icon] || weatherIcons.default
            }}</span>
            <div class="standard-info">
              <span class="standard-temp">{{ formattedTemp }}</span>
              <span class="standard-condition">{{
                weatherData.condition
              }}</span>
            </div>
          </div>
          <div class="standard-details">
            <div class="detail-item">
              <span class="detail-icon">💧</span>
              <span class="detail-value">{{ weatherData.humidity }}%</span>
            </div>
            <div class="detail-item">
              <span class="detail-icon">💨</span>
              <span class="detail-value">{{ weatherData.windSpeed }}km/h</span>
            </div>
          </div>
        </div>
      </template>

      <!-- 完整模式 (4×4+) -->
      <template v-else>
        <div class="full-layout">
          <div class="full-header">
            <span class="full-location"
              >📍 {{ settings.location || "未设置" }}</span
            >
          </div>

          <div class="full-main">
            <span class="full-icon">{{
              weatherIcons[weatherData.icon] || weatherIcons.default
            }}</span>
            <div class="full-info">
              <span class="full-temp">{{ formattedTemp }}</span>
              <span class="full-condition">{{ weatherData.condition }}</span>
            </div>
          </div>

          <div class="full-details">
            <div class="detail-card">
              <span class="detail-label">湿度</span>
              <span class="detail-value">{{ weatherData.humidity }}%</span>
            </div>
            <div class="detail-card">
              <span class="detail-label">风速</span>
              <span class="detail-value">{{ weatherData.windSpeed }}km/h</span>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Empty state -->
    <div v-else class="weather-empty">
      <span class="empty-icon">🌤️</span>
      <span v-if="displayMode !== 'compact'" class="empty-text"
        >请设置位置</span
      >
    </div>
  </div>
</template>

<style scoped>
.weather-widget {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
}

/* ========== 通用状态样式 ========== */
.weather-loading,
.weather-error,
.weather-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
  text-align: center;
  gap: 6px;
}

.loading-icon,
.error-icon,
.empty-icon {
  font-size: 28px;
}

.loading-text,
.error-text,
.empty-text {
  font-size: 12px;
  color: #999;
}

/* ========== 紧凑模式 (2×2) ========== */
.weather-widget.mode-compact {
  padding: 8px;
}

.compact-layout {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 6px;
}

.compact-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compact-icon {
  font-size: 32px;
  line-height: 1;
}

.compact-temp-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.compact-temp {
  font-size: 20px;
  font-weight: 700;
  color: #333;
  line-height: 1.1;
}

.compact-condition {
  font-size: 11px;
  color: #666;
}

.compact-location {
  font-size: 10px;
  color: #999;
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 8px;
  border-radius: 10px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 标准模式 (3×3) ========== */
.weather-widget.mode-standard {
  padding: 10px;
}

.standard-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
}

.standard-location {
  font-size: 11px;
  color: #666;
  text-align: center;
  padding: 4px 8px;
  background: rgba(102, 126, 234, 0.08);
  border-radius: 12px;
  align-self: center;
}

.standard-main {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
}

.standard-icon {
  font-size: 42px;
  line-height: 1;
}

.standard-info {
  display: flex;
  flex-direction: column;
}

.standard-temp {
  font-size: 28px;
  font-weight: 700;
  color: #333;
  line-height: 1;
}

.standard-condition {
  font-size: 13px;
  color: #666;
  margin-top: 2px;
}

.standard-details {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.standard-details .detail-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #666;
}

.standard-details .detail-icon {
  font-size: 14px;
}

.standard-details .detail-value {
  font-weight: 500;
  color: #555;
}

/* ========== 完整模式 (4×4+) ========== */
.weather-widget.mode-full {
  padding: 12px;
}

.full-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 10px;
}

.full-header {
  text-align: center;
}

.full-location {
  font-size: 12px;
  color: #666;
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.1) 0%,
    rgba(118, 75, 162, 0.1) 100%
  );
  padding: 6px 12px;
  border-radius: 16px;
  display: inline-block;
}

.full-main {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 8px 0;
}

.full-icon {
  font-size: 52px;
  line-height: 1;
}

.full-info {
  display: flex;
  flex-direction: column;
}

.full-temp {
  font-size: 36px;
  font-weight: 700;
  color: #333;
  line-height: 1;
}

.full-condition {
  font-size: 14px;
  color: #666;
  margin-top: 4px;
}

.full-details {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.detail-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 0, 0, 0.03);
  padding: 8px 16px;
  border-radius: 12px;
  min-width: 70px;
}

.detail-label {
  font-size: 10px;
  color: #999;
  margin-bottom: 2px;
}

.detail-card .detail-value {
  font-size: 14px;
  font-weight: 600;
  color: #555;
}
</style>
