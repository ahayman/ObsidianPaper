# Perfect-Freehand Outline Algorithm Analysis

## Purpose

Detailed analysis of how the `perfect-freehand` library (v1.2.3) generates stroke outlines, with focus on how it handles sharp direction changes. Comparison with our `ItalicOutlineGenerator.ts` approach to understand differences in self-intersection behavior.

---

## Architecture Overview

perfect-freehand uses a two-phase pipeline:

1. **`getStrokePoints()`** -- Converts raw input points `[x, y, pressure]` into `StrokePoint` objects with computed metadata: streamline-smoothed position, unit vector (direction), segment distance, and cumulative `runningLength`.

2. **`getStrokeOutlinePoints()`** -- Takes the `StrokePoint[]` array and produces a closed polygon `Vec2[]` by computing left/right offset points, handling sharp corners with special cap geometry, and adding start/end caps.

---

## Phase 1: getStrokePoints() -- Input Preprocessing

### Streamline Smoothing (Critical)

The most important preprocessing step is **streamline interpolation**. This happens before any outline generation:

```typescript
// Interpolation factor: higher streamline = more smoothing (lower t)
const t = 0.15 + (1 - streamline) * 0.85
// With default streamline=0.5: t = 0.15 + 0.5 * 0.85 = 0.575
```

Each new point is interpolated toward the previous point:
```typescript
const point = lrp(prev.point, pts[i], t)
// Equivalent to: prev.point + (pts[i] - prev.point) * t
```

This is a **recursive low-pass filter** (exponential moving average on position). With the default `streamline=0.5`, each input point only moves ~57.5% of the way from the previous smoothed point to the raw input point. This has a **massive** smoothing effect on direction changes -- sharp corners in the raw input become rounded curves in the smoothed stroke points.

**Key insight**: This smoothing operates on the *centerline positions* before any outline offset calculation. By the time `getStrokeOutlinePoints()` sees the data, most sharp corners have already been softened. Our `ItalicOutlineGenerator` does not apply streamline smoothing to positions -- it only applies a lightweight RDP de-jitter (`epsilon=0.00125`), which removes noise but preserves sharp corners.

### Vector Computation

The direction vector at each point is computed as:
```typescript
vector = uni(sub(prev.point, point))
// Unit vector from current point TOWARD previous point (reversed direction)
```

Note: the vector points **backward** (from current to previous), not forward. This is important for understanding the offset calculations later.

### Minimum Distance Gate

Points are skipped until the cumulative running length exceeds the stroke `size`:
```typescript
if (i < max && !hasReachedMinimumLength) {
  if (runningLength < size) continue;
  hasReachedMinimumLength = true;
}
```

This eliminates the cluster of near-identical points that typically occurs at the start of a stroke (when the pen is moving slowly), which would otherwise produce extremely noisy direction vectors.

---

## Phase 2: getStrokeOutlinePoints() -- The Core Algorithm

### Offset Calculation for Regular Points

For non-corner points, the offset direction is computed by **interpolating between the current vector and the next vector**, then taking the perpendicular:

```typescript
const nextVector = points[i + 1].vector
const nextDpr = dpr(vector, nextVector)  // dot product

// Interpolate between next and current vectors using the dot product
lrpInto(_offset, nextVector, vector, nextDpr)
// Then rotate 90 degrees
perInto(_offset, _offset)
// Scale by radius
mulInto(_offset, _offset, radius)
```

This is the critical line: `lrp(nextVector, vector, nextDpr)`. Let me unpack what this does:

- `nextDpr` = dot product of current and next direction vectors = `cos(angle_between_them)`
- When vectors are parallel (no turn): `nextDpr = 1.0`, so `lrp` returns `vector` (100% current)
- When vectors are perpendicular (90-degree turn): `nextDpr = 0.0`, so `lrp` returns `nextVector` (0% blend = just next)
- When vectors are opposite (180-degree turn): `nextDpr = -1.0`, so `lrp` returns `2*nextVector - vector`

The result is an **averaged direction** that smoothly transitions between segments. The perpendicular of this averaged direction naturally produces offset points that are somewhere between the incoming and outgoing perpendiculars -- essentially a **built-in miter-like join** for moderate angles.

Left and right points are then:
```typescript
leftPoint = point - offset    // sub(point, offset)
rightPoint = point + offset   // add(point, offset)
```

### Distance-Based Point Skipping (Smoothing Parameter)

After computing offset points, perfect-freehand applies a **minimum distance filter**:

