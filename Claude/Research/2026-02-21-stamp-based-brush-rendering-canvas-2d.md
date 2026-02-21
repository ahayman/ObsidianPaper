# Stamp-Based Brush Rendering with Canvas 2D API

**Date**: 2026-02-21
**Focus**: Pencil/graphite simulation via stamp-based rendering on Canvas 2D

## Context: Current ObsidianPaper Approach

The codebase currently uses **perfect-freehand** to generate a closed polygon outline from stroke points, then fills it as a single `Path2D`. Grain texture is applied post-hoc via a tileable simplex noise pattern using `destination-out` compositing on an isolated offscreen canvas. This produces a convincing pencil look but has limitations:

- Grain is uniform across the stroke (same density regardless of pressure)
- No per-stamp opacity variation along the stroke
- The grain overlay is an approximation rather than true stamp-based graphite simulation

A stamp-based approach would instead place individual textured "dabs" along the stroke path, each varying in size, opacity, and rotation based on pressure/tilt/speed. This document covers best practices for implementing this in Canvas 2D.

---

## 1. Performance Optimization for Stamp-Based Rendering on Canvas 2D

### Core Bottleneck: API Call Overhead

Canvas 2D performance for stamp rendering is primarily limited by **JavaScript-to-native API call overhead**, not GPU fill rate. Each `drawImage()` call crosses the JS/native boundary. For a typical stroke of 100-400 points at 25% spacing, you may need 400-1600 stamp placements per stroke.

### Key Optimizations

1. **Pre-render stamps to ImageBitmap or OffscreenCanvas**: The GPU handles `drawImage()` as a texture copy, which is much faster than CPU-based path rendering. Pre-rendering the stamp once and reusing it via `drawImage()` reduces per-stamp cost to O(1) for the drawing operation itself.

2. **Use integer coordinates**: Rounding `drawImage()` x/y positions to whole numbers avoids sub-pixel interpolation overhead. This can provide measurable speedup when placing thousands of stamps.

3. **Minimize canvas size for pre-rendered stamps**: The fewer total pixels involved (source + destination), the faster scaling/compositing will be. A stamp canvas should fit snugly around the stamp image with no wasted transparent border.

4. **Avoid `willReadFrequently`**: Unless you need `getImageData()`, avoid this flag. It forces CPU-side rendering and disables GPU acceleration in Chrome.

5. **Batch state changes**: Group stamps that share the same `globalAlpha` and `globalCompositeOperation` to avoid unnecessary state transitions between draws.

### Performance Expectations

Based on benchmarks from the Canvas 2D community:

| Operation | Approximate Throughput |
|-----------|----------------------|
| `drawImage()` small sprite (32x32) | ~50,000-100,000/frame at 60fps |
| `drawImage()` medium sprite (64x64) | ~20,000-50,000/frame at 60fps |
| `drawImage()` with transform per call | ~15,000-30,000/frame at 60fps |
| Path2D `fill()` simple polygon | ~5,000-20,000/frame at 60fps |

These are rough ballpark numbers that vary dramatically by browser, GPU, and platform. The key insight is that `drawImage()` from a cached source is significantly faster than path-based rendering for repeated shapes.

---

## 2. Minimizing `save()`/`restore()` Overhead

### The Problem

Each `save()`/`restore()` pair pushes/pops the entire canvas state (17+ properties including transform, clip, styles, compositing mode). When placing hundreds of stamps per stroke, this overhead is significant.

### Solution 1: Use `setTransform()` Instead of `save()/translate()/rotate()/restore()`

Instead of:
```typescript
ctx.save();
ctx.translate(x, y);
ctx.rotate(angle);
ctx.drawImage(stamp, -hw, -hh);
ctx.restore();
```

Use:
```typescript
const cos = Math.cos(angle);
const sin = Math.sin(angle);
// setTransform(a, b, c, d, e, f) = setTransform(scaleX*cos, scaleX*sin, scaleY*-sin, scaleY*cos, tx, ty)
ctx.setTransform(cos, sin, -sin, cos, x, y);
ctx.drawImage(stamp, -hw, -hh);
```

And reset at the end:
```typescript
ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to identity
```

