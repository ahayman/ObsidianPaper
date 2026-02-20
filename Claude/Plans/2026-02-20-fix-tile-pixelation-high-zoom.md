# Fix Tile Pixelation at High Zoom

## Context

When zoomed in, finalized strokes appear pixelated compared to the active stroke being drawn. The active stroke renders directly to the viewport canvas at full `dpr * zoom` resolution, but baked tiles are capped at `maxTilePhysical: 2048` pixels. At zoom 3.0+ with DPR 2, the ideal tile size exceeds 2048, so tiles are rendered at lower resolution and upscaled by the compositor.

## Root Cause

`tileSizePhysicalForBand()` computes `tileWorldSize * baseZoom * dpr`, clamped to max 2048. With `tileWorldSize: 512`, the ideal exceeds 2048 at zoom ~2.0+, causing resolution loss.

## Fix

Two changes:

1. **Reduce `tileWorldSize` from 512 to 256** — halves ideal physical size at every zoom, keeping it within 2048 cap even at max zoom (5.0).
2. **Fix `bakeStroke` to re-allocate at correct zoom band** — existing tiles rendered at a lower zoom band were being reused without resizing.

## Files Changed

- `src/canvas/tiles/TileTypes.ts` — `tileWorldSize: 256`
- `src/canvas/tiles/TileTypes.test.ts` — updated default config assertion
- `src/canvas/Renderer.ts` — `bakeStroke` now checks `entry.renderedAtBand !== currentZoomBand`
