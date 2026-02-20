# Transparency Performance Investigation

**Date:** 2026-02-20
**Issue:** Zoom/pan drops to sub-1 FPS when strokes use transparency (pencil grain, highlighter multiply), while drawing performance is unaffected.

---

## Root Cause

The performance asymmetry comes from what happens during drawing vs zoom/pan:

### During Drawing (fast)
- `renderActiveStroke()` draws only the **single in-progress stroke** on the active canvas
- When the stroke finishes, `bakeStroke()` paints it **once** onto the static canvas — O(1)
- The rest of the static canvas is untouched

### During Zoom/Pan (slow)
- `renderStaticLayer()` (Renderer.ts:136) **clears** the static canvas and **replays every visible stroke from scratch**
- For each pencil stroke, `renderStrokeWithGrain()` (Renderer.ts:640):
  1. Clears a **full-screen** offscreen canvas (same dimensions as static canvas)
  2. Copies the current DPR+camera transform
  3. Draws the stroke fill with `globalAlpha` (transparency)
  4. Applies grain via `destination-out` composite operation
  5. `drawImage()` the **entire** offscreen canvas back to static

**This means:** If 50 pencil strokes are visible, zoom/pan triggers **50 full-screen offscreen canvas clear+drawImage cycles**, each involving alpha blending and composite operations. The cost scales as O(visible_strokes × canvas_pixels).

### Why Transparency is Specifically Expensive

Alpha blending is a **read-modify-write** per pixel:
1. Read destination pixel from framebuffer
2. Compute: `result = src × srcAlpha + dst × (1 - srcAlpha)`
3. Write blended result back

Opaque rendering is just a write (no read, no blend math) — roughly 2-3× cheaper per pixel. But with **overdraw** (overlapping transparent strokes), the same pixel goes through read-modify-write once per overlapping stroke. 20 overlapping strokes = 20× the pixel work vs opaque.

The `destination-out` composite used for grain is particularly expensive because it requires reading back pixels, computing the inverse alpha mask, and writing — and it's applied across the entire stroke path.

The `multiply` composite used for highlighters similarly requires per-pixel reads and channel multiplication.

### Why the Offscreen Canvas Makes It Worse

