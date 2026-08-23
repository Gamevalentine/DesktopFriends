<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import {
  Live2DCanvas,
  ChatInput,
  ChatBubble,
} from "@desktopfriends/ui";
import {
  useSettings,
  useLangChainAgent,
  useChatHistory,
  useP2P,
  useWidgets,
  createPluginTools,
} from "@desktopfriends/core";
import type { PluginManifest } from "@desktopfriends/core";
import { isDesktopPlatform } from "@desktopfriends/platform";
import type { PetMessage, PetInfo, WidgetType } from "@desktopfriends/shared";
import { appWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/tauri";
import { readDir, readTextFile } from "@tauri-apps/api/fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import WindowControls from "./components/WindowControls.vue";
import SettingsView from "./views/SettingsView.vue";
import {
  openChatHistoryWindow,
  openWidgetWindow,
} from "./windowManager";

const { currentPet, backgroundStyle, settings, live2dTransform } =
  useSettings();
const {
  addUserMessage,
  addPetMessage,
  addOtherPetMessage,
  addThinkingMessage,
} = useChatHistory();
const {
  widgets,
  todos,
  addWidget,
  toggleWidget,
  addTodo,
  toggleTodo,
  getWidgetContexts,
} = useWidgets();

const widgetAgentContext = {
  getTodos: () => todos.value,
  addTodo: (text: string) => addTodo(text),
  completeTodo: (id: string) => {
    const todo = todos.value.find((item) => item.id === id);
    if (!todo) return false;
    if (!todo.completed) toggleTodo(id);
    return true;
  },
  getWidgetContexts: () => getWidgetContexts(),
};

const enabledWidgetToolSignature = computed(() => {
  const types = widgets.value
    .filter((item) => item.enabled)
    .map((item) => item.type);
  return [...new Set(types)].sort().join("|");
});

const live2dRef = ref<InstanceType<typeof Live2DCanvas> | null>(null);

// 桌面端判断 - 桌面应用默认显示窗口控制
const isDesktop = ref(true);

// 当前视图
const currentView = ref<"home" | "settings">("home");

// 鼠标悬停状态 - 悬浮在 Live2D 区域时显示所有 UI
const isHoveringLive2D = ref(false);
const isLocked = ref(false); // 锁定模式，始终显示 UI 且禁用穿透

// 鼠标位置检测定时器
let mouseCheckInterval: ReturnType<typeof setInterval> | null = null;
let hoverHideTimer: ReturnType<typeof setTimeout> | null = null;
let isCheckingMousePosition = false;
const HOVER_HIDE_DELAY = 350;

// 鼠标位置响应类型
interface CursorPosition {
  x: number;
  y: number;
  in_window: boolean;
}

interface ModelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const modelBounds = ref<ModelBounds | null>(null);

const cancelHoverHide = () => {
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = null;
  }
};

const hideHoverUI = async () => {
  hoverHideTimer = null;
  if (isLocked.value) return;

  isHoveringLive2D.value = false;
  showTestPanel.value = false;
  showAdjustPanel.value = false;
  showPetsPanel.value = false;
  showWidgetPanel.value = false;

  try {
    await appWindow.setIgnoreCursorEvents(true);
  } catch (e) {
    console.error("Failed to restore cursor passthrough:", e);
  }
};

const scheduleHoverHide = () => {
  if (hoverHideTimer || !isHoveringLive2D.value || isLocked.value) return;
  hoverHideTimer = setTimeout(hideHoverUI, HOVER_HIDE_DELAY);
};

const isPointInHoverUI = (cursor: CursorPosition) =>
  document
    .elementsFromPoint(cursor.x, cursor.y)
    .some((element) => element.closest("[data-hover-ui]"));

