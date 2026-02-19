# Plan: Fix Save-Path Blocking That Causes Missed Strokes

## Root Cause

`serializeDocument()` calls `compressString()` → `deflateSync()` (synchronous fflate deflate) on **every stroke** on **every save**. For 50+ strokes this blocks the main thread for 55–170ms. Obsidian's 2-second `requestSave()` debounce fires right when the user resumes writing after a pause, and the `pointerdown` for the new stroke lands during the block.

Stroke `pts` strings are immutable after creation — re-compressing unchanged strokes is entirely redundant.

The rendering pipeline optimizations (deferred finalization + bake to RAF) are correct and stay. This plan addresses the remaining bottleneck.

## Changes

### 1. `src/document/Serializer.ts` — Cache compressed pts per stroke

**a) Add a module-level WeakMap for caching:**
```typescript
const compressedPtsCache = new WeakMap<Stroke, string>();
```

WeakMap is ideal: stroke identity is stable, entries auto-clean on GC when strokes are erased/undo'd.

**b) Export `precompressStroke()` for eager caching:**
```typescript
export function precompressStroke(stroke: Stroke): void {
  if (!compressedPtsCache.has(stroke)) {
    compressedPtsCache.set(stroke, compressString(stroke.pts));
  }
}
```

**c) Use cache in `serializeStroke()`:**
```typescript
function serializeStroke(stroke: Stroke, compress: boolean): SerializedStroke {
  return {
    // ...
    pts: compress
      ? (compressedPtsCache.get(stroke) ?? cacheAndReturn(stroke))
      : stroke.pts,
  };
}

function cacheAndReturn(stroke: Stroke): string {
  const compressed = compressString(stroke.pts);
  compressedPtsCache.set(stroke, compressed);
  return compressed;
}
```

### 2. `src/view/PaperView.ts` — Pre-compress new strokes in finalization RAF

In the `scheduleFinalization` callback, after `bakeStroke`:
```typescript
precompressStroke(stroke);
```

This runs in the RAF callback (after all events are processed for this frame), so it doesn't affect event delivery. Adds ~1–3ms to the RAF callback, which is acceptable since it only processes one new stroke.

### 3. `src/view/PaperView.ts` — Background pre-compress loaded strokes

After `setViewData()` finishes loading, schedule background compression of all existing strokes in small batches using `setTimeout` to yield to the event loop between batches:

```typescript
private precompressLoadedStrokes(): void {
  const strokes = this.document.strokes;
  let i = 0;
  const batch = () => {
    const end = Math.min(i + 10, strokes.length);
    for (; i < end; i++) {
      precompressStroke(strokes[i]);
    }
    if (i < strokes.length) {
      setTimeout(batch, 0);
    }
  };
  setTimeout(batch, 200); // Start after initial render settles
}
```

10 strokes per batch × ~1–3ms per compress = ~10–30ms per batch, with event loop yields between. A 100-stroke document completes in ~1 second of wall time without perceptible jank.

## Performance Impact

| Scenario | Before | After |
|----------|--------|-------|
| `getViewData()` with 50 strokes (all cached) | ~55–170ms | ~5–20ms (JSON.stringify only) |
| `getViewData()` with 50 strokes (none cached, first save) | ~55–170ms | ~55–170ms (same, one-time) |
| New stroke finalization RAF | ~10–25ms | ~12–28ms (+compression of 1 stroke) |
| `onStrokeEnd` handler | ~0.15ms | ~0.15ms (unchanged) |

After the background pre-compression completes, saves are **~5–20ms** regardless of document size — well within the 16ms frame budget.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Save before background pre-compression finishes | `cacheAndReturn` fallback compresses on the fly and caches for next time. First save may be partially slow. |
| Undo removes a stroke | Stroke stays in undo manager → WeakMap keeps cache. Redo re-adds same object → cache hit. |
| Undo, then GC | WeakMap entry auto-cleans. If stroke is re-added later (shouldn't happen after GC), it re-compresses. |
| Style changes don't affect pts | Correct — pts is immutable. Style overrides are separate fields. |
| Document reload (`setViewData`) | New stroke objects from deserialization → old cache entries orphaned → GC'd. Fresh pre-compression scheduled. |

## Verification

1. `yarn test` — all tests pass
2. `yarn lint` — clean
3. `yarn build` — builds successfully
4. On iPad: rapid handwriting should not miss strokes; saves should not cause jank
