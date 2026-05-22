# Felt Pen — Ink Build-Up via a Particle-Flow Brush

**Date:** 2026-05-22
**Status:** Implemented 2026-05-22 — Phases 1 & 3 done (build + 78 test suites green,
deployed). Phase 2 (on-device tuning of `MarkerScatterConfig`) pending feedback.
**Supersedes:** `2026-05-22-felt-pen-fiber-world-anchor.md` — the fiber-overlay
machinery that plan world-anchored is removed entirely here.
**Research:** `Claude/Research/2026-05-22-felt-pen-ink-buildup-flow-model.md`

## Goal

Make the felt pen deposit ink like a real marker: a stroke that crosses over
itself (shading) **builds up and darkens**, and the texture is something the pen
*deposits*, not a static image revealed beneath it. Match the behavior the
pencil already has.

## Diagnosis (summary — see research doc)

The felt pen is rendered as an **"opacity" / "glaze" brush**: all its stamps go
into an offscreen isolation buffer, which is composited back once. The buffer
caps within-stroke alpha, so self-overlap does nothing — etch-a-sketch behavior.
Its fiber texture is a single tiled noise image carved out with `destination-out`
— literally one static underlay, not deposited ink.

The pencil is a **"flow" brush**: many low-alpha particles composited
`source-over` with **no isolation**. Overlap — including a stroke crossing
itself — accumulates. Its grain is a world-space function sampled *per particle*
and baked into per-particle alpha, so the texture is part of the ink, survives
overlap, and is identical in the Canvas2D (active) and WebGL (baked) paths.

The fix is to make the felt pen a flow brush too.

## Approach

**Rebuild the felt pen as a particle-scatter flow brush that renders through the
pencil's existing `stampDiscs` path.** The felt pen becomes "a denser, more
opaque, chisel-footprint pencil with a marker grain." No isolation; build-up is
just `source-over`. The texture is per-particle world-anchored alpha — deposited,
consistent, and identical active vs. baked because it lives in the particle data.

Rendering reuses `drawStampDiscs` (hard SDF discs on WebGL, `arc()` on Canvas2D)
unchanged — only the *particle generation* is new. This is the user's own
intuition: apply the felt-pen texture the same way the pencil applies its dots.

### 1. Marker scatter computation (new)

New `src/stamp/MarkerScatterRenderer.ts` — `computeAllMarkerScatter(points, style,
penConfig, config)` producing the same particle format the pencil emits
(`StampParams` → packed `[x, y, size, opacity]`), modeled on
`StampRenderer.computeStamps` / `emitScatter`:

- Walk the path arc-length; at each step emit a scatter of particles filling the
  **chisel footprint** — a rotated rectangle (`length L × width L/aspectRatio`),
  rotated to the Apple Pencil azimuth (from tilt; falls back to a static angle,
  same as the current `computeStampRotation`). Footprint size scales with
  pressure-driven width, as the pencil's does.
- Distribute particles **uniformly** across the footprint (not the pencil's
  center-bias) so a single straight pass has ~constant overlap count and stays
  even; a self-crossing point gets twice the particles and darkens.
- Per-particle alpha = `flow × markerGrain(worldX, worldY) × depletion ×
  pressureFactor`, where `flow` is low (single pass lands at a moderate opacity,
  leaving headroom for build-up).
- Calligraphic thick/thin falls out for free: footprints swept perpendicular to
  the chisel's long axis cover a broad band; parallel, a thin one.
- Deterministic hashing (`hashFloat(particleIndex, seed)`, as the pencil does) so
  the active and baked paths generate identical particles.
- Carry over **ink depletion** (the dry-marker exponential falloff) as a
  per-particle opacity multiplier.
- Fold `style.opacity` into per-particle alpha here (see §4) so both backends
  agree without relying on `setAlpha`.

### 2. Marker grain (new, world-anchored)

`computeMarkerGrain(x, y, …)` — a world-space noise function in the same spirit
as `computeGrainOpacity`, but marker-tuned: high base (~0.9), low contrast
(subtle), optionally slightly anisotropic for a faint fiber-streak feel. Sampled
per particle at the particle's **world** position, so overlapping particles
reinforce the same texture and it survives build-up. Fixed world orientation
(world-anchored noise must be — this is required for overlap consistency).

### 3. Material wiring

`resolveMaterial` for felt-tip changes from:
```
body: markerStamps, isolation: true, effects: [fiberOverlay, outlineMask]
```
to the pencil-shaped:
```
body: stampDiscs, blending: source-over, isolation: false, effects: []
```

`prepareStrokeData` / `prepareActiveStrokeData`: the `stampDiscs` branch also
handles felt-tip — when the pen has the marker scatter config, call
`computeAllMarkerScatter` and pack to `stampData`. `StrokeRenderCore`'s Canvas2D
`renderStrokeToContext` gets the analogous felt-tip branch (mirroring the
existing pencil `stamp` branch).

No isolation, no outline mask, no fiber overlay. The stroke edge is the natural
fuzzy boundary of the particle cloud — which is physically correct (real marker
edges are fibrous, not razor-sharp).

### 4. Stroke opacity consistency

`Canvas2DBackend.drawStampDiscs` ignores the backend alpha; `WebGL2Engine`'s
honors `u_alpha`. To keep active == baked, fold stroke opacity into per-particle
alpha in `computeAllMarkerScatter` and set the material `bodyOpacity: 1`. (Verify
and note this; the same latent inconsistency may affect the pencil.)

## What gets removed

