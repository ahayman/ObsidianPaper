# Pressure-Sensitive, Tilt-Aware Handwriting Stroke Rendering in Web Canvas

**Date:** 2026-02-18
**Purpose:** Comprehensive technical research on libraries, algorithms, and techniques for rendering pressure-sensitive, tilt-aware handwriting strokes in a web canvas for the ObsidianPaper plugin.

> **Note:** Web search and web fetch were unavailable during this research. All information is drawn from established algorithms, published research, and well-known open-source implementations (knowledge through May 2025). When implementing, verify specific library versions and API details against current documentation.

---

## Table of Contents

1. [perfect-freehand Library](#1-perfect-freehand-library)
2. [Alternative Libraries](#2-alternative-libraries)
3. [Stroke Smoothing Algorithms](#3-stroke-smoothing-algorithms)
4. [Pen Simulation Techniques](#4-pen-simulation-techniques)
5. [Real-Time Rendering Performance](#5-real-time-rendering-performance)
6. [Vector-Based Stroke Representation](#6-vector-based-stroke-representation)
7. [Recommendations for ObsidianPaper](#7-recommendations-for-obsidianpaper)

---

## 1. perfect-freehand Library

### 1.1 Overview

`perfect-freehand` is an open-source library by Steve Ruiz (creator of tldraw). It is purpose-built for converting arrays of input points (with optional pressure) into the outline polygon of a variable-width stroke. It is the most widely-used library in the web ecosystem for this specific problem.

- **Repository:** `github.com/steveruizok/perfect-freehand`
- **Package:** `perfect-freehand` on npm
- **Size:** ~3KB gzipped, zero dependencies
- **License:** MIT
- **Version:** 1.x line is stable (as of early 2025)
- **Used by:** tldraw, Excalidraw, Logseq, and many other web drawing apps

### 1.2 Core API

The library exports two primary functions:

```typescript
import { getStroke, getStrokePoints } from 'perfect-freehand'
```

**`getStroke(points, options)`** -- The main function. Takes input points and returns an outline polygon.

- **Input:** `T[]` where T is `[x, y, pressure?]` or `{ x: number, y: number, pressure?: number }`
- **Output:** `number[][]` -- An array of `[x, y]` points forming a closed polygon outline
- **Usage:** Fill the returned polygon to render the stroke

```typescript
const inputPoints = [
  [0, 0, 0.5],
  [10, 5, 0.6],
  [20, 8, 0.7],
  [30, 10, 0.65],
]

const outlinePoints = getStroke(inputPoints, {
  size: 16,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
})

// Render as filled polygon
const path = new Path2D()
path.moveTo(outlinePoints[0][0], outlinePoints[0][1])
for (let i = 1; i < outlinePoints.length; i++) {
  path.lineTo(outlinePoints[i][0], outlinePoints[i][1])
}
path.closePath()
ctx.fill(path)
```

**`getStrokePoints(points, options)`** -- Lower-level function. Returns the processed stroke skeleton (centerline points with computed radius at each point) before outline generation. Useful for custom rendering or for extending the algorithm.

```typescript
const strokePoints = getStrokePoints(inputPoints, options)
// Each point: { point: [x, y], pressure: number, distance: number, runningLength: number, vector: [x, y] }
```

### 1.3 Complete Options Reference

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `size` | `number` | 16 | > 0 | Base diameter of the stroke in pixels |
| `thinning` | `number` | 0.5 | -1 to 1 | How much pressure affects width. Positive: more pressure = thicker. Negative: inverted. 0: no pressure effect. |
| `smoothing` | `number` | 0.5 | 0 to 1 | Smoothing applied to the computed radius values (exponential moving average). Higher = smoother width transitions. |
| `streamline` | `number` | 0.5 | 0 to 1 | Input point smoothing. Higher = smoother path (but more lag). Uses spring-like following behavior. |
| `easing` | `(t: number) => number` | `t => t` | N/A | Easing function applied to pressure values before width calculation. |
| `start.taper` | `number \| boolean` | 0 | >= 0 | Length (in px) of taper at stroke start. `true` = taper the entire stroke start. |
| `start.cap` | `boolean` | true | N/A | Whether to add a rounded cap at the start. Only applies when `start.taper` is 0 or false. |
| `start.easing` | `(t: number) => number` | `t => t * (2 - t)` | N/A | Easing function for the start taper (controls taper shape). |
| `end.taper` | `number \| boolean` | 0 | >= 0 | Length of taper at stroke end. |
| `end.cap` | `boolean` | true | N/A | Whether to add a rounded cap at the end. |
| `end.easing` | `(t: number) => number` | `t => t * (2 - t)` | N/A | Easing function for the end taper. |
| `simulatePressure` | `boolean` | true | N/A | When true and no pressure data provided, simulate pressure from velocity (fast = thin, slow = thick). |
| `last` | `boolean` | false | N/A | Whether this is the final version of the stroke (pen lifted). Affects end cap/taper rendering. |

### 1.4 How It Handles Pressure

The width at each point is computed as:

```
radius = size / 2 * (1 - thinning + thinning * easing(pressure))
```

Breakdown:
- When `thinning = 0`: radius is always `size / 2` regardless of pressure.
- When `thinning = 0.5` and `pressure = 1.0`: radius = `size / 2 * (1 - 0.5 + 0.5 * 1.0)` = `size / 2`.
- When `thinning = 0.5` and `pressure = 0.0`: radius = `size / 2 * (1 - 0.5 + 0.5 * 0.0)` = `size / 4`.
- The `easing` function allows remapping the pressure curve (e.g., `t => Math.pow(t, 0.5)` for a softer response).

**Velocity-based simulation:** When `simulatePressure` is true and no pressure data is provided, the library computes pressure from the inverse of velocity:

```
simulated_pressure = clamp(1 - min(1, distance / size), 0, 1)
```

Faster movement = lower pressure = thinner stroke. This provides a natural-feeling stroke for mouse/trackpad input. It should be disabled when real Apple Pencil pressure data is available (set `simulatePressure: false` when `event.pointerType === 'pen'`).

### 1.5 Tilt Support

**perfect-freehand does NOT support tilt.** The library's input format only accepts `[x, y, pressure?]` -- there is no tilt parameter. Its width model is purely circular (isotropic): the offset from the centerline is the same in all perpendicular directions, producing round cross-sections.

**Integrating tilt requires one of these approaches:**

**Approach A: Pre-process tilt into pressure (simple)**

Map the Apple Pencil tilt data into a modified pressure value before passing to perfect-freehand:

```typescript
function tiltAdjustedPressure(
  pressure: number,
  altitudeAngle: number,
  penType: string
): number {
  if (penType === 'pencil') {
    // Pencil: tilted = wider and lighter (simulate by increasing "pressure" for width)
    const tiltFactor = 1.0 - (altitudeAngle / (Math.PI / 2)) // 0=vertical, 1=flat
    return Math.min(1, pressure + tiltFactor * 0.3)
  }
  return pressure // Most pens ignore tilt for width
}
```

This is a quick hack: it uses tilt to widen the stroke but cannot produce anisotropic (directional) width variation. It works for pencil/brush-like effects where tilt just makes things wider.

**Approach B: Fork/extend perfect-freehand for nib models (comprehensive)**

Modify the outline generation step to accept a nib shape model instead of a scalar radius:

```typescript
// Instead of:
// leftOffset = center + normal * radius
// rightOffset = center - normal * radius

// Use:
// leftOffset = center + normal * nibHalfWidth(angle, nibAngle, nibWidth, nibThickness)
// rightOffset = center - normal * nibHalfWidth(angle, nibAngle, nibWidth, nibThickness)

function nibHalfWidth(
  strokeAngle: number,
  nibAngle: number,
  nibWidth: number,
  nibThickness: number
): number {
  const perpAngle = strokeAngle + Math.PI / 2
  return Math.sqrt(
    (nibWidth / 2 * Math.cos(perpAngle - nibAngle)) ** 2 +
    (nibThickness / 2 * Math.sin(perpAngle - nibAngle)) ** 2
  )
}
```

This enables fountain pen italic nibs and directional width variation. The `nibAngle` can come from Apple Pencil's azimuth angle for dynamic nib orientation.

**Approach C: Build a custom stroke engine inspired by perfect-freehand**

Given that fountain pen, pencil shading, and highlighter all need features beyond perfect-freehand's model, the recommended long-term approach is to build a custom engine that:
1. Uses perfect-freehand's algorithm as the foundation.
2. Replaces the isotropic radius with a nib shape model.
3. Adds tilt-to-nib-angle mapping.
4. Adds per-point opacity (for pencil shading).

### 1.6 Output Format

The output is an array of `[x, y]` points forming a **closed polygon**. This polygon represents the outer boundary of the stroke. It is NOT a sequence of draw commands.

**Rendering as Canvas fill:**
```typescript
const outline = getStroke(points, options)
const path = new Path2D()
// Use quadratic curves through midpoints for smooth edges
const [firstX, firstY] = outline[0]
path.moveTo(firstX, firstY)
for (let i = 1; i < outline.length - 1; i++) {
  const [x, y] = outline[i]
  const [nx, ny] = outline[i + 1]
  const midX = (x + nx) / 2
  const midY = (y + ny) / 2
  path.quadraticCurveTo(x, y, midX, midY)
}
path.closePath()
ctx.fill(path)
```

**Rendering as SVG path:**
```typescript
function getSvgPathFromStroke(stroke: number[][]): string {
  if (stroke.length === 0) return ''
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...stroke[0], 'Q']
  )
  d.push('Z')
  return d.join(' ')
}
```

The helper function `getSvgPathFromStroke` is commonly used alongside the library but is NOT included in the library itself -- it is provided in the README as a utility.

### 1.7 Performance Characteristics

- **Computation time:** O(n) where n is the number of input points. The algorithm makes a single pass through the points.
- **Output size:** Approximately 2n points (n left-side + n right-side + cap points). For a stroke of 200 input points, the output polygon has ~400+ points.
- **Incremental computation:** The library does NOT support incremental computation natively. You must pass ALL points on each call. However, since it is O(n) and the constant factor is small, re-computing the entire stroke on each pointer event is feasible for strokes of typical length (< 1000 points).
- **Benchmark estimate:** For a 500-point stroke, `getStroke()` takes approximately 0.1-0.3ms on modern hardware. Well within the 16ms frame budget.
- **Memory:** Allocates arrays during computation. For very high-frequency re-computation, consider object pooling or pre-allocated buffers.

### 1.8 Customization for Different Pen Types

| Pen Type | size | thinning | smoothing | streamline | taper start | taper end | easing |
|----------|------|----------|-----------|------------|-------------|-----------|--------|
| Ballpoint | 2-4 | 0.1-0.2 | 0.3 | 0.3 | 3 | 3 | linear |
| Felt-tip | 6-10 | 0.2-0.4 | 0.5 | 0.5 | 5 | 5 | linear |
| Brush pen | 10-20 | 0.7-0.9 | 0.6 | 0.5 | 15-25 | 20-35 | `t => t^0.5` |
| Pencil | 2-5 | 0.3-0.5 | 0.2 | 0.2 | 3 | 3 | `t => t^0.7` |
| Fountain | 4-8 | 0.2-0.4 | 0.5 | 0.5 | 8 | 12 | linear |
| Highlighter | 20-30 | 0.0 | 0.7 | 0.7 | 0 | 0 | N/A |

### 1.9 Limitations Summary

1. **No tilt support** -- input is `[x, y, pressure?]` only.
2. **Isotropic width only** -- cannot simulate anisotropic nib shapes (italic fountain pen, chisel highlighter).
3. **No per-point opacity** -- output is a polygon outline with no opacity data. Opacity must be handled at the rendering level.
4. **No texture support** -- output is geometry only. Textures (pencil grain, paper interaction) must be applied separately.
5. **No incremental API** -- must recompute full stroke each frame during drawing.
6. **No directional awareness** -- width is a function of pressure only, not of stroke direction.

Despite these limitations, perfect-freehand is an excellent foundation. Its algorithm for streamline, smoothing, tapering, and outline generation is well-engineered and can be adapted or extended.

---

## 2. Alternative Libraries

### 2.1 Paper.js

**Repository:** `github.com/paperjs/paper.js`
**Size:** ~100KB minified
**License:** MIT

Paper.js is a comprehensive 2D vector graphics framework that provides a rich object model for paths, shapes, and groups. It renders to Canvas 2D.

**Stroke-relevant capabilities:**

- **Path smoothing:** `path.smooth({ type: 'catmull-rom', factor: 0.5 })` applies Catmull-Rom smoothing to any path. Also supports `'geometric'` and `'continuous'` smoothing types.
- **Path simplification:** `path.simplify(tolerance)` reduces point count using a curve-fitting algorithm (similar to Schneider's). This is excellent for post-stroke optimization.
- **Path offset:** `path.offset(distance)` computes a parallel curve at a fixed distance. However, this does NOT support variable-width offsets.
- **Boolean operations:** Built-in path union, intersection, subtraction, and exclusion. Useful for eraser implementations.
- **Hit testing:** `path.hitTest(point)` with configurable tolerance.
- **Group/Layer management:** Hierarchical scene graph.

**Variable-width stroke support:**

Paper.js does NOT have built-in variable-width stroke rendering. The `strokeWidth` property is uniform along the entire path. To achieve variable-width strokes, you would need to:

1. Compute the outline polygon yourself (using perfect-freehand or a custom algorithm).
2. Create a `new paper.Path()` from the outline points and fill it.

Paper.js's `path.smooth()` and `path.simplify()` are the most useful features for a handwriting app. They could be used for post-stroke processing independently of the rendering approach.

**Verdict:** Paper.js is too heavyweight for just stroke rendering (100KB for a feature set mostly unused). However, its smoothing and simplification algorithms are worth studying or extracting. Consider using it only if you need its full scene graph capabilities.

### 2.2 Fabric.js

**Repository:** `github.com/fabricjs/fabric.js`
**Size:** ~300KB minified
**License:** MIT

Fabric.js is an interactive Canvas 2D library focused on object manipulation (move, scale, rotate, select). It includes a freehand drawing tool.

**Freehand drawing support:**

- `fabric.PencilBrush` -- Freehand drawing tool that captures mouse/pointer input and produces a `fabric.Path` object.
- `fabric.PencilBrush` supports `width` (constant) and `color` properties.
- Does NOT support pressure-sensitive variable-width strokes natively.
- The resulting path is a standard SVG path string (cubic Beziers) with uniform stroke width.
- `fabric.CircleBrush` and `fabric.SprayBrush` are stamp-based effects, not handwriting tools.

**Pressure support:** Fabric.js has experimental/community pressure support via custom brush classes, but it is not part of the core library. Some community extensions use perfect-freehand within Fabric.js.

**Verdict:** Fabric.js is designed for interactive object manipulation (think Canva), not handwriting. Its freehand tool is rudimentary. Not recommended for this use case. Too large (300KB) for what it provides.

### 2.3 Konva.js

**Repository:** `github.com/konvajs/konva`
**Size:** ~60KB minified
**License:** MIT

Konva.js is a 2D canvas framework for high-performance animations and interactive shapes, with a scene graph and event system.

**Drawing capabilities:**

- `Konva.Line` with `tension` property for smooth curves (uses cardinal spline interpolation).
- `Konva.Line` supports `stroke`, `strokeWidth`, `lineCap`, `lineJoin`.
- `Konva.Line` does NOT support variable width along the path.
- Has a layering system with automatic hit regions.
- Good performance through internal caching and layer-based rendering.

**Handwriting support:** Konva has no built-in handwriting/freehand drawing tool. You would use pointer events to collect points and render them as `Konva.Line` objects with post-processing.

**Verdict:** Konva is useful for interactive canvas applications with complex scene graphs (e.g., diagram editors) but offers little for handwriting beyond what raw Canvas 2D provides. Not recommended as a dependency; its layer management patterns are worth studying.

### 2.4 Other Notable Libraries

#### Rough.js
- Generates hand-drawn/sketch-style renderings of shapes.
- Not for freehand drawing. It takes geometric shapes (rectangles, ellipses, lines) and renders them with a hand-drawn aesthetic.
- Used by Excalidraw for its sketchy style.
- Not applicable to handwriting stroke rendering.

#### Two.js
- 2D drawing API that targets multiple renderers (SVG, Canvas, WebGL).
- Similar concept to Paper.js but smaller.
- No variable-width stroke support.
- Could be useful if multi-renderer support is needed.

#### Pts.js
- Creative coding library focused on points, forms, and space.
- Has interesting curve and geometry utilities.
- Not designed for handwriting apps.

#### Drawio / Mermaid
- Diagram-focused tools, not relevant for handwriting.

#### bezier-js
- **Repository:** `github.com/Pomax/bezierjs`
- **Size:** ~15KB
- Comprehensive Bezier curve library: evaluation, derivatives, normals, arc length, splitting, intersections, bounding boxes.
- Useful utility for implementing Schneider's curve fitting algorithm and for computing stroke outlines along Bezier segments.
- Worth considering as a dependency for curve math.

#### simplex-noise
- **Package:** `simplex-noise` on npm
- **Size:** ~3KB
- Fast simplex noise generation.
- Useful for generating pencil/paper grain textures.
- Would be a runtime dependency for pencil-type pen simulation.

### 2.5 Library Comparison Summary

| Library | Size | Variable Width | Pressure | Tilt | Smoothing | Simplification | Verdict |
|---------|------|---------------|----------|------|-----------|---------------|---------|
| perfect-freehand | 3KB | Yes (isotropic) | Yes | No | Yes (streamline + smoothing) | No | **Best for core stroke outline** |
| Paper.js | 100KB | No (uniform stroke) | No | No | Yes (excellent) | Yes (excellent) | Useful algorithms, too heavy as dependency |
| Fabric.js | 300KB | No | Community only | No | No | No | Not suitable |
| Konva.js | 60KB | No | No | No | Basic (tension) | No | Not suitable |
| bezier-js | 15KB | N/A | N/A | N/A | N/A | N/A | Useful math utility |
| simplex-noise | 3KB | N/A | N/A | N/A | N/A | N/A | Useful for pencil texture |

---

## 3. Stroke Smoothing Algorithms

### 3.1 Why Smoothing Is Essential

Raw stylus input arrives at discrete intervals (60-240Hz depending on hardware and API). The resulting polyline is visibly jagged, especially for slow curves. Smoothing produces natural-looking strokes. There are two contexts:

1. **Real-time smoothing (during drawing):** Must be fast, must work causally (no future points), introduces perceived "lag."
2. **Post-stroke smoothing (after pen lift):** Can use the entire stroke, can look ahead, produces better results.

### 3.2 Exponential Moving Average (EMA)

```
smoothed[i] = alpha * input[i] + (1 - alpha) * smoothed[i-1]
```

Where `alpha` is in (0, 1]. Lower alpha = more smoothing.

**Properties:**
- Strictly causal (only uses past data) -- perfect for real-time.
- O(1) computation per point.
- Introduces lag proportional to smoothing amount. At alpha=0.3, the smooth position lags the raw input by approximately `(1-alpha)/alpha * interval` = ~2.3 frames.
- This is what perfect-freehand's `streamline` parameter implements.
- Simple and effective but not adaptive -- same smoothing for slow and fast movements.

**Implementation:**
```typescript
class EMAFilter {
  private x = 0
  private y = 0
  private initialized = false

  constructor(private alpha: number) {}

  filter(rawX: number, rawY: number): { x: number; y: number } {
    if (!this.initialized) {
      this.x = rawX
      this.y = rawY
      this.initialized = true
    } else {
      this.x = this.alpha * rawX + (1 - this.alpha) * this.x
      this.y = this.alpha * rawY + (1 - this.alpha) * this.y
    }
    return { x: this.x, y: this.y }
  }

  reset(): void {
    this.initialized = false
  }
}
```

### 3.3 1-Euro Filter

The 1-Euro filter (Casiez et al., CHI 2012) is specifically designed for real-time input smoothing with adaptive latency. It is widely used in VR/AR, drawing applications, and pen input processing.

**Key insight:** Use high smoothing when the signal is slow-moving (hand is nearly still -- jitter is the dominant noise) and low smoothing when the signal is fast-moving (hand is actively drawing -- lag is the dominant problem). This dynamically minimizes jitter without adding lag.

**Parameters:**
- `minCutoff` (default ~1.0): Minimum cutoff frequency in Hz. Lower = more smoothing at low speeds. Controls jitter reduction.
- `beta` (default ~0.0): Speed coefficient. Higher = less smoothing at high speeds. Controls lag reduction.
- `dCutoff` (default ~1.0): Cutoff frequency for the derivative (speed) estimation filter.

**How it works:**
1. Estimate the speed of the input signal using a low-pass filter on the derivative.
2. Compute an adaptive cutoff frequency: `cutoff = minCutoff + beta * |speed|`
3. Apply a low-pass filter with the adaptive cutoff.

When the pen moves slowly, `|speed|` is low, cutoff is low, and heavy smoothing is applied (eliminates jitter). When the pen moves fast, `|speed|` is high, cutoff is high, and minimal smoothing is applied (reduces lag).

**Full implementation:**
```typescript
class LowPassFilter {
  private y = 0
  private initialized = false

  filter(value: number, alpha: number): number {
    if (!this.initialized) {
      this.y = value
      this.initialized = true
    } else {
      this.y = alpha * value + (1 - alpha) * this.y
    }
    return this.y
  }

  reset(): void { this.initialized = false }
  lastValue(): number { return this.y }
}

function smoothingFactor(te: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * te
  return r / (r + 1)
}

class OneEuroFilter {
  private xFilter = new LowPassFilter()
  private dxFilter = new LowPassFilter()
  private lastTimestamp = -1

  constructor(
    private minCutoff: number = 1.0,
    private beta: number = 0.0,
    private dCutoff: number = 1.0
  ) {}

  filter(value: number, timestamp: number): number {
    if (this.lastTimestamp < 0) {
      this.lastTimestamp = timestamp
      return this.xFilter.filter(value, 1.0)
    }

    const te = (timestamp - this.lastTimestamp) / 1000 // seconds
    this.lastTimestamp = timestamp

    // Estimate speed
    const dx = te > 0 ? (value - this.xFilter.lastValue()) / te : 0
    const edx = this.dxFilter.filter(dx, smoothingFactor(te, this.dCutoff))

    // Adaptive cutoff
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)

    return this.xFilter.filter(value, smoothingFactor(te, cutoff))
  }

  reset(): void {
    this.xFilter.reset()
    this.dxFilter.reset()
    this.lastTimestamp = -1
  }
}
```

**For 2D pen input, use two independent 1-Euro filters (one for X, one for Y) with the same parameters.**

**Recommended parameter tuning for handwriting:**
- `minCutoff = 1.5`: Moderate jitter reduction at rest.
- `beta = 0.007`: Moderate speed adaptation.
- `dCutoff = 1.0`: Standard derivative estimation.

These can be exposed as a single "smoothing" slider that adjusts `minCutoff` (higher = less smooth) and `beta` proportionally.

### 3.4 Catmull-Rom Splines

A Catmull-Rom spline passes exactly through all control points (interpolating spline). Between each pair of consecutive points P[i] and P[i+1], the curve is defined using four points: P[i-1], P[i], P[i+1], P[i+2].

**Parametric form:**
```
q(t) = 0.5 * (
  (2*P[i]) +
  (-P[i-1] + P[i+1]) * t +
  (2*P[i-1] - 5*P[i] + 4*P[i+1] - P[i+2]) * t^2 +
  (-P[i-1] + 3*P[i] - 3*P[i+1] + P[i+2]) * t^3
)
```

Where t ranges from 0 to 1 for the segment from P[i] to P[i+1].

**Centripetal variant (recommended):**

The standard (uniform) Catmull-Rom can produce cusps and self-intersections. The centripetal variant (alpha=0.5) parameterizes by the square root of chord length, avoiding these artifacts:

```typescript
function centripetal(p0: Point, p1: Point, p2: Point, p3: Point): number[] {
  const d01 = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const d23 = Math.hypot(p3.x - p2.x, p3.y - p2.y)

  const t0 = 0
  const t1 = t0 + Math.sqrt(d01)
  const t2 = t1 + Math.sqrt(d12)
  const t3 = t2 + Math.sqrt(d23)

  return [t0, t1, t2, t3]
}
```

**Properties:**
- C1 continuous (continuous first derivative at join points).
- Passes through all control points (preserves the feel of what the user drew).
- Requires a 1-segment lookahead: when P[i+2] arrives, the segment from P[i] to P[i+1] can be rendered.
- Can interpolate not just (x, y) positions but also pressure and tilt values using the same parameter t.

**Converting Catmull-Rom to cubic Bezier (for Canvas 2D `bezierCurveTo`):**

```typescript
function catmullRomToBezier(
  p0: Point, p1: Point, p2: Point, p3: Point,
  tension: number = 1.0
): [Point, Point, Point, Point] {
  const t = 1 / (6 * tension)
  return [
    p1,
    { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t },
    { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t },
    p2,
  ]
}
```

**Use for variable-width strokes:** The Catmull-Rom spline naturally interpolates pressure/tilt between sample points. Evaluate the spline at sub-sample intervals (e.g., every 2 pixels) to get smooth position+pressure, then compute the variable-width outline from these interpolated values.

### 3.5 Bezier Curve Fitting (Schneider's Algorithm)

Philip Schneider's algorithm (Graphics Gems, 1990) fits a sequence of cubic Bezier curves to a set of input points, minimizing the maximum geometric error. It is the gold standard for post-stroke curve fitting.

**Algorithm outline:**
1. Parameterize input points by cumulative chord length (0 to 1 for the full stroke).
2. Estimate tangent directions at the first and last points (from neighboring points).
3. Use least-squares to fit a single cubic Bezier to all points.
4. Compute the maximum error (distance from any input point to the fitted curve).
5. If max error > threshold, split the point set at the point of maximum error.
6. Recursively fit each half.
7. Ensure C1 continuity at split points by constraining tangent directions.
8. Return the sequence of Bezier curves.

**Pros:**
- Produces the most natural-looking curves.
- Output is very compact: 4 control points per Bezier segment (typically 5-20 segments per stroke vs. 100-500 raw points).
- The error threshold is a tunable quality/compactness tradeoff.
- Output is directly storable as SVG path data or Canvas 2D `bezierCurveTo` calls.

**Cons:**
- Not real-time: needs the complete stroke (or a large buffer of points).
- More complex to implement correctly (tangent estimation, reparameterization, split logic).
- Split-and-refit is O(n log n) in the worst case.

**Implementation complexity:** Medium-high. A full, correct implementation is ~200-300 lines of TypeScript. Reference implementations are available in many languages. The bezier-js library can help with curve evaluation but does not implement Schneider's algorithm itself.

### 3.6 Ramer-Douglas-Peucker (RDP) Simplification

RDP is a point-reduction algorithm that preserves shape within a tolerance:

```
Given a polyline from start to end:
1. Find the point farthest from the line segment (start -> end).
2. If distance > epsilon: recursively simplify (start -> farthest) and (farthest -> end).
3. If distance <= epsilon: discard all intermediate points.
```

**Use case:** Post-stroke simplification to reduce storage and rendering cost. Applied to raw point data before Bezier fitting or as a standalone simplification step.

**Typical epsilon for handwriting:** 0.5-2.0 world pixels. A value of 1.0 reduces point count by approximately 50-70% for typical handwriting strokes with minimal visual change.

**Preserving per-point data:** When simplifying, keep the pressure, tilt, and timestamp values for retained points. Lost points' attributes are implicitly interpolated by the rendering pipeline.

### 3.7 Which Approaches for Real-Time vs. Post-Processing

| Algorithm | Real-time | Post-processing | Latency | Quality | Use In ObsidianPaper |
|-----------|-----------|-----------------|---------|---------|---------------------|
| EMA | Yes | No | Medium | Low-Medium | Fallback/simple prototype |
| 1-Euro Filter | Yes | No | Very Low | High | **Primary real-time input smoother** |
| Catmull-Rom | Yes (1 segment delay) | Yes | 1 segment | High | **Primary curve rendering during drawing** |
| Schneider Bezier | No | Yes | N/A | Highest | **Post-stroke for storage/export** |
| RDP | No | Yes | N/A | Medium | **Pre-processing before Bezier fitting** |

**Recommended pipeline for ObsidianPaper:**

```
Raw PointerEvent -> 1-Euro Filter (jitter removal)
  -> Accumulate smoothed points
  -> Catmull-Rom interpolation (rendering)
  -> [pen-up]
  -> RDP simplification (reduce points)
  -> Schneider Bezier fitting (compact storage)
  -> Store as fitted Bezier curves + raw pressure/tilt data
```

### 3.8 Making Smoothing Configurable

Expose a single "Smoothing" slider (0-100) that maps to algorithm parameters:

```typescript
function mapSmoothingLevel(level: number): SmoothingConfig {
  const t = level / 100 // 0 = raw, 1 = maximum smoothing

  return {
    oneEuro: {
      minCutoff: lerp(5.0, 0.3, t),   // Higher cutoff = less smoothing
      beta: lerp(0.001, 0.015, t),     // Higher beta = more speed adaptation
    },
    catmullRomAlpha: lerp(0.0, 0.5, t), // 0 = uniform, 0.5 = centripetal
    bezierTolerance: lerp(0.5, 4.0, t), // Higher = more smoothing, fewer curves
    rdpEpsilon: lerp(0.3, 2.0, t),      // Higher = more point reduction
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
```

For advanced users, expose individual parameters in a settings panel.

---

## 4. Pen Simulation Techniques

### 4.1 Fountain Pen (Italic Nib)

**Physical model:** An italic fountain pen nib has a flat, chisel-like edge. The width of the mark depends on the angle between the nib's flat edge and the stroke direction.

**Width formula:**
```
effective_width = sqrt(
  (nib_width * sin(theta_stroke - theta_nib))^2 +
  (nib_thickness * cos(theta_stroke - theta_nib))^2
)
```

Where:
- `nib_width` = the broad edge width (e.g., 6px)
- `nib_thickness` = the thin edge width (e.g., 1.5px)
- `theta_nib` = the nib angle (typically 30-45 degrees for calligraphy)
- `theta_stroke` = the angle of the stroke direction at the current point

**Tilt integration:**
- **Fixed nib angle mode (calligraphy):** `theta_nib` is a constant (e.g., 30 degrees). Apple Pencil azimuth is ignored.
- **Dynamic nib angle mode:** `theta_nib = azimuthAngle` from the Apple Pencil, making the nib rotate as the user rotates their hand.
- **Altitude affects contact area:** `effective_nib_width = base_nib_width * (minFrac + (1 - minFrac) * cos(altitudeAngle))`. More tilted = wider contact.

**Flex nib simulation:**

A flex nib spreads its tines apart under pressure:
```typescript
function flexNibWidth(baseWidth: number, pressure: number, flexAmount: number): number {
  const flexCurve = Math.pow(pressure, 0.5 + (1 - flexAmount) * 1.5)
  const minWidth = baseWidth * 0.8
  const maxWidth = baseWidth * (1 + flexAmount * 4)
  return minWidth + flexCurve * (maxWidth - minWidth)
}
```

Key physical behaviors to simulate:
- Width changes lag slightly behind pressure changes (nib has inertia).
- Width increases faster than it decreases (tines spread easier than they close).
- At very high pressure, width plateaus (tines fully spread).

**Outline generation:** The outline approach (Section 1.6) works, but instead of computing left/right offsets with a scalar radius, use the nib shape model to compute directionally-dependent offsets at each point.

### 4.2 Brush Pen

**Physical model:** Flexible tip (nylon or natural hair) that varies dramatically with pressure. Extremely pressure-sensitive.

**Key parameters:**
```typescript
{
  baseWidth: 12,
  pressureWidthRange: [0.05, 1.0],   // Hairline to full width
  pressureOpacityRange: [0.7, 1.0],
  taper: { start: 20, end: 30 },     // Long, elegant tapers
  smoothing: 0.6,                     // Moderate smoothing
  pressureCurve: (t) => Math.pow(t, 0.5),  // Square root for natural feel
}
```

**Tilt behavior:** Moderate tilt sensitivity. Tilting widens the stroke slightly (tip flattens against the surface) but less dramatically than a pencil.

**Rendering approach:** The polygon/outline method works well for brush pens. The key is smooth width transitions and long, elegant tapers at stroke start/end. perfect-freehand with high `thinning` (0.7-0.9) and long `start.taper` / `end.taper` produces good brush pen results.

### 4.3 Ballpoint Pen

**Physical model:** A rotating ball in a socket. Very consistent line width. Minimal pressure sensitivity.

**Key parameters:**
```typescript
{
  baseWidth: 2,
  pressureWidthRange: [0.85, 1.15],  // Very narrow range
  pressureOpacityRange: [0.8, 1.0],  // Slight opacity variation
  taper: { start: 3, end: 3 },       // Very short tapers
  smoothing: 0.3,                     // Low smoothing
  tiltSensitivity: 0,                 // No tilt response
}
```

**Special detail:** Ballpoints can have a slight "blob" at stroke start where the ball begins rotating. Simulate with a small width increase for the first 3-5 points.

**Rendering approach:** The polygon outline method works well. perfect-freehand with low `thinning` (0.1-0.2) and small `size` (2-4) produces good results. Alternatively, since width variation is minimal, a constant-width Canvas 2D `stroke()` with `lineCap: 'round'` may be sufficient, with pressure controlling only opacity.

### 4.4 Felt-Tip / Marker

**Physical model:** Porous tip that compresses slightly under pressure. Wider, more uniform strokes.

**Key parameters:**
```typescript
{
  baseWidth: 8,
  pressureWidthRange: [0.7, 1.3],    // Moderate compression
  pressureOpacityRange: [0.85, 1.0],  // Fairly consistent
  taper: { start: 5, end: 5 },
  smoothing: 0.5,
  edgeSoftness: 0.3,                  // Slightly soft edges
}
```

### 4.5 Pencil (Graphite)

**Physical model:** Graphite core deposits material based on pressure AND angle. Texture is essential.

**Key parameters:**
```typescript
{
  baseWidth: 3,
  pressureWidthRange: [0.5, 1.5],
  pressureOpacityRange: [0.15, 0.85],  // Wide opacity range is key
  taper: { start: 3, end: 3 },
  smoothing: 0.2,                      // Low smoothing (pencils feel gritty)
  tiltSensitivity: 0.8,               // High: tilt dramatically affects width
  texture: 'grain',                    // Paper grain texture is essential
}
```

**Tilt behavior (most critical for pencil):**
- Vertical (high altitude): narrow, dark line (writing with the point).
- Tilted (low altitude): wide, light line (shading with the side).

```typescript
function pencilFromTilt(altitudeAngle: number, pressure: number) {
  const tiltFactor = 1.0 - (altitudeAngle / (Math.PI / 2)) // 0=vertical, 1=flat
  return {
    width: baseWidth * (1 + tiltFactor * 3),      // Up to 4x wider when tilted
    opacity: baseOpacity * (1 - tiltFactor * 0.6), // Lighter when tilted
  }
}
```

**Texture rendering approach:**
1. Generate a tileable paper grain noise texture (256x256 or 512x512) using simplex noise.
2. Render the stroke shape to an offscreen canvas at full opacity.
3. Apply the grain texture using `globalCompositeOperation = 'destination-in'` or `'multiply'`.
4. Composite the result onto the main canvas at the computed opacity.
5. **Critical:** The grain texture must be sampled in world coordinates (not stroke-local coordinates) so the "paper grain" is consistent regardless of where on the canvas the stroke appears.

### 4.6 Highlighter

**Physical model:** Wide, flat chisel tip. Semi-transparent. Nearly zero pressure sensitivity.

**Key parameters:**
```typescript
{
  baseWidth: 24,
  pressureWidthRange: [0.95, 1.05],  // Almost no variation
  opacity: 0.3,                      // Semi-transparent
  taper: { start: 0, end: 0 },      // No taper: blunt ends
  smoothing: 0.7,                    // High smoothing: straight lines
  blendMode: 'multiply',            // Overlapping areas darken
  flatCap: true,                    // Square end caps
}
```

**Rendering challenge:** Highlighters must avoid the "intra-stroke overlap" problem where semi-transparent segments overlap within a single stroke, creating darker bands at overlap points.

**Solution:** Render each stroke to a separate offscreen canvas at full opacity, then composite the entire stroke at reduced opacity:

```typescript
// Offscreen canvas for the current stroke
offCtx.globalAlpha = 1.0
offCtx.fillStyle = highlighterColor
offCtx.fill(strokeOutlinePath) // Full opacity

// Composite onto main canvas at reduced opacity
mainCtx.globalAlpha = 0.3
mainCtx.drawImage(offscreenCanvas, 0, 0)
mainCtx.globalAlpha = 1.0
```

For overlapping strokes (multiple highlighter passes), use `globalCompositeOperation = 'multiply'` on the main canvas so overlapping areas naturally darken.

### 4.7 Generating the Stroke Outline for Various Pen Types

**Unified outline generation approach:**

All pen types (except pencil with texture) use the same fundamental algorithm with different parameters:

```typescript
interface NibModel {
  // Given a stroke direction angle and per-point data,
  // return the left and right offsets from the centerline
  getOffsets(
    strokeAngle: number,
    pressure: number,
    altitude: number,
    azimuth: number,
    velocity: number
  ): { left: number; right: number; opacity: number }
}

class CircularNib implements NibModel {
  // Ballpoint, felt-tip, brush pen: symmetric circular cross-section
  getOffsets(strokeAngle, pressure, altitude, azimuth, velocity) {
    const radius = this.computeRadius(pressure, velocity)
    return { left: radius, right: radius, opacity: this.computeOpacity(pressure) }
  }
}

class EllipticalNib implements NibModel {
  // Fountain pen, highlighter: anisotropic cross-section
  getOffsets(strokeAngle, pressure, altitude, azimuth, velocity) {
    const nibAngle = this.useAzimuth ? azimuth : this.fixedAngle
    const halfWidth = Math.sqrt(
      (this.a * Math.cos(strokeAngle + Math.PI/2 - nibAngle)) ** 2 +
      (this.b * Math.sin(strokeAngle + Math.PI/2 - nibAngle)) ** 2
    )
    return { left: halfWidth, right: halfWidth, opacity: 1.0 }
  }
}
```

**The outline algorithm (adapted from perfect-freehand):**

```typescript
function computeOutline(
  points: ProcessedPoint[],
  nib: NibModel,
  taperStart: number,
  taperEnd: number
): [number, number][] {
  const leftEdge: [number, number][] = []
  const rightEdge: [number, number][] = []

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    const angle = computeStrokeAngle(points, i)
    const perpAngle = angle + Math.PI / 2

    let { left, right } = nib.getOffsets(
      angle, pt.pressure, pt.altitude, pt.azimuth, pt.velocity
    )

    // Apply taper
    if (pt.runningLength < taperStart) {
      const t = pt.runningLength / taperStart
      left *= t
      right *= t
    }
    if (pt.distanceFromEnd < taperEnd) {
      const t = pt.distanceFromEnd / taperEnd
      left *= t
      right *= t
    }

    leftEdge.push([
      pt.x + Math.cos(perpAngle) * left,
      pt.y + Math.sin(perpAngle) * left,
    ])
    rightEdge.push([
      pt.x - Math.cos(perpAngle) * right,
      pt.y - Math.sin(perpAngle) * right,
    ])
  }

  // Combine: left forward + end cap + right backward + start cap
  return [
    ...leftEdge,
    ...computeEndCap(points[points.length - 1], nib),
    ...rightEdge.reverse(),
    ...computeStartCap(points[0], nib),
  ]
}
```

---

## 5. Real-Time Rendering Performance

### 5.1 Canvas 2D vs WebGL

| Aspect | Canvas 2D | WebGL |
|--------|-----------|-------|
| **Setup complexity** | Very low | High (shaders, buffers, state management) |
| **Stroke rendering** | Fill Path2D polygons | Triangle strip meshes |
| **Performance (< 1000 strokes)** | Excellent | Excellent |
| **Performance (1000-10000 strokes)** | Good with optimization | Excellent |
| **Performance (10000+ strokes)** | Degrades | Excellent |
| **Texture effects** | Offscreen canvas compositing | Fragment shaders (trivial) |
| **Anti-aliasing** | Built-in (good) | Must implement (MSAA or shader-based) |
| **Zoom/pan cost** | Full re-render of visible strokes | Update uniform matrix (near-zero cost) |
| **WebKit compatibility** | Full | Full (but context loss on iPad) |
| **SVG export** | Easy (Path2D to SVG path) | Must convert from mesh data |

**Recommendation:** Canvas 2D is the right choice for ObsidianPaper. It handles 1000-2000 visible strokes comfortably, which covers typical handwriting documents. WebGL should only be considered if performance profiling reveals Canvas 2D is the bottleneck.

### 5.2 Offscreen Canvas for Background Rendering

**OffscreenCanvas** moves rendering to a Web Worker, keeping the main thread responsive.

**Critical limitation:** OffscreenCanvas is NOT supported in Safari/WebKit on iPad as of early 2025. Since ObsidianPaper targets iPad as a primary platform (Apple Pencil), OffscreenCanvas cannot be a core dependency.

**Alternative:** Use a regular off-screen canvas (`document.createElement('canvas')`) on the main thread for compositing. This does not move work off the main thread but avoids DOM rendering overhead.

### 5.3 Incremental Rendering Strategy (Double-Buffer)

The standard approach for real-time drawing apps:

```
Visual stack (bottom to top):
  [Background canvas: paper/grid lines]
  [Static canvas: all completed strokes (cached bitmap)]
  [Active canvas: stroke currently being drawn]
  [UI overlay: selection handles, cursor, toolbar]
```

**Lifecycle:**

1. **Pen down:** Begin accumulating points on the active canvas.
2. **Pen move:** Clear and re-render only the active canvas (just one stroke -- cheap).
3. **Pen up:** Render the completed stroke onto the static canvas bitmap. Clear the active canvas. Add stroke to the data model and spatial index.
4. **Zoom/pan:** Re-render the static canvas from the stroke data at the new viewport. Cache the result for subsequent frames.
5. **Edit (undo, delete, style change):** Invalidate the static canvas cache. Re-render from stroke data.

**Implementation:**

```typescript
class DrawingRenderer {
  private staticCanvas: HTMLCanvasElement  // Off-screen, holds completed strokes
  private activeCanvas: HTMLCanvasElement  // Visible, holds in-progress stroke

  renderActiveStroke(stroke: StrokeInProgress): void {
    const ctx = this.activeCanvas.getContext('2d')!
    ctx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height)
    this.applyCamera(ctx)
    this.drawStroke(ctx, stroke)
  }

  finalizeStroke(stroke: CompletedStroke): void {
    const ctx = this.staticCanvas.getContext('2d')!
    this.drawStroke(ctx, stroke)
    // Clear active canvas
    this.activeCanvas.getContext('2d')!.clearRect(0, 0, ...)
  }

  renderStaticLayer(): void {
    const ctx = this.staticCanvas.getContext('2d')!
    ctx.clearRect(0, 0, this.staticCanvas.width, this.staticCanvas.height)
    this.applyCamera(ctx)
    for (const stroke of this.getVisibleStrokes()) {
      this.drawStroke(ctx, stroke)
    }
  }
}
```

### 5.4 Handling Thousands of Strokes

**Viewport culling:** Only render strokes whose bounding boxes overlap the current viewport. Simple AABB intersection test (4 comparisons per stroke). Sufficient for up to ~10,000 strokes.

**Spatial indexing (R-tree):** For 10,000+ strokes, use an R-tree (e.g., `rbush` library) to quickly query which strokes are visible. Reduces viewport query from O(n) to O(log n + k).

**Level-of-detail (LOD):**
- At zoom > 0.5x: render full stroke detail.
- At zoom 0.25-0.5x: use pre-simplified strokes (RDP with epsilon=2).
- At zoom 0.1-0.25x: use heavily simplified strokes (RDP with epsilon=5).
- At zoom < 0.1x: render as simple lines (start to end point).

**Path2D caching:** Pre-compute `Path2D` objects for completed strokes. A `Path2D` stores the path geometry in native memory and can be re-rendered efficiently without re-issuing path commands:

```typescript
// Compute once when stroke is finalized
stroke.cachedPath = new Path2D()
// Build outline and add to Path2D
const outline = computeStrokeOutline(stroke)
stroke.cachedPath.moveTo(outline[0][0], outline[0][1])
for (let i = 1; i < outline.length; i++) {
  stroke.cachedPath.quadraticCurveTo(...)
}
stroke.cachedPath.closePath()

// Render (cheap: no path re-computation)
ctx.fill(stroke.cachedPath)
```

**Bitmap tiling for zoomed-out views:** At very low zoom levels, pre-render regions into bitmap tiles. Only regenerate tiles when strokes within that region change. This is the approach used by map renderers and can handle effectively unlimited stroke counts.

### 5.5 Frame Budget Analysis

**Target:** 60fps = 16.67ms per frame.

**Breakdown for a frame during active drawing:**

| Operation | Estimated Time | Notes |
|-----------|---------------|-------|
| Process pointer events (coalesced) | < 0.1ms | Simple data extraction |
| 1-Euro filter (X and Y) | < 0.01ms | Two multiplications |
| Compute stroke outline (perfect-freehand) | 0.1-0.3ms | For 200-500 point stroke |
| Clear active canvas | 0.1ms | Fast hardware clear |
| Apply camera transform | < 0.01ms | Two matrix operations |
| Fill stroke polygon | 0.2-0.5ms | Depends on polygon complexity |
| **Total** | **~0.5-1.0ms** | Well within 16ms budget |

**Breakdown for a static layer re-render (zoom/pan):**

| Operation | Estimated Time | Notes |
|-----------|---------------|-------|
| Viewport culling (1000 strokes) | 0.05ms | AABB checks |
| Fill 200 visible strokes (cached Path2D) | 2-4ms | Depends on complexity |
| Composite static layer | 0.1ms | drawImage |
| **Total** | **~2-5ms** | Within budget at 60fps |

These estimates suggest Canvas 2D performance is adequate for typical handwriting documents. The bottleneck would only appear with 1000+ visible strokes on screen simultaneously, which is unusual for handwriting (most of the time the viewport shows a manageable subset).

### 5.6 requestAnimationFrame Batching

Avoid rendering on every pointer event (which can fire at 240Hz on iPad). Instead, batch:

```typescript
let renderPending = false

function onPointerMove(event: PointerEvent): void {
  // Process all coalesced events immediately (capture the data)
  for (const e of event.getCoalescedEvents()) {
    currentStroke.addPoint(e)
  }

  // Schedule render for next frame (if not already scheduled)
  if (!renderPending) {
    renderPending = true
    requestAnimationFrame(() => {
      renderActiveStroke()
      renderPending = false
    })
  }
}
```

### 5.7 Predicted Events for Latency Reduction

Use `getPredictedEvents()` (Safari 18.0+) to draw predicted stroke segments:

```typescript
function onPointerMove(event: PointerEvent): void {
  // Commit coalesced events to stroke data
  for (const e of event.getCoalescedEvents()) {
    currentStroke.commitPoint(e)
  }

  // Store predicted points (temporary -- will be replaced next frame)
  currentStroke.clearPredictions()
  if (event.getPredictedEvents) {
    for (const e of event.getPredictedEvents()) {
      currentStroke.addPrediction(e)
    }
  }

  scheduleRender()
}

function renderActiveStroke(): void {
  // Render committed points (solid)
  drawCommittedSegments(currentStroke.committedPoints)

  // Render predicted points (could use slightly different style, e.g., slightly lighter)
  drawPredictedSegments(currentStroke.predictedPoints)
}
```

---

## 6. Vector-Based Stroke Representation

### 6.1 Raw Points vs. Fitted Curves

**Option A: Store raw input points**

```typescript
interface RawStroke {
  id: string
  penType: string
  color: string
  points: {
    x: number[]     // World coordinates
    y: number[]
    p: number[]     // Pressure (0-1)
    tx?: number[]   // tiltX (degrees)
    ty?: number[]   // tiltY (degrees)
    t: number[]     // Timestamps (ms, relative to stroke start)
  }
}
```

**Pros:**
- Lossless: all input data preserved.
- Can re-render with any pen type, smoothing level, or rendering algorithm.
- Simple to implement.
- Supports future enhancements (e.g., handwriting recognition from raw data).

**Cons:**
- Larger storage: 200-500 points per stroke, each with 5-6 values.
- Must re-compute stroke outline on every re-render (but this is fast, ~0.2ms per stroke).

**Option B: Store fitted Bezier curves + metadata**

```typescript
interface FittedStroke {
  id: string
  penType: string
  color: string
  curves: {
    // Each curve is a cubic Bezier with width/opacity at endpoints
    cx1: number; cy1: number  // Control point 1
    cx2: number; cy2: number  // Control point 2
    x: number; y: number      // End point (start = previous end)
    wStart: number             // Width at segment start
    wEnd: number               // Width at segment end
    oStart: number             // Opacity at segment start
    oEnd: number               // Opacity at segment end
  }[]
  startX: number; startY: number  // First point
}
```

**Pros:**
- Very compact: 5-20 curve segments per stroke vs. 200-500 raw points.
- Smooth rendering without additional processing.
- Resolution-independent (vector curves scale perfectly).

**Cons:**
- Lossy: raw pressure/tilt data is baked into width/opacity.
- Cannot change pen type after the fact (would need to re-fit from raw data).
- More complex to compute (Schneider's algorithm).
- Harder to edit (splitting a Bezier curve for eraser requires curve math).

**Option C: Store both (recommended)**

```typescript
interface StoredStroke {
  id: string
  penType: string
  color: string
  width: number           // Base width
  smoothing: number       // Smoothing level used

  // Raw data (for re-rendering, editing, recognition)
  raw: {
    x: number[]
    y: number[]
    p: number[]
    tx?: number[]
    ty?: number[]
    t: number[]
  }

  // Fitted curves (for efficient rendering, optional/cached)
  fitted?: {
    svg: string           // SVG path data for the outline
    // Or: Bezier control points
  }

  // Bounding box (computed, for spatial indexing)
  bbox: [number, number, number, number] // [minX, minY, maxX, maxY]
}
```

Store raw data for editability and future flexibility. Optionally compute and cache fitted curves for rendering performance. The fitted data can be regenerated from raw data at any time.

### 6.2 Compression for Raw Point Data

For a typical handwriting document (1000 strokes, 200 points each):

**Naive JSON (row-oriented):** `[[x,y,p,tx,ty,t], ...]` = ~12MB
**Column JSON:** `{x:[...], y:[...], p:[...]}` = ~8MB
**Column + quantized:** Reduce decimal places = ~4MB
**Column + delta + quantized:** Delta-encode coordinates = ~2.5MB
**Binary + deflate + Base64:** Compressed binary = ~0.8MB

**Recommended format:** Column-oriented, delta-encoded, quantized JSON for readability and reasonable size. See the stroke data storage research document for full details.

### 6.3 Re-Rendering from Stored Data

When re-rendering a stroke (e.g., on zoom, viewport change, or style change):

```typescript
function renderStroke(ctx: CanvasRenderingContext2D, stroke: StoredStroke): void {
  // 1. Decode/decompress raw points if needed
  const points = decodePoints(stroke.raw)

  // 2. Get pen model
  const penModel = getPenModel(stroke.penType)

  // 3. Apply smoothing to get display points
  const smoothed = applySmoothingPipeline(points, stroke.smoothing)

  // 4. Compute width/opacity at each point using pen model
  const processed = penModel.process(smoothed)

  // 5. Compute outline polygon
  const outline = computeOutline(processed, penModel.nib, penModel.taper)

  // 6. Render
  ctx.fillStyle = stroke.color
  const path = outlineToPath2D(outline)
  ctx.fill(path)

  // 7. Apply texture if needed (pencil)
  if (penModel.texture) {
    applyTexture(ctx, path, penModel.texture)
  }
}
```

### 6.4 Trade-offs Summary

| Storage Approach | Size | Re-renderable | Editable | Complexity | Recommended For |
|-----------------|------|---------------|----------|------------|-----------------|
| Raw points only | Large | Yes (any style) | Yes | Low | Primary storage |
| Fitted Bezier only | Small | Partially (fixed style) | Difficult | Medium | Export/SVG |
| Raw + cached fitted | Medium | Yes | Yes | Medium | **Best balance** |
| Pre-rendered bitmap | Varies | No | No | Low | Thumbnail/preview only |

---

## 7. Recommendations for ObsidianPaper

### 7.1 Overall Architecture

```
Input Layer
  -> PointerEvent handler (captures coalesced events)
  -> 1-Euro filter (per-axis jitter removal)
  -> Pressure/tilt EMA filter
  -> tiltX/tiltY to altitude/azimuth conversion

Pen Model Layer
  -> PenConfig object per pen type (not separate classes)
  -> Pressure curve mapping
  -> Tilt-to-width/opacity mapping
  -> Nib model (circular for most pens, elliptical for fountain/highlighter)

Stroke Geometry Layer
  -> Catmull-Rom interpolation (rendering during drawing)
  -> Variable-width outline computation (adapted from perfect-freehand)
  -> Nib shape model integration
  -> Taper computation (start/end)

Rendering Layer
  -> Canvas 2D with double-buffer (static + active)
  -> Path2D caching for completed strokes
  -> Offscreen canvas compositing for highlighter
  -> Texture overlay for pencil
  -> Viewport culling (bounding box, later R-tree)

Storage Layer
  -> Raw point data (column-oriented, delta-encoded, quantized)
  -> Stroke metadata (pen type, color, width, smoothing)
  -> Optional cached outline for fast re-render
  -> Bounding box for spatial queries
```

### 7.2 Library Recommendations

| Library | Recommendation | Notes |
|---------|---------------|-------|
| `perfect-freehand` | **Use initially, plan to extend** | Great for v1 ballpoint/brush/felt-tip. Fork or rewrite for fountain pen/highlighter nib models. |
| `Paper.js` | **Do not use as dependency** | Study its `path.smooth()` and `path.simplify()` algorithms. Implement equivalents. |
| `Fabric.js` | **Do not use** | Wrong tool for this job. |
| `Konva.js` | **Do not use** | Wrong tool for this job. |
| `bezier-js` | **Consider as utility** | Useful for implementing Schneider's algorithm and curve operations for eraser/editing. ~15KB. |
| `simplex-noise` | **Use** | Needed for pencil grain texture. ~3KB, zero dependencies. |
| `rbush` | **Use when needed** | R-tree spatial index for viewport culling and hit testing. ~5KB. Add when document complexity demands it. |

### 7.3 Implementation Priority

**Phase 1: Core stroke rendering**
1. Use `perfect-freehand` directly for a general-purpose pen.
2. Implement 1-Euro filter for input smoothing.
3. Double-buffer rendering (static + active canvas).
4. Catmull-Rom interpolation for smooth curves during drawing.
5. Store raw points with pressure.

**Phase 2: Multiple pen types**
1. Implement pen configuration system.
2. Add brush pen (high thinning, long tapers).
3. Add ballpoint (low thinning, minimal variation).
4. Add felt-tip (moderate width, consistent opacity).
5. Tilt data capture and storage.

**Phase 3: Advanced pen types**
1. Custom outline generator with nib shape model.
2. Fountain pen with italic nib (angle-dependent width).
3. Pencil with texture (simplex noise grain, tilt-based shading).
4. Highlighter with multiply compositing.

**Phase 4: Performance and polish**
1. RDP simplification for completed strokes.
2. Schneider Bezier fitting for compact storage.
3. R-tree spatial indexing.
4. Level-of-detail rendering.
5. Customizable pressure curves (settings UI).
6. Customizable smoothing level (settings UI).

### 7.4 Key Technical Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Primary rendering | Canvas 2D | Compatibility, simplicity, sufficient performance |
| Stroke outline method | Filled polygon (perfect-freehand style) | Best quality/performance balance for most pen types |
| Real-time smoothing | 1-Euro filter | Adaptive, minimal latency, proven for pen input |
| Curve rendering | Catmull-Rom splines | Interpolating, real-time capable, smooth C1 curves |
| Post-stroke processing | RDP + Schneider Bezier | Compact storage, resolution-independent |
| Tilt integration | Custom nib model extending perfect-freehand | Needed for fountain pen and pencil |
| Pencil texture | Simplex noise + compositing | Standard approach, Canvas 2D compatible |
| Stroke storage | Raw points + cached outlines | Editability + rendering performance |
| Spatial indexing | rbush R-tree (deferred) | Add when document complexity demands it |

### 7.5 Performance Targets

- **Stroke-to-pixel latency:** < 16ms (one 60Hz frame); < 8ms with predicted events.
- **Active drawing frame rate:** 60fps (120fps on ProMotion iPads).
- **Static layer re-render:** < 5ms for 200 visible strokes.
- **Full document load:** < 100ms for 1000-stroke document.
- **Memory per stroke:** 200-500 bytes stored, 1-2KB in-memory (with cached Path2D).

---

## References

1. Casiez, G., Roussel, N., Vogel, D. "1-Euro Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems." *ACM CHI*, 2012. [cristal.univ-lille.fr/~casiez/1euro/](http://cristal.univ-lille.fr/~casiez/1euro/)
2. Schneider, P.J. "An Algorithm for Automatically Fitting Digitized Curves." *Graphics Gems*, Academic Press, 1990.
3. Steve Ruiz. "perfect-freehand" library. [github.com/steveruizok/perfect-freehand](https://github.com/steveruizok/perfect-freehand)
4. tldraw source code. [github.com/tldraw/tldraw](https://github.com/tldraw/tldraw) -- Reference for Canvas 2D infinite canvas architecture.
5. Excalidraw source code. [github.com/excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) -- Reference for dual-canvas rendering architecture.
6. W3C Pointer Events Level 3. [w3.org/TR/pointerevents3/](https://www.w3.org/TR/pointerevents3/) -- Pressure, tilt, coalesced events spec.
7. Apple Developer Documentation. "Handling Input from Apple Pencil." [developer.apple.com](https://developer.apple.com)
8. Paper.js documentation. [paperjs.org/reference/](http://paperjs.org/reference/) -- Path smoothing and simplification algorithms.
9. Douglas, D., Peucker, T. "Algorithms for the Reduction of the Number of Points Required to Represent a Digitized Line." *Cartographica*, 1973.

---

*This research document covers libraries, algorithms, and techniques for pressure-sensitive, tilt-aware stroke rendering. It consolidates and extends findings from companion research documents on pen simulation, pointer events, stroke storage, and canvas rendering. No code was written; this is research only.*
