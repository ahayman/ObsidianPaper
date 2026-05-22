# Felt Pen — Oriented Streak Particles (a fibre, not a dot)

**Date:** 2026-05-22
**Status:** Implemented 2026-05-22 — phases 1 & 2 done (build + 78 test suites
green, deployed). Phase 3 (on-device tuning of `MarkerScatterConfig`) pending feedback.
**Builds on:** `2026-05-22-felt-pen-flow-buildup.md` — keeps the flow/build-up model
(particle scatter, source-over, no isolation, world-anchored grain) intact. This
plan changes only the *particle shape*.
**Research:** `Claude/Research/2026-05-22-felt-pen-ink-buildup-flow-model.md`

## Goal

The flow/build-up behaviour is right and the user has signed off on it. The
*texture* still reads as pencil/charcoal: "very blurry… on the lighter strokes
you can clearly see blurry dots." Make the felt pen read as felt ink — continuous,
fibrous — without a new rendering pipeline.

## Diagnosis

The felt pen scatters **round disc particles** — the pencil's primitive. That is
correct for a pencil (graphite is genuinely granular: discrete particles catching
on paper tooth) and wrong for a marker (felt ink is a liquid wicking from a
fibrous tip — continuous, with longitudinal streaks).

Confirmed from the code: the WebGL disc shader (`STAMP_DISC_FRAG`,
`src/canvas/engine/shaders.ts:94`) is a **hard-edged** circle —
`if (dist > 1.0) discard` — so the "blur" is not per-disc anti-aliasing. It is the
**round-dot scatter pattern itself**: at high coverage the dots smear into a fuzzy
cloud; at low coverage you see the individual round dots. No amount of tuning a
round dot escapes that. The primitive has to change.

## Approach — an oriented "streak" particle

Replace the felt pen's round disc with a **capsule** (a stadium: a line segment of
half-length `L` with cross-radius `r`), oriented ~along the stroke's direction of
travel. Everything else from the flow-brush model is unchanged.

The mental model: **the chisel footprint becomes a comb of fibres.** At each step
along the path, instead of a 2-D grid of round dots filling the footprint, emit a
row of thin capsules across the nib's cross-axis, each capsule elongated along the
travel tangent. Stepped densely, successive footprints' capsules overlap into a
**continuous ink ribbon** — no inter-dot gaps, so no dottiness and a defined edge.
On light strokes the leftover texture reads as **fibres**, not dots. Build-up is
unchanged: capsules composite source-over with no isolation, so overlap (a
self-crossing stroke, or a second pass) accumulates exactly as today.

A capsule is also a strict superset of a disc — a capsule with `L = 0` *is* a
disc — so this is genuinely "a shape type in the pipeline," not a special case.

### Why capsule (not ellipse)

A capsule has straight parallel sides → reads as a fibre/bristle mark. An ellipse
tapers → reads as a grain of rice. Capsule is the better felt fibre and has the
simpler SDF (`sdSegment`). Ellipse stays available as a one-line tuning swap if
wanted.

### Edge crispness

The capsule fragment shader keeps the disc's hard `discard` edge (no soft AA
ramp). Baked tiles already run 4× MSAA (`MSAAResolver`), so hard edges resolve
crisp-but-not-jagged. The active Canvas2D path is natively anti-aliased. This is
deliberate: the user wants *less* blur, so we do not add a soft falloff to the
particle itself — softness, if any, comes only from low-`flow` overlap.

## Design — a new `stampStreaks` primitive, parallel to `stampDiscs`

The pencil's disc path (`drawStampDiscs`, `STAMP_DISC_*`, `packStampsToFloat32`,
4-float layout) is **left completely untouched** — the pencil works well and is
not worth any regression risk. The streak is added as a sibling, selected by pen
config. This is a deliberate trade of a little duplication for zero pencil risk;
each new piece mirrors an existing `stampDiscs` sibling and is mechanical.

### Instance data layout — 8 floats per streak

`packStreaksToFloat32(streaks) → Float32Array` of `[cx, cy, halfLen, radius, cos,
sin, opacity, 0]` per streak (two `vec4`s; the 8th float is padding/reserved).