// 启动鼠标位置检测（用于点击穿透模式下检测鼠标是否在 Live2D 区域）
const startMousePositionCheck = () => {
  if (mouseCheckInterval || !isDesktop.value) return;

  mouseCheckInterval = setInterval(async () => {
    if (isCheckingMousePosition) return;
    isCheckingMousePosition = true;

    try {
      const bounds = live2dRef.value?.getModelBounds() as
        | ModelBounds
        | null
        | undefined;
      if (bounds) modelBounds.value = bounds;

      // 锁定时仍更新工具栏位置，但不切换点击穿透。
      if (isLocked.value) {
        cancelHoverHide();
        return;
      }

      // 调用 Rust 命令获取鼠标位置
      const cursor = await invoke<CursorPosition>("get_cursor_position");

      // 留出短暂缓冲，避免从模型移向工具栏时 UI 闪烁。
      if (!cursor.in_window) {
        scheduleHoverHide();
        return;
      }

      // 如果模型没有加载或加载失败，检查是否需要激活备用交互区域
      if (!bounds) {
        // 检查模型是否处于加载失败状态（有错误）
        const hasError = live2dRef.value?.error;
        if (hasError) {
          cancelHoverHide();
          // 模型加载失败，激活 UI 让用户能进入设置
          if (!isHoveringLive2D.value) {
            isHoveringLive2D.value = true;
            await appWindow.setIgnoreCursorEvents(false);
          }
        }
        return;
      }
      // console.log("Cursor position:", cursor, "Model bounds:", bounds);

      // 先用边界框快速排除，再读取当前像素的 alpha。
      const isInModelBounds =
        cursor.x >= bounds.left &&
        cursor.x <= bounds.right &&
        cursor.y >= bounds.top &&
        cursor.y <= bounds.bottom;
      const isOnVisibleModel =
        isInModelBounds &&
        Boolean(live2dRef.value?.isPointOnModel(cursor.x, cursor.y));

      const isInVisibleUI =
        isHoveringLive2D.value && isPointInHoverUI(cursor);

      if (isOnVisibleModel || isInVisibleUI) {
        cancelHoverHide();
        if (!isHoveringLive2D.value) {
          isHoveringLive2D.value = true;
          await appWindow.setIgnoreCursorEvents(false);
        }
      } else {
        scheduleHoverHide();
      }
    } catch (e) {
      // 静默处理错误，避免日志刷屏
    } finally {
      isCheckingMousePosition = false;
    }
  }, 50); // 每 50ms 检查一次
};

const stopMousePositionCheck = () => {
  if (mouseCheckInterval) {
    clearInterval(mouseCheckInterval);
    mouseCheckInterval = null;
  }
};

// DOM 事件处理（仅非桌面端使用，桌面端使用轮询检测）
const onLive2DEnter = async () => {
  // 桌面端使用轮询检测，跳过 DOM 事件
  if (isDesktop.value) return;

  isHoveringLive2D.value = true;
};

const onLive2DLeave = async () => {
  // 桌面端使用轮询检测，跳过 DOM 事件
  if (isDesktop.value) return;

  isHoveringLive2D.value = false;
  // 关闭所有面板
  showTestPanel.value = false;
  showAdjustPanel.value = false;
  showPetsPanel.value = false;
  showWidgetPanel.value = false;
};

// 切换锁定模式（始终显示 UI 且禁用穿透）
const toggleLocked = async () => {
  isLocked.value = !isLocked.value;
  if (isLocked.value) cancelHoverHide();
  if (isDesktop.value) {
    try {
      // 锁定时禁用穿透，解锁且不在 Live2D 上时启用穿透
      await appWindow.setIgnoreCursorEvents(
        !isLocked.value && !isHoveringLive2D.value,
      );
    } catch (e) {
      console.error("Failed to toggle cursor ignore:", e);
    }
  }
};

// 是否显示悬停 UI
const showHoverUI = computed(() => isHoveringLive2D.value || isLocked.value);

const toolbarPosition = computed(() => {
  const bounds = modelBounds.value;
  const fallbackX = window.innerWidth / 2;
  if (!bounds) return { x: fallbackX, y: 44 };

  const toolbarHalfWidth = 140;
  const x = Math.min(
    Math.max(bounds.centerX, toolbarHalfWidth + 8),
    window.innerWidth - toolbarHalfWidth - 8,
  );
  const y = Math.max(44, bounds.top - 50);
  return { x, y };
});

const hoverToolbarStyle = computed(() => ({
  left: `${toolbarPosition.value.x}px`,
  top: `${toolbarPosition.value.y}px`,
}));

const hoverPanelStyle = computed(() => ({
  left: `${Math.min(
    Math.max(toolbarPosition.value.x, 146),
    window.innerWidth - 146,
  )}px`,
  top: `${Math.min(toolbarPosition.value.y + 52, window.innerHeight - 220)}px`,
}));

// 面板显示状态
const showTestPanel = ref(false);
const showAdjustPanel = ref(false);
const showPetsPanel = ref(false);
const showWidgetPanel = ref(false);

// 获取模型可用的动作和表情
const motionDetails = computed(() => live2dRef.value?.motionDetails || []);
const availableExpressions = computed(
  () => live2dRef.value?.availableExpressions || [],
);

// 按组分类的动作详情
const motionsByGroup = computed(() => {
  const groups: Record<string, Array<{ name: string; index: number }>> = {};
  for (const motion of motionDetails.value) {
    if (!groups[motion.group]) {
      groups[motion.group] = [];
    }
    groups[motion.group].push({ name: motion.name, index: motion.index });
  }
  return groups;
});

