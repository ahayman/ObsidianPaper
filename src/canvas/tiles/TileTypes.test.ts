import {
  tileKeyString,
  zoomToZoomBand,
  zoomBandBaseZoom,
  tileSizePhysicalForBand,
  DEFAULT_TILE_CONFIG,
} from "./TileTypes";
import type { TileKey, TileGridConfig } from "./TileTypes";

describe("tileKeyString", () => {
  it("produces unique strings for different keys", () => {
    const a: TileKey = { col: 0, row: 0 };
    const b: TileKey = { col: 1, row: 0 };
    const c: TileKey = { col: 0, row: 1 };

    const strings = [tileKeyString(a), tileKeyString(b), tileKeyString(c)];
    expect(new Set(strings).size).toBe(3);
  });

  it("produces the same string for the same key", () => {
    const a: TileKey = { col: 3, row: -2 };
    const b: TileKey = { col: 3, row: -2 };
    expect(tileKeyString(a)).toBe(tileKeyString(b));
  });

  it("handles negative coordinates", () => {
    const key: TileKey = { col: -1, row: -1 };
    expect(tileKeyString(key)).toBe("-1,-1");
  });
});

describe("zoomToZoomBand", () => {
  it("returns 0 for zoom = 1.0", () => {
    expect(zoomToZoomBand(1.0)).toBe(0);
  });

  it("returns negative bands for zoom < 1", () => {
    expect(zoomToZoomBand(0.5)).toBe(-2);
    expect(zoomToZoomBand(0.25)).toBe(-4);
  });

  it("returns positive bands for zoom > 1", () => {
    expect(zoomToZoomBand(2.0)).toBe(2);
    expect(zoomToZoomBand(4.0)).toBe(4);
  });

  it("snaps to floor within a band", () => {
    // zoom = 1.2 → log2(1.2) ≈ 0.263 → 0.263 * 2 ≈ 0.526 → floor = 0
    expect(zoomToZoomBand(1.2)).toBe(0);
    // zoom = 1.5 → log2(1.5) ≈ 0.585 → 0.585 * 2 ≈ 1.17 → floor = 1
    expect(zoomToZoomBand(1.5)).toBe(1);
  });
});

describe("zoomBandBaseZoom", () => {
  it("returns 1.0 for band 0", () => {
    expect(zoomBandBaseZoom(0)).toBe(1.0);
  });

  it("returns sqrt(2) for band 1", () => {
    expect(zoomBandBaseZoom(1)).toBeCloseTo(Math.SQRT2, 10);
  });

  it("returns 2.0 for band 2", () => {
    expect(zoomBandBaseZoom(2)).toBeCloseTo(2.0, 10);
  });

  it("returns 0.5 for band -2", () => {
    expect(zoomBandBaseZoom(-2)).toBeCloseTo(0.5, 10);
  });

  it("round-trips: zoomBandBaseZoom(zoomToZoomBand(z)) ≤ z", () => {
    for (const z of [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0]) {
      const band = zoomToZoomBand(z);
      const baseZoom = zoomBandBaseZoom(band);
      expect(baseZoom).toBeLessThanOrEqual(z * 1.001); // Allow floating point tolerance
    }
  });
});

describe("tileSizePhysicalForBand", () => {
  const config: TileGridConfig = {
    tileWorldSize: 512,
    dpr: 2,
    maxMemoryBytes: 200 * 1024 * 1024,
    overscanTiles: 1,
    maxTilePhysical: 2048,
    minTilePhysical: 256,
  };

  it("returns ideal size for band 0 (zoom 1.0)", () => {
    // 512 * 1.0 * 2 = 1024
    expect(tileSizePhysicalForBand(config, 0)).toBe(1024);
  });

  it("returns ideal size for band 2 (zoom 2.0)", () => {
    // 512 * 2.0 * 2 = 2048
    expect(tileSizePhysicalForBand(config, 2)).toBe(2048);
  });

  it("clamps to maxTilePhysical for high bands", () => {
    // Band 3: 512 * 2.83 * 2 ≈ 2899 → capped at 2048
    expect(tileSizePhysicalForBand(config, 3)).toBe(2048);
    // Band 4: 512 * 4.0 * 2 = 4096 → capped at 2048
    expect(tileSizePhysicalForBand(config, 4)).toBe(2048);
  });

  it("clamps to minTilePhysical for low bands", () => {
    // Band -6: 512 * 0.125 * 2 = 128 → clamped to 256
    expect(tileSizePhysicalForBand(config, -6)).toBe(256);
  });

  it("scales with DPR", () => {
    const lowDpr = { ...config, dpr: 1 };
    // Band 0: 512 * 1.0 * 1 = 512
    expect(tileSizePhysicalForBand(lowDpr, 0)).toBe(512);
  });
});

describe("DEFAULT_TILE_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_TILE_CONFIG.tileWorldSize).toBe(128);
    expect(DEFAULT_TILE_CONFIG.dpr).toBe(2);
    expect(DEFAULT_TILE_CONFIG.maxMemoryBytes).toBe(200 * 1024 * 1024);
    expect(DEFAULT_TILE_CONFIG.overscanTiles).toBe(1);
    expect(DEFAULT_TILE_CONFIG.maxTilePhysical).toBe(2048);
    expect(DEFAULT_TILE_CONFIG.minTilePhysical).toBe(128);
  });
});
