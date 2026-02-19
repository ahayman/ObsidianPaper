# Italic Nib Fountain Pen Simulation — Research

**Date:** 2026-02-19
**Topic:** Implementing directional italic fountain pen simulation in a canvas-based handwriting app

---

## 1. The Core Math: Nib Width Projection

### Physical Model

An italic/stub fountain pen nib is essentially a flat rectangular edge. When held at a fixed angle (the "nib angle" θ_nib, measured from horizontal), the visible stroke width depends entirely on the angle between the nib and the direction of travel (θ_stroke).

The key insight from calligraphy: **a broad-edge nib produces its thinnest stroke when drawn parallel to the nib edge, and its thickest stroke when drawn perpendicular to it.**

### The Formula

Given:
- `nibAngle` — fixed angle of the nib relative to horizontal (e.g., 45° for classic italic)
- `strokeAngle` — direction of travel, computed per segment
- `nibWidth` — the full width of the nib edge (in pixels)
- `nibHeight` — the thinnest possible stroke (the short dimension of the nib, for a rectangular nib this is near 0, for a stub nib it is nonzero)

The projected stroke width at any point is:

```
angleDiff = nibAngle - strokeAngle
projectedWidth = nibWidth * |sin(angleDiff)| + nibHeight * |cos(angleDiff)|
```

Derivation:
- The nib is a rectangle of dimensions `nibWidth × nibHeight`.
- When the stroke direction is perpendicular to the nib edge, the full `nibWidth` face presents itself: `sin(90°) = 1`, maximum width.
- When the stroke direction is parallel to the nib edge, only the short edge `nibHeight` is visible: `sin(0°) = 0`, minimum width.
- The full formula accounts for both dimensions of the rectangular nib via a rotated bounding box projection.

For a pure italic (zero-height nib, i.e., infinitely thin edge), this simplifies to:

```
projectedWidth = nibWidth * Math.abs(Math.sin(nibAngle - strokeAngle))
```

This is the foundational formula used in Inkscape's calligraphy tool. From their documentation: *"The stroke is at its thinnest when drawn parallel to the pen angle, and at its broadest when drawn perpendicular."*

### Why sin, Not cos?

The angle `nibAngle` is typically measured from the horizontal. The nib edge runs *along* that angle. The stroke direction that is perpendicular to the nib produces max width — and perpendicular means a 90° difference — which is where `sin` reaches 1. Using `cos` would flip the relationship.

### atan2 vs Vector Projection

There are two practical approaches to computing `strokeAngle` per segment:

**atan2 approach:**
```typescript
const dx = p2.x - p1.x;
const dy = p2.y - p1.y;
const strokeAngle = Math.atan2(dy, dx);  // [-π, π]
const projectedWidth = nibWidth * Math.abs(Math.sin(nibAngle - strokeAngle));
```

**Vector cross-product / dot-product approach (avoids trig for width):**

Since `sin(a - b) = sin(a)cos(b) - cos(a)sin(b)`, and the nib direction is a fixed unit vector `(cos(nibAngle), sin(nibAngle))`, and the stroke direction is the normalized segment vector `(dx/len, dy/len)`:

```typescript
const len = Math.hypot(dx, dy);
const sx = dx / len;  // stroke unit vector
const sy = dy / len;
const nx = Math.cos(nibAngle);  // nib unit vector (constant, precomputed)
const ny = Math.sin(nibAngle);
// sin of angle between them = magnitude of 2D cross product
const crossMag = Math.abs(nx * sy - ny * sx);
const projectedWidth = nibWidth * crossMag;
```

**Performance verdict:** The vector cross-product approach avoids calling `atan2` (which involves an expensive arctangent) and `sin` per point. Only `Math.hypot` (or a manual length computation) is needed per segment. The nib unit vector `(nx, ny)` is precomputed once when the nib angle is set. This is measurably faster in tight render loops.

The gamedev community consensus (confirmed at gamedev.net) is that `atan2` is slower than combined dot/cross for signed angle comparisons. For a 120Hz Apple Pencil producing ~120 pointer events per second (with coalesced events up to 240Hz on iPad Pro), each frame may process 2-5 segments — making raw per-call overhead modest but still worth eliminating.

---

## 2. Real-Time Calligraphy Engine Approaches

### Inkscape's Calligraphy Tool

Inkscape's calligraphy tool (open source, C++) is the canonical reference implementation. Key parameters:

