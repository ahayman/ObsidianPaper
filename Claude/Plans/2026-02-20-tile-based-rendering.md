# Tile-Based Rendering System

**Date:** 2026-02-20
**Status:** Plan B — Reference document for upgrade path if overscan proves insufficient
**Problem:** CSS transforms during zoom/pan reveal blank areas beyond the rendered viewport. Long documents with many pages need pre-rendered content beyond the visible area for smooth scrolling and zooming.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Core Data Structures](#2-core-data-structures)
3. [TileGrid: Coordinate Mapping](#3-tilegrid-coordinate-mapping)
4. [TileCache: LRU Cache with Memory Budgeting](#4-tilecache-lru-cache-with-memory-budgeting)
5. [TileRenderer: Per-Tile Stroke Rendering](#5-tilerenderer-per-tile-stroke-rendering)
6. [TileCompositor: Frame Assembly](#6-tilecompositor-frame-assembly)
7. [BackgroundTileStrategy](#7-backgroundtilestrategy)
8. [Cache Invalidation](#8-cache-invalidation)
9. [Zoom Level Transitions](#9-zoom-level-transitions)
10. [Incremental Baking](#10-incremental-baking)
11. [Integration with Existing Systems](#11-integration-with-existing-systems)
12. [Edge Cases](#12-edge-cases)
13. [Memory Budget Analysis](#13-memory-budget-analysis)
14. [Phased Implementation Strategy](#14-phased-implementation-strategy)
15. [Testing Strategy](#15-testing-strategy)
16. [Migration Path from Current Renderer](#16-migration-path-from-current-renderer)

---

## 1. Architecture Overview

### Current Architecture (Single Canvas)

```
predictionCanvas    <- Predicted stroke extension
activeCanvas        <- Stroke being drawn
staticCanvas        <- ALL completed strokes (full re-render on zoom/pan)
backgroundCanvas    <- Page patterns, colors
```

Problem: `staticCanvas` re-renders all visible strokes on every zoom/pan. With transparency effects (grain, highlighter), this is O(visible_strokes x pixels).

### Proposed Architecture (Tile-Based)

```
predictionCanvas      <- Unchanged
activeCanvas          <- Unchanged
compositeCanvas       <- Composites visible tiles (replaces staticCanvas)
bgCompositeCanvas     <- Composites visible background tiles (replaces backgroundCanvas)

    TileGrid          <- Maps viewport to tile coordinates
        |
    TileCache         <- LRU cache: (col, row, zoomBand) -> OffscreenCanvas
        |
    TileRenderer      <- Renders strokes onto individual tile canvases
        |
    TileCompositor    <- Assembles visible tiles onto compositeCanvas each frame
```

### Key Design Decisions

1. **Tiles are in screen-pixel space**: 512x512 CSS pixels (1024x1024 at 2x DPR). Aligned to the current zoom level's coordinate system.

2. **Zoom bands, not exact zoom levels**: Tiles are cached per "zoom band" (mapped to LOD levels). Within a band, existing tiles are scaled slightly rather than re-rendered. New tiles are rendered only when crossing a band boundary.

3. **Two tile layers**: Stroke tiles and background tiles are separate to allow independent invalidation (strokes change often; backgrounds rarely change).

4. **Hybrid invalidation**: Incremental bake for new strokes (re-render only affected tiles). Full invalidation for undo/erase (re-render all affected tiles, prioritizing visible ones).

---

## 2. Core Data Structures

### File: `src/canvas/tiles/TileTypes.ts`

```typescript
/** Identifies a unique tile in the cache. */
export interface TileKey {
  col: number;
  row: number;
  zoomBand: number;
}

export function tileKeyString(key: TileKey): string {
  return `${key.col},${key.row},${key.zoomBand}`;
}

/** A cached tile with its rendered content and metadata. */
export interface TileEntry {
  key: TileKey;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  worldBounds: [number, number, number, number];
  strokeIds: Set<string>;
  dirty: boolean;
  lastAccess: number;
  memoryBytes: number;
}

/**
 * Zoom bands map continuous zoom levels to discrete rendering resolutions.
 *
 * Band boundaries align with LOD thresholds from StrokeSimplifier:
 *   Band 0: zoom >= 0.5   (LOD 0, full detail)
 *   Band 1: zoom 0.25-0.5 (LOD 1, light simplification)
 *   Band 2: zoom 0.1-0.25 (LOD 2, heavy simplification)
 *   Band 3: zoom < 0.1    (LOD 3, minimal)
 *
 * Within each band, sub-bands at sqrt(2) intervals (~1.414x) limit
 * scaling artifacts. Tiles rendered at a sub-band's base zoom are
 * scaled by at most ~1.41x during compositing.
 */
export function zoomToZoomBand(zoom: number): number {
  return Math.floor(Math.log2(zoom) * 2);
}

export function zoomBandBaseZoom(band: number): number {
  return Math.pow(2, band / 2);
}

export interface TileGridConfig {
  tileSizeCss: number;       // Default: 512
  dpr: number;
  maxMemoryBytes: number;    // Default: 200 * 1024 * 1024 (200MB)
  overscanTiles: number;     // Default: 1
}

export const DEFAULT_TILE_CONFIG: TileGridConfig = {
  tileSizeCss: 512,
  dpr: 2,
  maxMemoryBytes: 200 * 1024 * 1024,
  overscanTiles: 1,
};
```

---

## 3. TileGrid: Coordinate Mapping

### File: `src/canvas/tiles/TileGrid.ts`

```typescript
export class TileGrid {
  private config: TileGridConfig;

  constructor(config: TileGridConfig) {
    this.config = config;
  }

  get tileSizePhysical(): number {
    return this.config.tileSizeCss * this.config.dpr;
  }

  /** World-space size of a tile at a given zoom level. */
  tileWorldSize(zoom: number): number {
    return this.config.tileSizeCss / zoom;
  }

  /** Convert a world-space point to tile coordinates at the given zoom. */
  worldToTile(wx: number, wy: number, zoom: number): { col: number; row: number } {
    const worldSize = this.tileWorldSize(zoom);
    return {
      col: Math.floor(wx / worldSize),
      row: Math.floor(wy / worldSize),
    };
  }

  /** Get the world-space bounding box for a tile. */
  tileBounds(col: number, row: number, zoom: number): [number, number, number, number] {
    const worldSize = this.tileWorldSize(zoom);
    return [
      col * worldSize,
      row * worldSize,
      (col + 1) * worldSize,
      (row + 1) * worldSize,
    ];
  }

  /**
   * Get all tile keys needed for the current viewport, plus overscan.
   * Returns tiles sorted by distance from viewport center (closest first).
   */
  getVisibleTiles(
    camera: Camera,
    screenWidth: number,
    screenHeight: number,
  ): TileKey[] {
    const zoomBand = zoomToZoomBand(camera.zoom);
    const baseZoom = zoomBandBaseZoom(zoomBand);
    const worldSize = this.tileWorldSize(baseZoom);

    const visibleRect = camera.getVisibleRect(screenWidth, screenHeight);

    // Expand by overscan
    const overscanWorld = this.config.overscanTiles * worldSize;
    const expandedMinX = visibleRect[0] - overscanWorld;
    const expandedMinY = visibleRect[1] - overscanWorld;
    const expandedMaxX = visibleRect[2] + overscanWorld;
    const expandedMaxY = visibleRect[3] + overscanWorld;

    const minCol = Math.floor(expandedMinX / worldSize);
    const minRow = Math.floor(expandedMinY / worldSize);
    const maxCol = Math.floor(expandedMaxX / worldSize);
    const maxRow = Math.floor(expandedMaxY / worldSize);

    // Center for priority sorting
    const centerX = (visibleRect[0] + visibleRect[2]) / 2;
    const centerY = (visibleRect[1] + visibleRect[3]) / 2;
    const centerCol = centerX / worldSize;
    const centerRow = centerY / worldSize;

    const tiles: TileKey[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        tiles.push({ col, row, zoomBand });
      }
    }

    tiles.sort((a, b) => {
      const distA = Math.abs(a.col - centerCol) + Math.abs(a.row - centerRow);
      const distB = Math.abs(b.col - centerCol) + Math.abs(b.row - centerRow);
      return distA - distB;
    });

    return tiles;
  }

  /** Get tiles that intersect a world-space bounding box. */
  getTilesForWorldBBox(
    bbox: [number, number, number, number],
    zoomBand: number,
  ): TileKey[] {
    const baseZoom = zoomBandBaseZoom(zoomBand);
    const worldSize = this.tileWorldSize(baseZoom);

    const minCol = Math.floor(bbox[0] / worldSize);
    const minRow = Math.floor(bbox[1] / worldSize);
    const maxCol = Math.floor(bbox[2] / worldSize);
    const maxRow = Math.floor(bbox[3] / worldSize);

    const tiles: TileKey[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        tiles.push({ col, row, zoomBand });
      }
    }
    return tiles;
  }
}
```

---

## 4. TileCache: LRU Cache with Memory Budgeting

### File: `src/canvas/tiles/TileCache.ts`

```typescript
export class TileCache {
  private tiles = new Map<string, TileEntry>();
  private totalMemory = 0;
  private config: TileGridConfig;

  constructor(config: TileGridConfig) {
    this.config = config;
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

  /** Allocate a tile entry. Reuses existing or creates new OffscreenCanvas. */
  allocate(key: TileKey, worldBounds: [number, number, number, number]): TileEntry {
    const keyStr = tileKeyString(key);
    let entry = this.tiles.get(keyStr);
    if (entry) {
      entry.dirty = true;
      entry.worldBounds = worldBounds;
      entry.strokeIds.clear();
      entry.lastAccess = performance.now();
      return entry;
    }

    const tilePhysical = this.config.tileSizeCss * this.config.dpr;
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

  invalidateZoomBand(zoomBand: number): void {
    for (const entry of this.tiles.values()) {
      if (entry.key.zoomBand === zoomBand) entry.dirty = true;
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
        break;
      }
    }
  }

  evictOtherZoomBands(currentZoomBand: number): void {
    const toRemove: string[] = [];
    for (const [keyStr, entry] of this.tiles) {
      if (entry.key.zoomBand !== currentZoomBand) {
        toRemove.push(keyStr);
        this.totalMemory -= entry.memoryBytes;
      }
    }
    for (const key of toRemove) this.tiles.delete(key);
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
```

---

## 5. TileRenderer: Per-Tile Stroke Rendering

### File: `src/canvas/tiles/TileRenderer.ts`

Each tile has its own OffscreenCanvas. The tile canvas uses a transform that maps the tile's world-space region to `[0, 0, tileSizePhysical, tileSizePhysical]`.

Key rendering concerns:
- Clip to page boundaries
- Grain isolation (destination-out on offscreen canvas) works per-stroke within the tile
- LOD level determined by the zoom band's base zoom
- Strokes spanning multiple tiles are rendered independently on each tile

```typescript
export class TileRenderer {
  private grid: TileGrid;
  private config: TileGridConfig;
  private pathCache: StrokePathCache;
  private grainGenerator: GrainTextureGenerator | null;
  private grainStrengthOverrides: Map<PenType, number>;
  private grainOffscreen: OffscreenCanvas | null = null;
  private grainOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

  renderTile(
    tile: TileEntry,
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
  ): void {
    const ctx = tile.ctx;
    const tilePhysical = this.grid.tileSizePhysical;
    const baseZoom = zoomBandBaseZoom(tile.key.zoomBand);
    const lod = selectLodLevel(baseZoom);

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tilePhysical, tilePhysical);

    // Transform: world coords -> tile pixel coords
    const scale = baseZoom * this.config.dpr;
    const tx = -tile.worldBounds[0] * scale;
    const ty = -tile.worldBounds[1] * scale;
    ctx.setTransform(scale, 0, 0, scale, tx, ty);

    // Find intersecting strokes
    const strokeIds = spatialIndex.queryRect(
      tile.worldBounds[0], tile.worldBounds[1],
      tile.worldBounds[2], tile.worldBounds[3],
    );

    tile.strokeIds.clear();

    // Render strokes grouped by page with per-page clipping
    for (const pageRect of pageLayout) {
      if (!bboxOverlaps(
        [pageRect.x, pageRect.y, pageRect.x + pageRect.width, pageRect.y + pageRect.height],
        tile.worldBounds,
      )) continue;

      // Determine page dark mode
      const page = doc.pages[pageRect.pageIndex];
      let pageDark = isDarkMode;
      if (page) {
        const { patternTheme } = resolvePageBackground(
          page.backgroundColor, page.backgroundColorTheme, isDarkMode,
        );
        pageDark = patternTheme === "dark";
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      ctx.clip();

      const strokeIdSet = new Set(strokeIds);
      for (const stroke of doc.strokes) {
        if (stroke.pageIndex !== pageRect.pageIndex) continue;
        if (!strokeIdSet.has(stroke.id)) continue;

        // Delegates to shared renderStrokeCore() utility
        renderStrokeCore(ctx, stroke, doc.styles, lod, pageDark, this.pathCache, ...);
        tile.strokeIds.add(stroke.id);
      }

      ctx.restore();
    }
  }
}
```

### Shared Stroke Rendering Utility

To avoid duplicating the complex stroke rendering logic, extract from `Renderer.renderStrokeToContext()`:

```typescript
// src/canvas/StrokeRenderCore.ts

export interface GrainRenderContext {
  generator: GrainTextureGenerator | null;
  strengthOverrides: Map<PenType, number>;
  getOffscreen(minW: number, minH: number): {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  } | null;
  canvasWidth: number;
  canvasHeight: number;
}

export function renderStrokeCore(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  stroke: Stroke,
  styles: Record<string, PenStyle>,
  lod: LodLevel,
  useDarkColors: boolean,
  pathCache: StrokePathCache,
  grainState: GrainRenderContext,
): void {
  // Extracted from Renderer.renderStrokeToContext() and renderStrokeWithGrain()
}
```

---

## 6. TileCompositor: Frame Assembly

### File: `src/canvas/tiles/TileCompositor.ts`

```typescript
export class TileCompositor {
  private compositeCanvas: HTMLCanvasElement;
  private compositeCtx: CanvasRenderingContext2D;
  private grid: TileGrid;
  private config: TileGridConfig;

  /**
   * Composite all visible tiles onto the display canvas.
   *
   * For each visible tile:
   * 1. If cached and clean: draw it
   * 2. If cached but dirty: draw stale content (better than blank)
   * 3. If not cached: leave blank (will be rendered soon)
   *
   * Tile screen size may differ from tileSizeCss if current zoom
   * differs from the zoom band's base zoom (tiles are scaled).
   */
  composite(
    camera: Camera,
    screenWidth: number,
    screenHeight: number,
    tileCache: TileCache,
  ): void {
    const ctx = this.compositeCtx;
    const dpr = this.config.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const visibleTiles = this.grid.getVisibleTiles(camera, screenWidth, screenHeight);
    const zoomBand = zoomToZoomBand(camera.zoom);
    const baseZoom = zoomBandBaseZoom(zoomBand);
    const displayScale = camera.zoom / baseZoom;

    for (const key of visibleTiles) {
      const entry = tileCache.getStale(key);
      if (!entry) continue;

      const worldX = entry.worldBounds[0];
      const worldY = entry.worldBounds[1];
      const screenX = (worldX - camera.x) * camera.zoom;
      const screenY = (worldY - camera.y) * camera.zoom;
      const tileScreenSize = this.config.tileSizeCss * displayScale;

      ctx.drawImage(
        entry.canvas,
        0, 0, this.grid.tileSizePhysical, this.grid.tileSizePhysical,
        screenX, screenY, tileScreenSize, tileScreenSize,
      );
    }
  }
}
```

---

## 7. BackgroundTileStrategy

Two options:

### Option A: Tile the Background Identically (Robust)

Same tile grid for backgrounds. Background tiles rendered independently, composited onto `bgCompositeCanvas`. Enables same CSS transform benefit. Background tiles invalidated only on page style/size changes.

### Option B: Full-Viewport Background with Overscan (Simpler, Recommended to Start)

Keep the background as a single oversized canvas (viewport + overscan margin). Simpler since patterns are procedurally generated and cheap to render. Upgrade to Option A only if background rendering becomes a bottleneck.

---

## 8. Cache Invalidation

### Stroke Addition

```
New stroke finalized
  -> Compute stroke.bbox
  -> For each active zoom band in cache:
      -> tileGrid.getTilesForWorldBBox(stroke.bbox, zoomBand)
      -> Re-render affected tiles (re-query spatial index which now includes the new stroke)
  -> Visible tiles re-rendered immediately
  -> Non-visible tiles scheduled for background rendering
```

### Stroke Removal (undo/erase)

```
Stroke removed
  -> tileCache.invalidateStroke(stroke.id)
  -> Returns list of affected tile keys
  -> Re-render affected visible tiles immediately
  -> Schedule non-visible tiles for background rendering
```

### Bulk Operations

```
Multiple strokes changed
  -> Collect affected tile keys for all strokes
  -> Deduplicate
  -> If >50% of visible tiles affected: full visible re-render
  -> Otherwise: re-render only affected tiles
```

### Page Style Changes

```
Page style changed
  -> Invalidate background tiles overlapping the page
  -> Stroke tiles unaffected (separate layer)
```

### Zoom Band Change

```
Zoom changes, new band differs from previous
  -> All tiles in old band become stale
  -> New tiles at new band created on demand
  -> Old tiles remain for fallback compositing (scaled)
  -> After visible area rendered, evict old band tiles
```

---

## 9. Zoom Level Transitions

### During Pinch Gesture (CSS Transform Phase)

1. CSS transform applied to composite canvas — free GPU operation
2. No tile re-rendering during gesture
3. Pre-rendered overscan tiles provide edge content
4. Tiles may appear slightly scaled (up to ~1.4x due to zoom band granularity)

### On Gesture End (Re-render Phase)

1. CSS transform cleared
2. Check if zoom band changed:
   - **Same band**: Composite existing tiles at new positions. Render newly-exposed tiles.
   - **Different band**: Keep old-band tiles as fallback. Render new-band tiles for visible area. Old tiles scaled as placeholder.

### Progressive Tile Replacement

```typescript
export class TileRenderScheduler {
  private pendingTiles: TileKey[] = [];
  private renderingInProgress = false;
  private rafId: number | null = null;

  schedule(tiles: TileKey[], visibleSet: Set<string>): void {
    const visible: TileKey[] = [];
    const background: TileKey[] = [];
    for (const tile of tiles) {
      if (visibleSet.has(tileKeyString(tile))) {
        visible.push(tile);
      } else {
        background.push(tile);
      }
    }
    this.pendingTiles = [...visible, ...background];
    this.startProcessing();
  }

  private processNext(): void {
    if (this.pendingTiles.length === 0) {
      this.renderingInProgress = false;
      return;
    }

    // Render batch per frame (keep frame time under 8ms)
    const BATCH_SIZE = 4;
    const batch = this.pendingTiles.splice(0, BATCH_SIZE);

    this.rafId = requestAnimationFrame(() => {
      for (const key of batch) {
        this.renderOneTile(key);
      }
      this.onBatchComplete(); // Re-composite
      this.processNext();
    });
  }

  cancel(): void {
    this.pendingTiles = [];
    this.renderingInProgress = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
```

---

## 10. Incremental Baking

### Selective Tile Re-render (General Case)

When a stroke is finalized, find affected tiles and re-render them:

```typescript
bakeTileStroke(stroke: Stroke, doc, pageLayout, spatialIndex, isDarkMode): void {
  const currentZoomBand = zoomToZoomBand(this.camera.zoom);
  const affectedTiles = this.grid.getTilesForWorldBBox(stroke.bbox, currentZoomBand);

  for (const key of affectedTiles) {
    const entry = this.cache.getStale(key);
    if (entry) {
      this.tileRenderer.renderTile(entry, doc, pageLayout, spatialIndex, isDarkMode);
      this.cache.markClean(key);
    }
  }

  this.compositor.composite(this.camera, this.cssWidth, this.cssHeight, this.cache);
}
```

### Additive Bake Fast Path (Simple Strokes)

For strokes without grain or highlighter mode, draw directly onto existing tile content without clearing:

```typescript
bakeSimpleStroke(stroke, styles, pageRect): void {
  const style = resolveStyle(stroke, styles);
  const penConfig = getPenConfig(style.pen);

  // Only for non-grain, non-highlighter strokes
  if (penConfig.grain?.enabled || penConfig.highlighterMode) {
    return this.bakeTileStroke(stroke, ...);
  }

  const affectedTiles = this.grid.getTilesForWorldBBox(stroke.bbox, currentZoomBand);
  for (const key of affectedTiles) {
    const entry = this.cache.getStale(key);
    if (!entry) continue;

    // Set up tile transform and draw stroke additively
    const baseZoom = zoomBandBaseZoom(key.zoomBand);
    const scale = baseZoom * this.config.dpr;
    entry.ctx.setTransform(scale, 0, 0, scale,
      -entry.worldBounds[0] * scale,
      -entry.worldBounds[1] * scale,
    );

    if (pageRect) {
      entry.ctx.save();
      entry.ctx.beginPath();
      entry.ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      entry.ctx.clip();
    }

    renderStrokeCore(entry.ctx, stroke, styles, 0, useDarkColors, this.pathCache, ...);

    if (pageRect) entry.ctx.restore();
    entry.strokeIds.add(stroke.id);
  }
}
```

---

## 11. Integration with Existing Systems

### Active/Prediction Canvases: Unchanged

Remain viewport-sized, single-layer. Render only in-progress stroke. No tiling needed.

### Gesture CSS Transform System

Works naturally with tile compositing:

```
onPanStart / onPinchStart:
  -> gestureBaseCamera = camera snapshot
  -> Overscan tiles already rendered beyond viewport

onPanMove / onPinchMove:
  -> Update camera
  -> CSS transform on compositeCanvas, bgCompositeCanvas, activeCanvas, predictionCanvas
  -> Pre-rendered tiles at edges provide content

onPanEnd / onPinchEnd:
  -> Clear CSS transform
  -> Check if new tiles needed
  -> Schedule rendering of newly-needed tiles
  -> Re-composite immediately with available tiles
```

### Path Cache and LOD System: Reused

`StrokePathCache` is reused within `TileRenderer`. Multiple tiles rendering the same stroke at the same LOD share the cached Path2D.

### SpatialIndex: Reused

R-tree used by `TileRenderer.renderTile()` to find strokes intersecting a tile's world bounds.

### PaperView Integration Points

1. Replace `renderer.renderStaticLayer(...)` with tile-based composite
2. Replace `renderer.bakeStroke(...)` with tile-aware baking
3. `requestStaticRender()` becomes "ensure visible tiles are rendered + composite"
4. Undo/redo triggers tile invalidation instead of full re-render
5. Resize triggers tile re-evaluation

---

## 12. Edge Cases

### Strokes Spanning Multiple Tiles

Rendered to each intersecting tile independently. The tile's implicit clip rect limits what portion appears. Same Path2D from cache used for all tiles.

**Cost**: A stroke spanning N tiles is rendered N times. Since grain offscreen is scoped to tile size (512x512 physical), per-tile cost is bounded.

### Very Large Strokes

At typical zoom, even a full-page diagonal stroke spans ~2 tiles. At very low zoom (0.1), world coverage per tile = 5120 units, so nearly all strokes fit within a single tile.

### Rapid Zoom Changes

1. Cancel pending tile renders from previous zoom band
2. CSS transform scaling of current tiles as visual placeholder
3. On gesture end, render tiles at final zoom band
4. Progressive rendering fills in over multiple frames

### Memory Pressure

Eviction priority:
1. Non-current zoom band tiles (first)
2. Non-visible overscan tiles (second)
3. Reduce overscan to 0 (emergency)
4. Never evict tiles currently being rendered or composited

### Container Resize

1. Composite canvas resized
2. Visible tile set recomputed
3. Existing tiles remain valid (world-space content unchanged)
4. New edge tiles scheduled for rendering

### Dark Mode Toggle

All stroke and background tiles invalidated. Visible tiles re-rendered immediately. Non-visible tiles scheduled for background rendering.

---

## 13. Memory Budget Analysis

### Per-Tile Memory

- 512 CSS x 512 CSS = 1024 x 1024 physical pixels at 2x DPR
- RGBA: 4 bytes per pixel
- Per tile: 1024 x 1024 x 4 = **4 MB**

### Visible Tiles (iPad)

- Viewport: ~1024 x 768 CSS pixels
- Tiles needed: ceil(1024/512) x ceil(768/512) = 2 x 2 = 4 tiles
- With 1-tile overscan: 4 x 4 = 16 tiles
- Memory: 16 x 4 MB = **64 MB**

### Total Budget (200 MB default)

- 200 MB / 4 MB = 50 tiles maximum
- 16 tiles visible+overscan = 34 spare for:
  - Old zoom band tiles during transitions (~16)
  - Background tiles if tiled (16)
  - Total: ~48, within budget

### Tuning Options

If memory is tight:
- Reduce tile size to 256 CSS (1 MB per tile, 4x as many tiles needed)
- Reduce overscan to 0
- Cap DPR to 1x for tiles (2x for active stroke only)
- More aggressive eviction

---

## 14. Phased Implementation Strategy

### Phase 1: Foundation (Incremental, Non-Breaking)

Build tile infrastructure alongside existing renderer. Both run simultaneously for testing.

1. **Create `src/canvas/tiles/TileTypes.ts`** — Types, zoom band functions, config
2. **Create `src/canvas/tiles/TileGrid.ts`** — Coordinate mapping, visible tile computation + tests
3. **Create `src/canvas/tiles/TileCache.ts`** — LRU cache with memory budgeting + tests
4. **Create `src/canvas/StrokeRenderCore.ts`** — Extract shared rendering logic from `Renderer.renderStrokeToContext()`. Existing Renderer delegates to shared function. No behavior change.

### Phase 2: Tile Rendering (Additive)

5. **Create `src/canvas/tiles/TileRenderer.ts`** — Per-tile stroke rendering + integration tests
6. **Create `src/canvas/tiles/TileCompositor.ts`** — Composite visible tiles + visual tests
7. **Create `src/canvas/tiles/TileRenderScheduler.ts`** — Priority-based async rendering + tests

### Phase 3: Integration (Switch Over)

8. **Modify `Renderer.ts`** — Add `TiledStaticLayer` with `useTiling` feature flag
9. **Modify `PaperView.ts`** — Wire tile invalidation into undo/redo/erase, zoom transitions
10. **Background rendering strategy** — Overscan background canvas (simpler) or tiled (if needed)

### Phase 4: Polish and Optimization

11. Additive bake fast path for simple strokes
12. Worker-based tile rendering using OffscreenCanvas transfer
13. Zoom transition smoothing (interpolate old/new band tiles)
14. Performance profiling on iPad (50+ pages, 1000+ strokes)
15. Memory pressure monitoring

---

## 15. Testing Strategy

### Unit Tests

```
src/canvas/tiles/TileTypes.test.ts
  - zoomToZoomBand(): correct band for various zoom levels
  - zoomBandBaseZoom(): round-trip consistency
  - tileKeyString(): unique for different keys

src/canvas/tiles/TileGrid.test.ts
  - worldToTile(): correct mapping
  - tileBounds(): correct world rect
  - getVisibleTiles(): correct tiles for various camera states
  - getVisibleTiles(): priority sorting (center first)
  - getTilesForWorldBBox(): correct tiles for stroke bboxes
  - overscan: includes extra tiles beyond viewport

src/canvas/tiles/TileCache.test.ts
  - allocate/get: basic CRUD
  - LRU eviction: oldest tile evicted first
  - Memory budget: eviction triggers at limit
  - invalidateStroke(): marks correct tiles dirty
  - invalidateZoomBand(): marks all tiles in band dirty
  - evictOtherZoomBands(): removes non-current bands
  - getDirtyTiles(): visible tiles prioritized

src/canvas/tiles/TileRenderScheduler.test.ts
  - schedule(): visible tiles before background
  - cancel(): stops pending renders
  - batch sizing: correct number per frame
```

### Integration Tests

```
src/canvas/tiles/TileRenderer.test.ts
  - Renders strokes correctly within tile bounds
  - Per-page clipping works within tiles
  - Grain isolation works on tile canvas
  - LOD selection matches zoom band
  - Strokes spanning multiple tiles appear correctly

src/canvas/tiles/TileCompositor.test.ts
  - Composites tiles at correct screen positions
  - Handles zoom scaling between bands
  - Stale tiles used as fallback
  - Missing tiles leave transparent gaps
```

---

## 16. Migration Path from Current Renderer

### Step 1: Extract StrokeRenderCore (Non-Breaking)

Move body of `Renderer.renderStrokeToContext()` and `renderStrokeWithGrain()` into `src/canvas/StrokeRenderCore.ts` as free functions. Renderer class calls these, maintaining identical behavior. All existing tests continue to pass.

### Step 2: Build Tile System Alongside (Additive)

All new tile files in `src/canvas/tiles/`. Existing Renderer unmodified. Tile system tested independently.

### Step 3: Feature Flag Integration

```typescript
// In Renderer:
private tiledLayer: TiledStaticLayer | null = null;

enableTiling(config?: Partial<TileGridConfig>): void {
  this.tiledLayer = new TiledStaticLayer(this.camera, { ...DEFAULT_TILE_CONFIG, ...config });
}

disableTiling(): void {
  this.tiledLayer?.destroy();
  this.tiledLayer = null;
}
```

When `tiledLayer` is non-null, `renderStaticLayer()`, `bakeStroke()`, and gesture methods delegate to it.

### Step 4: Full Switchover

Make tile rendering the default. Keep old full-render path as fallback for initial load.

---

## File Inventory

### New Files

| File | Purpose |
|------|---------|
| `src/canvas/tiles/TileTypes.ts` | Core types, zoom band functions, config |
| `src/canvas/tiles/TileGrid.ts` | Coordinate mapping, visible tile computation |
| `src/canvas/tiles/TileCache.ts` | LRU cache with memory budgeting |
| `src/canvas/tiles/TileRenderer.ts` | Per-tile stroke rendering |
| `src/canvas/tiles/TileCompositor.ts` | Frame assembly from visible tiles |
| `src/canvas/tiles/TileRenderScheduler.ts` | Async priority-based tile rendering |
| `src/canvas/StrokeRenderCore.ts` | Extracted shared stroke rendering logic |
| Tests for all of the above |

### Modified Files

| File | Changes |
|------|---------|
| `src/canvas/Renderer.ts` | Extract shared logic; add TiledStaticLayer integration; feature flag |
| `src/view/PaperView.ts` | Tile invalidation on undo/redo/erase; tile transition on zoom; enable tiling |
| `src/canvas/BackgroundRenderer.ts` | Optional: overscan support or tile integration |

### Unchanged Files

| File | Reason |
|------|--------|
| `src/canvas/Camera.ts` | Used as-is by tile system |
| `src/spatial/SpatialIndex.ts` | Used as-is for tile stroke queries |
| `src/stroke/StrokeSimplifier.ts` | LOD levels used as zoom band boundaries |
| `src/stroke/OutlineGenerator.ts` | StrokePathCache reused |
| `src/canvas/GrainTextureGenerator.ts` | Grain patterns reused |
| All input, toolbar, document, serializer files | Unaffected |