**Low-alpha threshold:** `packStampsToFloat32` culls `opacity < 0.05`. The felt
flow brush deliberately deposits sub-0.05 fibres (`flow ≈ 0.08`), so
`packStreaksToFloat32` must use a much lower cull (~0.01) — `computeAllMarkerScatter`
already does its own `< 0.004` cull. (This 0.05 cull is likely *already* thinning
the current felt particles and worsening the sparse look — fixed for free here.)

### WebGL — `STAMP_STREAK_VERT` / `STAMP_STREAK_FRAG` (new, `shaders.ts`)

```glsl
// VERT
in vec2 a_position;   // unit quad [-0.5, 0.5]
in vec4 a_streak0;    // cx, cy, halfLen, radius   (per-instance)
in vec4 a_streak1;    // cos, sin, opacity, _      (per-instance)
out vec2  v_local;    // capsule-local, axis-aligned, world units
flat out vec2 v_dims; // halfLen, radius
flat out float v_opacity;
void main() {
  float halfLen = a_streak0.z, radius = a_streak0.w;
  vec2 local = a_position * vec2(2.0*(halfLen+radius), 2.0*radius);
  float c = a_streak1.x, s = a_streak1.y;
  vec2 rot = vec2(local.x*c - local.y*s, local.x*s + local.y*c);
  vec3 pos = u_transform * vec3(a_streak0.xy + rot, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_local = local; v_dims = vec2(halfLen, radius); v_opacity = a_streak1.z;
}
// FRAG  (capsule SDF, hard edge — mirrors the disc's discard)
void main() {
  float dx = max(abs(v_local.x) - v_dims.x, 0.0);
  float d = length(vec2(dx, v_local.y)) - v_dims.y;
  if (d > 0.0) discard;
  fragColor = vec4(u_color * v_opacity * u_alpha, v_opacity * u_alpha);
}
```

`WebGL2Engine.drawStampStreaks(color, data)` mirrors `drawStampDiscs` (lines
1005–1049): a new `stampStreakProg`, two instanced `vec4` attributes
(`a_streak0`/`a_streak1`, stride 32, divisor 1), same unit-quad VBO/IBO,
`drawElementsInstanced`.

### Canvas2D — `Canvas2DEngine.drawStampStreaks` (baked fallback) + active path

Baked Canvas2D (`Canvas2DEngine`): per streak, `save → translate(cx,cy) →
rotate(atan2(sin,cos)) → roundRect(-(halfLen+r), -r, 2*(halfLen+r), 2*r, r) → fill
→ restore`, `globalAlpha = opacity`. The stadium falls out of `roundRect` with
corner radius `r` on a rect of height `2r`.

Active stroke: a new `drawStreaks(ctx, streaks, color, baseTransform,
strokeOpacity)` in a new `src/stamp/StreakRenderer.ts`, mirroring `drawStamps`
(`StampRenderer.ts:181`). It draws the capsule in **world units** under
`setTransform(baseTransform)` + per-streak `translate`/`rotate`, so rotation and
zoom compose correctly. Wired into the felt-tip branch of `renderStrokeToContext`
(`StrokeRenderCore.ts`).

### Particle generation — `MarkerScatterRenderer.ts`

`computeAllMarkerScatter` keeps its arc-length walk, pressure→width, ink
depletion, world-anchored grain, and determinism. `emitFootprint` changes from a
jittered grid of round `StampParams` to a **comb of capsule `StreakParams`**:

- `StreakParams { x, y, halfLength, radius, rotation, opacity }` (new type).
- Per footprint at path point `pt`: compute the travel tangent `θ` from the
  current segment. Place `rows` fibres across the nib cross-axis (minor axis),
  jittered; each fibre runs along `θ ± streakAngleJitter`.
- `halfLength` ≈ footprint length, jittered, and **≥ the footprint step** so
  consecutive footprints overlap → the ribbon stays continuous along the stroke.
- `radius` = `streakWidth / 2`.
- Per-fibre `opacity = flow × grain(centreWorld) × depletion × edgeFalloff ×
  strokeOpacity`. Grain sampled once at the fibre centre → uniform along the
  fibre → fibre-to-fibre darkness variation = longitudinal streakiness (exactly
  the felt look), and cheap.
- Determinism preserved: `hashFloat(index, seed)` drives jitter, so active and
  baked paths emit identical fibres.

Net particle count **drops** (a fibre covers far more area than a dot), so this is
also a small perf win over the current disc grid.