- **Angle** (0–90°): The nib angle relative to horizontal.
- **Width**: Base nib width.
- **Fixation** (0–1): How strictly the nib angle follows the stroke direction. At 0, the nib rotates to always be perpendicular to the path (constant apparent width). At 1, the angle is fixed, giving full calligraphic width variation.
- **Thinning**: Modifies width based on stylus speed, simulating ink flow.

At fixation = 1.0, the engine computes the outline of the swept nib as a parallelogram polygon per segment, building a left and right offset path.

### Procreate's Approach

Procreate uses a stamp-based brush engine where a brush "shape" (texture image) is plotted at intervals along the stroke path. For calligraphic pens, the stamp shape is a rotated ellipse or rectangle. The **azimuth** of the Apple Pencil overrides the rotation of each stamp to match the physical stylus orientation.

- This is accurate when using physical azimuth, but adds complexity for fixed-angle nib simulation.
- Stamp overdraw is expensive and Procreate compensates with GPU acceleration and direct Metal rendering.

For web canvas use, pure stamp-based approaches are impractical due to overdraw performance. The outline polygon approach is preferred.

---

## 3. Variable-Width Stroke Rendering on HTML5 Canvas

### The Fundamental Problem

HTML5 Canvas `lineWidth` is uniform per stroke call. To render strokes with per-point variable width, you must **compute a filled polygon outline** and call `ctx.fill()` instead of `ctx.stroke()`.

### The Quadrilateral Tessellation Algorithm

For each consecutive pair of points `A → B` with widths `w1` and `w2`:

```typescript
const dx = B.x - A.x;
const dy = B.y - A.y;
const len = Math.hypot(dx, dy);
// Perpendicular normal (unit length)
const nx = -dy / len;
const ny =  dx / len;
// Four corner points of the quadrilateral
const A1 = { x: A.x + nx * w1/2, y: A.y + ny * w1/2 };
const A2 = { x: A.x - nx * w1/2, y: A.y - ny * w1/2 };
const B1 = { x: B.x + nx * w2/2, y: B.y + ny * w2/2 };
const B2 = { x: B.x - nx * w2/2, y: B.y - ny * w2/2 };
// Draw: moveTo A1, lineTo B1, lineTo B2, lineTo A2, closePath, fill
```

This is documented in detail by GameAlchemist's "Variable Width Lines in HTML5 Canvas" (2013) and remains the standard approach.

### Outline-Based Rendering (Two-Pass)

Rather than rendering quad-by-quad, a smoother approach generates two separate paths (left side and right side of the stroke) and fills the combined polygon:

1. Walk forward along all points, computing the left offset at each point using the per-point width.
2. Walk backward, computing the right offset.
3. Fill the complete polygon.

This avoids segment-join artifacts. However, for real-time rendering, you cannot wait for the full stroke — you render incrementally.

### Joining Strategies

When consecutive quads meet at a corner, the outer edge can produce a gap (for acute turns) or overlap (for obtuse turns). Three strategies:

- **Miter join**: Extend the outer edges until they intersect. Sharp at high angles; capped by miter limit.
- **Bevel join**: Connect the two outer edge endpoints with a straight line (fills the gap).
- **Round join**: Arc between the two outer edge endpoints. Smoothest but requires arc computation.

For calligraphy simulation, **bevel joins** are typically sufficient and cheapest. Round joins are better for brush strokes. Lyon's stroke tessellation wiki documents the per-vertex normal computation.

### Practical Incremental Render Strategy

For real-time drawing:

1. Maintain a running "right side" and "left side" point array as the stroke is drawn.
2. On each new pointer event, compute the new width at the incoming point, add two new offset points to the outline arrays.
3. To render, draw the incremental triangle (two new outline points + the previous two) using `ctx.fill()` with `globalCompositeOperation = 'source-over'`.
4. Use a **dirty rectangle** to constrain the `clearRect` + redraw area to the bounding box of recent points.

This pattern is described in the MDN Canvas Optimization guide and the web.dev canvas performance article.

---

## 4. Smooth Transitions: Avoiding Jaggy Artifacts

### Sources of Artifacts

1. **Abrupt width changes**: If point-to-point direction changes sharply (quick direction reversal), `sin(angleDiff)` can jump from near-0 to near-1 in a single frame.
2. **Segment join gaps**: Mismatched outer edge endpoints between consecutive quads.
3. **Subpixel aliasing**: Sharp polygon edges at low widths.

