import { TileCache } from "./TileCache";
import type { TileGridConfig, TileKey } from "./TileTypes";
import { tileKeyString } from "./TileTypes";

// Mock OffscreenCanvas for tests (jsdom doesn't have it)
class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): MockCtx {
    return new MockCtx();
  }
}

class MockCtx {
  setTransform(): void {}
  clearRect(): void {}
}

// Install mock before tests
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).OffscreenCanvas = MockOffscreenCanvas;
});

function makeConfig(overrides?: Partial<TileGridConfig>): TileGridConfig {
  return {
    tileWorldSize: 512,
    dpr: 2,
    maxMemoryBytes: 200 * 1024 * 1024,
    overscanTiles: 1,
    maxTilePhysical: 2048,
    minTilePhysical: 256,
    resolutionScale: 1,
    ...overrides,
  };
}

describe("TileCache", () => {
  describe("allocate and get", () => {
    it("allocates a new tile and retrieves it after marking clean", () => {
      const cache = new TileCache(makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const bounds: [number, number, number, number] = [0, 0, 512, 512];

      const entry = cache.allocate(key, bounds, 0);
      expect(entry.dirty).toBe(true);
      expect(entry.key).toEqual(key);
      expect(entry.worldBounds).toEqual(bounds);
      expect(entry.renderedAtBand).toBe(0);
      expect(cache.size).toBe(1);

      // get() returns undefined for dirty tiles
      expect(cache.get(key)).toBeUndefined();

      // After marking clean, get() returns the entry
      cache.markClean(key);
      expect(cache.get(key)).toBe(entry);
    });

    it("reuses existing entry on re-allocate at same band", () => {
      const cache = new TileCache(makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const bounds: [number, number, number, number] = [0, 0, 512, 512];

      const entry1 = cache.allocate(key, bounds, 0);
      cache.markClean(key);

      const newBounds: [number, number, number, number] = [0, 0, 512, 512];
      const entry2 = cache.allocate(key, newBounds, 0);

      expect(entry2).toBe(entry1); // Same object (canvas reused)
      expect(entry2.dirty).toBe(true);
      expect(entry2.strokeIds.size).toBe(0);
      expect(cache.size).toBe(1);
    });

    it("resizes canvas on re-allocate at different band", () => {
      const cache = new TileCache(makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const bounds: [number, number, number, number] = [0, 0, 512, 512];

      const entry1 = cache.allocate(key, bounds, 0); // band 0 → 1024px
      expect(entry1.canvas.width).toBe(1024);
      cache.markClean(key);

      // Re-allocate at band 2 → 2048px
      const entry2 = cache.allocate(key, bounds, 2);
      expect(entry2.canvas.width).toBe(2048);
      expect(entry2.renderedAtBand).toBe(2);
      expect(cache.size).toBe(1);
    });
  });

  describe("getStale", () => {
    it("returns dirty tiles", () => {
      const cache = new TileCache(makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const bounds: [number, number, number, number] = [0, 0, 512, 512];

      cache.allocate(key, bounds, 0);
      // Dirty tile returned by getStale
      expect(cache.getStale(key)).toBeDefined();
      // But not by get
      expect(cache.get(key)).toBeUndefined();
    });
  });

  describe("invalidateStroke", () => {
    it("marks tiles containing the stroke as dirty", () => {
      const cache = new TileCache(makeConfig());
      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };

      const entry1 = cache.allocate(key1, [0, 0, 512, 512], 0);
      entry1.strokeIds.add("stroke-1");
      cache.markClean(key1);

      const entry2 = cache.allocate(key2, [512, 0, 1024, 512], 0);
      entry2.strokeIds.add("stroke-2");
      cache.markClean(key2);

      const affected = cache.invalidateStroke("stroke-1");
      expect(affected).toEqual([key1]);
      expect(entry1.dirty).toBe(true);
      expect(entry2.dirty).toBe(false);
    });

    it("returns multiple affected tiles", () => {
      const cache = new TileCache(makeConfig());
      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };

      const entry1 = cache.allocate(key1, [0, 0, 512, 512], 0);
      entry1.strokeIds.add("stroke-1");
      cache.markClean(key1);

      const entry2 = cache.allocate(key2, [512, 0, 1024, 512], 0);
      entry2.strokeIds.add("stroke-1"); // Same stroke spans both tiles
      cache.markClean(key2);

      const affected = cache.invalidateStroke("stroke-1");
      expect(affected.length).toBe(2);
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest tile when memory budget exceeded", () => {
      // Band 0 at dpr 2: 1024px → 1024*1024*4 = 4MB per tile
      // Set budget to allow only 2 tiles
      const tileMemory = 1024 * 1024 * 4;
      const cache = new TileCache(makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };
      const key3: TileKey = { col: 2, row: 0 };

      cache.allocate(key1, [0, 0, 512, 512], 0);
      cache.allocate(key2, [512, 0, 1024, 512], 0);

      expect(cache.size).toBe(2);

      // Allocating a 3rd tile should evict the oldest (key1)
      cache.allocate(key3, [1024, 0, 1536, 512], 0);

      expect(cache.size).toBe(2);
      expect(cache.getStale(key1)).toBeUndefined(); // evicted
      expect(cache.getStale(key2)).toBeDefined();
      expect(cache.getStale(key3)).toBeDefined();
    });

    it("does not evict protected tiles", () => {
      const tileMemory = 1024 * 1024 * 4;
      const cache = new TileCache(makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };
      const key3: TileKey = { col: 2, row: 0 };

      cache.allocate(key1, [0, 0, 512, 512], 0);
      cache.allocate(key2, [512, 0, 1024, 512], 0);

      // Protect key1 from eviction
      cache.protect(new Set([tileKeyString(key1)]));

      // Allocating a 3rd tile should evict key2 (oldest unprotected)
      cache.allocate(key3, [1024, 0, 1536, 512], 0);

      expect(cache.size).toBe(2);
      expect(cache.getStale(key1)).toBeDefined(); // protected, not evicted
      expect(cache.getStale(key2)).toBeUndefined(); // evicted
      expect(cache.getStale(key3)).toBeDefined();

      cache.unprotect();
    });

    it("stops evicting when only protected tiles remain", () => {
      const tileMemory = 1024 * 1024 * 4;
      const cache = new TileCache(makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };
      const key3: TileKey = { col: 2, row: 0 };

      cache.allocate(key1, [0, 0, 512, 512], 0);
      cache.allocate(key2, [512, 0, 1024, 512], 0);

      // Protect both existing tiles
      cache.protect(new Set([tileKeyString(key1), tileKeyString(key2)]));

      // Allocating a 3rd tile: can't evict, so cache grows beyond budget
      cache.allocate(key3, [1024, 0, 1536, 512], 0);

      expect(cache.size).toBe(3);
      expect(cache.getStale(key1)).toBeDefined();
      expect(cache.getStale(key2)).toBeDefined();
      expect(cache.getStale(key3)).toBeDefined();

      cache.unprotect();
    });
  });

  describe("getDirtyTiles", () => {
    it("returns dirty tiles, visible first", () => {
      const cache = new TileCache(makeConfig());
      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };
      const key3: TileKey = { col: 2, row: 0 };

      cache.allocate(key1, [0, 0, 512, 512], 0);
      cache.allocate(key2, [512, 0, 1024, 512], 0);
      cache.allocate(key3, [1024, 0, 1536, 512], 0);

      // Mark key2 as clean
      cache.markClean(key2);

      const visibleKeys = new Set([tileKeyString(key3)]);
      const dirty = cache.getDirtyTiles(visibleKeys);

      expect(dirty.length).toBe(2); // key1 and key3
      // key3 is visible, should come first
      expect(dirty[0].key).toEqual(key3);
      expect(dirty[1].key).toEqual(key1);
    });
  });

  describe("clear", () => {
    it("removes all tiles and resets memory", () => {
      const cache = new TileCache(makeConfig());
      cache.allocate({ col: 0, row: 0 }, [0, 0, 512, 512], 0);
      cache.allocate({ col: 1, row: 0 }, [512, 0, 1024, 512], 0);

      expect(cache.size).toBe(2);
      expect(cache.memoryUsage).toBeGreaterThan(0);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.memoryUsage).toBe(0);
    });
  });
});
