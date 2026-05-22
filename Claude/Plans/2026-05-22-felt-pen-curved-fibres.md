# Felt Pen — Curved Fibres (thick-arc capsule primitive)

**Date:** 2026-05-22
**Status:** Implemented 2026-05-22 — build + 78 test suites green, deployed.
Pending on-device verification of curved strokes.
**Builds on:** `2026-05-22-felt-pen-streak-particles.md` — the streak/capsule
primitive and its follow-ups (jitter, doubled-angle orientation). This plan
upgrades the capsule from a straight segment to a circular arc.

## Goal

On curved strokes — tight loops especially — the straight fibre capsules read as
faceted straight chords that fan and poke past the curve ("accumulating
horizontal lines"). Make the fibre follow the curve: render it as a **curved
capsule** — a thick circular arc with round ends — so it bends with the stroke.

## Diagnosis (recap)

A fibre is a straight, rigid capsule of length `streakLength` (~3.5 footprint
steps). On a curve it is a tangent chord; over its length the curve has rotated,
so overlapping fibres fan at `fibreLength / curveRadius` radians and their ends
poke tangentially past the curve. Tight loops → large fan → visible faceting.

## Approach

Every fibre gains a **signed curvature** `κ` (1/worldUnits). `κ = 0` is the
current straight capsule; `κ ≠ 0` makes the fibre a circular arc of radius
`1/|κ|`, tangent to the fibre orientation at the footprint, bending to the side
given by `sign(κ)`. The fibre then *follows* the curve instead of chording it —
no shortening needed, so the straight-stroke look is untouched.

`κ` is derived per footprint from the path; it is **not** a config value.

### Representation & packing

`StreakParams` gains `curvature: number`. The packed layout already has a unused
pad float — it becomes curvature, so the size is unchanged:

`[cx, cy, halfLen, radius, cos, sin, opacity, curvature]` — 8 floats, stride 32.

Because the layout size is unchanged, **`WebGL2Engine.drawStampStreaks` and the
instanced VBO setup are untouched** — only the shader reinterprets float 7.

### Curvature computation — `MarkerScatterRenderer`

Pass 2 already computes a smoothed `orientation` per footprint (doubled-angle
window). Restructure into: (2a) fill an `orientation[]` array; (2b) per footprint
`k`, curvature is the orientation change across the fibre's own span:

```
m   = max(1, round(halfLength / step))            // ~half the fibre, in footprints
dθ  = wrapToHalfPi(orientation[k+m] - orientation[k-m])   // signed, (-π/2, π/2]
arc = (clamped span) * step
κ   = dθ / arc
```

Clamp `|κ|` so `halfLength·|κ| ≤ MAX_APERTURE` (~2.0 rad) — a fibre never bends
past ~115°, which keeps the arc SDF well-behaved and bounds tight-loop overdraw.
All fibres in a footprint share the footprint's `κ` (the cross-offset within the
nib is small vs. the curve radius — negligible distortion).

`emitFootprint` and `StreakParams` carry `curvature` through; everything else in
generation is unchanged.

### WebGL — arc SDF (`shaders.ts`)

`STAMP_STREAK_FRAG` evaluates a **thick-arc SDF** (round ends), with a straight
branch for `|κ| ≈ 0`:

```glsl
// fibre-local frame: x along tangent at origin, y cross-stroke
float sdFibre(vec2 p, float halfLen, float radius, float curv) {
  float ac = abs(curv);
  if (ac < CURV_EPS) {                       // straight capsule
    float dx = max(abs(p.x) - halfLen, 0.0);
    return length(vec2(dx, p.y)) - radius;
  }
  float R  = 1.0 / ac;                       // arc radius
  p.y *= sign(curv);                         // fold curvature sign
  vec2  q  = vec2(abs(p.x), -(p.y - R));     // centre→origin, iq +y convention
  float ap = halfLen * ac;                   // half-aperture (CPU-clamped ≤ MAX_APERTURE)
  vec2  sc = vec2(sin(ap), cos(ap));
  float d  = (sc.y * q.x > sc.x * q.y)
    ? length(q - sc * R)                     // past the arc end → round cap
    : abs(length(q) - R);                    // within sweep → band
  return d - radius;
}
```

`STAMP_STREAK_VERT` expands the instanced quad's cross-extent by the arc sagitta
`s = R·(1 - cos(halfLen·|κ|))` (→ 0 as κ → 0) so the curved fibre stays inside
its quad; `curv` is passed to the fragment shader as a `flat` varying.

### Canvas2D — stroked arc (active + engine + backend)

A thick arc with round ends is exactly a round-capped **stroke** of its
centerline. The three Canvas2D sites (`drawStreaks` active path,
`Canvas2DEngine.drawStampStreaks`, `Canvas2DBackend.drawStampStreaks`) switch
from filling `capsulePath` to stroking the centerline:

