<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  onActivated,
  watch,
} from "vue";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";
import { isDesktopPlatform } from "@desktopfriends/platform";
import { useSettings } from "@desktopfriends/core";
import { convertFileSrc } from "@tauri-apps/api/tauri";

const convertToLocalfileUrl = (filePath: string): string =>
  convertFileSrc(filePath, "localfile");

const isFileSystemPath = (path: string): boolean => {
  if (/^[a-zA-Z]:[\\/]/.test(path)) return true;

  if (
    path.startsWith("/Users/") ||
    path.startsWith("/Library/") ||
    path.startsWith("/Applications/") ||
    path.startsWith("/Volumes/") ||
    path.startsWith("/private/") ||
    path.startsWith("/tmp/")
  ) {
    return true;
  }

  if (
    path.startsWith("/home/") ||
    path.startsWith("/var/") ||
    path.startsWith("/opt/") ||
    path.startsWith("/usr/")
  ) {
    return true;
  }

  return path.includes("Application Support") || path.includes("AppData");
};

export interface Live2DTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

// @ts-ignore
window.PIXI = PIXI;

// @ts-ignore - useSettings 返回类型包含 live2dTransform
const { currentPet, live2dTransform } = useSettings();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);
const renderWarning = ref(false);

export interface MotionInfo {
  group: string;
  name: string;
  index: number;
}

const availableMotions = ref<string[]>([]);
const availableExpressions = ref<string[]>([]);
const motionDetails = ref<MotionInfo[]>([]);

let app: PIXI.Application | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null;
let placeholder: PIXI.Text | null = null;
let baseScale = 1;
let naturalModelWidth = 0;
let naturalModelHeight = 0;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
let lastOrientation: "portrait" | "landscape" | null = null;

const tokenizeInteractionName = (value: string): string[] =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const HEAD_TOKENS = new Set(["head", "face", "mouth"]);
const BODY_TOKENS = new Set(["body", "torso", "chest"]);
const ACTION_TOKENS = new Set(["tap", "touch", "flick", "poke", "click"]);

const getHitKind = (hitAreas: string[]): "head" | "body" | "generic" => {
  for (const area of hitAreas) {
    const tokens = tokenizeInteractionName(area);
    if (tokens.some((token) => HEAD_TOKENS.has(token))) return "head";
  }

  for (const area of hitAreas) {
    const tokens = tokenizeInteractionName(area);
    if (tokens.some((token) => BODY_TOKENS.has(token))) return "body";
  }

  return "generic";
};

const getIdleMotionGroup = (): string | null => {
  const group = model?.internalModel?.motionManager?.groups?.idle;
  return typeof group === "string" ? group : null;
};

const chooseMotionGroup = (kind: "head" | "body" | "generic"): string | null => {
  const groups = availableMotions.value;
  if (groups.length === 0) return null;

  const idleGroup = getIdleMotionGroup();
  const idleNormalized = idleGroup?.toLowerCase();
  const areaTokens = kind === "head" ? HEAD_TOKENS : kind === "body" ? BODY_TOKENS : null;

  let bestGroup: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const group of groups) {
    const tokens = tokenizeInteractionName(group);
    const isIdle = idleNormalized
      ? group.toLowerCase() === idleNormalized
      : tokens.includes("idle");

    let score = isIdle ? -100 : 1;

    if (areaTokens && tokens.some((token) => areaTokens.has(token))) {
      score += 20;
    }
    if (tokens.some((token) => ACTION_TOKENS.has(token))) {
      score += 6;
    }

    if (score > bestScore) {
      bestScore = score;
      bestGroup = group;
    }
  }

  if (bestGroup && bestScore > -100) return bestGroup;
  return groups[0] ?? null;
};

const playBestMotion = async (kind: "head" | "body" | "generic") => {
  if (!model) return false;
  const group = chooseMotionGroup(kind);
  if (!group) return false;

  try {
    const started = await model.motion(group);
    console.log("Interaction motion:", kind, "->", group, started);
    return started !== false;
  } catch (e) {
    console.warn("Failed to play interaction motion:", group, e);
    return false;
  }
};

const playRandomExpression = async () => {
  if (!model || availableExpressions.value.length === 0) return false;

  try {
    const applied = await model.expression();
    console.log("Interaction expression applied:", applied);
    return applied !== false;
  } catch (e) {
    console.warn("Failed to apply interaction expression:", e);
    return false;
  }
};

