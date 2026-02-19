import {
  COLOR_PALETTE,
  resolveColor,
  getSemanticColor,
  isSemanticColor,
} from "./ColorPalette";

describe("ColorPalette", () => {
  describe("COLOR_PALETTE", () => {
    it("should have 10 colors", () => {
      expect(COLOR_PALETTE).toHaveLength(10);
    });

    it("should have valid hex values for all colors", () => {
      for (const color of COLOR_PALETTE) {
        expect(color.light).toMatch(/^#[0-9a-f]{6}$/i);
        expect(color.dark).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it("should have unique IDs", () => {
      const ids = COLOR_PALETTE.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("resolveColor", () => {
    it("should return light color in light mode", () => {
      expect(resolveColor("ink-black", false)).toBe("#1a1a1a");
      expect(resolveColor("ink-blue", false)).toBe("#2563eb");
    });

    it("should return dark color in dark mode", () => {
      expect(resolveColor("ink-black", true)).toBe("#e8e8e8");
      expect(resolveColor("ink-blue", true)).toBe("#60a5fa");
    });

    it("should pass through hex values directly", () => {
      expect(resolveColor("#ff0000", false)).toBe("#ff0000");
      expect(resolveColor("#ff0000", true)).toBe("#ff0000");
    });

    it("should return default for unknown IDs", () => {
      const light = resolveColor("unknown-color", false);
      const dark = resolveColor("unknown-color", true);

      expect(light).toMatch(/^#/);
      expect(dark).toMatch(/^#/);
    });

    it("should resolve all palette colors correctly", () => {
      for (const color of COLOR_PALETTE) {
        expect(resolveColor(color.id, false)).toBe(color.light);
        expect(resolveColor(color.id, true)).toBe(color.dark);
      }
    });
  });

  describe("getSemanticColor", () => {
    it("should return color entry for valid ID", () => {
      const color = getSemanticColor("ink-red");
      expect(color).toBeDefined();
      expect(color!.name).toBe("Red");
      expect(color!.light).toBe("#dc2626");
    });

    it("should return undefined for unknown ID", () => {
      expect(getSemanticColor("unknown")).toBeUndefined();
    });
  });

  describe("isSemanticColor", () => {
    it("should return true for palette colors", () => {
      expect(isSemanticColor("ink-black")).toBe(true);
      expect(isSemanticColor("ink-teal")).toBe(true);
    });

    it("should return false for hex colors", () => {
      expect(isSemanticColor("#ff0000")).toBe(false);
    });

    it("should return false for unknown IDs", () => {
      expect(isSemanticColor("custom-color")).toBe(false);
    });
  });
});