- `lineCap = "round"`, `lineWidth = 2·radius`;
- `κ ≈ 0` → `moveTo`/`lineTo` the two endpoints (a straight stroke = a capsule —
  identical to today's filled capsule);
- `κ ≠ 0` → `ctx.arc(arcCx, arcCy, R, startAngle, endAngle, ccw)`.

A shared `StreakRenderer` helper (`strokeFibre`) builds the line-or-arc path from
`(cx, cy, cos, sin, halfLen, radius, curvature)` in world units. `capsulePath` is
removed (replaced by `strokeFibre`).

Active and baked must agree: both derive the arc from the *same*
`(cx,cy,θ,halfLen,radius,κ)`, so the SDF and the stroked arc describe one shape.
Getting the curvature-sign / bulge-direction convention identical on both sides
is the main correctness risk.

## Files touched

| File | Change |
|---|---|
| `src/stamp/StreakRenderer.ts` | `StreakParams.curvature`; replace `capsulePath` with `strokeFibre` (line/arc); `drawStreaks` strokes round-capped centerlines |
| `src/stamp/StampPacking.ts` | `packStreaksToFloat32` writes `curvature` into float 7 |
| `src/stamp/MarkerScatterRenderer.ts` | Per-footprint curvature from the orientation array; carry through `emitFootprint` |
| `src/canvas/engine/shaders.ts` | `STAMP_STREAK_FRAG` arc SDF + straight branch; `STAMP_STREAK_VERT` sagitta-expanded quad |
| `src/canvas/engine/Canvas2DEngine.ts` | `drawStampStreaks` strokes line/arc via `strokeFibre` |
| `src/rendering/Canvas2DBackend.ts` | `drawStampStreaks` strokes line/arc via `strokeFibre` |
| Tests | `StampPacking.test.ts` (curvature float); `MarkerScatterRenderer.test.ts` (straight→κ≈0, arc stroke→κ≈1/R with correct sign, clamp); regenerate golden-master |

`WebGL2Engine.drawStampStreaks` and the VBO plumbing are **unchanged** (layout
size is the same) — only the shader changes. The pencil disc path is untouched.

## Testing

- `packStreaksToFloat32` — curvature round-trips in float 7.
- `computeAllMarkerScatter` — a straight stroke yields `|κ| ≈ 0` for every fibre;
  a stroke sampled from a circle of radius R yields `|κ| ≈ 1/R`, sign matching
  the bend direction; `|κ|` is clamped on a very tight loop.
- Regenerate golden-master (felt-tip only — pencil snapshots must not change).
- On device: tight loops (the yellow scribble) read as smooth curved ribbons;
  straight strokes are unchanged; active stroke matches the baked result.

## Follow-up — comb teeth on tight loops

On-device: tight loops rendered as "comb teeth" — short fibres perpendicular to
the curve — while large/gentle curves were fine.

Cause: the doubled-angle orientation window. It spans a fixed ~2×
`tangentSmoothing` of arc length. On a small-radius loop that arc covers a large
rotation; once the *doubled* angle sweeps past ~180° the resultant vector
cancels and then flips, so the windowed orientation freezes (held) or points 90°
off — perpendicular to the curve. Large curves span little rotation per window,
so they were unaffected.

Fix: make the window ADAPTIVE. At each footprint, start from the full window and
shrink it (halving) until the doubled-angle resultant is coherent — i.e. it
spans little enough rotation to still track the local orientation. Straight /
gently-curved runs keep the full window (tremor smoothed); tight loops shrink to
a small window that follows the curve. A 180° reversal stays coherent at the
full window (both legs share one orientation), so it is unaffected. The
`lastOrientation` hold is removed — the shrink always yields a local estimate,
down to a single segment for a genuine sub-fibre sharp feature.

## Follow-up 2 — banding on sharp corners

On-device: sharp corners (V vertices) band — the bend reads as stacked ribs.

Cause: at a sharp corner the fibres — long arcs — extend well past the vertex
into the other leg, where they sit at a wide angle to that leg's fibres and
cross instead of blending. The fibre needs to be SHORT at a sharp corner.

Subtlety: a fibre is an undirected line, so its arc curvature is measured in
ORIENTATION (mod π) space — and a sharp corner barely changes orientation (a
140° direction turn is only a 40° orientation turn, mod π). So orientation
curvature does not flag a corner; the DIRECTION (mod 2π) turn does.

Fix: compute two bend measures per footprint — orientation curvature (shapes the
fibre arc, as before) and direction curvature (mod 2π). The fibre is shortened
by the LARGER of the two: `fibreHalf` capped at `APERTURE_SOFT / bendRate`,
floored at 0.6·step so consecutive fibres still overlap. A sharp corner has high
direction curvature → short fibres that tile the bend without crossing; smooth
curves have low curvature both ways → unaffected. A hard aperture limit on the
arc SDF is kept as a final safety.

## Follow-up 3 — thicken fibres at sharp bends

Shortening the fibres at sharp bends (Follow-up 2) helped but left residual
banding: short fibres are reached by fewer overlapping footprints, so each
footprint's comb shows through instead of averaging into solid ink.

Fix: thicken a fibre in proportion to how much it was shortened —
`radius × clamp(baseFibreHalf / fibreHalf, 1, CORNER_THICKEN_MAX)`. The shorter
corner fibres become fatter, so they overlap enough — along and across the
stroke — to read as solid ink. Straight and gently-curved fibres aren't
shortened, so they aren't thickened. `radius` is already per-fibre data through
the whole pipeline (packing, shader, Canvas), so this is a generation-only
change.

## Risks

- **Active vs. baked consistency** — the SDF and the stroked arc are different
  math for one shape; a sign error flips the bulge on one side. Primary risk;
  caught by side-by-side visual check (active vs. baked) and careful conventions.
- **Tight-loop overdraw** — a strongly curved fibre's quad grows by the sagitta,
  so more fragments are discarded. Bounded by the `MAX_APERTURE` clamp; tight
  loops are a small screen area. Revisit only if it shows up in profiling.
- **Sharp corners** — at a doubled-angle "snap" the orientation jumps, so the
  windowed `κ` spikes and is clamped → a strongly-curved fibre or two right at a
  hard corner. Acceptable; can force `κ = 0` in snap regions if it looks wrong.
