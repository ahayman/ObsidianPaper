# Stamp-Based Brush Rendering: Banding/Stepping Reduction Techniques

## Date: 2026-02-22

## Problem Statement

When rendering brush strokes using a stamp (dab) model, circular stamps with per-stamp opacity are placed along a stroke path and composited via `source-over` alpha blending. Where stamps overlap, the alpha accumulates according to:

```
A_new = A_old * (1 - stamp_alpha) + stamp_alpha
```

This creates visible **banding artifacts**: you can see the individual circular stamp boundaries at overlap regions, producing a stepped/scalloped appearance instead of a smooth gradient. The artifact is especially visible with:

- Moderate opacity stamps (0.1-0.4 range)
- Hard-edged or nearly-hard-edged stamp textures
- Regular spacing between stamps
- Relatively large stamps compared to stroke width

Our current implementation (`InkStampRenderer.ts`) places stamps along the stroke path with spacing ~15% of stamp diameter and per-stamp alpha of ~0.01-0.35 depending on velocity. The stamps are composited via `source-over` onto an offscreen canvas, then masked to the italic outline path via `destination-in`.

---

## Technique 1: Stroke-Level Opacity (Wash Mode / Temporary Layer)

### How It Works

Instead of each dab accumulating opacity on the final canvas, all dabs are rendered at full opacity onto a **temporary buffer** (conceptually a new layer). When the stroke is complete, the entire buffer is composited onto the canvas at the desired stroke opacity.

This is how **Krita's Wash mode**, **Procreate's Glaze modes**, and **GIMP's CONSTANT painting mode** work internally:

1. Create a transparent offscreen buffer at stroke start
2. Render each dab onto this buffer using `source-over` but with "dab flow" controlling deposit rate
3. When the stroke ends, composite the entire buffer onto the canvas at the stroke's opacity level

The key insight is that dabs within a single stroke do NOT accumulate darkness beyond the buffer's maximum — they only build up toward a uniform tone. The stroke opacity then controls how visible that uniform tone is.

**Krita** distinguishes between:
- **Flow**: transparency of individual dabs (deposit rate)
- **Opacity**: transparency of the final stroke (maximum darkness cap)

In **Wash mode**, opacity acts as a per-stroke cap, not per-dab. No point of the brush stroke can be more opaque than the opacity value, regardless of how many dabs overlap.

### Canvas2D Feasibility

**Fully feasible.** This is essentially what our `renderInkShadedStroke()` already does: it renders stamps onto an offscreen canvas, masks them, then composites back. The modification would be:

1. Render stamps onto the offscreen buffer at higher per-dab flow (e.g., 0.3-0.8)
2. Cap the buffer's maximum alpha before compositing back
3. Composite the buffer onto the main canvas at the desired stroke opacity

The alpha capping step could be done by:
- Drawing a solid rect with `globalCompositeOperation = 'destination-in'` and `globalAlpha = maxOpacity` (this scales all existing alpha values down)
- Or using `getImageData`/`putImageData` to clamp alpha values directly (slow but precise)
- Or just accepting the natural saturation — if dabs are high enough flow, they converge to near-1.0 alpha, and the composite step's `globalAlpha` controls final darkness

### Pros
- Eliminates intra-stroke banding entirely — dabs converge to uniform tone
- Well-understood technique used by all major painting apps
- Works naturally with our existing offscreen buffer pipeline
- No additional per-pixel computation during stamp placement

### Cons
- Requires the full stroke to be complete before final compositing (problematic for incremental/live rendering)
- For live preview during active strokes, either the temporary buffer needs to be re-rendered each frame or an approximation is used
- Does not address banding from the dab edges themselves (only from opacity accumulation)
- Stroke opacity is uniform — cannot have velocity-dependent darkness variation within a single stroke (defeats our shading goal)

### Applicability to Our Use Case

**Partially applicable.** The problem is that our fountain pen specifically wants velocity-dependent shading *within* a single stroke (slow = dark, fast = light). A pure wash mode would flatten this variation. However, a hybrid approach could work: use wash mode for the base deposit and add velocity variation on top (see Technique 7).

---

## Technique 2: Alpha-Darken / Max-Alpha Compositing

### How It Works

Instead of accumulating alpha via `source-over` blending:

```
A = A_old * (1 - A_new) + A_new   // source-over: always increases
```

Use a **max-alpha** operation:

