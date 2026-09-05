const SETTINGS_KEY = "desktopfriends-settings";
const DEFAULT_BACKGROUND_GRADIENT =
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";

/**
 * Desktop should behave like a real desktop pet out of the box: the host
 * window is transparent unless the user has explicitly chosen a background.
 *
 * This runs before App.vue is evaluated, so useSettings() reads the migrated
 * value on its first load. Mobile does not import this file.
 */
function applyDesktopTransparentBackgroundDefault() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);

    // Fresh desktop install: store only the desktop-specific override.
    // useSettings() will merge all other values from its normal defaults.
    if (!raw) {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          backgroundType: "preset",
          backgroundPreset: "transparent",
        }),
      );
      return;
    }

    const stored = JSON.parse(raw) as Record<string, unknown>;
    const backgroundType = stored.backgroundType ?? "gradient";
    const backgroundGradient =
      stored.backgroundGradient ?? DEFAULT_BACKGROUND_GRADIENT;
    const backgroundImage = stored.backgroundImage ?? "";
    const backgroundPreset = stored.backgroundPreset ?? "";

    // Only migrate the untouched factory-purple background. Custom images,
    // presets and custom gradients must remain exactly as the user selected.
    const isFactoryBackground =
      backgroundType === "gradient" &&
      backgroundGradient === DEFAULT_BACKGROUND_GRADIENT &&
      !backgroundImage &&
      !backgroundPreset;

    if (!isFactoryBackground) return;

    stored.backgroundType = "preset";
    stored.backgroundPreset = "transparent";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  } catch (error) {
    console.warn("[Desktop] Failed to apply transparent background default:", error);
  }
}

applyDesktopTransparentBackgroundDefault();
