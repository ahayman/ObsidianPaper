# Pen and Brush Simulation Techniques for Web-Based Drawing

**Date:** 2026-02-18
**Purpose:** Comprehensive research on simulating various pen/brush types in a web-based canvas drawing application, with particular focus on Apple Pencil input, variable-width stroke rendering, and real-time smoothing algorithms.

> **Note:** Web search and web fetch were unavailable during this research. All information is drawn from established algorithms, published research, and well-known open-source implementations (knowledge through May 2025). When implementing, it is recommended to verify specific library versions and API details against current documentation.

---

## Table of Contents

1. [Fountain Pen Simulation](#1-fountain-pen-simulation)
2. [Standard Pen Types](#2-standard-pen-types)
3. [The perfect-freehand Library](#3-the-perfect-freehand-library)
4. [Stroke Smoothing Algorithms](#4-stroke-smoothing-algorithms)
5. [Tilt and Pressure Mapping](#5-tilt-and-pressure-mapping)
6. [Rendering Variable-Width Paths](#6-rendering-variable-width-paths)
7. [How Commercial Apps Handle This](#7-how-commercial-apps-handle-this)
8. [Recommendations for ObsidianPaper](#8-recommendations-for-obsidianpaper)

---

## 1. Fountain Pen Simulation

### 1.1 Physical Mechanics of Italic/Broad Nibs

A fountain pen nib is a flat piece of metal (often gold or steel) with a slit down the center. Ink flows through this slit via capillary action. The key physical properties that affect the mark:

**Nib geometry:**
- A **round nib** produces a roughly circular cross-section regardless of stroke direction, giving uniform width.
- An **italic (stub/broad) nib** has a flat, chisel-like edge. The nib's footprint on paper is a rectangle (or ellipse) rather than a circle.
- The width of the mark depends on the **angle between the nib edge and the stroke direction**.

**Angle-dependent width:**
- When moving perpendicular to the nib's flat edge, the stroke is at its **maximum width** (equal to the nib width).
- When moving parallel to the nib's flat edge, the stroke is at its **minimum width** (the nib's tine thickness, often called the "hairline").
- At intermediate angles, the width varies sinusoidally between these extremes.

**The math:** Given a nib angle `theta_nib` (the angle of the nib relative to horizontal, typically 30-45 degrees for italic calligraphy) and a stroke direction angle `theta_stroke`, the effective width is:

```
effective_width = sqrt(
  (nib_width * sin(theta_stroke - theta_nib))^2 +
  (nib_thickness * cos(theta_stroke - theta_nib))^2
)
```

This is the projection of an elliptical nib footprint onto the perpendicular of the stroke direction. For a perfectly flat chisel nib (nib_thickness approaches 0), this simplifies to:

```
effective_width = nib_width * |sin(theta_stroke - theta_nib)|
```

But real nibs always have some minimum thickness, so the version with both terms is more realistic.

**Nib shape modeling:**
The nib footprint can be modeled as:
- **Rectangle:** Simplest. Width = nib_width, height = nib_thickness. Produces sharp corners in the stroke outline.
- **Ellipse:** More natural. Semi-major = nib_width/2, semi-minor = nib_thickness/2. Produces smoother stroke edges.
- **Stadium/discorectangle:** Rectangle with rounded ends. A good middle ground.

### 1.2 Algorithms for Fountain Pen Simulation

**Approach 1: Stamping with rotated ellipses**

At each sample point along the stroke, stamp a filled ellipse oriented at the nib angle. The ellipse has:
- Semi-major axis = nib_width / 2
- Semi-minor axis = nib_thickness / 2
- Rotation = theta_nib (constant for a given pen, unless using tilt)

This is simple but produces visible gaps at low sample rates. Fix this by interpolating between sample points and stamping at regular intervals (every 1-2 pixels).

**Approach 2: Skeleton + offset curves (the outline approach)**

1. Compute the stroke skeleton (center line) from input points.
2. At each point, compute the nib footprint (rotated ellipse or rectangle).
3. Compute the left and right offset points by projecting from the center to the edges of the nib footprint.
4. Connect the left offset points into a left edge curve and right offset points into a right edge curve.
5. Fill the resulting polygon.

The offset at each point is:

```
left_offset = center + rotate((-nib_width/2, 0), theta_nib)
right_offset = center + rotate((nib_width/2, 0), theta_nib)
```

More precisely, for an elliptical nib at angle `theta_nib`, the offset perpendicular to the stroke direction at angle `theta_stroke` is:

```
perpendicular_angle = theta_stroke + PI/2
// Project the ellipse onto this perpendicular direction
half_width = sqrt(
  (a * cos(perpendicular_angle - theta_nib))^2 +
  (b * sin(perpendicular_angle - theta_nib))^2
)
```

Where `a = nib_width/2` and `b = nib_thickness/2`.

**Approach 3: Convolution-based (academic)**

Model the stroke as the Minkowski sum of the nib shape swept along the path. This is mathematically precise but computationally expensive. Not practical for real-time rendering.

### 1.3 Using Apple Pencil Tilt for Nib Angle

The Apple Pencil provides:
- `altitudeAngle`: Angle from the surface (0 = flat, PI/2 = vertical). Range: 0 to PI/2 radians.
- `azimuthAngle`: Angle around the perpendicular to the screen (compass direction the pencil points). Range: 0 to 2*PI radians.

**Mapping tilt to nib angle:**

For a realistic fountain pen simulation where the nib angle follows the pencil tilt:

```typescript
// The azimuth angle directly corresponds to the nib orientation
nib_angle = azimuthAngle

// The altitude angle affects the contact area (wider when tilted)
// A more tilted pencil = wider effective nib
tilt_factor = 1.0 - (altitudeAngle / (Math.PI / 2))  // 0 when vertical, 1 when flat
effective_nib_width = base_nib_width * (min_width_fraction + tilt_factor * (1 - min_width_fraction))
```

**Option: Fixed nib angle (traditional calligraphy mode)**

For traditional italic calligraphy, the nib angle is held constant (typically 30-45 degrees). In this mode, ignore the azimuth angle and use a fixed `theta_nib`. The Apple Pencil tilt could instead modulate the nib contact area:

```typescript
// Fixed angle calligraphy
const FIXED_NIB_ANGLE = Math.PI / 6  // 30 degrees
// Use altitude to determine contact pressure/area
const contact_factor = Math.cos(altitudeAngle)  // More contact when tilted
```

### 1.4 Flex Nib Simulation

A flex nib spreads its tines apart under pressure, dramatically increasing line width. The relationship is highly nonlinear:

```
Light pressure: nib_width (normal, narrow line)
Medium pressure: nib_width * 1.5-2x
Heavy pressure: nib_width * 3-5x ("railroading" can occur if ink can't keep up)
```

**Simulation approach:**

```typescript
function flexNibWidth(basWidth: number, pressure: number, flexAmount: number): number {
  // pressure: 0 to 1
  // flexAmount: 0 (rigid) to 1 (super flex)
  // Use a power curve for natural feel
  const flexCurve = Math.pow(pressure, 0.5 + (1 - flexAmount) * 1.5)
  const minWidth = baseWidth * 0.8
  const maxWidth = baseWidth * (1 + flexAmount * 4)
  return minWidth + flexCurve * (maxWidth - minWidth)
}
```

The key to realistic flex nib simulation is that:
1. Width changes should **lag slightly** behind pressure changes (physical nib has inertia)
2. Width should increase faster than it decreases (tines spring apart easier than they close)
3. At very high pressure, the width should plateau (tines fully spread)

---

## 2. Standard Pen Types

### 2.1 Ballpoint Pen

**Physical characteristics:**
- A rotating ball in a socket transfers oil-based ink.
- Very consistent line width regardless of angle.
- Slight pressure variation (1.0-1.3x width range).
- Oil-based ink: slightly glossy, consistent opacity.
- Typical line width: 0.5-1.0mm.

**Simulation parameters:**
```typescript
{
  baseWidth: 2,            // pixels
  pressureWidthRange: [0.85, 1.15],  // Very narrow range
  pressureOpacityRange: [0.8, 1.0],  // Slight opacity variation
  smoothing: 0.3,          // Low smoothing (ballpoints drag)
  taper: { start: 3, end: 3 },  // Very short tapers
  tiltSensitivity: 0,      // No tilt response
  texture: null,            // Smooth, no texture
}
```

**Key rendering detail:** Ballpoints can have a very slight "blob" at the start of a stroke where the ball begins rotating and deposits extra ink. This can be simulated with a small increase in width for the first few points.

### 2.2 Felt-Tip / Marker

**Physical characteristics:**
- Porous tip saturated with water-based or alcohol-based ink.
- Wider, more uniform strokes than a ballpoint.
- Moderate pressure sensitivity (tip compresses slightly).
- Can bleed or feather on some papers.
- Typical line width: 1-5mm.

**Simulation parameters:**
```typescript
{
  baseWidth: 8,
  pressureWidthRange: [0.7, 1.3],   // Moderate: tip compresses
  pressureOpacityRange: [0.85, 1.0], // Fairly consistent opacity
  smoothing: 0.5,
  taper: { start: 5, end: 5 },
  tiltSensitivity: 0.1,   // Slight tilt response (tip can lean)
  texture: null,           // Smooth fill
  edgeSoftness: 0.3,      // Slightly soft edges
}
```

### 2.3 Brush Pen

**Physical characteristics:**
- Flexible tip (nylon or natural hair) that varies dramatically with pressure.
- Extremely pressure-sensitive: light touch produces a hairline, heavy pressure a wide stroke.
- Tapered ends are natural (lifting the brush creates tapers).
- Used in brush calligraphy, art.
- Width range: hairline to 15mm+ depending on brush size.

**Simulation parameters:**
```typescript
{
  baseWidth: 12,
  pressureWidthRange: [0.05, 1.0],  // Extreme range: hairline to full
  pressureOpacityRange: [0.7, 1.0],
  smoothing: 0.6,
  taper: { start: 20, end: 30 },    // Long, elegant tapers
  tiltSensitivity: 0.3,
  texture: null,
  pressureCurve: 'quadratic',       // Width scales with pressure^0.5 for natural feel
}
```

**Key rendering detail:** Brush strokes should have smooth, flowing edges. The width transitions should be interpolated smoothly (not stepped). Tapers at the start and end of strokes are essential for the brush pen look.

### 2.4 Pencil

**Physical characteristics:**
- Graphite core deposits material based on pressure and angle.
- Pressure affects both width AND opacity (light strokes are faint and thin).
- Texture is essential: the paper grain shows through.
- Tilt produces a wide, light "shading" stroke vs. a narrow, dark "writing" stroke.
- Typical width: 0.5-4mm depending on sharpness and pressure.

**Simulation parameters:**
```typescript
{
  baseWidth: 3,
  pressureWidthRange: [0.5, 1.5],
  pressureOpacityRange: [0.15, 0.85],  // Wide opacity range is key
  smoothing: 0.2,                       // Low smoothing: pencils feel gritty
  taper: { start: 3, end: 3 },
  tiltSensitivity: 0.8,                // High: tilt dramatically affects width
  texture: 'grain',                     // Paper grain texture is essential
  textureIntensity: 0.4,
}
```

**Tilt behavior for pencil:**
- Vertical (high altitude): narrow, dark line (writing with the point)
- Tilted (low altitude): wide, light line (shading with the side)

```typescript
function pencilFromTilt(altitudeAngle: number, pressure: number) {
  const tiltFactor = 1.0 - (altitudeAngle / (Math.PI / 2))  // 0=vertical, 1=flat
  return {
    width: baseWidth * (1 + tiltFactor * 3),     // Up to 4x wider when tilted
    opacity: baseOpacity * (1 - tiltFactor * 0.6), // Lighter when tilted
  }
}
```

**Texture rendering:** Apply a noise pattern to the stroke opacity. This can be done by:
1. Generating a Perlin/simplex noise texture or using a pre-made paper grain image.
2. Multiplying the stroke's alpha channel by the noise value at each pixel.
3. For performance, use a repeating tile (256x256 or 512x512) and sample it based on canvas coordinates (not stroke-local coordinates, so the "paper grain" is consistent).

### 2.5 Fountain Pen with Italic Nib

(See Section 1 for detailed mechanics.)

**Simulation parameters:**
```typescript
{
  baseWidth: 6,                      // The broad edge width
  nibThickness: 1.5,                 // The thin edge width
  nibAngle: Math.PI / 6,            // 30 degrees (traditional)
  nibAngleSource: 'fixed',          // or 'tilt' to use Apple Pencil azimuth
  pressureWidthRange: [0.8, 1.2],   // Moderate (or use flex nib model)
  pressureOpacityRange: [0.9, 1.0],
  smoothing: 0.5,
  taper: { start: 8, end: 12 },
  inkFlow: 0.9,                     // Affects consistency of ink deposition
}
```

### 2.6 Highlighter

**Physical characteristics:**
- Very wide, flat tip (chisel shape).
- Semi-transparent: must see text through it.
- Nearly zero pressure sensitivity.
- Very consistent width.
- Color blending: overlapping strokes should be slightly darker.

**Simulation parameters:**
```typescript
{
  baseWidth: 24,
  pressureWidthRange: [0.95, 1.05],  // Almost no variation
  opacity: 0.3,                       // Key: semi-transparent
  smoothing: 0.7,                     // High smoothing: straight lines
  taper: { start: 0, end: 0 },       // No taper: blunt ends
  tiltSensitivity: 0,
  blendMode: 'multiply',             // Overlapping areas are darker
  flatCap: true,                     // Square end caps, not round
  nibShape: 'rectangle',             // Chisel tip
  nibAngle: 0,                       // Horizontal orientation
}
```

**Key rendering detail:** Highlighters should use a compositing mode (like `multiply` or `darken`) so that overlapping strokes produce a natural deepening effect rather than simply stacking alpha values. In Canvas 2D, `globalCompositeOperation = 'multiply'` is useful here. Alternatively, render each stroke to a separate offscreen canvas at full opacity and then composite the whole stroke at reduced opacity, preventing intra-stroke overlap from causing uneven opacity.

---

## 3. The perfect-freehand Library

### 3.1 Overview

`perfect-freehand` is an open-source library by Steve Ruiz (creator of tldraw). It takes an array of input points (with optional pressure) and produces an array of points representing the outline of a variable-width stroke. The output is a polygon that can be rendered with `fill()` on a canvas or as an SVG path.

**Repository:** `github.com/steveruizok/perfect-freehand`
**Package:** `perfect-freehand` on npm
**Size:** Very small (~3KB gzipped), zero dependencies.

### 3.2 Core Algorithm

The algorithm works in these stages:

**Stage 1: Input Processing**
- Takes an array of input points: `[x, y, pressure?][]`
- Computes the angle and distance between consecutive points.
- Applies **streamlining**: smooths the input points using a moving average, controlled by the `streamline` parameter (0 = no smoothing, 1 = maximum smoothing). The streamline implementation uses linear interpolation toward the target point, creating a spring-like following behavior.

**Stage 2: Width Calculation**
At each point, the stroke radius is computed based on:
- `size`: The base diameter of the stroke.
- `thinning`: How much pressure affects width. Range -1 to 1.
  - Positive values: more pressure = thicker (default, natural).
  - Negative values: more pressure = thinner.
  - 0: no pressure response.
- The pressure value at each point.

```
radius = size / 2 * (1 - thinning + thinning * pressure)
```

**Stage 3: Smoothing**
The computed radius values are smoothed to prevent jitter:
- `smoothing`: How much to smooth the radius values (0 to 1). Uses exponential moving average.

**Stage 4: Tapering**
- `taper.start`: Length (in pixels) of the taper at the start of the stroke. The radius linearly decreases to 0 over this distance from the start.
- `taper.end`: Length of the taper at the end.
- `taper.startCap` and `taper.endCap` control whether the taper end has a round cap or comes to a point.

**Stage 5: Outline Generation**
For each point along the skeleton, the algorithm computes left and right offset points perpendicular to the stroke direction at the computed radius. It then:
1. Collects left-side points going forward.
2. Adds the end cap (round or pointed).
3. Collects right-side points going backward.
4. Adds the start cap.
5. Returns the complete polygon outline.

**Stage 6: Output**
Returns an array of `[x, y]` points forming a closed polygon. This polygon can be rendered as:
- SVG `<path>` with the `d` attribute from `getSvgPathFromStroke()`
- Canvas `fill()` after constructing a `Path2D`

### 3.3 Key Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `size` | number | 16 | Base diameter |
| `thinning` | number | 0.5 | Pressure-to-width mapping (-1 to 1) |
| `smoothing` | number | 0.5 | Radius smoothing (0-1) |
| `streamline` | number | 0.5 | Input point smoothing (0-1) |
| `easing` | function | t => t | Easing function for pressure |
| `start.taper` | number/boolean | 0 | Start taper length |
| `end.taper` | number/boolean | 0 | End taper length |
| `start.cap` | boolean | true | Round cap at start |
| `end.cap` | boolean | true | Round cap at end |
| `simulatePressure` | boolean | true | Simulate pressure from velocity if no real data |
| `last` | boolean | false | Whether the stroke is complete |

### 3.4 Adapting for Different Pen Types

`perfect-freehand` can be adapted for several pen types, but has limitations:

**Good fit:**
- **Ballpoint pen:** Use small `size`, low `thinning` (0.1-0.2), moderate `streamline`.
- **Brush pen:** Use larger `size`, high `thinning` (0.7-0.9), long tapers.
- **Felt-tip:** Use moderate `size`, low-moderate `thinning`, no tapers.

**Cannot do directly:**
- **Fountain pen italic nib:** The library produces round cross-sections only (constant perpendicular offset). It has no concept of nib angle or directional width variation. Would need to be forked/extended.
- **Pencil texture:** The library only produces an outline polygon; it does not handle texture. Texture would need to be applied as a fill pattern.
- **Highlighter:** No support for flat/rectangular cross-sections or transparency compositing.

**Extension strategy:**
Rather than forking `perfect-freehand`, a better approach is to:
1. Use its algorithm as inspiration for the stroke outline computation.
2. Implement a custom `getStrokeOutline()` function that accepts a nib shape model.
3. Replace the "perpendicular offset at radius r" step with a "project nib shape perpendicular to stroke direction" step.

### 3.5 Velocity-Based Pressure Simulation

When no real pressure data is available (e.g., mouse input), `perfect-freehand` simulates pressure from velocity:
- Fast movements produce thinner strokes (simulating lighter, quicker pen contact).
- Slow movements produce thicker strokes.

The formula is approximately:
```
simulated_pressure = clamp(1 - velocity / max_velocity, 0, 1)
```

This is a useful fallback but should be disabled when real Apple Pencil pressure data is available.

---

## 4. Stroke Smoothing Algorithms

### 4.1 Why Smoothing Is Necessary

Raw input from a stylus arrives at discrete intervals (typically 60-240Hz depending on the device and framework). The resulting polyline is visibly jagged, especially for curves. Smoothing algorithms interpolate between sample points to produce natural-looking curves.

There are two distinct contexts for smoothing:
1. **Real-time smoothing (during drawing):** Must be fast, must work incrementally (can't wait for future points), may cause perceived "lag."
2. **Post-stroke smoothing (after pen lift):** Can use the entire stroke, can look ahead, produces better results.

### 4.2 Moving Average / Exponential Smoothing

**Simple Moving Average (SMA):**
```
smoothed[i] = (1/N) * sum(points[i-N/2 ... i+N/2])
```
- Averages a window of N points around each point.
- Cannot be used in real-time (needs future points).
- Simple but over-smooths corners and destroys sharp details.

**Exponential Moving Average (EMA):**
```
smoothed[i] = alpha * input[i] + (1 - alpha) * smoothed[i-1]
```
Where `alpha` is in (0, 1]. Lower alpha = more smoothing.

- Can be computed in real-time (only needs past points).
- Introduces lag proportional to the smoothing amount.
- This is what `perfect-freehand`'s `streamline` parameter uses.
- Simple, fast, and "good enough" for many cases.

**Double Exponential Smoothing:**
Applies EMA twice, or uses a formulation that also smooths the velocity/derivative. Reduces lag compared to high-alpha single EMA:
```
s[i] = alpha * input[i] + (1 - alpha) * (s[i-1] + b[i-1])
b[i] = beta * (s[i] - s[i-1]) + (1 - beta) * b[i-1]
smoothed[i] = s[i]
```

### 4.3 Catmull-Rom Splines

A Catmull-Rom spline passes exactly through all control points (unlike Bezier curves which only approximate). Between each pair of consecutive points P[i] and P[i+1], the curve is defined using P[i-1], P[i], P[i+1], P[i+2] as control points.

**Parametric form:**
```
q(t) = 0.5 * (
  (2*P[i]) +
  (-P[i-1] + P[i+1]) * t +
  (2*P[i-1] - 5*P[i] + 4*P[i+1] - P[i+2]) * t^2 +
  (-P[i-1] + 3*P[i] - 3*P[i+1] + P[i+2]) * t^3
)
```
Where t ranges from 0 to 1 between P[i] and P[i+1].

**Centripetal variant:** The standard Catmull-Rom can produce cusps and self-intersections. The centripetal variant (alpha = 0.5) parameterizes by the square root of chord length, avoiding these artifacts. This is the recommended variant for handwriting.

**Pros:**
- Passes through all input points (preserves the feel of what the user drew).
- Smooth C1 continuity (continuous first derivative).
- Easy to compute incrementally (only need 4 points at a time).
- Can be used in real-time: when point P[i+2] arrives, you can render the segment from P[i] to P[i+1].

**Cons:**
- Introduces a 1-segment delay (need the next point to render current segment).
- Quality depends on input point spacing.

**Use for variable-width strokes:** Catmull-Rom can interpolate not just (x, y) positions but also pressure, tilt, and width values using the same spline with t parameter. This produces smooth width transitions.

### 4.4 Cubic Bezier Fitting (Schneider's Algorithm)

Philip Schneider's algorithm (from "Graphics Gems," 1990) fits a series of cubic Bezier curves to a set of input points, minimizing the maximum error. It is the gold standard for post-stroke smoothing.

**How it works:**
1. Parameterize the input points by chord length.
2. Estimate tangent directions at the first and last points.
3. Use least-squares to fit a single cubic Bezier to all points.
4. If the maximum error exceeds a threshold, split the point set at the point of maximum error.
5. Recursively fit each half.
6. Return the sequence of Bezier curves.

**Pros:**
- Produces the most natural-looking curves.
- Output is compact (4 control points per segment vs. many interpolated points).
- The error threshold controls the smoothness/fidelity tradeoff.
- Output can be directly stored as SVG path data.

**Cons:**
- Not inherently real-time (needs the complete stroke or at least a large segment).
- More complex to implement.
- The split-and-refit process can be slow for very long strokes.

**Adaptation for real-time:** A sliding-window variant can work in near-real-time:
1. Accumulate points in a buffer.
2. When the buffer exceeds N points, fit a Bezier to the first N points.
3. Keep the last few points as the start of the next segment.
4. Ensure C1 continuity by constraining the next segment's start tangent.

### 4.5 1-Euro Filter

The 1-Euro filter (Casiez et al., 2012) is specifically designed for real-time signal smoothing with minimal latency. It is widely used in VR/AR and drawing applications.

**Key insight:** Use high smoothing when the signal is slow-moving (hand is still) and low smoothing when the signal is fast-moving (hand is drawing quickly). This minimizes jitter during slow movements without adding lag during fast movements.

**Parameters:**
- `min_cutoff`: Minimum cutoff frequency. Lower = more smoothing at low speeds.
- `beta`: Speed coefficient. Higher = less smoothing at high speeds (more responsive).
- `d_cutoff`: Cutoff frequency for derivative estimation.

**Implementation sketch:**
```typescript
class OneEuroFilter {
  private x: LowPassFilter
  private dx: LowPassFilter
  private minCutoff: number
  private beta: number

  filter(value: number, timestamp: number): number {
    const dt = timestamp - this.lastTimestamp
    const dx = (value - this.lastValue) / dt
    const edx = this.dx.filter(dx, alpha(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)
    return this.x.filter(value, alpha(cutoff, dt))
  }
}
```

**This is highly recommended for real-time pen input smoothing** because it directly addresses the jitter-vs-lag tradeoff.

### 4.6 Comparison and Recommendations

| Algorithm | Real-time | Latency | Quality | Complexity | Best For |
|-----------|-----------|---------|---------|------------|----------|
| EMA | Yes | Medium | Low-Med | Very Low | Simple prototype |
| Double EMA | Yes | Low-Med | Medium | Low | Good general-purpose |
| 1-Euro Filter | Yes | Very Low | High | Low | **Best for real-time input** |
| Catmull-Rom | Yes (1 seg delay) | 1 segment | High | Medium | **Best for rendering curves** |
| Schneider Bezier | Post-stroke | None (post) | Highest | High | **Best for final output/storage** |

**Recommended approach for ObsidianPaper:**
1. Apply a **1-Euro filter** to raw input points for real-time jitter reduction.
2. Use **Catmull-Rom interpolation** for rendering the smoothed points as curves during drawing.
3. Optionally, apply **Schneider's algorithm** after pen-up to produce a compact Bezier representation for storage.

### 4.7 Making Smoothing Customizable

Expose a single "smoothing level" parameter (0-100) that maps to the underlying algorithm parameters:

```typescript
function mapSmoothingLevel(level: number) {
  // level: 0 (raw) to 100 (maximum smoothing)
  const t = level / 100
  return {
    // 1-Euro filter params
    oneEuro: {
      minCutoff: lerp(5.0, 0.5, t),   // Higher = less smoothing
      beta: lerp(0.001, 0.01, t),     // Higher beta = more speed-adaptive
    },
    // Catmull-Rom tension
    catmullRomAlpha: lerp(0.0, 0.5, t),  // 0 = uniform, 0.5 = centripetal
    // Bezier fitting tolerance
    bezierTolerance: lerp(1.0, 4.0, t),  // Higher = more smoothing, fewer curves
  }
}
```

---

## 5. Tilt and Pressure Mapping

### 5.1 Apple Pencil Input Data

The Apple Pencil (1st and 2nd generation) provides:

| Property | Range | Description |
|----------|-------|-------------|
| `force` | 0.0 - 6.67 (typically) | Contact force. 0 = no contact. |
| `altitudeAngle` | 0 - PI/2 radians | Angle from surface. 0 = flat, PI/2 = vertical. |
| `azimuthAngle` | 0 - 2*PI radians | Compass direction of tilt. |

In web contexts (via PointerEvent):

| Property | Range | Description |
|----------|-------|-------------|
| `pressure` | 0.0 - 1.0 | Normalized pressure. |
| `tiltX` | -90 to 90 degrees | Tilt in X axis. |
| `tiltY` | -90 to 90 degrees | Tilt in Y axis. |
| `twist` | 0 to 359 degrees | Rotation (not supported by Apple Pencil). |

**Converting tiltX/tiltY to altitude/azimuth:**
```typescript
function tiltToSpherical(tiltX: number, tiltY: number) {
  const tiltXRad = (tiltX * Math.PI) / 180
  const tiltYRad = (tiltY * Math.PI) / 180

  const azimuth = Math.atan2(Math.tan(tiltYRad), Math.tan(tiltXRad))
  const altitude = Math.atan(
    1 / Math.sqrt(Math.tan(tiltXRad) ** 2 + Math.tan(tiltYRad) ** 2)
  )

  return { azimuth, altitude }
}
```

### 5.2 Pressure Mapping Curves

Raw pressure values should not be used directly. A mapping curve makes the pen feel more natural by compensating for the non-linearity of human hand force.

**Common curves:**

**Linear (identity):**
```
mapped = raw
```
Feels stiff and hard to control in the middle range.

**Power curve (gamma):**
```
mapped = raw^gamma
```
- `gamma < 1` (e.g., 0.5): Easier to reach medium/high values. Feels "soft" and responsive. Good for brush pens.
- `gamma > 1` (e.g., 2.0): Harder to reach high values. Feels "hard" and precise. Good for fine pens.
- `gamma = 0.7` is a commonly recommended default.

**Sigmoid (S-curve):**
```
mapped = 1 / (1 + exp(-k * (raw - 0.5)))
// Normalized to [0, 1]
```
- Soft response at extremes, steep in the middle.
- Good for pen types that have a "click" feel (ballpoints).

**Piecewise linear:**
Define breakpoints: `[(0, 0), (0.2, 0.1), (0.5, 0.5), (0.8, 0.9), (1, 1)]`
- Maximum control. Can be exposed as a curve editor in settings.
- This is what Procreate uses.

**Recommended:** Use a power curve (`gamma = 0.7`) as default with an advanced option for a custom curve editor.

### 5.3 Pressure Mapping Per Pen Type

| Pen Type | Pressure -> Width | Pressure -> Opacity | Curve |
|----------|------------------|--------------------|----|
| Ballpoint | 0.85-1.15x | 0.9-1.0 | Linear |
| Felt-tip | 0.7-1.3x | 0.85-1.0 | Power (0.8) |
| Brush | 0.1-1.0x (full size) | 0.7-1.0 | Power (0.5) |
| Pencil | 0.5-1.5x | 0.15-0.85 | Power (0.6) |
| Fountain (rigid) | 0.8-1.2x | 0.9-1.0 | Linear |
| Fountain (flex) | 0.5-3.0x | 0.85-1.0 | Power (0.4) |
| Highlighter | 0.95-1.05x | Fixed 0.3 | N/A |

### 5.4 Tilt Mapping Per Pen Type

| Pen Type | Altitude -> Width | Altitude -> Opacity | Azimuth Use |
|----------|------------------|--------------------|----|
| Ballpoint | None | None | None |
| Felt-tip | Slight widening when tilted | None | None |
| Brush | Moderate widening | None | None |
| Pencil | Strong widening (shading) | Lower when tilted | None |
| Fountain (italic) | Contact area variation | None | **Nib angle** |
| Highlighter | None | None | None |

### 5.5 Smoothing Raw Pressure and Tilt

Raw pressure and tilt values from the Apple Pencil can be noisy. Apply a dedicated low-pass filter:

```typescript
// EMA filter for pressure (separate from position smoothing)
const PRESSURE_ALPHA = 0.3  // Smooth out pressure jitter
let smoothedPressure = rawPressure

function updatePressure(raw: number): number {
  smoothedPressure = PRESSURE_ALPHA * raw + (1 - PRESSURE_ALPHA) * smoothedPressure
  return smoothedPressure
}
```

Tilt values should be smoothed more aggressively since they change slowly in practice:

```typescript
const TILT_ALPHA = 0.15  // Heavy smoothing for tilt
```

---

## 6. Rendering Variable-Width Paths

This is the core rendering challenge: given a stroke skeleton with a width value at each point, how to render the filled, variable-width path on an HTML Canvas or SVG.

### 6.1 Approach 1: Stamp / Circle Method

**How it works:** At each point along the stroke, draw a filled circle (or ellipse) with the radius equal to the desired half-width at that point.

```typescript
for (const point of interpolatedPoints) {
  ctx.beginPath()
  ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2)
  ctx.fill()
}
```

**Pros:**
- Extremely simple to implement.
- Naturally handles any width variation.
- Works for any nib shape (swap circle for ellipse/rectangle).
- No complex outline computation needed.

**Cons:**
- **Performance:** Drawing hundreds/thousands of circles per stroke is expensive, especially with alpha blending.
- **Alpha artifacts:** If using semi-transparent colors, overlapping circles create darker bands. Must render to an offscreen buffer at full opacity, then composite.
- **Jagged edges at low density:** If points are far apart, individual circles become visible. Must interpolate to ensure stamps overlap sufficiently (spacing should be < radius/4).
- **Not resolution-independent:** The rendering is rasterized. Zooming in reveals the circular stamps.

**When to use:** Good for pencil/charcoal effects where the texture from discrete stamps is desirable. Also useful as a quick prototype.

### 6.2 Approach 2: Outline / Polygon Method

**How it works:** Compute the left and right edges of the stroke as offset curves, then fill the resulting polygon.

1. For each point on the skeleton, compute the perpendicular direction.
2. Offset left and right by the half-width at that point.
3. Collect all left points going forward, and all right points going backward.
4. Close the polygon with end caps.
5. Fill.

```typescript
function getStrokeOutline(points: StrokePoint[]): [number, number][] {
  const leftPoints: [number, number][] = []
  const rightPoints: [number, number][] = []

  for (let i = 0; i < points.length; i++) {
    const { x, y, radius } = points[i]
    const angle = getAngle(points, i)  // Stroke direction
    const perpAngle = angle + Math.PI / 2

    leftPoints.push([
      x + Math.cos(perpAngle) * radius,
      y + Math.sin(perpAngle) * radius,
    ])
    rightPoints.push([
      x - Math.cos(perpAngle) * radius,
      y - Math.sin(perpAngle) * radius,
    ])
  }

  // Combine: left forward, end cap, right backward, start cap
  return [
    ...leftPoints,
    ...computeEndCap(points[points.length - 1]),
    ...rightPoints.reverse(),
    ...computeStartCap(points[0]),
  ]
}
```

**Rendering the polygon:**
```typescript
const outline = getStrokeOutline(strokePoints)
ctx.beginPath()
ctx.moveTo(outline[0][0], outline[0][1])
for (let i = 1; i < outline.length; i++) {
  ctx.lineTo(outline[i][0], outline[i][1])
}
ctx.closePath()
ctx.fill()
```

For smoother results, use quadratic or cubic Bezier curves between outline points:
```typescript
// Using quadratic curves between midpoints
ctx.moveTo(outline[0][0], outline[0][1])
for (let i = 1; i < outline.length - 1; i++) {
  const midX = (outline[i][0] + outline[i + 1][0]) / 2
  const midY = (outline[i][1] + outline[i + 1][1]) / 2
  ctx.quadraticCurveTo(outline[i][0], outline[i][1], midX, midY)
}
```

**This is what `perfect-freehand` uses.**

**Pros:**
- Single fill operation = fast rendering.
- Clean, anti-aliased edges (browser handles this).
- Resolution-independent if stored as vector data.
- No alpha overlap artifacts.

**Cons:**
- Outline computation is complex, especially for:
  - Sharp corners (self-intersection of offset curves).
  - Rapidly changing widths.
  - Very tight curves (inner offset can fold over itself).
- End caps and joins require special handling.
- Applying texture inside the outline requires a clip + fill pattern approach.

**Handling self-intersections:** When the stroke curves tightly and the width is large, the inner offset curve can cross itself. Solutions:
1. **Detect and skip:** Check if consecutive inner offset points cross the skeleton and skip them.
2. **Minimum radius:** Clamp the inner offset so it never crosses the centerline.
3. **Post-process:** Use a polygon clipping library to clean up the outline.

### 6.3 Approach 3: Triangle Strip / Mesh Method

**How it works:** Generate a triangle mesh between the left and right edges, then render it with WebGL or Canvas.

1. Compute left and right edge points (same as Approach 2).
2. Create triangles connecting consecutive left and right points:
   ```
   Triangle 1: L[i], R[i], L[i+1]
   Triangle 2: R[i], L[i+1], R[i+1]
   ```
3. Render the triangles.

**With Canvas 2D:**
Not directly efficient (Canvas 2D does not have a native triangle strip). But you can draw each quad (two triangles) as a `Path2D` polygon.

**With WebGL:**
This is the optimal approach. Upload the vertex buffer as a triangle strip and render in a single draw call.

```
Vertices: L0, R0, L1, R1, L2, R2, ...
Indices (triangle strip): 0, 1, 2, 3, 4, 5, ...
```

Each vertex can carry attributes:
- Position (x, y)
- UV coordinates (for texture mapping)
- Opacity (for tapering effects)
- Side indicator (-1 for left, +1 for right, for edge softness)

**Pros:**
- Extremely fast with WebGL (single draw call, GPU-accelerated).
- Can apply textures, gradients, edge softness via fragment shaders.
- Can handle complex effects (ink flow, paper interaction) in shaders.
- Best for rendering large numbers of strokes at high frame rates.

**Cons:**
- Requires WebGL, which adds complexity.
- Overkill for Canvas 2D contexts.
- Triangle mesh generation is similar complexity to outline generation.
- Harder to export as SVG.

### 6.4 Approach 4: Quadratic Bezier Segments with Variable Width

**How it works:** Break the stroke into short quadratic Bezier segments. For each segment, compute the outline as a pair of Bezier curves (one for each edge).

This produces very smooth results with few control points. It is what many professional drawing apps use internally.

**How to compute the outline of a Bezier curve:**
For a quadratic Bezier B(t) with control points P0, P1, P2 and half-widths w0, w1, w2:

1. Compute normals at several t values.
2. Offset P0, P1, P2 along the normals by the corresponding widths.
3. The resulting control points define the left and right Bezier edges.

This is approximate but works well for small segments.

### 6.5 Comparison

| Approach | Performance | Quality | Complexity | Texture Support | Resolution Independent |
|----------|-------------|---------|------------|----------------|----------------------|
| Stamp/Circle | Poor (many draws) | Medium | Very Low | Natural (grain) | No |
| Outline/Polygon | Good (single fill) | High | Medium | Via clip+pattern | Yes |
| Mesh/WebGL | Excellent | Highest | High | Via shaders | Yes |
| Bezier Outline | Good | Highest | Medium-High | Via clip+pattern | Yes |

### 6.6 Recommended Approach for ObsidianPaper

**Primary:** Use the **Outline/Polygon method** (like `perfect-freehand`). It is the best balance of quality, performance, and complexity for a Canvas 2D application.

**For pencil/texture:** Use the **Stamp method** with a noise-modulated alpha, rendered to an offscreen canvas to avoid alpha overlap.

**Future optimization:** If performance becomes an issue with many strokes, consider migrating to a **WebGL Mesh approach** for bulk stroke rendering (re-rendering all existing strokes), while keeping Canvas 2D for the active stroke being drawn.

---

## 7. How Commercial Apps Handle This

### 7.1 Procreate (iPad)

- Uses Metal (GPU) for all rendering.
- Brushes are based on two textures: a "shape" (the stamp/dab shape) and a "grain" (paper texture).
- Each brush stroke is a series of stamp dabs placed along the path.
- Dab spacing, scatter, rotation, and size are controlled by the brush settings.
- Pressure, tilt, and velocity can be mapped to any parameter via customizable curves.
- Wet paint dynamics simulate paint mixing, spreading, and dilution.
- Renders to a tile-based canvas (supports enormous canvases).
- Not web-based, so its GPU-heavy approach is not directly applicable but the conceptual model (stamp + grain + parameter mapping) is highly influential.

### 7.2 GoodNotes (iPad)

- Focused on handwriting rather than illustration.
- Uses a simpler stroke model: variable-width outline paths.
- Pen types: Fountain Pen, Ball Point, Brush Pen.
- **Fountain pen** in GoodNotes has slight width variation based on speed (not angle-dependent like a true italic nib). It is more of a "writing pen with character" than a calligraphy pen.
- **Ball Point** is very consistent width with minimal variation.
- **Brush Pen** has strong pressure sensitivity.
- Stores strokes as point arrays with pressure values.
- Rendering appears to use the outline/polygon approach.
- Applies post-stroke smoothing (noticeable when writing slowly: the stroke "snaps" into a smooth curve after pen lift).

### 7.3 Web-Based Drawing Apps

**tldraw:**
- Uses `perfect-freehand` for its draw tool.
- Renders strokes as SVG paths.
- Supports pressure from stylus.
- Single pen type (not multiple simulated pens).

**Excalidraw:**
- Uses a simplified version of the outline approach.
- Has a "freedraw" tool with variable width.
- Renders to Canvas 2D.
- Limited pen type simulation.

**Miro / FigJam:**
- Basic pen tools without advanced pressure/tilt simulation.
- Focus on collaboration rather than drawing fidelity.

**Concepts App (iOS/web):**
- Uses a vector-based engine with infinite canvas.
- Multiple pen types including fountain pen.
- Stores strokes as vector data with width profiles.

### 7.4 Key Takeaways from Commercial Apps

1. **Stamp-based rendering** (Procreate) gives the most flexible brush engine but requires GPU rendering.
2. **Outline-based rendering** (GoodNotes, tldraw) is the standard for handwriting apps and works well with Canvas 2D.
3. **Pressure curves are essential** for making pens feel distinct and natural.
4. **Post-stroke smoothing** is common and accepted by users (the small delay is acceptable).
5. **Fewer, well-tuned pen types** are better than many mediocre ones. GoodNotes ships with only 3 pen types.

---

## 8. Recommendations for ObsidianPaper

### 8.1 Architecture

Design a **pen engine** abstraction that separates:

1. **Input processing layer:** Raw PointerEvent data in, smoothed point stream out.
   - 1-Euro filter for position
   - EMA filter for pressure and tilt
   - Converts tiltX/tiltY to altitude/azimuth

2. **Pen model layer:** Takes smoothed points, produces width/opacity at each point.
   - Each pen type is a configuration object (not a separate class).
   - Parameters: pressure curve, tilt mapping, base width, width range, opacity range, nib model.
   - The fountain pen italic model computes width from nib angle + stroke direction.
   - The pencil model adds tilt-based shading behavior.

3. **Stroke geometry layer:** Takes skeleton + width data, produces renderable geometry.
   - Outline method for most pens.
   - Stamp method available for pencil/textured pens.
   - Configurable end caps and join styles.

4. **Rendering layer:** Takes geometry, renders to canvas.
   - Standard fill for outline paths.
   - Offscreen buffer compositing for semi-transparent strokes (highlighter).
   - Texture overlay for pencil.

### 8.2 Suggested Implementation Priority

**Phase 1: Core pen (ballpoint-like)**
- Basic outline rendering with variable width from pressure.
- 1-Euro filter + Catmull-Rom interpolation.
- Single pen type that looks like a good general-purpose pen.

**Phase 2: Multiple pen types**
- Add brush pen (high pressure sensitivity, tapers).
- Add pencil (texture, tilt response).
- Add felt-tip (wider, more uniform).
- Implement the pen model configuration system.

**Phase 3: Fountain pen**
- Implement the italic nib model with angle-dependent width.
- Add flex nib simulation.
- Use Apple Pencil azimuth for nib angle option.

**Phase 4: Refinements**
- Highlighter with multiply compositing.
- Customizable pressure curves.
- Adjustable smoothing level.
- Post-stroke Bezier simplification for storage efficiency.

### 8.3 Key Libraries to Evaluate

| Library | Purpose | Notes |
|---------|---------|-------|
| `perfect-freehand` | Stroke outline generation | Good starting point, may need forking for italic nibs |
| `paper.js` | 2D vector graphics | Has built-in path smoothing, offset curves |
| `bezier-js` | Bezier curve operations | Useful for Schneider's algorithm |
| `simplex-noise` | Noise generation | For pencil texture |

### 8.4 Data Model for Stroke Storage

Each stroke should store:
```typescript
interface StoredStroke {
  id: string
  penType: string            // 'ballpoint' | 'brush' | 'pencil' | etc.
  color: string              // Hex color
  points: StrokePoint[]      // Raw or simplified points
  timestamp: number
}

interface StrokePoint {
  x: number
  y: number
  pressure: number           // 0-1, normalized
  tiltX?: number             // degrees
  tiltY?: number             // degrees
  timestamp: number          // ms, for velocity computation
}
```

Store raw (or lightly simplified) point data rather than pre-rendered geometry. This allows re-rendering with different pen settings and supports undo/redo at the stroke level.

### 8.5 Performance Considerations

- **Active stroke:** Render only the current stroke being drawn. Use requestAnimationFrame.
- **Completed strokes:** Render to an offscreen "baked" canvas. Only re-render when the viewport changes (zoom/pan) or a stroke is added/removed.
- **Redraw strategy:** On zoom/pan, either scale the baked canvas (fast, blurry during animation) or re-render affected tiles (slower, crisp).
- **Point budget:** Apply Ramer-Douglas-Peucker simplification to completed strokes to reduce point count while preserving shape. Threshold of 0.5-1.0 pixels works well.

---

## References and Further Reading

1. Schneider, P.J. "An Algorithm for Automatically Fitting Digitized Curves." *Graphics Gems*, Academic Press, 1990.
2. Casiez, G., Roussel, N., Vogel, D. "1-Euro Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems." *ACM CHI*, 2012.
3. Steve Ruiz. "perfect-freehand" library. github.com/steveruizok/perfect-freehand
4. Apple Developer Documentation. "Handling Input from Apple Pencil." developer.apple.com
5. W3C. "Pointer Events Level 3." w3.org/TR/pointerevents3/ (includes tilt, pressure, twist properties)
6. Haeberli, P. "Paint by Numbers: Abstract Image Representations." *SIGGRAPH*, 1990. (Foundational work on stamp-based rendering.)
7. Strassmann, S. "Hairy Brushes." *SIGGRAPH*, 1986. (Early work on brush simulation.)
8. Lee, J. "Simulating Oriental Black-Ink Painting." *IEEE Computer Graphics and Applications*, 1999.

---

*This research document covers the theoretical and practical foundations for implementing pen simulation in ObsidianPaper. No code was written; this is research only. The next step would be to create an implementation plan based on these findings.*
