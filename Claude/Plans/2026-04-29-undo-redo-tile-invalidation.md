# Undo/Redo Restore-Stroke Tile Invalidation

## Problem

Several user-reported symptoms point to one bug: **the tile cache stays stale
after some document mutations until the viewport changes (pan/zoom).**

1. After a long session, erases on old strokes appeared to do nothing — strokes
   stayed visible. Later "all those strokes seemed to randomly disappear" once
   the cache caught up.
2. Sometimes undo doesn't appear to take effect; pan/zoom makes the change
   visible.
3. Occasionally a freshly drawn stroke disappears, then reappears later.

The smoking gun is in `src/view/PaperView.ts`. Four code paths mutate the
document during undo/redo without invalidating the affected tiles:

| Path                                  | Lines    | Behavior                              |
|---------------------------------------|----------|---------------------------------------|
| `undo()` → `remove-stroke`            | 537–545  | Re-inserts stroke. **No invalidation.** |
| `undo()` → `remove-strokes`           | 546–557  | Re-inserts strokes. **No invalidation.** |
| `redo()` → `add-stroke`               | 587–591  | Re-adds stroke. **No invalidation.** |
| `redo()` → `add-strokes`              | 592–598  | Re-adds strokes. **No invalidation.** |

The four sibling paths (undo of add-stroke/strokes, redo of remove-stroke/strokes)
all correctly call `this.renderer?.invalidateCache(stroke.id)`. The asymmetry is
the bug: only the "restore a previously-removed stroke" branches were missed.

After the switch, both `undo()` and `redo()` call `renderStaticWithIcons()`,
which re-renders **dirty** visible tiles and tiles with band mismatches.
Non-dirty tiles are skipped — even though their content is wrong now.

## Why a strokeId-based fix doesn't work here

`invalidateStroke(strokeId)` walks all tile entries and marks dirty any tile
whose `strokeIds` set contains `strokeId`. That set is populated when the tile
is rendered. After a stroke is erased, the tile re-renders without it, and the
strokeId is gone from the set.

So in this flow:
1. User has stroke X. Tile T has been rendered with X. T.strokeIds = {…, X}.
2. User erases X. T marked dirty, re-rendered without X. T.strokeIds = {…}.
3. User undoes the erase. X is re-inserted into doc + spatial index. We call
   `invalidateStroke(X.id)`. Walks tiles. **None contains X in strokeIds.** No
   tile is marked dirty.
4. Visible tiles are not in the to-schedule list (clean, band matches).
5. T continues to display the erased state until pan/zoom forces a re-eval.

The same trap catches symptom 2 (undo of an erase made far enough back) and
symptom 1 (after enough undo/redo churn, what the user sees no longer matches
the document).

So the fix is to invalidate **by bbox**, not by strokeId. We have the stroke
in hand (`action.stroke`), which carries `bbox`, and we have the tile grid
(`this.grid.getTilesForWorldBBox(bbox)`) — same machinery `bakeStroke` uses to
pick affected tiles.

## Goal

After undo/redo restores a stroke (single or batch), every tile whose world
bounds overlap the restored stroke's bbox is marked dirty, so the immediately
following `renderStaticWithIcons()` re-renders them.

## Non-goals

- Reworking `invalidateStroke()`. It's correct for the eraser path (the tile
  *has* the stroke registered when erase fires), and changing it could destabilize
  callers I'd need to audit.
- Symptom 3 (freshly drawn stroke disappears then reappears). This looks like a
  different race — a worker tile-result for an in-flight render arriving after
  `bakeStroke` and uploading the pre-bake snapshot. Investigate separately if
  the four-path fix doesn't dissolve it.
- Migrating undo/redo into a single "after-mutation" hook. Tempting cleanup
  but out of scope.

## Approach

Add a bbox-based invalidation API that uses the grid to enumerate affected
tile keys and marks them dirty in both caches. The existing
`invalidate(keys: TileKey[])` method on both `TileCache` and `WebGLTileCache`
already does the per-key dirty marking — we just need to compute the keys.

### Changes

**1. `src/canvas/Renderer.ts`**

In `TiledStaticLayer`, add:

```typescript
invalidateBBox(bbox: [number, number, number, number]): void {
  const keys = this.grid.getTilesForWorldBBox(bbox);
  this.cache.invalidate(keys);
  this.glCache?.invalidate(keys);
}
```

In `Renderer`, add a thin wrapper that mirrors `invalidateCache(strokeId)`:

```typescript
invalidateCacheBBox(bbox: [number, number, number, number]): void {
  this.tiledLayer?.invalidateBBox(bbox);
}
```

(`pathCache` is keyed by stroke id, not bbox, so it stays out of this path.
The path-cache entry for a restored stroke either was never present or is
already correct; the tile re-render will re-resolve as needed.)

**2. `src/view/PaperView.ts`**

Add the missing invalidation in the four affected branches. After mutating doc
and spatialIndex:

```typescript
case "remove-stroke": {  // undo
  const insertIdx = Math.min(action.index, this.document.strokes.length);
  this.document.strokes.splice(insertIdx, 0, action.stroke);
  this.spatialIndex.insert(action.stroke, insertIdx);
  this.renderer?.invalidateCacheBBox(action.stroke.bbox);  // NEW
  break;
}

case "remove-strokes": {  // undo
  const sorted = [...action.strokes].sort((a, b) => a.index - b.index);
  for (const entry of sorted) {
    const insertIdx = Math.min(entry.index, this.document.strokes.length);
    this.document.strokes.splice(insertIdx, 0, entry.stroke);
    this.spatialIndex.insert(entry.stroke, insertIdx);
    this.renderer?.invalidateCacheBBox(entry.stroke.bbox);  // NEW
  }
  break;
}

case "add-stroke": {  // redo
  this.document.strokes.push(action.stroke);
  this.spatialIndex.insert(action.stroke, this.document.strokes.length - 1);
  this.renderer?.invalidateCacheBBox(action.stroke.bbox);  // NEW
  break;
}

case "add-strokes": {  // redo
  for (const stroke of action.strokes) {
    this.document.strokes.push(stroke);
    this.spatialIndex.insert(stroke, this.document.strokes.length - 1);
    this.renderer?.invalidateCacheBBox(stroke.bbox);  // NEW
  }
  break;
}
```

The trailing `renderStaticWithIcons()` already in both `undo()` and `redo()`
will pick up the dirty tiles and re-render them.

## Tests

Three layers, all small additions to existing test files (no new files).

**`src/canvas/Renderer.test.ts` (or wherever TiledStaticLayer is testable)** —
add a unit test for `invalidateBBox` if there's a fixture. If not, skip; the
behavior is "compute keys via grid, delegate to existing `invalidate(keys)`",
which is two lines of glue and trivially correct by inspection.

**`src/canvas/tiles/WebGLTileCache.test.ts` and `TileCache.test.ts`** — already
test `invalidate(keys)`. No new assertion needed there.

**`src/view/PaperView.test.ts`** (or the relevant integration test) — if there
is one that exercises undo of an erase end-to-end with a fake renderer, add a
case that confirms `invalidateCacheBBox` (or the existing `invalidateCache`) is
called for each restored stroke. If the test infrastructure isn't there, the
manual repro below is the validation.

## Validation

`yarn build && yarn test && yarn build:copy`. Then manually:

1. **Repro the original bug, confirm it fails on main.** Open a paper. Draw a
   stroke X. Erase X. (X disappears.) Undo. **Without panning or zooming**,
   confirm whether X reappears. (On the buggy code, it doesn't until you
   pan/zoom; on the fix, it reappears immediately.)
2. **Repro the multi-stroke variant.** Lasso-select 3 strokes, delete them, undo.
   All three should reappear without pan/zoom.
3. **Redo path.** Same as 1 and 2 but undo then redo.
4. **Long-session erase.** This is the hardest to reproduce on demand, but it's
   the same bug — if (1) is fixed, (1's distant relative) should be fixed too.

## Risks

- **The redo-add path also fires on a fresh `add-stroke` that wasn't preceded
  by undo.** Wait, no — redo only fires after an undo. Not a risk.
- **The bbox we use is `action.stroke.bbox`, which was captured when the
  stroke was committed.** If the stroke got transformed before the erase that
  this undo is reverting, `bbox` would still be the post-transform bbox, which
  is what we want. If a `transform-strokes` action occurred in between, that
  was already invalidating-all when applied. Not a risk.
- **An eraser-style "mostly empty stroke" could have a tiny bbox, miss tiles,
  and not be invalidated.** Stroke bboxes are computed from points; a 1-point
  stroke has a bbox of a single coordinate. `getTilesForWorldBBox` returns at
  least the tile containing the point. Should be fine; verify in test if there
  is one.
- **`invalidateBBox` is O(affected tiles), much cheaper than `invalidateAll`.**
  No perf concern.

## Out of scope (note for follow-up)

Symptom 3 — freshly drawn stroke disappearing then reappearing — looks like a
different bug: a worker tile-result race where an in-flight worker render
returns *after* `bakeStroke` ran synchronously, and the worker's bitmap upload
overwrites the just-baked tile (stale `strokeIds`, pre-stroke pixels).
`bakeStroke` doesn't cancel in-flight worker requests for the tiles it touches.
If the four-path fix doesn't dissolve this symptom, the next plan is:

- In `bakeStroke`, after determining `affectedTiles`, drop those keys from the
  worker scheduler's `inFlight` set or have `handleWebGLTileResult` ignore
  results for tiles whose `lastBakeVersion > resultVersion`.

That requires touching `WorkerTileScheduler` and `handleWebGLTileResult`, so
keeping it separate keeps this PR small and reversible.