**Performance benchmark data** (from egaoneko/til Canvas benchmarks, 62,500 draws):

| Method | FPS at 1x scale | FPS at 5x scale |
|--------|-----------------|-----------------|
| `drawImage(img, x, y)` | 101.9 | 2.4 |
| `drawImage` + `setTransform` | 100.0 | 64.3 |

At higher scales `setTransform` dramatically outperforms direct coordinate passing because it avoids recalculating destination rectangles. For stamp rendering at 1:1 scale (the common case for stamps), the overhead difference is minimal, but `setTransform` becomes essential when stamps need rotation.

### Solution 2: Change Only What Changes

If stamps don't need rotation (or all share the same rotation), skip transforms entirely:
```typescript
ctx.globalAlpha = opacity; // Set once if constant
for (const stamp of stamps) {
  ctx.drawImage(stampCanvas, stamp.x - hw, stamp.y - hh);
}
```

If only opacity varies between stamps:
```typescript
for (const stamp of stamps) {
  ctx.globalAlpha = stamp.opacity;
  ctx.drawImage(stampCanvas, stamp.x - hw, stamp.y - hh);
}
ctx.globalAlpha = 1; // Reset
```

Setting `globalAlpha` is much cheaper than `save()`/`restore()` because it modifies a single property rather than pushing/popping the entire state stack.

### Solution 3: Pre-Bake Opacity into Stamp Variants

For a pencil with, say, 8 discrete opacity levels, pre-render 8 stamp variants with baked-in alpha:
```typescript
const stampVariants: OffscreenCanvas[] = [];
for (let i = 0; i < 8; i++) {
  const alpha = (i + 1) / 8;
  const oc = new OffscreenCanvas(size, size);
  const octx = oc.getContext('2d')!;
  octx.globalAlpha = alpha;
  octx.drawImage(baseStamp, 0, 0);
  stampVariants.push(oc);
}
```

Then draw without changing `globalAlpha` at all:
```typescript
for (const stamp of stamps) {
  const variant = stampVariants[stamp.opacityIndex];
  ctx.drawImage(variant, stamp.x - hw, stamp.y - hh);
}
```

This eliminates per-stamp state changes entirely. The tradeoff is memory (8 extra small canvases) vs. per-stamp state change cost.

---

## 3. Optimal Stamp Texture Sizes for Pencil Simulation

### Recommended Sizes

| Use Case | Stamp Size | Notes |
|----------|-----------|-------|
| Fine pencil (HB, 2H) | 16x16 to 32x32 px | Small, high-frequency grain |
| Standard pencil (B, 2B) | 32x32 to 48x48 px | Good balance of detail and performance |
| Soft pencil (4B, 6B) | 48x48 to 64x64 px | Larger, softer marks |
| Broad shading | 64x64 to 96x96 px | For tilt-based side-of-pencil |

### Why These Sizes

1. **Power-of-2 textures** (16, 32, 64) align with GPU texture sampling and avoid padding overhead in some browsers.
2. **32x32 is the sweet spot** for standard pencil: small enough for high throughput (50k+/frame), large enough to contain meaningful grain detail.
3. **The stamp represents one "dab" of graphite**, not the full stroke width. At typical pen widths of 2-6 world units, a 32x32 stamp at the rendered pixel scale provides ample resolution.

### Stamp Construction for Graphite

A pencil stamp should contain:
- **Radial falloff**: Soft gaussian-like falloff from center to edge (pencil tip pressure distribution)
- **Grain noise**: Random noise modulated by a grain pattern (paper texture interaction)
- **Alpha-only content**: The stamp should be grayscale alpha; color is applied via `fillStyle` or `globalCompositeOperation`

```typescript
function createPencilStamp(size: number, grainDensity: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const center = size / 2;
  const radius = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy) / radius;

      // Radial falloff (pressure distribution)
      const falloff = Math.max(0, 1 - dist * dist); // Quadratic falloff

      // Grain noise (paper texture interaction)
      const noise = Math.random(); // Simple random; could use Perlin for spatial coherence
      const grain = noise < grainDensity ? 1 : 0;

      // Combine: graphite deposits where grain allows, modulated by falloff
      const alpha = Math.round(falloff * grain * 255);

      const idx = (y * size + x) * 4;
      data[idx] = 0;       // R (will be colored via compositing)
      data[idx + 1] = 0;   // G
      data[idx + 2] = 0;   // B
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
```