```
A = max(A_old, A_new)              // alpha-darken: takes maximum
```

With max-alpha, overlapping stamps do NOT build up darkness. Each pixel simply takes the maximum alpha value from any stamp that touched it. This eliminates scalloping because the transition between overlapping stamps is continuous — the max of two overlapping Gaussian falloffs is smooth.

This is the basis of:
- **Krita's Alpha Darken** compositing mode
- **Drawpile's "Greater Density/Marker" blend mode**
- **SAI's marker brush**
- **libmypaint's alpha-darken mode** (when `opaque_linearize` is set to 0)

The Drawpile implementation uses:
```
stroke_alpha = max(stamp_alpha, stroke_alpha)
layer_alpha = alpha_blend(stroke_alpha, layer_alpha)
layer_color = stamp_color
```

### Canvas2D Feasibility

**Not directly available.** Canvas2D's `globalCompositeOperation` does not include a "max alpha" mode. The `lighter` mode adds colors (additive), not max. The `darken` mode compares RGB values, not alpha.

However, it can be **emulated** with a two-buffer approach:

1. **Alpha-tracking buffer**: An offscreen canvas where each stamp is drawn. After each stamp, use `getImageData` to read the pixel data and compute `max(existing_alpha, new_stamp_alpha)` per pixel. Write back with `putImageData`.
2. **Final composite**: Draw the alpha-tracking buffer onto the main canvas.

This per-pixel approach is **too slow** for real-time rendering with `getImageData`/`putImageData`.

**Alternative emulation**: Use the `lighter` (additive) composite mode on a very low-alpha buffer, then threshold/clamp. This is hacky and imprecise.

**Best emulation**: Render stamps to a WebGL context (even a tiny one) that supports custom blend equations (`MAX` blend mode is available in WebGL2), then read the result back. This adds complexity but is GPU-accelerated.

### Pros
- Completely eliminates overlap banding — smooth transitions guaranteed
- Natural-looking results: mimics marker/felt-tip behavior
- Re-stroking over the same area does not darken (for marker behavior)

### Cons
- Not available natively in Canvas2D — requires emulation
- Per-pixel `getImageData`/`putImageData` emulation is far too slow for real-time
- WebGL emulation adds significant architectural complexity
- Flat alpha profile (no center-to-edge variation from accumulation) — may look too flat for ink simulation
- Color blending needs separate handling (max-alpha only addresses opacity)

### Applicability to Our Use Case

**Architecturally challenging.** The lack of native Canvas2D support makes this impractical without WebGL. If we later move to a WebGL rendering backend, this becomes the ideal solution. For now, look to other techniques.

---

## Technique 3: Soft Stamp Textures with Gaussian Falloff

### How It Works

Replace the hard-edged stamp (solid circle with thin AA edge) with a **soft, Gaussian-profile** stamp. The stamp's alpha decreases gradually from center to edge following a Gaussian curve:

```
alpha(r) = exp(-r^2 / (2 * sigma^2))
```

When two Gaussian stamps overlap, the `source-over` composite creates a smoother transition because each stamp's contribution at the overlap boundary is already very low. The banding "step" between overlapping stamps is minimized because the alpha values at the overlap boundary are near-zero.

This is the most common approach in painting software. **Photoshop**, **GIMP**, **Krita**, **Procreate**, and **MyPaint** all support soft/Gaussian brush tips as the primary anti-banding strategy.

### Canvas2D Feasibility

**Directly feasible.** Modify the `generateInkStampImageData()` function to use a Gaussian alpha profile instead of the current nearly-solid circle with thin AA edge:

```typescript
// Current: solid circle with thin AA edge
if (dist <= solidRadius) alpha = 1.0;
else alpha = 1.0 - smoothstep(solidRadius, radius, dist);

// Proposed: Gaussian falloff
const sigma = radius * 0.4; // Controls falloff width
alpha = Math.exp(-(dist * dist) / (2 * sigma * sigma));
```

The stamp texture is pre-computed as `ImageData` and stored on an `OffscreenCanvas`, so there is zero runtime cost for the Gaussian profile — it is baked into the texture.

### Pros
- Zero additional runtime cost (texture is pre-computed)
- Most natural-looking blending between overlapping stamps
- Simple to implement — only change the texture generation function
- Works with existing `source-over` compositing pipeline
- Tunable via sigma parameter

