# Soft Stamp Textures + Alpha Dithering for Ink Banding Reduction

## Problem

Ink stamps are nearly-solid circles (alpha=1.0 across the disc, 2-pixel AA edge). When overlapping stamps accumulate via source-over, hard edges create visible banding — you can see each stamp's boundary as a discrete step in opacity.

## Approach

Two zero-cost techniques applied together:

1. **Soft stamp texture**: Replace the hard disc with a Gaussian falloff profile so stamp edges blend smoothly into each other.
2. **Alpha dithering**: Add small random noise to per-stamp opacity to break up uniform accumulation steps.

Both changes are computed once (texture) or per-stamp (one hash), with no additional draw calls or GPU operations.

---

## File Changes

### 1. `src/stamp/InkStampTexture.ts` — Gaussian falloff profile

Replace the current hard-edge alpha computation (lines 72-77) with a Gaussian profile:

**Current:**
```typescript
if (dist <= solidRadius) {
  alpha = 1.0;
} else {
  alpha = 1.0 - smoothstep(solidRadius, radius, dist);
}
```

**New:**
```typescript
const r = dist / radius;  // normalized 0-1
alpha = Math.exp(-r * r / (2 * SIGMA * SIGMA));
```

Where `SIGMA = 0.45` (tunable). This gives:
- Center (r=0): alpha = 1.0
- Mid (r=0.5): alpha ≈ 0.72
- Edge (r=0.8): alpha ≈ 0.30
- Boundary (r=1.0): alpha ≈ 0.08 (near-zero, natural fade)

No AA band needed — the Gaussian itself provides smooth falloff to near-zero at the edge.

Remove `aaWidth` and `solidRadius` variables (no longer needed). Keep `smoothstep` function (still used elsewhere or remove if unused).

The `edgeDarkening` config field becomes unused by this change but can stay in the interface for now (it was already effectively unused since we removed the donut profile).

Grain modulation continues to apply on top of the Gaussian profile — multiply grain into alpha after the falloff, same as current code.

### 2. `src/stamp/InkStampRenderer.ts` — Alpha dithering

In `computeInkStamps()`, after computing `deposit` (line 138), add opacity jitter:

```typescript
const deposit = Math.max(0.01, presetConfig.baseOpacity - speedFactor * SPEED_REDUCTION * presetConfig.shading);

// Alpha dithering: ±10% random variation to break up uniform accumulation banding
const dither = 1.0 + (hashFloat(stampCount, 0x6A09E667) - 0.5) * 0.2;
const jitteredDeposit = Math.max(0.01, deposit * dither);
```

Then use `jitteredDeposit` instead of `deposit` in the stamp push (line 159):

```typescript
stamps.push({
  // ...
  opacity: jitteredDeposit,
  // ...
});
```

This uses the existing `hashFloat` function (already imported) with a new seed constant. The `0.2` multiplier gives ±10% variation — enough to break up banding without causing visible noise.

### 3. `src/stamp/InkPresets.ts` — Potential opacity retuning

The Gaussian falloff means each stamp deposits less ink at its edges than the current hard disc. The effective center opacity is the same (1.0), but the integrated area under the curve is smaller. This may make strokes slightly lighter overall.

**If strokes appear too light after testing**, bump `baseOpacity` values up slightly:
- standard: 0.22 → 0.26
- shading: 0.18 → 0.22
- iron-gall: 0.25 → 0.28
- flat-black: 0.35 → 0.40

**Hold off on this change until visual testing** — the current values may be fine since the ~7 overlapping stamps at center still accumulate near the Gaussian peak where alpha ≈ 1.0.

---

## What Stays the Same

- `drawInkShadingStamps()` — draws stamps identically, just with softer texture and varied opacity
- `InkStampTextureConfig` interface — `size` and `grainInfluence` still used; `edgeDarkening` becomes unused but harmless
- `StampCache` color recoloring — works on any alpha pattern
- All three render sites (StrokeRenderCore, tileWorker, Renderer) — no changes needed
- Stamp placement, spacing, sizing logic — unchanged
- Pencil stamp texture (`StampTexture.ts`) — unaffected, separate system

---

## Verification

1. `yarn build` — type checks pass
2. `yarn test` — all tests pass
3. `yarn build:copy` — deploy to local vault
4. **Manual testing on iPad:**
   - Banding should be significantly reduced or eliminated
   - Slow vs fast shading contrast should be preserved
   - All four ink presets should have distinct character
   - If strokes appear too light, bump `baseOpacity` values (see section 3)
