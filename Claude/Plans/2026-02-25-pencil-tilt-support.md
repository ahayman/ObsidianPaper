# Pencil Tilt Support

## Context

Apple Pencil tilt data (tiltX/tiltY) is captured, stored, and persisted — but has zero effect on rendering. The old approach (widening the stroke outline via `tiltSensitivity` in PenEngine) was disabled because it created "visible ovals" in stamp-based rendering. This plan implements tilt support directly in the stamp scatter distribution, which is the right layer for this effect.

**Target pens:** Pencil (full tilt scatter) and Felt-tip (lighter version). Other pens unchanged.

## Two-Mode Tilt Behavior

1. **Skew mode** (tilt < tolerance): Dot cluster shifts opposite to tilt direction. Writing feels normal but the "graphite" deposits slightly off-center, like a real pencil held at an angle.

2. **Shading mode** (tilt > tolerance + transition): Stroke widens dramatically, dots distribute evenly along the tilt axis. Mimics holding a pencil on its side for broad, light shading strokes.

Smooth blend between modes over a configurable transition range (no hard cutoff).

## Files to Modify

### 1. `src/stroke/PenConfigs.ts` — Add tilt config

Add `PenTiltConfig` interface and `tiltConfig` field to `PenConfig`:

```typescript
export interface PenTiltConfig {
  tolerance: number;        // Degrees below which only skew applies (30)
  transitionRange: number;  // Degrees of blend between modes (15)
  maxWidthMultiplier: number; // Max width scale at full shading (3.5)
  opacityReduction: number;   // Max opacity reduction at full shading (0.4)
  maxSkewOffset: number;      // Max skew as fraction of radius (0.4)
}
```

- Pencil: full config `{ tolerance: 30, transitionRange: 15, maxWidthMultiplier: 3.5, opacityReduction: 0.4, maxSkewOffset: 0.4 }`
- Felt-tip: lighter config `{ tolerance: 35, transitionRange: 15, maxWidthMultiplier: 2.0, opacityReduction: 0.2, maxSkewOffset: 0.3 }`
- All others: `tiltConfig: null`

### 2. `src/stamp/StampRenderer.ts` — Core tilt scatter logic

**Add `TiltInfo` interface and `computeTiltInfo()` helper:**

```typescript
interface TiltInfo {
  magnitude: number;    // 0-70 degrees
  angle: number;        // radians, direction of tilt
  shadingBlend: number; // 0 = skew mode, 1 = shading mode
}
```

**Modify `emitScatter()`** to accept optional `TiltInfo` and an optional `PenTiltConfig`:

- **Skew mode** (shadingBlend ≈ 0): Offset scatter center opposite to tilt direction. Offset = `(magnitude / tolerance) * radius * maxSkewOffset`. Same particle count and distribution shape.
- **Shading mode** (shadingBlend ≈ 1):
  - Scatter region becomes an ellipse aligned to tilt axis
  - Major axis = `radius * maxWidthMultiplier`, minor axis ≈ original radius
  - Distribution shifts from center-biased (`pow(h, 0.8)`) toward uniform (`pow(h, 0.5)`)
  - Particle count scales up by `(1 + 2 * shadingBlend)` to fill wider area
  - Per-particle opacity reduced by `(1 - opacityReduction * shadingBlend)`
  - Skew offset fades out as shading kicks in

**Modify `computeStamps()` and `computeAllStamps()`**: At each walk step, compute `TiltInfo` from the interpolated point's tiltX/tiltY (already interpolated by `interpolatePoint()`) and pass to `emitScatter()`.

### 3. `src/stroke/StrokeBuilder.ts` — Smooth tilt values

Add two `EMAFilter` instances for tiltX and tiltY (alpha = 0.4). Raw tilt from the Apple Pencil can be jittery; smoothing prevents the scatter distribution from jumping frame-to-frame.

```typescript
private tiltXFilter: EMAFilter;
private tiltYFilter: EMAFilter;
```

Update `addPoint()` to filter tilt, and `discard()` to reset the filters.

### 4. `src/stamp/StampRenderer.test.ts` — Tests

- Skew mode: center of mass shifts opposite to tilt direction
- Shading mode: stamp spread is wider than untilted strokes
- Shading mode: more particles than untilted
- Shading mode: lower average per-particle opacity
- Determinism: same input produces same stamps with tilt
- `tiltConfig: null` produces identical output regardless of tilt values
- Felt-tip config produces less dramatic widening than pencil

## What Does NOT Change

- `drawStamps()` — draws stamps as circles at given positions, no changes needed
- `PenEngine.ts` — the old `tiltSensitivity` approach stays disabled (0)
- `StrokeRenderCore.ts` / `tileWorker.ts` / `Renderer.ts` — call `computeAllStamps()` which handles tilt internally; stamp output format unchanged
- `PointEncoder.ts` / `Serializer.ts` — tilt already encoded/decoded correctly
- `InputManager.ts` — tilt already captured with altitudeAngle/azimuthAngle fallback

## Rendering Path Consistency

Both paths use the same `computeAllStamps()` → `drawStamps()` pipeline:
- **Active stroke** (Renderer.ts): Quantized points with tilt, drawn incrementally
- **Baked stroke** (StrokeRenderCore.ts, tileWorker.ts): Decoded points with tilt from storage

Deterministic hash-based scatter ensures active and baked always match.

## Implementation Order

1. Add `PenTiltConfig` to PenConfigs.ts, set configs for pencil and felt-tip
2. Add tilt smoothing to StrokeBuilder.ts
3. Implement tilt scatter in StampRenderer.ts (computeTiltInfo, modify emitScatter, thread through compute functions)
4. Write tests in StampRenderer.test.ts
5. `yarn build && yarn test && yarn build:copy` → iPad testing

## Tuning Parameters

All values are initial guesses to refine during iPad testing:

| Parameter | Pencil | Felt-tip | Purpose |
|-----------|--------|----------|---------|
| tolerance | 30° | 35° | Below this: skew only |
| transitionRange | 15° | 15° | Blend width between modes |
| maxWidthMultiplier | 3.5x | 2.0x | Max shading width |
| opacityReduction | 0.4 | 0.2 | Lighter shading appearance |
| maxSkewOffset | 0.4 | 0.3 | Skew shift strength |
| EMA alpha (tilt smooth) | 0.4 | 0.4 | Jitter reduction |