// 是否已配置大模型
const isLLMConfigured = computed(() => !!settings.value.llmApiKey);

// P2P 连接
const {
  isConnected,
  isRegistered,
  onlinePets,
  otherPets,
  autoChat,
  connect,
  register,
  sendMessage: sendP2PMessage,
  sendAction,
} = useP2P({
  onPetMessage: handlePetMessage,
  onPetOnline: handlePetOnline,
});

// LangChain Agent - 替代 useChat
// 必须在 motionDetails, availableExpressions, useP2P 之后初始化
const agent = useLangChainAgent({
  petName: currentPet.value.name,
  customPrompt: currentPet.value.prompt,
  // Live2D 回调
  onPlayMotion: (motionId: string) => {
    // 先尝试按 name 查找
    let motionInfo = motionDetails.value.find((m) => m.name === motionId);
    if (!motionInfo && motionId.includes(":")) {
      // 再尝试 group:name 格式
      const [group, name] = motionId.split(":");
      motionInfo = motionDetails.value.find(
        (m) => m.group === group && m.name === name,
      );
    }
    if (motionInfo) {
      live2dRef.value?.playMotionByIndex(motionInfo.group, motionInfo.index);
    } else {
      live2dRef.value?.playMotion(motionId);
    }
    // 同步动作给其他宠物
    if (isConnected.value && isRegistered.value) {
      sendAction("motion", motionId);
    }
  },
  onSetExpression: (name: string) => {
    live2dRef.value?.setExpression(name);
    // 同步表情给其他宠物
    if (isConnected.value && isRegistered.value) {
      sendAction("expression", name);
    }
  },
  onResetExpression: () => {
    // 重置到默认表情
    const defaultExpression = availableExpressions.value[0];
    if (defaultExpression) {
      live2dRef.value?.setExpression(defaultExpression);
    }
  },
  // 认知回调
  onThinking: (thought: string) => {
    console.log("[Agent Thinking]", thought);
    // 添加到聊天记录
    addThinkingMessage(currentPet.value.name, thought);
    // 显示内心独白气泡
    showBubble(thought, currentPet.value.name, true);
  },
  widgetContext: widgetAgentContext,
});

watch(enabledWidgetToolSignature, () => {
  void agent.setWidgetContext(widgetAgentContext);
});

// 当前显示的气泡消息
const currentBubble = ref<{
  message: string;
  speaker: string | null;
  isInnerMonologue?: boolean;
} | null>(null);
let bubbleTimeout: ReturnType<typeof setTimeout> | null = null;

// 显示气泡
const showBubble = (
  message: string,
  speaker: string | null,
  isInnerMonologue: boolean = false,
) => {
  if (!settings.value.showBubble) return;

  currentBubble.value = { message, speaker, isInnerMonologue };

  if (bubbleTimeout) {
    clearTimeout(bubbleTimeout);
  }

  bubbleTimeout = setTimeout(() => {
    currentBubble.value = null;
  }, settings.value.bubbleDuration);
};

// 发送消息
const handleSend = async (message: string) => {
  if (!message.trim() || agent.isLoading.value) return;

  // 添加用户消息到聊天记录（不显示气泡）
  addUserMessage("主人", `对 ${currentPet.value.name} 说: ${message}`);

  // 如果已连接服务器，广播用户消息给其他宠物
  if (isConnected.value && isRegistered.value) {
    sendP2PMessage(message, undefined, {
      messageType: "master_to_pet",
      toName: currentPet.value.name,
    });
  }

  try {
    // 初始化 agent（仅首次）
    if (!agent.isInitialized.value) {
      // 先使用 LLM 分析动作（失败则回退简单模式）
      const llmConfig = {
        provider: settings.value.llmProvider,
        apiKey: settings.value.llmApiKey,
        baseUrl: settings.value.llmBaseUrl,
        model: settings.value.llmModel,
      };
      await agent.analyzeAndSetActions(
        motionDetails.value,
        availableExpressions.value,
        llmConfig,
      );
      await agent.initAgent(llmConfig);
    }

    // 发送消息 - agent 会自动处理工具调用
    const response = await agent.sendMessage(message);

    // 显示回复（工具调用已在 agent 内部通过回调自动处理）
    if (response.content) {
      showBubble(response.content, currentPet.value.name);
      addPetMessage(currentPet.value.name, response.content);
    }
  } catch (error) {
    console.error("Chat error:", error);
    const errorMsg = "抱歉，出了点问题...";
    showBubble(errorMsg, currentPet.value.name);
    addPetMessage(currentPet.value.name, errorMsg);
  }
};

