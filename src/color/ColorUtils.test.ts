import {
  isDualHex,
  parseColorId,
  encodeDualHex,
  getColorDisplayName,
  hexToRgb,
  rgbToHex,
  hexToHsl,
  hslToHex,
} from "./ColorUtils";

// ─── isDualHex ──────────────────────────────────────────────

describe("isDualHex", () => {
  it("returns true for dual-hex format", () => {
    expect(isDualHex("#aabbcc|#ddeeff")).toBe(true);
  });

  it("returns false for single hex", () => {
    expect(isDualHex("#aabbcc")).toBe(false);
  });

  it("returns false for plain strings", () => {
    expect(isDualHex("something")).toBe(false);
  });
});

// ─── parseColorId ───────────────────────────────────────────

describe("parseColorId", () => {
  it("parses dual-hex format", () => {
    expect(parseColorId("#112233|#aabbcc")).toEqual({
      light: "#112233",
      dark: "#aabbcc",
    });
  });

  it("parses single hex (used for both themes)", () => {
    expect(parseColorId("#ff0000")).toEqual({
      light: "#ff0000",
      dark: "#ff0000",
    });
  });

  it("returns fallback for unknown non-hex strings", () => {
    const result = parseColorId("nonexistent");
    expect(result.light).toBe("#1a1a1a");
    expect(result.dark).toBe("#e8e8e8");
  });
});

// ─── encodeDualHex ──────────────────────────────────────────

describe("encodeDualHex", () => {
  it("encodes light and dark into pipe-delimited string", () => {
    expect(encodeDualHex("#ffffff", "#000000")).toBe("#ffffff|#000000");
  });
});

// ─── getColorDisplayName ────────────────────────────────────

describe("getColorDisplayName", () => {
  it("returns palette name for known dual-hex", () => {
    expect(getColorDisplayName("#1a1a1a|#e8e8e8")).toBe("Black");
    expect(getColorDisplayName("#2563eb|#60a5fa")).toBe("Blue");
    expect(getColorDisplayName("#dc2626|#f87171")).toBe("Red");
  });

  it("returns raw colorId for unknown dual-hex", () => {
    expect(getColorDisplayName("#aabbcc|#ddeeff")).toBe("#aabbcc|#ddeeff");
  });

  it("returns raw colorId for single hex", () => {
    expect(getColorDisplayName("#FFE066")).toBe("#FFE066");
  });
});

// ─── hexToRgb / rgbToHex ───────────────────────────────────

describe("hexToRgb", () => {
  it("converts 6-digit hex", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("#00ff00")).toEqual([0, 255, 0]);
    expect(hexToRgb("#0000ff")).toEqual([0, 0, 255]);
  });

  it("converts 3-digit shorthand", () => {
    expect(hexToRgb("#f00")).toEqual([255, 0, 0]);
    expect(hexToRgb("#abc")).toEqual([170, 187, 204]);
  });

  it("handles without hash prefix", () => {
    expect(hexToRgb("ff0000")).toEqual([255, 0, 0]);
  });
});

describe("rgbToHex", () => {
  it("converts RGB to hex", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
    expect(rgbToHex(0, 255, 0)).toBe("#00ff00");
    expect(rgbToHex(0, 0, 255)).toBe("#0000ff");
  });

  it("clamps values", () => {
    expect(rgbToHex(300, -10, 128)).toBe("#ff0080");
  });
});

// ─── hexToHsl / hslToHex ───────────────────────────────────

describe("hexToHsl", () => {
  it("converts red", () => {
    const [h, s, l] = hexToHsl("#ff0000");
    expect(h).toBeCloseTo(0, 0);
    expect(s).toBeCloseTo(1, 2);
    expect(l).toBeCloseTo(0.5, 2);
  });

  it("converts green", () => {
    const [h, s, l] = hexToHsl("#00ff00");
    expect(h).toBeCloseTo(120, 0);
    expect(s).toBeCloseTo(1, 2);
    expect(l).toBeCloseTo(0.5, 2);
  });

  it("converts white", () => {
    const [h, s, l] = hexToHsl("#ffffff");
    expect(s).toBeCloseTo(0, 2);
    expect(l).toBeCloseTo(1, 2);
  });

  it("converts black", () => {
    const [h, s, l] = hexToHsl("#000000");
    expect(s).toBeCloseTo(0, 2);
    expect(l).toBeCloseTo(0, 2);
  });
});

describe("hslToHex", () => {
  it("converts pure red", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
  });

  it("converts pure green", () => {
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
  });

  it("converts pure blue", () => {
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
  });

  it("converts gray (zero saturation)", () => {
    expect(hslToHex(0, 0, 0.5)).toBe("#808080");
  });

  it("roundtrips through hex→hsl→hex", () => {
    const colors = ["#dc2626", "#2563eb", "#16a34a", "#7c3aed", "#ea580c"];
    for (const hex of colors) {
      const [h, s, l] = hexToHsl(hex);
      const result = hslToHex(h, s, l);
      // Allow ±1 per channel due to rounding
      const [r1, g1, b1] = hexToRgb(hex);
      const [r2, g2, b2] = hexToRgb(result);
      expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(1);
      expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(1);
      expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(1);
    }
  });
});
