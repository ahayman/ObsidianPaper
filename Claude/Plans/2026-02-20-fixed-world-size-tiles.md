# Fixed World-Size Tiles

## Problem

Tile world size is currently `tileSizeCss / zoom`, so tiles at high zoom are tiny in world-space. Zooming out requires a massive number of those tiny tiles to cover the viewport, exceeding the memory-budgeted cache and causing eviction thrashing.

## Solution

Make tile world size a **fixed constant** (512 world units). The grid is always the same regardless of zoom. Only the **rendering resolution** changes with zoom bands. Each grid position has **one cache slot** — no multi-band entries.

### Behavior during gestures

- **Zoom in**: No re-rendering. Existing tiles are composited scaled (slightly blurry, imperceptible). Re-render at correct resolution only at gesture end.
- **Zoom out**: New grid positions (previously off-screen) are rendered asynchronously at the current zoom band's resolution when the render executes. Once rendered, a tile is not re-rendered until gesture ends.
- **Eviction**: Only off-screen tiles are evicted. Visible tiles are protected by LRU touch on every composite.
- **Gesture end**: `renderStaticLayer` re-renders all visible tiles at the final zoom band's resolution.

## Tile count math

With 512 world-unit tiles and practical zoom range 0.3–5.0:
- At zoom 5.0: viewport ≈ 205 world units wide → ~1 tile across → ~4 tiles total
- At zoom 1.0: viewport ≈ 1024 world units → ~2 tiles across → ~6 tiles total
- At zoom 0.3: viewport ≈ 3413 world units → ~7 tiles across → ~50 tiles total
- With 1-tile overscan: max ~70 tiles at extreme zoom-out

At 4MB each (1024×1024×4), 50 tiles = 200MB. Fits the budget.

## Canvas resolution per zoom band

The tile canvas needs enough pixels for sharp rendering. The rendering resolution scales with zoom band:

```
tileSizePhysicalForBand(config, zoomBand) = clamp(
  tileWorldSize * zoomBandBaseZoom(zoomBand) * dpr,
  minTilePhysical,  // 256
  maxTilePhysical,  // 2048
)
```

Examples (dpr=2, tileWorldSize=512):
- Band -2 (baseZoom 0.5):  512 × 0.5 × 2 = 512px → ~1MB per tile
- Band 0  (baseZoom 1.0):  512 × 1.0 × 2 = 1024px → 4MB per tile
- Band 2  (baseZoom 2.0):  512 × 2.0 × 2 = 2048px → 16MB per tile
- Band 3  (baseZoom 2.83): capped at 2048px

## Key Design Decision: No zoomBand in TileKey

Each grid position `(col, row)` has **one cache slot**. `TileEntry` tracks `renderedAtBand` (the zoom band it was last rendered at). This means:

- No multi-band compositing needed — just one pass per composite
- No cache duplication for same position at different resolutions
- During gesture: tiles at mixed resolutions coexist naturally
- At gesture end: tiles at wrong resolution are re-rendered in place (canvas resized if needed)

## Changes

### `TileTypes.ts`

```ts
interface TileKey { col: number; row: number }  // no zoomBand
function tileKeyString(key: TileKey): string { return `${key.col},${key.row}` }

interface TileEntry {
  // ... existing fields ...
  renderedAtBand: number;  // zoom band this tile was last rendered at
}

interface TileGridConfig {
  tileWorldSize: number;     // Fixed world-space tile size (default: 512)
  dpr: number;
  maxMemoryBytes: number;
  overscanTiles: number;
  maxTilePhysical: number;   // Max canvas px (default: 2048)
  minTilePhysical: number;   // Min canvas px (default: 256)
}

function tileSizePhysicalForBand(config, zoomBand): number  // clamped canvas size
```

Remove `tileSizeCss`. Keep zoom band functions unchanged.

### `TileGrid.ts`

- `tileWorldSize` → getter returning `config.tileWorldSize` (constant)
- Remove `tileSizePhysical` getter (physical size varies per zoom band now)
- `worldToTile(wx, wy)` → no zoom parameter
- `tileBounds(col, row)` → no zoom parameter
- `getVisibleTiles(camera, sw, sh)` → no zoom band parameter, grid uses fixed world size
- `getTilesForWorldBBox(bbox)` → no zoom band parameter

### `TileCache.ts`

- `allocate(key, worldBounds, zoomBand)` — zoomBand as separate param for canvas sizing
- Resizes canvas on re-allocate if zoom band changed (different physical size)
- Remove `evictOtherZoomBands()` and `invalidateZoomBand()` — no longer needed

### `TileRenderer.ts`

- Rendering scale: `tilePhysical / tileWorldSize` (instead of `baseZoom * dpr`)
- Uses `entry.canvas.width` for physical size (varies per zoom band)
- LOD from `zoomBandBaseZoom(entry.renderedAtBand)`

### `TileCompositor.ts`

Single-pass compositor. No `compositeWithFallback`, no `drawBand`.

```ts
composite(ctx, canvas, camera, sw, sh, tileCache):
  clear canvas
  tileScreenSize = tileWorldSize * camera.zoom  // fixed world size, variable screen size
  for each visible (col, row):
    entry = cache.getStale(key)
    if !entry: continue
    screenX = (col * tileWorldSize - camera.x) * camera.zoom
    screenY = (row * tileWorldSize - camera.y) * camera.zoom
    drawImage(entry.canvas, 0, 0, canvas.width, canvas.height, screenX, screenY, size, size)
```

### `TiledStaticLayer` (in `Renderer.ts`)

- `renderVisible()`: for each visible tile, re-render if dirty OR `renderedAtBand !== currentBand`. Protects visible tiles from eviction via `cache.protect()`.
- `gestureUpdate()`: composite cached tiles + schedule missing tiles (getStale check, not band-specific). Protects visible tiles from eviction by async renders.
- `onSchedulerBatchComplete()`: skips compositing during gestures (the next `gestureUpdate()` handles it). Avoids stale-camera flicker.
- `endGesture()`: cancels the scheduler and clears eviction protection. Prevents stale composites between gesture end and `renderVisible()`.
- `bakeStroke()`: fixed grid, no zoom band in getTilesForWorldBBox. Protects visible tiles during allocation.
- `renderOneTile()`: renders at `zoomToZoomBand(camera.zoom)` (current zoom at render time). Skips clean tiles (may have been rendered by `renderVisible()` after being scheduled).
- Remove `lastZoomBand`, `compositeWithFallback` usage — no longer needed

### `TileCache.ts` — Eviction Protection

- `protect(keys)` / `unprotect()`: marks tile key strings as protected from LRU eviction
- `evictIfNeeded()` skips protected tiles, stops if only protected tiles remain (allows cache to temporarily exceed budget rather than evict visible tiles)
- **Root cause fix**: Without protection, `renderVisible()` allocating tiles in a loop could evict tiles rendered earlier in the same loop (all tiles have identical `performance.now()` timestamps within a synchronous loop)

### Tests

- `TileTypes.test.ts`: remove zoomBand from TileKey, new config fields, add `tileSizePhysicalForBand` tests
- `TileGrid.test.ts`: remove zoom params from all methods, simpler expectations
- `TileCache.test.ts`: new config, `allocate` signature, eviction protection tests
- `TileRenderScheduler.test.ts`: remove zoomBand from TileKey