// 处理其他宠物的消息
async function handlePetMessage(message: PetMessage) {
  console.log("Received pet message:", message);

  if (message.from === currentPet.value.name) {
    return;
  }

  let displayContent = message.content;
  if (!message.isDirectTarget) {
    if (message.messageType === "master_to_pet") {
      displayContent = `[主人] 对 [${message.toName || message.from}] 说: ${
        message.content
      }`;
    } else if (message.messageType === "pet_to_pet") {
      displayContent = `[${message.from}] 对 [${message.toName}] 说: ${message.content}`;
    }
  }

  addOtherPetMessage(message.from, displayContent);
}

// 处理新宠物上线
function handlePetOnline(pet: PetInfo) {
  if (autoChat.value) {
    live2dRef.value?.playMotion("Flick");
    const welcomeMsg = `${pet.name} 来了~`;
    showBubble(welcomeMsg, null);
  }
}

// 主动打招呼
const sayHelloTo = (pet: PetInfo) => {
  if (!isConnected.value || !isRegistered.value) return;

  const greetings = [
    `${pet.name}，你好呀~`,
    `嘿，${pet.name}！`,
    `${pet.name}，在干嘛呢？`,
  ];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];

  addPetMessage(currentPet.value.name, `对 [${pet.name}] 说: ${greeting}`);
  sendP2PMessage(greeting, pet.id, {
    messageType: "pet_to_pet",
    toName: pet.name,
  });

  showBubble(greeting, null);
  live2dRef.value?.playMotion("Flick");
};

// 切换面板
const toggleTestPanel = () => {
  showTestPanel.value = !showTestPanel.value;
  if (showTestPanel.value) {
    showAdjustPanel.value = false;
    showPetsPanel.value = false;
    showWidgetPanel.value = false;
  }
};

const toggleAdjustPanel = () => {
  showAdjustPanel.value = !showAdjustPanel.value;
  if (showAdjustPanel.value) {
    showTestPanel.value = false;
    showPetsPanel.value = false;
    showWidgetPanel.value = false;
  }
};

const togglePetsPanel = () => {
  showPetsPanel.value = !showPetsPanel.value;
  if (showPetsPanel.value) {
    showTestPanel.value = false;
    showAdjustPanel.value = false;
    showWidgetPanel.value = false;
  }
};

const toggleWidgetPanel = () => {
  showWidgetPanel.value = !showWidgetPanel.value;
  if (showWidgetPanel.value) {
    showTestPanel.value = false;
    showAdjustPanel.value = false;
    showPetsPanel.value = false;
  }
};

const openHistoryWindow = async () => {
  try {
    await openChatHistoryWindow();
  } catch (error) {
    console.error("Failed to open chat history window:", error);
  }
};

const launchWidget = async (type: Exclude<WidgetType, "photo">) => {
  let widget = widgets.value.find((item) => item.type === type);
  if (!widget) widget = addWidget(type) || undefined;
  if (!widget) {
    console.error(`Failed to create ${type} widget`);
    return;
  }
  if (!widget.enabled) toggleWidget(widget.id);

  showWidgetPanel.value = false;
  try {
    await openWidgetWindow(type, widget.id);
  } catch (error) {
    console.error(`Failed to open ${type} widget window:`, error);
  }
};

// 打开设置页面
const openSettings = async () => {
  showTestPanel.value = false;
  showAdjustPanel.value = false;
  showPetsPanel.value = false;
  showWidgetPanel.value = false;
  currentView.value = "settings";

  // 桌面端：进入设置页时停止鼠标检测并禁用点击穿透
  if (isDesktop.value) {
    stopMousePositionCheck();
    try {
      await appWindow.setIgnoreCursorEvents(false);
    } catch (e) {
      console.error("Failed to disable cursor ignore:", e);
    }
  }
};

// 返回主页
const backToHome = async () => {
  currentView.value = "home";

  // 桌面端：返回主页时重新启动鼠标检测并启用点击穿透
  if (isDesktop.value) {
    isHoveringLive2D.value = false;
    try {
      await appWindow.setIgnoreCursorEvents(true);
    } catch (e) {
      console.error("Failed to enable cursor ignore:", e);
    }
    startMousePositionCheck();
  }
};

// 测试动作
const testMotionByIndex = (group: string, index: number) => {
  live2dRef.value?.playMotionByIndex(group, index);
};

// 测试表情
const testExpression = (name: string) => {
  live2dRef.value?.setExpression(name);
};

// 重置变换
const resetTransform = () => {
  live2dTransform.value = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
};

// 监听设置变化，自动连接服务器
watch(
  () => [settings.value.serverUrl, settings.value.autoConnect] as const,
  ([serverUrl, autoConnect]) => {
    if (autoConnect && serverUrl && !isConnected.value) {
      console.log("Auto connecting to server:", serverUrl);
      connect(serverUrl);
    }
  },
  { immediate: true },
);