### Cons
- Soft stamps deposit less ink at their edges, so more stamps may be needed for full coverage
- Very soft stamps can look blurry/airbrushy instead of pen-like
- Doesn't eliminate banding entirely — with enough zoom or large stamps, individual Gaussians are still visible
- Need to balance softness (anti-banding) vs. crispness (pen-like appearance)
- May require re-tuning the `baseOpacity` and overlap count parameters

### Applicability to Our Use Case

**Highly applicable.** This is the lowest-hanging fruit. Our current stamp texture (`InkStampTexture.ts`) uses a nearly-solid circle with only a 2-pixel AA band. Widening the falloff zone to, say, 20-30% of the radius would significantly reduce visible banding while keeping the pen-like character. This can be tuned with the `edgeDarkening` and grain parameters.

---

## Technique 4: Increased Stamp Density (Reduced Spacing)

### How It Works

Reduce the spacing between stamps so that each pixel is covered by many more overlapping stamps. As the number of overlapping stamps increases, the alpha accumulation curve becomes smoother and the "steps" between adjacent stamps become imperceptible.

With standard alpha compositing, the accumulated alpha after n overlapping stamps of opacity `a` is:

```
A_total = 1 - (1 - a)^n
```

As `n` increases (more overlap), the discrete steps in this curve become smaller. If you halve the spacing, you double `n` and halve the step size.

**Krita documentation** suggests spacing of 0.05 or less for smooth smearing, and auto-spacing of 0.8 is recommended for inking (where high coverage is needed).

### Canvas2D Feasibility

**Directly feasible.** Simply reduce the `spacing` parameter in `InkStampConfig`. Currently the spacing is ~0.15 of stamp diameter.

### Pros
- Trivial to implement — just change a parameter
- Directly reduces step visibility

### Cons
- **Linear performance cost**: halving spacing doubles the number of stamps to render, doubling draw calls
- Diminishing returns — going from 15% to 5% spacing triples stamp count but only modestly improves appearance
- Does not eliminate the fundamental issue — just makes steps smaller
- Can significantly impact performance for long strokes

### Applicability to Our Use Case

**Partially applicable as supplementary technique.** Modest spacing reduction (e.g., from 0.15 to 0.10) combined with softer stamp textures can be effective. Going below ~0.08 spacing would likely have unacceptable performance impact for real-time rendering on iPad.

---

## Technique 5: Flow vs. Opacity Separation (Photoshop Model)

### How It Works

This is a conceptual refinement of Technique 1. Separate the brush into two independent controls:

- **Flow**: Controls the opacity of each individual dab/stamp (how much paint each stamp deposits)
- **Opacity**: Controls the maximum opacity achievable in a single stroke (the cap)

In Photoshop's model:
- With Opacity=50% and Flow=100%: each stroke maxes out at 50% darkness, regardless of how many times you paint over the same area (within one stroke). Lifting the pen and re-stroking accumulates further.
- With Opacity=100% and Flow=10%: each dab deposits 10% opacity, and they accumulate toward 100%. This is where banding appears.
- With Opacity=50% and Flow=10%: each dab deposits 10%, accumulating toward a maximum of 50% within one stroke.

The internal implementation:
1. Render dabs at Flow opacity onto a stroke buffer
2. Clamp the stroke buffer's alpha to the Opacity value
3. Composite the clamped buffer onto the canvas

This gives "the best of both worlds": low flow for smooth gradual buildup, with a hard cap to prevent over-darkening.

### Canvas2D Feasibility

**Feasible with the existing offscreen buffer.** After rendering all stamps to the offscreen buffer:

```typescript
// Clamp alpha to stroke opacity cap
offCtx.globalCompositeOperation = 'destination-in';
offCtx.globalAlpha = maxStrokeOpacity; // e.g., 0.5
offCtx.fillStyle = '#fff';
offCtx.fillRect(0, 0, width, height);
```

The `destination-in` operation keeps existing pixels only where the new source has alpha, and `globalAlpha` scales all existing alpha values. A white rect at 50% alpha with `destination-in` effectively scales all buffer alpha by 50%.

**Correction**: Actually, `destination-in` multiplies existing alpha by source alpha. So drawing a solid rect with `globalAlpha = 0.5` using `destination-in` would multiply all existing alphas by 0.5. This is alpha scaling, not clamping. True clamping (hard cap at a value) would require pixel manipulation.

For a true cap, you could use two passes:
1. Render stamps normally
2. Read back with `getImageData`, clamp each alpha, write back with `putImageData`