---

## 4. Spacing Algorithms: Stamp Placement Along a Curved Path

### The Core Algorithm

Stamps are placed at evenly-spaced intervals along the stroke path. The spacing is typically expressed as a **percentage of the stamp diameter** (Procreate and Krita conventions).

#### Spacing as Percentage of Diameter

| Spacing % | Effect | Use Case |
|-----------|--------|----------|
| 1-5% | Near-continuous, very smooth | Ink pens, markers |
| 10-15% | Slight texture visible | Soft pencil |
| 20-30% | Individual stamps visible | Textured brushes |
| 50%+ | Scattered, dotted | Spray, stipple |

**Krita default**: ~10% of diameter for pixel brushes. Krita also offers "auto spacing" using a quadratic algorithm that provides finer control.

**Procreate**: Spacing is a continuous slider. Lower values merge stamps into fluid strokes; higher values reveal individual shapes.

### Arc-Length Parameterized Placement

The naive approach (placing stamps at equal `t` intervals along a Bezier) produces uneven spacing because `t` does not correspond linearly to distance along the curve. The correct approach is **arc-length parameterization**.

#### Practical Algorithm: Incremental Walk

```typescript
interface StampPlacement {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  distance: number; // cumulative distance along stroke
}

function computeStampPlacements(
  points: StrokePoint[],
  spacingPx: number,
): StampPlacement[] {
  if (points.length === 0) return [];

  const placements: StampPlacement[] = [];
  let accumDistance = 0;
  let nextStampAt = 0; // Place first stamp immediately

  // First stamp at start
  placements.push({
    x: points[0].x,
    y: points[0].y,
    pressure: points[0].pressure,
    tiltX: points[0].tiltX,
    tiltY: points[0].tiltY,
    distance: 0,
  });
  nextStampAt = spacingPx;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (segLen < 0.001) continue; // Skip zero-length segments

    const dirX = dx / segLen;
    const dirY = dy / segLen;

    let segStart = 0;

    while (accumDistance + segLen - segStart >= nextStampAt) {
      // Interpolate position along this segment
      const remaining = nextStampAt - accumDistance + segStart;
      // But we need offset from segment start
      // remaining = distance from current accumDistance to nextStampAt
      // Actually:
      const offset = nextStampAt - accumDistance;
      const t = (offset - segStart) / segLen; // But this is wrong...
      // Simpler: walk from segStart
      const walkDist = nextStampAt - (accumDistance + segStart);
      const frac = (segStart + walkDist) / segLen;

      const stampX = prev.x + dx * frac;
      const stampY = prev.y + dy * frac;

      // Interpolate pressure/tilt
      const stampPressure = prev.pressure + (curr.pressure - prev.pressure) * frac;
      const stampTiltX = prev.tiltX + (curr.tiltX - prev.tiltX) * frac;
      const stampTiltY = prev.tiltY + (curr.tiltY - prev.tiltY) * frac;

      placements.push({
        x: stampX,
        y: stampY,
        pressure: stampPressure,
        tiltX: stampTiltX,
        tiltY: stampTiltY,
        distance: nextStampAt,
      });

      segStart += walkDist;
      nextStampAt += spacingPx;
    }

    accumDistance += segLen;
  }

  return placements;
}
```

**Cleaner version** (simpler accumulator pattern):

```typescript
function placeStamps(
  points: StrokePoint[],
  spacing: number,
): StampPlacement[] {
  const result: StampPlacement[] = [];
  let distSinceLastStamp = spacing; // Force first stamp immediately

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 0.0001) continue;

    let walked = 0;

    while (walked + (spacing - distSinceLastStamp) <= segLen) {
      walked += spacing - distSinceLastStamp;
      const t = walked / segLen;

      result.push({
        x: p0.x + dx * t,
        y: p0.y + dy * t,
        pressure: p0.pressure + (p1.pressure - p0.pressure) * t,
        tiltX: p0.tiltX + (p1.tiltX - p0.tiltX) * t,
        tiltY: p0.tiltY + (p1.tiltY - p0.tiltY) * t,
        distance: 0, // Could track cumulative if needed
      });

      distSinceLastStamp = 0;
    }

    distSinceLastStamp += segLen - walked;
  }

  return result;
}
```