const handleModelHit = async (hitAreas: string[]) => {
  const kind = getHitKind(hitAreas);
  console.log("Hit areas:", hitAreas, "kind:", kind);

  if (kind === "head") {
    await Promise.all([playBestMotion("head"), playRandomExpression()]);
    return;
  }

  if (kind === "body") {
    await playBestMotion("body");
    return;
  }

  await playBestMotion("generic");
};

const applyTransform = (transform: Live2DTransform) => {
  if (!model || !app) return;

  const finalScale = baseScale * transform.scale;
  const centerX = app.screen.width / 2;
  const centerY = app.screen.height / 2;
  const offsetX = (transform.offsetX / 100) * app.screen.width;
  const offsetY = (transform.offsetY / 100) * app.screen.height;

  model.scale.set(finalScale);
  model.position.set(centerX + offsetX, centerY + offsetY);
};

const refreshCanvas = () => {
  if (!app || !canvasRef.value) return;

  const parent = canvasRef.value.parentElement;
  if (parent) {
    app.renderer.resize(parent.clientWidth, parent.clientHeight);
  }

  if (model) {
    baseScale =
      Math.min(
        app.screen.width / naturalModelWidth,
        app.screen.height / naturalModelHeight,
      ) * 0.8;
    applyTransform(live2dTransform.value);
  }

  if (placeholder) {
    placeholder.position.set(app.screen.width / 2, app.screen.height / 2);
    placeholder.style.wordWrapWidth = app.screen.width * 0.8;
  }
};

const handleOrientationChange = () => {
  const currentOrientation =
    window.innerWidth > window.innerHeight ? "landscape" : "portrait";

  if (lastOrientation !== null && lastOrientation === currentOrientation) {
    return;
  }

  if (resizeTimeout) clearTimeout(resizeTimeout);

  resizeTimeout = setTimeout(() => {
    lastOrientation = currentOrientation;
    refreshCanvas();
  }, 100);
};

const extractModelCapabilities = () => {
  availableMotions.value = [];
  availableExpressions.value = [];
  motionDetails.value = [];

  try {
    const motionManager = model?.internalModel?.motionManager;
    const definitions = motionManager?.definitions;
    if (definitions) {
      const groups: string[] = [];
      const details: MotionInfo[] = [];

      for (const group in definitions) {
        const groupMotions = definitions[group];
        if (!Array.isArray(groupMotions) || groupMotions.length === 0) continue;

        groups.push(group);
        groupMotions.forEach(
          (
            motion: {
              Name?: string;
              name?: string;
              File?: string;
              file?: string;
            },
            index: number,
          ) => {
            const motionFile = motion.File || motion.file;
            let motionName = motion.Name || motion.name;

            if (!motionName && motionFile) {
              motionName =
                motionFile
                  .split(/[\\/]/)
                  .pop()
                  ?.replace(/\.(motion3?\.json|mtn)$/i, "") || `${group}_${index}`;
            }

            details.push({
              group,
              name: motionName || `${group}_${index}`,
              index,
            });
          },
        );
      }

      availableMotions.value = groups;
      motionDetails.value = details;
      console.log("Available motion groups:", groups);
    }
  } catch (e) {
    console.warn("Could not extract motions:", e);
  }

  try {
    const expressionManager =
      model?.internalModel?.motionManager?.expressionManager;
    const definitions = expressionManager?.definitions;

    if (Array.isArray(definitions)) {
      availableExpressions.value = definitions.map(
        (definition: { name?: string; Name?: string }, index: number) =>
          definition.name || definition.Name || String(index),
      );
      console.log("Available expressions:", availableExpressions.value);
    }
  } catch (e) {
    console.warn("Could not extract expressions:", e);
  }
};

