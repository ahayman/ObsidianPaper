# De-jitter Stroke Centerline Before Outline Generation

## Problem

Slow thin cross-strokes are jagged because hand tremor creates micro-jitter in the input points. The outline faithfully represents this jittery path. Post-smoothing the outline points (approach C) helps but doesn't fully fix it because the centerline itself is bumpy.

## Fix

Smooth the x,y coordinates of input points at the start of `generateItalicOutline()` before any outline computation. Pressure, twist, tilt, and timestamp are preserved unchanged so dynamics are unaffected.

## File Change

### `src/stroke/ItalicOutlineGenerator.ts`

1. Add `smoothPoints()` function that creates a copy of the points with smoothed x,y using multiple passes of [0.25, 0.5, 0.25] kernel (endpoints anchored). ~8 passes for effective de-jittering.

2. Call it at the top of `generateItalicOutline()` before the main loop.

3. Reduce outline point smoothing from 8 passes to 2 (light secondary pass — the heavy lifting is now done on the centerline).

## What Stays the Same

- All other outline logic (width, pressure, taper, EMA)
- Active drawing feel (smoothing only at render time)
- Stamp rendering — unaffected
- outlineToPath2D Bézier curves — still provides curve-level smoothing