The whole `markerStamps` architecture and the fiber overlay (including this
morning's `2026-05-22-felt-pen-fiber-world-anchor` work) become dead and are
deleted:

- `MarkerStampsBody` / `markerStamps` body type and `renderMarkerStampsBody`
- `FiberOverlayEffect` / `fiberOverlay` effect and `applyFiberOverlay`
- `drawMarkerStamps` across `DrawingBackend`, `RenderEngine`, `Canvas2DBackend`,
  `WebGLBackend`, `WebGL2Engine`, `Canvas2DEngine`, `RecordingEngine`
- `applyFiberOverlay` across the same backends/engines; `FIBER_FRAG`, `fiberProg`,
  `MARKER_STAMP_VERT`, `markerStampProg`, `markerStampVAO`; `mat3Invert` if unused
  after; `FIBER_WORLD_SIZE`
- `MarkerStampRenderer.ts`, `MarkerStampTexture.ts`, `MarkerStampTextureManager.ts`
- `packMarkerStampsToFloat32`; `drawMarkerStampsToContext` + `getFiberOverlay`
- marker stamp managers / fiber textures in `Renderer`, `TileRenderer`,
  `WebGLTileEngine`, `MaterialResources` (`getMarkerCache`,
  `getMarkerStampTexture`, `engineFiberTexture`, `markerStampManager`)
- `MarkerStampConfig` → replaced by the new `MarkerScatterConfig`

Net effect is a simplification: the felt pen collapses onto the pencil's
rendering path. `drawStampDiscs` and `STAMP_DISC_FRAG` are reused unchanged.

## Files touched

| File | Change |
|---|---|
| `src/stamp/MarkerScatterRenderer.ts` | **New** — `computeAllMarkerScatter`, `computeMarkerGrain` |
| `src/stroke/PenConfigs.ts` | Replace `MarkerStampConfig` with `MarkerScatterConfig`; retune felt-tip |
| `src/rendering/StrokeMaterial.ts` | felt-tip → `stampDiscs`; remove `MarkerStampsBody`, `FiberOverlayEffect` |
| `src/rendering/StrokeDataPreparer.ts` | `stampDiscs` branch handles the marker scatter config |
| `src/rendering/MaterialExecutor.ts` | Remove `renderMarkerStampsBody`, `applyFiberOverlay`, marker/fiber resource fields |
| `src/canvas/StrokeRenderCore.ts` | felt-tip Canvas2D path mirrors the pencil disc path; delete `drawMarkerStampsToContext` |
| `src/canvas/engine/*`, `src/rendering/*Backend.ts` | Delete `drawMarkerStamps` + `applyFiberOverlay` + fiber shaders/programs |
| `src/stamp/MarkerStamp*.ts` | **Delete** (3 files) |
| `src/stamp/StampPacking.ts` | Remove `packMarkerStampsToFloat32` |
| `src/canvas/Renderer.ts`, `tiles/TileRenderer.ts`, `tiles/WebGLTileEngine.ts`, `rendering/MaterialResources.ts` | Remove marker texture managers / fiber textures |
| Tests | Remove marker/fiber tests (incl. today's `mat3Invert.test.ts` + fiber executor tests); add `MarkerScatterRenderer` tests; regenerate golden-master |

## Implementation phases

1. **Build & wire** — `MarkerScatterRenderer`, `MarkerScatterConfig`,
   `resolveMaterial`/data-prep/`StrokeRenderCore` routing felt-tip through
   `stampDiscs`. After this, the felt pen renders correctly; old code is dead.
2. **Tune on device** — see below.
3. **Delete dead code** — remove the `markerStamps`/fiber machinery listed above.

Phases 1–3 can land as one PR; splitting lets the new look be validated before
the large deletion.

## Tuning (validate on iPad — this is real work, not a footnote)

- **flow** — low enough that a single pass ≈ 0.6–0.75 opacity so shading visibly
  builds; too high → no visible build-up, too low → washed out.
- **particle size vs. count** — small enough for fine texture, few enough for
  performance. Markers tolerate coarser grain than the pencil. Watch particle
  counts on long/wide strokes (WebGL instanced; comparable to dense pencil
  shading, which already performs).
- **marker grain** — start subtle and near-isotropic; add anisotropy only if a
  fiber feel is wanted.
- **edge falloff** — tighter than the pencil's; marker edges are fuzzy but more
  defined than graphite.
- **chisel aspect ratio** — `aspectRatio: 1.0` gives a round marker as a fallback
  if the rotated-rectangle scatter proves fiddly; the chisel is character, not
  correctness.

## Testing

- Unit: `MarkerScatterRenderer` — particle generation is deterministic
  (identical for identical input); per-particle alpha is bounded; marker grain is
  a pure function of world position (overlap-consistent).
- `resolveMaterial` — felt-tip yields `stampDiscs`, `isolation: false`, no effects.
- Regenerate golden-master snapshots (felt-tip call sequence changes to the disc
  path).
- Manual on device: shade back and forth in one stroke → visibly darkens; a
  single straight stroke is even along its length; texture moves/zooms with the
  page and reads as deposited ink; active stroke matches the baked result.

## Risks

- **Look needs iteration.** The felt pen's appearance is now entirely emergent
  from particle tuning. Budget tuning time; Phase 2 is not optional.
- **Visible change: fuzzy edges.** The crisp outline-masked edge is replaced by a
  particle-cloud edge. This is physically correct for a marker but is a
  deliberate, visible change — called out for sign-off.
- **Performance** on wide/long strokes — mitigated by particle-size tuning;
  bounded like dense pencil shading.
- **Large deletion surface** — many files lose `drawMarkerStamps`/fiber methods.
  Mechanical, but broad; `yarn build` + tests gate it.