// 连接成功后自动注册
watch(isConnected, (connected) => {
  if (connected && !isRegistered.value) {
    register({
      name: currentPet.value.name,
      modelPath: currentPet.value.modelPath,
    });
  }
});

// 监听 Live2D 模型动作/表情变化，自动更新 agent 工具
watch([motionDetails, availableExpressions], ([newMotions, newExpressions]) => {
  if (
    agent.isInitialized.value &&
    (newMotions.length > 0 || newExpressions.length > 0)
  ) {
    agent.analyzeAndSetActions(newMotions, newExpressions, {
      provider: settings.value.llmProvider,
      apiKey: settings.value.llmApiKey,
      baseUrl: settings.value.llmBaseUrl,
      model: settings.value.llmModel,
    });
  }
});

// P2P 注册成功后，接入 agent 的通信上下文
watch(isRegistered, (registered) => {
  if (registered) {
    agent.setP2PContext({
      getOnlinePets: () => onlinePets.value,
      getRecentMessages: () => [],
      sendMessageToPet: (targetId, content) =>
        sendP2PMessage(content, targetId),
      broadcastMessage: (content) => sendP2PMessage(content),
    });
  }
});

// 加载插件 manifest 并创建工具
const loadPlugins = async () => {
  try {
    const dataDir = await appDataDir();
    const pluginsDir = await join(dataDir, "plugins");

    let entries;
    try {
      entries = await readDir(pluginsDir);
    } catch {
      console.log("[Plugins] No plugins directory found, skipping");
      return;
    }

    const manifests: PluginManifest[] = [];
    for (const entry of entries) {
      if (!entry.children && !entry.name) continue;
      try {
        const manifestPath = await join(
          pluginsDir,
          entry.name!,
          "manifest.json",
        );
        const content = await readTextFile(manifestPath);
        const manifest = JSON.parse(content) as PluginManifest;
        manifests.push(manifest);
        console.log(`[Plugins] Loaded manifest: ${manifest.name}`);
      } catch {
        // Skip invalid plugin directories
      }
    }

    if (manifests.length === 0) return;

    const tools = manifests.flatMap((manifest) =>
      createPluginTools(
        manifest,
        async (
          pluginId: string,
          toolName: string,
          args: Record<string, unknown>,
        ) => {
          return await invoke("plugin_execute_tool", {
            pluginId,
            toolName,
            arguments: args,
          });
        },
      ),
    );

    if (tools.length > 0) {
      await agent.setPluginTools(tools);
      console.log(
        `[Plugins] Injected ${tools.length} plugin tools into agent`,
      );
    }
  } catch (error) {
    console.error("[Plugins] Failed to load plugins:", error);
  }
};

onMounted(async () => {
  isDesktop.value = isDesktopPlatform();
  console.log("TableFri Desktop started");
  console.log("Platform detection:", {
    isDesktop: isDesktop.value,
    hasTauri: "__TAURI__" in window,
  });

  // 桌面端默认启用点击穿透，并启动鼠标位置检测
  if (isDesktop.value) {
    try {
      await appWindow.setIgnoreCursorEvents(true);
      // 启动鼠标位置轮询检测（即使窗口忽略鼠标事件也能检测）
      startMousePositionCheck();
    } catch (e) {
      console.error("Failed to enable initial cursor ignore:", e);
    }

    // 加载桌面端插件
    loadPlugins();
  }
});

onUnmounted(() => {
  stopMousePositionCheck();
  cancelHoverHide();
});
</script>