`computeMarkerGrain` simplifies — the *shape* now carries the fibre anisotropy, so
the grain no longer needs `grainAnisotropy`. Keep the contrast curve (it gives
dry-marker gap streaks); drop the anisotropy term.

### Config — `MarkerScatterConfig` (`PenConfigs.ts`)

Replace the disc-grid fields with streak geometry:

- **add** `streakWidth` (fibre cross-thickness, world units), `streakLength`
  (fibre length, world units or ×footprint), `streakCount` (fibres across the nib
  — or keep `density` driving it), `streakAngleJitter` (radians).
- **keep** `flow`, `spacing`, `footprintScale`, `aspectRatio`, `grainScale`,
  `grainStrength`, `inkDepletionRate`.
- **remove** `particleSize`, `grainAnisotropy`.

### Material wiring

- `StrokeMaterial.ts` — new `StampStreaksBody { type: "stampStreaks" }`; felt-tip
  `resolveMaterial` returns it instead of `stampDiscs`. (`isolation:false`,
  `blending:"source-over"`, `effects:[]` — unchanged.)
- `StrokeDataPreparer.ts` — a `stampStreaks` branch (baked + active) →
  `computeAllMarkerScatter` → `packStreaksToFloat32` → `data.stampData`.
- `MaterialExecutor.ts` — `stampStreaks` body case → `renderStampStreaksBody` →
  `backend.drawStampStreaks`.
- `DrawingBackend.ts`, `WebGLBackend.ts`, `Canvas2DBackend.ts`,
  `RenderEngine.ts` — declare/implement `drawStampStreaks` (mirrors
  `drawStampDiscs`). `RecordingEngine.ts` (test engine) gets a recording stub.

## Files touched

| File | Change |
|---|---|
| `src/stroke/PenConfigs.ts` | `MarkerScatterConfig` → streak geometry fields; retune felt-tip |
| `src/stamp/MarkerScatterRenderer.ts` | Emit `StreakParams` capsule comb; simplify `computeMarkerGrain` |
| `src/stamp/StreakRenderer.ts` | **New** — `StreakParams` type + `drawStreaks` (Canvas2D active) |
| `src/stamp/StampPacking.ts` | **Add** `packStreaksToFloat32` (8-float, low cull) |
| `src/canvas/engine/shaders.ts` | **Add** `STAMP_STREAK_VERT` / `STAMP_STREAK_FRAG` |
| `src/canvas/engine/WebGL2Engine.ts` | **Add** `drawStampStreaks` + streak program |
| `src/canvas/engine/Canvas2DEngine.ts` | **Add** `drawStampStreaks` (rotated stadium) |
| `src/canvas/engine/RenderEngine.ts` | Declare `drawStampStreaks` |
| `src/canvas/engine/RecordingEngine.ts` | Recording stub for `drawStampStreaks` |
| `src/rendering/DrawingBackend.ts` | Declare `drawStampStreaks` |
| `src/rendering/WebGLBackend.ts` / `Canvas2DBackend.ts` | Implement `drawStampStreaks` |
| `src/rendering/StrokeMaterial.ts` | `StampStreaksBody`; felt-tip → `stampStreaks` |
| `src/rendering/StrokeDataPreparer.ts` | `stampStreaks` prepare branch (baked + active) |
| `src/rendering/MaterialExecutor.ts` | `stampStreaks` body case |
| `src/canvas/StrokeRenderCore.ts` | Felt-tip active branch → `drawStreaks` |
| Tests | Update `MarkerScatterRenderer.test.ts`, `StrokeMaterial.test.ts`; add `packStreaksToFloat32` + `StreakRenderer` tests; regenerate golden-master (felt-tip only — pencil snapshots must be unchanged) |

The pencil disc path — `drawStampDiscs`, `STAMP_DISC_*`, `packStampsToFloat32`,
`computeAllStamps` — is **not modified**.

## Phases

1. **Primitive** — `STAMP_STREAK_*` shaders, `drawStampStreaks` across engines/
   backends, `packStreaksToFloat32`, `StreakParams` + `drawStreaks`. Renders
   nothing yet (no caller).
2. **Wire felt-tip** — `stampStreaks` body type, `MarkerScatterRenderer` emits
   capsules, config, data-prep + executor + `StrokeRenderCore` routing. Felt pen
   now renders as streaks.
