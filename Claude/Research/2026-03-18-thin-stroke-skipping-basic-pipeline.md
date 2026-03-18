# Thin Stroke Skipping in Basic Pipeline

## Problem
Thin strokes in the basic pipeline show gaps/missing chunks when the canvas is zoomed out. The advanced pipeline does not have this issue.

## Root Cause

The issue is **sub-pixel outline fill breakdown** in Canvas2D, amplified by LOD simplification.

### How strokes render in the basic pipeline
All strokes follow: `points → outline polygon (perfect-freehand) → Path2D → ctx.fill(path)`

The outline is a closed polygon where the left and right edges represent the stroke boundaries. When the stroke is thin in screen-space (width × scale < ~1.5px), this polygon becomes extremely narrow — often less than 1 pixel wide. Canvas2D's `fill()` on these near-degenerate polygons produces erratic anti-aliased coverage: some segments render as faint pixels, others vanish entirely, creating visible gaps.

RDP simplification at LOD 1-2 (zoom < 0.5×) makes this worse by removing intermediate points, creating longer straight segments where the left and right edges can cross or nearly overlap.

### Why the advanced pipeline doesn't have this issue
The advanced pipeline uses **stamp-based rendering at LOD 0** (zoom ≥ 0.5×):
- Pencil: individual disc stamps drawn at each point
- Fountain: ink shading stamps composited into the outline
- Felt-tip: rotated rectangular marker stamps
- All stamp approaches render discrete, solid textures at each point that maintain visibility regardless of stroke thinness

At LOD > 0, the advanced pipeline falls back to the same `fill(path)` code and would theoretically have the same issue, but the zoom threshold where LOD > 0 kicks in (< 0.5×) means strokes are already quite small on screen and the visual impact is minimal.

## Proposed Fix

**Draw a centerline backbone for sub-pixel strokes.** When the effective pixel width falls below a threshold, supplement the fill by stroking the centerline (the stroke's raw points) with a 1px minimum width. This ensures continuous visibility without altering the filled outline.

### Implementation location
`src/canvas/StrokeRenderCore.ts`, in the `renderStrokeToContext()` function, after the `ctx.fill(path)` call (lines 220-225).

### Logic
```typescript
// After fill, check if stroke is sub-pixel and draw centerline backbone
const transform = ctx.getTransform();
const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
const effectiveWidth = style.width * scale;
if (effectiveWidth < 1.5) {
  // Build centerline path from decoded points
  const pts = decodedPoints ?? decodePoints(stroke.pts);
  if (pts.length >= 2) {
    const centerline = new Path2D();
    centerline.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      centerline.lineTo(pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.0 / scale; // exactly 1 physical pixel
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(centerline);
  }
}
```

### Performance impact
- **Negligible.** The check runs for every stroke but the branch is a single multiply + compare. The centerline drawing only triggers for sub-pixel strokes, which are a tiny fraction of rendered strokes (only visible when zoomed out far enough that strokes are < 1.5px effective width).
- No additional memory or caching needed — centerline Path2D is generated on-the-fly only when needed.
- LOD-simplified points are used for the centerline, so point counts are already small.

### Why not apply to the advanced pipeline too?
At LOD 0, the advanced pipeline uses stamps that don't have this issue. At LOD > 0, both pipelines could benefit — we could apply the fix to both by putting it in the shared fill(path) code path.
