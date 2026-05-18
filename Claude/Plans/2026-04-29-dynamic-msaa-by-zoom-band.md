# Dynamic MSAA By Zoom Band

## Problem

iPad still crashes occasionally at deep zoom even after the adaptive `tileWorldSize`
fix shipped on 2026-04-25. Each MSAA tile carries ~5× the GPU memory of a non-MSAA
tile (4× multisampled color renderbuffer + multisampled stencil + resolve texture),
and at the deepest zoom bands the per-tile size hits the 1024² cap on iPad — so each
allocation is ~24 MB instead of ~5 MB. Even with the `maxTilePhysical: 1024` cap, the
sum across the visible viewport plus overscan is enough to occasionally trip WebKit's
GPU watchdog.

MSAA was added because thin strokes were disappearing or going gappy when zoomed out
(stencil-based `fillPath` has no sub-pixel coverage). At high zoom, strokes are
already several pixels wide on screen, so sub-pixel coverage adds little perceptual
quality. The hypothesis: we can disable MSAA above a threshold zoom band and recover
~80% of the per-tile memory cost where it hurts most, with no visible regression.

## Goal

Allocate each WebGL tile with MSAA on or off based on the zoom band it's being
rendered at. Below the threshold (zoomed out) keep 4× MSAA; at or above the threshold
(zoomed in) drop to 0 samples, using only the stencil renderbuffer for fillPath.

## Non-goals

- Variable sample counts (e.g., 2× at intermediate bands). Binary on/off keeps the
  change small and the code paths already exist.
- Removing MSAA entirely. We still need it at default and zoomed-out levels — that's
  the whole reason it was added.