### Dynamic Spacing Based on Pressure

For pencil simulation, spacing can vary with pressure:
- **Light pressure**: Wider spacing (fewer graphite deposits, paper shows through)
- **Heavy pressure**: Tighter spacing (denser graphite coverage)

```typescript
const baseSpacing = stampDiameter * 0.15; // 15% of diameter
const pressureSpacingFactor = 1.0 + (1.0 - pressure) * 0.5; // 1.0x at full pressure, 1.5x at zero pressure
const effectiveSpacing = baseSpacing * pressureSpacingFactor;
```

---

## 5. Procreate/Krita Pencil Brush Parameters

### Procreate Brush Studio

Procreate's brush engine uses the following parameters relevant to pencil stamps:

| Parameter | Description | Pencil Typical Value |
|-----------|-------------|---------------------|
| **Spacing** | % of brush diameter between stamps | 5-15% |
| **Spacing Jitter** | Random variation in spacing | 10-30% |
| **Scatter** | Random rotation per stamp | Low (5-15 deg) |
| **Jitter Lateral** | Perpendicular offset from stroke path | Low (2-5%) |
| **Jitter Linear** | Along-path offset | Very low (0-3%) |
| **Count** | Stamps per placement point | 1 (single) |
| **Fall Off** | Opacity fade over stroke length | Off for pencil |
| **Pressure -> Size** | How pressure maps to stamp size | 50-80% range |
| **Pressure -> Opacity** | How pressure maps to stamp opacity | 30-90% range |

### Krita Pixel Brush Engine

Krita's approach:

- **Spacing**: Percentage of diameter (default ~10%). Has an "auto" mode with a **quadratic algorithm** for finer control.
- **Spacing vs Diameter**: Can be set to scale with diameter or remain fixed.
- **Rotation**: Can be set to follow stroke direction, random, or fixed.
- **Scatter**: Offset perpendicular to stroke direction.
- **Pressure Curves**: Per-parameter pressure curves (separate curves for size, opacity, rotation, etc.)

### Key Insight from Both Apps

Both Procreate and Krita treat pencil brushes as stamp-based engines with these common characteristics:
1. **Small grainy stamp texture** (not a solid circle)
2. **Tight spacing** (5-15% of diameter for smooth pencil strokes)
3. **Pressure controls both size AND opacity** simultaneously
4. **Slight rotation jitter** per stamp to avoid repetitive patterns
5. **No or minimal scatter** (pencil is precise, not sprayed)

---

## 6. `drawImage` with Pre-Rendered Stamp vs `createPattern`

### Performance Comparison

| Approach | Best For | Limitations |
|----------|----------|-------------|
| `drawImage(OffscreenCanvas)` | Individual stamp placement with per-stamp transforms | More API calls for many stamps |
| `createPattern` | Uniform tiling/filling | Cannot vary per-stamp; no rotation/scale/opacity per instance |

### Verdict: `drawImage` Wins for Stamp Brushes

**`drawImage` with a pre-rendered stamp on OffscreenCanvas is the correct choice** for stamp-based brush rendering. Reasons:

