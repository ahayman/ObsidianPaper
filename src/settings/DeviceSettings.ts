import type { App } from "obsidian";
import type { RenderPipeline, RenderEngineType } from "../types";
import type { ToolbarPosition } from "../view/toolbar/ToolbarTypes";

export type MaxZoomLevel = 5 | 10;
export type TileMemoryBudgetMB = 200 | 400 | 600 | 1000;

export interface DeviceSettings {
  defaultRenderPipeline: RenderPipeline;
  defaultRenderEngine: RenderEngineType;
  palmRejection: boolean;
  fingerAction: "pan" | "draw";
  toolbarPosition: ToolbarPosition;
  autoHideToolbar: boolean;
  maxZoomLevel: MaxZoomLevel;
  tileMemoryBudgetMB: TileMemoryBudgetMB;
  enableRotation: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  defaultRenderPipeline: "basic",
  defaultRenderEngine: "canvas2d",
  palmRejection: true,
  fingerAction: "pan",
  toolbarPosition: "top",
  autoHideToolbar: true,
  maxZoomLevel: 5,
  tileMemoryBudgetMB: 200,
  enableRotation: true,
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

    // Enforce minimum memory budget for 10x zoom
    if (settings.maxZoomLevel === 10 && settings.tileMemoryBudgetMB < 400) {
      settings.tileMemoryBudgetMB = 400;
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
