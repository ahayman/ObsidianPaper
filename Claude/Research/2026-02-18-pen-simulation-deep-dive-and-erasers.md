# Deep Dive: Pen Tip Simulation, Color Management, and Eraser Algorithms

**Date:** 2026-02-18
**Purpose:** Detailed mathematical models and algorithmic descriptions for simulating specific pen types, managing colors across light/dark modes, and implementing eraser modes. Supplements the existing pen-brush-simulation-techniques and color-system research documents with deeper technical coverage.

> **Note:** Web search and web fetch were unavailable during this research. All information is drawn from established algorithms, published research, computer graphics fundamentals, and well-known open-source implementations (knowledge through May 2025).

---

## Table of Contents

1. [Fountain Pen Deep Dive](#1-fountain-pen-deep-dive)
2. [Ballpoint Pen Simulation](#2-ballpoint-pen-simulation)
3. [Felt-Tip / Marker Simulation](#3-felt-tip--marker-simulation)
4. [Brush Pen Simulation](#4-brush-pen-simulation)
5. [Pencil (Graphite) Simulation](#5-pencil-graphite-simulation)
6. [Highlighter Simulation](#6-highlighter-simulation)
7. [Unified Mathematical Framework](#7-unified-mathematical-framework)
8. [Non-Circular Tip Geometry Generation](#8-non-circular-tip-geometry-generation)
9. [Re-Rendering from Stored Vector Data](#9-re-rendering-from-stored-vector-data)
10. [Color System Deep Dive](#10-color-system-deep-dive)
11. [Eraser Modes: Detailed Algorithms](#11-eraser-modes-detailed-algorithms)
12. [Implementation Recommendations](#12-implementation-recommendations)

---

## 1. Fountain Pen Deep Dive

### 1.1 Italic Nib: The Complete Model

An italic (or stub/broad) fountain pen nib has a rectangular or elliptical footprint. The visible stroke width depends on the angle between the nib's broad edge and the stroke direction.

**Parameters (all adjustable):**

| Parameter | Symbol | Typical Range | Description |
|-----------|--------|---------------|-------------|
| Nib width | `W` | 1.0 - 8.0 mm | Width of the broad edge |
| Nib thickness | `T` | 0.2 - 1.5 mm | Thickness of the thin edge (tine width) |
| Nib angle | `theta_nib` | 0 - 180 degrees | Angle of the nib relative to horizontal |
| Flex amount | `F` | 0.0 - 1.0 | How much the nib spreads under pressure |
| Ink flow | `I` | 0.5 - 1.0 | Affects opacity and pooling behavior |

**The width formula (complete version):**

Given:
- `theta_stroke` = direction of stroke movement (radians, computed from consecutive points)
- `theta_nib` = nib angle (radians)
- `W` = nib broad width
- `T` = nib thin width (tine thickness)
- `p` = normalized pressure (0 to 1)
- `F` = flex amount (0 to 1)

Step 1: Compute the flex-adjusted nib dimensions:

```
W_eff = W * (1 + F * flex_curve(p))
T_eff = T * (1 + F * 0.3 * flex_curve(p))

where flex_curve(p) = p^(0.5 + (1 - F) * 1.5) * 3.0
```

The flex curve is a power function that:
- For F=0 (rigid): `p^2.0 * 3.0` -- very little expansion
- For F=0.5 (moderate flex): `p^1.25 * 3.0` -- noticeable expansion
- For F=1.0 (super flex): `p^0.5 * 3.0` -- dramatic, square-root expansion

Step 2: Compute the angle-dependent width:

```
delta = theta_stroke - theta_nib
effective_width = sqrt((W_eff * sin(delta))^2 + (T_eff * cos(delta))^2)
```

This is the projection of the elliptical nib footprint perpendicular to the stroke direction. When the stroke moves perpendicular to the nib's broad edge (`delta = PI/2`), width = W_eff. When parallel (`delta = 0`), width = T_eff.

Step 3: Apply the width to the outline generation:

```
half_width = effective_width / 2
left_point = center + half_width * perpendicular_unit_vector
right_point = center - half_width * perpendicular_unit_vector
```

### 1.2 Apple Pencil Tilt to Nib Orientation

The Apple Pencil provides two angles through the PointerEvent API:
- `tiltX` (-90 to 90 degrees): tilt in the X-Z plane
- `tiltY` (-90 to 90 degrees): tilt in the Y-Z plane

These convert to spherical coordinates:

```typescript
function tiltToSpherical(tiltX: number, tiltY: number): { azimuth: number; altitude: number } {
  const tiltXRad = (tiltX * Math.PI) / 180;
  const tiltYRad = (tiltY * Math.PI) / 180;

  // Azimuth: compass direction of the pencil tilt (0 = right, PI/2 = down)
  const azimuth = Math.atan2(Math.tan(tiltYRad), Math.tan(tiltXRad));

  // Altitude: angle from screen surface (0 = flat, PI/2 = vertical)
  const altitude = Math.atan(
    1.0 / Math.sqrt(Math.tan(tiltXRad) ** 2 + Math.tan(tiltYRad) ** 2)
  );

  return { azimuth, altitude };
}
```

**Mapping azimuth to nib angle:**

The azimuth angle directly represents the direction the physical pencil is pointing on the screen surface. For a fountain pen simulation where the nib angle follows the pencil tilt:

```typescript
// Mode 1: Dynamic nib angle (follows pencil orientation)
nib_angle = azimuth;

// Mode 2: Fixed nib angle (traditional calligraphy)
// The azimuth is ignored; nib angle is a constant (e.g., 30 or 45 degrees)
nib_angle = FIXED_NIB_ANGLE; // e.g., Math.PI / 6 for 30 degrees

// Mode 3: Hybrid -- azimuth modulates a base angle
// This simulates a pen held at a roughly constant angle with natural hand variation
const ANGLE_SENSITIVITY = 0.3; // 0 = fully fixed, 1 = fully dynamic
nib_angle = BASE_NIB_ANGLE + ANGLE_SENSITIVITY * angleDifference(azimuth, BASE_NIB_ANGLE);
```

**Mapping altitude to contact area:**

When the pencil is tilted more (lower altitude), the physical nib makes more contact with the paper. This can modulate the effective nib width:

```typescript
const tiltFactor = 1.0 - (altitude / (Math.PI / 2)); // 0 when vertical, 1 when flat
const contactMultiplier = 1.0 + tiltFactor * 0.5; // Up to 1.5x wider when tilted
W_eff *= contactMultiplier;
```

### 1.3 Flex Pen Behavior: Detailed Model

A flex nib is a fountain pen nib designed to spread its tines apart under pressure, increasing the slit width and thus the ink flow and line width. The key physical behaviors to simulate:

**1. Non-linear pressure response:**

The nib does not spread linearly with pressure. Light pressure produces no spread; as pressure increases past a threshold, spreading begins and accelerates, then plateaus when the tines reach maximum spread.

```typescript
function flexResponse(pressure: number, flexAmount: number): number {
  // flexAmount: 0 (rigid nib) to 1 (vintage flex)
  if (flexAmount === 0) return 0;

  // Threshold below which no flex occurs
  const threshold = 0.15 * (1 - flexAmount * 0.5);

  // Normalize pressure above threshold
  const p = Math.max(0, (pressure - threshold) / (1 - threshold));

  // S-curve response: slow start, rapid middle, plateau
  // Using a modified logistic function
  const k = 4 + flexAmount * 8; // steepness: 4 (low flex) to 12 (high flex)
  const midpoint = 0.4 - flexAmount * 0.1; // shifts curve left for more flex

  const response = 1 / (1 + Math.exp(-k * (p - midpoint)));

  // Normalize to 0-1 range
  const minResponse = 1 / (1 + Math.exp(-k * (0 - midpoint)));
  const maxResponse = 1 / (1 + Math.exp(-k * (1 - midpoint)));

  return (response - minResponse) / (maxResponse - minResponse);
}
```

**2. Width multiplier from flex:**

```typescript
function flexWidth(baseWidth: number, pressure: number, flexAmount: number): number {
  const spread = flexResponse(pressure, flexAmount);
  const maxMultiplier = 1 + flexAmount * 4; // up to 5x for full flex
  return baseWidth * (1 + spread * (maxMultiplier - 1));
}
```

**3. Asymmetric lag (tines spread faster than they close):**

Physical tines spring apart easily but take slightly longer to return. This creates a characteristic asymmetry in stroke width variation:

```typescript
class FlexNibState {
  private currentSpread = 0;
  private readonly OPEN_RATE = 0.4;   // fast opening
  private readonly CLOSE_RATE = 0.15; // slower closing

  update(targetSpread: number, dt: number): number {
    const rate = targetSpread > this.currentSpread ? this.OPEN_RATE : this.CLOSE_RATE;
    // Exponential approach to target
    this.currentSpread += (targetSpread - this.currentSpread) * (1 - Math.exp(-rate * dt));
    return this.currentSpread;
  }
}
```

**4. Railroading effect:**

At very high flex, the nib can spread so far that ink cannot bridge the gap between the tines, creating two thin parallel lines instead of a single thick one ("railroading"). This is an advanced effect:

```typescript
function shouldRailroad(spread: number, inkFlow: number): boolean {
  // Railroading occurs when spread exceeds ink flow capacity
  return spread > 0.85 && inkFlow < 0.7;
}

// When railroading, render two thin strokes instead of one thick one:
// Left tine: center offset left by spread_width/2, width = tine_thickness
// Right tine: center offset right by spread_width/2, width = tine_thickness
```

### 1.4 Ink Pooling at Endpoints and Direction Changes

When a fountain pen stops or reverses direction, ink pools at the contact point, creating a small, darker blob. This occurs because:
- The pen is stationary, depositing ink without spreading it along a path
- Capillary action continues to deliver ink while the pen sits
- At direction changes, the pen decelerates and re-accelerates, dwelling briefly

**Detection:**

```typescript
interface InkPoolCandidate {
  position: { x: number; y: number };
  dwellTime: number; // how long the pen lingered
  type: 'start' | 'end' | 'direction_change';
}

function detectPoolingPoints(
  points: StrokePoint[],
  velocityThreshold: number,  // pixels per ms
  angleThreshold: number      // radians
): InkPoolCandidate[] {
  const candidates: InkPoolCandidate[] = [];

  // Stroke start -- always pools slightly
  candidates.push({
    position: { x: points[0].x, y: points[0].y },
    dwellTime: estimateStartDwell(points),
    type: 'start',
  });

  // Direction changes (high curvature + low velocity)
  for (let i = 2; i < points.length - 2; i++) {
    const velocity = distance(points[i], points[i - 1]) /
      (points[i].timestamp - points[i - 1].timestamp);
    const angle = angleBetweenVectors(
      { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y },
      { x: points[i + 1].x - points[i].x, y: points[i + 1].y - points[i].y }
    );

    if (velocity < velocityThreshold && Math.abs(angle) > angleThreshold) {
      candidates.push({
        position: { x: points[i].x, y: points[i].y },
        dwellTime: estimateDwellFromVelocity(points, i),
        type: 'direction_change',
      });
    }
  }

  // Stroke end -- pools depending on how the pen was lifted
  candidates.push({
    position: { x: points[points.length - 1].x, y: points[points.length - 1].y },
    dwellTime: estimateEndDwell(points),
    type: 'end',
  });

  return candidates;
}
```

**Rendering ink pools:**

```typescript
function renderInkPool(
  ctx: CanvasRenderingContext2D,
  pool: InkPoolCandidate,
  inkColor: string,
  baseWidth: number,
  inkFlow: number
): void {
  // Pool size depends on dwell time and ink flow
  const poolRadius = baseWidth * (0.6 + pool.dwellTime * inkFlow * 0.3);

  // Render as a radial gradient: darker center, lighter edges
  const gradient = ctx.createRadialGradient(
    pool.position.x, pool.position.y, 0,
    pool.position.x, pool.position.y, poolRadius
  );

  // Parse ink color and apply slight darkening at center
  const rgba = hexToRGBA(inkColor);
  gradient.addColorStop(0, `rgba(${rgba.r * 0.8}, ${rgba.g * 0.8}, ${rgba.b * 0.8}, ${0.3 * inkFlow})`);
  gradient.addColorStop(0.5, `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${0.15 * inkFlow})`);
  gradient.addColorStop(1, `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, 0)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(pool.position.x, pool.position.y, poolRadius, 0, Math.PI * 2);
  ctx.fill();
}
```

### 1.5 Adjustable Parameters Summary (Fountain Pen)

```typescript
interface FountainPenConfig {
  // Nib geometry
  nibWidth: number;          // 1.0 - 8.0, broad edge width in pixels
  nibThickness: number;      // 0.2 - 2.0, thin edge width in pixels
  nibAngle: number;          // 0 - PI, nib angle in radians

  // Nib angle source
  nibAngleMode: 'fixed' | 'tilt' | 'hybrid';
  tiltSensitivity: number;   // 0 - 1, how much azimuth affects angle (hybrid mode)

  // Flex behavior
  flexAmount: number;        // 0 - 1, 0 = rigid, 1 = vintage flex
  flexOpenRate: number;       // 0.1 - 1.0, how fast tines spread
  flexCloseRate: number;      // 0.05 - 0.5, how fast tines close

  // Ink behavior
  inkFlow: number;           // 0.3 - 1.0, affects opacity and pooling
  inkPooling: boolean;       // enable/disable ink pooling at endpoints
  poolingIntensity: number;  // 0 - 1, how pronounced the pools are

  // Rendering
  pressureCurve: number;     // gamma value (0.3 - 2.0)
  smoothing: number;         // 0 - 1, stroke smoothing
  taper: { start: number; end: number }; // taper length in pixels
}
```

---

## 2. Ballpoint Pen Simulation

### 2.1 Physical Characteristics

A ballpoint pen uses a small rotating ball (0.5-1.0mm diameter) to transfer oil-based ink from a cartridge to paper. Key characteristics:
- **Very consistent width** -- the ball size determines the line width, not pressure
- **Slight pressure sensitivity** -- pressing harder forces the ball into the paper slightly, creating marginally wider lines
- **Pressure affects opacity/darkness more than width** -- harder pressure deposits more ink
- **Slight texture** -- the rolling ball creates micro-variations in ink deposition
- **Startup blob** -- a small ink deposit when the ball begins rolling

### 2.2 Mathematical Model

```typescript
function ballpointModel(
  pressure: number,     // 0-1 normalized
  velocity: number,     // pixels per ms
  config: BallpointConfig
): { width: number; opacity: number; texture: number } {
  // Apply pressure curve (ballpoints feel stiff, so gamma > 1)
  const mappedPressure = Math.pow(pressure, config.pressureGamma); // gamma ~1.3

  // Width: very slight variation (85% to 115% of base)
  const widthFactor = config.minWidthFactor +
    mappedPressure * (config.maxWidthFactor - config.minWidthFactor);
  const width = config.baseWidth * widthFactor;

  // Opacity: primary pressure response (80% to 100%)
  const opacity = config.minOpacity +
    mappedPressure * (config.maxOpacity - config.minOpacity);

  // Texture: slight micro-variation from the rolling ball
  // Higher at low pressure (less ink transfer, more skipping)
  const texture = config.textureAmount * (1 - mappedPressure * 0.5);

  return { width, opacity, texture };
}
```

### 2.3 Texture/Grain Effect

Ballpoint pens have a subtle texture where ink coverage is slightly uneven. At low pressure, this becomes more pronounced (the ball skips slightly).

```typescript
function ballpointTextureOpacity(
  x: number, y: number,
  baseOpacity: number,
  textureAmount: number
): number {
  // Use a high-frequency noise function for micro-variation
  // The noise should be tied to world coordinates for consistency
  const noise = simplexNoise2D(x * 0.5, y * 0.5); // high frequency
  const variation = noise * textureAmount * 0.15; // subtle: max 15% variation

  return Math.max(0, Math.min(1, baseOpacity + variation));
}
```

### 2.4 Startup Blob

When the pen first contacts the paper, the ball deposits a small extra amount of ink:

```typescript
function ballpointStartupBlob(
  strokePoints: StrokePoint[],
  config: BallpointConfig
): number[] {
  // Returns a per-point width multiplier
  const multipliers = new Array(strokePoints.length).fill(1.0);

  // First 3-5 points get a width boost (the "blob")
  const blobLength = Math.min(5, strokePoints.length);
  for (let i = 0; i < blobLength; i++) {
    const t = i / blobLength;
    multipliers[i] = 1 + config.startupBlobSize * (1 - t); // e.g., 1.3 down to 1.0
  }

  return multipliers;
}
```

### 2.5 Configuration

```typescript
interface BallpointConfig {
  baseWidth: number;         // 1.5 - 3.0 pixels
  minWidthFactor: number;    // 0.85
  maxWidthFactor: number;    // 1.15
  minOpacity: number;        // 0.80
  maxOpacity: number;        // 1.00
  pressureGamma: number;     // 1.2 - 1.5 (stiffer feel)
  textureAmount: number;     // 0 - 1 (0.2 is subtle)
  startupBlobSize: number;   // 0 - 0.5 (0.2 is subtle)
  smoothing: number;         // 0.2 - 0.4 (low: ballpoints feel gritty)
}
```

---

## 3. Felt-Tip / Marker Simulation

### 3.1 Round Tip vs Chisel Tip

**Round tip (fine-liner style):**
- Circular cross-section
- Width varies moderately with pressure (tip compresses)
- Uniform ink coverage

**Chisel tip (marker/calligraphy marker):**
- Rectangular cross-section, like a fountain pen italic nib but wider
- Width varies dramatically with stroke direction (same angle-dependent formula as italic nib)
- Can produce both thin and thick lines depending on which edge leads

### 3.2 Mathematical Model

```typescript
function feltTipModel(
  pressure: number,
  tiltAzimuth: number,    // for chisel tip orientation
  tiltAltitude: number,   // affects contact area
  strokeDirection: number,
  config: FeltTipConfig
): { width: number; opacity: number } {
  const mappedPressure = Math.pow(pressure, config.pressureGamma);

  if (config.tipShape === 'round') {
    // Round tip: simple pressure-based width
    const width = config.baseWidth *
      (config.minWidthFactor + mappedPressure * (config.maxWidthFactor - config.minWidthFactor));
    const opacity = config.minOpacity +
      mappedPressure * (config.maxOpacity - config.minOpacity);
    return { width, opacity };

  } else {
    // Chisel tip: angle-dependent width (same as italic nib)
    const nibAngle = config.tipAngleMode === 'fixed'
      ? config.fixedTipAngle
      : tiltAzimuth;

    const delta = strokeDirection - nibAngle;
    const W = config.baseWidth * (1 + mappedPressure * 0.3); // slight compression expansion
    const T = config.tipThickness * (1 + mappedPressure * 0.2);

    const width = Math.sqrt((W * Math.sin(delta)) ** 2 + (T * Math.cos(delta)) ** 2);

    // Tilt affects contact: more tilted = wider effective tip
    const tiltExpansion = 1 + (1 - tiltAltitude / (Math.PI / 2)) * config.tiltSensitivity * 0.5;

    const opacity = config.minOpacity +
      mappedPressure * (config.maxOpacity - config.minOpacity);

    return { width: width * tiltExpansion, opacity };
  }
}
```

### 3.3 Chisel Tip Tilt Behavior

When a chisel-tip marker is tilted, more of the tip surface contacts the paper, producing wider strokes. The Apple Pencil's altitude angle maps directly to this:

```typescript
// Altitude angle: PI/2 = vertical (minimal contact), 0 = flat (maximum contact)
// For a chisel tip, tilt along the chisel axis makes the stroke wider
const altitudeFactor = 1 - (altitude / (Math.PI / 2)); // 0 = vertical, 1 = flat

// The direction of tilt (azimuth) determines which axis expands
// If tilting along the chisel's long axis, width increases
// If tilting perpendicular, thickness increases
const tiltAlignment = Math.abs(Math.cos(azimuth - chiselAngle));

const effectiveWidth = baseWidth * (1 + altitudeFactor * tiltAlignment * 0.8);
const effectiveThickness = tipThickness * (1 + altitudeFactor * (1 - tiltAlignment) * 0.5);
```

### 3.4 Configuration

```typescript
interface FeltTipConfig {
  tipShape: 'round' | 'chisel';
  baseWidth: number;          // 3.0 - 12.0 pixels
  tipThickness: number;       // chisel only: 1.0 - 3.0 pixels
  fixedTipAngle: number;      // chisel only: 0 - PI radians
  tipAngleMode: 'fixed' | 'tilt';
  minWidthFactor: number;     // 0.7
  maxWidthFactor: number;     // 1.3
  minOpacity: number;         // 0.85
  maxOpacity: number;         // 1.0
  pressureGamma: number;      // 0.7 - 0.9
  tiltSensitivity: number;    // 0 - 1
  edgeSoftness: number;       // 0 - 1 (0 = hard edge, 1 = soft/feathered)
  smoothing: number;          // 0.4 - 0.6
}
```

---

## 4. Brush Pen Simulation

### 4.1 Physical Behavior

A brush pen has a flexible nylon or natural hair tip that deforms dramatically under pressure. Characteristics:
- Hairline-thin at minimal pressure
- Very wide at full pressure (10x+ width variation)
- Natural tapers at stroke start and end (when lifting the brush)
- Smooth, flowing transitions between thin and thick
- Slight velocity sensitivity: fast strokes tend to be thinner

### 4.2 Mathematical Model

```typescript
function brushPenModel(
  pressure: number,
  velocity: number,      // pixels per ms
  config: BrushPenConfig
): { width: number; opacity: number } {
  // Brush pens have a very responsive, "soft" pressure curve
  const mappedPressure = Math.pow(pressure, config.pressureGamma); // gamma ~0.4-0.6

  // Velocity-based thinning: fast strokes are thinner
  const velocityFactor = 1 - config.velocityThinning *
    Math.min(1, velocity / config.maxVelocity);

  // Width: extreme range from hairline to full width
  const widthT = mappedPressure * velocityFactor;
  const width = config.baseWidth *
    (config.minWidthFraction + widthT * (1 - config.minWidthFraction));

  // Opacity: slight variation (heavier = slightly more opaque)
  const opacity = config.minOpacity +
    mappedPressure * (config.maxOpacity - config.minOpacity);

  return { width, opacity };
}
```

### 4.3 Tapered Endpoints

Brush pen strokes naturally taper at both ends because the brush lifts off the paper gradually. This is the single most important visual characteristic:

```typescript
function applyBrushTaper(
  widths: number[],
  strokeLength: number,
  config: BrushPenConfig
): number[] {
  const tapered = [...widths];

  // Start taper: width ramps up from near-zero
  const startTaperLen = Math.min(config.startTaper, strokeLength * 0.4);
  for (let i = 0; i < tapered.length; i++) {
    const distFromStart = cumulativeDistance(i); // distance along stroke from start
    if (distFromStart < startTaperLen) {
      const t = distFromStart / startTaperLen;
      // Ease-in curve for natural taper
      const taperFactor = easeInQuad(t); // t^2
      tapered[i] *= taperFactor;
    }
  }

  // End taper: width ramps down to near-zero
  const endTaperLen = Math.min(config.endTaper, strokeLength * 0.4);
  for (let i = tapered.length - 1; i >= 0; i--) {
    const distFromEnd = cumulativeDistance(tapered.length - 1) - cumulativeDistance(i);
    if (distFromEnd < endTaperLen) {
      const t = distFromEnd / endTaperLen;
      const taperFactor = easeInQuad(t);
      tapered[i] *= taperFactor;
    }
  }

  return tapered;
}

function easeInQuad(t: number): number {
  return t * t;
}
```

### 4.4 Bristle Effects

Real brushes show individual bristle traces at high zoom. This is an advanced effect:

**Approach: Parallel sub-strokes**

Instead of a single outline, generate N parallel sub-strokes (each representing a bristle cluster):

```typescript
function renderBristleEffect(
  ctx: CanvasRenderingContext2D,
  centerPoints: StrokePoint[],
  widths: number[],
  config: BrushPenConfig
): void {
  const bristleCount = config.bristleCount; // e.g., 5-12
  const bristleSpread = config.bristleSpread; // 0-1: how much bristles separate

  for (let b = 0; b < bristleCount; b++) {
    // Each bristle has a position across the brush width
    // Spread from -0.5 to +0.5 relative to center
    const bristlePos = (b / (bristleCount - 1)) - 0.5;

    // Each bristle has slight random offset that varies slowly along the stroke
    // (simulates individual hair movement)
    const bristleSeed = b * 1000;

    const bristlePoints: { x: number; y: number }[] = [];

    for (let i = 0; i < centerPoints.length; i++) {
      const perpAngle = getPerpendicularAngle(centerPoints, i);
      const width = widths[i];

      // Bristle offset from center
      const baseOffset = bristlePos * width * bristleSpread;

      // Add slow-varying noise for natural bristle movement
      const noise = simplexNoise1D(i * 0.05 + bristleSeed) * width * 0.1;

      bristlePoints.push({
        x: centerPoints[i].x + Math.cos(perpAngle) * (baseOffset + noise),
        y: centerPoints[i].y + Math.sin(perpAngle) * (baseOffset + noise),
      });
    }

    // Render each bristle as a thin stroke
    ctx.lineWidth = config.baseWidth * 0.15 / bristleCount;
    ctx.globalAlpha = 0.3 + 0.7 / bristleCount;
    ctx.beginPath();
    ctx.moveTo(bristlePoints[0].x, bristlePoints[0].y);
    for (let i = 1; i < bristlePoints.length; i++) {
      ctx.lineTo(bristlePoints[i].x, bristlePoints[i].y);
    }
    ctx.stroke();
  }
}
```

**Simpler approach: texture mask**

A less computationally expensive approach is to use a bristle texture mask:

1. Pre-generate a 1D texture strip that represents bristle patterns (alternating high/low opacity)
2. Map this texture across the width of the stroke at each point
3. Modulate the stroke's opacity by this texture

```typescript
// Generate a 1D bristle pattern
function generateBristlePattern(bristleCount: number, width: number): Float32Array {
  const pattern = new Float32Array(width);
  const bristleWidth = width / bristleCount;

  for (let x = 0; x < width; x++) {
    // Each bristle is a smooth bump
    const bristlePhase = (x % bristleWidth) / bristleWidth;
    const bristleOpacity = 0.5 + 0.5 * Math.cos(bristlePhase * Math.PI * 2);
    pattern[x] = bristleOpacity;
  }

  return pattern;
}
```

### 4.5 Configuration

```typescript
interface BrushPenConfig {
  baseWidth: number;           // 8.0 - 30.0 pixels (at full pressure)
  minWidthFraction: number;    // 0.02 - 0.1 (hairline fraction of full width)
  pressureGamma: number;       // 0.3 - 0.6 (soft, responsive)
  velocityThinning: number;    // 0 - 0.5
  maxVelocity: number;         // pixels per ms threshold
  minOpacity: number;          // 0.6 - 0.8
  maxOpacity: number;          // 0.95 - 1.0
  startTaper: number;          // 15 - 50 pixels
  endTaper: number;            // 20 - 60 pixels
  smoothing: number;           // 0.5 - 0.7
  bristleEffect: boolean;
  bristleCount: number;        // 5 - 15
  bristleSpread: number;       // 0.3 - 0.8
}
```

---

## 5. Pencil (Graphite) Simulation

### 5.1 Physical Characteristics

Graphite pencils deposit material based on pressure and angle:
- **Pressure affects both darkness and width** (unlike pens where mainly width changes)
- **Paper texture is essential** -- graphite catches on paper grain peaks, leaving valleys empty
- **Tilt shading** -- tilting the pencil exposes the side of the graphite, producing wide, light coverage
- **Layering/buildup** -- multiple overlapping strokes accumulate graphite, becoming darker

### 5.2 Mathematical Model

```typescript
function pencilModel(
  pressure: number,
  altitude: number,       // 0 = flat (shading), PI/2 = vertical (writing)
  azimuth: number,        // direction of tilt
  velocity: number,
  config: PencilConfig
): { width: number; opacity: number; textureIntensity: number } {
  const mappedPressure = Math.pow(pressure, config.pressureGamma);

  // Tilt factor: 0 = vertical (point), 1 = flat (side)
  const tiltFactor = 1 - (altitude / (Math.PI / 2));

  // Width: narrow when vertical (writing), wide when tilted (shading)
  const baseWidth = config.pointWidth + tiltFactor * (config.sideWidth - config.pointWidth);
  const width = baseWidth * (0.7 + mappedPressure * 0.6);

  // Opacity: lighter when tilted (less graphite per area), darker with pressure
  const tiltOpacity = 1 - tiltFactor * 0.6; // tilted = lighter
  const pressureOpacity = config.minOpacity +
    mappedPressure * (config.maxOpacity - config.minOpacity);
  const opacity = tiltOpacity * pressureOpacity;

  // Texture intensity: more visible at low pressure and when tilted
  // (graphite skims over paper grain, catching only on peaks)
  const textureIntensity = config.textureBase +
    (1 - mappedPressure) * config.textureRange +
    tiltFactor * config.tiltTextureBoost;

  return {
    width,
    opacity: Math.max(0, Math.min(1, opacity)),
    textureIntensity: Math.max(0, Math.min(1, textureIntensity)),
  };
}
```

### 5.3 Paper Grain Texture Rendering

The paper grain is the defining visual characteristic of pencil strokes. The grain is a property of the paper, not the pencil, so it must be in world coordinates (stationary relative to the canvas, not the stroke).

**Generating paper grain:**

```typescript
function generatePaperGrainTexture(
  width: number,
  height: number,
  grainScale: number,     // larger = coarser grain
  grainContrast: number   // 0-1: how pronounced the grain is
): ImageData {
  const imageData = new ImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Multi-octave noise for natural paper texture
      const noise1 = simplexNoise2D(x / grainScale, y / grainScale);
      const noise2 = simplexNoise2D(x / (grainScale * 0.5), y / (grainScale * 0.5)) * 0.5;
      const noise3 = simplexNoise2D(x / (grainScale * 0.25), y / (grainScale * 0.25)) * 0.25;

      const combined = (noise1 + noise2 + noise3) / 1.75; // -1 to 1
      const normalized = (combined + 1) / 2; // 0 to 1

      // Apply contrast
      const grain = 0.5 + (normalized - 0.5) * grainContrast;

      const idx = (y * width + x) * 4;
      const value = Math.round(grain * 255);
      data[idx] = value;     // R
      data[idx + 1] = value; // G
      data[idx + 2] = value; // B
      data[idx + 3] = 255;   // A (fully opaque -- used as a mask)
    }
  }

  return imageData;
}
```

**Applying grain to a pencil stroke:**

```typescript
function renderPencilStroke(
  ctx: CanvasRenderingContext2D,
  strokeOutline: [number, number][],
  grainTexture: CanvasPattern,
  opacity: number,
  textureIntensity: number,
  inkColor: string
): void {
  // Step 1: Create an offscreen canvas for this stroke
  const offscreen = document.createElement('canvas');
  offscreen.width = ctx.canvas.width;
  offscreen.height = ctx.canvas.height;
  const offCtx = offscreen.getContext('2d')!;

  // Step 2: Draw the stroke shape (solid fill) on the offscreen canvas
  offCtx.fillStyle = inkColor;
  offCtx.beginPath();
  offCtx.moveTo(strokeOutline[0][0], strokeOutline[0][1]);
  for (let i = 1; i < strokeOutline.length; i++) {
    offCtx.lineTo(strokeOutline[i][0], strokeOutline[i][1]);
  }
  offCtx.closePath();
  offCtx.fill();

  // Step 3: Apply paper grain as a mask
  // Use 'destination-in' to keep only where grain is bright
  offCtx.globalCompositeOperation = 'destination-in';
  offCtx.fillStyle = grainTexture; // CanvasPattern from the grain texture
  offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

  // Step 4: Blend the textured result with a solid version
  // textureIntensity=0: fully solid, textureIntensity=1: fully textured
  offCtx.globalCompositeOperation = 'source-over';
  offCtx.globalAlpha = 1 - textureIntensity;
  offCtx.fillStyle = inkColor;
  offCtx.beginPath();
  offCtx.moveTo(strokeOutline[0][0], strokeOutline[0][1]);
  for (let i = 1; i < strokeOutline.length; i++) {
    offCtx.lineTo(strokeOutline[i][0], strokeOutline[i][1]);
  }
  offCtx.closePath();
  offCtx.fill();

  // Step 5: Composite onto main canvas at the pencil's opacity
  ctx.globalAlpha = opacity;
  ctx.drawImage(offscreen, 0, 0);
  ctx.globalAlpha = 1;
}
```

### 5.4 Layering / Buildup Effect

When pencil strokes overlap, graphite accumulates, making the area darker. This is different from pen strokes where overlapping at full opacity just redraws the same color.

**Approach: Render pencil strokes with `globalCompositeOperation = 'darken'`:**

```typescript
// For pencil strokes, use 'darken' composite mode
// This means overlapping light pencil strokes gradually darken
// but never exceed the stroke's own opacity
ctx.globalCompositeOperation = 'darken';
renderPencilStroke(ctx, stroke);

// Reset for other pen types
ctx.globalCompositeOperation = 'source-over';
```

**Alternative approach: Additive alpha in a separate graphite layer:**

Render all pencil strokes to a dedicated "graphite layer" canvas using additive blending for the alpha channel. This allows gradual buildup:

```typescript
// Graphite layer rendering
graphiteCtx.globalCompositeOperation = 'source-over';
// Each pencil stroke adds to the accumulated graphite
// The alpha accumulates: two 30% strokes -> ~51% combined

// Then composite the graphite layer onto the main canvas
mainCtx.drawImage(graphiteCanvas, 0, 0);
```

### 5.5 Configuration

```typescript
interface PencilConfig {
  pointWidth: number;        // 1.0 - 3.0 pixels (writing with tip)
  sideWidth: number;         // 8.0 - 20.0 pixels (shading with side)
  minOpacity: number;        // 0.05 - 0.20 (very light at low pressure)
  maxOpacity: number;        // 0.60 - 0.90 (never fully opaque like a pen)
  pressureGamma: number;     // 0.5 - 0.7 (responsive)
  tiltTextureBoost: number;  // 0 - 0.5 (more texture when tilted)
  textureBase: number;       // 0.2 - 0.4 (minimum texture visibility)
  textureRange: number;      // 0.2 - 0.5 (texture increase at low pressure)
  grainScale: number;        // 3.0 - 10.0 pixels (paper grain size)
  grainContrast: number;     // 0.3 - 0.8 (grain visibility)
  layering: boolean;         // enable graphite buildup
  smoothing: number;         // 0.1 - 0.3 (low: pencils feel immediate)
}
```

---

## 6. Highlighter Simulation

### 6.1 Physical Characteristics

- Very wide, flat rectangular tip
- Semi-transparent: text shows through
- Nearly zero pressure sensitivity
- Consistent width and opacity
- Overlapping strokes deepen the color (multiplicative blending)
- Blunt (flat) endpoints, not tapered

### 6.2 Mathematical Model

```typescript
function highlighterModel(
  pressure: number,
  config: HighlighterConfig
): { width: number; opacity: number } {
  // Almost no pressure sensitivity
  const width = config.baseWidth * (0.95 + pressure * 0.1);

  // Fixed opacity (the defining characteristic)
  const opacity = config.opacity;

  return { width, opacity };
}
```

### 6.3 Rendering with Correct Blending

The critical rendering challenge for a highlighter is that overlapping regions within the same stroke should NOT darken (they are part of one continuous mark), but overlapping regions between different strokes SHOULD darken slightly.

**Solution: Render each stroke to an offscreen canvas at full opacity, then composite at reduced opacity:**

```typescript
function renderHighlighterStroke(
  mainCtx: CanvasRenderingContext2D,
  strokeOutline: [number, number][],
  color: string,
  opacity: number,
  blendMode: string // 'multiply' or 'darken'
): void {
  // Step 1: Render the full stroke shape at 100% opacity on an offscreen canvas
  const offscreen = document.createElement('canvas');
  offscreen.width = mainCtx.canvas.width;
  offscreen.height = mainCtx.canvas.height;
  const offCtx = offscreen.getContext('2d')!;

  offCtx.fillStyle = color;
  offCtx.beginPath();
  offCtx.moveTo(strokeOutline[0][0], strokeOutline[0][1]);
  for (let i = 1; i < strokeOutline.length; i++) {
    offCtx.lineTo(strokeOutline[i][0], strokeOutline[i][1]);
  }
  offCtx.closePath();
  offCtx.fill();

  // Step 2: Composite onto main canvas at reduced opacity with blend mode
  mainCtx.globalCompositeOperation = blendMode;
  mainCtx.globalAlpha = opacity;
  mainCtx.drawImage(offscreen, 0, 0);

  // Step 3: Reset
  mainCtx.globalAlpha = 1;
  mainCtx.globalCompositeOperation = 'source-over';
}
```

### 6.4 Color Blending When Overlapping

When two different-colored highlighter strokes overlap:
- **Multiply blend:** `result = color1 * color2 / 255` (per channel). Yellow + Blue = Green-ish. Natural looking.
- **Darken blend:** `result = min(color1, color2)` per channel. The darker of each channel wins.

For highlighters, `multiply` is the most realistic blend mode because it mimics how semi-transparent inks combine on paper.

### 6.5 Flat Rectangular Tip (Outline Generation)

Instead of a circular cross-section (which produces rounded strokes), the highlighter uses a rectangular cross-section oriented at a fixed angle (typically horizontal, 0 degrees):

```typescript
function highlighterOutline(
  points: StrokePoint[],
  width: number,
  tipAngle: number // radians, typically 0 for horizontal
): [number, number][] {
  // The offset at each point is NOT perpendicular to stroke direction
  // Instead, it is always along the tip's orientation
  const halfWidth = width / 2;
  const tipDx = Math.cos(tipAngle) * halfWidth;
  const tipDy = Math.sin(tipAngle) * halfWidth;

  const leftPoints: [number, number][] = [];
  const rightPoints: [number, number][] = [];

  for (const p of points) {
    leftPoints.push([p.x - tipDx, p.y - tipDy]);
    rightPoints.push([p.x + tipDx, p.y + tipDy]);
  }

  // Flat end caps (rectangles, not rounded)
  return [
    ...leftPoints,
    rightPoints[rightPoints.length - 1], // top-right corner
    ...rightPoints.reverse(),
    leftPoints[0], // close back to start
  ];
}
```

This produces a stroke whose width is always measured along the tip angle, not perpendicular to the stroke direction. The result is a flat, chisel-style highlighter mark.

### 6.6 Configuration

```typescript
interface HighlighterConfig {
  baseWidth: number;     // 16 - 40 pixels
  opacity: number;       // 0.20 - 0.40
  tipAngle: number;      // radians (0 = horizontal, PI/4 = 45 degrees)
  blendMode: string;     // 'multiply' | 'darken'
  smoothing: number;     // 0.6 - 0.8 (high: smooth, straight lines)
  color: string;
}
```

---

## 7. Unified Mathematical Framework

### 7.1 The General Pen Function

All pen types can be described by a single function signature that maps input parameters to output rendering parameters:

```
PenFunction: (pressure, tiltAltitude, tiltAzimuth, velocity, strokeDirection, position)
  -> (width, opacity, nibAngle, textureIntensity, shape)
```

More formally:

```typescript
interface PenInput {
  pressure: number;       // 0-1 normalized
  altitude: number;       // 0 to PI/2 radians
  azimuth: number;        // 0 to 2*PI radians
  velocity: number;       // pixels per ms
  direction: number;      // stroke direction in radians
  distFromStart: number;  // distance along stroke from start (for tapering)
  distFromEnd: number;    // distance along stroke from end (for tapering)
  position: { x: number; y: number }; // world position (for texture sampling)
}

interface PenOutput {
  width: number;          // stroke width at this point
  opacity: number;        // opacity at this point (0-1)
  nibAngle: number;       // orientation of the nib shape (radians)
  nibShape: 'circle' | 'ellipse' | 'rectangle';
  nibAspectRatio: number; // 1.0 = circle, >1 = elongated
  textureIntensity: number; // 0 = solid, 1 = fully textured
  edgeSoftness: number;   // 0 = hard edge, 1 = fully soft/feathered
}

type PenFunction = (input: PenInput, config: PenConfig) => PenOutput;
```

### 7.2 Per-Pen-Type Mappings

Here is each pen type expressed as weight/influence for each input parameter:

```
                 |  pressure->width  | pressure->opacity | tilt->width | tilt->opacity | velocity->width | direction->width |
  Ballpoint      |  0.15 (minimal)   |  0.2 (slight)     |  0          |  0            |  0              |  0               |
  Felt-tip round |  0.3              |  0.15             |  0.1        |  0            |  0              |  0               |
  Felt-tip chisel|  0.3              |  0.15             |  0.3 (chisel)|  0           |  0              |  0.9 (italic)    |
  Brush pen      |  0.9 (extreme)    |  0.3              |  0.2        |  0            |  0.3            |  0               |
  Pencil         |  0.5              |  0.7 (major)      |  0.8 (shading)| 0.6 (lighter)|  0.1           |  0               |
  Fountain rigid |  0.2              |  0.1              |  0          |  0            |  0              |  0.9 (italic)    |
  Fountain flex  |  0.8 (flex)       |  0.15             |  0          |  0            |  0              |  0.9 (italic)    |
  Highlighter    |  0.05 (none)      |  0 (fixed)        |  0          |  0            |  0              |  0               |
```

### 7.3 General Width Formula

```typescript
function computeWidth(input: PenInput, config: GeneralPenConfig): number {
  // 1. Base width
  let width = config.baseWidth;

  // 2. Pressure influence
  const mappedPressure = Math.pow(input.pressure, config.pressureGamma);
  width *= lerp(config.pressureWidthRange[0], config.pressureWidthRange[1], mappedPressure);

  // 3. Tilt influence (altitude)
  if (config.tiltWidthInfluence > 0) {
    const tiltFactor = 1 - (input.altitude / (Math.PI / 2));
    width *= 1 + tiltFactor * config.tiltWidthInfluence * config.tiltWidthMultiplier;
  }

  // 4. Velocity influence
  if (config.velocityWidthInfluence > 0) {
    const velocityFactor = Math.min(1, input.velocity / config.maxVelocity);
    width *= 1 - velocityFactor * config.velocityWidthInfluence;
  }

  // 5. Direction influence (italic/chisel nibs)
  if (config.directionWidthInfluence > 0) {
    const nibAngle = config.nibAngleMode === 'tilt' ? input.azimuth : config.fixedNibAngle;
    const delta = input.direction - nibAngle;
    const W = width; // current width is the "broad" dimension
    const T = config.nibThickness; // the "thin" dimension
    width = Math.sqrt((W * Math.sin(delta)) ** 2 + (T * Math.cos(delta)) ** 2);
  }

  // 6. Tapering
  if (config.startTaper > 0 && input.distFromStart < config.startTaper) {
    width *= easeInQuad(input.distFromStart / config.startTaper);
  }
  if (config.endTaper > 0 && input.distFromEnd < config.endTaper) {
    width *= easeInQuad(input.distFromEnd / config.endTaper);
  }

  return Math.max(config.minWidth, width);
}
```

### 7.4 General Opacity Formula

```typescript
function computeOpacity(input: PenInput, config: GeneralPenConfig): number {
  const mappedPressure = Math.pow(input.pressure, config.pressureGamma);

  let opacity = lerp(config.pressureOpacityRange[0], config.pressureOpacityRange[1], mappedPressure);

  // Tilt reduces opacity (for pencil shading)
  if (config.tiltOpacityInfluence > 0) {
    const tiltFactor = 1 - (input.altitude / (Math.PI / 2));
    opacity *= 1 - tiltFactor * config.tiltOpacityInfluence;
  }

  return Math.max(0, Math.min(1, opacity));
}
```

---

## 8. Non-Circular Tip Geometry Generation

### 8.1 The Problem

For pen types with circular tips (ballpoint, brush), the stroke outline is computed by offsetting perpendicular to the stroke direction by a radius. For non-circular tips (italic nib, chisel marker, highlighter), the outline must account for the tip shape.

### 8.2 Elliptical Nib Outline

For an elliptical nib with semi-axes `a` (broad) and `b` (thin), rotated by `theta_nib`:

At each stroke point, the outline offset perpendicular to stroke direction `theta_stroke` is:

```
perpendicular_direction = theta_stroke + PI/2

half_extent = sqrt(
  (a * cos(perpendicular_direction - theta_nib))^2 +
  (b * sin(perpendicular_direction - theta_nib))^2
)

left_point = center + half_extent * unit(perpendicular_direction)
right_point = center - half_extent * unit(perpendicular_direction)
```

**Full implementation:**

```typescript
function ellipticalNibOutline(
  points: StrokePoint[],
  nibWidth: number,       // broad diameter
  nibThickness: number,   // thin diameter
  nibAngle: number,       // rotation of the nib
  pressures: number[]     // per-point pressure for flex
): { left: [number, number][]; right: [number, number][] } {
  const a = nibWidth / 2;
  const b = nibThickness / 2;

  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < points.length; i++) {
    // Stroke direction at this point
    const dir = i < points.length - 1
      ? Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x)
      : Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);

    const perpDir = dir + Math.PI / 2;

    // Nib half-extent along the perpendicular direction
    const cosAngle = Math.cos(perpDir - nibAngle);
    const sinAngle = Math.sin(perpDir - nibAngle);
    const halfExtent = Math.sqrt((a * cosAngle) ** 2 + (b * sinAngle) ** 2);

    // Apply pressure/flex scaling
    const scaledExtent = halfExtent * (0.8 + pressures[i] * 0.4); // example scaling

    left.push([
      points[i].x + Math.cos(perpDir) * scaledExtent,
      points[i].y + Math.sin(perpDir) * scaledExtent,
    ]);
    right.push([
      points[i].x - Math.cos(perpDir) * scaledExtent,
      points[i].y - Math.sin(perpDir) * scaledExtent,
    ]);
  }

  return { left, right };
}
```

### 8.3 Rectangular Nib Outline

For a rectangular nib (like a highlighter), the four corners of the nib must be tracked:

```typescript
function rectangularNibOutline(
  points: StrokePoint[],
  nibWidth: number,
  nibHeight: number,
  nibAngle: number
): [number, number][] {
  // The rectangular nib has four corners relative to center:
  const hw = nibWidth / 2;
  const hh = nibHeight / 2;
  const corners = [
    { dx: -hw, dy: -hh },
    { dx: +hw, dy: -hh },
    { dx: +hw, dy: +hh },
    { dx: -hw, dy: +hh },
  ];

  // Rotate corners by nib angle
  const rotatedCorners = corners.map(c => ({
    dx: c.dx * Math.cos(nibAngle) - c.dy * Math.sin(nibAngle),
    dy: c.dx * Math.sin(nibAngle) + c.dy * Math.cos(nibAngle),
  }));

  // For each stroke point, find the extreme left and right projections
  // of the rotated rectangle onto the perpendicular of the stroke direction
  const leftPoints: [number, number][] = [];
  const rightPoints: [number, number][] = [];

  for (let i = 0; i < points.length; i++) {
    const dir = getDirection(points, i);
    const perpDir = dir + Math.PI / 2;
    const perpX = Math.cos(perpDir);
    const perpY = Math.sin(perpDir);

    // Project each corner onto the perpendicular direction
    let maxProj = -Infinity;
    let minProj = Infinity;
    let maxCorner = rotatedCorners[0];
    let minCorner = rotatedCorners[0];

    for (const corner of rotatedCorners) {
      const proj = corner.dx * perpX + corner.dy * perpY;
      if (proj > maxProj) { maxProj = proj; maxCorner = corner; }
      if (proj < minProj) { minProj = proj; minCorner = corner; }
    }

    leftPoints.push([
      points[i].x + maxCorner.dx,
      points[i].y + maxCorner.dy,
    ]);
    rightPoints.push([
      points[i].x + minCorner.dx,
      points[i].y + minCorner.dy,
    ]);
  }

  // Assemble outline: left forward, right backward
  return [...leftPoints, ...rightPoints.reverse()];
}
```

### 8.4 End Cap Shapes

For non-circular nibs, end caps are not semicircles. Instead, the end cap should reflect the nib shape:

```typescript
function ellipticalEndCap(
  center: { x: number; y: number },
  direction: number,   // stroke direction at endpoint
  nibWidth: number,
  nibThickness: number,
  nibAngle: number,
  numSegments: number  // number of arc segments (8-16 for smooth cap)
): [number, number][] {
  const a = nibWidth / 2;
  const b = nibThickness / 2;
  const cap: [number, number][] = [];

  // Sweep from one side of the perpendicular to the other (PI radians)
  const startAngle = direction + Math.PI / 2;
  const endAngle = direction - Math.PI / 2;

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const angle = startAngle + t * (endAngle - startAngle + Math.PI * 2) % (Math.PI * 2);

    // Point on the rotated ellipse at this angle
    const dx = a * Math.cos(angle - nibAngle);
    const dy = b * Math.sin(angle - nibAngle);

    // Rotate back to world coordinates
    const worldDx = dx * Math.cos(nibAngle) - dy * Math.sin(nibAngle);
    const worldDy = dx * Math.sin(nibAngle) + dy * Math.cos(nibAngle);

    cap.push([center.x + worldDx, center.y + worldDy]);
  }

  return cap;
}
```

---

## 9. Re-Rendering from Stored Vector Data

### 9.1 The Re-Rendering Pipeline

Stored stroke data contains raw point data with per-point attributes. When the stroke needs to be displayed (initial load, zoom change, pen type change), it passes through a pipeline:

```
Stored Points (x, y, pressure, tiltX, tiltY, timestamp)
  -> Smoothing (1-Euro filter, Catmull-Rom interpolation)
  -> Pen Model (compute width, opacity, texture at each point)
  -> Outline Generation (compute left/right edges, end caps)
  -> Rendering (fill polygon, apply texture, composite)
```

### 9.2 Caching Strategy

Not every step needs to be recomputed every frame:

```
Change Type              | Steps to Recompute
-------------------------|-------------------
Pan/scroll               | Rendering only (just translate)
Zoom                     | Rendering only (scale transform)
Color change             | Rendering only (change fill color)
Width change             | Pen Model + Outline + Rendering
Pen type change          | Pen Model + Outline + Rendering
Smoothing change         | Smoothing + Pen Model + Outline + Rendering
Point data change (undo) | All steps
```

**Cached data per stroke:**

```typescript
interface CachedStroke {
  // Immutable (from storage)
  rawPoints: StrokePoint[];

  // Computed and cached (invalidated selectively)
  smoothedPoints: StrokePoint[];         // after smoothing
  widths: number[];                      // per-point widths from pen model
  opacities: number[];                   // per-point opacities from pen model
  outlinePolygon: [number, number][];    // the filled outline
  cachedPath2D: Path2D;                  // canvas-ready path

  // Dirty flags
  smoothingDirty: boolean;
  penModelDirty: boolean;
  outlineDirty: boolean;
}
```

### 9.3 Applying Pen Parameters to Stored Data

When the user changes a pen type after writing (re-styling a stroke), the raw point data is unchanged but the pen model is re-applied:

```typescript
function restyleStroke(stroke: CachedStroke, newPenConfig: PenConfig): void {
  // Raw points unchanged
  // Re-apply smoothing if smoothing parameter changed
  if (newPenConfig.smoothing !== stroke.currentConfig.smoothing) {
    stroke.smoothedPoints = applySmoothing(stroke.rawPoints, newPenConfig.smoothing);
    stroke.smoothingDirty = false;
  }

  // Re-compute widths and opacities
  for (let i = 0; i < stroke.smoothedPoints.length; i++) {
    const input = buildPenInput(stroke.smoothedPoints, i);
    const output = penFunction(input, newPenConfig);
    stroke.widths[i] = output.width;
    stroke.opacities[i] = output.opacity;
  }
  stroke.penModelDirty = false;

  // Re-compute outline
  stroke.outlinePolygon = computeOutline(
    stroke.smoothedPoints,
    stroke.widths,
    newPenConfig
  );
  stroke.cachedPath2D = polygonToPath2D(stroke.outlinePolygon);
  stroke.outlineDirty = false;
}
```

---

## 10. Color System Deep Dive

### 10.1 How Commercial Apps Handle Light/Dark Color Switching

**GoodNotes / Notability approach:**
- Colors are stored as absolute values
- Users manually pick appropriate colors for their paper background
- No automatic switching
- Simple but requires user awareness

**Apple Notes approach:**
- Colors are stored as semantic identifiers ("black", "blue", etc.)
- When displaying, the semantic color is resolved to an absolute color based on the current theme
- The stored color `black` renders as near-black (#1a1a1a) on white and near-white (#e8e8e8) on dark backgrounds
- This is transparent to the user: they pick "black" and it always looks right

**Recommended approach for ObsidianPaper: Semantic storage with absolute pairs**

Store colors as a semantic ID that maps to a pair of absolute colors:

```typescript
interface ColorDefinition {
  id: string;           // 'default', 'red', 'blue', etc.
  name: string;         // 'Black', 'Red', 'Blue', etc.
  light: string;        // hex for light background: '#1a1a1a'
  dark: string;         // hex for dark background: '#e8e8e8'
}

// In stored stroke data:
interface StoredStroke {
  colorId: string;      // 'default', 'red', etc. -- not a hex value
  // ... other properties
}

// At render time:
function resolveColor(colorId: string, isDark: boolean, palette: ColorDefinition[]): string {
  const def = palette.find(c => c.id === colorId);
  if (!def) return isDark ? '#e8e8e8' : '#1a1a1a'; // fallback
  return isDark ? def.dark : def.light;
}
```

This ensures:
1. Colors always look appropriate for the background
2. Switching themes does not require modifying stroke data
3. Custom colors can define their own light/dark pairs
4. Exporting can use either the light or dark variant based on export background

### 10.2 Color Pair Mapping Strategy

The key principle: **same perceived contrast, same hue identity**.

**Algorithm for generating a dark-mode equivalent from a light-mode color:**

```typescript
function generateDarkPair(lightHex: string): string {
  const hsl = hexToHSL(lightHex);

  // Keep hue the same
  let h = hsl.h;

  // Adjust saturation: slightly increase for dark backgrounds
  // (colors appear more washed out on dark backgrounds)
  let s = Math.min(100, hsl.s + 10);

  // Invert lightness with bias
  // Light mode colors are typically dark (L=20-50)
  // Dark mode equivalents should be light (L=55-80)
  let l: number;
  if (hsl.l < 15) {
    // Very dark (black/near-black) -> very light
    l = 90 - hsl.l;
  } else if (hsl.l > 85) {
    // Very light (white/near-white) -> very dark
    l = 100 - hsl.l;
  } else {
    // Mid-range: mirror around 50 with slight adjustment
    l = 100 - hsl.l + 5;
    l = Math.max(35, Math.min(80, l));
  }

  return hslToHex(h, s, l);
}
```

**Contrast verification:**

WCAG contrast ratio should be similar for both pairs against their respective backgrounds:

```typescript
function contrastRatio(color1: string, color2: string): number {
  const l1 = relativeLuminance(color1);
  const l2 = relativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRGB(hex);
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Verify pairs:
// contrastRatio('#1a1a1a', '#ffffff') should be similar to
// contrastRatio('#e8e8e8', '#1e1e1e')
```

### 10.3 Default Color Palettes (Industry Reference)

**GoodNotes 6 defaults (approximate):**
Black, Dark Gray, Gray, White, Red (#FF3B30), Orange (#FF9500), Yellow (#FFCC00), Green (#34C759), Teal (#5AC8FA), Blue (#007AFF), Indigo (#5856D6), Purple (#AF52DE), Pink (#FF2D55), Brown (#A2845E)

**Notability defaults (approximate):**
Black, Dark Blue (#003D8F), Red (#D42027), Green (#1E8C45), Purple (#7B2D8E), Orange (#E86100), Pink (#E0457B), Brown (#5C3317), Gray (#808080), Teal (#008080), custom slots x2

**Apple Notes defaults (approximate):**
Black/White (auto-switches), Blue, Green, Yellow, Red (and sometimes Orange, Purple)

**Recommended default palette for ObsidianPaper (10 pen colors + 5 highlighter colors):**

```typescript
const DEFAULT_PEN_PALETTE: ColorDefinition[] = [
  { id: 'black',   name: 'Black',   light: '#1a1a1a', dark: '#e8e8e8' },
  { id: 'gray',    name: 'Gray',    light: '#4a4a4a', dark: '#b8b8b8' },
  { id: 'red',     name: 'Red',     light: '#d32f2f', dark: '#ef5350' },
  { id: 'orange',  name: 'Orange',  light: '#e65100', dark: '#ff9800' },
  { id: 'green',   name: 'Green',   light: '#2e7d32', dark: '#66bb6a' },
  { id: 'teal',    name: 'Teal',    light: '#00695c', dark: '#4db6ac' },
  { id: 'blue',    name: 'Blue',    light: '#1565c0', dark: '#42a5f5' },
  { id: 'purple',  name: 'Purple',  light: '#6a1b9a', dark: '#ab47bc' },
  { id: 'pink',    name: 'Pink',    light: '#c2185b', dark: '#ec407a' },
  { id: 'brown',   name: 'Brown',   light: '#5d4037', dark: '#a1887f' },
];

const DEFAULT_HIGHLIGHTER_PALETTE: ColorDefinition[] = [
  { id: 'hl-yellow', name: 'Yellow',  light: '#f9a825', dark: '#ffee58' },
  { id: 'hl-green',  name: 'Green',   light: '#66bb6a', dark: '#81c784' },
  { id: 'hl-blue',   name: 'Blue',    light: '#42a5f5', dark: '#64b5f6' },
  { id: 'hl-pink',   name: 'Pink',    light: '#ec407a', dark: '#f06292' },
  { id: 'hl-orange', name: 'Orange',  light: '#ffa726', dark: '#ffb74d' },
];
```

### 10.4 Custom Color Management

**Color picker UI for touch/pencil interfaces:**

The color picker should be designed for touch interaction (not just mouse):
- **Large touch targets** (minimum 44x44 points per Apple HIG)
- **Two-handed operation**: picker popover appears to the side, user holds pencil in dominant hand and taps colors with other hand
- **Quick access**: last-used colors in a row above the full picker
- **Minimal taps**: select a color and close in 1-2 taps for preset colors

**Custom color data model:**

```typescript
interface CustomColor extends ColorDefinition {
  createdAt: number;     // timestamp
  isAutoGenerated: boolean; // whether the dark pair was auto-generated
}

interface ColorSettings {
  customColors: CustomColor[];     // user-created colors (max ~20)
  recentColors: string[];          // last 8 color IDs used
  favoriteColors: string[];        // pinned color IDs
}
```

**Recent colors feature:**

```typescript
class RecentColors {
  private recent: string[] = [];
  private readonly MAX_RECENT = 8;

  use(colorId: string): void {
    // Remove if already present (move to front)
    this.recent = this.recent.filter(id => id !== colorId);
    // Add to front
    this.recent.unshift(colorId);
    // Trim to max
    if (this.recent.length > this.MAX_RECENT) {
      this.recent = this.recent.slice(0, this.MAX_RECENT);
    }
  }

  getRecent(): string[] {
    return [...this.recent];
  }
}
```

---

## 11. Eraser Modes: Detailed Algorithms

### 11.1 Stroke Eraser (Tap to Delete Whole Stroke)

The simplest eraser mode. When the user taps or moves the eraser over a stroke, the entire stroke is deleted.

**Hit testing algorithm:**

```typescript
function strokeEraserHitTest(
  eraserX: number,
  eraserY: number,
  eraserRadius: number,
  stroke: CachedStroke
): boolean {
  // Quick reject: check bounding box first
  if (!circleIntersectsRect(
    eraserX, eraserY, eraserRadius,
    stroke.boundingBox
  )) {
    return false;
  }

  // Detailed check: test against each segment of the stroke
  for (let i = 0; i < stroke.smoothedPoints.length - 1; i++) {
    const p1 = stroke.smoothedPoints[i];
    const p2 = stroke.smoothedPoints[i + 1];
    const halfWidth = stroke.widths[i] / 2;

    const dist = pointToSegmentDistance(eraserX, eraserY, p1.x, p1.y, p2.x, p2.y);

    if (dist < eraserRadius + halfWidth) {
      return true;
    }
  }

  return false;
}

function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * dx;
  const projY = ay + t * dy;

  return Math.hypot(px - projX, py - projY);
}

function circleIntersectsRect(
  cx: number, cy: number, r: number,
  rect: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  // Find closest point on rectangle to circle center
  const closestX = Math.max(rect.minX, Math.min(cx, rect.maxX));
  const closestY = Math.max(rect.minY, Math.min(cy, rect.maxY));
  const distSq = (cx - closestX) ** 2 + (cy - closestY) ** 2;
  return distSq < r * r;
}
```

**Using spatial index for efficiency:**

```typescript
function eraseStrokesAt(
  eraserX: number, eraserY: number, eraserRadius: number,
  spatialIndex: RBush<StrokeItem>,
  strokes: Map<string, CachedStroke>
): string[] {
  // Query spatial index for candidate strokes
  const candidates = spatialIndex.search({
    minX: eraserX - eraserRadius,
    minY: eraserY - eraserRadius,
    maxX: eraserX + eraserRadius,
    maxY: eraserY + eraserRadius,
  });

  const deletedIds: string[] = [];

  for (const candidate of candidates) {
    const stroke = strokes.get(candidate.strokeId);
    if (stroke && strokeEraserHitTest(eraserX, eraserY, eraserRadius, stroke)) {
      deletedIds.push(candidate.strokeId);
    }
  }

  return deletedIds;
}
```

### 11.2 Pixel/Area Eraser (Partial Stroke Erasure)

This is the most complex eraser mode. The eraser has a circular area, and any stroke segments within that area are removed. Strokes that partially overlap are split.

**Step 1: Find intersection points**

For each stroke segment that the eraser overlaps, find the exact points where the eraser circle intersects the stroke:

```typescript
interface EraserIntersection {
  strokeId: string;
  segmentIndex: number;    // which segment of the stroke
  tEnter: number;          // parametric t where eraser enters (0-1 along segment)
  tExit: number;           // parametric t where eraser exits
}

function findEraserIntersections(
  eraserPath: { x: number; y: number }[],  // series of eraser positions
  eraserRadius: number,
  stroke: CachedStroke
): EraserIntersection[] {
  const intersections: EraserIntersection[] = [];

  // For each eraser position, check each stroke segment
  for (const eraserPos of eraserPath) {
    for (let i = 0; i < stroke.smoothedPoints.length - 1; i++) {
      const p1 = stroke.smoothedPoints[i];
      const p2 = stroke.smoothedPoints[i + 1];

      // Find where the line segment intersects the eraser circle
      const hits = lineSegmentCircleIntersection(
        p1.x, p1.y, p2.x, p2.y,
        eraserPos.x, eraserPos.y,
        eraserRadius + stroke.widths[i] / 2
      );

      if (hits.length > 0) {
        intersections.push({
          strokeId: stroke.id,
          segmentIndex: i,
          tEnter: hits[0],
          tExit: hits.length > 1 ? hits[1] : hits[0],
        });
      }
    }
  }

  return intersections;
}
```

**Line-circle intersection:**

```typescript
function lineSegmentCircleIntersection(
  x1: number, y1: number,  // segment start
  x2: number, y2: number,  // segment end
  cx: number, cy: number,  // circle center
  r: number                 // circle radius
): number[] {
  // Parametric form: P(t) = P1 + t * (P2 - P1), t in [0, 1]
  // |P(t) - C|^2 = r^2
  // Expand to quadratic in t: at^2 + bt + c = 0

  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;

  let discriminant = b * b - 4 * a * c;

  if (discriminant < 0) return []; // no intersection

  discriminant = Math.sqrt(discriminant);

  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  const results: number[] = [];
  if (t1 >= 0 && t1 <= 1) results.push(t1);
  if (t2 >= 0 && t2 <= 1) results.push(t2);

  // Also check if the segment is entirely inside the circle
  if (t1 < 0 && t2 > 1) {
    results.push(0, 1); // entire segment is inside
  }

  return results;
}
```

**Step 2: Compute erased regions along the stroke**

Merge all intersections into contiguous erased ranges along the stroke's parameterization:

```typescript
interface ErasedRange {
  startIndex: number;  // point index where erasure starts
  startT: number;      // parametric position within segment
  endIndex: number;    // point index where erasure ends
  endT: number;        // parametric position within segment
}

function mergeErasedRanges(
  intersections: EraserIntersection[],
  numPoints: number
): ErasedRange[] {
  if (intersections.length === 0) return [];

  // Convert segment-based intersections to a global parameter (0 to numPoints-1)
  const ranges: { start: number; end: number }[] = intersections.map(i => ({
    start: i.segmentIndex + i.tEnter,
    end: i.segmentIndex + i.tExit,
  }));

  // Sort by start
  ranges.sort((a, b) => a.start - b.start);

  // Merge overlapping ranges
  const merged: { start: number; end: number }[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i].start <= last.end + 0.01) {
      // Overlapping or adjacent -- merge
      last.end = Math.max(last.end, ranges[i].end);
    } else {
      merged.push({ ...ranges[i] });
    }
  }

  return merged.map(r => ({
    startIndex: Math.floor(r.start),
    startT: r.start - Math.floor(r.start),
    endIndex: Math.floor(r.end),
    endT: r.end - Math.floor(r.end),
  }));
}
```

**Step 3: Split the stroke at erased boundaries**

```typescript
function splitStrokeAtErasure(
  stroke: CachedStroke,
  erasedRanges: ErasedRange[]
): CachedStroke[] {
  if (erasedRanges.length === 0) return [stroke];

  const newStrokes: CachedStroke[] = [];

  // Segment 1: From stroke start to first erased range
  const firstErase = erasedRanges[0];
  if (firstErase.startIndex > 0 || firstErase.startT > 0.01) {
    const endIndex = firstErase.startIndex;
    const endT = firstErase.startT;

    // Interpolate the split point
    const splitPoint = interpolatePoint(
      stroke.rawPoints[endIndex],
      stroke.rawPoints[Math.min(endIndex + 1, stroke.rawPoints.length - 1)],
      endT
    );

    const points = [...stroke.rawPoints.slice(0, endIndex + 1), splitPoint];
    if (points.length >= 2) {
      newStrokes.push(createSubStroke(stroke, points, generateId()));
    }
  }

  // Middle segments: Between consecutive erased ranges
  for (let i = 0; i < erasedRanges.length - 1; i++) {
    const gapStart = erasedRanges[i];
    const gapEnd = erasedRanges[i + 1];

    const startIdx = gapStart.endIndex;
    const startT = gapStart.endT;
    const endIdx = gapEnd.startIndex;
    const endT = gapEnd.startT;

    // Interpolate start and end split points
    const startPoint = interpolatePoint(
      stroke.rawPoints[startIdx],
      stroke.rawPoints[Math.min(startIdx + 1, stroke.rawPoints.length - 1)],
      startT
    );
    const endPoint = interpolatePoint(
      stroke.rawPoints[endIdx],
      stroke.rawPoints[Math.min(endIdx + 1, stroke.rawPoints.length - 1)],
      endT
    );

    const points = [
      startPoint,
      ...stroke.rawPoints.slice(startIdx + 1, endIdx + 1),
      endPoint,
    ];

    if (points.length >= 2) {
      newStrokes.push(createSubStroke(stroke, points, generateId()));
    }
  }

  // Last segment: From last erased range to stroke end
  const lastErase = erasedRanges[erasedRanges.length - 1];
  if (lastErase.endIndex < stroke.rawPoints.length - 1 || lastErase.endT < 0.99) {
    const startIdx = lastErase.endIndex;
    const startT = lastErase.endT;

    const splitPoint = interpolatePoint(
      stroke.rawPoints[startIdx],
      stroke.rawPoints[Math.min(startIdx + 1, stroke.rawPoints.length - 1)],
      startT
    );

    const points = [splitPoint, ...stroke.rawPoints.slice(startIdx + 1)];
    if (points.length >= 2) {
      newStrokes.push(createSubStroke(stroke, points, generateId()));
    }
  }

  return newStrokes;
}

function interpolatePoint(p1: StrokePoint, p2: StrokePoint, t: number): StrokePoint {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
    pressure: p1.pressure + (p2.pressure - p1.pressure) * t,
    tiltX: p1.tiltX + ((p2.tiltX ?? 0) - (p1.tiltX ?? 0)) * t,
    tiltY: p1.tiltY + ((p2.tiltY ?? 0) - (p1.tiltY ?? 0)) * t,
    timestamp: p1.timestamp + (p2.timestamp - p1.timestamp) * t,
  };
}

