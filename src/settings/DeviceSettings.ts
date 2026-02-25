import type { App } from "obsidian";
import type { RenderPipeline, RenderEngineType } from "../types";
import type { ToolbarPosition } from "../view/toolbar/ToolbarTypes";

export interface DeviceSettings {
  defaultRenderPipeline: RenderPipeline;
  defaultRenderEngine: RenderEngineType;
  palmRejection: boolean;
  fingerAction: "pan" | "draw";
  toolbarPosition: ToolbarPosition;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  defaultRenderPipeline: "basic",
  defaultRenderEngine: "canvas2d",
  palmRejection: true,
  fingerAction: "pan",
  toolbarPosition: "top",
};

export const DEVICE_SETTINGS_KEY = "paper-device-settings";

/**
 * Load device-specific settings from localStorage (never syncs across devices).
 */
export function loadDeviceSettings(app: App): DeviceSettings {
  const raw = app.loadLocalStorage(DEVICE_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_DEVICE_SETTINGS };

  try {
    const parsed = JSON.parse(raw) as Partial<DeviceSettings>;
    const settings = { ...DEFAULT_DEVICE_SETTINGS, ...parsed };

    // Migrate legacy pipeline values
    const rp = settings.defaultRenderPipeline as string;
    if (rp === "textures" || rp === "stamps") {
      settings.defaultRenderPipeline = "advanced";
    }

    return settings;
  } catch {
    return { ...DEFAULT_DEVICE_SETTINGS };
  }
}

/**
 * Save device-specific settings to localStorage.
 */
export function saveDeviceSettings(app: App, settings: DeviceSettings): void {
  app.saveLocalStorage(DEVICE_SETTINGS_KEY, JSON.stringify(settings));
}
