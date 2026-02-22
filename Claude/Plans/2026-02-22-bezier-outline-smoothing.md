# Bézier Curve Smoothing for Outline Path

## Problem

Thin cross-strokes (along the thin nib edge) appear jagged/bumpy because `outlineToPath2D()` connects outline points with straight `lineTo` segments. At narrow widths, small angular differences between consecutive points create visible zigzag.

## Fix

Replace `lineTo` with **midpoint quadratic Bézier curves** in `outlineToPath2D()`. Each outline point becomes a Bézier control point; midpoints between consecutive points become curve endpoints. This produces a C1-continuous curve that smooths out the zigzag.

## File Change

### `src/stroke/OutlineGenerator.ts` — `outlineToPath2D()`

Replace the lineTo loop with midpoint quadratic Bézier:

```typescript
// Current (straight segments):
path.moveTo(first[0], first[1]);
for (let i = 1; i < outline.length; i++) {
  path.lineTo(outline[i][0], outline[i][1]);
}
path.closePath();

// New (smooth curves):
// Start at midpoint between P0 and P1
// For each point Pi, quadraticCurveTo(Pi, midpoint(Pi, Pi+1))
// Close with quadraticCurveTo(P0, initial midpoint)
```

Fall back to lineTo for outlines with fewer than 3 points.

## What Stays the Same

- `generateItalicOutline()` — outline computation unchanged
- `generateOutline()` — still produces same polygon
- All stamp rendering — unaffected
- All three render sites — they call `generateStrokePath()` which calls `outlineToPath2D()`

## Verification

1. `yarn build` + `yarn test` + `yarn build:copy`
2. Thin cross-strokes should appear smooth instead of jagged
3. Thick strokes should look the same (curves vs lines are indistinguishable at wide widths)