const loadModel = async (modelPath: string) => {
  if (!app || !modelPath) return;

  isLoading.value = true;
  error.value = null;
  renderWarning.value = false;
  availableMotions.value = [];
  availableExpressions.value = [];
  motionDetails.value = [];

  if (model) {
    app.stage.removeChild(model);
    model.destroy();
    model = null;
  }

  if (placeholder) {
    app.stage.removeChild(placeholder);
    placeholder = null;
  }

  let finalPath = modelPath;
  if (isDesktopPlatform() && isFileSystemPath(modelPath)) {
    try {
      finalPath = convertToLocalfileUrl(modelPath);
      console.log("Converted path:", modelPath, "->", finalPath);
    } catch (e) {
      console.warn("Failed to convert file path:", e);
    }
  }

  try {
    console.log("Loading Live2D model:", finalPath);
    model = await Live2DModel.from(finalPath, {
      autoInteract: true,
      autoUpdate: true,
    });

    naturalModelWidth = model.width;
    naturalModelHeight = model.height;

    baseScale =
      Math.min(
        app.screen.width / naturalModelWidth,
        app.screen.height / naturalModelHeight,
      ) * 0.8;

    model.anchor.set(0.5, 0.5);
    applyTransform(live2dTransform.value);
    app.stage.addChild(model);

    extractModelCapabilities();

    model.on("hit", (hitAreas: string[]) => {
      void handleModelHit(hitAreas);
    });

    console.log("Model loaded successfully");

    const checkWebGLError = () => {
      if (app?.renderer.type !== PIXI.RENDERER_TYPE.WEBGL) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gl = (app.renderer as any).gl as WebGLRenderingContext;
      if (!gl) return;

      const glError = gl.getError();
      if (glError !== gl.NO_ERROR) {
        console.warn("WebGL error detected:", glError);
        renderWarning.value = true;
      }
    };

    const originalWarn = console.warn;
    let warningDetected = false;
    console.warn = function (...args: unknown[]) {
      const message = args.join(" ");
      if (
        message.includes("non-power-of-2") ||
        message.includes("RENDER WARNING") ||
        message.includes("not renderable")
      ) {
        warningDetected = true;
      }
      return originalWarn.apply(console, args);
    };

    setTimeout(() => {
      console.warn = originalWarn;
      if (warningDetected) {
        renderWarning.value = true;
      } else {
        checkWebGLError();
      }
    }, 1000);
  } catch (e) {
    console.error("Failed to load Live2D model:", e);
    error.value = "模型加载失败";
    showPlaceholder();
  } finally {
    isLoading.value = false;
  }
};

const showPlaceholder = () => {
  if (!app) return;

  placeholder = new PIXI.Text(
    error.value
      ? `${error.value}\n\n请检查模型路径是否正确`
      : "Live2D 宠物将在这里显示\n\n请在设置中配置模型路径\n或将模型放入 public/models 目录",
    {
      fontFamily: "Arial, sans-serif",
      fontSize: 16,
      fill: 0xffffff,
      align: "center",
      wordWrap: true,
      wordWrapWidth: app.screen.width * 0.8,
    },
  );
  placeholder.anchor.set(0.5);
  placeholder.position.set(app.screen.width / 2, app.screen.height / 2);
  app.stage.addChild(placeholder);
};

const tryAutoLoadModel = async () => {
  const commonPaths = [
    "/modules/hiyori_free_zh/runtime/hiyori_free_t08.model3.json",
    "/models/hiyori/hiyori.model3.json",
    "/models/Hiyori/Hiyori.model3.json",
    "/models/haru/haru.model3.json",
    "/models/Haru/Haru.model3.json",
    "/models/mao/mao.model3.json",
    "/models/shizuku/shizuku.model.json",
  ];

  for (const path of commonPaths) {
    try {
      const response = await fetch(path, { method: "HEAD" });
      if (response.ok) {
        await loadModel(path);
        return true;
      }
    } catch {
      // Try the next known path.
    }
  }
  return false;
};

onMounted(async () => {
  if (!canvasRef.value) return;

  const parent = canvasRef.value.parentElement;
  if (!parent) return;

  await new Promise((resolve) => requestAnimationFrame(resolve));

  lastOrientation =
    window.innerWidth > window.innerHeight ? "landscape" : "portrait";

  app = new PIXI.Application({
    view: canvasRef.value,
    backgroundAlpha: 0,
    preserveDrawingBuffer: true,
    width: parent.clientWidth,
    height: parent.clientHeight,
    antialias: true,
  });

  window.addEventListener("resize", handleOrientationChange);
  window.addEventListener("orientationchange", handleOrientationChange);
  if (screen.orientation) {
    screen.orientation.addEventListener("change", handleOrientationChange);
  }

  if (currentPet.value.modelPath) {
    await loadModel(currentPet.value.modelPath);
  } else {
    const found = await tryAutoLoadModel();
    if (!found) showPlaceholder();
  }
});

watch(
  () => currentPet.value.modelPath,
  async (newPath) => {
    if (newPath && app) await loadModel(newPath);
  },
);

watch(
  () => live2dTransform.value,
  (newTransform) => {
    applyTransform(newTransform);
  },
  { deep: true },
);

onActivated(async () => {
  if (!isDesktopPlatform()) return;

  if (app && currentPet.value.modelPath) {
    await loadModel(currentPet.value.modelPath);
  }
});