<template>
  <div class="app-container" :style="backgroundStyle">
    <!-- 桌面端窗口控制 -->
    <Transition name="fade">
      <WindowControls
        v-if="isDesktop && currentView !== 'settings'"
        v-show="showHoverUI"
        data-hover-ui
        :is-locked="isLocked"
        @toggle-lock="toggleLocked"
      />
    </Transition>

    <!-- 设置页面 -->
    <SettingsView v-if="currentView === 'settings'" @back="backToHome" />

    <!-- 主页内容 -->
    <template v-else>
      <div
        v-show="showHoverUI"
        class="pet-toolbar"
        data-hover-ui
        :style="hoverToolbarStyle"
      >
      <!-- 设置按钮 -->
      <Transition name="fade">
        <button
          v-show="showHoverUI"
          class="settings-btn"
          title="设置"
          @click="openSettings"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
            />
          </svg>
        </button>
      </Transition>

      <!-- 调整按钮 -->
      <Transition name="fade">
        <button
          v-show="showHoverUI"
          class="adjust-btn"
          title="调整模型"
          @click="toggleAdjustPanel"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"
            />
          </svg>
        </button>
      </Transition>

      <!-- 测试按钮 -->
      <Transition name="fade">
        <button
          v-show="showHoverUI"
          class="test-btn"
          title="测试动作"
          @click="toggleTestPanel"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3h7zM7 9H4V5h3v4zm10 6h3v4h-3v-4zm0-10v4h3V5h-3z"
            />
          </svg>
        </button>
      </Transition>

      <!-- 在线宠物按钮 -->
      <Transition name="fade">
        <button
          v-show="showHoverUI"
          class="pets-btn"
          title="在线宠物"
          @click="togglePetsPanel"
          :class="{ connected: isConnected }"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
            />
          </svg>
          <span v-if="otherPets.length > 0" class="pet-count">{{
            otherPets.length
          }}</span>
        </button>
      </Transition>

      <!-- 独立对话记录窗口 -->
      <Transition name="fade">
        <button
          v-show="showHoverUI"
          class="history-btn"
          title="打开对话记录窗口"
          @click="openHistoryWindow"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h16v12H6.34L4 18.34V4zm2 2v7.52L7.52 12H18V6H6zm2 2h8v2H8V8z" />
          </svg>
        </button>
      </Transition>

      <!-- 桌面小组件 -->
      <Transition name="fade">
        <button
          v-show="showHoverUI"
          class="widgets-btn"
          title="桌面小组件"
          @click="toggleWidgetPanel"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v5h-8V3zm2 2v1h4V5h-4zm-2 5h8v11h-8V10zm2 2v7h4v-7h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5z" />
          </svg>
        </button>
      </Transition>
      </div>

      <!-- 测试面板 -->
      <Transition name="panel">
        <div
          v-if="showTestPanel"
          class="test-panel"
          data-hover-ui
          :style="hoverPanelStyle"
        >
          <div class="panel-title">动作测试</div>

          <template v-if="Object.keys(motionsByGroup).length > 0">
            <div
              v-for="(motions, groupName) in motionsByGroup"
              :key="groupName"
              class="motion-section"
            >
              <div class="section-label">{{ groupName }}</div>
              <div class="motion-buttons">
                <button
                  v-for="motion in motions"
                  :key="`${groupName}-${motion.index}`"
                  class="motion-btn"
                  @click="testMotionByIndex(String(groupName), motion.index)"
                >
                  {{ motion.name }}
                </button>
              </div>
            </div>
          </template>

          <div v-if="availableExpressions.length > 0" class="motion-section">
            <div class="section-label">表情</div>
            <div class="motion-buttons">
              <button
                v-for="expression in availableExpressions"
                :key="expression"
                class="motion-btn expression"
                @click="testExpression(expression)"
              >
                {{ expression }}
              </button>
            </div>
          </div>

          <div
            v-if="
              Object.keys(motionsByGroup).length === 0 &&
              availableExpressions.length === 0
            "
            class="no-motions"
          >
            <p>暂无可用动作</p>
            <p class="hint">请先配置 Live2D 模型</p>
          </div>
        </div>
      </Transition>

      <!-- 调整面板 -->
      <Transition name="panel">
        <div
          v-if="showAdjustPanel"
          class="adjust-panel"
          data-hover-ui
          :style="hoverPanelStyle"
        >
          <div class="panel-title">Live2D 调整</div>

          <div class="slider-group">
            <div class="slider-label">
              <span>缩放</span>
              <span class="slider-value"
                >{{ live2dTransform.scale.toFixed(1) }}x</span
              >
            </div>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              v-model.number="live2dTransform.scale"
              class="slider"
            />
          </div>

          <div class="slider-group">
            <div class="slider-label">
              <span>水平位置</span>
              <span class="slider-value">{{ live2dTransform.offsetX }}%</span>
            </div>
            <input
              type="range"
              min="-50"
              max="50"
              step="1"
              v-model.number="live2dTransform.offsetX"
              class="slider"
            />
          </div>

          <div class="slider-group">
            <div class="slider-label">
              <span>垂直位置</span>
              <span class="slider-value">{{ live2dTransform.offsetY }}%</span>
            </div>
            <input
              type="range"
              min="-50"
              max="50"
              step="1"
              v-model.number="live2dTransform.offsetY"
              class="slider"
            />
          </div>

          <button class="reset-btn" @click="resetTransform">重置</button>
        </div>
      </Transition>

      <!-- 在线宠物面板 -->
      <Transition name="panel">
        <div
          v-if="showPetsPanel"
          class="pets-panel"
          data-hover-ui
          :style="hoverPanelStyle"
        >
          <div class="panel-title">
            在线宠物
            <span class="connection-status" :class="{ connected: isConnected }">
              {{ isConnected ? "已连接" : "未连接" }}
            </span>
          </div>

          <div v-if="!isConnected" class="no-connection">
            <p>未连接到服务器</p>
            <p class="hint">请在设置中配置服务器地址</p>
          </div>

          <template v-else>
            <!-- 自己的信息 -->
            <div v-if="isRegistered" class="my-pet-info">
              <div class="pet-avatar me">
                {{ currentPet.name.charAt(0) }}
              </div>
              <div class="pet-details">
                <span class="pet-name">{{ currentPet.name }}</span>
                <span class="pet-hint me-tag">（我）</span>
              </div>
            </div>

            <!-- 其他宠物 -->
            <div v-if="otherPets.length === 0" class="no-pets">
              <p>暂无其他宠物在线</p>
              <p class="hint">等待其他宠物加入...</p>
            </div>

            <div v-else class="pet-list">
              <div
                v-for="pet in otherPets"
                :key="pet.id"
                class="pet-item"
                @click="sayHelloTo(pet)"
              >
                <div class="pet-avatar">
                  {{ pet.name.charAt(0) }}
                </div>
                <div class="pet-details">
                  <span class="pet-name">{{ pet.name }}</span>
                  <span class="pet-hint">点击打招呼</span>
                </div>
              </div>
            </div>

            <!-- 在线统计 -->
            <div class="online-stats">
              共 {{ onlinePets.length }} 只宠物在线
            </div>
          </template>

          <div class="auto-chat-toggle">
            <label class="toggle-label">
              <input type="checkbox" v-model="autoChat" />
              <span class="toggle-text">自动对话</span>
            </label>
          </div>
        </div>
      </Transition>

      <Transition name="panel">
        <div
          v-if="showWidgetPanel"
          class="widget-launcher-panel"
          data-hover-ui
          :style="hoverPanelStyle"
        >
          <div class="panel-title">桌面小组件</div>
          <button class="widget-launcher-item" @click="launchWidget('clock')">
            <span>🕐</span>
            <div><strong>时钟</strong><small>时间、日期和显示格式</small></div>
          </button>
          <button class="widget-launcher-item" @click="launchWidget('weather')">
            <span>🌤️</span>
            <div><strong>天气</strong><small>城市实时天气</small></div>
          </button>
          <button class="widget-launcher-item" @click="launchWidget('todo')">
            <span>📝</span>
            <div><strong>待办</strong><small>与 Agent 共享待办数据</small></div>
          </button>
        </div>
      </Transition>

      <!-- Live2D 画布 -->
      <div
        class="live2d-area"
        @mouseenter="onLive2DEnter"
        @mouseleave="onLive2DLeave"
      >
        <Live2DCanvas ref="live2dRef" />
      </div>

      <!-- 聊天气泡 -->
      <Transition name="bubble">
        <div
          v-if="currentBubble || agent.isLoading.value"
          class="bubble-container"
        >
          <ChatBubble
            :message="currentBubble?.message || ''"
            :speaker="currentBubble?.speaker"
            :is-thinking="agent.isLoading.value && !currentBubble"
            :is-inner-monologue="currentBubble?.isInnerMonologue"
          />
        </div>
      </Transition>

      <!-- 宠物信息标签 -->
      <div class="pet-info">
        <span class="pet-name">{{ currentPet.name }}</span>
        <span class="ai-status" :class="{ active: isLLMConfigured }">
          {{ isLLMConfigured ? "AI" : "离线" }}
        </span>
        <span v-if="isConnected" class="p2p-status">P2P</span>
      </div>

      <!-- 输入框 -->
      <Transition name="fade">
        <div v-show="showHoverUI" class="input-area" data-hover-ui>
          <ChatInput
            @send="handleSend"
            :disabled="agent.isLoading.value"
            placeholder="和宠物说点什么..."
          />
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  background-size: cover;
  background-position: center;
}

