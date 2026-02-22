# Fountain Pen Ink Visual Characteristics for Canvas 2D Rendering

**Date:** 2026-02-21
**Purpose:** Detailed visual analysis of fountain pen ink on paper, focused on characteristics that can be implemented in a stamp-based Canvas 2D rendering system. Complements the existing `fountain-pen-ink-physics.md` (physical mechanisms) and `fountain-pen-ink-rendering-techniques.md` (implementation architecture).

---

## Table of Contents

1. [Edge Darkening (Coffee Ring Effect)](#1-edge-darkening-coffee-ring-effect)
2. [Ink Shading Techniques](#2-ink-shading-techniques)
3. [Paper Texture Interaction](#3-paper-texture-interaction)
4. [Stroke Start/End Characteristics](#4-stroke-startend-characteristics)
5. [Intersection Behavior](#5-intersection-behavior)
6. [Micro-Texture of Ink on Paper](#6-micro-texture-of-ink-on-paper)
7. [Synthesis: Rendering Parameter Guide](#7-synthesis-rendering-parameter-guide)

---

## 1. Edge Darkening (Coffee Ring Effect)

### Physical Mechanism

The edge darkening of fountain pen ink strokes is caused by the **coffee ring effect** -- the same physics that makes a coffee spill dry with a dark ring and a lighter center. The process:

1. The ink droplet/stroke makes contact with paper. The outer edge of the liquid becomes **pinned** to the paper surface (contact line pinning).
2. Evaporation occurs fastest at the edges, where liquid, solid, and air meet at a three-phase contact line.
3. To replace fluid lost at the edges, **capillary flow** carries liquid from the interior outward.
4. This outward flow transports dissolved dye molecules toward the contact line.
5. As the liquid evaporates, dye particles accumulate at the edge, creating a **concentrated dark ring** with a lighter interior.

The key physics parameter is the **Peclet number** (Pe), which measures the ratio of advective transport (flow carrying particles) to diffusive transport (particles spreading randomly). When Pe >> 1, flow dominates and the coffee ring effect is strong. For fountain pen ink drying on paper, Pe is typically high enough to produce visible edge darkening.

### Visual Characteristics

**How pronounced is edge darkening?**

The effect varies significantly by ink type and paper:

- On **low-absorbency paper** (Tomoe River, Rhodia): The effect is clearly visible. The edge of a dried stroke appears noticeably darker than the center, especially in broader strokes (medium nib and above). The edge ring is typically **15-30% darker** than the center of the stroke in terms of perceived lightness.

- On **absorbent paper** (copy paper, Moleskine): The effect is minimal because ink is pulled into the paper fibers so quickly that there is insufficient time for lateral capillary flow to transport dye to the edges. The stroke appears more uniform but also more diffuse (feathered).

- With **broad nibs** (medium and above): More pronounced because more ink is deposited, creating a thicker liquid film that takes longer to dry, giving more time for capillary migration.

- With **fine nibs** (EF, F): Less visible because the thin ink line dries very quickly and the small absolute width means there is not much visual room for the center-to-edge gradient.

**Shape of the darkened edge:**

The dark edge is not a hard line. It is a **gradient** that transitions from darker at the boundary to lighter toward the center. The darkest point is right at the contact line (the very edge of the stroke), and the concentration drops off moving inward. The profile roughly follows an **inverse parabolic** or **exponential decay** from the edge:

```
darkness(d) = base_darkness + edge_boost * exp(-d / characteristic_length)
```

where `d` is the distance from the stroke edge measured inward, and `characteristic_length` is typically 10-20% of the stroke half-width.

### Which Inks Show This Most?

1. **Dye-based inks** (most fountain pen inks): Show the coffee ring effect because dyes are fully dissolved and are transported by capillary flow. Examples: Diamine, Iroshizuku, Robert Oster.

2. **Iron gall inks** (e.g., KWZ Iron Gall, Rohrer & Klingner Salix): Show a **different** edge behavior. Iron gall inks produce exceptionally controlled, crisp lines with minimal spreading. The iron tannate particles are heavier and less prone to capillary migration. The edge darkening is less about dye migration and more about the chemical oxidation process (iron reacting with oxygen over time, darkening the entire stroke uniformly). Iron gall inks produce the **sharpest** edges of any fountain pen ink type.

3. **Pigmented inks** (e.g., Platinum Carbon Black, Sailor Sei-boku): Pigment particles are much larger than dissolved dyes (0.05-0.5 microns). These particles can exhibit the coffee ring effect strongly because they are easily carried by capillary flow and, being solid, they **cannot diffuse back** once deposited at the edge. However, some pigmented inks use anti-settling chemistry that can suppress this.

4. **Highly saturated / sheening inks** (e.g., Troublemaker Milky Ocean, Organics Studio Nitrogen): These show the most dramatic edge effects because excess dye that cannot be absorbed by the paper crystallizes on the surface. The edges, where dye concentration is highest, often show a pronounced **sheen** (metallic secondary color) in addition to darkening.

### Rendering in Canvas 2D

**Approach 1: Donut-shaped stamp opacity profile (recommended)**

Each stamp has a radial opacity profile that is slightly hollow in the center and peaks at approximately 60-75% of the radius before falling off at the edge:

```
alpha(r) = gaussian(r, sigma=0.42*R) * (0.75 + 0.25 * smoothstep(0.15*R, 0.55*R, r))
```

This creates stamps where the center is about 75% of the peak opacity, and the zone at 55-75% of the radius is at full opacity. The edge then falls off via the Gaussian tail. When many such stamps overlap along the stroke centerline, the aggregate effect is:
- Center: moderate darkness (stamps overlap but each is slightly hollow)
- Near-edge zone: darker (stamps contribute their peak opacity here)
- Extreme edge: falls off (Gaussian tail)

**Approach 2: Two-layer rendering**

Render the stroke in two passes:
1. **Base fill**: Render stamps at base opacity along the centerline.
2. **Edge emphasis**: Render a second set of stamps (or a stroked path) at the stroke boundaries with slightly higher opacity or a slightly darker color. Use a thinner width (e.g., 15-25% of stroke width) for the edge pass.

This is less elegant than Approach 1 but more explicit and easier to tune.

**Approach 3: Post-process edge detection**

After rendering the full stroke to an offscreen canvas:
1. Detect edges using the alpha channel boundary.
2. Apply a slight darkening or increased opacity along detected edges.
3. Composite back.

This is the approach used in watercolor simulation research (Curtis et al., SIGGRAPH 1997, using Sobel filters to find edges). It is accurate but expensive and not well-suited for real-time stamp rendering.

**Recommended for ObsidianPaper:** Approach 1 (donut stamp profile). It integrates naturally into the stamp-based pipeline, adds zero extra rendering passes, and the effect emerges organically from stamp overlap patterns. The degree of edge darkening can be controlled by a single parameter (the "center hollow" amount in the stamp profile).

### Tuning Parameters

```
edge_darkening_strength: 0.0 - 1.0
  0.0 = flat profile (no edge darkening, like ballpoint pen)
  0.3 = subtle (fine nib, absorbent paper)
  0.5 = moderate (medium nib, quality paper) -- DEFAULT
  0.8 = pronounced (broad nib, Tomoe River paper, sheening ink)
  1.0 = extreme (artistic exaggeration)
```

The center hollow in the stamp profile scales with this parameter:
```
center_opacity = 1.0 - edge_darkening_strength * 0.35
// At strength 0.5: center is 82.5% of peak
// At strength 0.8: center is 72% of peak
```

---

## 2. Ink Shading Techniques

### What "Shading" Means in Fountain Pen Context

Fountain pen "shading" is the variation in ink darkness **along the stroke** (not across it -- that is the edge darkening effect above). A "shading ink" visually transitions from light to dark within single letters and strokes, creating a watercolor-like tonal variation.

### Physical Mechanism

Shading is caused by **differential ink film thickness** along the stroke path:

- Where the pen moves **slowly** (deceleration, direction changes, stroke endpoints), more ink is deposited per unit area. The thicker ink film absorbs more light = appears darker.
- Where the pen moves **quickly** (mid-stroke, fast strokes), less ink is deposited per unit area. The thinner film absorbs less light = appears lighter.
- The relationship follows Beer-Lambert absorption: `perceived_darkness = 1 - exp(-k * thickness)`, which means darkness increases rapidly at first but has diminishing returns at higher thicknesses.

### Visual Analysis: Shading vs. Flat Inks

**High-shading inks** (e.g., Diamine Autumn Oak, Diamine Oxblood, Sailor Apricot, Noodler's Apache Sunset):
- Show dramatic light-to-dark transitions within a single letter
- The bottom of downstrokes is noticeably darker than the top
- Direction changes (corners of letters like "n", "m", "h") show dark pools
- The color range can span 30-50% lightness variation within a single word
- Light-colored and medium-saturated inks shade more because the thin/thick contrast is perceptible
- Broader nibs (medium and above) deposit enough ink to make the variation visible

**Flat inks** (e.g., Noodler's Bulletproof Black, Platinum Carbon Black, most highly saturated inks):
- Appear uniform in darkness across the stroke
- Even slow/fast sections look essentially the same color
- This is because the ink is so concentrated that even the thinnest film is already near maximum absorption
- Very dark inks (blacks, very saturated blues) are inherently flat -- there is no visible difference between "dark" and "very dark"

**Diamine Oxblood specifically:**
- A dark red/maroon ink that shows **moderate** shading
- On quality paper, the lighter areas are a warm pinkish-red, while the darker areas are a deep maroon-brown
- The color variation adds "movement" to the writing without being dramatic
- Shows some green sheen in heavily pooled areas on Tomoe River paper
- Dry time is approximately 6-7 seconds on standard paper

### How Writing Speed Affects Shading

The relationship between speed and ink deposition:
```
ink_per_unit_length = base_flow_rate / pen_speed
```

In practical writing terms:
- **Downstrokes** are typically slower (more deliberate) = darker. This matches the natural acceleration pattern in handwriting where the pen decelerates into turns and accelerates on straight segments.
- **Upstrokes** and connecting strokes are faster = lighter.
- **The bottom of curved letters** (b, d, p, o) accumulate ink as the pen changes direction = dark pools.
- **The tops of arches** (n, m, h) are where the pen is fastest = lightest areas.
- **Printing vs. cursive**: Printing (discrete strokes) shows shading better because each stroke has distinct start/end pools. Cursive maintains pen contact, so the transitions are smoother.

### Rendering Approaches for Shading

**Approach A: Velocity-based stamp spacing (recommended)**

This is the most natural and performant approach:
- At low velocity: stamps are placed closer together (more overlap = more alpha accumulation = darker)
- At high velocity: stamps are placed farther apart (less overlap = less alpha accumulation = lighter)

The spacing function:
```
effective_spacing = base_spacing * (1.0 + speed_shading_factor * clamp(velocity / velocity_ref, 0, 3))

// Where:
// base_spacing = 0.15 * stamp_diameter (dense baseline)
// speed_shading_factor = 0.5 - 2.0 (controls shading range)
// velocity_ref = calibration speed (typical writing speed)
```

At a speed_shading_factor of 1.0:
- At rest (velocity = 0): spacing = base_spacing (maximum density = darkest)
- At reference velocity: spacing = 2x base_spacing (moderate density)
- At 3x reference velocity: spacing = 4x base_spacing (minimum density = lightest)

**Approach B: Velocity-based stamp opacity**

Instead of (or in addition to) varying spacing, vary the opacity of each stamp:
```
stamp_opacity = base_opacity * lerp(max_shade_opacity, min_shade_opacity, clamp(velocity / velocity_ref, 0, 1))

// Where:
// base_opacity = 0.18 (per stamp)
// max_shade_opacity = 1.0 (at rest)
// min_shade_opacity = 0.4 (at fast speed)
```

**Approach C: Combined spacing + opacity (recommended for best results)**

Use both mechanisms simultaneously at reduced intensity:
- Spacing varies by 1.5x across the speed range (not 4x)
- Opacity varies by 0.6x across the speed range (not 0.4x)
- The combined effect gives a wider darkness range without either parameter going to extremes

```
effective_spacing = base_spacing * (1.0 + 0.5 * speed_factor)
stamp_opacity = base_opacity * (1.0 - 0.4 * speed_factor)

// Where speed_factor = clamp(velocity / velocity_ref, 0, 1)
```

### Shading Ink Configuration

For an ink selection system, the "shading amount" parameter controls the sensitivity of the speed-to-darkness mapping:

```
shading_amount: 0.0 - 1.0
  0.0 = no shading (flat ink, like Bulletproof Black)
        speed has no effect on darkness
  0.3 = subtle shading (dark, saturated ink)
  0.6 = moderate shading (Diamine Oxblood territory)
  0.8 = high shading (Diamine Autumn Oak, Apache Sunset)
  1.0 = extreme shading (artistic exaggeration)
```

This parameter scales the speed_shading_factor:
```
speed_shading_factor = shading_amount * 2.0
```

---

## 3. Paper Texture Interaction

### How Fountain Pen Ink Sits on Different Papers

Paper surface characteristics fundamentally change the visual appearance of fountain pen ink. The two key properties are **absorbency** (how quickly/deeply ink is pulled into fibers) and **surface roughness** (how the physical texture affects ink distribution).

### Smooth, Low-Absorbency Paper (Tomoe River)

**Physical behavior:**
- Ink sits ON the paper surface rather than absorbing into fibers
- Dry time is extremely long (100+ seconds average)
- The ink film remains thick and wet on the surface
- Dye concentration stays high because the ink is not diluted by spreading into the fiber matrix

**Visual characteristics:**
- **Maximum shading**: Because ink pools on the surface, speed-dependent thickness variation is amplified
- **Maximum sheen**: Excess dye crystallizes on the surface in a thin film, creating metallic secondary colors visible at oblique viewing angles. Sheen appears as a contrasting color (red sheen on blue ink, green sheen on red ink) in the areas of highest ink concentration -- primarily at stroke endpoints, direction changes, and where strokes cross
- **Crisp, sharp edges**: Minimal feathering because the surface coating prevents capillary wicking along fibers
- **Prominent edge darkening**: The long drying time allows capillary flow to transport dye to the contact line
- **Smooth ink surface**: No visible paper grain in the ink -- the dried film looks smooth and glossy

**Rendering implication:**
- Edge darkening strength: HIGH (0.7-0.9)
- Shading amount: amplified (multiply by 1.3x)
- Edge roughness noise: LOW (minimal feathering)
- Paper grain modulation on stamps: VERY LOW (0.95 + 0.05 * noise)
- Sheen overlay: enabled, threshold at 80% ink volume

### Rough, Absorbent Paper (Copy Paper, Recycled Paper)

**Physical behavior:**
- Ink is rapidly absorbed into the fiber matrix
- Dry time is very short (2-10 seconds)
- The ink wicks along paper fibers in random directions
- Fibers act as capillaries, drawing ink away from the deposition point

**Visual characteristics:**
- **Minimal shading**: Ink is pulled into fibers uniformly regardless of deposition amount, flattening the thin/thick contrast
- **No sheen**: All dye is absorbed into fibers; nothing remains on the surface to crystallize
- **Feathered edges**: The most distinctive characteristic. Ink spreads irregularly along fiber directions, creating fuzzy, spiky edges. The feathering pattern is somewhat random but follows the paper's fiber orientation (often slightly diagonal due to paper manufacturing). Feathering can extend 0.5-2x the stroke width beyond the intended edge.
- **Minimal edge darkening**: Drying is too fast for significant capillary migration of dye
- **Visible paper texture**: The ink fills the "valleys" of the paper texture more than the "peaks", creating a speckled or grainy appearance, especially visible in lighter/thinner ink areas

**Rendering implication:**
- Edge darkening strength: LOW (0.1-0.2)
- Shading amount: reduced (multiply by 0.5x)
- Edge roughness noise: HIGH (prominent feathering)
- Paper grain modulation on stamps: HIGH (0.7 + 0.3 * noise)
- Sheen overlay: disabled

### Mid-Range Paper (Rhodia, Clairefontaine, Life Noble)

**Physical behavior:**
- Good coating/sizing that resists rapid absorption without being impermeable
- Moderate dry times (10-20 seconds)
- Some surface pooling but not as much as Tomoe River

**Visual characteristics:**
- Moderate shading visible
- Occasional faint sheen with highly saturated inks
- Clean edges with minimal feathering
- Light paper texture visible in lighter areas

**Rendering implication (DEFAULT for ObsidianPaper):**
- Edge darkening strength: 0.5
- Shading amount: 1.0x (baseline)
- Edge roughness noise: MODERATE
- Paper grain modulation: MODERATE (0.85 + 0.15 * noise)
- Sheen overlay: optional, threshold at 90% ink volume

### Implementing Paper Texture Influence

**Paper texture map approach:**
The existing `GrainTextureGenerator` can produce tileable noise textures representing paper roughness. For ink rendering, the paper texture influences:

1. **Stamp opacity modulation**: Each stamp's opacity is multiplied by the paper texture value at that location. On "peaks" of the paper texture, less ink adheres (lower multiplier). In "valleys," more ink collects (higher multiplier).

```
final_stamp_opacity = stamp_opacity * (1.0 - paper_roughness * (1.0 - paper_grain_value_at_position))
// paper_roughness: 0.0 (smooth paper) to 0.5 (very rough paper)
// paper_grain_value: 0.0-1.0 from the grain texture at this world position
```

2. **Edge noise modulation**: Paper fiber direction can be simulated by adding directional noise to stamp positions near the stroke boundary. For feathering simulation:

```
if (distance_from_center > stroke_radius * 0.7) {
  // Near the edge: apply feathering displacement
  feather_offset = paper_feathering * noise(position) * normal_direction
  stamp_position += feather_offset
}
```

3. **Paper grain visibility**: The grain texture is more visible in lighter ink areas (where the ink film is thin and doesn't completely cover the paper texture) and less visible in heavy ink areas (where the thick film buries the texture).

```
grain_visibility = (1.0 - ink_darkness) * paper_roughness
```

---

## 4. Stroke Start/End Characteristics

### Stroke Start (Pen Touchdown)

When a fountain pen first touches paper, several things happen in rapid sequence:

**Phase 1: Initial contact blob (0-50ms)**
- The nib tip touches the paper surface
- Capillary action immediately draws ink from the nib slit to the paper
- Before the pen starts moving, a small ink deposit forms at the contact point
- This creates a **slightly widened, slightly darker dot** at the very beginning of the stroke
- Size: approximately 1.2-1.5x the normal stroke width
- Shape: roughly circular, centered on the first contact point

**Phase 2: Feed priming (0-200ms)**
- If the pen has been capped for a while, the ink may have retreated slightly from the nib tip (the "hard start" phenomenon)
- The first few millimeters of writing may be lighter or skippier as capillary action re-establishes the ink flow
- With a well-primed pen, this phase is invisible
- With a dry pen, the initial portion of the stroke can be noticeably lighter or broken

**Phase 3: Transition to steady flow (~100-500ms)**
- Ink flow stabilizes as the pen reaches writing speed
- The transition from the initial blob to the steady-state line width creates a characteristic **teardrop** or **bulge** at the stroke start

**Visual profile of a stroke start (well-primed pen):**
```
Distance from start (in stroke widths):
  0.0-0.3: Circular blob, 1.3x width, 1.2x darkness
  0.3-1.0: Tapering from blob width to normal width
  1.0+:    Normal stroke width and darkness
```

### Stroke End (Pen Lift)

The stroke ending depends on how the writer lifts the pen:

**Scenario A: Quick lift (most common in fast writing)**
- The pen lifts quickly while still moving
- The stroke tapers to a point as pressure decreases and the nib separates from paper
- This creates a **tapered tail** that gets progressively thinner and lighter
- The taper length is typically 1-3x the stroke width
- The taper is often slightly curved (following the writer's lifting arc)

**Scenario B: Slow lift / deliberate stop**
- The pen decelerates to zero velocity before lifting
- While the pen is stationary, ink continues to flow from the nib to the paper
- A **dark pool** forms at the endpoint, similar to the start blob but often larger
- Size: 1.3-1.8x the stroke width
- Opacity: 1.1-1.3x the stroke body opacity (darker due to ink accumulation)
- If the pen rests long enough, the pool can become the darkest point on the entire stroke

**Scenario C: Flick end (calligraphy)**
- The pen accelerates off the paper
- The stroke gets rapidly thinner as pressure decreases
- Creates a sharp, elegant taper like a brushstroke endpoint
- Very little or no pooling

### Rendering Stroke Start/End

**Ink pooling at start (already partially implemented in InkPooling.ts):**

The existing `InkPooling` system detects stroke start points and renders radial gradient blobs. For the stamp-based approach, integrate this directly:

```
At stroke start (first 3-5 stamps):
  - Increase stamp size: multiply by start_blob_factor (1.2-1.4)
  - Decrease stamp spacing: multiply by 0.5 (denser overlap = darker)
  - Gradually transition both parameters back to normal over 3-5 stamps
```

**Ink pooling at end:**

Detect velocity approaching zero at the stroke terminus:
```
At stroke end (last 3-5 stamps):
  if (velocity < velocity_threshold * 0.3):
    // Deliberate stop: add end pool
    - Increase stamp size: multiply by end_blob_factor (1.2-1.6)
    - Decrease stamp spacing: multiply by 0.3-0.5
    - Add 2-3 extra stamps at the endpoint with higher opacity
  else:
    // Quick lift: taper
    - Decrease stamp size gradually to 0
    - Maintain or slightly decrease stamp opacity
    - Use the existing pressure taper (pressure drops to 0 at lift)
```

**The characteristic "teardrop" at stroke start:**
```
For stamps 0 through N_transition:
  t = stamp_index / N_transition  // 0 to 1
  size_multiplier = 1.0 + start_blob_size * (1.0 - t)^2  // Quadratic ease-out
  opacity_multiplier = 1.0 + start_blob_darkness * (1.0 - t)^2
  spacing_multiplier = 1.0 - 0.5 * (1.0 - t)^2
```

---

## 5. Intersection Behavior

### Wet-on-Wet Crossings

When a new stroke crosses an existing stroke that is still wet (within the drying time):

**Physical behavior:**
- The inks mix and blend at the crossing point
- The combined liquid volume creates a local pool
- Dye concentration increases multiplicatively (not just additively)
- Surface tension effects can cause the wet ink to spread slightly along the existing wet stroke
- Color mixing occurs if the inks are different colors

**Visual result:**
- **Significant darkening** at the crossing point, often the darkest part of either stroke
- The darkened area extends slightly beyond the crossing due to capillary wicking along the wet stroke
- The shape of the dark zone is roughly diamond-shaped (the intersection of the two stroke widths)
- Edges of the dark zone are soft/diffuse, not sharp
- With saturated inks on low-absorbency paper, the crossing may show enhanced sheen

**Darkness estimate:** The crossing point is approximately **40-60% darker** than either individual stroke body. For nearly-saturated inks, the darkening is clamped by the absorption limit of the paper.

### Wet-on-Dry Crossings

When a new stroke crosses a fully dried existing stroke:

**Physical behavior:**
- The new ink sits on top of the dried ink
- There is no mixing of the underlying dye layers
- The dried ink layer effectively acts as a slightly different "paper surface" for the new ink
- Absorption may be slightly different over the dried ink vs. bare paper

**Visual result:**
- **Moderate darkening** at the crossing, roughly additive
- The new stroke looks the same as elsewhere, but the underlying dried stroke shows through
- The combined appearance is essentially like looking through two transparent layers
- Much less dramatic than wet-on-wet crossings
- Edges of the crossing darkening are sharp and follow the stroke boundaries cleanly

**Darkness estimate:** The crossing is approximately **20-35% darker** than either individual stroke. The exact amount depends on the opacity of each stroke.

### Rendering Crossings in Canvas 2D

**For standard (source-over) compositing:**

The default `source-over` compositing mode naturally produces darker crossings through alpha accumulation. If stroke A has alpha `a1` and stroke B has alpha `a2`:

```
combined_alpha = a1 + a2 * (1 - a1) = a1 + a2 - a1 * a2
```

For a1 = a2 = 0.7 (typical ink opacity):
```
combined = 0.7 + 0.7 * 0.3 = 0.91
```

This gives a 21-percentage-point increase (0.7 -> 0.91), which is a visible but moderate darkening. This naturally approximates the wet-on-dry behavior.

**For enhanced intersection darkening (wet-on-wet simulation):**

To simulate the more dramatic wet-on-wet darkening, use a two-layer approach:

1. Render strokes normally with `source-over` (this gives wet-on-dry crossings)
2. For strokes that temporally overlap (close timestamps), apply additional darkening:
   - Detect crossing regions by rendering stroke masks
   - Apply `multiply` compositing in crossing areas
   - Or: Increase the opacity of stamps near detected crossings

**Multiply compositing** produces a more dramatic darkening effect:
```
multiply_result = color_A * color_B  (per channel, 0-1 range)
```
For two identical ink strokes at 70% opacity:
```
0.7 * 0.7 = 0.49 (with alpha, the effect is even stronger visually)
```

**Practical recommendation:** For most fountain pen simulation, the standard `source-over` alpha accumulation produces sufficiently realistic crossing darkening. The extra complexity of `multiply` blending at intersections is only worth implementing if the simulation targets a very wet, low-absorbency paper setting.

**Simple crossing enhancement without compositing mode changes:**

If strokes are rendered with an awareness of which strokes they cross:
```
At stamp positions where the underlying layer has ink:
  opacity_boost = crossing_darkening_factor * underlying_ink_density
  stamp_opacity += opacity_boost * 0.15  // Subtle boost

// crossing_darkening_factor: 0.0 (dry crossings) to 1.0 (wet crossings)
// Determined by time difference between strokes
```

---

## 6. Micro-Texture of Ink on Paper

### Edge Irregularity

Real fountain pen ink strokes do not have perfectly smooth edges. The level of irregularity depends on the paper:

**On smooth, coated paper (Tomoe River):**
- Edges are relatively clean and crisp
- There is very slight irregularity from surface tension effects and microscopic variations in the paper coating
- The irregularity wavelength is very fine (sub-millimeter) and low amplitude (< 5% of stroke width)
- The overall line quality would be described as "crisp" or "precise"

**On rough/absorbent paper (copy paper):**
- Edges show significant irregularity (feathering)
- Ink wicks along paper fibers in random directions, creating spiky, jagged edges
- The irregularity wavelength varies from very fine (individual fibers, < 0.1mm) to coarse (fiber bundles, 0.5-1mm)
- The amplitude can be 10-30% of the stroke width or more
- The overall line quality would be described as "soft" or "fuzzy"

**On mid-range paper (Rhodia, Leuchtturm):**
- Clean edges with very slight softness
- Minimal feathering but not laser-sharp
- Edge irregularity amplitude: 2-8% of stroke width

### Rendering Edge Irregularity

**Perlin/simplex noise displacement (recommended):**

Apply low-frequency noise to displace stamp positions near the stroke boundary:

```
// For each stamp placement:
noise_value = smoothNoise2D(stamp.x * noise_scale, stamp.y * noise_scale)
displacement = noise_value * stroke_width * feathering_amount

// Apply displacement perpendicular to stroke direction
stamp.x += displacement * normal_x
stamp.y += displacement * normal_y
```

Key parameters:
```
feathering_amount: 0.0 - 0.15
  0.0  = laser-sharp edges (digital look)
  0.02 = very crisp (Tomoe River)
  0.05 = clean with slight softness (Rhodia) -- DEFAULT
  0.10 = noticeable feathering (medium-quality paper)
  0.15 = significant feathering (cheap copy paper)

noise_scale: controls the frequency of the irregularity
  0.1-0.3 per world unit = coarse, wavy irregularity (surface tension effects)
  0.5-1.0 per world unit = fine, spiky irregularity (fiber feathering)
  Use TWO octaves: one coarse + one fine for the most realistic look
```

**Stamp edge noise (complementary):**

In addition to position displacement, the stamps themselves should have slightly irregular edges (as described in the existing `fountain-pen-ink-rendering-techniques.md`):

```
For each stamp variant's radial profile:
  theta = atan2(py, px)  // angle from stamp center
  edge_noise = noise1D(theta * 4 + variant_seed) * 0.06
  effective_radius = base_radius * (1.0 + edge_noise)
```

This creates stamps that are not perfect circles, adding organic edge texture at the micro level.

### Paper Fiber Texture in Ink

When viewed at high magnification, ink on paper shows the texture of the paper fibers:

**Visual description:**
- On absorbent paper, ink fills the spaces between fibers. Where fibers are raised ("peaks"), less ink adheres, creating a subtle speckled or striated pattern within the stroke body.
- On smooth paper, the ink film is more uniform, but very slight grain from the paper coating is still visible under magnification.
- The texture is most visible in lighter ink areas (thin film) and least visible in heavily saturated areas (thick film that covers everything).

**Rendering with the existing grain system:**

The existing `GrainTextureGenerator` produces tileable noise textures. For fountain pen ink, use this texture as a subtle opacity modulator:

```
grain_config_for_ink = {
  tileSize: 256,
  scale: 12,        // Larger scale than pencil (softer, broader features)
  octaves: 2,       // Two frequencies: coarse paper texture + fine fiber grain
  threshold: 0.75,  // Higher threshold = denser fill (ink covers more than graphite)
  softness: 0.2     // Soft transitions between grain features
}
```

Apply the grain texture as:
```
final_opacity = stamp_opacity * (1.0 - grain_influence * (1.0 - grain_value))

// grain_influence varies with ink darkness:
grain_influence = paper_roughness * (1.0 - clamp(local_ink_darkness, 0, 0.8))
// At low darkness: grain is visible
// At high darkness: grain is buried under thick ink
```

### Crisp vs. Soft Line Rendering

**Crisp lines (coated paper):**
- Sharp Gaussian falloff on stamps: sigma = 0.30 * radius (tight)
- Low position jitter: 1-2% of stroke width
- Minimal feathering noise
- Higher base stamp opacity (0.20-0.25): builds to full darkness quickly

**Soft lines (absorbent paper):**
- Broad Gaussian falloff on stamps: sigma = 0.50 * radius (wide, soft)
- Higher position jitter: 5-8% of stroke width
- Significant feathering noise (0.10+)
- Lower base stamp opacity (0.12-0.16): creates a softer, more diffuse look
- Additional small "feather" stamps scattered at the edges with very low opacity

---

## 7. Synthesis: Rendering Parameter Guide

### Complete Per-Paper-Type Preset

**"Fine Paper" preset (Tomoe River / Graphilo):**
```
edge_darkening_strength:  0.80
shading_multiplier:       1.30
feathering_amount:        0.02
paper_roughness:          0.05
grain_influence:          0.05
stamp_edge_sigma:         0.30 * R  (tight, crisp)
base_stamp_opacity:       0.22
sheen_enabled:            true
sheen_threshold:          0.80
position_jitter:          0.015
```

**"Quality Paper" preset (Rhodia / Clairefontaine) -- DEFAULT:**
```
edge_darkening_strength:  0.50
shading_multiplier:       1.00
feathering_amount:        0.05
paper_roughness:          0.15
grain_influence:          0.12
stamp_edge_sigma:         0.38 * R  (moderate)
base_stamp_opacity:       0.20
sheen_enabled:            false
sheen_threshold:          0.90
position_jitter:          0.030
```

**"Standard Paper" preset (copy paper / notebook):**
```
edge_darkening_strength:  0.15
shading_multiplier:       0.60
feathering_amount:        0.12
paper_roughness:          0.35
grain_influence:          0.25
stamp_edge_sigma:         0.48 * R  (soft, diffuse)
base_stamp_opacity:       0.16
sheen_enabled:            false
sheen_threshold:          N/A
position_jitter:          0.060
```

### Complete Per-Ink-Type Preset

**"Shading Ink" (Diamine Autumn Oak / Oxblood):**
```
shading_amount:           0.70
edge_darkening_extra:     0.10    // Slight boost
base_opacity_range:       [0.12, 0.85]  // Wide range for visible variation
sheen_color:              null    // No sheen for standard shading inks
crossing_darkening:       0.30
```

**"Flat Ink" (Noodler's Bulletproof Black / Carbon Black):**
```
shading_amount:           0.10
edge_darkening_extra:     0.00
base_opacity_range:       [0.60, 0.95]  // Narrow range, always dark
sheen_color:              null
crossing_darkening:       0.15
```

**"Sheening Ink" (Organics Studio Nitrogen / Troublemaker Milky Ocean):**
```
shading_amount:           0.50
edge_darkening_extra:     0.15
base_opacity_range:       [0.15, 0.90]
sheen_color:              [R, G, B]   // Contrasting sheen color
sheen_opacity_max:        0.40
crossing_darkening:       0.40
```

**"Iron Gall Ink" (KWZ Iron Gall / R&K Salix):**
```
shading_amount:           0.35
edge_darkening_extra:    -0.10    // Actually crisper, less edge effect
base_opacity_range:       [0.25, 0.80]
sheen_color:              null
crossing_darkening:       0.20
feathering_override:      0.02    // Always crisp regardless of paper
```

### Stamp Profile Formulas

**Standard ink stamp (donut profile for edge darkening):**
```
alpha(r, R, edge_strength) =
  let base = exp(-(r*r) / (2 * sigma * sigma))      // Gaussian base
  let hollow = 1.0 - edge_strength * 0.35 * (1.0 - (r/R))^2  // Center hollow
  let result = base * hollow
  return clamp(result, 0, 1)

// sigma = stamp_edge_sigma (varies by paper type)
// R = stamp radius
// edge_strength = edge_darkening_strength (0-1)
```

**With feathering noise (per stamp variant):**
```
alpha(r, theta, R, edge_strength, variant_seed) =
  let noise_offset = noise1D(theta * 4 + variant_seed) * feathering_amount * R
  let effective_r = r + noise_offset
  let base = exp(-(effective_r*effective_r) / (2 * sigma * sigma))
  let hollow = 1.0 - edge_strength * 0.35 * (1.0 - clamp(effective_r/R, 0, 1))^2
  return clamp(base * hollow, 0, 1)
```

### Compositing Pipeline Summary

```
For each tile being rendered:
  For each stroke (in z-order):
    1. Compute stamp placements with velocity-based spacing
    2. For each stamp:
       a. Compute position with feathering displacement
       b. Select stamp variant (deterministic from hash)
       c. Compute opacity:
          stamp_opacity = base_opacity
            * pressure_curve(pressure)
            * velocity_shading(velocity, shading_amount)
            * grain_modulation(position, paper_roughness)
            * start_end_pooling_factor(distance_along_stroke)
       d. Set ctx.globalAlpha = stamp_opacity
       e. Set ctx.setTransform(...) with rotation jitter
       f. ctx.drawImage(stamp_variant, ...)
    3. (Optional) Render sheen overlay for high-saturation areas
  Apply paper grain texture overlay (subtle)
```

---

## Sources

### Coffee Ring Effect
- [Coffee Ring Effect - Wikipedia](https://en.wikipedia.org/wiki/Coffee_ring_effect) -- Physical mechanism and parameters
- [Capillary flow as the cause of ring stains (Deegan et al., Nature 1997)](https://www.nature.com/articles/39827) -- Original research paper
- [The application of coffee-ring effect in analytical chemistry (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0165993622002357) -- Quantitative analysis

### Fountain Pen Ink Shading and Sheen
- [JetPens - Intermediate Guide to Fountain Pen Inks: Sheen, Shading, Shimmer](https://www.jetpens.com/blog/Intermediate-Guide-to-Fountain-Pen-Inks-Sheen-Shading-Shimmer-and-More/pt/113)
- [Fountain Pen Love - What Is Fountain Pen Ink Shading?](https://fountainpenlove.com/fountain-pen-ink/fountain-pen-ink-shading/)
- [Fountain Pen Love - What Is Sheen In Fountain Pen Ink?](https://fountainpenlove.com/fountain-pen-ink/what-is-sheen-in-fountain-pen-ink/) -- Thin-film interference mechanism
- [Fountain Pen Love - How Different Papers Affect Fountain Pen Ink Sheen](https://fountainpenlove.com/paper/how-different-papers-affect-fountain-pen-ink-sheen/)
- [Mountain of Ink - Ink Properties](https://mountainofink.com/blog/ink-properties) -- Comprehensive ink behavior catalog
- [Mountain of Ink - Diamine Oxblood Review](https://mountainofink.com/blog/diamine-oxblood)
- [Mountain of Ink - Wet vs Dry Inks](https://mountainofink.com/blog/wet-dry-ink)
- [Goulet Pens - Diamine Oxblood Ink Review](https://www.gouletpens.com/blogs/fountain-pen-blog/diamine-oxblood-ink-review)
- [Goulet Pens - Shading Fountain Pen Inks](https://www.gouletpens.com/collections/shading-inks)

### Paper-Ink Interaction
- [Galen Leather - Why Tomoe River Paper Is The #1 Fountain Pen Paper](https://www.galenleather.com/blogs/news/tomoe-river-paper) -- Surface coating and ink behavior
- [JetPens - The Best Fountain Pen Paper](https://www.jetpens.com/blog/The-Best-Fountain-Pen-Paper/pt/730) -- Paper comparison
- [Gentleman Stationer - Hierarchies of Fountain Pen Friendly Paper](https://www.gentlemanstationer.com/blog/2021/3/10/hierarchies-of-fountain-pen-friendly-paper)
- [Fountain Pen Revolution - How to Fix Feathering Issues](https://fprevolutionusa.com/blogs/news/fix-fountain-pen-feathering-issues) -- Feathering mechanism
- [Left Hook Pens - The Scale of Paper Absorption](https://lefthookpens.com/2021/04/03/the-scale-of-paper-absorption-part-3/) -- Quantitative absorption testing

### Iron Gall Ink Characteristics
- [Sacrideo - In Praise of Iron Gall Inks for Fountain Pens](https://www.sacrideo.us/in-praise-of-iron-gall-inks-for-fountain-pens/) -- Line quality and control
- [Pure Pens - Fountain Pen Inks: Standard, Waterproof or Iron Gall?](https://www.purepens.co.uk/blogs/news/fountain-pen-inks-standard-waterproof-or-iron-gall)
- [Iron Gall Ink - Wikipedia](https://en.wikipedia.org/wiki/Iron_gall_ink)

### Ink Physics and Flow
- [ScienceDirect - How the capillarity and ink-air flow govern the performance of a fountain pen](https://www.sciencedirect.com/science/article/abs/pii/S0021979720305877)
- [Phys.org - Researchers deconstruct the physics of writing with a fountain pen](https://phys.org/news/2011-12-deconstruct-physics-fountain-pen.html)
- [ScienceDirect - Identification of fountain pen ink properties](https://www.sciencedirect.com/science/article/pii/S0264127522003616)

### Stroke Start/End Behavior
- [Goulet Pens - Troubleshooting: How to Fix Skipping and Hard Starts](https://www.gouletpens.com/blogs/fountain-pen-blog/troubleshooting-how-to-fix-skipping-and-hard-starts)
- [JetPens - Guide to Fountain Pen Nibs](https://www.jetpens.com/blog/Guide-to-Fountain-Pen-Nibs-Choosing-a-Fountain-Pen-Nib/pt/760)
- [Fountain Pen Revolution - Common Ink Flow Problems](https://fprevolutionusa.com/blogs/news/common-ink-flow-problems-how-to-fix)

### Digital Ink Rendering Algorithms
- [Computer-Generated Watercolor (Curtis et al., SIGGRAPH 1997)](https://grail.cs.washington.edu/projects/watercolor/paper_small.pdf) -- Edge darkening via pigment migration
- [Nijimi Rendering Algorithm (IEEE)](https://ieeexplore.ieee.org/document/1214460/) -- Ink diffusion simulation
- [Diffusion Rendering of Black Ink Paintings (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0097849300001321) -- Paper fiber model
- [Stroke-Based Rendering (Hertzmann)](https://www.dgp.toronto.edu/~hertzman/sbr02/hertzmann-sbr02.pdf)
- [US20170278275A1 - Microsoft Variable Opacity Stroke Rendering](https://patents.google.com/patent/US20170278275A1/en) -- Stamp-based rendering patent
- [Research on Simulation Rendering Technology Based on Canny Edge Darkening (ResearchGate)](https://www.researchgate.net/publication/348829203_Research_on_Simulation_Rendering_Technology_of_Watercolor_Painting_Based_on_Canny_Edge_Darkening)

### Canvas 2D Compositing
- [MDN - CanvasRenderingContext2D.globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)
- [MDN - createRadialGradient()](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/createRadialGradient)

### Texture and Noise
- [NVIDIA - Implementing Improved Perlin Noise (GPU Gems)](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-5-implementing-improved-perlin-noise)
- [The Book of Shaders - Noise](https://thebookofshaders.com/11/)

### Brush Rendering in Digital Art Apps
- [Procreate Handbook - Brush Studio Settings](https://procreate.com/handbook/procreate/brushes/brush-studio-settings/)
- [Google Ink Stroke Modeler (GitHub)](https://github.com/google/ink-stroke-modeler)
- [Astropad - Apple Pencil Pressure Curve](https://astropad.com/blog/change-apple-pencil-pressure-curve/)
