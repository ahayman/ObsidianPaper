# Zoomable Drawing Canvas: Research Summary

**Date:** 2026-02-18
**Context:** ObsidianPaper plugin -- handwriting with Apple Pencil in Obsidian (Electron on desktop, WebKit on iPad)

---

## Table of Contents

1. [Canvas 2D vs WebGL vs OffscreenCanvas](#1-canvas-2d-vs-webgl-vs-offscreencanvas)
2. [Zooming and Panning](#2-zooming-and-panning)
3. [Real-Time Stroke Rendering](#3-real-time-stroke-rendering)
4. [Stroke Rendering Techniques](#4-stroke-rendering-techniques)
5. [Performance with Many Strokes](#5-performance-with-many-strokes)
6. [Eraser Implementations](#6-eraser-implementations)
7. [Canvas Resolution and DPI Handling](#7-canvas-resolution-and-dpi-handling)
8. [Reference Project Analysis](#8-reference-project-analysis)
9. [Recommendations for ObsidianPaper](#9-recommendations-for-obsidianpaper)

---

## 1. Canvas 2D vs WebGL vs OffscreenCanvas

### Canvas 2D API

**Pros:**
- Simplest API; most documentation and community knowledge available
- Excellent browser support across Electron and WebKit on iPad
- Native support for paths, bezier curves, gradients, and compositing
- `ctx.lineWidth`, `ctx.lineCap`, `ctx.lineJoin` handle basic stroke styling trivially
- Low overhead for simple scenes (few hundred strokes)
- Built-in anti-aliasing for all path operations
- `Path2D` objects allow caching and reuse of complex paths
- No shader compilation, no GPU state management complexity

**Cons:**
- Single-threaded; all drawing blocks the main thread (unless combined with OffscreenCanvas)
- Performance degrades with thousands of complex paths (each path requires CPU rasterization)
- No native instancing or batching -- each `stroke()` or `fill()` call is independent
- Limited control over anti-aliasing quality
- Compositing operations (globalCompositeOperation) can be slow for complex eraser blends
- Variable-width strokes cannot be done with `lineWidth` alone -- must fill polygons or use many short segments

**Performance characteristics:**
- Adequate for up to ~1,000-2,000 visible strokes with moderate point counts
- Bottleneck is CPU rasterization of paths, especially with many bezier control points
- `clearRect` + full redraw is typically faster than trying to do incremental updates for complex scenes
- Hardware-accelerated in both Electron (Chromium Skia backend) and WebKit

### WebGL / WebGL2

**Pros:**
- GPU-accelerated rendering with full control over the pipeline
- Can handle tens of thousands of strokes efficiently through batching
- Stroke geometry can be computed once and uploaded to GPU buffers; re-rendered cheaply on zoom/pan
- Anti-aliasing can be controlled (MSAA, custom shader-based AA)
- Texture-based pen effects (pencil grain, brush textures) are trivial with fragment shaders
- Instanced rendering allows efficient rendering of repeated geometry patterns

**Cons:**
- Significantly more complex to implement: shaders, buffer management, state machines
- Text rendering requires a separate solution (SDF fonts, Canvas 2D overlay, or DOM)
- Bezier curves must be tessellated into triangles on the CPU or evaluated in shaders
- WebGL context loss can occur (especially on iPad when backgrounding) -- must handle restoration
- Debugging is harder; shader errors are opaque
- Anti-aliased smooth lines require significant effort (SDF line rendering, or MSAA)
- May be overkill if the scene never exceeds a few thousand strokes

**Performance characteristics:**
- Can handle 100,000+ line segments at 60fps once geometry is in GPU buffers
- Zoom/pan is essentially free (just update a uniform matrix)
- Initial geometry upload has overhead but subsequent frames are fast
- Fragment-shader-based effects (textures, blending) add minimal cost

### OffscreenCanvas

**Pros:**
- Moves Canvas 2D or WebGL rendering off the main thread into a Web Worker
- Main thread stays responsive during heavy render operations
- Same API as regular Canvas 2D or WebGL
- Available in Chromium (Electron) -- supported since Chrome 69

**Cons:**
- **Not available in WebKit/Safari on iPad as of early 2025** -- this is a critical limitation for our use case
- Worker communication overhead (postMessage for input events, transferring ImageBitmap back)
- Cannot access DOM from worker (no text rendering with DOM overlays)
- Adds architectural complexity for input handling (pointer events on main thread, render commands to worker)

**Verdict for OffscreenCanvas:** Cannot be used as the primary rendering path due to iPad/WebKit incompatibility. Could be used as an optional enhancement on Electron/desktop only.

### Hybrid Approach (Recommended for ObsidianPaper)

The most practical approach for cross-platform (Electron + iPad WebKit) is:

1. **Primary renderer: Canvas 2D** -- for compatibility, simplicity, and adequate performance for typical handwriting use cases
2. **Architecture the rendering layer behind an interface** so that a WebGL backend can be swapped in later if Canvas 2D performance becomes a bottleneck
3. **Use OffscreenCanvas on Electron only** as an optional performance enhancement for heavy documents

This matches what Excalidraw does: Canvas 2D as the primary renderer with careful optimization.

---

## 2. Zooming and Panning

### The Camera/Viewport Transform Model

The standard approach for infinite canvas apps is a **camera transform** model:

```
Screen coordinates = Camera transform * World coordinates
Camera transform = Scale(zoom) * Translate(-cameraX, -cameraY)
```

Every point in the "world" (where strokes are stored) gets transformed to screen coordinates for rendering. Stroke data is always stored in world coordinates; the camera determines what portion of the world is visible.

**Camera state:**
```typescript
interface Camera {
  x: number;      // camera position in world coordinates (center of viewport)
  y: number;
  zoom: number;   // zoom level (1.0 = 100%)
}
```

### Approach A: CSS Transform on Container (Not Recommended)

Applying `transform: scale(zoom) translate(x, y)` on a DOM container that holds the canvas.

- Simple to implement
- Causes blurry rendering at non-1x zoom (bitmap scaling)
- Poor performance with large canvases
- Not suitable for a drawing app where visual fidelity matters

### Approach B: Canvas Transform (Recommended)

Apply the camera transform to the Canvas 2D context before drawing:

```typescript
function render(ctx: CanvasRenderingContext2D, camera: Camera) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();

  // Apply camera transform
  ctx.translate(canvas.width / 2, canvas.height / 2);  // center origin
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Draw all visible strokes in world coordinates
  for (const stroke of getVisibleStrokes(camera)) {
    drawStroke(ctx, stroke);
  }

  ctx.restore();
}
```

**Pros:**
- Strokes render at full resolution at any zoom level
- World-coordinate hit testing is straightforward (inverse transform pointer events)
- Single coordinate system for all stroke data

**Cons:**
- Must re-render all visible strokes each frame during zoom/pan
- At high zoom levels, very fine details are rendered (potential performance issue)

### Approach C: Tiled Rendering

Pre-render regions of the canvas into tiles at various zoom levels (like a map renderer):

- Excellent for very large canvases with many strokes
- Complex to implement: tile management, cache invalidation when strokes change
- Used by some map/GIS applications
- Overkill for a handwriting app unless documents get extremely large

### Zoom/Pan Input Handling

**Pinch-to-zoom (iPad):**
- Listen for `gesturestart`, `gesturechange`, `gestureend` (WebKit-specific) or use the `Pointer Events` API with two-finger tracking
- On iPad with Apple Pencil: pencil input should draw, finger input should pan/zoom
- Use `event.pointerType` to distinguish: `"pen"` = draw, `"touch"` = navigate

**Scroll-to-zoom (Desktop):**
- `wheel` event with `event.deltaY` for zoom, potentially `event.ctrlKey` modifier
- Zoom should be centered on the cursor position (not viewport center)

**Zoom-to-cursor implementation:**
```typescript
function zoomAtPoint(camera: Camera, screenX: number, screenY: number, newZoom: number): Camera {
  // Convert screen point to world point at current zoom
  const worldX = camera.x + (screenX - viewportWidth / 2) / camera.zoom;
  const worldY = camera.y + (screenY - viewportHeight / 2) / camera.zoom;

  // After zoom, the same world point should still be under the cursor
  const newCameraX = worldX - (screenX - viewportWidth / 2) / newZoom;
  const newCameraY = worldY - (screenY - viewportHeight / 2) / newZoom;

  return { x: newCameraX, y: newCameraY, zoom: newZoom };
}
```

### Momentum/Inertia Scrolling

For a natural feel, especially on iPad:
- Track velocity of pan gestures
- On gesture end, apply deceleration animation (exponential decay)
- Use `requestAnimationFrame` for smooth animation
- Stop on any new touch input

### Zoom Level Limits

Typical range: 0.1x to 10x (or 10% to 1000%). For handwriting, 0.25x to 4x may be more practical. Going below 0.1x makes strokes too small to see; above 10x reveals stroke tessellation artifacts.

---

## 3. Real-Time Stroke Rendering

### The Core Challenge

When a user draws with a stylus, there is a stream of pointer events at high frequency (iPad delivers up to 240Hz with `getCoalescedEvents()`). Each event must be reflected on screen with minimal latency (ideally under 16ms). Once the user lifts the stylus, the stroke is "finalized" and can be optimized for storage and batch rendering.

### Double-Buffering / Layered Canvas Approach

The standard technique is to use two canvas layers:

1. **Static layer (back buffer):** Contains all finalized strokes, rendered once and cached
2. **Active layer (front buffer):** Contains only the stroke currently being drawn

```
Visual stack (bottom to top):
  [Static canvas: all completed strokes]
  [Active canvas: current in-progress stroke]
```

**How it works:**
1. When the user starts drawing, render the new stroke points on the active canvas
2. On each pointer event, only clear and re-render the active canvas (cheap: just one stroke)
3. When the stroke is finalized, render it onto the static canvas (or into the static layer's data structure) and clear the active canvas
4. During zoom/pan (when not drawing), re-render the static canvas

**Implementation options:**

**Option A: Two stacked `<canvas>` elements**
- Literally stack two canvases via CSS `position: absolute`
- Active canvas sits on top with `pointer-events: none` (or handles events and delegates)
- Simple, works well

**Option B: Single canvas with cached bitmap**
- Render finalized strokes to an off-screen canvas (`document.createElement('canvas')`)
- On each frame: `drawImage(offscreenCanvas, ...)` then draw active stroke on top
- Fewer DOM elements, slightly more complex

**Option C: ImageBitmap caching**
- After rendering finalized strokes, capture as `ImageBitmap` via `createImageBitmap(canvas)`
- `drawImage` with `ImageBitmap` is faster than canvas-to-canvas in some browsers
- Useful if the static layer is expensive to render

### Coalesced Events for Low Latency

Modern Pointer Events API provides `getCoalescedEvents()` which returns all intermediate points that the OS captured between animation frames:

```typescript
canvas.addEventListener('pointermove', (event) => {
  const coalesced = event.getCoalescedEvents();
  for (const e of coalesced) {
    currentStroke.addPoint({
      x: e.clientX,
      y: e.clientY,
      pressure: e.pressure,
      timestamp: e.timeStamp,
    });
  }
  renderActiveStroke();
});
```

On iPad with Apple Pencil, this is critical -- without coalesced events, you lose data points and strokes appear jagged.

### Predicted Events

`getPredictedEvents()` returns OS-predicted future points to reduce perceived latency:

```typescript
const predicted = event.getPredictedEvents();
```

These should be rendered tentatively (drawn on the active layer but not committed to the stroke data). On the next real event, predicted points are discarded and replaced with actuals. This reduces perceived latency by ~10-20ms.

### requestAnimationFrame Batching

Rather than rendering on every pointer event (which can fire faster than display refresh), batch updates:

```typescript
let needsRender = false;

canvas.addEventListener('pointermove', (event) => {
  processPointerEvent(event);
  if (!needsRender) {
    needsRender = true;
    requestAnimationFrame(() => {
      renderActiveStroke();
      needsRender = false;
    });
  }
});
```

---

## 4. Stroke Rendering Techniques

### 4.1 Variable-Width Strokes Based on Pressure

The Canvas 2D `lineWidth` property is constant for an entire path. To get pressure-varying width, there are several approaches:

#### Approach A: Segmented Lines (Simple, Moderate Quality)

Draw each segment between consecutive points as a separate line with its own width:

```typescript
for (let i = 1; i < points.length; i++) {
  ctx.beginPath();
  ctx.lineWidth = points[i].pressure * maxWidth;
  ctx.lineCap = 'round';
  ctx.moveTo(points[i-1].x, points[i-1].y);
  ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}
```

**Problem:** Visible joints between segments of different widths. Round lineCaps help but create "blobby" artifacts at slow speeds.

#### Approach B: Filled Polygon Outline (High Quality -- Used by perfect-freehand)

Compute the outline polygon of the variable-width stroke, then fill it:

1. For each input point, compute a width based on pressure (and optionally velocity, tilt)
2. At each point, compute the normal (perpendicular to stroke direction)
3. Offset left and right by `width / 2` along the normal to get two outline points
4. Connect all left-side points and all right-side points to form a closed polygon
5. Fill the polygon

```
Input points:    *----*----*----*
                 |    |    |    |
Left outline:   L0---L1---L2---L3
Right outline:  R0---R1---R2---R3
                 |    |    |    |
Filled polygon: L0-L1-L2-L3-R3-R2-R1-R0 (closed)
```

This is the approach used by **perfect-freehand** and is the gold standard for variable-width strokes.

**Smoothing the outline:** The raw outline polygon has sharp corners. Apply Catmull-Rom or bezier smoothing to the outline points before filling.

#### Approach C: Stamp-Based (Texture Stamps Along Path)

Draw a circular (or textured) "stamp" at each point, sized by pressure:

```typescript
for (const point of points) {
  const radius = point.pressure * maxRadius;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}
```

**Works well for:** Felt-tip markers, soft brushes. Overlapping stamps create natural opacity buildup.

**Problem:** Gaps between stamps if points are far apart. Must interpolate intermediate points.

### 4.2 Catmull-Rom and Cubic Bezier Smoothing

Raw pointer input is noisy and produces jagged paths. Smoothing is essential.

#### Catmull-Rom Splines

A Catmull-Rom spline passes through all control points (unlike cubic Beziers where control points pull the curve without it passing through them). This makes them natural for fitting to input data.

**Converting Catmull-Rom to Cubic Bezier (for Canvas 2D `bezierCurveTo`):**

Given four Catmull-Rom control points P0, P1, P2, P3, the equivalent cubic Bezier control points for the segment from P1 to P2 are:

```
B0 = P1
B1 = P1 + (P2 - P0) / (6 * tension)
B2 = P2 - (P3 - P1) / (6 * tension)
B3 = P2
```

Where `tension` is typically 1.0 (standard Catmull-Rom). Higher tension = tighter curve.

```typescript
function catmullRomToBezier(p0: Point, p1: Point, p2: Point, p3: Point, tension = 1): [Point, Point, Point, Point] {
  const t = 1 / (6 * tension);
  return [
    p1,
    { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t },
    { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t },
    p2,
  ];
}
```

#### Streamlining / Input Smoothing

Before spline fitting, it helps to "streamline" input by applying a moving average or exponential smoothing to reduce jitter:

```typescript
// Exponential smoothing (what tldraw calls "streamline")
smoothedX = prevX + streamline * (rawX - prevX);
smoothedY = prevY + streamline * (rawY - prevY);
```

Where `streamline` ranges from 0 (no smoothing) to 1 (raw input). Lower values = more smoothing. A value of 0.5 is a good default for handwriting.

#### Ramer-Douglas-Peucker Simplification

For finalized strokes, reduce point count while preserving shape:

```
Given a polyline, find the point farthest from the line between start and end.
If distance > epsilon, recursively simplify both halves.
If distance <= epsilon, remove all intermediate points.
```

Typical epsilon: 0.5-2.0 world units. Reduces storage and rendering cost for completed strokes.

### 4.3 Fountain Pen Style (Angle-Dependent Width)

A fountain pen's nib has a fixed width oriented at an angle (typically ~45 degrees). The visible stroke width varies based on the direction the pen moves relative to the nib angle.

**Algorithm:**

```typescript
function fountainPenWidth(
  strokeDirection: number,  // angle of movement in radians
  nibAngle: number,         // angle of the nib (e.g., Math.PI / 4 for 45deg)
  nibWidth: number,         // maximum width of the nib
  nibMinWidth: number       // minimum width (the edge of the nib)
): number {
  // Width varies as sine of angle between stroke direction and nib
  const angleDiff = strokeDirection - nibAngle;
  const width = nibMinWidth + (nibWidth - nibMinWidth) * Math.abs(Math.sin(angleDiff));
  return width;
}
```

This produces the characteristic calligraphic variation: thick on ~45-degree strokes, thin on ~135-degree strokes (perpendicular to nib).

**Implementation with the polygon outline approach:**
1. At each point, compute stroke direction from the vector to the next point
2. Compute the fountain pen width at that direction
3. Use the width for the left/right outline offset
4. Optionally: also rotate the offset direction slightly to simulate nib rotation

**Enhancement with Apple Pencil tilt:**
Apple Pencil provides `tiltX` and `tiltY` (or `altitudeAngle` and `azimuthAngle` on iPad). The azimuth angle can be used as the nib angle, making the effect respond to how the user holds the pencil.

### 4.4 Pen Texture Rendering

#### Ballpoint Pen
- Consistent width with slight pressure variation
- Very slight transparency/opacity variation based on pressure (lighter pressure = slightly lighter line)
- No texture needed; solid fill with slight alpha variation
- `globalAlpha = 0.85 + pressure * 0.15`

#### Felt-Tip Marker
- Medium width, consistent opacity
- Slight "bleeding" at edges -- can simulate with a soft-edge brush stamp or by rendering the stroke with slight transparency and a wider stroke underneath
- Semi-transparent: overlapping strokes darken (use `globalCompositeOperation = 'multiply'` or just alpha blending)
- Stamp-based rendering works well here

#### Brush Pen
- Highly pressure-sensitive width variation (thin to very thick)
- Variable opacity based on pressure
- Can combine the polygon-outline approach with opacity variation
- "Dry brush" effect: at low pressure or high speed, gaps appear. Simulate by reducing opacity or using a texture mask

#### Pencil (Graphite)
- **Texture is critical** -- pencil strokes show paper grain
- Approach: Use a paper texture (grainy noise pattern) as a mask
  1. Create a tileable paper grain texture (or generate with Perlin noise)
  2. Render the stroke shape as a mask
  3. Multiply the mask with the paper texture
  4. The result shows the stroke with grain showing through

```typescript
// Pencil rendering approach:
// 1. Draw stroke to offscreen canvas (solid)
// 2. Apply paper texture using globalCompositeOperation
offCtx.drawStroke(stroke);  // solid stroke
offCtx.globalCompositeOperation = 'destination-in';  // or 'multiply'
offCtx.drawImage(paperGrainTexture, 0, 0);
// 3. Draw result to main canvas with reduced opacity
mainCtx.globalAlpha = 0.3 + pressure * 0.5;
mainCtx.drawImage(offscreenCanvas, 0, 0);
```

- Pencil opacity varies significantly with pressure
- At the stroke level, use the stamp approach with a soft, noisy circular brush
- The paper texture should be in **world coordinates** (so it doesn't shift when the canvas pans)

#### WebGL Advantage for Textures
With WebGL, pen textures become trivial fragment shader operations:
```glsl
// Fragment shader for pencil
uniform sampler2D paperTexture;
uniform float pressure;
void main() {
  float grain = texture2D(paperTexture, gl_FragCoord.xy / textureSize).r;
  float alpha = pressure * grain * strokeMask;
  gl_FragColor = vec4(penColor.rgb, alpha);
}
```

This is one area where WebGL has a clear advantage over Canvas 2D.

---

## 5. Performance with Many Strokes

### The Problem

A handwriting document with several pages of notes might contain 500-2,000 strokes, each with 50-500 points. Naive rendering (iterate all strokes, draw each) will become slow, especially during zoom/pan where every frame must re-render.

### Viewport Culling

Only render strokes that are visible in the current viewport.

**Bounding box per stroke:**
```typescript
interface Stroke {
  points: Point[];
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  // ... other properties
}
```

Compute the bounding box when the stroke is finalized. During rendering:

```typescript
function isVisible(stroke: Stroke, viewport: Rect): boolean {
  return !(
    stroke.boundingBox.maxX < viewport.minX ||
    stroke.boundingBox.minX > viewport.maxX ||
    stroke.boundingBox.maxY < viewport.minY ||
    stroke.boundingBox.minY > viewport.maxY
  );
}
```

This is O(n) per frame but extremely cheap per stroke (just 4 comparisons).

### Spatial Indexing

For very large documents (10,000+ strokes), even the O(n) bounding box check becomes slow. Use a spatial index:

#### R-Tree

An R-tree (or R*-tree) is the standard spatial index for 2D objects:

- Inserts: O(log n)
- Queries (find all strokes in viewport): O(log n + k) where k = number of results
- Libraries: `rbush` (JavaScript, widely used, created by Mapbox/Volodymyr Agafonkin)

```typescript
import RBush from 'rbush';

interface StrokeItem {
  minX: number; minY: number;
  maxX: number; maxY: number;
  stroke: Stroke;
}

const tree = new RBush<StrokeItem>();

// Insert a stroke
tree.insert({
  minX: stroke.boundingBox.minX,
  minY: stroke.boundingBox.minY,
  maxX: stroke.boundingBox.maxX,
  maxY: stroke.boundingBox.maxY,
  stroke,
});

// Query visible strokes
const visible = tree.search({
  minX: viewport.minX,
  minY: viewport.minY,
  maxX: viewport.maxX,
  maxY: viewport.maxY,
});
```

#### Quadtree

An alternative to R-tree. Simpler to implement, but R-tree generally performs better for rectangle queries with overlapping objects.

#### Grid-Based Spatial Hash

For documents with roughly uniformly distributed strokes, a spatial hash is simpler and can be faster:

```typescript
const cellSize = 500; // world units
const grid = new Map<string, Stroke[]>();

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}
```

### Level-of-Detail (LOD)

At low zoom levels (zoomed out), individual stroke details are invisible. LOD strategies:

1. **Point decimation:** At zoom < 0.5, skip every other point. At zoom < 0.25, skip 3 of 4 points. Use pre-computed simplified versions of each stroke (via Ramer-Douglas-Peucker at different epsilon values).

2. **Pre-rendered tiles:** At very low zoom, render regions into cached bitmaps. Only re-render tiles when strokes change.

3. **Stroke simplification thresholds:** At zoom < 0.1, render strokes as simple lines (2 points: start and end) rather than full paths.

```typescript
function getStrokePoints(stroke: Stroke, zoom: number): Point[] {
  if (zoom > 0.5) return stroke.points;           // full detail
  if (zoom > 0.25) return stroke.simplified_2;     // RDP with epsilon=2
  if (zoom > 0.1) return stroke.simplified_5;      // RDP with epsilon=5
  return [stroke.points[0], stroke.points[stroke.points.length - 1]]; // just endpoints
}
```

### Rendering Cache / Dirty Regions

- Cache rendered strokes as `ImageBitmap` or off-screen canvas
- Track a "dirty region" -- only re-render strokes within the dirty region when data changes
- On pan: shift the cached image and render newly exposed regions
- On zoom: full re-render is typically necessary (or use cached tiles at nearby zoom levels)

### Path2D Caching

Canvas 2D `Path2D` objects can be pre-computed and reused:

```typescript
// Compute once when stroke is finalized
stroke.cachedPath = new Path2D();
stroke.cachedPath.moveTo(points[0].x, points[0].y);
for (let i = 1; i < points.length; i++) {
  stroke.cachedPath.lineTo(points[i].x, points[i].y);
}

// Render (can be called many times efficiently)
ctx.stroke(stroke.cachedPath);
```

`Path2D` objects are stored in native (non-JS) memory and can be rendered more efficiently than re-issuing path commands each frame.

**Caveat:** `Path2D` works for constant-width strokes but not for variable-width polygon fills. For variable-width strokes rendered as filled polygons, you'd create a `Path2D` for the outline polygon.

---

## 6. Eraser Implementations

### 6.1 Stroke-Based Erasing (Object Eraser)

The simplest approach: when the eraser touches a stroke, delete the entire stroke.

**Hit testing:**
1. Convert eraser position to world coordinates
2. For each stroke in the spatial index near the eraser:
   - Test if the eraser circle intersects any segment of the stroke
   - Segment intersection: compute distance from eraser center to the line segment; if less than `eraserRadius + strokeWidth/2`, it's a hit

```typescript
function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const projX = ax + t * dx, projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}
```

**Pros:** Simple, clean data model (strokes are simply removed)
**Cons:** Users expect to erase parts of strokes, not whole strokes. Frustrating UX.

### 6.2 Stroke-Splitting Eraser

When the eraser crosses a stroke, split it into two (or more) strokes at the intersection points.

**Algorithm:**
1. Find all points in the stroke within the eraser radius
2. Split the stroke at the first and last erased point indices
3. Create new stroke objects for the remaining segments
4. Delete the original stroke; insert the new sub-strokes

```
Original stroke: *--*--*--*--*--*--*--*
Eraser touches:          [XXXX]
Result:          *--*--*        *--*--*
                 (stroke A)    (stroke B)
```

**Considerations:**
- Must handle the case where the eraser splits a stroke into 3+ pieces (eraser crosses the same stroke multiple times)
- Must recompute bounding boxes for new sub-strokes
- Must recompute smoothed paths for the new endpoints (they may need caps)
- Pressure data must be preserved for the sub-strokes

### 6.3 Pixel/Area-Based Erasing

Erase a circular area, removing all ink within the eraser footprint. This modifies the visual output without respect to stroke boundaries.

**Challenge with vector data:** The stroke data is vector (points + pressure), not pixels. True pixel erasing requires either:

**Approach A: Clipping paths**
- For each stroke that the eraser touches, add a "clip-out" region to the stroke's data
- When rendering the stroke, apply the clip regions as `ctx.clip()` with `evenodd` rule
- Accumulate clip regions per stroke
- **Pros:** Stays in vector domain; zoomable; no resolution loss
- **Cons:** Complex; many clip regions degrade rendering performance

**Approach B: Convert to bitmap for erased strokes**
- When a stroke is pixel-erased, render it to a bitmap and apply the eraser as `globalCompositeOperation = 'destination-out'`
- The stroke becomes a raster element in the document
- **Pros:** Simple pixel-accurate erasing
- **Cons:** Loses vector quality; degrades on zoom; increases memory usage

**Approach C: Subtract eraser path from stroke polygon (Boolean operations)**
- Compute the eraser's swept path as a polygon (union of circles along the eraser movement)
- Subtract this polygon from the stroke's outline polygon using polygon boolean operations
- Libraries: `clipper-lib` (Clipper2), `polybooljs`, `martinez-polygon-clipping`
- **Pros:** Stays fully vector; clean result
- **Cons:** Complex; polygon boolean operations can be expensive and produce complex polygons; edge cases with self-intersecting results

### Recommended Eraser Strategy for ObsidianPaper

1. **Default eraser: stroke-splitting** -- most practical, keeps data as vectors, meets user expectations
2. **Optional "precision eraser": clipping-based** -- add clipping regions to strokes for fine-grained erasing
3. **Avoid pixel-based erasing** -- breaks the vector data model and creates resolution-dependent artifacts

---

## 7. Canvas Resolution and DPI Handling

### The Problem

Modern displays have device pixel ratios (DPR) greater than 1:
- Standard desktop: DPR = 1
- Retina MacBook: DPR = 2
- iPad Pro: DPR = 2
- Some Android tablets: DPR = 2.5, 3

A `<canvas>` with CSS size 800x600 on a DPR=2 display will render at 800x600 device pixels but display across 1600x1200 physical pixels, causing blurriness.

### The Standard Fix

Scale the canvas backing store to match the device pixel ratio:

```typescript
function setupHighDPICanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  // Set backing store size to physical pixels
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  // Set CSS size to logical pixels
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const ctx = canvas.getContext('2d')!;

  // Scale all drawing operations to match
  ctx.scale(dpr, dpr);

  return ctx;
}
```

After this setup, all drawing commands use CSS pixel coordinates, and the canvas renders at full physical resolution.

### Impact on Performance

- A DPR=2 canvas has 4x the pixels of a DPR=1 canvas
- Fill operations, compositing, and rasterization are proportionally more expensive
- This is a significant consideration for iPad Pro (2048x2732 physical pixels)
- Consider rendering at reduced DPR during active zoom/pan, then re-rendering at full DPR when idle

### Dynamic Resolution

During interactive operations (pan, zoom, active drawing of complex scenes), temporarily reduce resolution:

```typescript
function setCanvasResolution(canvas: HTMLCanvasElement, quality: 'full' | 'reduced') {
  const dpr = quality === 'full' ? window.devicePixelRatio : 1;
  // ... resize canvas backing store
}

// During active pan/zoom:
setCanvasResolution(canvas, 'reduced');

// When interaction ends (after a debounce):
setCanvasResolution(canvas, 'full');
```

### Pointer Event Coordinates and DPI

Pointer events report positions in CSS pixels. With the DPR scaling applied to the context (via `ctx.scale(dpr, dpr)`), no additional transformation is needed for hit testing. However, if you're working directly with the canvas backing store pixels, multiply by DPR.

### Resize Handling

When the viewport resizes (or Obsidian pane resizes):

```typescript
const resizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const { width, height } = entry.contentRect;
    setupHighDPICanvas(canvas);  // re-apply DPR scaling
    render();  // re-render at new size
  }
});
resizeObserver.observe(canvas.parentElement);
```

Use `ResizeObserver` rather than the `resize` window event for more precise pane-level resize detection (important in Obsidian where panes resize independently of the window).

---

## 8. Reference Project Analysis

### perfect-freehand (by Steve Ruiz / tldraw)

**What it does:** A library (~3KB) that takes an array of input points (with optional pressure) and returns the outline polygon of a variable-width stroke.

**Key algorithm:**
1. Takes input points `[x, y, pressure]`
2. Applies streamlining (exponential smoothing) to reduce jitter
3. Computes stroke width at each point based on: pressure, velocity (speed-based thinning), and position along stroke (taper at start/end)
4. Computes left and right outline points offset along the normal at each point
5. Returns a single polygon (array of `[x, y]` points) that should be filled

**Key options:**
- `size`: base stroke width
- `thinning`: how much velocity affects width (-1 to 1; positive = thinner when fast)
- `smoothing`: how much to smooth the outline
- `streamline`: input smoothing (0-1)
- `start.taper` / `end.taper`: taper length at stroke start/end
- `simulatePressure`: simulate pressure from velocity when no pressure data

**How to render:** Convert the returned points to a `Path2D` or SVG path and fill:
```typescript
import { getStroke } from 'perfect-freehand';

const outlinePoints = getStroke(inputPoints, options);
const path = new Path2D();
path.moveTo(outlinePoints[0][0], outlinePoints[0][1]);
for (let i = 1; i < outlinePoints.length; i++) {
  path.lineTo(outlinePoints[i][0], outlinePoints[i][1]);
}
path.closePath();
ctx.fill(path);
```

**Relevance to ObsidianPaper:** This is an excellent candidate for the core stroke rendering engine. It handles the hard math of variable-width outline computation. We would use it (or implement a similar algorithm) and add our own pen texture rendering on top.

**Considerations:**
- It returns a polygon outline, not a rendered image -- we still need to handle textures ourselves
- The polygon can have many points (2x the input point count); for very long strokes, this can be expensive to fill
- For fountain pen style, we'd need to modify the width computation to factor in stroke direction relative to nib angle (not built in)
- MIT licensed

### tldraw

**Architecture:**
- React-based infinite canvas application
- Uses **Canvas 2D** for rendering (not WebGL, not SVG)
- Custom rendering engine that re-renders on each frame using Canvas 2D
- Uses `perfect-freehand` for its freehand drawing tool
- Implements its own camera/viewport system with zoom, pan, and rotation

**Rendering approach:**
- Maintains a scene graph of shapes
- On each render frame, walks the scene graph, culls invisible shapes (bounding box check), and draws visible ones to a Canvas 2D context
- Uses the camera transform approach (apply transform to context before drawing)
- Caches shape geometry but re-renders from geometry each frame

**Performance strategies:**
- Viewport culling with bounding boxes
- Shape-level caching of computed geometry
- Debounced re-rendering (skips frames when nothing changes)
- Does NOT use spatial indexing (R-tree) for rendering culling -- relies on simple bounding box checks since typical documents have manageable shape counts

**Key takeaway for ObsidianPaper:** tldraw demonstrates that Canvas 2D with viewport culling is sufficient for a production-quality infinite canvas with freehand drawing. No WebGL needed for the typical use case.

### Excalidraw

**Architecture:**
- React-based
- Uses **Canvas 2D** for rendering (previously used SVG, switched to Canvas for performance)
- Implements its own roughjs-style hand-drawn rendering

**Rendering approach:**
- Re-renders the entire visible scene on each frame
- Applies camera transform to the Canvas 2D context
- Uses `roughjs` for the hand-drawn/sketchy aesthetic
- Element-based scene graph with bounding box culling

**Performance strategies:**
- Viewport culling
- Frame skipping when scene hasn't changed
- Caches rendered elements as `ImageBitmap` on a per-element basis
- For complex scenes, uses a "static canvas" for non-changing elements and an "interactive canvas" for elements being manipulated (similar to the double-buffer approach described in Section 3)

**Zoom implementation:**
- Stores zoom level and scroll offset as state
- Applies as `ctx.translate()` and `ctx.scale()` on the Canvas 2D context
- Zoom centers on cursor position using the algorithm described in Section 2
- Pinch-to-zoom uses Pointer Events API (tracks two touch points)

**Key takeaway for ObsidianPaper:** Excalidraw's dual-canvas (static + interactive) architecture is a proven pattern. Their per-element ImageBitmap caching is an excellent optimization we should consider.

---

## 9. Recommendations for ObsidianPaper

### Rendering Technology

**Use Canvas 2D** as the primary rendering technology. This provides:
- Full compatibility across Electron (desktop) and WebKit (iPad)
- Sufficient performance for handwriting documents (validated by tldraw and Excalidraw)
- Simpler implementation than WebGL
- Abstract the rendering behind an interface (`Renderer`) so a WebGL backend can be added later if needed

### Architecture Summary

```
Rendering Layers:
  [UI Overlay - DOM/HTML]     Selection handles, tool palette, cursors
  [Active Canvas]             Current stroke being drawn (cleared/redrawn per frame)
  [Static Canvas]             All finalized strokes (re-rendered on zoom/pan/edit)

Data Model:
  Document
    -> Pages (or infinite canvas regions)
      -> Strokes[]
        -> points: {x, y, pressure, tilt, timestamp}[]
        -> pen: PenStyle (ballpoint | felt-tip | brush | pencil | fountain)
        -> color: string
        -> boundingBox: Rect (computed)
        -> cachedPath: Path2D (computed, for constant-width strokes)
        -> cachedOutline: Point[] (computed, for variable-width strokes via perfect-freehand)

Camera:
  { x, y, zoom }
  Transformed via ctx.translate/ctx.scale before drawing

Spatial Index:
  R-tree (rbush) for viewport culling and hit testing
```

### Priority Order for Implementation

1. **Basic Canvas 2D rendering with camera transform** -- zoom/pan working
2. **Pointer event handling** with coalesced events, pen/touch discrimination
3. **Real-time stroke rendering** with double-buffer (active + static canvas)
4. **Variable-width strokes** using perfect-freehand (or similar algorithm)
5. **Stroke smoothing** (Catmull-Rom / streamline)
6. **DPI handling** for retina displays
7. **Viewport culling** with bounding boxes
8. **Stroke-splitting eraser**
9. **Pen textures** (pencil grain, brush effects)
10. **Spatial indexing** with R-tree (when documents get large)
11. **Level-of-detail** for zoomed-out views
12. **Fountain pen** angle-dependent width

### Key Libraries to Consider

| Library | Purpose | License | Size |
|---------|---------|---------|------|
| `perfect-freehand` | Variable-width stroke outlines | MIT | ~3KB |
| `rbush` | R-tree spatial index | MIT | ~5KB |
| `clipper2-js` | Polygon boolean operations (for advanced eraser) | Boost | ~50KB |

### Critical iPad/Apple Pencil Considerations

- **Pointer Events API** is the correct API (not Touch Events) for Apple Pencil
- `pointerType === 'pen'` identifies Apple Pencil input
- `getCoalescedEvents()` is essential for capturing full-resolution pencil input (up to 240Hz)
- `getPredictedEvents()` reduces perceived latency
- Apple Pencil provides: `pressure` (0-1), `tiltX`, `tiltY`, `twist` (if supported)
- iPadOS WebKit supports `pointerrawupdate` event for even lower latency (fires outside of rAF)
- **Palm rejection:** The OS handles most palm rejection, but the app should ignore touch events when the pencil is in use (within a short time window)
- **WebGL context loss** is more common on iPad (backgrounding, memory pressure) -- if WebGL is ever used, `webglcontextlost` and `webglcontextrestored` events must be handled

### Performance Targets

- **Stroke-to-pixel latency:** < 16ms (one frame at 60Hz), ideally < 8ms with predicted events
- **Pan/zoom frame rate:** 60fps with < 1000 visible strokes
- **Maximum strokes per document:** Target 10,000+ strokes with spatial indexing
- **Memory per stroke:** ~200-500 bytes (50-100 points * 4-5 numbers * 4 bytes, plus metadata)

---

## Appendix: Key Concepts Quick Reference

### Coordinate Spaces

```
Screen (CSS pixels) --[inverse camera transform]--> World (stroke data)
World (stroke data) --[camera transform]--> Screen (CSS pixels)

screenToWorld(sx, sy):
  wx = camera.x + (sx - viewportW/2) / camera.zoom
  wy = camera.y + (sy - viewportH/2) / camera.zoom

worldToScreen(wx, wy):
  sx = (wx - camera.x) * camera.zoom + viewportW/2
  sy = (wy - camera.y) * camera.zoom + viewportH/2
```

### Pointer Event Properties for Apple Pencil

| Property | Description | Range |
|----------|-------------|-------|
| `pressure` | Force of stylus on screen | 0.0 - 1.0 |
| `tiltX` | Tilt angle along X axis | -90 to 90 degrees |
| `tiltY` | Tilt angle along Y axis | -90 to 90 degrees |
| `twist` | Rotation of stylus | 0 to 359 degrees |
| `pointerType` | Input device type | `"pen"` for Apple Pencil |
| `width` / `height` | Contact geometry | Varies |

### Canvas 2D Compositing Modes Relevant to Drawing

| Mode | Use Case |
|------|----------|
| `source-over` | Normal drawing (default) |
| `destination-out` | Pixel eraser (removes pixels where you draw) |
| `multiply` | Marker/felt-tip overlap darkening |
| `destination-in` | Texture masking (pencil grain) |
