/**
 * GPU tile texture storage with LRU eviction.
 *
 * Parallel to TileCache but stores WebGL textures instead of OffscreenCanvases.
 * FBO-rendered tiles store their FBO (whose color attachment IS the tile texture).
 * Worker-produced tiles upload ImageBitmaps directly to textures (no FBO needed).
 */

import type { TileKey, TileGridConfig } from "./TileTypes";
import { tileKeyString, tileSizePhysicalForBand } from "./TileTypes";
import {
  createOffscreenTarget,
  destroyOffscreenTarget,
  createMSAAOffscreenTarget,
  destroyMSAAOffscreenTarget,
} from "../engine/GLTextures";
import type { GLOffscreenTarget, GLMSAAOffscreenTarget } from "../engine/GLTextures";

export interface GLTileEntry {
  key: TileKey;
  texture: WebGLTexture;
  textureWidth: number;
  textureHeight: number;
  worldBounds: [number, number, number, number];
  strokeIds: Set<string>;
  dirty: boolean;
  lastAccess: number;
  memoryBytes: number;
  renderedAtBand: number;
  /** Non-null = FBO-rendered (Y-flipped); null = bitmap-uploaded */
  fbo: GLOffscreenTarget | null;
  /** MSAA render target — render here, then resolve to fbo/texture */
  msaa: GLMSAAOffscreenTarget | null;
}

export class WebGLTileCache {
  private gl: WebGL2RenderingContext;
  private tiles = new Map<string, GLTileEntry>();
  private totalMemory = 0;
  private config: TileGridConfig;
  private protectedKeys = new Set<string>();
  private msaaSamples: number;

  constructor(gl: WebGL2RenderingContext, config: TileGridConfig, msaaSamples = 4) {
    this.gl = gl;
    this.config = config;
    this.msaaSamples = msaaSamples;
  }

  protect(keys: Set<string>): void {
    this.protectedKeys = keys;
  }

  unprotect(): void {
    this.protectedKeys.clear();
  }

  get(key: TileKey): GLTileEntry | undefined {
    const keyStr = tileKeyString(key);
    const entry = this.tiles.get(keyStr);
    if (entry && !entry.dirty) {
      entry.lastAccess = performance.now();
      return entry;
    }
    return undefined;
  }

  getStale(key: TileKey): GLTileEntry | undefined {
    const keyStr = tileKeyString(key);
    const entry = this.tiles.get(keyStr);
    if (entry) entry.lastAccess = performance.now();
    return entry;
  }

  /**
   * Allocate a tile entry with FBO at the given zoom band's resolution.
   * The FBO's color attachment IS the tile texture — zero-copy rendering.
   * Reuses existing entry if size matches.
   */
  allocate(
    key: TileKey,
    worldBounds: [number, number, number, number],
    zoomBand: number,
  ): GLTileEntry {
    const gl = this.gl;
    const keyStr = tileKeyString(key);
    const tilePhysical = tileSizePhysicalForBand(this.config, zoomBand);
    let entry = this.tiles.get(keyStr);

    if (entry) {
      if (entry.textureWidth !== tilePhysical || entry.textureHeight !== tilePhysical) {
        // Size changed — destroy old resources and recreate
        this.totalMemory -= entry.memoryBytes;
        this.destroyEntry(entry);

        const newMemory = tilePhysical * tilePhysical * 4;
        this.evictIfNeeded(newMemory);

        this.allocateEntryTarget(entry, tilePhysical);
        entry.textureWidth = tilePhysical;
        entry.textureHeight = tilePhysical;
        entry.memoryBytes = newMemory;
        this.totalMemory += newMemory;
      }

      entry.dirty = true;
      entry.worldBounds = worldBounds;
      entry.strokeIds.clear();
      entry.lastAccess = performance.now();
      entry.renderedAtBand = zoomBand;
      return entry;
    }

    const newMemory = tilePhysical * tilePhysical * 4;
    this.evictIfNeeded(newMemory);

    if (this.msaaSamples > 0) {
      const msaaTarget = createMSAAOffscreenTarget(gl, tilePhysical, tilePhysical, this.msaaSamples);
      entry = {
        key,
        texture: msaaTarget.colorTexture,
        textureWidth: tilePhysical,
        textureHeight: tilePhysical,
        worldBounds,
        strokeIds: new Set(),
        dirty: true,
        lastAccess: performance.now(),
        memoryBytes: newMemory,
        renderedAtBand: zoomBand,
        fbo: null,
        msaa: msaaTarget,
      };
    } else {
      const target = createOffscreenTarget(gl, tilePhysical, tilePhysical);
      entry = {
        key,
        texture: target.colorTexture,
        textureWidth: tilePhysical,
        textureHeight: tilePhysical,
        worldBounds,
        strokeIds: new Set(),
        dirty: true,
        lastAccess: performance.now(),
        memoryBytes: newMemory,
        renderedAtBand: zoomBand,
        fbo: target,
        msaa: null,
      };
    }

    this.tiles.set(keyStr, entry);
    this.totalMemory += newMemory;
    return entry;
  }