- Re-deriving `maxTilePhysical` or `tileWorldSize`. The 2026-04-25 fix stays.
- Any change to the active-stroke Canvas 2D path (it doesn't use MSAA).

## Threshold choice

Default: **disable MSAA at zoom band ≥ 4** (zoom ≈ 4× and above).

Rationale:
- Band 0–3 covers zoom 0.5×–2.83×. Strokes are 1–3 px wide on screen here; MSAA
  matters most.
- Band 4 starts at zoom 4×. A 1.5 px logical stroke is already 6 px on screen — well
  above the threshold where stencil aliasing is visible.
- Band 6 (the iPad-cap zone, 8× zoom) is firmly past the point where MSAA helps but
  is the worst memory pressure zone. We want to be already-disabled by then.

The threshold is a tunable constant; see "Settings" below for whether it gets a UI
knob in v1.

## Architecture

The cleanest insertion point is `WebGLTileCache.allocate()`: it already receives
`zoomBand`, and tiles are already re-allocated when band changes. So the MSAA
toggle naturally rides on the existing cache-lifecycle machinery.

Two pieces of state need to flow through:
1. **The cache needs to know the threshold** so it can decide MSAA on/off per
   allocation.
2. **The tile entry needs to know which mode it was allocated in** so a later
   re-allocation at the same size can detect a mode mismatch and rebuild the FBO.

We already have `entry.msaa: GLMSAAOffscreenTarget | null` and `entry.fbo:
GLOffscreenTarget | null` — the mode is implicit in which one is non-null. We just
need to compare against the desired mode for the new band.

## Changes

### 1. `src/canvas/tiles/WebGLTileCache.ts` — per-allocation MSAA decision

Replace the constructor signature to take a threshold band in addition to base
sample count:

```typescript
constructor(
  gl: WebGL2RenderingContext,
  config: TileGridConfig,
  msaaSamples = 4,
  msaaMaxBand = Infinity,  // disable MSAA at bands strictly above this
)
```

Add a private helper:

```typescript
private samplesForBand(band: number): number {
  return band > this.msaaMaxBand ? 0 : this.msaaSamples;
}
```

Update `allocate()` to use `samplesForBand(zoomBand)` instead of `this.msaaSamples`:

- The new-entry branch (lines 117–149) picks `createMSAAOffscreenTarget` when
  `samples > 0`, else `createOffscreenTarget`.
- The existing-entry size-changed branch (lines 90–104) currently only re-allocates
  if `textureWidth !== tilePhysical`. **Add a second condition**: re-allocate when
  the desired MSAA mode differs from the entry's current mode. Specifically:
  ```
  const desiredSamples = this.samplesForBand(zoomBand);
  const wantsMSAA = desiredSamples > 0;
  const hasMSAA = entry.msaa !== null;
  const sizeChanged = entry.textureWidth !== tilePhysical;
  if (sizeChanged || wantsMSAA !== hasMSAA) {
    // destroy + reallocate path
  }
  ```
- `allocateEntryTarget()` needs the desired sample count too, so it should take
  `samples: number` as a parameter rather than reading `this.msaaSamples`.

The size-changed path already calls `destroyEntry()` (lines 258–267) which routes
to `destroyMSAAOffscreenTarget` or `destroyOffscreenTarget` based on which one is
populated, so cleanup is correct without further changes.

### 2. `src/canvas/Renderer.ts` — pass the threshold

Both `new WebGLTileCache(gl, config, 4)` sites are inside `TiledStaticLayer`'s
constructor (lines 1568, 1619 — the second is in the WebGL context-restored
handler). Add a fourth argument:

```typescript
this.glCache = new WebGLTileCache(gl, config, 4, MSAA_MAX_BAND);
```

Define `MSAA_MAX_BAND` as a module-level constant (with a brief comment explaining
why band 3 is the cutoff). The same constant value is used on iPad and desktop —
the iPad-specific safety is already handled by `maxTilePhysical: 1024` in
`enableTiling`. Picking band 3 means desktops also save memory at high zoom, which
is harmless.

### 3. `src/canvas/tiles/WebGLTileCache.ts` — tighten memory accounting (small bonus)

Today `memoryBytes = tilePhysical² × 4` regardless of MSAA. With MSAA the real cost
is roughly:

- Resolve texture: `tilePhysical² × 4`
- Multisampled color RB: `tilePhysical² × 4 × samples`
- Multisampled stencil RB: `tilePhysical² × 1 × samples`

So MSAA tiles cost about `tilePhysical² × (4 + 5×samples)` bytes — roughly 6×
without MSAA. Without MSAA the cost is `tilePhysical² × 5` (color + stencil-only
RB).

Update the calc inline at the two `newMemory = ...` sites (lines 96, 114) so
eviction sees real pressure. This isn't strictly required for the feature to work,
but it's a small change that makes the eviction policy correct, and it'll surface
the new memory savings in `memoryUsage` for the diagnostic overlay.

### 4. `__mocks__/obsidian.ts` and tests

If any existing tests instantiate `WebGLTileCache`, the new optional parameter is
backwards-compatible (defaults to `Infinity`). No mock changes expected.

Add a unit test in a new file `src/canvas/tiles/WebGLTileCache.test.ts` (or extend
an existing one if present) covering:

- Allocating at band 0 with `msaaMaxBand: 3` produces an `entry.msaa !== null` tile.
- Allocating at band 4 with `msaaMaxBand: 3` produces an `entry.msaa === null,
  entry.fbo !== null` tile.
- Re-allocating an existing band-0 tile at band 4 destroys the MSAA target and
  rebuilds as a non-MSAA target (size unchanged, mode changed).

This needs a mock WebGL2 context. If one doesn't already exist in the repo, the
test can be skipped — the visual A/B is the real validation, and the logic is small
enough to verify by inspection.

## Settings

**v1: hardcoded threshold, no UI.** Ship the change with `MSAA_MAX_BAND = 3` and
the code change behind a constant. The user wants to test "whether it actually
fixes the problem"; hardcoded gives the cleanest signal, and it's a one-line revert
if it regresses.

**v1.5 (optional, later):** Add `dynamicMSAAEnabled: boolean` (default true) and a
toggle in the rendering section of `PaperSettingsTab`. Useful only if v1 lands and
we want users to A/B; skip otherwise.

Not adding a numeric "MSAA threshold band" setting. That's too low-level for users
and bakes in implementation detail.

## Validation

Build, test, deploy via `yarn build && yarn test && yarn build:copy`, then on iPad:

1. **Visual A/B at multiple zooms.** Open a doc with thin strokes (1.0 width,
   pencil). Compare zoom 1×, 2×, 4×, 8× with the change vs. without. The
   regression to watch for: strokes that look acceptably smooth at zoom 4×–16×
   without MSAA. If strokes look pixelated or "edgy" at zoom 4×, raise the
   threshold to band 4 (= zoom 5.66×+).

2. **Memory pressure at deep zoom.** With the diagnostic overlay (per
   `Claude/Research/2026-04-25-ipad-crash-investigation.md`), zoom in past 8× and
   observe the GPU memory estimate. Should be ≤25% of the pre-change reading once
   tiles in the visible region are all post-threshold.

3. **Crash repro.** The user's "occasional crash during writing session" is hard
   to reliably reproduce on demand. Test passes if a normal writing session over
   the next 1–2 days has no crashes (the prior baseline was "at least once per
   session"). This is the load-bearing validation; the others are sanity checks.

## Risks

- **Visible quality drop.** If MSAA-off strokes look noticeably worse at zoom 4×,
  the threshold needs to move up. Easy fix: change one constant.
- **Stencil renderbuffer also contributes to OOM.** Disabling MSAA still leaves a
  per-tile stencil RB (needed for fillPath). It's much cheaper than MSAA but
  non-zero. If the iPad still crashes after this change, the next move is dropping
  the stencil too at high zoom and rendering thick strokes via plain triangle fans
  — that's a separate plan.
- **Cache hit rate during tuning.** Each change to `MSAA_MAX_BAND` invalidates the
  user's tile cache on next session. Not a real cost — tiles re-render lazily —
  but worth noting.
- **The mode-mismatch re-allocation in `allocate()`.** If we forget to add the
  `wantsMSAA !== hasMSAA` check, then a tile that was originally MSAA but is now
  being re-rendered above the threshold would keep its MSAA target and we'd save
  no memory. Conversely, a non-MSAA tile being re-rendered below the threshold
  would render fine but without antialiasing. The unit test for the
  re-allocation path catches both.

## Out of scope

- Changing how active strokes render (they're Canvas 2D and unaffected).
- Adjusting `MAX_SHARP_ZOOM` or `tileWorldSize`. Those are independent levers.
- Migrating away from stencil-based fillPath. That's a much bigger change, and the
  whole reason MSAA was added in the first place.