.live2d-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.pet-toolbar {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 24px;
  background: rgba(20, 20, 24, 0.38);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(12px);
  transform: translateX(-50%);
  z-index: 30;
}

/* 功能按钮基础样式 */
.settings-btn,
.adjust-btn,
.test-btn,
.pets-btn,
.history-btn,
.widgets-btn {
  position: absolute;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.pet-toolbar .settings-btn,
.pet-toolbar .adjust-btn,
.pet-toolbar .test-btn,
.pet-toolbar .pets-btn,
.pet-toolbar .history-btn,
.pet-toolbar .widgets-btn {
  position: relative;
  inset: auto;
  flex: 0 0 auto;
}

.settings-btn:hover,
.adjust-btn:hover,
.test-btn:hover,
.pets-btn:hover,
.history-btn:hover,
.widgets-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.settings-btn:active,
.adjust-btn:active,
.test-btn:active,
.pets-btn:active,
.history-btn:active,
.widgets-btn:active {
  transform: scale(0.95);
}

.settings-btn svg,
.adjust-btn svg,
.test-btn svg,
.pets-btn svg,
.history-btn svg,
.widgets-btn svg {
  width: 20px;
  height: 20px;
  color: white;
}

.settings-btn:hover {
  transform: rotate(30deg);
}

.pets-btn.connected {
  background: rgba(76, 175, 80, 0.3);
}

.pets-btn.connected:hover {
  background: rgba(76, 175, 80, 0.4);
}

.pet-count {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #ff5722;
  color: white;
  font-size: 10px;
  font-weight: 600;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 面板样式 */
.test-panel,
.adjust-panel,
.pets-panel,
.widget-launcher-panel {
  position: absolute;
  right: auto;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 12px;
  z-index: 20;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  max-width: 280px;
  max-height: 420px;
  overflow-y: auto;
}

.widget-launcher-panel {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.widget-launcher-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: 9px;
  padding: 9px;
  color: #333;
  background: #f5f6fa;
  text-align: left;
  cursor: pointer;
}

.widget-launcher-item:hover {
  background: #e9ebf5;
}

.widget-launcher-item > span {
  font-size: 22px;
}

.widget-launcher-item div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.widget-launcher-item small {
  color: #858995;
  font-size: 10px;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 设置面板样式 */
.settings-section {
  margin-bottom: 14px;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.section-label {
  font-size: 10px;
  color: #888;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.input-group {
  margin-bottom: 10px;
}

.input-group label {
  display: block;
  font-size: 11px;
  color: #666;
  margin-bottom: 4px;
}

.input-group input[type="text"],
.input-group input[type="password"] {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 12px;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.input-group input:focus {
  outline: none;
  border-color: #667eea;
}

.toggle-group {
  margin-top: 8px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #333;
}

.toggle-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #667eea;
}

/* 动作按钮 */
.motion-section {
  margin-bottom: 10px;
}

.motion-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.motion-btn {
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.motion-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
}

.motion-btn.expression {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.no-motions,
.no-connection,
.no-pets {
  text-align: center;
  padding: 12px 0;
  color: #666;
  font-size: 12px;
}

.hint {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
}

/* 滑块样式 */
.slider-group {
  margin-bottom: 14px;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #333;
  margin-bottom: 6px;
}

.slider-value {
  color: #667eea;
  font-weight: 500;
}

.slider {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: #e0e0e0;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.4);
}

.reset-btn {
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: #f5f5f5;
  color: #666;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.reset-btn:hover {
  background: #eeeeee;
  color: #333;
}

/* 在线宠物面板 */
.connection-status {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #ffebee;
  color: #c62828;
}

.connection-status.connected {
  background: #e8f5e9;
  color: #2e7d32;
}

.my-pet-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.1) 0%,
    rgba(118, 75, 162, 0.1) 100%
  );
  border-radius: 8px;
  margin-bottom: 10px;
  border: 1px solid rgba(102, 126, 234, 0.2);
}

.pet-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
}

.pet-avatar.me {
  background: linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);
}