Or accept the scaling approximation, which still reduces over-accumulation.

### Pros
- Industry-standard approach, well-understood
- Allows smooth buildup (low flow) with bounded result (opacity cap)
- Compatible with existing offscreen pipeline

### Cons
- True clamping requires `getImageData`/`putImageData` (slow)
- Scaling approximation via `destination-in` is not a true cap but still reduces the problem
- Same issue as Technique 1: a uniform opacity cap flattens velocity-dependent shading

### Applicability to Our Use Case

**Moderately applicable.** The scaling approximation can be layered into the existing pipeline. However, it conflicts with the velocity-shading goal unless the flow (per-stamp deposit) carries the velocity information while the opacity cap merely prevents over-accumulation at the center.

---

## Technique 6: Analytical Stamp Integration (Ciallo / Apoorvaj Approach)

### How It Works

Instead of placing discrete stamps and compositing them one by one, **analytically compute** the total alpha at each pixel from all stamps that would have overlapped it, as if the stamp were continuously slid along the stroke path.

From the [Apoorvaj paper](https://apoorvaj.io/efficient-rendering-of-linear-brush-strokes/):

```
alpha(X, Y) = integral from X1 to X2 of f(x, X, Y) dx
```

Where:
- `(X, Y)` = pixel coordinates
- `X1, X2` = range of stamp center positions where the stamp covers this pixel
- `f(x, X, Y)` = instantaneous alpha contribution from a stamp centered at position `x`

This integral can be evaluated in closed form for simple stamp profiles (e.g., constant or linear falloff). For a constant-alpha circular stamp, the integral reduces to the arc length of the circle at pixel distance from the stroke axis.

The [Ciallo SIGGRAPH 2024 paper](https://dl.acm.org/doi/10.1145/3641519.3657418) extends this to GPU rendering with stamp textures, handling varying radius along the stroke and computing stamp positions equidistantly via prefix sums in a fragment shader.

**Key benefit**: This renders the stroke in a single pass per pixel, with no overdraw. The alpha at each pixel is the correct continuous integral, not a discrete approximation.

### Canvas2D Feasibility

**Not directly feasible in Canvas2D.** This technique requires per-pixel computation (a fragment shader) and cannot be expressed through Canvas2D's draw calls and compositing operations. It is fundamentally a GPU shader technique.

However, a **CPU-based approximation** could work:
1. For each pixel in the stroke bounding box, compute the analytical integral
2. Write the result to an `ImageData` buffer
3. `putImageData` to an offscreen canvas, then composite

This would be extremely slow for real-time rendering but could be used for final/cached tile rendering where performance is less critical.

### Pros
- Mathematically perfect — zero banding by construction
- Single-pass rendering (no overdraw performance penalty)
- Handles varying stroke width and stamp properties smoothly
- Produces the "ideal" continuous-slide result

### Cons
- Requires GPU shaders (GLSL) for real-time performance
- CPU implementation too slow for interactive rendering
- Complex math for non-trivial stamp profiles (Gaussian, textured)
- Requires moving to WebGL/WebGPU rendering pipeline
- Significant architectural change

### Applicability to Our Use Case

**Not practical for current architecture.** This is the theoretically optimal solution but requires a fundamentally different rendering approach (GPU shaders). Worth considering if the project ever migrates to WebGL.

---

## Technique 7: Hybrid Deposit-and-Cap (Recommended for Our Use Case)

### How It Works

This is a practical combination designed specifically for our velocity-shaded fountain pen:

1. **Raise per-stamp flow**: Increase stamp opacity from the current ~0.01-0.35 range to a higher range (e.g., 0.15-0.6), so fewer overlapping stamps are needed to reach saturation
2. **Soften stamp texture**: Use a Gaussian or wide-falloff stamp profile (Technique 3) to smooth transitions at overlap boundaries
3. **Use the existing offscreen buffer**: Stamps accumulate on the offscreen canvas
4. **Apply velocity variation as a modulation of the flow**: Fast strokes get lower flow (lighter stamps), slow strokes get higher flow (darker stamps) — same as current approach but with recalibrated values
5. **Post-process the buffer before masking**: After all stamps are deposited, apply a subtle Gaussian blur or alpha smoothing to eliminate any remaining step artifacts. Then mask with `destination-in`.

The post-processing blur is the key new element. A small-radius blur (1-3px) on the offscreen buffer after stamp deposit but before path masking would smooth out any remaining banding artifacts without affecting the stroke outline (which is defined by the path mask, not the stamps).

### Canvas2D Feasibility

**Fully feasible.** All steps use existing Canvas2D operations:
- Stamp rendering: existing pipeline
- Blur: `ctx.filter = 'blur(2px)'` then re-draw the buffer onto itself (or use a second offscreen buffer)
- Path masking: existing `destination-in` approach

Note: `CanvasRenderingContext2D.filter` is well-supported and hardware-accelerated on Safari/WebKit (our target platform for iPad).

### Pros
- Works entirely within Canvas2D
- Minimal architectural change — extends existing pipeline
- Post-process blur is cheap (GPU-accelerated CSS filter)
- Velocity variation is preserved
- Path mask ensures crisp stroke edges despite internal blur

### Cons
- Blur may soften internal texture/grain details
- Need to tune blur radius relative to stamp size and zoom level
- Filter-based blur may have edge artifacts at buffer boundaries
- Adds one extra compositing step per stroke

### Applicability to Our Use Case

**Directly applicable.** This is the recommended first approach to try.

---

## Technique 8: Dithering / Blue Noise Perturbation

### How It Works

Add random or blue-noise-distributed perturbation to break up the regular patterns that make banding visible. Two sub-approaches:

**A) Position Jitter (already partially implemented):**
Randomize stamp positions slightly so that the overlap boundaries are irregular rather than forming clean circles. Our code already does this via the `feathering` parameter and `hashFloat` jitter.

**B) Alpha Dithering:**
Add small random noise to each stamp's opacity value, so the accumulation curve has random perturbation rather than smooth steps. This breaks up the visual regularity of banding without eliminating it:

```typescript
const noise = (hashFloat(stampCount, 0xDEADBEEF) - 0.5) * 0.1;
const finalOpacity = Math.max(0.01, deposit + noise);
```

**C) Blue Noise Texture Overlay:**
After rendering stamps to the offscreen buffer, overlay a blue noise texture using `destination-out` at very low opacity (e.g., 0.5/255) to break up banding at the quantization level. Blue noise is perceptually smoother than white noise.

The formula from [frost.kiwi](https://blog.frost.kiwi/GLSL-noise-and-radial-gradient/) for noise-based dithering:

```
output = color + (1.0/255.0) * noise(pixel) - (0.5/255.0)
```

This adds exactly one bit of noise, centered around zero, which breaks up 8-bit quantization steps.

### Canvas2D Feasibility

**Fully feasible.** Position jitter and alpha noise are trivial. Blue noise overlay requires pre-generating a blue noise texture and tiling it.

### Pros
- Very cheap computationally
- Position jitter already partially implemented
- Breaks up regular patterns that the eye detects
- Blue noise is especially effective — human vision is less sensitive to high-frequency noise

### Cons
- Does not eliminate banding — only disguises it
- Can introduce visible graininess if overdone
- Alpha dithering may look noisy at low stamp counts
- Blue noise texture adds memory overhead

### Applicability to Our Use Case

**Applicable as a supplementary technique.** Position jitter is already in use. Increasing it modestly and adding alpha perturbation are easy wins. Blue noise overlay is a more sophisticated version suitable for final polish.

---

## Technique 9: Opacity Linearization (MyPaint Approach)

### How It Works

When pressure is mapped to opacity and multiple dabs overlap, the relationship between pressure and perceived darkness becomes **nonlinear**. If you set opacity to 0.5 and 7 dabs overlap, the accumulated alpha is:

```
A = 1 - (1-0.5)^7 = 0.992
```

This is nearly opaque, not the "50% gray" the artist expects. MyPaint's `opaque_linearize` setting corrects this by computing the per-dab opacity needed to achieve the desired final opacity after the expected number of overlaps:

```
per_dab_opacity = 1 - (1 - target_opacity)^(1/n)
```

Where `n` is the expected number of overlapping dabs. With `opaque_linearize = 0.9`, this correction is applied strongly, making pressure response feel linear ("natural").

This doesn't eliminate banding directly but ensures that the stamp opacity values are calibrated so that accumulation produces the expected result.

### Canvas2D Feasibility

**Directly feasible.** This is purely a mathematical adjustment to the per-stamp opacity calculation, with no rendering pipeline changes.

### Pros
- Trivial to implement — just a formula change
- Makes opacity response more predictable
- Reduces the tendency to over-saturate, which can mask banding issues

### Cons
- Does not directly address banding artifacts
- Requires knowing the expected overlap count (depends on spacing and stamp size)
- Can make very light strokes too transparent

### Applicability to Our Use Case

**Applicable as a calibration improvement.** Our current deposit calculation already accounts for overlap count in comments (e.g., "~7 stamps overlap at centerline"), but the `baseOpacity` values are hand-tuned. Using the linearization formula would make tuning more principled.

---

## Technique 10: Subpixel Stamp Placement

### How It Works

From GIMP's architecture: the `paint_core_subsample_mask()` method shifts the brush shape by **quarter-pixel increments** so that the dab is placed with extremely good accuracy. Without sub-pixel placement, stamps snap to integer pixel boundaries, creating visible stairstep artifacts — especially at small sizes or diagonal strokes.

This uses pre-computed sub-pixel offset masks (typically 4x4 = 16 subpixel positions) to antialias the stamp placement.

### Canvas2D Feasibility

**Automatically handled.** Canvas2D's `drawImage` already uses sub-pixel positioning when you provide floating-point coordinates. The browser's compositor handles anti-aliasing. Our current implementation uses `setTransform` with floating-point translation values, so sub-pixel placement is already active.

### Pros
- Already handled by Canvas2D
- Important for small stamp sizes

### Cons
- Not applicable — already in use
- Only addresses placement artifacts, not overlap banding

### Applicability to Our Use Case

**Already implemented.** No action needed.

---

## Technique 11: Stamp Texture with Pre-multiplied Alpha Accumulation

### How It Works

Encode the stamp texture with **premultiplied alpha** so that compositing is numerically more stable and produces fewer rounding artifacts at 8-bit depth. With premultiplied alpha:

```
// Standard: color * alpha at composite time
result = src_color * src_alpha + dst_color * (1 - src_alpha)

// Premultiplied: color already includes alpha
result = src_premul_color + dst_premul_color * (1 - src_alpha)
```

Premultiplied alpha avoids "dark halos" at transparent edges where non-premultiplied compositing introduces black fringing due to RGB values of fully transparent pixels.

### Canvas2D Feasibility

**Partially feasible.** Canvas2D does not natively support premultiplied alpha textures — `putImageData` always uses straight (non-premultiplied) alpha. However, when using `drawImage` with an OffscreenCanvas source, the browser internally handles the conversion. The stamp texture could be authored in premultiplied form for better edge quality.

### Pros
- Eliminates dark edge halos
- Slightly more accurate compositing

### Cons
- Marginal improvement for our use case
- Canvas2D handles premultiplication internally during compositing
- Does not address the fundamental overlap banding issue

### Applicability to Our Use Case

**Low priority.** This addresses a subtly different problem (edge fringing vs. overlap banding). Worth noting but not a primary solution.

---

## Technique 12: Higher Bit Depth Rendering

### How It Works

Banding can be exacerbated by 8-bit color depth quantization. With only 256 possible alpha levels, subtle gradients between overlapping stamps "snap" to discrete levels, creating visible bands. Rendering at 16-bit or floating-point precision eliminates quantization-induced banding.

**Krita** supports 16-bit and 32-bit float rendering. Their documentation notes: "using higher bit depth with dithering will result in even smoother gradients but without dithering we will get just denser banding."

### Canvas2D Feasibility

**Not available.** Canvas2D is fixed at 8-bit per channel (RGBA8). There is no way to create a higher-precision canvas in the Canvas2D API.

WebGL2 supports `RGBA16F` and `RGBA32F` framebuffers, which would solve this entirely but requires a WebGL rendering pipeline.

### Pros
- Eliminates quantization-induced banding completely
- Standard approach in professional painting apps

### Cons
- Not available in Canvas2D
- Requires WebGL2 for GPU-accelerated higher precision
- 2x or 4x memory overhead for 16-bit or 32-bit buffers

### Applicability to Our Use Case

**Not applicable with current Canvas2D architecture.** The 8-bit limitation means we must rely on perceptual techniques (dithering, soft stamps) to compensate.

---

## Summary and Recommendations

### Priority 1 (Implement First)

| Technique | Effort | Impact | Notes |
|-----------|--------|--------|-------|
| **3. Soft Stamp Textures** | Low | High | Widen Gaussian falloff in `InkStampTexture.ts`. Zero runtime cost. |
| **8A. Position Jitter** | None | Medium | Already partially implemented via `feathering`. Increase slightly. |
| **8B. Alpha Dithering** | Low | Medium | Add small random noise to per-stamp opacity. |

### Priority 2 (Implement Next)

| Technique | Effort | Impact | Notes |
|-----------|--------|--------|-------|
| **7. Hybrid Deposit-and-Cap** | Medium | High | Post-process blur on offscreen buffer before path masking. |
| **4. Increased Stamp Density** | Low | Medium | Modest spacing reduction (0.15 to 0.10). Watch performance. |
| **9. Opacity Linearization** | Low | Medium | Better calibration of per-stamp opacity for expected overlap. |

### Priority 3 (Consider Later)

| Technique | Effort | Impact | Notes |
|-----------|--------|--------|-------|
| **1. Wash Mode** | Medium | High | Uniform stroke opacity. Conflicts with velocity shading but could be a separate mode. |
| **5. Flow vs. Opacity** | Medium | High | Need pixel-level clamping for true cap. |
| **2. Alpha-Darken** | High | Very High | Requires WebGL. Perfect solution if/when we migrate. |
| **6. Analytical Integration** | Very High | Perfect | Requires GPU shaders. Theoretically ideal. |
| **12. Higher Bit Depth** | N/A | High | Requires WebGL2. |

### Recommended Implementation Order

1. **Soften the stamp texture** in `InkStampTexture.ts` — change the alpha profile from hard-circle-with-thin-AA to a wider Gaussian or smoothstep falloff. This is the single biggest bang-for-buck change.

2. **Increase alpha dithering** — add small random noise to per-stamp opacity in `computeInkStamps()`.

3. **Add post-deposit blur** to the offscreen buffer in `renderInkShadedStroke()` — apply `ctx.filter = 'blur(1px)'` before the `destination-in` mask step.

4. **Recalibrate opacity values** using the linearization formula from MyPaint, targeting the expected overlap count.

5. **Modestly reduce spacing** if banding persists after the above changes.

---

## Sources

- [Efficient Rendering of Linear Brush Strokes (Apoorvaj)](https://apoorvaj.io/efficient-rendering-of-linear-brush-strokes/)
- [Ciallo: GPU-Accelerated Rendering of Vector Brush Strokes (SIGGRAPH 2024)](https://dl.acm.org/doi/10.1145/3641519.3657418)
- [Brush Rendering Tutorial by ShenCiao](https://shenciao.github.io/brush-rendering-tutorial/Basics/Stamp/)
- [Krita Manual: Opacity and Flow](https://docs.krita.org/en/reference_manual/brushes/brush_settings/opacity_and_flow.html)
- [Krita: Color Banding Workarounds](https://krita-artists.org/t/color-banding-and-how-to-worka-around-it-softer-brushes/23178)
- [Krita Feature Request: Better Dithering for Soft Brushes](https://krita-artists.org/t/better-dithering-for-krita-soft-brushes-or-brush-engine-to-be-able-to-get-soft-and-smooth-transitions-without-grains-artefacts-or-rim-like-transitions/98184)
- [MyPaint: Wash Mode Discussion](https://community.mypaint.app/t/wash-mode-like-in-krita-for-brushes/873/5)
- [libmypaint DeepWiki](https://deepwiki.com/mypaint/libmypaint)
- [Drawpile: Interpolated Alpha Darken for Wash Mode](https://github.com/drawpile/Drawpile/issues/1446)
- [Procreate Brush Studio Settings](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
- [Procreate Glazed Brushes Guide](https://adventureswithart.com/procreate-glazed-brushes/)
- [Photoshop: Flow vs. Opacity](https://photoshopcafe.com/use-flow-opacity-photoshop-brushes/)
- [Photoshop Brush Engine Introduction](https://essenmitsosse.de/photoshop-brush-engine)
- [GIMP Brush Architecture (Raph Levien)](https://levien.com/gimp/brush-arch.html)
- [GLSL Noise and Radial Gradient (frost.kiwi) — Dithering Techniques](https://blog.frost.kiwi/GLSL-noise-and-radial-gradient/)
- [Konva: Disable Perfect Draw (Buffer Canvas)](https://konvajs.org/docs/performance/Disable_Perfect_Draw.html)
- [MDN: globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)
- [MDN: OffscreenCanvasRenderingContext2D](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvasRenderingContext2D)
