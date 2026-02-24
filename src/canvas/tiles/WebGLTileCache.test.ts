/**
 * Unit tests for WebGLTileCache — GPU tile texture storage with LRU eviction.
 *
 * Mocks WebGL2RenderingContext and GLTextures functions since jsdom
 * doesn't support WebGL2.
 */

import { WebGLTileCache } from "./WebGLTileCache";
import type { GLTileEntry } from "./WebGLTileCache";
import type { TileKey, TileGridConfig } from "./TileTypes";
import { tileKeyString, tileSizePhysicalForBand } from "./TileTypes";
import * as GLTextures from "../engine/GLTextures";
import type { GLOffscreenTarget, GLMSAAOffscreenTarget } from "../engine/GLTextures";

// ─── Mock WebGL2 ────────────────────────────────────────────────

let textureIdCounter = 0;
let fboIdCounter = 0;
let rbIdCounter = 0;

function createMockGL(): WebGL2RenderingContext {
  const gl = {
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812F,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    FRAMEBUFFER: 0x8D40,
    COLOR_ATTACHMENT0: 0x8CE0,
    STENCIL_ATTACHMENT: 0x8D20,
    RENDERBUFFER: 0x8D41,
    STENCIL_INDEX8: 0x8D48,
    RGBA8: 0x8058,

    createTexture: jest.fn(() => ({ _id: ++textureIdCounter })),
    deleteTexture: jest.fn(),
    bindTexture: jest.fn(),
    texImage2D: jest.fn(),
    texParameteri: jest.fn(),
    pixelStorei: jest.fn(),

    createFramebuffer: jest.fn(() => ({ _id: ++fboIdCounter })),
    deleteFramebuffer: jest.fn(),
    bindFramebuffer: jest.fn(),
    framebufferTexture2D: jest.fn(),

    createRenderbuffer: jest.fn(() => ({ _id: ++rbIdCounter })),
    deleteRenderbuffer: jest.fn(),
    bindRenderbuffer: jest.fn(),
    renderbufferStorage: jest.fn(),
    framebufferRenderbuffer: jest.fn(),
  } as unknown as WebGL2RenderingContext;
  return gl;
}

// ─── Mock GLTextures ────────────────────────────────────────────