function createSubStroke(
  parent: CachedStroke,
  points: StrokePoint[],
  newId: string
): CachedStroke {
  return {
    id: newId,
    rawPoints: points,
    penConfig: parent.penConfig,
    colorId: parent.colorId,
    // Recompute everything else
    smoothedPoints: applySmoothing(points, parent.penConfig.smoothing),
    widths: [],  // recompute
    opacities: [], // recompute
    outlinePolygon: [], // recompute
    cachedPath2D: new Path2D(), // recompute
    boundingBox: computeBoundingBox(points),
    smoothingDirty: true,
    penModelDirty: true,
    outlineDirty: true,
  };
}
```

### 11.3 Selection Eraser (Lasso Select and Delete)

The user draws a lasso (freeform selection boundary), and all strokes within or intersecting the lasso are selected and can be deleted.

**Step 1: Lasso path to polygon**

The lasso is just a series of points that form a closed polygon:

```typescript
function closeLasso(lassoPoints: { x: number; y: number }[]): { x: number; y: number }[] {
  // Close the path by connecting last point to first
  if (lassoPoints.length < 3) return lassoPoints;
  return [...lassoPoints, lassoPoints[0]];
}
```

**Step 2: Point-in-polygon test**

Use the ray casting algorithm to test if a point is inside the lasso:

```typescript
function pointInPolygon(
  px: number, py: number,
  polygon: { x: number; y: number }[]
): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    if ((yi > py) !== (yj > py) &&
        px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}
