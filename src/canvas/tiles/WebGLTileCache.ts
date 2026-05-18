/**
 * GPU tile texture storage with LRU eviction.
 *
 * Parallel to TileCache but stores WebGL textures instead of OffscreenCanvases.
 * FBO-rendered tiles hold a plain colour texture that WebGLTileEngine renders
 * into through a shared MSAA scratch (see MSAAResolver). Worker-produced tiles
 * upload ImageBitmaps directly to textures.
 */

import type { TileKey, TileGridConfig } from "./TileTypes";
import { tileKeyString, tileSizePhysicalForBand } from "./TileTypes";
import { createColorTexture } from "../engine/GLTextures";

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
  /** true = rendered via WebGLTileEngine (Y-flipped); false = worker bitmap upload */
  fboRendered: boolean;
}

export class WebGLTileCache {
  private gl: WebGL2RenderingContext;
  private tiles = new Map<string, GLTileEntry>();
  private totalMemory = 0;
  private config: TileGridConfig;
  private protectedKeys = new Set<string>();

  constructor(gl: WebGL2RenderingContext, config: TileGridConfig) {
    this.gl = gl;
    this.config = config;
  }

  /**
   * Real GPU bytes per tile: one RGBA8 colour texture. Tiles render through a
   * shared MSAA scratch (MSAAResolver) and keep only the resolved texture — no
   * per-tile multisampled renderbuffers.
   */
  private memoryBytesFor(tilePhysical: number): number {
    return tilePhysical * tilePhysical * 4;
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
   * Allocate a tile entry with a colour texture at the given zoom band's
   * resolution. WebGLTileEngine.renderTile() renders into this texture via the
   * shared MSAA scratch. Reuses the existing texture if size matches.
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
      const sizeChanged =
        entry.textureWidth !== tilePhysical || entry.textureHeight !== tilePhysical;

      if (sizeChanged || !entry.fboRendered) {
        // Size changed, or the entry holds a bitmap-uploaded texture — destroy
        // the old texture and allocate a fresh FBO-render texture.
        this.totalMemory -= entry.memoryBytes;
        this.destroyEntry(entry);

        const newMemory = this.memoryBytesFor(tilePhysical);
        this.evictIfNeeded(newMemory);

        entry.texture = createColorTexture(gl, tilePhysical, tilePhysical);
        entry.textureWidth = tilePhysical;
        entry.textureHeight = tilePhysical;
        entry.memoryBytes = newMemory;
        entry.fboRendered = true;
        this.totalMemory += newMemory;
      }

      entry.dirty = true;
      entry.worldBounds = worldBounds;
      entry.strokeIds.clear();
      entry.lastAccess = performance.now();
      entry.renderedAtBand = zoomBand;
      return entry;
    }

    const newMemory = this.memoryBytesFor(tilePhysical);
    this.evictIfNeeded(newMemory);

    entry = {
      key,
      texture: createColorTexture(gl, tilePhysical, tilePhysical),
      textureWidth: tilePhysical,
      textureHeight: tilePhysical,
      worldBounds,
      strokeIds: new Set(),
      dirty: true,
      lastAccess: performance.now(),
      memoryBytes: newMemory,
      renderedAtBand: zoomBand,
      fboRendered: true,
    };

    this.tiles.set(keyStr, entry);
    this.totalMemory += newMemory;
    return entry;
  }

  /**
   * Upload a worker-produced ImageBitmap as a tile texture.
   * Bitmap tiles aren't re-rendered via WebGL.
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
    }

    this.evictIfNeeded(newMemory);

    // Create texture from ImageBitmap
    const tex = gl.createTexture();
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
      entry.fboRendered = false;
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
        fboRendered: false,
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

  /** Destroy GPU resources for a tile entry. */
  private destroyEntry(entry: GLTileEntry): void {
    this.gl.deleteTexture(entry.texture);
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