1. **Per-stamp variation**: Each stamp can have different position, size, rotation, and opacity. Patterns cannot do this.
2. **Hardware acceleration**: `drawImage()` is GPU-accelerated in modern browsers; the GPU handles texture copies efficiently.
3. **Performance data**: `drawImage(Image)` can be orders of magnitude faster than `createPattern` with HTMLCanvasElement sources ([benchmark data from programmerall.com](https://www.programmerall.com/article/90572058696/)).
4. **ImageBitmap optimization**: Convert the stamp to `ImageBitmap` for best performance:
   ```typescript
   const stamp = new OffscreenCanvas(32, 32);
   // ... render stamp ...
   const bitmap = await createImageBitmap(stamp);
   // bitmap is faster than canvas as drawImage source
   ```

**`createPattern` is appropriate for**: The current grain texture overlay approach (tiling a noise texture over a filled path), which is different from stamp-based rendering.

### Using Both Together

A hybrid approach could use:
- `drawImage()` for per-stamp placement along the stroke
- `createPattern()` for a secondary grain overlay pass (the current approach)

---

## 7. Pressure-to-Opacity and Pressure-to-Size Mapping for Pencil Feel

### The Pressure Curve

The `pressureCurve` property in PenStyle is a gamma exponent. The formula is:

```typescript
effectivePressure = Math.pow(rawPressure, pressureCurve);
```

- `pressureCurve < 1.0`: More sensitive (small pressure changes have big effect) -- "soft" feel
- `pressureCurve = 1.0`: Linear mapping
- `pressureCurve > 1.0`: Less sensitive (need more pressure for effect) -- "hard" feel

### Recommended Pressure Mappings for Pencil

#### Size Mapping

```typescript
function pressureToSize(pressure: number, config: PenConfig, style: PenStyle): number {
  const gamma = style.pressureCurve;
  const p = Math.pow(Math.max(0, Math.min(1, pressure)), gamma);
  const [minFrac, maxFrac] = config.pressureWidthRange; // e.g., [0.5, 1.5]
  const sizeMul = minFrac + p * (maxFrac - minFrac);
  return style.width * sizeMul;
}
```

For pencil, current config is `pressureWidthRange: [0.5, 1.5]`, which means:
- Zero pressure: 50% of base width
- Full pressure: 150% of base width
- This is a good range for pencil; it creates visible variation without being cartoonish.

#### Opacity Mapping

```typescript
function pressureToOpacity(pressure: number, config: PenConfig, style: PenStyle): number {
  const gamma = style.pressureCurve;
  const p = Math.pow(Math.max(0, Math.min(1, pressure)), gamma);
  const [minOp, maxOp] = config.pressureOpacityRange!; // e.g., [0.15, 0.85]
  return minOp + p * (maxOp - minOp);
}
```

Current pencil config: `pressureOpacityRange: [0.15, 0.85]`
- Light touch: 15% opacity (faint graphite)
- Full pressure: 85% opacity (dark but not solid -- paper still slightly shows)
- This is realistic: real graphite never reaches 100% opacity.

#### Combined Mapping for Stamp Rendering

For each stamp placement:
```typescript
const stampSize = pressureToSize(placement.pressure, penConfig, style);
const stampOpacity = pressureToOpacity(placement.pressure, penConfig, style);
const stampRotation = Math.random() * Math.PI * 0.1 - Math.PI * 0.05; // +/- 9 degrees jitter

ctx.globalAlpha = stampOpacity * style.opacity; // Combine with base pen opacity
const scale = stampSize / baseStampSize;
const cos = Math.cos(stampRotation) * scale;
const sin = Math.sin(stampRotation) * scale;
ctx.setTransform(cos, sin, -sin, cos, placement.x, placement.y);
ctx.drawImage(stampBitmap, -halfW, -halfH);
```

### Apple Pencil Considerations

The Apple Pencil provides 4096 levels of pressure, which is far more granular than needed for 8 discrete stamp opacity levels. The pressure range is also very wide -- users must press quite hard to reach 100%. For pencil simulation:

- **Soft pressure curve** (gamma 0.7-0.9) feels more natural with Apple Pencil
- **Tilt should widen the stamp** (side-of-pencil effect): use a stretched elliptical stamp at high tilt angles
- The current `tiltSensitivity: 0.8` for pencil is appropriate

---

## 8. Batch-Rendering Stamps Without Per-Stamp `save()`/`restore()`

### Technique 1: The Minimal State Change Loop

The most practical approach for Canvas 2D today:

```typescript
function renderStampBrush(
  ctx: CanvasRenderingContext2D,
  placements: StampPlacement[],
  stampBitmap: ImageBitmap,
  config: PenConfig,
  style: PenStyle,
): void {
  const halfW = stampBitmap.width / 2;
  const halfH = stampBitmap.height / 2;
  const baseStampSize = stampBitmap.width;

  // Save once at the beginning
  ctx.save();

  for (const p of placements) {
    const size = pressureToSize(p.pressure, config, style);
    const opacity = pressureToOpacity(p.pressure, config, style);
    const jitterAngle = (Math.random() - 0.5) * 0.18; // ~10 degrees

    const scale = size / baseStampSize;
    const cos = Math.cos(jitterAngle) * scale;
    const sin = Math.sin(jitterAngle) * scale;

    // setTransform replaces current transform (no accumulation, no save/restore needed)
    ctx.setTransform(cos, sin, -sin, cos, p.x, p.y);
    ctx.globalAlpha = opacity;
    ctx.drawImage(stampBitmap, -halfW, -halfH);
  }

  // Restore once at the end
  ctx.restore();
}
```

**Key points**:
- Single `save()`/`restore()` pair wrapping the entire loop
- `setTransform()` replaces (not accumulates) the transform each iteration
- `globalAlpha` is a cheap property assignment
- No per-stamp `save()`/`restore()` overhead

### Technique 2: Quantized Opacity Buckets

Sort stamps by opacity bucket to minimize `globalAlpha` changes:

```typescript
function renderStampBrushBucketed(
  ctx: CanvasRenderingContext2D,
  placements: StampPlacement[],
  stampVariants: ImageBitmap[], // Pre-rendered at different opacities
  config: PenConfig,
  style: PenStyle,
): void {
  const bucketCount = stampVariants.length;
  const halfW = stampVariants[0].width / 2;
  const halfH = stampVariants[0].height / 2;

  // Group placements by opacity bucket
  const buckets: StampPlacement[][] = Array.from({ length: bucketCount }, () => []);
  for (const p of placements) {
    const opacity = pressureToOpacity(p.pressure, config, style);
    const bucket = Math.min(bucketCount - 1, Math.floor(opacity * bucketCount));
    buckets[bucket].push(p);
  }

  ctx.save();
  ctx.globalAlpha = 1; // Opacity is baked into variants

  for (let b = 0; b < bucketCount; b++) {
    const variant = stampVariants[b];
    for (const p of buckets[b]) {
      const size = pressureToSize(p.pressure, config, style);
      const scale = size / variant.width;
      const jitter = (Math.random() - 0.5) * 0.18;
      const cos = Math.cos(jitter) * scale;
      const sin = Math.sin(jitter) * scale;
      ctx.setTransform(cos, sin, -sin, cos, p.x, p.y);
      ctx.drawImage(variant, -halfW, -halfH);
    }
  }

  ctx.restore();
}
```

**Caveat**: This changes the draw order. For pencil strokes where stamps overlap and blend, the visual result may differ from sequential rendering. Only use this if the visual difference is acceptable (it usually is for pencil, since the stamps are semi-transparent and small).

### Technique 3: Future -- Batch drawImage API

The [Canvas 2D batch drawImage proposal](https://github.com/fserb/canvas2D/blob/master/spec/batch-drawimage.md) (by Fernando Serboncini, part of WHATWG spec discussions) introduces methods like:

```typescript
// Draw same image at multiple positions
ctx.drawImagePositionBatch(source, new Float32Array([x1,y1, x2,y2, x3,y3, ...]));

// Draw with per-stamp destination rectangles
ctx.drawImageDestRectBatch(source, new Float32Array([x1,y1,w1,h1, x2,y2,w2,h2, ...]));

// Draw with per-stamp full transforms (6 matrix values per stamp)
ctx.drawImageTransformBatch(source, new Float32Array([sx,sy,sw,sh, a,b,c,d,e,f, ...]));
```

Experiments show **3-5x performance improvement** over sequential `drawImage` calls. However, this API is not yet widely implemented in browsers. It is worth monitoring for future adoption.

### Technique 4: Render Stamps to OffscreenCanvas, Composite Once

For tile-based rendering (which ObsidianPaper already uses), stamps can be rendered to an OffscreenCanvas in a Web Worker, then the finished tile is composited to the display canvas in a single `drawImage()` call:

```typescript
// In worker:
function renderStrokeTile(
  offCtx: OffscreenCanvasRenderingContext2D,
  strokes: Stroke[],
  stampBitmap: ImageBitmap,
  tileRect: { x: number, y: number, w: number, h: number },
): void {
  // Render all stamps for all strokes within this tile
  for (const stroke of strokes) {
    const placements = computePlacements(stroke, stampBitmap.width * 0.15);
    for (const p of placements) {
      // Only render if within tile bounds (with margin for stamp size)
      if (isInTile(p, tileRect, stampBitmap.width)) {
        // ... setTransform + drawImage as above
      }
    }
  }
}

// On main thread:
ctx.drawImage(workerTileBitmap, tileX, tileY); // Single call per tile
```

This is the most scalable approach and aligns well with the existing `WorkerTileScheduler` architecture.

---

## 9. Integration with Current Architecture

### Where Stamp Rendering Fits

The current architecture has a `RenderPipeline` type with values `"basic" | "textures" | "stamps"`. The `"stamps"` pipeline is already defined in the type system but not yet implemented. This is where stamp-based rendering would live.

### Proposed Integration Points

1. **`StrokeRenderCore.ts`**: Add a `renderStrokeWithStamps()` function alongside the existing `renderStrokeWithGrain()`. The pipeline check at line 102 already branches on pipeline type.

2. **`PenConfigs.ts`**: Add stamp-specific config to `PenConfig`:
   ```typescript
   stamp?: {
     size: number;          // Base stamp size in pixels
     spacing: number;       // Spacing as fraction of diameter (0.1 = 10%)
     spacingJitter: number; // Random spacing variation (0-1)
     rotationJitter: number;// Random rotation range in radians
     scatterX: number;      // Lateral scatter (perpendicular to stroke)
     scatterY: number;      // Linear scatter (along stroke)
   };
   ```

3. **`GrainTextureGenerator.ts`**: Could be extended to generate stamp textures instead of (or in addition to) tiling patterns. The existing simplex noise infrastructure is useful for stamp grain content.

4. **Worker integration**: Stamp bitmaps can be transferred to workers via `ImageBitmap` (transferable). The worker renders stamps to its `OffscreenCanvas` tile, then transfers the result back.

### Compatibility with Current Grain System

The stamp-based approach can **replace** the current grain overlay system for pencil strokes, or **complement** it:
- **Replace**: Each stamp already contains grain texture; no need for a separate `destination-out` pass.
- **Complement**: Use stamps for the primary stroke, then apply a lighter grain overlay for additional paper-texture effect.

The replacement approach is simpler and more performant (eliminates the offscreen isolation pass currently needed for per-stroke grain).

---

## Sources

- [Optimizing Canvas - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [Canvas drawImage + setTransform Performance](https://github.com/egaoneko/til/blob/master/Canvas/drawImage-and-setTransform-performance.md)
- [OffscreenCanvas - web.dev](https://web.dev/articles/offscreen-canvas)
- [Batch drawImage Proposal - fserb/canvas2D](https://github.com/fserb/canvas2D/blob/master/spec/batch-drawimage.md)
- [Canvas Batch drawImage - WHATWG Wiki](https://wiki.whatwg.org/wiki/Canvas_Batch_drawImage)
- [Optimising HTML5 Canvas Rendering - AG Grid](https://blog.ag-grid.com/optimising-html5-canvas-rendering-best-practices-and-techniques/)
- [Brush Studio Settings - Procreate Handbook](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
- [Brush Tips - Krita Manual](https://docs.krita.org/en/reference_manual/brushes/brush_settings/brush_tips.html)
- [Pixel Brush Engine - Krita Manual](https://docs.krita.org/en/reference_manual/brushes/brush_engines/pixel_brush_engine.html)
- [CanvasRenderingContext2D.setTransform - MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/setTransform)
- [Arc-Length Parameterization of Bezier Curves - fjorge](https://www.fjorge.com/insights/blog/can-bezier-curves-be-quickly-parameterized-by-arc-length/)
- [Pen Pressure Curve Customization - Toon Boom Harmony](https://docs.toonboom.com/help/harmony-25/premium/drawing/about-pen-pressure-feel.html)
- [Canvas drawImage Performance - Swizec](https://swizec.com/blog/livecoding-16-canvasdrawimage-performance-is-weird-but-magical/)
- [GPU Acceleration in Canvas 2D - Chrome DevBlog](https://developer.chrome.com/blog/taking-advantage-of-gpu-acceleration-in-the-2d-canvas)
- [globalAlpha - MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalAlpha)
