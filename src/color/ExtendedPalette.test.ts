import { EXTENDED_PALETTE, PALETTE_COLUMNS, PALETTE_ROWS } from "./ExtendedPalette";

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
