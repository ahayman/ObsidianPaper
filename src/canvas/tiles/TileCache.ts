import type { TileKey, TileEntry, TileGridConfig } from "./TileTypes";
import { tileKeyString, tileSizePhysicalForBand } from "./TileTypes";

export class TileCache {
  private tiles = new Map<string, TileEntry>();
  private totalMemory = 0;
  private config: TileGridConfig;
  private protectedKeys = new Set<string>();

  constructor(config: TileGridConfig) {
    this.config = config;
  }

  /** Mark a set of tile key strings as protected from eviction. */
  protect(keys: Set<string>): void {
    this.protectedKeys = keys;
  }

  /** Clear eviction protection. */
  unprotect(): void {
    this.protectedKeys.clear();
  }

  /** Get a tile by key. Returns undefined if not cached or dirty. */
  get(key: TileKey): TileEntry | undefined {
    const keyStr = tileKeyString(key);
    const entry = this.tiles.get(keyStr);
    if (entry && !entry.dirty) {
      entry.lastAccess = performance.now();
      return entry;
    }
    return undefined;
  }

  /** Get a tile even if dirty (for stale-content compositing). */
  getStale(key: TileKey): TileEntry | undefined {
    const keyStr = tileKeyString(key);
    const entry = this.tiles.get(keyStr);
    if (entry) entry.lastAccess = performance.now();
    return entry;
  }

  /**
   * Allocate a tile entry at the given zoom band's resolution.
   * Reuses existing canvas if same size, otherwise creates a new one.
   */
  allocate(key: TileKey, worldBounds: [number, number, number, number], zoomBand: number): TileEntry {
    const keyStr = tileKeyString(key);
    const tilePhysical = tileSizePhysicalForBand(this.config, zoomBand);
    let entry = this.tiles.get(keyStr);

    if (entry) {
      // Resize canvas if the zoom band requires a different physical size
      if (entry.canvas.width !== tilePhysical || entry.canvas.height !== tilePhysical) {
        this.totalMemory -= entry.memoryBytes;
        const newMemory = tilePhysical * tilePhysical * 4;
        this.evictIfNeeded(newMemory);

        entry.canvas = new OffscreenCanvas(tilePhysical, tilePhysical);
        const ctx = entry.canvas.getContext("2d");
        if (!ctx) throw new Error("Failed to get 2D context for tile");
        entry.ctx = ctx;
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

    const canvas = new OffscreenCanvas(tilePhysical, tilePhysical);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context for tile");

    entry = {
      key, canvas, ctx, worldBounds,
      strokeIds: new Set(),
      dirty: true,
      lastAccess: performance.now(),
      memoryBytes: newMemory,
      renderedAtBand: zoomBand,
    };

    this.tiles.set(keyStr, entry);
    this.totalMemory += newMemory;
    return entry;
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

  invalidateAll(): void {
    for (const entry of this.tiles.values()) {
      entry.dirty = true;
    }
  }

  /** Invalidate all tiles containing a given stroke. Returns affected keys. */
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

  private evictIfNeeded(additionalBytes: number): void {
    while (this.totalMemory + additionalBytes > this.config.maxMemoryBytes && this.tiles.size > 0) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [keyStr, entry] of this.tiles) {
        // Never evict protected tiles (currently visible)
        if (this.protectedKeys.has(keyStr)) continue;
        if (entry.lastAccess < oldestTime) {
          oldestTime = entry.lastAccess;
          oldest = keyStr;
        }
      }
      if (oldest) {
        const entry = this.tiles.get(oldest)!;
        this.totalMemory -= entry.memoryBytes;
        this.tiles.delete(oldest);
      } else {
        break; // Only protected tiles remain, cannot evict
      }
    }
  }

  getDirtyTiles(visibleKeys: Set<string>): TileEntry[] {
    const dirty: TileEntry[] = [];
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

  get memoryUsage(): number { return this.totalMemory; }
  get size(): number { return this.tiles.size; }
  clear(): void { this.tiles.clear(); this.totalMemory = 0; }
}