```typescript
const minDistance = (size * smoothing) ** 2  // squared for fast comparison

if (i <= 1 || dist2(prevLeftPoint, tempLeftPoint) > minDistance) {
  leftPts.push(tempLeftPoint)
  prevLeftPoint = tempLeftPoint
}
```

With default `size=16` and `smoothing=0.5`, the minimum distance is `(16 * 0.5)^2 = 64` (8 pixels squared distance). This means offset points that are closer than 8 pixels to the previous accepted point are **dropped entirely**.

This is another layer of smoothing that reduces point density in areas where the outline isn't changing much, and it also helps prevent the jagged back-and-forth of closely-spaced offset points at turns.

### Sharp Corner Detection and Handling (The Key Algorithm)

This is where perfect-freehand fundamentally differs from our approach. It **explicitly detects** sharp corners and handles them with special geometry:

```typescript
const nextVector = (!isLastPoint ? points[i + 1] : points[i]).vector
const nextDpr = !isLastPoint ? dpr(vector, nextVector) : 1.0
const prevDpr = dpr(vector, prevVector)

const isPointSharpCorner = prevDpr < 0 && !isPrevPointSharpCorner
const isNextPointSharpCorner = nextDpr !== null && nextDpr < 0
```

A corner is "sharp" when the **dot product between consecutive direction vectors is negative** -- i.e., the angle between them exceeds 90 degrees (the stroke reverses direction more than a right angle).

When a sharp corner is detected, instead of computing a single left/right offset pair, perfect-freehand **draws a semicircular cap** at that point:

```typescript
if (isPointSharpCorner || isNextPointSharpCorner) {
  // Perpendicular offset from the PREVIOUS vector direction
  perInto(_offset, prevVector)
  mulInto(_offset, _offset, radius)

  // Draw 13 points in a semicircle (PI radians) for BOTH sides
  const step = 1 / 13  // CORNER_CAP_SEGMENTS
  for (let t = 0; t <= 1; t += step) {
    // Left side: rotate (point - offset) around point by PI * t
    subInto(_tl, point, _offset)
    rotAroundInto(_tl, _tl, point, FIXED_PI * t)
    leftPts.push([_tl[0], _tl[1]])

    // Right side: rotate (point + offset) around point by -PI * t
    addInto(_tr, point, _offset)
    rotAroundInto(_tr, _tr, point, FIXED_PI * -t)
    rightPts.push([_tr[0], _tr[1]])
  }

  if (isNextPointSharpCorner) {
    isPrevPointSharpCorner = true  // prevent double-detection
  }
  continue  // skip normal offset computation
}
```

**What this does geometrically**: At a sharp turn, instead of one offset point on each side, it inserts ~14 points per side that trace a semicircle. The left points sweep from the incoming perpendicular to the outgoing perpendicular, and the right points sweep in the opposite direction. This creates a **round join** at the corner.

