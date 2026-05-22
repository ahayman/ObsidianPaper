# Felt Pen — Worker Tile Rendering Fix

**Date:** 2026-05-22
**Status:** Planned.

## Bug

On document open, felt-tip strokes render with the basic pipeline (a plain
filled outline). After a zoom they re-render correctly as scattered streak
fibres.

## Cause

Baked tiles render two ways:

- `WebGLTileEngine.renderTile()` — synchronous, main thread, via
  `renderStrokeToEngine`, which has the felt-tip `stampStreaks` path → advanced.
- The tile worker (`src/canvas/tiles/worker/tileWorker.ts`) — async, Canvas2D in
  a Web Worker, via its own `renderStroke()`.

`TiledStaticLayer.renderVisible()` sync-renders only the first `MAX_SYNC_TILES`
(40) visible tiles via the engine; the rest are deferred to the worker. The
worker's `renderStroke()` has branches for ink-stamp, pencil `stamp`, grain and
highlighter — but **no `markerScatter` (felt-tip) branch**, so felt-tip falls
through to the plain-fill fallback.

On open the document is fit-to-width (zoomed out) → many visible tiles → most,
including the drawing, are worker-rendered → basic. Zooming in shrinks the
visible tile count below 40 (and changes the zoom band, forcing a re-render),
so the tiles get engine-rendered → advanced.

## Fix

Add a `markerScatter` branch to the worker's `renderStroke()`, mirroring the
pencil-stamp branch and `renderStrokeToContext`'s felt-tip branch:
`computeAllMarkerScatter` → `drawStreaks`, gated identically to pencil
(`stampEnabled && renderPipeline === "advanced" && markerScatter && lod === 0`).
Worker-rendered felt-tip then matches the engine and active-stroke paths.

`MarkerScatterRenderer` (pure compute) and `StreakRenderer` (`drawStreaks` is
plain Canvas2D) bundle into the worker exactly like the existing
`computeAllStamps` / `drawStamps`. One-file change.

## Testing

`yarn build` (rebuilds the worker bundle) + `yarn test`. The streak generation
and rendering are already covered by `MarkerScatterRenderer` tests; the worker
branch is a thin mirror of the tested `renderStrokeToContext` path. Manual:
open a document with felt-tip strokes — they render as fibres immediately,
without needing a zoom.