jest.mock("../engine/GLTextures", () => ({
  createOffscreenTarget: jest.fn((_gl: unknown, w: number, h: number): GLOffscreenTarget => ({
    fbo: { _id: ++fboIdCounter } as unknown as WebGLFramebuffer,
    colorTexture: { _id: ++textureIdCounter } as unknown as WebGLTexture,
    stencilRB: { _id: ++rbIdCounter } as unknown as WebGLRenderbuffer,
    width: w,
    height: h,
  })),
  destroyOffscreenTarget: jest.fn(),
  createMSAAOffscreenTarget: jest.fn((_gl: unknown, w: number, h: number, _samples: number): GLMSAAOffscreenTarget => ({
    resolveFBO: { _id: ++fboIdCounter } as unknown as WebGLFramebuffer,
    colorTexture: { _id: ++textureIdCounter } as unknown as WebGLTexture,
    msaaFBO: { _id: ++fboIdCounter } as unknown as WebGLFramebuffer,
    msaaColorRB: { _id: ++rbIdCounter } as unknown as WebGLRenderbuffer,
    msaaStencilRB: { _id: ++rbIdCounter } as unknown as WebGLRenderbuffer,
    samples: 4,
    width: w,
    height: h,
  })),
  destroyMSAAOffscreenTarget: jest.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────

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

function makeBounds(col: number, row: number, size = 512): [number, number, number, number] {
  return [col * size, row * size, (col + 1) * size, (row + 1) * size];
}

// ─── Tests ──────────────────────────────────────────────────────

describe("WebGLTileCache", () => {
  let gl: WebGL2RenderingContext;

  beforeEach(() => {
    textureIdCounter = 0;
    fboIdCounter = 0;
    rbIdCounter = 0;
    gl = createMockGL();
    jest.clearAllMocks();
  });

  describe("allocate and get", () => {
    it("allocates a new tile entry with MSAA target", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const bounds = makeBounds(0, 0);

      const entry = cache.allocate(key, bounds, 0);

      expect(entry.key).toEqual(key);
      expect(entry.worldBounds).toEqual(bounds);
      expect(entry.dirty).toBe(true);
      expect(entry.msaa).not.toBeNull();
      expect(entry.texture).toBeDefined();
      expect(entry.renderedAtBand).toBe(0);
      expect(entry.strokeIds.size).toBe(0);
      expect(cache.size).toBe(1);
      expect(cache.memoryUsage).toBeGreaterThan(0);

      expect(GLTextures.createMSAAOffscreenTarget).toHaveBeenCalledTimes(1);
    });

    it("MSAA resolve texture IS the entry texture (zero-copy)", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const entry = cache.allocate(key, makeBounds(0, 0), 0);

      expect(entry.texture).toBe(entry.msaa!.colorTexture);
    });

    it("get() returns undefined for dirty tiles", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      cache.allocate(key, makeBounds(0, 0), 0);

      expect(cache.get(key)).toBeUndefined();
    });

    it("get() returns entry after marking clean", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const entry = cache.allocate(key, makeBounds(0, 0), 0);
      cache.markClean(key);

      expect(cache.get(key)).toBe(entry);
    });

    it("getStale() returns dirty tiles", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const entry = cache.allocate(key, makeBounds(0, 0), 0);

      expect(cache.getStale(key)).toBe(entry);
    });

    it("getStale() returns undefined for non-existent tiles", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      expect(cache.getStale({ col: 99, row: 99 })).toBeUndefined();
    });

    it("reuses existing entry on re-allocate at same band", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };

      const entry1 = cache.allocate(key, makeBounds(0, 0), 0);
      cache.markClean(key);
      entry1.strokeIds.add("stroke-1");

      const entry2 = cache.allocate(key, makeBounds(0, 0), 0);

      expect(entry2).toBe(entry1); // Same object reused
      expect(entry2.dirty).toBe(true);
      expect(entry2.strokeIds.size).toBe(0); // Cleared
      expect(cache.size).toBe(1);

      // createMSAAOffscreenTarget called only once (for initial allocate)
      expect(GLTextures.createMSAAOffscreenTarget).toHaveBeenCalledTimes(1);
    });

    it("recreates MSAA target on re-allocate at different band (different size)", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };

      const entry1 = cache.allocate(key, makeBounds(0, 0), 0);
      const oldMsaa = entry1.msaa;
      cache.markClean(key);

      // Band 2 → 2048px vs band 0 → 1024px
      const entry2 = cache.allocate(key, makeBounds(0, 0), 2);

      expect(entry2).toBe(entry1); // Same entry object mutated
      expect(entry2.msaa).not.toBe(oldMsaa); // New MSAA target
      expect(entry2.renderedAtBand).toBe(2);
      expect(GLTextures.destroyMSAAOffscreenTarget).toHaveBeenCalledTimes(1);
      expect(GLTextures.createMSAAOffscreenTarget).toHaveBeenCalledTimes(2);
    });

    it("computes correct memory bytes (tilePhysical² × 4)", () => {
      const config = makeConfig();
      const cache = new WebGLTileCache(gl, config);
      const key: TileKey = { col: 0, row: 0 };

      cache.allocate(key, makeBounds(0, 0), 0);

      const tilePhysical = tileSizePhysicalForBand(config, 0); // 1024
      const expectedMem = tilePhysical * tilePhysical * 4;
      expect(cache.memoryUsage).toBe(expectedMem);
    });

    it("updates lastAccess on get() and getStale()", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      cache.allocate(key, makeBounds(0, 0), 0);
      cache.markClean(key);

      const before = performance.now();
      const entry = cache.get(key)!;
      expect(entry.lastAccess).toBeGreaterThanOrEqual(before);

      const before2 = performance.now();
      cache.getStale(key);
      expect(entry.lastAccess).toBeGreaterThanOrEqual(before2);
    });
  });

  describe("uploadFromBitmap", () => {
    function makeMockBitmap(w: number, h: number): ImageBitmap {
      return { width: w, height: h } as unknown as ImageBitmap;
    }

    it("uploads bitmap as texture without FBO", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const bitmap = makeMockBitmap(1024, 1024);

      cache.uploadFromBitmap(key, bitmap, makeBounds(0, 0), 0, new Set(["s1"]));

      const entry = cache.getStale(key)!;
      expect(entry).toBeDefined();
      expect(entry.fbo).toBeNull(); // Bitmap tiles have no FBO
      expect(entry.dirty).toBe(false); // Bitmap uploads are clean
      expect(entry.strokeIds.has("s1")).toBe(true);
      expect(entry.textureWidth).toBe(1024);
      expect(entry.textureHeight).toBe(1024);
      expect(cache.memoryUsage).toBe(1024 * 1024 * 4);

      // Verify GL texture upload calls
      expect(gl.createTexture).toHaveBeenCalled();
      expect(gl.bindTexture).toHaveBeenCalled();
      expect(gl.texImage2D).toHaveBeenCalled();
      expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    });

    it("replaces existing MSAA entry with bitmap entry", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };

      // First: allocate with MSAA
      cache.allocate(key, makeBounds(0, 0), 0);
      expect(cache.getStale(key)!.msaa).not.toBeNull();

      // Then: replace with bitmap
      const bitmap = makeMockBitmap(1024, 1024);
      cache.uploadFromBitmap(key, bitmap, makeBounds(0, 0), 0, new Set());

      const entry = cache.getStale(key)!;
      expect(entry.fbo).toBeNull();
      expect(entry.msaa).toBeNull();
      expect(GLTextures.destroyMSAAOffscreenTarget).toHaveBeenCalledTimes(1);
    });

    it("replaces existing bitmap entry with new bitmap", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };

      cache.uploadFromBitmap(key, makeMockBitmap(512, 512), makeBounds(0, 0), 0, new Set());
      const oldEntry = cache.getStale(key)!;
      const oldTex = oldEntry.texture;

      cache.uploadFromBitmap(key, makeMockBitmap(1024, 1024), makeBounds(0, 0), 1, new Set());

      expect(gl.deleteTexture).toHaveBeenCalledWith(oldTex);
      expect(cache.getStale(key)!.textureWidth).toBe(1024);
    });

    it("sets UNPACK_FLIP_Y_WEBGL to false for correct bitmap orientation", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const bitmap = makeMockBitmap(256, 256);

      cache.uploadFromBitmap(key, bitmap, makeBounds(0, 0), 0, new Set());

      expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, false);
    });
  });

  describe("invalidate", () => {
    it("marks specified tiles as dirty", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };

      cache.allocate(key1, makeBounds(0, 0), 0);
      cache.allocate(key2, makeBounds(1, 0), 0);
      cache.markClean(key1);
      cache.markClean(key2);

      expect(cache.get(key1)).toBeDefined();
      expect(cache.get(key2)).toBeDefined();

      cache.invalidate([key1]);

      expect(cache.get(key1)).toBeUndefined(); // Dirty → invisible to get()
      expect(cache.get(key2)).toBeDefined();   // Still clean
    });
  });

  describe("invalidateAll", () => {
    it("marks all tiles as dirty", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const keys = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 0, row: 1 },
      ];

      for (const key of keys) {
        cache.allocate(key, makeBounds(key.col, key.row), 0);
        cache.markClean(key);
      }

      cache.invalidateAll();

      for (const key of keys) {
        expect(cache.get(key)).toBeUndefined();
        expect(cache.getStale(key)).toBeDefined();
        expect(cache.getStale(key)!.dirty).toBe(true);
      }
    });
  });

  describe("invalidateStroke", () => {
    it("marks tiles containing the stroke as dirty", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };

      const entry1 = cache.allocate(key1, makeBounds(0, 0), 0);
      entry1.strokeIds.add("stroke-1");
      cache.markClean(key1);

      const entry2 = cache.allocate(key2, makeBounds(1, 0), 0);
      entry2.strokeIds.add("stroke-2");
      cache.markClean(key2);

      const affected = cache.invalidateStroke("stroke-1");

      expect(affected).toEqual([key1]);
      expect(entry1.dirty).toBe(true);
      expect(entry2.dirty).toBe(false);
    });

    it("returns multiple affected tiles when stroke spans tiles", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };

      const entry1 = cache.allocate(key1, makeBounds(0, 0), 0);
      entry1.strokeIds.add("stroke-1");
      cache.markClean(key1);

      const entry2 = cache.allocate(key2, makeBounds(1, 0), 0);
      entry2.strokeIds.add("stroke-1");
      cache.markClean(key2);

      const affected = cache.invalidateStroke("stroke-1");
      expect(affected.length).toBe(2);
    });

    it("returns empty array for non-existent stroke", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      cache.markClean({ col: 0, row: 0 });

      const affected = cache.invalidateStroke("nonexistent");
      expect(affected.length).toBe(0);
    });
  });

  describe("getDirtyTiles", () => {
    it("returns dirty tiles sorted with visible first", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };
      const key3: TileKey = { col: 2, row: 0 };

      cache.allocate(key1, makeBounds(0, 0), 0);
      cache.allocate(key2, makeBounds(1, 0), 0);
      cache.allocate(key3, makeBounds(2, 0), 0);

      cache.markClean(key2); // key2 is clean

      const visibleKeys = new Set([tileKeyString(key3)]);
      const dirty = cache.getDirtyTiles(visibleKeys);

      expect(dirty.length).toBe(2); // key1, key3 are dirty
      expect(dirty[0].key).toEqual(key3); // visible first
      expect(dirty[1].key).toEqual(key1); // non-visible second
    });

    it("returns empty array when no tiles are dirty", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      cache.markClean({ col: 0, row: 0 });

      expect(cache.getDirtyTiles(new Set()).length).toBe(0);
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest unprotected tile when memory budget exceeded", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0); // 1024
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };
      const key3: TileKey = { col: 2, row: 0 };

      cache.allocate(key1, makeBounds(0, 0), 0);
      cache.allocate(key2, makeBounds(1, 0), 0);

      expect(cache.size).toBe(2);

      // Allocating a 3rd tile should evict the oldest (key1)
      cache.allocate(key3, makeBounds(2, 0), 0);

      expect(cache.size).toBe(2);
      expect(cache.getStale(key1)).toBeUndefined();
      expect(cache.getStale(key2)).toBeDefined();
      expect(cache.getStale(key3)).toBeDefined();
    });

    it("does not evict protected tiles", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };
      const key3: TileKey = { col: 2, row: 0 };

      cache.allocate(key1, makeBounds(0, 0), 0);
      cache.allocate(key2, makeBounds(1, 0), 0);

      cache.protect(new Set([tileKeyString(key1)]));

      cache.allocate(key3, makeBounds(2, 0), 0);

      expect(cache.size).toBe(2);
      expect(cache.getStale(key1)).toBeDefined();  // protected
      expect(cache.getStale(key2)).toBeUndefined(); // evicted
      expect(cache.getStale(key3)).toBeDefined();

      cache.unprotect();
    });

    it("stops evicting when only protected tiles remain", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };
      const key3: TileKey = { col: 2, row: 0 };

      cache.allocate(key1, makeBounds(0, 0), 0);
      cache.allocate(key2, makeBounds(1, 0), 0);

      cache.protect(new Set([tileKeyString(key1), tileKeyString(key2)]));

      // Can't evict → cache grows beyond budget
      cache.allocate(key3, makeBounds(2, 0), 0);

      expect(cache.size).toBe(3);
      cache.unprotect();
    });

    it("destroys FBO resources on eviction", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      const key1: TileKey = { col: 0, row: 0 };
      cache.allocate(key1, makeBounds(0, 0), 0);

      const key2: TileKey = { col: 1, row: 0 };
      cache.allocate(key2, makeBounds(1, 0), 0);

      // Clear mock call count
      (GLTextures.destroyMSAAOffscreenTarget as jest.Mock).mockClear();

      const key3: TileKey = { col: 2, row: 0 };
      cache.allocate(key3, makeBounds(2, 0), 0);

      expect(GLTextures.destroyMSAAOffscreenTarget).toHaveBeenCalledTimes(1);
    });

    it("calls gl.deleteTexture for bitmap-uploaded tile on eviction", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      // Upload bitmap tile (no FBO)
      const key1: TileKey = { col: 0, row: 0 };
      const bitmap = { width: tilePhysical, height: tilePhysical } as unknown as ImageBitmap;
      cache.uploadFromBitmap(key1, bitmap, makeBounds(0, 0), 0, new Set());

      const key2: TileKey = { col: 1, row: 0 };
      cache.allocate(key2, makeBounds(1, 0), 0);

      (gl.deleteTexture as jest.Mock).mockClear();
      (GLTextures.destroyMSAAOffscreenTarget as jest.Mock).mockClear();

      // Evict key1 (bitmap tile)
      const key3: TileKey = { col: 2, row: 0 };
      cache.allocate(key3, makeBounds(2, 0), 0);

      // Bitmap tile → deleteTexture, not destroyMSAAOffscreenTarget
      expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
      expect(GLTextures.destroyMSAAOffscreenTarget).not.toHaveBeenCalled();
    });

    it("eviction happens during uploadFromBitmap too", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      cache.allocate({ col: 1, row: 0 }, makeBounds(1, 0), 0);

      expect(cache.size).toBe(2);

      const bitmap = { width: tilePhysical, height: tilePhysical } as unknown as ImageBitmap;
      cache.uploadFromBitmap({ col: 2, row: 0 }, bitmap, makeBounds(2, 0), 0, new Set());

      expect(cache.size).toBe(2);
    });
  });

  describe("memory tracking", () => {
    it("tracks cumulative memory across allocations", () => {
      const config = makeConfig();
      const cache = new WebGLTileCache(gl, config);
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const expectedPerTile = tilePhysical * tilePhysical * 4;

      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      expect(cache.memoryUsage).toBe(expectedPerTile);

      cache.allocate({ col: 1, row: 0 }, makeBounds(1, 0), 0);
      expect(cache.memoryUsage).toBe(expectedPerTile * 2);
    });

    it("updates memory when tile size changes on re-allocate", () => {
      const config = makeConfig();
      const cache = new WebGLTileCache(gl, config);

      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      const mem0 = cache.memoryUsage;

      // Re-allocate at higher band → larger tile
      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 2);
      const mem2 = cache.memoryUsage;

      expect(mem2).toBeGreaterThan(mem0);
    });

    it("resets to zero after clear()", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      cache.allocate({ col: 1, row: 0 }, makeBounds(1, 0), 0);

      cache.clear();

      expect(cache.memoryUsage).toBe(0);
      expect(cache.size).toBe(0);
    });
  });

  describe("clear", () => {
    it("destroys all MSAA resources", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      cache.allocate({ col: 1, row: 0 }, makeBounds(1, 0), 0);

      (GLTextures.destroyMSAAOffscreenTarget as jest.Mock).mockClear();

      cache.clear();

      expect(GLTextures.destroyMSAAOffscreenTarget).toHaveBeenCalledTimes(2);
    });

    it("calls deleteTexture for bitmap tiles", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const bitmap = { width: 256, height: 256 } as unknown as ImageBitmap;
      cache.uploadFromBitmap({ col: 0, row: 0 }, bitmap, makeBounds(0, 0), 0, new Set());

      (gl.deleteTexture as jest.Mock).mockClear();

      cache.clear();

      expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    });

    it("clears after clear is empty", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      cache.clear();

      expect(cache.getStale({ col: 0, row: 0 })).toBeUndefined();
    });
  });

  describe("protect / unprotect", () => {
    it("protect replaces previous protected set", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      const key1: TileKey = { col: 0, row: 0 };
      const key2: TileKey = { col: 1, row: 0 };

      cache.allocate(key1, makeBounds(0, 0), 0);
      cache.allocate(key2, makeBounds(1, 0), 0);

      // Protect key1
      cache.protect(new Set([tileKeyString(key1)]));

      // Switch protection to key2
      cache.protect(new Set([tileKeyString(key2)]));

      // Now key1 is unprotected, should be evicted
      cache.allocate({ col: 2, row: 0 }, makeBounds(2, 0), 0);

      expect(cache.getStale(key1)).toBeUndefined(); // key1 evicted
      expect(cache.getStale(key2)).toBeDefined();   // key2 protected

      cache.unprotect();
    });

    it("unprotect makes all tiles evictable", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 2,
      }));

      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      cache.allocate({ col: 1, row: 0 }, makeBounds(1, 0), 0);

      cache.protect(new Set([tileKeyString({ col: 0, row: 0 }), tileKeyString({ col: 1, row: 0 })]));
      cache.unprotect();

      // Now both are evictable
      cache.allocate({ col: 2, row: 0 }, makeBounds(2, 0), 0);
      expect(cache.size).toBe(2); // One was evicted
    });
  });

  describe("edge cases", () => {
    it("allocate with same key and same bounds resets dirty/strokeIds", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };
      const bounds = makeBounds(0, 0);

      const entry = cache.allocate(key, bounds, 0);
      entry.strokeIds.add("s1");
      entry.strokeIds.add("s2");
      cache.markClean(key);

      const entry2 = cache.allocate(key, bounds, 0);
      expect(entry2.dirty).toBe(true);
      expect(entry2.strokeIds.size).toBe(0);
    });

    it("handles negative tile coordinates", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: -1, row: -2 };
      const bounds: [number, number, number, number] = [-512, -1024, 0, -512];

      cache.allocate(key, bounds, 0);

      expect(cache.getStale(key)).toBeDefined();
      expect(cache.getStale(key)!.worldBounds).toEqual(bounds);
    });

    it("markClean on non-existent tile is a no-op", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      // Should not throw
      cache.markClean({ col: 99, row: 99 });
    });

    it("uploadFromBitmap tracks memory correctly for non-square bitmaps", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const bitmap = { width: 1024, height: 512 } as unknown as ImageBitmap;
      cache.uploadFromBitmap({ col: 0, row: 0 }, bitmap, makeBounds(0, 0), 0, new Set());

      expect(cache.memoryUsage).toBe(1024 * 512 * 4);
    });
  });

  describe("memory accounting stress tests (audit verification)", () => {
    function makeBitmap(w: number, h: number): ImageBitmap {
      return { width: w, height: h } as unknown as ImageBitmap;
    }

    it("uploadFromBitmap replacing existing bitmap: memory is exact", () => {
      const cache = new WebGLTileCache(gl, makeConfig());
      const key: TileKey = { col: 0, row: 0 };

      // Upload 1024x1024 bitmap (4 MB)
      cache.uploadFromBitmap(key, makeBitmap(1024, 1024), makeBounds(0, 0), 0, new Set());
      expect(cache.memoryUsage).toBe(1024 * 1024 * 4);

      // Replace with 512x512 bitmap (1 MB)
      cache.uploadFromBitmap(key, makeBitmap(512, 512), makeBounds(0, 0), 0, new Set());
      expect(cache.memoryUsage).toBe(512 * 512 * 4);

      // Replace with 2048x2048 bitmap (16 MB)
      cache.uploadFromBitmap(key, makeBitmap(2048, 2048), makeBounds(0, 0), 0, new Set());
      expect(cache.memoryUsage).toBe(2048 * 2048 * 4);

      // Only 1 tile the whole time
      expect(cache.size).toBe(1);
    });

    it("uploadFromBitmap replacing FBO tile: memory is exact", () => {
      const config = makeConfig();
      const cache = new WebGLTileCache(gl, config);
      const key: TileKey = { col: 0, row: 0 };
      const tilePhysical = tileSizePhysicalForBand(config, 0);

      // Allocate FBO tile
      cache.allocate(key, makeBounds(0, 0), 0);
      expect(cache.memoryUsage).toBe(tilePhysical * tilePhysical * 4);

      // Replace with bitmap
      cache.uploadFromBitmap(key, makeBitmap(512, 512), makeBounds(0, 0), 0, new Set());
      expect(cache.memoryUsage).toBe(512 * 512 * 4);
      expect(cache.size).toBe(1);
    });

    it("FBO re-allocate at different band: memory reflects new size", () => {
      const config = makeConfig();
      const cache = new WebGLTileCache(gl, config);
      const key: TileKey = { col: 0, row: 0 };

      // Band 0 → 1024px
      cache.allocate(key, makeBounds(0, 0), 0);
      const mem0 = tileSizePhysicalForBand(config, 0);
      expect(cache.memoryUsage).toBe(mem0 * mem0 * 4);

      // Band 2 → 2048px
      cache.allocate(key, makeBounds(0, 0), 2);
      const mem2 = tileSizePhysicalForBand(config, 2);
      expect(cache.memoryUsage).toBe(mem2 * mem2 * 4);

      expect(cache.size).toBe(1);
    });

    it("mixed allocate/upload sequence: memory never goes negative", () => {
      const config = makeConfig();
      const cache = new WebGLTileCache(gl, config);

      for (let i = 0; i < 10; i++) {
        const key: TileKey = { col: i, row: 0 };
        if (i % 2 === 0) {
          cache.allocate(key, makeBounds(i, 0), 0);
        } else {
          cache.uploadFromBitmap(key, makeBitmap(512, 512), makeBounds(i, 0), 0, new Set());
        }
        expect(cache.memoryUsage).toBeGreaterThan(0);
      }

      // Now replace some
      cache.uploadFromBitmap({ col: 0, row: 0 }, makeBitmap(256, 256), makeBounds(0, 0), 0, new Set());
      cache.allocate({ col: 1, row: 0 }, makeBounds(1, 0), 2);

      expect(cache.memoryUsage).toBeGreaterThan(0);

      // Clear and verify zero
      cache.clear();
      expect(cache.memoryUsage).toBe(0);
    });

    it("eviction after many operations keeps memory accurate", () => {
      const config = makeConfig();
      const tilePhysical = tileSizePhysicalForBand(config, 0);
      const tileMemory = tilePhysical * tilePhysical * 4;

      const cache = new WebGLTileCache(gl, makeConfig({
        maxMemoryBytes: tileMemory * 3,
      }));

      // Fill to capacity
      cache.allocate({ col: 0, row: 0 }, makeBounds(0, 0), 0);
      cache.allocate({ col: 1, row: 0 }, makeBounds(1, 0), 0);
      cache.allocate({ col: 2, row: 0 }, makeBounds(2, 0), 0);
      expect(cache.memoryUsage).toBe(tileMemory * 3);

      // Replace one with bitmap (different size)
      cache.uploadFromBitmap({ col: 1, row: 0 }, makeBitmap(512, 512), makeBounds(1, 0), 0, new Set());
      const bitmapMem = 512 * 512 * 4;
      expect(cache.memoryUsage).toBe(tileMemory * 2 + bitmapMem);
      expect(cache.size).toBe(3);
    });
  });
});