  /**
   * Upload a worker-produced ImageBitmap as a tile texture.
   * No FBO needed — bitmap tiles aren't re-rendered via WebGL.
   */
  uploadFromBitmap(
    key: TileKey,
    bitmap: ImageBitmap,
    worldBounds: [number, number, number, number],
    zoomBand: number,
    strokeIds: Set<string>,
  ): void {
    const gl = this.gl;
    const keyStr = tileKeyString(key);
    let entry = this.tiles.get(keyStr);

    const w = bitmap.width;
    const h = bitmap.height;
    const newMemory = w * h * 4;

    if (entry) {
      // Destroy old resources
      this.totalMemory -= entry.memoryBytes;
      this.destroyEntry(entry);
      entry.fbo = null;
      entry.msaa = null;
    }

    this.evictIfNeeded(newMemory);

    // Create texture from ImageBitmap
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (entry) {
      entry.texture = tex;
      entry.textureWidth = w;
      entry.textureHeight = h;
      entry.worldBounds = worldBounds;
      entry.strokeIds = strokeIds;
      entry.dirty = false;
      entry.lastAccess = performance.now();
      entry.memoryBytes = newMemory;
      entry.renderedAtBand = zoomBand;
      entry.fbo = null;
      entry.msaa = null;
    } else {
      entry = {
        key,
        texture: tex,
        textureWidth: w,
        textureHeight: h,
        worldBounds,
        strokeIds,
        dirty: false,
        lastAccess: performance.now(),
        memoryBytes: newMemory,
        renderedAtBand: zoomBand,
        fbo: null,
        msaa: null,
      };
      this.tiles.set(keyStr, entry);
    }

    this.totalMemory += newMemory;
  }

  markClean(key: TileKey): void {
    const entry = this.tiles.get(tileKeyString(key));
    if (entry) entry.dirty = false;
  }

  invalidate(keys: TileKey[]): void {
    for (const key of keys) {
      const entry = this.tiles.get(tileKeyString(key));
      if (entry) entry.dirty = true;
    }
  }

  /** Allocate render target (MSAA or non-MSAA) into an existing entry. */
  private allocateEntryTarget(entry: GLTileEntry, size: number): void {
    const gl = this.gl;
    if (this.msaaSamples > 0) {
      const msaaTarget = createMSAAOffscreenTarget(gl, size, size, this.msaaSamples);
      entry.fbo = null;
      entry.msaa = msaaTarget;
      entry.texture = msaaTarget.colorTexture;
    } else {
      const target = createOffscreenTarget(gl, size, size);
      entry.fbo = target;
      entry.msaa = null;
      entry.texture = target.colorTexture;
    }
  }

  /** Destroy GPU resources for a tile entry (FBO/MSAA/texture). */
  private destroyEntry(entry: GLTileEntry): void {
    const gl = this.gl;
    if (entry.msaa) {
      destroyMSAAOffscreenTarget(gl, entry.msaa);
    } else if (entry.fbo) {
      destroyOffscreenTarget(gl, entry.fbo);
    } else {
      gl.deleteTexture(entry.texture);
    }
  }

  invalidateAll(): void {
    for (const entry of this.tiles.values()) {
      entry.dirty = true;
    }
  }

  invalidateStroke(strokeId: string): TileKey[] {
    const affected: TileKey[] = [];
    for (const entry of this.tiles.values()) {
      if (entry.strokeIds.has(strokeId)) {
        entry.dirty = true;
        affected.push(entry.key);
      }
    }
    return affected;
  }

  getDirtyTiles(visibleKeys: Set<string>): GLTileEntry[] {
    const dirty: GLTileEntry[] = [];
    for (const entry of this.tiles.values()) {
      if (entry.dirty) dirty.push(entry);
    }
    dirty.sort((a, b) => {
      const aVisible = visibleKeys.has(tileKeyString(a.key)) ? 0 : 1;
      const bVisible = visibleKeys.has(tileKeyString(b.key)) ? 0 : 1;
      return aVisible - bVisible;
    });
    return dirty;
  }

  private evictIfNeeded(additionalBytes: number): void {
    const gl = this.gl;
    while (this.totalMemory + additionalBytes > this.config.maxMemoryBytes && this.tiles.size > 0) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [keyStr, entry] of this.tiles) {
        if (this.protectedKeys.has(keyStr)) continue;
        if (entry.lastAccess < oldestTime) {
          oldestTime = entry.lastAccess;
          oldest = keyStr;
        }
      }
      if (oldest) {
        const entry = this.tiles.get(oldest)!;
        this.totalMemory -= entry.memoryBytes;
        this.destroyEntry(entry);
        this.tiles.delete(oldest);
      } else {
        break;
      }
    }
  }

  get memoryUsage(): number { return this.totalMemory; }
  get size(): number { return this.tiles.size; }

  clear(): void {
    for (const entry of this.tiles.values()) {
      this.destroyEntry(entry);
    }
    this.tiles.clear();
    this.totalMemory = 0;
  }
}