**Why this prevents self-intersection**: At a sharp turn, the naive perpendicular offsets from the incoming and outgoing segments would cross each other (the left side's incoming offset might be on the right side of the outgoing offset). The semicircular cap smoothly transitions the offset direction through the turn, keeping left points on the left and right points on the right. The circular geometry is guaranteed to be convex, so no self-intersection can occur within the cap.

**The `isPrevPointSharpCorner` flag** prevents the algorithm from detecting the same corner twice on consecutive iterations (since a reversal affects both the "this point looking back" and "previous point looking forward" checks).

---

## Comparison with ItalicOutlineGenerator

### Approach Differences

| Aspect | perfect-freehand | ItalicOutlineGenerator |
|--------|-----------------|----------------------|
| **Centerline smoothing** | Streamline interpolation (recursive EMA on positions, default t=0.575) | RDP de-jitter only (epsilon=0.00125), preserves corners |
| **Direction computation** | Point-to-previous vector (single segment) | Symmetric central difference over +/-2 points |
| **Offset direction** | Interpolated between current and next vectors using dot product | Pure perpendicular to stroke direction |
| **Sharp corner handling** | Explicit detection (dot product < 0) + semicircular cap (14 points per side) | No explicit corner handling; relies on perp smoothing |
| **Perpendicular consistency** | Not needed (direction interpolation handles it) | Flip check against first perpendicular reference |
| **Perpendicular smoothing** | Not needed (streamline + direction interpolation handles it) | Gaussian kernel (+/-3, sigma=1.2) |
| **Width at corners** | Radius computed per-point from pressure, no corner-specific adjustment | Multi-pass "dip elimination" raises width at local minima |
| **Point density control** | Minimum distance filter drops close points | No point filtering (uses all RDP-surviving points) |
| **Output** | Single closed polygon: left + endCap + right.reverse() + startCap | Single closed polygon: left + right.reverse() (or separate sides for quad rendering) |

### Why perfect-freehand Has Fewer Self-Intersection Artifacts

1. **Aggressive streamline smoothing eliminates most sharp corners before offset computation.** With the default `streamline=0.5`, the raw input positions are heavily smoothed. A sharp V-turn in the raw input becomes a rounded U-turn in the stroke points. This alone prevents most of the scenarios that cause self-intersection.

2. **Explicit sharp corner detection with round cap insertion.** Even after streamline smoothing, if a corner is still sharp enough (dot product < 0), perfect-freehand replaces the single offset pair with a semicircular arc of ~14 points. This geometrically cannot self-intersect.

3. **Direction interpolation at regular points.** The `lrp(nextVector, vector, nextDpr)` computation produces an averaged offset direction that naturally creates miter-like joins at moderate angle changes, preventing the "perpendicular flip" problem.

4. **Minimum distance point filtering.** Dropping offset points that are too close to the previous accepted point removes the rapid oscillation patterns that can occur when many closely-spaced centerline points have slightly different perpendiculars.

### Why ItalicOutlineGenerator Is More Susceptible

1. **No centerline position smoothing.** The RDP de-jitter is extremely conservative (epsilon=0.00125). Sharp corners are preserved in the centerline, meaning the perpendicular direction changes abruptly at corners.

2. **No explicit corner detection.** The algorithm treats every point the same way -- compute perpendicular, apply Gaussian smoothing, generate offset. There is no mechanism to detect "this is a sharp corner that needs special geometry."

3. **Fixed perpendicular reference for consistency.** The flip-check against the first perpendicular (lines 154-164) prevents gradual perpendicular drift but cannot handle a genuine 180-degree turn. When the stroke actually reverses direction, the perpendicular should legitimately flip, but the reference-based check prevents this.

4. **Perpendicular smoothing is insufficient for sharp corners.** The Gaussian kernel with radius=3 spreads the perpendicular transition over ~7 points. This helps with gradual curves but cannot prevent crossover at a truly sharp corner where the perpendicular should rotate 180 degrees over 1-2 points.

---

## Summary: What ItalicOutlineGenerator Could Borrow

### High-Impact Changes

1. **Explicit sharp corner detection + round cap insertion.** Detect when `dot(dir[i], dir[i+1]) < 0` (or some threshold like `< 0.2`), and insert a semicircular arc of offset points at the corner. This is the single most effective technique in perfect-freehand for preventing self-intersection.

2. **Direction interpolation for offset computation.** Instead of taking the pure perpendicular of the stroke direction at each point, interpolate between the current and next direction vectors (weighted by their dot product) before computing the perpendicular. This creates natural miter-like joins at moderate turns.

### Medium-Impact Changes

3. **Minimum distance filtering on outline points.** After computing offset positions, skip points that are within some minimum distance of the previous accepted point. This reduces density in areas where the outline is changing slowly and prevents rapid oscillation at near-zero-length segments.

### Low-Impact / Not Applicable

4. **Streamline smoothing on centerline positions.** This would fundamentally change the character of the italic stroke by rounding off the sharp corners that give calligraphic writing its character. For italic/fountain pen strokes, corner sharpness is a feature, not a bug. However, a very mild version (lower than perfect-freehand's default) could be worth exploring.

### Important Caveat

Perfect-freehand **does still produce self-intersecting outlines** -- the library's own documentation acknowledges this and recommends `polygon-clipping` for cleanup. The techniques above reduce the frequency and severity of self-intersections but do not eliminate them entirely. The quad-per-segment rendering approach (already implemented in `italicSidesToPath2D`) remains the most robust solution for preventing fill-rule artifacts.

---

## Appendix: Full Source Reference

The complete decompiled source of `getStrokeOutlinePoints` and `getStrokePoints` was extracted from the source map at:
`/Users/aaronhayman/Projects/ObsidianPaper/node_modules/perfect-freehand/dist/esm/index.mjs.map`

The ItalicOutlineGenerator source is at:
`/Users/aaronhayman/Projects/ObsidianPaper/src/stroke/ItalicOutlineGenerator.ts`