### Smoothing Strategies

**Temporal smoothing of computed width:**
Apply a low-pass filter on the projected width value across consecutive points:

```typescript
const rawWidth = nibWidth * Math.abs(crossProduct(nibVec, strokeVec));
const smoothedWidth = prevWidth * 0.6 + rawWidth * 0.4;
```

This prevents instantaneous jumps. The blend factor (0.6/0.4 here) controls responsiveness vs. smoothness. Values around 0.3–0.5 for the new sample give a natural calligraphic feel.

**Stroke direction smoothing:**
Rather than computing `strokeAngle` from consecutive raw pointer events (noisy at slow speeds), compute it from a moving average of the last 2–3 segment vectors. This is analogous to `perfect-freehand`'s `streamline` parameter.

**Overlap-and-fill for joins:**
When the outer edge of consecutive quads is discontinuous, explicitly triangulate the gap (a bevel triangle at the join point).

**Minimum width floor:**
Set a minimum projected width (e.g., `nibHeight` or 1.5px) to avoid degenerate zero-width geometry that produces hairline artifacts.

---

## 5. perfect-freehand Library Assessment

### What It Provides

`perfect-freehand` (npm: `perfect-freehand`, by steveruizok) generates an outline polygon for a pressure-sensitive freehand stroke. Its pipeline:

1. `getStrokePoints(rawPoints, opts)` — smooths input, computes `{ point, pressure, vector, distance, runningLength }` per point.
2. `getStrokeOutlinePoints(strokePoints, opts)` — generates left/right offset arrays and returns a combined outline polygon.

Key options: `size` (base width), `thinning` (pressure effect), `smoothing`, `streamline`, `simulatePressure`, `easing`.

### Does It Support Direction-Based Width?

**No, not natively.** The `thinning` option only maps *pressure* to width. There is no built-in hook for direction-dependent width (i.e., no `sizeFn` or per-point custom size callback).

The internal `StrokePoint` type does include a `vector` field (the normalized segment direction vector), but this is used internally for smoothing, not exposed via a user callback.

### Options for Using It with Italic Nib Simulation

**Option A: Pre-process pressure values**
Compute the italic projected width for each point and pack it into the `pressure` field of the input array with `simulatePressure: false` and `thinning: 1`:

```typescript
const points = rawPoints.map((p, i) => {
  const strokeVec = computeStrokeVector(rawPoints, i);
  const projWidth = computeItalicWidth(strokeVec, nibAngle, nibWidth, nibHeight);
  const normalizedPressure = projWidth / nibWidth;  // normalize to [0,1]
  return [p.x, p.y, normalizedPressure];
});
getStroke(points, { size: nibWidth, thinning: 1, simulatePressure: false });
```

This works but loses the ability to also modulate width by actual pen pressure — you must fold both effects into the single pressure channel.

**Option B: Combine pressure and direction**
```typescript
const directionFactor = computeItalicWidth(strokeVec, nibAngle, nibWidth, nibHeight) / nibWidth;
const combinedPressure = actualPressure * directionFactor;
```

This allows both pressure sensitivity and direction-based width to interact.

**Option C: Custom outline generator (recommended for full control)**
Fork `getStrokeOutlinePoints` or write a custom version. The algorithm is straightforward (two-sided offset path with smoothing). A custom implementation can:
- Accept per-point widths directly (no pressure normalization hack).
- Apply different widths to the two sides (for eccentric nib shapes).
- Control join styles.

The perfect-freehand source is well-structured and the core `getStrokeOutlinePoints` function is ~200 lines. A custom version focused on per-point widths eliminates the pressure abstraction layer entirely.

**Verdict**: For authentic italic nib simulation, a custom outline generator is the cleanest approach. `perfect-freehand` is excellent for generic brush/pen strokes but its pressure-only width model requires workarounds for direction-based width.

---

## 6. Stamp-Based vs. Outline-Based Rendering

### Stamp-Based Approach

The pen nib shape (a rotated rectangle or ellipse) is drawn repeatedly at intervals along the stroke path, with spacing small enough that stamps overlap.

**Pros:**
- Trivial to implement (just `ctx.save(); ctx.rotate(nibAngle); ctx.fillRect(...)` per stamp).
- Naturally handles arbitrary nib shapes.
- Good for texturing (each stamp can sample a grain texture).

