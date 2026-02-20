# Async Tile Rendering During Gestures

## Problem

The tile system currently only renders new tiles when `renderStaticLayer()` is called (at gesture end). During pan/zoom gestures, `setGestureTransform` → `recomposite()` only re-draws *already-cached* tiles at new positions/scales. No new tiles are rendered during the gesture, so zooming out reveals blank areas that only fill in after the gesture ends.

## Goal

During gestures, continuously identify missing/needed tiles and render them asynchronously in the background. As each batch completes, composite them into view so the user sees content progressively appearing during the gesture.

## Design

### Core Change: `recomposite` → `updateDuringGesture`

Rename/extend `recomposite()` to also identify uncached tiles and schedule them:

1. **Composite existing tiles** (current behavior — fast, just drawImage)
2. **Identify missing tiles** for current viewport at the cached zoom band
3. **Schedule missing tiles** for async rendering via TileRenderScheduler
4. **As batches complete**, re-composite to show newly rendered tiles

### Key Decisions

- **Zoom band during gesture**: Keep using `lastZoomBand` (the band tiles were rendered at before the gesture). This means during a zoom-out gesture, we render new tiles at the *pre-gesture* resolution and scale them. This avoids discarding the entire cache on each zoom band crossing mid-gesture.

- **Zoom band transitions**: If the gesture crosses a zoom band boundary, we have a choice: keep rendering at the old band (simpler, tiles remain cached) or switch bands (sharper at new zoom, but invalidates cache). For now, keep the old band during gestures and only transition on gesture end.

- **Throttling**: The scheduler already batches via RAF. We just need to avoid re-scheduling on every single gesture event. Instead, schedule once per frame at most.

### Changes

#### `TiledStaticLayer` (in Renderer.ts)

1. Add `gestureSchedulePending` flag to coalesce schedule requests
2. Rename `recomposite()` → `gestureUpdate()` with this logic:
   ```
   gestureUpdate(ctx, canvas, screenWidth, screenHeight):
     // 1. Composite cached tiles (existing behavior)
     compositor.composite(ctx, canvas, camera, sw, sh, cache, lastZoomBand)

     // 2. Identify missing tiles at lastZoomBand
     visibleTiles = grid.getVisibleTiles(camera, sw, sh, lastZoomBand)
     missingTiles = visibleTiles.filter(t => !cache.getStale(t))

     // 3. If missing tiles exist, schedule them (coalesced per RAF)
     if (missingTiles.length > 0 && !gestureSchedulePending) {
       gestureSchedulePending = true
       // Use the scheduler to render missing tiles async
       scheduler.schedule(missingTiles, visibleKeySet)
     }
   ```

3. Update `onSchedulerBatchComplete()` to also reset `gestureSchedulePending` so subsequent gesture events can trigger new schedules if the viewport has moved further.

#### `TileRenderScheduler` (TileRenderScheduler.ts)

Currently `schedule()` replaces the pending queue. This is fine — if the viewport moves, we want to re-prioritize with the new viewport's tiles.

One issue: the scheduler needs to handle being called during an active render loop. Currently `schedule()` sets `this.pendingTiles` but `startProcessing()` returns if already active. This means a new schedule during processing will update the queue but not restart — which is correct since the RAF loop continues.

Actually, looking more carefully: `schedule()` calls `startProcessing()` which checks `if (this.renderingInProgress) return;`. But `schedule()` replaces `this.pendingTiles`, so the existing RAF loop will pick up the new tiles. This should work correctly.

#### `setGestureTransform` (in Renderer.ts)

Change from:
```ts
this.tiledLayer.recomposite(ctx, canvas, w, h)
```
To:
```ts
this.tiledLayer.gestureUpdate(ctx, canvas, w, h)
```

#### `renderOneTile` callback

Currently `renderOneTile` needs `currentDoc`, `currentSpatialIndex` etc. These are set in `renderVisible()` and `bakeStroke()`. During gestures, these won't be freshly set. We need to ensure they persist from the last `renderStaticLayer()` call. Looking at the code, they're stored as class fields (`currentDoc`, `currentSpatialIndex`, etc.) so they should still be valid. ✓

#### `onSchedulerBatchComplete` callback

Currently composites onto `this.currentCtx` / `this.currentCanvas`. During gestures, these should still be valid from the last render call. Need to verify these don't get cleared. Looking at code — they persist. ✓ But we need to make sure the batch complete composites at `lastZoomBand` too (during gestures). Currently it doesn't pass `zoomBandOverride`. Need to fix this — if we're in a gesture, use `lastZoomBand`.

Add a `gestureActive` flag to track whether we're mid-gesture. When true, `onSchedulerBatchComplete` uses `lastZoomBand` for compositing.

#### Gesture lifecycle

- `setGestureTransform` → calls `gestureUpdate()` which composites + schedules missing tiles
- `clearGestureTransform` → set `gestureActive = false`, cancel scheduler (gesture-end will trigger full renderStaticLayer)

### Files Modified

1. **`src/canvas/Renderer.ts`** — TiledStaticLayer changes + setGestureTransform update
2. No other files need changes

### Testing

- Existing TileRenderScheduler tests cover scheduling behavior
- Manual testing: draw strokes, zoom out, verify tiles appear progressively during gesture
