# Felt-Pen Ink Build-Up — the Flow vs. Opacity Model

**Date:** 2026-05-22
**Focus:** Why the felt pen doesn't accumulate ink on self-overlap, and how to fix it.

## The problem observed

The felt pen behaves like an "etch-a-sketch": a single stroke that crosses over
itself (a shading motion) does **not** darken. A *separate* new stroke layers on
top of existing ink, but one continuous stroke layering over itself does nothing.
The texture also reads as a static image *underneath* the stroke rather than
texture deposited *by* the pen.

The pencil does not have this problem — shading back and forth with one
continuous pencil stroke builds up density correctly.

## The canonical model: Flow vs. Opacity

Every professional brush engine (Photoshop, Procreate, Krita) distinguishes two
controls, and they produce exactly the two behaviors above:

| Control | Within-stroke behavior |
|---|---|
| **Opacity** | The maximum alpha one stroke can reach. Overlap *within* a single stroke does **not** build past it. Procreate calls these "Glazed" brushes — "lay down one shade of color for the entirety of a stroke … no matter how many times you go back and forth." |
| **Flow** | The alpha of each individual *dab*. Dabs composite with `source-over`; where they overlap — including a stroke crossing itself — the alphas **combine and darken**. Procreate calls these "Blending" brushes — they "interact with [themselves] inside of the same stroke." |

A Photoshop community answer puts it exactly as the user described the desired
behavior: *"much like when using fat markers in traditional renders — every
stroke lays down a certain amount of ink and if you cross over you get the colour
of two layers of ink."*

**Mechanism:** a *flow* brush is just low-alpha dabs (or particles) composited
`source-over` directly onto the canvas. `n` overlapping dabs of alpha `a` reach
`1-(1-a)^n`. A single pass deposits `n` dabs and reaches a base opacity; a
self-crossing point gets `2n` and is visibly darker; scribbling asymptotes to
opaque. No special logic — overlap *is* accumulation.

An *opacity* brush gets its flat look by rendering the whole stroke into an
**isolation buffer** and compositing it back once at the stroke opacity. The
buffer caps within-stroke alpha — which is exactly the etch-a-sketch behavior.

## Where each pen sits today

- **Pencil** — a *flow* brush. It scatters many tiny semi-transparent particles
  (`StampRenderer.computeStamps` → `drawStampDiscs`), composited `source-over`
  with **no isolation**. Self-overlap accumulates; shading darkens. ✓
- **Felt pen** — an *opacity* brush. `StrokeMaterial.isolation = true`: marker
  stamps are drawn into an offscreen buffer, then composited back once. The
  buffer caps within-stroke build-up. ✗

The `2026-02-27-felt-tip-marker-rendering-techniques.md` research explicitly
recommended offscreen isolation as "the standard solution." That recommendation
is correct *for a glaze marker* — but it is the direct cause of the behavior the
user is now rejecting. We want a **flow** felt pen, not a glaze one.

## The texture problem

The felt pen's fiber texture is currently a single tiled noise texture carved out
of the finished stroke with `destination-out` (an eraser pass). That is why it
"reads as a texture underneath" — it literally is one static underlay, applied
once to the whole isolated stroke, not deposited by the pen.