```

**Step 3: Determine which strokes are selected**

There are two selection modes:
- **Enclosing**: Only strokes entirely within the lasso are selected
- **Intersecting**: Strokes that touch or cross the lasso boundary are also selected

```typescript
function selectStrokes(
  lasso: { x: number; y: number }[],
  strokes: CachedStroke[],
  mode: 'enclosing' | 'intersecting'
): string[] {
  const selectedIds: string[] = [];

  for (const stroke of strokes) {
    // Quick reject: bounding box
    if (!polygonIntersectsRect(lasso, stroke.boundingBox)) continue;

    if (mode === 'enclosing') {
      // All points must be inside the lasso
      const allInside = stroke.smoothedPoints.every(p =>
        pointInPolygon(p.x, p.y, lasso)
      );
      if (allInside) selectedIds.push(stroke.id);

    } else {
      // Any point inside, OR any stroke segment crosses the lasso boundary
      const anyInside = stroke.smoothedPoints.some(p =>
        pointInPolygon(p.x, p.y, lasso)
      );

      if (anyInside) {
        selectedIds.push(stroke.id);
        continue;
      }

      // Check if any stroke segment crosses any lasso segment
      const crosses = strokeCrossesPolygon(stroke, lasso);
      if (crosses) selectedIds.push(stroke.id);
    }
  }

  return selectedIds;
}