The grain isolation approach (`renderStrokeWithGrain`) is correct for visual quality — it prevents overlapping pencil strokes from punching holes through each other. But the offscreen canvas is sized to the **full static canvas** (at DPR×2 on Retina, that's ~2048×2732 on iPad Pro). Every stroke clear+drawImage operates on this full area, even if the stroke itself is tiny.

---

## All Possible Solutions

### Solution 1: CSS Transform During Gestures (Biggest Quick Win)

**Concept:** During pinch/pan gestures, apply CSS `transform: scale() translate()` to the canvas DOM elements instead of redrawing. The GPU handles this as a free layer reposition. Only trigger a real canvas redraw when the gesture ends.

**Implementation:**
```
onPanMove / onPinchMove:
  1. Update camera state (same as now)
  2. Apply CSS transform to all 4 canvas elements
  3. Do NOT call requestStaticRender()

onPanEnd / onPinchEnd:
  1. Remove CSS transform
  2. Call requestStaticRender() once
```

**Pros:**
- Gestures become perfectly smooth — GPU composites the existing bitmap for free
- Minimal code change (gesture handlers + CSS transform math)
- Preserves all visual quality

**Cons:**
- Content looks blurry when zoomed in during gesture (old resolution bitmap is scaled)
- Single redraw at gesture end may still hitch if many transparent strokes
- Visual "snap" when CSS transform is replaced with true render

**Verdict:** Easiest win for perceived smoothness. Should combine with Solution 2 to also fix end-of-gesture cost.

---

### Solution 2: Bitmap Cache for Static Content (Biggest Structural Fix)

**Concept:** Maintain a pre-composited bitmap of all completed strokes. During zoom/pan, `drawImage()` the cached bitmap instead of replaying all strokes.

The current `bakeStroke()` already paints incrementally to the static canvas — the issue is that `renderStaticLayer()` throws it all away and redraws from scratch. Instead:

**Implementation approach A — Keep the static canvas as the cache:**
- Don't clear/re-render static canvas on zoom/pan
- Instead, keep a separate "display" canvas that shows a transformed copy
- Use `drawImage(staticCanvas, ...)` with the zoom/pan transform

**Implementation approach B — Dedicated off-screen cache at a fixed "bake resolution":**
- Maintain an offscreen canvas at a chosen resolution
- All completed strokes bake onto it (as they do now)
- During zoom/pan, `drawImage()` the cache with the appropriate transform
- On zoom level change, schedule a background re-bake at new resolution

**Multi-resolution variant:**
- Keep 2-3 baked bitmaps at different zoom levels
- During gesture, use the closest resolution
- After gesture, bake at the exact final zoom level

**Pros:**
- Reduces zoom/pan from O(strokes × pixels) to O(1 drawImage)
- The transparency cost is paid once at bake time, never during zoom/pan
- drawImage of an already-composited bitmap is fast regardless of original transparency

**Cons:**
- Fixed resolution → zooming in shows pixelation until re-bake
- Re-bake on zoom change still incurs the full cost (but only once, not per-frame)
- Undo/redo needs selective re-bake (re-render all strokes minus the undone one)
- Memory cost of maintaining cache bitmaps (at 2× DPR: ~42MB per full iPad Pro canvas)

**Verdict:** The structural fix. Combined with CSS transform gestures, zoom/pan becomes smooth with a single re-bake deferred to after the gesture.

---

### Solution 3: Scope the Grain Offscreen Canvas to Stroke Bounds (Easy Optimization)

**Concept:** Instead of using a full-screen offscreen canvas for grain isolation, size it to the stroke's bounding box plus a small margin.

**Current behavior** (Renderer.ts:619-633, 640-682):
- `ensureGrainOffscreen()` creates a canvas matching `staticCanvas.width × staticCanvas.height`
- Every stroke clears and drawImages this entire surface

**Proposed:**
```
const bbox = stroke.bbox; // [minX, minY, maxX, maxY]
// Transform bbox to screen pixels using camera+DPR
// Size offscreen to just bbox dimensions + small margin
// Offset the drawImage call to the correct position
```

**Pros:**
- Drastically reduces per-stroke clear and drawImage cost
- A typical stroke might occupy 5-10% of the screen, so this is a 10-20× speedup for grain rendering
- Relatively simple change
- No visual quality loss

**Cons:**
- More complex transform math to map bbox to screen coordinates
- Edge cases with very large strokes or strokes near canvas edges

**Verdict:** High-impact, low-effort optimization that should be done regardless of other solutions.

---

### Solution 4: Set `alpha: false` on Static Canvas Context (Free Performance)

**Concept:** When creating the 2D context, pass `{ alpha: false }` to tell the browser the canvas is opaque.

**Current code** (Renderer.ts:84-87):
```typescript
private getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext("2d");
    ...
}
```

**Change:** Only for the static canvas (which renders on top of the background canvas):
```typescript
canvas.getContext("2d", { alpha: false })
```

**Wait — this won't work directly** because the static canvas is stacked on top of the background canvas. With `alpha: false`, the static canvas would have an opaque black/white background, hiding the background layer beneath it.

**However**, you could merge static + background into a single canvas and then use `alpha: false`. Or keep the layered approach and skip this.

**Verdict:** Not directly applicable with the current multi-canvas stack unless layers are merged.

---

### Solution 5: Incremental Zoom via Tiled Bitmap Cache

**Concept:** Divide the world space into tiles. Pre-render each tile's strokes into a tile bitmap. During zoom/pan, composite only visible tiles.

**Pros:**
- Adding a stroke only dirties tiles it intersects (fast incremental update)
- Zoom/pan renders only visible tiles
- Memory bounded by evicting off-screen tiles
- Can maintain multi-resolution tile pyramids

**Cons:**
- Significant implementation complexity
- Strokes spanning tile boundaries need rendering to multiple tiles
- Complex undo/redo
- Overkill unless the canvas is very large

**Verdict:** Best for infinite-canvas scenarios. Consider if document sizes become very large.

---

### Solution 6: WebGL Migration (Nuclear Option)

**Concept:** Replace Canvas 2D with WebGL for stroke rendering.

**Pros:**
- GPU handles alpha blending natively in hardware, in parallel across all pixels
- Matrix transforms (zoom/pan) are essentially free
- Can handle massive stroke counts

**Cons:**
- Complete rendering rewrite
- GLSL shader programming required
- Context loss handling
- Much harder to debug

**Verdict:** Highest performance ceiling but largest cost. Only if Canvas 2D is fundamentally insufficient.

---

### Solution 7: Worker-Based Re-bake (Responsiveness, Not Speed)

**Concept:** Use OffscreenCanvas in a Web Worker for the expensive full re-render. Main thread stays responsive for gestures.

**Pros:**
- UI never freezes — rendering happens on background thread
- Can show CSS-transformed stale content while worker re-renders

**Cons:**
- Doesn't make rendering faster, just moves it off main thread
- Worker communication complexity
- Stroke data serialization overhead

**Verdict:** Useful complement to bitmap caching — do the re-bake in a worker so the main thread never blocks.

---

### Solution 8: Skip Grain at Non-Full Zoom LODs

**Concept:** When LOD > 0 (zoomed out), grain texture is invisible anyway. The current code already skips grain for `lod > 0` (Renderer.ts:540), but this could be extended to also skip the offscreen isolation path.

Already implemented — just confirming it works correctly. At zoom < 0.5, grain is skipped.

---

### Solution 9: Pre-render Grain into Stroke Pixels at Bake Time

**Concept:** When a pencil stroke is finalized and baked, render it with grain once and store the result as a bitmap (ImageBitmap or cached canvas). During re-render, just drawImage the pre-baked stroke bitmap instead of re-running the grain pipeline.

**Pros:**
- Grain computation happens once per stroke, never again
- Re-render cost becomes a simple drawImage per stroke
- Still much cheaper than current grain pipeline

**Cons:**
- Memory cost: one bitmap per pencil stroke
- Must be re-generated when zoom level changes (resolution-dependent)
- Adds complexity for managing per-stroke bitmaps

**Verdict:** Good middle ground between full-scene bitmap cache and current per-stroke re-render.

---

## Recommended Strategy (Prioritized)

### Phase 1 — Immediate Relief
1. **Scope grain offscreen canvas to stroke bounds** (Solution 3) — 10-20× faster grain rendering per stroke, minimal code change
2. **CSS transform during gestures** (Solution 1) — instant smooth zoom/pan, deferred redraw on release

### Phase 2 — Structural Fix
3. **Bitmap cache for static content** (Solution 2) — eliminates per-frame stroke re-rendering during zoom/pan entirely

### Phase 3 — Polish
4. **Worker-based re-bake** (Solution 7) — ensures the deferred re-bake after gesture end doesn't cause a hitch
5. **Multi-resolution baked bitmaps** — smooth zoom across resolution jumps

### Not Recommended (for now)
- WebGL migration: Too expensive for current needs
- Tiling: Over-engineered unless documents grow very large
- `alpha: false`: Doesn't apply cleanly to current layer architecture

---

## References

- [MDN: Optimizing Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [web.dev: Canvas Performance](https://web.dev/articles/canvas-performance)
- [AG Grid: Canvas Rendering Best Practices](https://blog.ag-grid.com/optimising-html5-canvas-rendering-best-practices-and-techniques/)
- [Apple Developer Forums: Drawing app performance](https://developer.apple.com/forums/thread/667466)
- [Mozilla Bug 947368: Canvas gradient fill slow with transparency](https://bugzilla.mozilla.org/show_bug.cgi?id=947368)