The pencil's grain is the opposite and is the model to copy: it is a
**world-space function sampled per particle** (`computeGrainOpacity(worldX,
worldY)` → baked into each particle's alpha). Two consequences:

1. **It is deposited, not carved.** The texture is the particle alpha — part of
   the ink itself. Overlapping particles at the same world point sample the same
   grain value, so the texture *survives* overlap and accumulates instead of
   washing out.
2. **It is in the per-particle data, computed once on the CPU.** The Canvas2D
   (active) and WebGL (baked) paths just draw the particles — they cannot
   disagree, because the texture is in the data, not the rendering. (This is why
   the pencil has never had an active-vs-baked texture mismatch.)

A per-*pixel* shader texture on large stamps cannot match this: the active stroke
is Canvas2D and cannot evaluate world-space noise per pixel. The texture must
live in per-element data, and the elements must be small enough that
per-element ≈ per-pixel — i.e. particles.

## Recommendation

**Rebuild the felt pen as a particle-scatter flow brush, sharing the pencil's
`stampDiscs` rendering path.** This is the user's own intuition ("the pencil
applies a randomized dot pattern … how we apply that texture should be applied in
a similar manner"), and it is the only design that satisfies every requirement:

| Requirement | How the particle-flow model delivers it |
|---|---|
| Self-overlap builds up | `source-over` particles, **no isolation** — overlap accumulates |
| Texture is deposited, not an underlay | Texture = per-particle alpha from a world-space grain function |
| Active (Canvas2D) == baked (WebGL) | Texture baked into per-particle data, computed once on CPU |
| Single pass stays roughly uniform | Even particle distribution → ~constant overlap count along a straight pass; crossing doubles it |
| Felt-pen character | Chisel-shaped (rotated-rectangle) scatter region driven by pencil azimuth; marker-tuned density/opacity; a subtle marker grain function |

The felt pen becomes "a denser, more opaque, chisel-footprint pencil with a
marker grain" — and the entire `markerStamps` body, the rotated-rectangle stamp
texture, the fiber-overlay texture, the `fiberOverlay`/`applyFiberOverlay`
machinery, and the felt-tip isolation are all deleted.

### Tuning levers (validate on device)

- **Per-particle flow** — low enough that a single pass lands at a *moderate*
  opacity (~0.6–0.75), leaving headroom so shading visibly builds up.
- **Particle size / count** — small enough for fine texture, large enough for
  performance; markers tolerate a coarser grain than the pencil.
- **Scatter distribution** — roughly uniform across the chisel width (not the
  pencil's center-bias) so a single straight pass is even.
- **Marker grain** — world-anchored, subtle (high base, low contrast), optionally
  slightly anisotropic; fixed orientation (world-anchored noise must be, for
  overlap consistency).
- **Edge** — real marker edges are fibrous, not razor-sharp; the particle cloud
  gives this naturally. Tune edge falloff so it is tighter than the pencil's.

## Why not the alternatives

- **Keep isolation, lower per-dab alpha** — the isolation buffer still caps
  within-stroke build-up. No good.
- **Keep rotated-rectangle stamps, no isolation, per-pixel shader fiber texture**
  — builds up correctly, but the per-pixel world texture can only run in the
  WebGL shader; the Canvas2D active stroke cannot match it → active/baked texture
  mismatch (the class of bug the user already pushed back on).
- **`MAX`-blend within-stroke** (`EXT_blend_minmax`) — another way to *cap*
  build-up; it implements the glaze behavior we are trying to get rid of.

## Sources

- [Procreate: Glazed vs. Blending brushes](https://adventureswithart.com/procreate-glazed-brushes/) — glaze = no within-stroke build-up; blending = builds up within a stroke
- [Procreate Brush Studio — rendering modes](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
- [Photoshop: Flow vs. Opacity](https://community.adobe.com/questions-712/why-flow-and-opacity-is-not-same-for-brush-one-stroke-1139512) — flow accumulates on self-overlap, opacity does not; "fat markers … cross over you get the colour of two layers of ink"
- [Photoshop brush dynamics — flow and spacing](https://www.photoshopessentials.com/basics/photoshop-brushes/brush-dynamics/other-dynamics/) — tighter dab spacing → more overlap → more opaque
- [Krita texture modes](https://docs.krita.org/en/reference_manual/brushes/brush_settings/texture.html) — texture as per-dab alpha modulation
- Prior in-repo research: `2026-02-27-felt-tip-marker-rendering-techniques.md` (recommended isolation — superseded for this goal), `2026-02-19-pen-texture-feasibility.md` (the per-particle world-grain model the pencil now uses)
