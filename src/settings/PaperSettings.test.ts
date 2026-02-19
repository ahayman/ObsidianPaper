import { DEFAULT_SETTINGS, mergeSettings } from "./PaperSettings";
import type { PaperSettings } from "./PaperSettings";

describe("PaperSettings", () => {
  describe("DEFAULT_SETTINGS", () => {
    it("should have valid pen defaults", () => {
      expect(DEFAULT_SETTINGS.defaultPenType).toBe("ballpoint");
      expect(DEFAULT_SETTINGS.defaultColorId).toBe("ink-black");
      expect(DEFAULT_SETTINGS.defaultWidth).toBe(2);
      expect(DEFAULT_SETTINGS.pressureSensitivity).toBe(1.0);
    });

    it("should have valid canvas defaults", () => {
      expect(DEFAULT_SETTINGS.defaultPaperType).toBe("blank");
      expect(DEFAULT_SETTINGS.defaultBackgroundColor).toMatch(/^#/);
      expect(DEFAULT_SETTINGS.gridSize).toBeGreaterThan(0);
      expect(DEFAULT_SETTINGS.lineSpacing).toBeGreaterThan(0);
    });

    it("should have valid input defaults", () => {
      expect(DEFAULT_SETTINGS.palmRejection).toBe(true);
      expect(DEFAULT_SETTINGS.fingerAction).toBe("pan");
    });

    it("should have valid smoothing default", () => {
      expect(DEFAULT_SETTINGS.defaultSmoothing).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_SETTINGS.defaultSmoothing).toBeLessThanOrEqual(1);
    });

    it("should have valid file defaults", () => {
      expect(DEFAULT_SETTINGS.defaultFolder).toBe("");
      expect(DEFAULT_SETTINGS.fileNameTemplate).toBe("Untitled Paper");
    });
  });

  describe("mergeSettings", () => {
    it("should return defaults when null is passed", () => {
      const result = mergeSettings(null);
      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it("should return defaults when empty object is passed", () => {
      const result = mergeSettings({});
      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it("should override specific fields", () => {
      const result = mergeSettings({
        defaultPenType: "brush",
        defaultWidth: 5,
      });
      expect(result.defaultPenType).toBe("brush");
      expect(result.defaultWidth).toBe(5);
      // Rest should be defaults
      expect(result.defaultColorId).toBe("ink-black");
      expect(result.palmRejection).toBe(true);
    });

    it("should preserve all overridden fields", () => {
      const custom: PaperSettings = {
        defaultPenType: "fountain",
        defaultColorId: "ink-blue",
        defaultWidth: 3,
        pressureSensitivity: 0.8,
        defaultPaperType: "lined",
        defaultBackgroundColor: "#fdf6e3",
        showGrid: true,
        gridSize: 50,
        lineSpacing: 40,
        palmRejection: false,
        fingerAction: "draw",
        defaultSmoothing: 0.7,
        defaultFolder: "Papers/",
        fileNameTemplate: "Note",
        defaultFormat: "paper.md",
      };
      const result = mergeSettings(custom);
      expect(result).toEqual(custom);
    });

    it("should not mutate the input", () => {
      const input: Partial<PaperSettings> = { defaultWidth: 10 };
      const result = mergeSettings(input);
      result.defaultWidth = 99;
      expect(input.defaultWidth).toBe(10);
    });
  });
});