**Cons:**
- **Overdraw**: Every overlapping stamp repaints the same pixels. At 120Hz with dense point spacing, this can mean hundreds of stamps per frame.
- Apoorvaj's "Efficient Rendering of Linear Brush Strokes" paper quantifies this: discrete stamps cause GPU memory bandwidth saturation from overdraw, the same phenomenon that limits WebGL `gl.LINES` performance.
- Requires careful alpha blending to avoid double-darkening at overlaps (typically requires a separate accumulation buffer with per-stroke compositing).
- The nib cursor and the stamp must be kept in sync.

### Outline-Based Rendering

Compute the swept outline polygon of the nib as it travels along the path, and fill the polygon once.

**Pros:**
- Single fill operation per stroke segment — no overdraw.
- Clean edges with antialiasing from Canvas 2D's fill antialiasing.
- Width transitions are geometrically encoded in the polygon shape.
- Works naturally with Canvas 2D's `save()`/`restore()` and compositing.

**Cons:**
- More complex geometry generation (join handling, caps).
- Cannot trivially apply per-stamp texture variation (though grain can be applied as a fill pattern or composited separately).

**Verdict for italic nib simulation**: Outline-based rendering is strongly preferred. The per-segment quadrilateral approach with bevel joins gives excellent visual results with minimal CPU/GPU cost.

---

## 7. Nib Cursor / Overlay Rendering

To display the nib shape under the Apple Pencil hover position:

```typescript
function drawNibCursor(ctx: CanvasRenderingContext2D, x: number, y: number, nibAngle: number, nibWidth: number, nibHeight: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(nibAngle);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(-nibWidth / 2, -nibHeight / 2, nibWidth, nibHeight);
  ctx.restore();
}
```

For a more refined cursor, use a rounded rect (`ctx.roundRect`) or a slight stroke with a lighter fill to suggest the nib shape.

**Cursor canvas separation**: Render the nib cursor on a separate overlaid canvas element (transparent, `pointer-events: none`, absolutely positioned over the drawing canvas). This allows the cursor to update on every `pointermove` event without touching the stroke canvas, and the cursor layer can be cleared/redrawn cheaply.

The cursor should rotate to reflect the current nib angle and scale to reflect the nib dimensions. If using physical Apple Pencil azimuth (`PointerEvent.azimuthAngle`), the cursor can follow the physical pen orientation rather than a fixed nib angle.

---

## 8. Performance for 120Hz+ Apple Pencil Input

### Input Delivery

- Apple Pencil Pro on iPad Pro delivers reports at up to 240Hz.
- Browser `pointermove` events are dispatched at the display refresh rate (~60–120Hz) by default.
- Use `PointerEvent.getCoalescedEvents()` inside `pointermove` to access all intermediate reports coalesced into a single event. This is critical for smooth strokes at 240Hz pencil input.
- Use `PointerEvent.getPredictedEvents()` to draw ahead by 1–2 predicted points, dramatically reducing perceived latency (supported since late 2024 across Chrome, Safari, Edge).

```typescript
canvas.addEventListener('pointermove', (e) => {
  const events = e.getCoalescedEvents();
  for (const coalescedEvent of events) {
    processPoint(coalescedEvent.x, coalescedEvent.y, coalescedEvent.pressure);
  }
  // Optionally draw predicted points in a lighter color
  const predicted = e.getPredictedEvents();
  drawPredictedPath(predicted);
});
```

### Desynchronized Canvas

```typescript
const ctx = canvas.getContext('2d', { desynchronized: true });
```

With a desynchronized canvas, the browser does not synchronize canvas updates to the display refresh cycle. Input events delivered mid-frame can appear on screen in the current frame rather than the next, reducing perceived latency by up to one frame (8–16ms).

This is the single highest-impact latency optimization for drawing apps, as confirmed by multiple sources including the nutrient.io blog and Apple developer forums.

### Ink Enhancement API (Edge on Windows only)

