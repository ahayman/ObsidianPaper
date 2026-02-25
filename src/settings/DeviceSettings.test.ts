import { App } from "obsidian";
import {
  DEFAULT_DEVICE_SETTINGS,
  DEVICE_SETTINGS_KEY,
  loadDeviceSettings,
  saveDeviceSettings,
} from "./DeviceSettings";
import type { DeviceSettings } from "./DeviceSettings";

describe("DeviceSettings", () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  describe("loadDeviceSettings", () => {
    it("should return defaults when localStorage is empty", () => {
      const result = loadDeviceSettings(app);
      expect(result).toEqual(DEFAULT_DEVICE_SETTINGS);
    });

    it("should return defaults when localStorage has invalid JSON", () => {
      app.saveLocalStorage(DEVICE_SETTINGS_KEY, "not json");
      const result = loadDeviceSettings(app);
      expect(result).toEqual(DEFAULT_DEVICE_SETTINGS);
    });

    it("should merge partial data with defaults", () => {
      app.saveLocalStorage(DEVICE_SETTINGS_KEY, JSON.stringify({ defaultRenderEngine: "webgl" }));
      const result = loadDeviceSettings(app);
      expect(result.defaultRenderEngine).toBe("webgl");
      expect(result.defaultRenderPipeline).toBe("basic");
      expect(result.palmRejection).toBe(true);
      expect(result.fingerAction).toBe("pan");
      expect(result.toolbarPosition).toBe("top");
    });

    it("should load full settings", () => {
      const saved: DeviceSettings = {
        defaultRenderPipeline: "advanced",
        defaultRenderEngine: "webgl",
        palmRejection: false,
        fingerAction: "draw",
        toolbarPosition: "bottom",
      };
      app.saveLocalStorage(DEVICE_SETTINGS_KEY, JSON.stringify(saved));
      const result = loadDeviceSettings(app);
      expect(result).toEqual(saved);
    });

    it("should migrate legacy 'textures' pipeline to 'advanced'", () => {
      app.saveLocalStorage(DEVICE_SETTINGS_KEY, JSON.stringify({ defaultRenderPipeline: "textures" }));
      const result = loadDeviceSettings(app);
      expect(result.defaultRenderPipeline).toBe("advanced");
    });

    it("should migrate legacy 'stamps' pipeline to 'advanced'", () => {
      app.saveLocalStorage(DEVICE_SETTINGS_KEY, JSON.stringify({ defaultRenderPipeline: "stamps" }));
      const result = loadDeviceSettings(app);
      expect(result.defaultRenderPipeline).toBe("advanced");
    });

    it("should load input and toolbar settings", () => {
      app.saveLocalStorage(DEVICE_SETTINGS_KEY, JSON.stringify({
        palmRejection: false,
        fingerAction: "draw",
        toolbarPosition: "left",
      }));
      const result = loadDeviceSettings(app);
      expect(result.palmRejection).toBe(false);
      expect(result.fingerAction).toBe("draw");
      expect(result.toolbarPosition).toBe("left");
    });
  });

  describe("saveDeviceSettings", () => {
    it("should save and be loadable", () => {
      const settings: DeviceSettings = {
        defaultRenderPipeline: "advanced",
        defaultRenderEngine: "webgl",
        palmRejection: false,
        fingerAction: "draw",
        toolbarPosition: "bottom",
      };
      saveDeviceSettings(app, settings);
      const result = loadDeviceSettings(app);
      expect(result).toEqual(settings);
    });

    it("should overwrite previous settings", () => {
      saveDeviceSettings(app, { ...DEFAULT_DEVICE_SETTINGS, defaultRenderPipeline: "basic" });
      saveDeviceSettings(app, { ...DEFAULT_DEVICE_SETTINGS, defaultRenderPipeline: "advanced", toolbarPosition: "right" });
      const result = loadDeviceSettings(app);
      expect(result.defaultRenderPipeline).toBe("advanced");
      expect(result.toolbarPosition).toBe("right");
    });
  });

  describe("DEFAULT_DEVICE_SETTINGS", () => {
    it("should have expected defaults", () => {
      expect(DEFAULT_DEVICE_SETTINGS.defaultRenderPipeline).toBe("basic");
      expect(DEFAULT_DEVICE_SETTINGS.defaultRenderEngine).toBe("canvas2d");
      expect(DEFAULT_DEVICE_SETTINGS.palmRejection).toBe(true);
      expect(DEFAULT_DEVICE_SETTINGS.fingerAction).toBe("pan");
      expect(DEFAULT_DEVICE_SETTINGS.toolbarPosition).toBe("top");
    });
  });
});
