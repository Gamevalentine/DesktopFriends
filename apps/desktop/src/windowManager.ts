import { WebviewWindow } from "@tauri-apps/api/window";
import type { WidgetType } from "@desktopfriends/shared";

const focusOrCreateWindow = async (
  label: string,
  options: ConstructorParameters<typeof WebviewWindow>[1],
) => {
  const existing = WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show();
    await existing.unminimize();
    await existing.setFocus();
    return existing;
  }

  return new Promise<WebviewWindow>((resolve, reject) => {
    const window = new WebviewWindow(label, options);
    window.once("tauri://created", () => resolve(window));
    window.once<string>("tauri://error", (event) => reject(event.payload));
  });
};

export const openChatHistoryWindow = () =>
  focusOrCreateWindow("chat-history", {
    url: "/?view=chat-history",
    title: "TableFri · 对话记录",
    width: 560,
    height: 720,
    minWidth: 380,
    minHeight: 460,
    center: true,
    resizable: true,
    transparent: false,
    decorations: true,
    alwaysOnTop: false,
    focus: true,
  });

const widgetWindowOptions: Record<
  Exclude<WidgetType, "photo">,
  { title: string; width: number; height: number; minWidth: number; minHeight: number }
> = {
  clock: {
    title: "时钟",
    width: 340,
    height: 220,
    minWidth: 280,
    minHeight: 180,
  },
  weather: {
    title: "天气",
    width: 380,
    height: 330,
    minWidth: 320,
    minHeight: 280,
  },
  todo: {
    title: "待办",
    width: 400,
    height: 520,
    minWidth: 340,
    minHeight: 380,
  },
};

export const openWidgetWindow = async (
  type: Exclude<WidgetType, "photo">,
  widgetId: string,
) => {
  const { title, ...size } = widgetWindowOptions[type];
  const legacyWindow = WebviewWindow.getByLabel(`widget-${type}`);
  if (legacyWindow) await legacyWindow.close();
  return focusOrCreateWindow(`widget-glass-${type}`, {
    url: `/?view=widget&type=${type}&widgetId=${encodeURIComponent(widgetId)}`,
    title: `TableFri · ${title}`,
    ...size,
    center: true,
    resizable: true,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    focus: true,
  });
};