3. **Tune on device** — see below.

Phases 1–2 land together (phase 1 is dead without 2).

## Tuning (on iPad — not a footnote)

- **streakWidth / streakLength** — the core felt look. Width: a defined fibre, not
  hairline, not a fat blob. Length ≥ footprint step for a continuous ribbon.
- **streakCount / density** — fibres across the nib. Enough to read solid at full
  pressure; sparse enough that light strokes show distinct fibres.
- **flow** — single pass ≈ 0.6–0.75 opacity so shading visibly builds.
- **streakAngleJitter** — a few degrees; perfectly parallel fibres look mechanical.
- **edge falloff** — defined; markers feather slightly but are far crisper than
  graphite.
- **grainStrength / grainScale** — dry-gap streak depth; subtle.

## Testing

- Unit: `packStreaksToFloat32` layout + low cull; `computeAllMarkerScatter`
  deterministic, bounded alpha, folds `style.opacity`, emits capsules with
  positive dims; `computeMarkerGrain` pure & bounded.
- `resolveMaterial` — felt-tip → `stampStreaks`, `isolation:false`, no effects.
- Golden-master regenerated; **pencil snapshots must not change** (proof the disc
  path is untouched).
- On device: shade back-and-forth in one stroke → darkens; a straight stroke is an
  even continuous ribbon (no dots); light strokes read as fibres; texture
  moves/zooms with the page; active matches baked.

## Risks

- **Look still needs iteration** — phase 3 is real work.
- **New WebGL program** — trivial GLSL, compiles on WebGL2 (iPad). Hard-edge +
  tile MSAA → crisp.
- **Active vs baked rotation** — both read `rotation` from identical particle data
  (same determinism guarantee as grain), so they cannot diverge.
- **Modest duplication** — `drawStampStreaks` mirrors `drawStampDiscs`. Accepted
  deliberately to keep the working pencil path at zero risk.

## Follow-up — fibre-angle jitter (criss-cross), 2026-05-22

On-device feedback: fibre angles "change very rapidly, especially on slower
strokes, sometimes giving a criss-cross pattern."

Two causes:
1. **Noisy per-segment tangent.** Fibre orientation came from `atan2` of the
   immediate raw input segment. On a slow stroke consecutive input points are a
   tiny, tremor-dominated distance apart, so that direction swings wildly — the
   speed-dependent part the feedback identified.
2. **Re-randomised per-fibre angle jitter.** `streakAngleJitter` was an
   independent random offset per fibre (`hashFloat(fibreIndex)`), so overlapping
   fibres — many, on a tremor-lengthened slow stroke — pointed every which way.

Fix:
- **Centered windowed tangent.** `computeAllMarkerScatter` becomes two passes:
  pass 1 samples footprint points at fixed arc-length `step`; pass 2 orients
  each footprint by the chord from `±tangentSmoothing` arc length away. The
  window spans real distance, so per-sample direction noise averages out. A
  degenerate (near-stationary) window falls back to the last good heading.
- **World-anchored angle wobble.** The per-fibre offset becomes a smooth
  function of world position (like the grain), so neighbouring fibres stay
  near-parallel — organic flow, never criss-cross — and active/baked agree.
- New config `tangentSmoothing` (half-window, world units); `streakAngleJitter`
  retained as the (now coherent) wobble amplitude.

### Follow-up 2 — X's at direction reversals

The windowed tangent still produced X's where a stroke *reverses* (back-and-forth
shading). Cause: a fibre is an **undirected line** (orientation mod π), but the
tangent was averaged as a **directed vector** (mod 2π). When the centered window
straddled a turn, it averaged the incoming and outgoing legs — opposite
directions — into a chord pointing roughly *across* both legs → perpendicular
fibres → X's.

Fix: average orientation in **doubled-angle space** — each segment direction θ
becomes the unit vector `(cos 2θ, sin 2θ)`, summed over the window, and the
result halved back. Doubling collapses θ and θ+π onto the same point, so a 180°
reversal is a non-event: back-and-forth shading legs share one orientation and
average cleanly. A window straddling a sharp (~90°) corner makes the doubled
vectors cancel (low resultant magnitude) — detected as low "coherence", and the
previous orientation is held so the corner reads as a clean snap, not an X.