function strokeCrossesPolygon(
  stroke: CachedStroke,
  polygon: { x: number; y: number }[]
): boolean {
  for (let i = 0; i < stroke.smoothedPoints.length - 1; i++) {
    const a = stroke.smoothedPoints[i];
    const b = stroke.smoothedPoints[i + 1];

    for (let j = 0; j < polygon.length - 1; j++) {
      const c = polygon[j];
      const d = polygon[j + 1];

      if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) {
        return true;
      }
    }
  }
  return false;
}

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  // Cross product method
  const d1 = crossProduct(cx, cy, dx, dy, ax, ay);
  const d2 = crossProduct(cx, cy, dx, dy, bx, by);
  const d3 = crossProduct(ax, ay, bx, by, cx, cy);
  const d4 = crossProduct(ax, ay, bx, by, dx, dy);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // Collinear cases
  if (d1 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (d2 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  if (d3 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (d4 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;

  return false;
}

function crossProduct(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number
): boolean {
  return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) &&
         Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
}
```

### 11.4 Eraser Performance Considerations

**Real-time eraser path:**

During erasing, the eraser moves along a path (not just a single point). For the pixel/area eraser, accumulate the eraser's swept path:

```typescript
class EraserSession {
  private path: { x: number; y: number; timestamp: number }[] = [];
  private affectedStrokes: Set<string> = new Set();
  private pendingSplits: Map<string, ErasedRange[]> = new Map();

  addPoint(x: number, y: number, timestamp: number): void {
    this.path.push({ x, y, timestamp });

    // Process only new segment (incremental)
    if (this.path.length >= 2) {
      const prev = this.path[this.path.length - 2];
      const curr = this.path[this.path.length - 1];

      // Sample points along the new segment at eraser-radius intervals
      // to ensure no gaps in erasure
      const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const steps = Math.max(1, Math.ceil(dist / (this.eraserRadius * 0.5)));

      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = prev.x + (curr.x - prev.x) * t;
        const py = prev.y + (curr.y - prev.y) * t;

        this.eraseAt(px, py);
      }
    }
  }

  private eraseAt(x: number, y: number): void {
    // Query spatial index
    const candidates = this.spatialIndex.search({
      minX: x - this.eraserRadius,
      minY: y - this.eraserRadius,
      maxX: x + this.eraserRadius,
      maxY: y + this.eraserRadius,
    });

    for (const candidate of candidates) {
      // Accumulate erased ranges per stroke
      const intersections = findEraserIntersections(
        [{ x, y }], this.eraserRadius, candidate.stroke
      );
      if (intersections.length > 0) {
        this.affectedStrokes.add(candidate.strokeId);
        const existing = this.pendingSplits.get(candidate.strokeId) || [];
        existing.push(...intersections);
        this.pendingSplits.set(candidate.strokeId, existing);
      }
    }
  }

  finalize(): StrokeEdit[] {
    // Merge and apply all accumulated erasures
    const edits: StrokeEdit[] = [];

    for (const [strokeId, ranges] of this.pendingSplits) {
      const stroke = this.strokes.get(strokeId);
      if (!stroke) continue;

      const mergedRanges = mergeErasedRanges(ranges, stroke.rawPoints.length);
      const newStrokes = splitStrokeAtErasure(stroke, mergedRanges);

      edits.push({
        type: 'split',
        originalId: strokeId,
        newStrokes,
      });
    }

    return edits;
  }
}
```

**Visual feedback during erasing:**

While the eraser moves, show a preview of what will be erased. Two approaches:

1. **Highlight erased regions:** Draw a semi-transparent red overlay on the eraser's swept path
2. **Fade affected strokes:** Reduce the opacity of strokes that will be affected, giving immediate visual feedback

```typescript
function renderEraserPreview(
  ctx: CanvasRenderingContext2D,
  eraserPath: { x: number; y: number }[],
  eraserRadius: number
): void {
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#ff0000';

  for (const point of eraserPath) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, eraserRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
```

---

## 12. Implementation Recommendations

### 12.1 Pen Type Priority

Based on frequency of use in handwriting apps and implementation complexity:

| Priority | Pen Type | Complexity | Notes |
|----------|----------|------------|-------|
| 1 | Ballpoint | Low | Start here. Simple, consistent. |
| 2 | Brush Pen | Medium | Dramatic pressure response, good showcase. |
| 3 | Pencil | Medium-High | Requires texture system. |
| 4 | Felt-tip (round) | Low | Moderate pressure response. |
| 5 | Fountain (rigid italic) | Medium | Angle-dependent width. |
| 6 | Highlighter | Medium | Requires special compositing. |
| 7 | Fountain (flex) | High | Complex pressure+angle model. |
| 8 | Felt-tip (chisel) | Medium | Same as italic nib model. |

### 12.2 Eraser Priority

| Priority | Eraser Mode | Complexity | Notes |
|----------|-------------|------------|-------|
| 1 | Stroke Eraser | Low | Delete whole strokes on contact. Ship first. |
| 2 | Area Eraser (stroke-splitting) | High | Split strokes at eraser boundaries. Core UX. |
| 3 | Selection Eraser (lasso) | Medium | Lasso + delete. Also useful for move/copy. |

### 12.3 Architecture Notes

**Pen engine interface:**

```typescript
interface PenEngine {
  // Given raw input and pen config, produce rendering parameters
  computeStrokeParams(
    points: StrokePoint[],
    config: PenConfig
  ): StrokeRenderParams;

  // Generate the renderable outline from stroke params
  generateOutline(
    params: StrokeRenderParams
  ): StrokeOutline;

  // Render the stroke to a canvas context
  render(
    ctx: CanvasRenderingContext2D,
    outline: StrokeOutline,
    style: StrokeStyle
  ): void;
}

interface StrokeRenderParams {
  smoothedPoints: { x: number; y: number }[];
  widths: number[];
  opacities: number[];
  nibAngles: number[];         // per-point nib orientation
  textureIntensities: number[];
}

interface StrokeOutline {
  polygon: [number, number][];  // the filled outline
  endCaps: {
    start: [number, number][];
    end: [number, number][];
  };
  inkPools?: InkPoolCandidate[]; // fountain pen only
}
```

Each pen type is a configuration object, not a separate class. The same engine handles all pen types by varying the parameters:

```typescript
const BALLPOINT_CONFIG: PenConfig = {
  type: 'ballpoint',
  baseWidth: 2,
  pressureWidthRange: [0.85, 1.15],
  pressureOpacityRange: [0.8, 1.0],
  pressureGamma: 1.3,
  tiltWidthInfluence: 0,
  tiltOpacityInfluence: 0,
  velocityWidthInfluence: 0,
  directionWidthInfluence: 0,
  nibShape: 'circle',
  nibAspectRatio: 1,
  smoothing: 0.3,
  startTaper: 3,
  endTaper: 3,
  textureType: 'none',
};

const FOUNTAIN_ITALIC_CONFIG: PenConfig = {
  type: 'fountain-italic',
  baseWidth: 6,
  nibThickness: 1.5,
  fixedNibAngle: Math.PI / 6,
  nibAngleMode: 'fixed',
  pressureWidthRange: [0.8, 1.2],
  pressureOpacityRange: [0.9, 1.0],
  pressureGamma: 1.0,
  tiltWidthInfluence: 0,
  tiltOpacityInfluence: 0,
  velocityWidthInfluence: 0,
  directionWidthInfluence: 0.9,
  nibShape: 'ellipse',
  nibAspectRatio: 4, // W/T ratio
  smoothing: 0.5,
  startTaper: 8,
  endTaper: 12,
  textureType: 'none',
  inkPooling: true,
  flexAmount: 0,
};
```

### 12.4 Testing Strategy

Each pen model should have unit tests that verify:
1. Width output at known pressure/angle combinations
2. Opacity output at known pressure/tilt combinations
3. Taper behavior at stroke endpoints
4. Outline generation does not produce self-intersections for simple curves
5. Eraser split produces correct number of sub-strokes

```typescript
describe('Fountain pen width model', () => {
  it('produces maximum width perpendicular to nib angle', () => {
    const config = FOUNTAIN_ITALIC_CONFIG;
    const input: PenInput = {
      pressure: 0.5,
      altitude: Math.PI / 2,
      azimuth: 0,
      velocity: 0,
      direction: config.fixedNibAngle + Math.PI / 2, // perpendicular
      distFromStart: 100,
      distFromEnd: 100,
      position: { x: 0, y: 0 },
    };

    const output = penFunction(input, config);
    expect(output.width).toBeCloseTo(config.baseWidth, 0.5);
  });

  it('produces minimum width parallel to nib angle', () => {
    const config = FOUNTAIN_ITALIC_CONFIG;
    const input: PenInput = {
      ...baseInput,
      direction: config.fixedNibAngle, // parallel
    };

    const output = penFunction(input, config);
    expect(output.width).toBeCloseTo(config.nibThickness, 0.5);
  });
});
```

---

## References

1. Schneider, P.J. "An Algorithm for Automatically Fitting Digitized Curves." *Graphics Gems*, Academic Press, 1990.
2. Casiez, G., Roussel, N., Vogel, D. "1-Euro Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems." *ACM CHI*, 2012.
3. Steve Ruiz. "perfect-freehand" library. github.com/steveruizok/perfect-freehand
4. Apple Developer Documentation. "Handling Input from Apple Pencil." developer.apple.com
5. W3C Pointer Events Level 3. w3.org/TR/pointerevents3/
6. Johnston, S. "Lukas's Nib Guide" -- Overview of fountain pen nib types and behavior.
7. Computer Graphics: Principles and Practice (Foley, van Dam, et al.) -- Minkowski sum and sweep operations for stroke geometry.
8. Real-Time Rendering (Akenine-Moller, et al.) -- Triangle mesh generation and GPU-based stroke rendering.
9. GoodNotes, Notability, Apple Notes -- Referenced for color palette and UX patterns (based on publicly available product information through May 2025).

---

*This research document provides detailed mathematical models and algorithms for pen simulation, color management, and eraser modes in ObsidianPaper. It supplements the earlier pen-brush-simulation-techniques.md and color-system-for-drawing-handwriting-app.md research documents. No code was written; this is research only.*
