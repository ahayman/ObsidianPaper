import {
  EXTENDED_PALETTE,
  EXTENDED_PALETTE_CONTRAST,
  PALETTE_COLUMNS,
  PALETTE_ROWS,
} from "./ExtendedPalette";
import { perceivedLuminance } from "./ColorUtils";

describe("ExtendedPalette", () => {
  it("has the expected number of entries", () => {
    expect(EXTENDED_PALETTE).toHaveLength(PALETTE_COLUMNS * PALETTE_ROWS);
  });

  it("has no duplicate IDs", () => {
    const ids = EXTENDED_PALETTE.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has valid light hex", () => {
    for (const color of EXTENDED_PALETTE) {
      expect(color.light).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("every entry has valid dark hex", () => {
    for (const color of EXTENDED_PALETTE) {
      expect(color.dark).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("includes the original 10 semantic colors", () => {
    const originalIds = [
      "ink-black", "ink-gray", "ink-red", "ink-orange", "ink-blue",
      "ink-green", "ink-purple", "ink-pink", "ink-brown", "ink-teal",
    ];
    const extIds = new Set(EXTENDED_PALETTE.map((c) => c.id));
    for (const id of originalIds) {
      expect(extIds.has(id)).toBe(true);
    }
  });

  it("every entry has a non-empty name", () => {
    for (const color of EXTENDED_PALETTE) {
      expect(color.name.length).toBeGreaterThan(0);
    }
  });
});

describe("ExtendedPaletteContrast", () => {
  it("has the expected number of entries", () => {
    expect(EXTENDED_PALETTE_CONTRAST).toHaveLength(PALETTE_COLUMNS * PALETTE_ROWS);
  });

  it("has no duplicate IDs", () => {
    const ids = EXTENDED_PALETTE_CONTRAST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has valid light hex", () => {
    for (const color of EXTENDED_PALETTE_CONTRAST) {
      expect(color.light).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("every entry has valid dark hex", () => {
    for (const color of EXTENDED_PALETTE_CONTRAST) {
      expect(color.dark).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("preserves the same light values as brightness palette", () => {
    for (let i = 0; i < EXTENDED_PALETTE.length; i++) {
      expect(EXTENDED_PALETTE_CONTRAST[i].light).toBe(EXTENDED_PALETTE[i].light);
    }
  });

  it("preserves IDs and names from brightness palette", () => {
    for (let i = 0; i < EXTENDED_PALETTE.length; i++) {
      expect(EXTENDED_PALETTE_CONTRAST[i].id).toBe(EXTENDED_PALETTE[i].id);
      expect(EXTENDED_PALETTE_CONTRAST[i].name).toBe(EXTENDED_PALETTE[i].name);
    }
  });

  it("dark values are luminance-descending within each column", () => {
    for (let col = 0; col < PALETTE_COLUMNS; col++) {
      for (let row = 0; row < PALETTE_ROWS - 1; row++) {
        const current = EXTENDED_PALETTE_CONTRAST[row * PALETTE_COLUMNS + col];
        const next = EXTENDED_PALETTE_CONTRAST[(row + 1) * PALETTE_COLUMNS + col];
        const lumCurrent = perceivedLuminance(current.dark);
        const lumNext = perceivedLuminance(next.dark);
        expect(lumCurrent).toBeGreaterThanOrEqual(lumNext);
      }
    }
  });

  it("includes the original 10 semantic colors", () => {
    const originalIds = [
      "ink-black", "ink-gray", "ink-red", "ink-orange", "ink-blue",
      "ink-green", "ink-purple", "ink-pink", "ink-brown", "ink-teal",
    ];
    const extIds = new Set(EXTENDED_PALETTE_CONTRAST.map((c) => c.id));
    for (const id of originalIds) {
      expect(extIds.has(id)).toBe(true);
    }
  });
});