The WICG Ink Enhancement API (`navigator.ink.requestPresenter()`) allows the OS compositor to render the ink trail between frames, reducing latency by up to 240% (per Microsoft's measurements). Currently only supported in Edge on Windows 11. Not relevant for iPad/Safari, but worth a feature-detected enhancement for Obsidian Desktop on Windows.

### Dirty Rectangle Strategy

For each frame:
1. Track the bounding box of points rendered in this frame.
2. Expand by `nibWidth / 2` on all sides.
3. Use `ctx.clearRect(dirtyX, dirtyY, dirtyW, dirtyH)` to clear only the dirty region.
4. Redraw only the affected segments.

For strokes that are still in progress (current stroke), maintain a separate offscreen canvas for the completed stroke history and a second canvas for the in-progress stroke. Composite them on each frame.

### Per-Point Width Computation Cost

For 240 coalesced points per second with the cross-product formula:
- `Math.hypot(dx, dy)`: ~1 multiply, 1 add, 1 sqrt → ~5ns
- `crossMag = Math.abs(nx * sy - ny * sx)`: 2 multiplies, 1 subtract, 1 abs → ~2ns
- Total per point: ~10–15ns → negligible at 240 points/sec.

`Math.atan2` costs approximately 3-5× more than a cross-product approach (confirmed by the DSPrelated fast atan2 approximation article), but at 240Hz this difference (~2–5µs per frame) is not a bottleneck. The simpler cross-product formula is preferred for correctness and clarity.

---

## 9. Recommended Architecture

```
Input Layer
  PointerEvent (pointermove) + getCoalescedEvents() + getPredictedEvents()
  → Per-point: { x, y, pressure, azimuthAngle? }

Width Computation Layer (per point)
  strokeVec = normalize(p[i] - p[i-1])              // segment direction
  crossMag = |nibVec × strokeVec|                    // 2D cross product magnitude
  rawWidth = nibWidth * crossMag + nibHeight * (1 - crossMag) // full formula
  smoothedWidth = lerp(prevWidth, rawWidth * pressure, 0.4)   // temporal smoothing

Outline Generator (custom, not perfect-freehand)
  leftPts[] / rightPts[] — per-point offset arrays
  On each new point: append two new offset points (left, right)
  Join: bevel (simple) or miter (with miter-limit fallback)
  Cap: round at start/end

Renderer
  Canvas A (offscreen, persistent): completed strokes
  Canvas B (onscreen): = Canvas A + current in-progress stroke
  Each frame:
    ctx.drawImage(canvasA, 0, 0)         // blit completed strokes
    drawOutlinePolygon(leftPts, rightPts) // fill current stroke outline

Cursor Layer
  Separate overlay canvas (pointer-events: none)
  On pointermove: clear, draw rotated nibWidth × nibHeight rect at pen position
```

---

## 10. Reference Implementations and Sources

| Resource | URL | Relevance |
|---|---|---|
| perfect-freehand | https://github.com/steveruizok/perfect-freehand | Outline generation baseline |
| GameAlchemist variable-width lines | https://gamealchemist.wordpress.com/2013/08/28/variable-width-lines-in-html5-canvas/ | Quadrilateral tessellation algorithm |
| Inkscape calligraphy tool docs | https://inkscape.org/doc/tutorials/calligraphy/tutorial-calligraphy.html | Calligraphic nib model reference |
| Lyon stroke tessellation | https://github.com/nical/lyon/wiki/Stroke-tessellation | Normal/join computation details |
| Apoorvaj brush strokes paper | https://apoorvaj.io/efficient-rendering-of-linear-brush-strokes/ | Stamp vs continuous model analysis |
| Drawing Lines is Hard | https://mattdesl.svbtle.com/drawing-lines-is-hard | Variable-width line rendering tradeoffs |
| Infinite Canvas polyline tutorial | https://infinitecanvas.cc/guide/lesson-012 | WebGL shader-based variable-width lines |
| MDN getCoalescedEvents | https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents | High-frequency input access |
| MDN getPredictedEvents | https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents | Predictive rendering |
| MDN azimuthAngle | https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/azimuthAngle | Physical pen orientation |
| WICG Ink Enhancement API | https://github.com/WICG/ink-enhancement | OS-level latency reduction |
| web.dev canvas performance | https://web.dev/canvas-performance/ | Canvas optimization techniques |
| Domenicobrz variable-width WebGL | https://github.com/Domenicobrz/Variable-width-lines-algorithm | Miter/bevel join reference |
| fast atan2 approximation | https://www.dsprelated.com/showarticle/1052.php | atan2 performance analysis |
| nutrient.io getCoalescedEvents | https://www.nutrient.io/blog/using-getcoalescedevents/ | Practical coalesced events guide |