onUnmounted(() => {
  window.removeEventListener("resize", handleOrientationChange);
  window.removeEventListener("orientationchange", handleOrientationChange);
  if (screen.orientation) {
    screen.orientation.removeEventListener("change", handleOrientationChange);
  }

  if (resizeTimeout) clearTimeout(resizeTimeout);

  model?.destroy();
  app?.destroy(true);
});

const getModelBounds = () => {
  if (!model || !app || !canvasRef.value) return null;

  const bounds = model.getBounds();
  const canvasRect = canvasRef.value.getBoundingClientRect();
  const left = canvasRect.left + bounds.x;
  const top = canvasRect.top + bounds.y;
  const width = bounds.width;
  const height = bounds.height;

  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
};

const isPointOnModel = (windowX: number, windowY: number) => {
  if (!model || !app || !canvasRef.value) return false;

  const bounds = getModelBounds();
  if (
    !bounds ||
    windowX < bounds.left ||
    windowX > bounds.right ||
    windowY < bounds.top ||
    windowY > bounds.bottom
  ) {
    return false;
  }

  const canvasRect = canvasRef.value.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) return false;

  const canvasX =
    ((windowX - canvasRect.left) / canvasRect.width) * app.screen.width;
  const canvasY =
    ((windowY - canvasRect.top) / canvasRect.height) * app.screen.height;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extract = (app.renderer as any).plugins?.extract;
    if (!extract) return false;

    const readY = Math.max(0, app.screen.height - canvasY - 1);
    const pixel = extract.pixels(
      null,
      new PIXI.Rectangle(canvasX, readY, 1, 1),
    ) as Uint8Array;

    return pixel[3] >= 16;
  } catch {
    return false;
  }
};

defineExpose({
  loadModel,
  refreshCanvas,
  getModelBounds,
  isPointOnModel,
  playMotion: (group: string) => {
    if (!model) {
      console.warn("Model not loaded, cannot play motion");
      return;
    }
    void Promise.resolve(model.motion(group)).catch((e) =>
      console.warn("Failed to play motion:", group, e),
    );
  },
  playMotionByIndex: (group: string, index: number) => {
    if (!model) {
      console.warn("Model not loaded, cannot play motion");
      return;
    }
    void Promise.resolve(model.motion(group, index)).catch((e) =>
      console.warn("Failed to play motion:", group, index, e),
    );
  },
  setExpression: (name: string) => {
    if (!model) return;
    void Promise.resolve(model.expression(name)).catch((e) =>
      console.warn("Failed to set expression:", name, e),
    );
  },
  updateTransform: (transform: Live2DTransform) => {
    applyTransform(transform);
  },
  availableMotions,
  availableExpressions,
  motionDetails,
  isLoading,
  error,
});
</script>

<template>
  <div class="live2d-container">
    <canvas ref="canvasRef"></canvas>
    <div v-if="isLoading" class="loading-overlay">
      <div class="spinner"></div>
      <span>加载模型中...</span>
    </div>
    <div
      v-if="renderWarning"
      class="render-warning"
      @click="renderWarning = false"
    >
      <div class="warning-content">
        <div class="warning-icon">⚠️</div>
        <div class="warning-title">模型渲染异常</div>
        <div class="warning-text">
          该模型可能在移动端无法正常显示。
          <br /><br />
          <strong>原因：</strong>模型纹理尺寸不是 2 的幂次方（如
          256、512、1024） <br /><br />
          <strong>解决方案：</strong>
          <br />1. 使用图像编辑软件将纹理调整为 2 的幂次方尺寸 <br />2. 使用
          Cubism Editor 重新导出模型 <br />3. 更换其他兼容的模型
        </div>
        <div class="warning-dismiss">点击关闭</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.live2d-container {
  width: 100%;
  height: 100%;
  position: relative;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.3);
  color: white;
  font-size: 14px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.render-warning {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10;
  padding: 20px;
}

.warning-content {
  background: #2a2a2a;
  border-radius: 12px;
  padding: 20px;
  max-width: 320px;
  text-align: center;
  color: white;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.warning-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.warning-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 12px;
  color: #ffcc00;
}

.warning-text {
  font-size: 13px;
  line-height: 1.6;
  color: #ccc;
  text-align: left;
  margin-bottom: 16px;
}

.warning-text strong {
  color: #fff;
}

.warning-dismiss {
  font-size: 12px;
  color: #888;
  padding-top: 12px;
  border-top: 1px solid #444;
}
</style>
