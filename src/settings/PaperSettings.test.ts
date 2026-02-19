import { DEFAULT_SETTINGS, mergeSettings, resolvePageSize } from "./PaperSettings";
import type { PaperSettings } from "./PaperSettings";
import { PAGE_SIZE_PRESETS, PPI, CM_PER_INCH } from "../types";

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
        spacingUnit: "cm",
        marginTop: 100,
        marginBottom: 50,
        marginLeft: 50,
        marginRight: 50,
        defaultPageSize: "a4",
        defaultOrientation: "landscape",
        defaultLayoutDirection: "horizontal",
        customPageUnit: "cm",
        customPageWidth: 21,
        customPageHeight: 29.7,
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

  describe("resolvePageSize", () => {
    it("should return US Letter preset by default", () => {
      const size = resolvePageSize(DEFAULT_SETTINGS);
      expect(size).toEqual(PAGE_SIZE_PRESETS["us-letter"]);
      expect(size.width).toBe(612);
      expect(size.height).toBe(792);
    });

    it("should return correct preset for each page size", () => {
      const presets: Array<[string, number, number]> = [
        ["us-letter", 612, 792],
        ["us-legal", 612, 1008],
        ["a4", 595, 842],
        ["a5", 420, 595],
        ["a3", 842, 1191],
      ];
      for (const [preset, w, h] of presets) {
        const settings = { ...DEFAULT_SETTINGS, defaultPageSize: preset as PaperSettings["defaultPageSize"] };
        const size = resolvePageSize(settings);
        expect(size.width).toBe(w);
        expect(size.height).toBe(h);
      }
    });

    it("should convert custom inches to world units at 72 PPI", () => {
      const settings: PaperSettings = {
        ...DEFAULT_SETTINGS,
        defaultPageSize: "custom",
        customPageUnit: "in",
        customPageWidth: 8.5,
        customPageHeight: 11,
      };
      const size = resolvePageSize(settings);
      expect(size.width).toBe(Math.round(8.5 * PPI)); // 612
      expect(size.height).toBe(Math.round(11 * PPI)); // 792
    });

    it("should convert custom centimeters to world units at 72 PPI", () => {
      const settings: PaperSettings = {
        ...DEFAULT_SETTINGS,
        defaultPageSize: "custom",
        customPageUnit: "cm",
        customPageWidth: 21,
        customPageHeight: 29.7,
      };
      const size = resolvePageSize(settings);
      const factor = PPI / CM_PER_INCH;
      expect(size.width).toBe(Math.round(21 * factor));
      expect(size.height).toBe(Math.round(29.7 * factor));
    });
  });
});
