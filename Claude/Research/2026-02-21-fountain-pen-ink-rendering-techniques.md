# Fountain Pen Ink Rendering Techniques for Canvas 2D

**Date:** 2026-02-21
**Purpose:** Research digital rendering techniques for realistic fountain pen ink effects using Canvas 2D / OffscreenCanvas in a tile-based Web Worker architecture.

---

## Table of Contents

1. [Stamp-Based Stroke Rendering (Adapting Pencil Approach)](#1-stamp-based-stroke-rendering)
2. [Canvas 2D Compositing for Ink Effects](#2-canvas-2d-compositing-for-ink-effects)
3. [Texture Generation for Ink](#3-texture-generation-for-ink)
4. [Color Gradation Within Strokes](#4-color-gradation-within-strokes)
5. [Academic and Industry Approaches](#5-academic-and-industry-approaches)
6. [Performance Considerations](#6-performance-considerations)
7. [Existing Implementations](#7-existing-implementations)
8. [Synthesis: Recommended Approach for ObsidianPaper](#8-synthesis-recommended-approach)

---

## 1. Stamp-Based Stroke Rendering

### Current ObsidianPaper Approach (Pencil)

The existing pencil renderer uses a **particle scatter model**: at each step along the stroke path, many tiny particles are randomly scattered within the stroke disk. The key parameters are:

- **Particle size**: `max(0.6, width * 0.08)` -- particles are small and independent of stroke width
- **Particle count per step**: `max(1, round(1.5 * diameter / particleSize))` -- wider strokes get more particles
- **Spacing**: Controlled by `stampConfig.spacing * particleSize`
- **Distribution**: Center-biased radial (`pow(r, 0.8)` vs `sqrt(r)` for uniform disk)
- **Edge falloff**: Quadratic `1 - (r/radius)^2`
- **Grain noise**: Smooth 2D value noise using bilinear interpolation of hashed grid values

### Adapting for Fountain Pen Ink

The pencil scatter model creates a granular, textured appearance. For fountain pen ink, the key differences are:

**Ink blob stamps instead of particle dots:**
- Larger stamp sizes (closer to stroke width) rather than tiny particles
- Semi-transparent stamps that overlap significantly
- Soft-edged circular or slightly irregular shapes
- Each stamp represents an "ink deposit" rather than a graphite particle

**Opacity accumulation instead of density variation:**
- Pencil: Many tiny particles at varying density create texture
- Fountain pen: Fewer, larger, overlapping semi-transparent stamps create ink depth
- Overlapping stamps naturally darken -- this IS the ink accumulation effect
- The alpha compositing formula for N overlapping stamps at opacity `a` each: `total_alpha = 1 - (1 - a)^N`

**Velocity-dependent stamp parameters:**
- Slower movement = stamps placed closer together = more overlap = darker ink
- Faster movement = stamps spaced further apart = less overlap = lighter ink
- This naturally creates the shading effect where slow strokes are dark and fast strokes are light

### Stamp Shape for Ink

Rather than perfect circles, ink stamps should have slight irregularity:

- **Pre-rendered stamp textures**: Create a small (32x32 or 48x48) canvas with a soft-edged blob
- **Edge roughness via noise**: Apply low-frequency noise to the stamp's radial opacity profile
- **Multiple stamp variants**: Pre-generate 4-8 stamp variants, select via deterministic hash
- **Rotation jitter**: Random rotation per stamp (unlike pencil which uses 0 rotation)

### Recommended Stamp Parameters for Ink

```
stampSize:    width * 0.6  (large relative to stroke, not tiny like pencil)
spacing:      0.15 * stampSize  (dense overlap for ink continuity)
baseOpacity:  0.15-0.25 per stamp  (builds up through overlap to ~0.8-0.95)
edgeSoftness: Gaussian falloff, sigma = 0.35 * radius
jitter:       position +-5% of radius, rotation full 2*PI
```

---

## 2. Canvas 2D Compositing for Ink Effects

### Relevant Composite Operations

**`source-over` (default):** Standard alpha blending. Each new stamp composites over previous content. Semi-transparent stamps naturally accumulate:
- Formula: `result = src * srcAlpha + dst * (1 - srcAlpha)`
- For ink: Overlapping semi-transparent stamps produce darker areas where there's more overlap
- This is the primary mode for ink rendering

**`multiply`:** Multiplies color channels of source and destination. Produces darker results:
- Formula: `result = src * dst` (per channel, normalized 0-1)
- Good for: Ink layering effects where overlapping strokes darken each other
- Currently used by highlighter mode in ObsidianPaper
- Useful for rendering ink over existing content (text, other strokes)
- Limitation: Only darkens; white becomes transparent

**`darken`:** Keeps the darker pixel at each position:
- Formula: `result = min(src, dst)` (per channel)
- Good for: Preventing over-darkening at intersections
- Less useful for ink accumulation (doesn't blend, just picks darker)

### Compositing Strategy for Ink

The recommended approach uses two compositing modes:

1. **Within a stroke** (stamp accumulation): Use `source-over` with semi-transparent stamps. The natural alpha accumulation creates the ink darkening effect.

2. **Between strokes** (stroke layering): Use `source-over` for normal ink layering. Consider `multiply` for extra darkening at crossings.

3. **Edge darkening effect**: Fountain pen ink characteristically pools at stroke edges. This can be achieved by:
   - Rendering the stroke fill at base opacity
   - Adding a slightly darker, thinner stroke along both edges
   - Or: Using stamps with a "donut" profile (slightly less opacity in center, more at edges)

### Alpha Accumulation Math

For N overlapping stamps each with opacity `a`:
```
resultAlpha = 1 - (1-a)^N

Examples (a = 0.2 per stamp):
  1 stamp:  0.20
  2 stamps: 0.36
  3 stamps: 0.49
  5 stamps: 0.67
  8 stamps: 0.83
 12 stamps: 0.93
 20 stamps: 0.99
```

This logarithmic buildup naturally produces the ink shading gradient: rapid darkening initially, then asymptotically approaching full opacity. This matches how real ink behaves -- dwell areas get very dark but never exceed pure black.

---

## 3. Texture Generation for Ink

### Ink Grain / Paper Interaction Texture

Real fountain pen ink interacts with paper fibers, creating subtle texture. To simulate this:

**Noise-based grain (procedural):**
- Use smooth 2D value noise (already implemented in `StampRenderer.ts` via `smoothNoise2D`)
- For ink: Use larger noise scale (softer, more gradual variation) compared to pencil
- Two octaves of noise: coarse (ink flow variation) + fine (paper grain interaction)
- Apply as opacity modulation on each stamp: `stampOpacity *= (0.85 + 0.15 * noise)`
- This creates subtle ink density variation that mimics paper absorption irregularity

**Paper fiber texture (pre-generated):**
- The existing `GrainTextureGenerator` creates tileable noise via 4D torus mapping with simplex noise
- For ink: Use a DIFFERENT grain configuration with lower threshold (denser) and higher softness (smoother transitions)
- Grain config for ink: `{ tileSize: 256, scale: 15, octaves: 2, threshold: 0.7, softness: 0.15 }`
- Apply sparingly -- ink on good paper has LESS visible texture than pencil

### Edge Roughness

Real fountain pen strokes don't have perfectly smooth edges. Techniques:

**Noise displacement on stamp edges:**
- When computing each stamp's position, add small random offsets: `pos += noise(stampIndex) * width * 0.03`
- Deterministic via hash function (already implemented as `hash32` / `hashFloat`)

**Irregular stamp shapes:**
- Pre-render stamp textures with slightly noisy edges
- Generate by: Create a circle, apply radial noise to the edge alpha
- Formula: `alpha(r, theta) = smoothstep(r, radius + noise(theta) * radius * 0.08)`
- This produces stamps that aren't perfectly round, creating organic edge texture

**Feathering at edges:**
- Soft Gaussian falloff at stamp edges rather than hard cutoff
- `edgeAlpha = exp(-r^2 / (2 * sigma^2))` where `sigma = radius * 0.4`
- Creates a slight "bleeding" effect at the stroke boundary

### Generating Ink Stamp Textures Procedurally

```
For each stamp variant (generate 4-8):
  1. Create 48x48 canvas
  2. For each pixel (px, py) relative to center:
     a. Compute r = distance from center
     b. Compute theta = angle from center
     c. Add radial noise: r_noisy = r + noise(theta, variant) * radius * 0.06
     d. Compute alpha = gaussian(r_noisy, sigma=radius*0.38) * (0.9 + 0.1*noise2D(px, py))
     e. Apply paper grain: alpha *= (0.85 + 0.15 * grainNoise(px, py))
  3. Store as ImageData for use with drawImage()
```

---

## 4. Color Gradation Within Strokes

### Physical Basis

Real fountain pen ink shading occurs because:
- Ink is liquid and pools in certain places while writing
- Slower movement deposits more ink = darker
- Faster movement stretches ink thinner = lighter
- At stroke start (pen down) and end (pen lift), ink pools = darker blobs
- At sharp direction changes where the pen dwells = darker areas
- Within the stroke cross-section: ink pools at edges (meniscus effect) creating the characteristic "darker edges, lighter center" of shading inks

### Velocity-Based Opacity Modulation

ObsidianPaper already has timestamp data in `StrokePoint`, enabling velocity computation:

```typescript
velocity = sqrt(dx^2 + dy^2) / dt

// Map velocity to opacity multiplier
// Slow = dark (more ink), Fast = light (less ink)
opacityMultiplier = lerp(maxOpacity, minOpacity, clamp(velocity / velocityThreshold, 0, 1))

// Suggested values:
velocityThreshold = 0.8  // px/ms (tune by testing)
maxOpacity = 1.0          // at rest / very slow
minOpacity = 0.4          // at fast movement
```

This is already partially implemented in `InkPooling.ts` which detects low-velocity points. The same velocity data can drive per-stamp opacity modulation.

### Within-Stroke Cross-Section Profile

Fountain pen ink characteristically has darker edges and lighter center (shading effect). This is the OPPOSITE of the pencil model which has center-biased density.

**Approach 1: Inverted radial profile**
```
edgeEmphasis = smoothstep(0.4, 0.9, r/radius)
centerDeemphasis = 1 - (1 - r/radius)^2 * 0.3
opacity = baseOpacity * centerDeemphasis + edgeEmphasis * 0.15
```

**Approach 2: Two-pass rendering**
1. Fill stroke at base opacity (light center)
2. Add edge emphasis with a slightly narrower clip + destination-out, then re-fill edges

**Approach 3: Stamp profile** (recommended for stamp-based approach)
- Each stamp has a slight "donut" opacity profile: a little less in the very center, building to full at about 70% radius, then falling off at the edge
- `alpha(r) = gaussian(r, sigma=0.45*R) * (0.7 + 0.3 * smoothstep(0.2*R, 0.6*R, r))`

### Stroke Start/End Ink Pooling

Already implemented in `InkPooling.ts`:
- Detects stroke start, end, and sharp direction changes
- Renders radial gradient blobs at those locations
- Uses velocity threshold of 0.3 px/ms and curvature threshold of 0.5 radians
- Pool opacity scaled by pressure and dwell factor

For the stamp-based approach, pooling could be integrated directly:
- At stroke start/end: emit extra stamps with higher opacity and slightly larger size
- At low-velocity segments: reduce stamp spacing = more overlap = darker

---

## 5. Academic and Industry Approaches

### Foundational Papers

**Strassmann, "Hairy Brushes" (SIGGRAPH 1986)**
- Models brushes as collections of bristles evolving over the stroke
- Four modular components: Brush (bristles), Stroke (trajectory), Dip (paint application), Paper (display mapping)
- Key insight: Separate the physical model (brush/ink) from the rendering model (how it appears on paper)
- Relevance: The modular approach applies well -- separate ink deposition computation from rendering

**Curtis et al., "Computer-Generated Watercolor" (SIGGRAPH 1997)**
- Three-layer fluid model: shallow-water (fluid dynamics), pigment-deposition (ink transfer to paper), capillary layer (wicking through paper fibers)
- Kubelka-Munk model for optical compositing of translucent glazes
- Key insight: Ink behavior can be approximated with simple fluid simulation layers
- Relevance: The pigment deposition layer concept maps directly to stamp opacity accumulation; the capillary layer maps to edge feathering

**Chu & Tai, "MoXi: Real-time Ink Dispersion in Absorbent Paper" (SIGGRAPH 2005)**
- Lattice Boltzmann equation for simulating percolation in paper
- Real-time simulation of ink dispersion effects
- Key insight: Paper is modeled as a disordered porous medium; ink flow follows Darcy's law
- Relevance: Too computationally expensive for real-time handwriting, but the visual effects (edge darkening, fiber-following diffusion) can be approximated with texture and noise

**Winkenbach & Salesin, "Computer-Generated Pen-and-Ink Illustration" (SIGGRAPH 1994)**
- Stroke textures: collections of strokes arranged in patterns for tone and texture
- Controlled-density hatching for conveying surface properties
- Relevance: Concept of "stroke textures" as higher-level primitives

### Key Patent: Microsoft Variable Opacity Stroke Rendering (US20170278275A1)

This patent describes the state of the art in stamp-based ink rendering for touchscreen devices:

**Dual-Texture System:**
- Paper texture (static, represents paper surface)
- Noise texture (varies along stroke path, using Perlin noise, shifts based on distance from stroke start)
- These combine to create natural-looking variation

**Alpha Blending Formula:**
```
ShaderOutput_RGB = PencilColor * (1 - M^n)
ShaderOutputAlpha = 1 - M^n
```
Where M = blend coefficient, n = deposition count (can be fractional)

**Key innovations:**
- Treats pixel weight as count of times a fixed-opacity color is blended (fractional count)
- Stamp rearranging to minimize artifacts from overlapping strokes
- Noise texture offset varies with distance along the stroke path
- Paper texture + noise texture combined with pressure-dependent weighting
- Paper texture contribution increases toward stroke interior and under heavy pressure

**Performance optimization:**
- Arc caching for segment calculations
- Bounding rectangle culling
- Batch rendering of multiple stamps
- Instancing: reduces memory bandwidth from 42 to 3 floats per stamp

### Ciallo: GPU-Accelerated Rendering of Vector Brush Strokes (SIGGRAPH 2024)

The most recent significant work on brush rendering:

**Stamp rendering technique:**
- Places stamps equidistantly along polyline using parallel prefix sum of edge lengths
- Fragment shader calculates stamp positions
- Each pixel only samples stamps that can cover it (not all stamps) -- constrains loop range via quadratic equation
- Achieves real-time performance with hundreds of strokes / thousands of vertices

**Opacity accumulation:**
```glsl
A = A * (1.0 - opacity) + opacity  // Alpha compositing per-stamp
outColor = vec4(RGB, A)
```

**Overdraw solution (from related work by Apoorva Joshi):**
- Traditional approach: Repeatedly stamp textures, causing GPU memory thrashing
- Efficient approach: Model stamp as continuously sliding along centerline
- Compute pixel intensity via integration rather than repeated writes
- `alpha(X,Y) = integral[X1 to X2] f(x, X, Y) dx`
- This eliminates overdraw entirely but requires more computation per pixel

**Relevance:** The prefix sum and loop-constraining techniques are GPU-specific (compute shaders). For Canvas 2D, the simpler stamp-spacing approach is appropriate, but the opacity accumulation formula is directly applicable.

### Wacom WILL SDK Ink Pipeline

Professional ink rendering architecture:

**Two rendering modes:**
1. Vector Ink (shape-filling): Solid color, variable width -- like `perfect-freehand`
2. Particle Ink (raster/stamp): Overlapping particles for expressive tools (pencil, watercolor, ink)

**Pipeline stages:**
1. PathProducer: Converts input to internal path
2. Smoother: Double Exponential Smoothing (reduces noise, one-point lag)
3. SplineProducer: Creates Centripetal Catmull-Rom splines
4. SplineInterpolator: Discretizes spline with configurable spacing
5. (Vector only) BrushApplier -> ConvexHullChainProducer -> PolygonMerger -> PolygonSimplifier

**Key insight:** Separate input processing pipeline from rendering. The interpolator stage is where stamp spacing is determined, using Catmull-Rom interpolation rather than linear.

---

## 6. Performance Considerations

### iPad via Obsidian (Electron/WebView) Constraints

- iPad Pro resolution: 2388x1668 (4 million pixels), 120Hz ProMotion
- WebKit-based rendering engine
- GPU memory is shared with system
- Web Workers available for OffscreenCanvas
- No WebGL2 compute shaders (Canvas 2D only)

### Stamp Count Budget

For real-time rendering during active stroke input at 120Hz:

**Per-frame budget:** ~8ms (120fps) or ~16ms (60fps target)

**Stamp rendering costs (Canvas 2D):**
- `drawImage()` from pre-rendered stamp: ~0.005-0.01ms per stamp (GPU-accelerated)
- `arc()` + `fill()`: ~0.01-0.02ms per stamp (path rasterization)
- `setTransform()`: Very cheap, near-zero cost
- `globalAlpha` change: Very cheap

**Estimated stamp budget per frame:**
- Conservative (60fps, 50% render budget): ~400-800 stamps per frame
- Aggressive (30fps during input, catch up later): ~1600 stamps per frame

**Current pencil model:** For a 6px wide stroke moving at moderate speed:
- Particle size: `max(0.6, 6 * 0.08)` = 0.6
- Particles per step: `max(1, round(1.5 * 6 / 0.6))` = 15
- Spacing: `0.5 * 0.6` = 0.3 world units between steps
- At 60px/frame movement: 200 steps * 15 particles = 3000 stamps per frame (TOO MANY for ink)

**Ink stamp model (recommended):**
- Stamp size: `6 * 0.6` = 3.6
- Stamps per step: 1 (single stamp, not scattered)
- Spacing: `0.15 * 3.6` = 0.54 world units
- At 60px/frame movement: 111 stamps per frame (GOOD)

### Optimization Techniques

**1. Pre-rendered stamp textures:**
- Generate stamp variants as ImageBitmap objects (GPU-resident)
- Use `drawImage(stampBitmap, x, y, w, h)` instead of `arc()` + `fill()`
- Pre-render at multiple sizes for LOD (avoid sub-pixel scaling artifacts)
- Transfer ImageBitmap to Web Workers for tile rendering

**2. Batch state changes:**
- Minimize `globalAlpha` changes (group stamps by similar opacity)
- Minimize `globalCompositeOperation` changes
- Use `setTransform()` for positioning (cheap) rather than `translate()/scale()` (create matrix objects)

**3. Spatial culling:**
- Only render stamps whose bounding box intersects the tile being rendered
- For tile-based rendering: Each tile only processes strokes whose bbox overlaps

**4. LOD (Level of Detail):**
- At zoom < 50%: Skip stamp-based rendering, fall back to filled polygon (already implemented)
- At zoom 50-100%: Reduce stamp count (increase spacing)
- At zoom > 100%: Full stamp rendering

**5. Integer coordinates:**
- Round stamp positions to integers: `Math.round(screenX)`, `Math.round(screenY)`
- Avoids sub-pixel rendering penalty (documented Canvas 2D optimization)

**6. Active stroke optimization:**
- During active drawing: Only render new stamps (incremental, via `StampAccumulator`)
- Completed strokes: Pre-compute all stamps, cache the result
- The existing `StampCache` in ObsidianPaper already handles this

### Stamps Per Pixel Guidance

For a continuous-looking stroke without visible individual stamps:

- **Minimum overlap**: Each point on the stroke centerline should be covered by at least 3-4 stamps
- **Spacing rule**: `spacing <= stampDiameter * 0.25` for seamless appearance
- **Diminishing returns**: Beyond `spacing = stampDiameter * 0.1`, additional stamps don't visibly improve quality but cost performance
- **Recommended**: `spacing = stampDiameter * 0.15` (good quality/performance balance)

---

## 7. Existing Implementations

### Perfect Freehand (steveruizok/perfect-freehand)

**Approach:** Generates a polygon outline around input points, NOT stamp-based.

**Algorithm:**
1. `get_stroke_points()`: Pre-process input (normalize, smooth, add metadata)
2. `get_stroke_outline_points()`: Transform smoothed points to outline polygon
3. Output: Array of outline points forming a closed polygon to be filled

**Key features:**
- Pressure-sensitive variable width
- Simulated pressure from point distance (when no real pressure)
- Thinning parameter controls how pressure affects width
- Taper at start/end of strokes
- Smoothing and streamline parameters

**Relevance to fountain pen:** Perfect Freehand produces the SHAPE (outline) of variable-width strokes. This is what ObsidianPaper already uses for fountain pen via `OutlineGenerator`. The stamp-based approach would REPLACE this with a rasterized alternative that can include texture and ink effects that polygon filling cannot achieve.

### Excalidraw

**Approach:** Two-layer canvas architecture (static + interactive). Uses RoughJS for hand-drawn aesthetic. Not stamp-based; uses path rendering with roughness.

**Rendering architecture:**
- Static Canvas: Renders drawing elements using `drawElementOnCanvas()`
- Interactive Canvas: Dynamic overlays (selection handles, cursors)
- New element being drawn: Rendered on a third canvas
- Minimizes redraws by separating static from interactive content

**Relevance:** The multi-canvas architecture pattern is relevant. ObsidianPaper already uses a similar pattern with active/prediction canvases and tile-based static rendering.

### Procreate Brush Engine

**Approach:** Shape (container) + Grain (texture) composition model.

**Key rendering modes:**
- **Light Glaze:** Lays down one shade for entire stroke; color doesn't build up within a single continuous stroke. Good for consistent ink lines.
- **Intense Blending:** Color deepens the more you go over it, even without lifting stylus. Good for ink accumulation effects.
- **Rendering slider:** Controls how glazed or blended brushstrokes appear.

**Stamp mechanics:**
- Shape defines the container (circle, custom bitmap)
- Grain defines the interior texture
- Antialiasing controls grain edge quality
- StreamLine parameter for smooth, consistent inking

**Relevance:** The Light Glaze vs Intense Blending distinction is important:
- For fountain pen: Use something between these -- accumulation WITHIN a stroke (slow areas darken) but with limits (don't go to full black from overlap alone)
- The shape+grain composition model maps well to the stamp texture approach

### JS-Draw (personalizedrefrigerator/js-draw)

**Approach:** Freehand drawing library for JavaScript/TypeScript. Used in Joplin plugin.

**Features:**
- Pen, touchscreen, and mouse support
- `StrokeComponent` with `Stroke.fromStroked` and `Stroke.fromFilled` methods
- `PolylineBuilder` for pen-like line rendering
- SVG-based output (vector, not raster stamps)

**Relevance:** Limited -- JS-Draw focuses on vector output and smooth line rendering, not textured/stamp-based ink effects.

### Wacom WILL SDK (JavaScript)

**Approach:** Professional ink SDK with both vector and particle rendering modes.

**Particle ink rendering:** Overlapping particles for expressive brushes. Uses Catmull-Rom spline interpolation for stamp placement. Available as JavaScript library with WebGL rendering.

**Relevance:** The most directly comparable implementation. However, it uses WebGL (not Canvas 2D) and is proprietary.

---

## 8. Synthesis: Recommended Approach for ObsidianPaper

### Architecture Overview

Build on the existing stamp infrastructure (StampRenderer, StampCache, StampAccumulator) with a new ink-specific stamp configuration and rendering path.

### Key Differences from Pencil Stamps

| Aspect | Pencil (Current) | Fountain Pen Ink (Proposed) |
|--------|------------------|---------------------------|
| Stamp size | Tiny (0.6-2px particles) | Large (60% of stroke width) |
| Stamps per step | Many (15+ scattered) | Few (1-3 along centerline) |
| Distribution | Random scatter within disk | Along centerline with slight jitter |
| Opacity per stamp | Variable (grain noise) | Low, uniform (0.15-0.25, builds up) |
| Edge profile | Quadratic falloff from center | Gaussian with slight center hollow |
| Compositing | source-over | source-over (multiply for cross-strokes) |
| Velocity effect | None | Slower = closer spacing = darker |
| Grain texture | High contrast, paper-like | Subtle, smooth variation |

### Implementation Steps

**Step 1: Ink stamp texture generation**
- Procedurally generate 4-8 ink blob stamp variants (48x48)
- Gaussian opacity profile with slight edge noise for organic feel
- Optional: slight center hollow for shading ink effect
- Store as ImageBitmap for efficient drawImage()

**Step 2: Ink stamp computation**
- Modify `computeStamps()` to support ink mode:
  - Single stamp per step (not scatter)
  - Spacing = `0.15 * stampSize`
  - Velocity-based opacity modulation
  - Small position jitter for edge roughness
  - Per-stamp rotation for texture variation

**Step 3: Ink stamp rendering**
- Modify `drawStamps()` to use `drawImage()` with pre-rendered stamp textures
- Apply velocity-based opacity per stamp
- Use `source-over` compositing (natural alpha accumulation)

**Step 4: Ink pooling integration**
- At stroke start/end: Extra stamps with higher opacity and larger size
- At low-velocity points: Reduce spacing (increase overlap density)
- At direction changes: Emit extra stamp at the apex

**Step 5: Paper grain overlay**
- Subtle grain modulation on stamp opacity (use existing noise infrastructure)
- Much subtler than pencil -- ink on paper has less visible texture
- Only visible at high zoom levels

### Compositing Pipeline

```
For each stroke (in z-order):
  1. Compute stamps with velocity-based opacity
  2. For each stamp:
     a. ctx.globalAlpha = stamp.opacity * velocityOpacity * grainNoise
     b. ctx.drawImage(stampTexture[hash % numVariants], x, y, w, h)
  3. Render ink pools at start/end/dwell points
```

### Expected Visual Result

- Smooth, flowing ink strokes with subtle edge roughness
- Natural shading: darker where pen moves slowly, lighter where it moves fast
- Ink pooling at stroke start, end, and direction changes
- Subtle paper grain visible at high zoom
- Semi-transparent character -- overlapping strokes naturally darken
- Performance: ~100-200 stamps per frame for typical writing (well within budget)

### What NOT to Implement

- Full fluid simulation (lattice Boltzmann, Navier-Stokes) -- too expensive for real-time handwriting
- WebGL/GPU shader approach -- Canvas 2D only for compatibility and Web Worker support
- Per-pixel ink diffusion -- approximated with stamp textures and grain noise instead
- Chromatographic separation (color splitting at edges) -- too subtle to be visible at handwriting scale

---

## Sources

### Brush Rendering Tutorials and Techniques
- [Brush Rendering Tutorial - Stamp](https://shenciao.github.io/brush-rendering-tutorial/Basics/Stamp/) - Comprehensive tutorial on stamp-based brush rendering
- [Efficient Rendering of Linear Brush Strokes](https://apoorvaj.io/efficient-rendering-of-linear-brush-strokes/) - Overdraw-free brush rendering via integration
- [Exploring Canvas Drawing Techniques](https://perfectionkills.com/exploring-canvas-drawing-techniques/) - Canvas 2D brush techniques with code examples

### Academic Papers
- [Ciallo: GPU-Accelerated Rendering of Vector Brush Strokes (SIGGRAPH 2024)](https://dl.acm.org/doi/10.1145/3641519.3657418)
- [Computer-Generated Watercolor (Curtis et al., SIGGRAPH 1997)](https://grail.cs.washington.edu/projects/watercolor/)
- [Hairy Brushes (Strassmann, SIGGRAPH 1986)](https://dl.acm.org/doi/10.1145/15886.15911)
- [MoXi: Real-time Ink Dispersion in Absorbent Paper (SIGGRAPH 2005)](https://dl.acm.org/doi/10.1145/1073204.1073221)
- [Winkenbach & Salesin - Computer-Generated Pen-and-Ink Illustration](https://history.siggraph.org/learning/computer-generated-pen-and-ink-illustration-by-winkenbach-and-salesin/)
- [Diffusion Rendering of Black Ink Paintings](https://www.sciencedirect.com/science/article/abs/pii/S0097849300001321)

### Patents
- [US20170278275A1 - Shading for Variable Opacity Stroke Rendering (Microsoft)](https://patents.google.com/patent/US20170278275A1/en) - Dual-texture stamp-based ink rendering
- [US10235778 - GPU-Accelerated Pencil Ink Effect Rendering (Microsoft)](https://patentcut.com/10235778)

### Canvas 2D Performance and Optimization
- [Optimizing Canvas (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [OffscreenCanvas (web.dev)](https://web.dev/articles/offscreen-canvas)
- [Canvas 2D Performance (web.dev)](https://web.dev/canvas-performance/)
- [globalCompositeOperation (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)

### Libraries and Open-Source Projects
- [Perfect Freehand](https://github.com/steveruizok/perfect-freehand) - Pressure-sensitive outline generation
- [Ciallo (Open Source)](https://github.com/ShenCiao/Ciallo) - GPU-accelerated vector paint program
- [Brush Rendering Tutorial (GitHub)](https://github.com/ShenCiao/brush-rendering-tutorial) - Tutorial series with code
- [JS-Draw](https://github.com/personalizedrefrigerator/js-draw) - Freehand drawing library

### Wacom SDK Documentation
- [Ink Geometry Pipeline & Rendering](https://developer-docs.wacom.com/docs/sdk-for-ink/tech/pipeline/) - Professional ink rendering architecture

### Fountain Pen Ink Behavior
- [JetPens - Intermediate Guide to Fountain Pen Inks](https://www.jetpens.com/blog/Intermediate-Guide-to-Fountain-Pen-Inks-Sheen-Shading-Shimmer-and-More/pt/113)
- [Fountain Pen Love - What Is Ink Shading?](https://fountainpenlove.com/fountain-pen-ink/fountain-pen-ink-shading/)
- [ScienceDirect - Fountain Pen Ink Properties](https://www.sciencedirect.com/science/article/pii/S0264127522003616)

### Procreate Brush Engine
- [Brush Studio Settings (Procreate Handbook)](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings) - Rendering modes and brush composition

### Procedural Texture Generation
- [Procedural Textures in JavaScript](https://clockworkchilli.com/blog/6_procedural_textures_in_javascript)
- [Perlin Noise Algorithm](https://rtouti.github.io/graphics/perlin-noise-algorithm)

### Alpha Compositing
- [Alpha Compositing (Wikipedia)](https://en.wikipedia.org/wiki/Alpha_compositing)
- [Alpha Compositing (Bartosz Ciechanowski)](https://ciechanow.ski/alpha-compositing/) - Interactive visual explanation
- [Porter/Duff Compositing and Blend Modes](https://ssp.impulsetrain.com/porterduff.html)
