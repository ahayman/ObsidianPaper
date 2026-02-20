import {
  COLOR_PALETTE,
  resolveColor,
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
    it("should pass through hex values directly", () => {
      expect(resolveColor("#ff0000", false)).toBe("#ff0000");
      expect(resolveColor("#ff0000", true)).toBe("#ff0000");
    });

    it("should resolve dual-hex format in light mode", () => {
      expect(resolveColor("#aabbcc|#112233", false)).toBe("#aabbcc");
    });

    it("should resolve dual-hex format in dark mode", () => {
      expect(resolveColor("#aabbcc|#112233", true)).toBe("#112233");
    });

    it("should return default for unknown IDs", () => {
      const light = resolveColor("unknown-color", false);
      const dark = resolveColor("unknown-color", true);

      expect(light).toBe("#1a1a1a");
      expect(dark).toBe("#e8e8e8");
    });
  });
});
