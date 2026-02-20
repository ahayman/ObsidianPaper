# Fix bakeStroke Tile Resolution Bug

## Problem

When zoomed in, finalized strokes appear pixelated compared to the active stroke being drawn. The active stroke renders at the current canvas resolution (sharp), but after lifting the pen (stroke finalization), the baked result is blurry/pixelated.

## Root Cause

In `TiledStaticLayer.bakeStroke()` (Renderer.ts ~line 1109-1117), when a tile already exists in the cache, the code skips `allocate()` and re-renders directly into the existing tile entry:

```typescript
let entry = this.cache.getStale(key);
if (!entry) {
  entry = this.cache.allocate(key, worldBounds, currentZoomBand);
}
this.tileRenderer.renderTile(entry, ...);
```

If the existing tile was rendered at a **lower zoom band** (e.g., band 0 = 1x resolution), its OffscreenCanvas still has the smaller pixel dimensions (e.g., 1024x1024 instead of 2048x2048). The re-render uses `tile.canvas.width` as the physical size and `tile.renderedAtBand` for LOD selection, so it produces a low-resolution result that gets scaled up during compositing, appearing pixelated.

## Fix

When `getStale` returns a tile that was rendered at a different zoom band than the current one, call `allocate()` to resize the canvas to the correct resolution before re-rendering.

### Change in `bakeStroke()` (Renderer.ts):

```typescript
for (const key of affectedTiles) {
  const worldBounds = this.grid.tileBounds(key.col, key.row);
  let entry = this.cache.getStale(key);
  if (!entry || entry.renderedAtBand !== currentZoomBand) {
    entry = this.cache.allocate(key, worldBounds, currentZoomBand);
  }
  this.tileRenderer.renderTile(entry, doc, pageLayout, spatialIndex, isDarkMode);
  this.cache.markClean(key);
}
```

This ensures tiles are always at the correct resolution when a stroke is baked, matching the current zoom level.