.pet-details {
  display: flex;
  flex-direction: column;
}

.pet-details .pet-name {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.pet-hint {
  font-size: 10px;
  color: #999;
}

.me-tag {
  color: #4caf50;
  font-weight: 500;
}

.pet-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pet-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pet-item:hover {
  background: #eeeeee;
  transform: translateX(4px);
}

.online-stats {
  text-align: center;
  font-size: 11px;
  color: #666;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed #eee;
}

.auto-chat-toggle {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #eee;
}

.toggle-text {
  font-size: 12px;
  color: #333;
}

/* 气泡 */
.bubble-container {
  position: absolute;
  top: 90px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  z-index: 10;
}

/* 宠物信息 */
.pet-info {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  padding: 6px 12px;
  border-radius: 16px;
}

.pet-info .pet-name {
  color: white;
  font-size: 13px;
  font-weight: 500;
}

.ai-status {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.8);
}

.ai-status.active {
  background: #4caf50;
  color: white;
}

.p2p-status {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 8px;
  background: #2196f3;
  color: white;
}

/* 输入框 */
.input-area {
  position: absolute;
  bottom: 20px;
  left: 20px;
  right: 20px;
  z-index: 10;
}

/* 面板动画 */
.panel-enter-active,
.panel-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px) scale(0.95);
}

/* 气泡动画 */
.bubble-enter-active,
.bubble-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.bubble-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px) scale(0.9);
}

.bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px) scale(0.95);
}

/* 淡入淡出动画 */
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
