# Fountain Pen Ink Physics for Digital Rendering

## Overview

This document compiles the physics of fountain pen ink behavior -- from nib to paper to dried result -- with the goal of identifying parameters and relationships that can be modeled programmatically for ObsidianPaper's Apple Pencil writing experience.

---

## 1. Ink Flow Dynamics: Nib to Paper

### Capillary Action as the Primary Mechanism

Fountain pen ink delivery is governed by **capillary action** -- the movement of liquid through narrow spaces driven by the interplay of adhesion (liquid attracted to solid surfaces) and cohesion (liquid molecules attracted to each other, creating surface tension).

**The feed system** consists of microscopic channels carved into the feed body that create a network of pathways drawing ink from the reservoir to the nib. The feed is the central control unit for ink/air flow.

**Key equation for capillary rise height:**
```
h ≈ 14.8 / r   (where h and r are in mm)
```
This represents the theoretical maximum rise achievable under ideal laboratory conditions. For a 0.5mm glass capillary, this yields approximately 30mm of rise.

**Practical capillary dimensions in feeds:**
- 0.3mm channel width: ~28mm capillary rise
- 0.4mm channel width: ~25mm capillary rise
- 0.5mm channel width: ~30mm capillary rise
- Channels narrower than 0.3mm become impractical (ink stagnation, difficulty releasing at nib)

**Rectangular channels** (as used in actual feeds) generate stronger capillary pull than round tubes because sharp corners create additional capillary force.

### Air-Ink Exchange

As ink flows out, a vacuum would form in the reservoir without air replacement. The feed manages this exchange:
- As ink exits, holding pressure builds in the cartridge
- The pressure drop across the capillary valve increases
- Air is drawn toward the cartridge
- An air-ink meniscus forms at the capillary valve
- The meniscus breaks into air bubbles via **Rayleigh instability**
- These bubbles travel up into the reservoir, replacing the ink volume

### Force Balance During Writing

The seminal paper by Kim et al. (Physical Review Letters, 107, 264502, 2011) "Hydrodynamics of Writing with Ink" establishes that writing is **a competition for ink between pen and paper**. Three forces govern the process:

1. **Capillary force** (drives ink from nib into paper pores via surface tension)
2. **Viscous resistance** (resists ink flow into paper)
3. **Pen motion drag** (the moving pen drags ink along, with viscosity resisting this)

The line width depends on pen speed and the physicochemical properties of ink and paper. The theory balances capillary driving force against viscous resistance through the porous substrate to predict line shape and width.

### How Flow Rate Varies

| Factor | Effect on Flow |
|--------|---------------|
| **Writing speed** | Slower = more ink deposited per unit length (wider, wetter line); Faster = less ink per unit length (thinner, drier line) |
| **Pressure** | More pressure slightly increases flow through standard nibs; dramatically increases flow through flex nibs by separating tines |
| **Pen angle** | Designed for ~45 degrees to paper; tipping shape optimized for this angle. Deviation changes contact patch geometry. |
| **Gravity** | Minor contributor vs. capillary force; pen orientation affects ink pooling in feed during storage |
| **Surface tension** | Primary determinant of "wetness" -- lower surface tension = wetter, runnier writing |
| **Viscosity** | Secondary factor -- higher viscosity = thicker film left behind on paper |

### Measured Ink Physical Properties

From Jona Ines (2022), "Identification of fountain pen ink properties which determine the amount put on paper during handwriting":
- **Surface tension range:** 39.3 - 73.1 mN/m (majority near or above 60 mN/m; water is 72.8 mN/m)
- **Dynamic viscosity range:** 0.999 - 1.374 mPa*s (water is ~1.0 mPa*s at 20C)
- **pH:** 6.0 - 6.5 (slightly acidic, nearly constant across inks)
- **Primary determinant of ink wetness:** Surface tension (inverse relationship -- lower tension = wetter)
- **Secondary determinant:** Viscosity
- **Tertiary determinant:** Conductivity

**Modeling implication:** Ink "wetness" (how much ink is deposited) can be parameterized primarily by a single surface tension-like variable, with viscosity as a secondary modifier.

---

## 2. Ink-Paper Interaction

### Absorption Mechanics

When ink touches paper, it is drawn into the fiber matrix by capillary forces within the paper's pore structure. The interaction depends on:

1. **Paper fiber size and consistency** -- smaller, more uniform fibers = more controlled absorption
2. **Paper sizing/coating** -- coatings resist absorption, keeping ink on the surface longer
3. **Paper porosity** -- higher porosity = faster absorption, more feathering risk
4. **Ink surface tension** -- lower tension = easier penetration into fibers

### Feathering

Feathering occurs when ink spreads along paper fibers irregularly, creating fuzzy line edges. The mechanism:
- Paper fibers act as capillaries themselves
- Ink is wicked along fibers in random directions
- Lower quality papers with inconsistent fiber structure are more prone
- Wetter (lower surface tension) inks feather more
- More absorbent papers pull ink more aggressively

### Paper Absorption Scale (Empirical)

From Left Hook Pens' systematic testing (0 = most absorbent, 10 = least):

| Paper | Absorption Score | Avg Dry Time |
|-------|-----------------|-------------|
| Moleskine | 1 | 5.4 seconds |
| Stalogy 365 | 3 | 14.2 seconds |
| Rhodia | 5 | 10.8 seconds |
| Mnemosyne | 7 | 15.4 seconds |
| Life | 8 | 20.0 seconds |
| Tomoe River | ~9 | ~100+ seconds |

**Key insight:** Less absorbent papers (Tomoe River) keep ink on the surface longer, which:
- Increases drying time dramatically
- Enables ink to pool and spread on the surface
- Makes shading, sheening, and shimmer far more visible
- Creates richer color and more dramatic visual effects

### Ink Film on Paper

Ink does not simply sit as a uniform layer. It both penetrates into fibers AND remains partially on the surface. The ratio depends on:
- Paper sizing (coated papers keep more ink on surface)
- Ink viscosity (higher viscosity = thicker surface film)
- Ink surface tension (lower = penetrates more readily)
- Amount deposited (more ink = paper saturation reached, excess stays on surface)

For reference, printing inks typically deposit 1-3 microns of film. Fountain pen inks, being water-based and applied by capillary delivery rather than mechanical pressure, likely deposit a somewhat thicker but more variable film.

**Modeling implication:** The paper can be treated as having an absorption capacity. Below that capacity, ink is drawn in and the visual result is lighter. At/above capacity, ink pools on the surface, creating darker, richer, slower-drying areas where effects like sheening emerge.

---

## 3. Ink Pooling and Saturation

### Where and Why Ink Pools

Pooling occurs wherever ink accumulates faster than the paper can absorb it, or wherever ink collects due to fluid dynamics:

**At stroke starts (pen touchdown):**
- When the pen first contacts paper, a small blob of ink transfers from the nib before the pen begins moving
- The longer the pen rests before moving, the larger the blob
- This creates a characteristic darkened dot at the beginning of strokes

**At stroke ends (pen lift):**
- When the pen slows to a stop before lifting, ink continues to flow while the pen decelerates
- A small pool forms at the terminus
- More pronounced with wet writers and slow lifts

**At direction changes:**
- When the pen changes direction, it momentarily decelerates (possibly to zero velocity)
- During deceleration, ink flow continues at its previous rate while the pen covers less distance
- This creates localized over-saturation at corners and turning points
- The sharper the direction change, the more pronounced the pooling

**At intersections (stroke crossings):**
- When a new stroke crosses an existing (still wet) stroke, inks combine
- Even if the first stroke has dried, the double layer of ink creates visible darkening
- Wet-on-wet crossings produce the most dramatic pooling and darkening

**On slow strokes vs fast strokes:**
- Slow movement = more ink per unit length = darker, wetter line
- Fast movement = less ink per unit length = lighter, drier line
- This is the fundamental mechanism behind **shading**

### Saturation and Darkness

The relationship between ink thickness and visual darkness follows the **Beer-Lambert law** in principle: the absorbance (perceived darkness) of a dye solution is proportional to its thickness and concentration. In practical terms:
- Thin ink film = lighter color (less dye absorbing light)
- Thick ink film = darker color (more dye absorbing light)
- The relationship is **logarithmic** -- doubling thickness does not double perceived darkness; there are diminishing returns at high saturation

**Modeling implication:** Ink darkness at any point can be modeled as a function of accumulated ink volume at that location. A logarithmic or power-curve mapping from "ink amount" to "opacity/darkness" would approximate the physical reality. Pooling locations should receive extra ink accumulation based on pen velocity (inverse relationship).

### Quantitative Model for Ink Deposition

Based on the Kim et al. research, the fundamental relationship is:

```
ink_per_unit_length ∝ 1 / pen_speed
```

At very slow speeds, ink spreading on paper also increases the line width (lateral wicking). So both line width AND saturation increase as speed decreases:

```
line_width ∝ 1 / sqrt(pen_speed)   (approximate, from capillary spreading theory)
ink_darkness ∝ log(ink_volume)       (Beer-Lambert approximation)
```

---

## 4. Ink Drying Patterns

### The Coffee Ring Effect

The dominant physics of ink drying follows the **coffee ring effect** -- the same phenomenon that causes coffee spills to dry with dark edges and a lighter center:

**Mechanism:**
1. The droplet's edge (contact line) becomes pinned to the paper surface
2. Evaporation occurs most rapidly at the edges (where liquid meets solid meets air)
3. To replace fluid lost at the edges, capillary flow carries liquid from the center outward
4. This outward flow carries dissolved dye particles toward the edges
5. Dye accumulates at the contact line, creating **edge darkening**

**Key parameters (from physics literature):**
- **Capillary number** (Ca) = ratio of viscous to surface tension forces
- **Peclet number** (Pe) = ratio of advection (flow transport) to diffusion
- When Pe >> 1, the coffee ring effect is strong (flow dominates over diffusion)
- When Pe << 1, diffusion dominates and dye distributes more uniformly

**What this means for ink strokes:**
- The edges of an ink line dry first and concentrate dye, becoming slightly darker
- The center of the line retains moisture longer and has slightly less dye concentration
- This creates subtle **edge darkening** visible in dried fountain pen writing
- More pronounced on less absorbent papers where ink sits on the surface
- More pronounced with highly saturated inks

### Chromatographic Separation During Drying

Many fountain pen inks contain multiple dye components. As ink dries and wicks through paper, these components separate based on their molecular weight, polarity, and affinity for the paper fibers:
- Smaller/more polar molecules move farther and faster
- Larger/less polar molecules stay closer to the original deposition
- This creates subtle color gradients within a single stroke
- The effect is the same principle as paper chromatography

**Dual shading / chroma shading** is the visible result: a blue ink might show pink or purple at the thin edges of a stroke where lighter dye components have separated out.

### Drying Time Factors

From Mountain of Ink's comprehensive testing:
- **Fastest drying inks:** ~2 seconds (Noodler's Polar Purple)
- **Slowest drying inks:** ~90 seconds (J. Herbin Rouge Hematite on non-absorbent paper)
- **Average across all inks:** ~31.5 seconds
- **On Tomoe River paper:** average ~100 seconds (1.69 minutes)

Drying speed depends on:
1. Paper absorbency (primary factor)
2. Ink surface tension and viscosity
3. Nib width (broader = more ink = slower drying)
4. Ambient humidity and temperature
5. Ink layer thickness (pooled areas dry much slower)

**Modeling implication:** For digital rendering, the coffee ring effect translates to: apply slightly increased opacity/darkness at stroke edges. The drying pattern itself doesn't need real-time simulation, but the visual result (edge-darkened strokes) should be part of the rendered appearance. Stroke intersections and areas of heavy ink accumulation should show increased darkness.

---

## 5. Shading vs Sheening vs Shimmer

### Shading

**Physical mechanism:** Shading is the variation in color saturation within a single stroke caused by differing ink film thickness. Where ink is thick (slow strokes, pools, downstrokes) it appears darker. Where ink is thin (fast strokes, upstrokes, edges) it appears lighter.

**Key characteristics:**
- Result of basic Beer-Lambert absorption: thicker ink = more light absorbed = darker
- Not a special ink property per se -- all inks shade to some degree
- "High-shading" inks have formulations that exaggerate the effect (perhaps lower dye concentration so thin/thick differences are more visible, or specific dye behaviors)
- More visible with broader nibs (more ink variation possible within a single stroke)
- More visible on less absorbent paper (ink pools rather than being pulled uniformly into fibers)
- Downstrokes are typically darker than upstrokes (more pressure, slower speed)
- Direction changes and pauses create dark spots

**Optimal conditions for visible shading:**
- Nib: Medium or broad (EF/F often too little ink for visible variation)
- Paper: Low absorbency (Rhodia, Tomoe River) that allows pooling
- Ink: Specifically formulated "shading" inks
- Writing style: Printing (discrete strokes) shows shading better than continuous cursive
- Pen flow: Average to slightly dry (too wet = everything saturated, no contrast)

**Modeling parameters:**
```
shading_amount = f(ink_thickness_variation_across_stroke)
               = f(speed_variation, pressure_variation, nib_width)

darkness_at_point = base_color * (1 + shading_factor * log(local_ink_volume / reference_volume))
```

### Sheening

**Physical mechanism:** Sheening is a fundamentally different optical phenomenon from shading. It occurs when excess dye that cannot be absorbed by the paper crystallizes on the surface, creating a thin-film interference effect (like oil on water).

**Key characteristics:**
- **Requires highly saturated ink** -- so much dye that paper cannot absorb it all
- **Appears as a contrasting color** -- e.g., red/copper sheen on blue ink, green sheen on red ink
- **Viewing angle dependent** -- the sheen color shifts or appears/disappears as you change viewing angle
- **Surface phenomenon** -- only occurs on ink sitting ON the paper surface, not absorbed INTO it
- **Requires non-absorbent paper** -- Tomoe River is the gold standard; absorbent papers soak up all dye leaving nothing to crystallize
- **Requires sufficient ink volume** -- wider nibs and wetter flow deposit more ink, increasing sheening potential
- **Appears in heavily saturated areas** -- where ink pooled (start/end of strokes, direction changes, downstrokes)

**Optical mechanism:**
When dye crystallizes in a thin film on the paper surface, the film's thickness is on the order of visible light wavelengths. Light reflecting from the top and bottom of this film interferes constructively at certain wavelengths and destructively at others, producing the perceived sheen color. This is why:
- The sheen color is usually complementary or contrasting to the base color
- The sheen is angle-dependent (thin-film interference depends on angle of incidence)
- The sheen appears metallic or lustrous

**Modeling parameters:**
```
sheen_visibility = f(local_ink_volume, paper_absorbency, dye_concentration)
sheen_appears_when: local_ink_volume > paper_absorption_capacity
sheen_color: typically a contrasting/complementary color to base ink
sheen_intensity: proportional to excess ink volume above absorption threshold
sheen_location: concentrated at pooling locations (same places that are darkest from shading)
```

**Modeling implication:** Sheen is a secondary color layer that appears only in the most saturated areas of a stroke. In a digital rendering, it could be modeled as a conditional overlay: where ink accumulation exceeds a threshold, blend in a secondary "sheen color" with an intensity proportional to excess saturation.

### Shimmer

**Physical mechanism:** Shimmer is entirely different from both shading and sheening. It comes from physical metallic particles (glitter) suspended in the ink.

**Key characteristics:**
- **Metallic particles** -- actual tiny flakes of reflective material (often mica-based)
- **Paper-independent** -- the particles are there regardless of paper type (though wider nibs deposit more)
- **Settles in ink bottles** -- requires shaking before use
- **Can settle in pen feeds** -- requires periodic rotating/use
- **Size matters** -- larger particles catch more light but can clog finer nibs
- **Distribution is somewhat random** -- particles orient at various angles, catching light unpredictably

**Modeling parameters:**
```
shimmer = random_distribution_of_reflective_points(density ∝ nib_width)
shimmer_appearance: small bright specular highlights scattered within the stroke
shimmer_is_independent_of: ink_thickness, speed, pressure (only nib width affects density)
```

**Modeling implication:** Shimmer can be rendered as randomly distributed small bright/metallic specks within the stroke area. The density is proportional to nib width (ink volume). This is purely a visual texture overlay.

---

## 6. Nib Flex and Line Variation

### Standard (Rigid) Nibs

Standard nibs have a fixed tipping geometry. The line width they produce is determined by the size/shape of the iridium tipping ball and is essentially constant regardless of pressure. Standard nib sizes:

| Nib Size | Line Width (Western) | Line Width (Japanese) |
|----------|--------------------|--------------------|
| Extra Fine (EF) | 0.3 - 0.5mm | 0.2 - 0.3mm |
| Fine (F) | 0.5 - 0.7mm | 0.3 - 0.5mm |
| Medium (M) | 0.7 - 0.9mm | 0.5 - 0.7mm |
| Broad (B) | ~1.2mm | ~0.8 - 1.0mm |

Note: There is **no universal standard**. Nib widths vary significantly between manufacturers and even between production batches.

### Stub and Italic Nibs

These have non-round tipping that creates line variation based on stroke direction without needing flex:
- **Stub nibs:** Flat rectangular tip, rounded edges. Wide downstrokes, thin cross-strokes. Forgiving of angle variation.
- **Italic nibs:** Sharp rectangular tip, crisp edges. Maximum contrast between thick and thin. Requires precise pen angle.

The line variation from these nibs is a function of **stroke direction relative to the nib orientation**, not pressure.

### Flex Nibs

Flex nibs deform under pressure, causing the tines to separate and creating a wider ink channel. This produces dramatic line variation controlled by writing pressure.

**Mechanical behavior:**
- Tines don't just bend upward -- they **splay apart** from each other
- The cross-sectional shape of the nib determines flex behavior: semicircular profiles allow tines to "hinge" at angles, creating separation
- The tines "peel" or curl along their full length, not at a single bend point
- Material thickness is critical: flex nibs (~0.25mm) are roughly half the thickness of standard steel nibs (~0.45mm)

### Quantitative Flex Data

From Fountain Pen Design's systematic measurements:

**Line width ranges under load:**

| Nib | Unloaded Width | Loaded Width | Applied Force | Spring Constant |
|-----|---------------|-------------|--------------|----------------|
| Waterman Ideal 2 (fine) | 0.5mm | 2.0mm | 300g (2.9N) | 200 g/mm |
| No-name medium | 0.7mm | 2.5mm | 230g (2.3N) | 128 g/mm |
| No-name fine (very flexible) | 0.5mm | 3.0mm | 200g (2.0N) | 80 g/mm |

**Spring constant (sigma) = force / line_width_increase**
- Lower sigma = more flexible (less force needed per mm of spread)
- "Wet noodle" nibs: sigma < 80 g/mm
- Standard rigid nibs: sigma >> 500 g/mm

**Writing pressure ranges:**

| Action | Force Range |
|--------|------------|
| Everyday writing (no flex) | 30 - 80g (0.3 - 0.8N) |
| Comfortable controlled writing | ~50g (0.5N) |
| Signature (some emphasis) | 80 - 200g (0.8 - 2.0N) |
| Flex emphasized lines | 200 - 400g (2.0 - 4.0N) |
| Heavy flex (near maximum) | 300 - 500g (3.0 - 5.0N) |

**Proposed standard test load:** 350g (3.5N) -- approximately the weight of a 12oz can

### Railroading

Railroading occurs when the tines spread so far apart that the ink's surface tension breaks, and the feed cannot supply ink fast enough to fill the widened channel. The result is two parallel lines with a gap between them.

**Causes:**
1. **Excessive tine spread** -- the gap exceeds what surface tension can bridge
2. **Insufficient feed flow** -- the feed can't deliver ink fast enough for the widened channel
3. **Fast writing while flexed** -- rapid movement with wide tine spread depletes the ink at the nib
4. **Dry inks** -- higher surface tension inks are slightly more prone (higher capillary threshold to break)

**Feed material matters:**
- Ebonite (hard rubber) feeds are more hydrophilic than plastic
- They maintain better ink contact and supply more ink under flex
- This is why vintage pens (ebonite feeds) handled flex better than modern pens (plastic feeds)

**Modeling implications for Apple Pencil:**

Apple Pencil provides **pressure** (force) data, which maps directly to the flex nib model:
```
line_width = base_width + (pressure / spring_constant)  [clamped to max_flex]
ink_density = base_density * (line_width / base_width)   [more spread = less ink per unit area]

// Railroading threshold:
if line_width > max_sustainable_width:
    render_railroad_effect(two parallel lines with gap)
```

The key insight is that as a flex nib opens wider:
- Line width increases
- But ink per unit area may **decrease** (the same flow rate spread over more area)
- This creates natural shading: edges of flex strokes are lighter than the center
- At extreme flex, railroading creates a distinctive visual artifact

---

## 7. Modeling Parameters Summary for Digital Rendering

### Core Variables

```
// Pen properties
nib_width:          0.3mm - 3.0mm (base width, varies with flex)
nib_type:           round | stub | italic | flex
flex_spring_constant: g/mm (for flex nibs)
max_flex_width:     maximum achievable width before railroading
feed_flow_rate:     ml/second (determines railroading threshold)
ink_wetness:        0.0 - 1.0 (composite of surface tension + viscosity)

// Paper properties (virtual)
absorption_rate:    0.0 - 1.0 (how fast paper absorbs ink)
absorption_capacity: maximum ink volume per unit area before surface pooling

// Ink properties
base_color:         RGB/HSL
shading_range:      how much lighter/darker ink gets at thin/thick extremes
sheen_color:        secondary color for sheening effect (or null)
sheen_threshold:    ink volume at which sheen appears
shimmer_density:    particles per mm^2 (or 0 for non-shimmer)
shimmer_color:      metallic highlight color
```

### Key Relationships to Model

**1. Ink deposition rate (volume per distance):**
```
ink_per_mm = base_flow_rate / pen_speed
```
Inversely proportional to speed. At very slow speeds, cap at maximum flow rate.

**2. Line width:**
```
// For rigid nibs:
width = nib_width  (constant)

// For stub/italic nibs:
width = f(stroke_angle_relative_to_nib_orientation)
      = nib_width * |sin(theta)| + nib_height * |cos(theta)|

// For flex nibs:
width = nib_base_width + pressure / spring_constant
      = clamped to [nib_base_width, max_flex_width]

// Speed contribution (capillary spreading):
effective_width *= (1 + spread_factor / sqrt(pen_speed))
```

**3. Local ink saturation:**
```
saturation = ink_per_mm / line_width
           = (base_flow_rate / pen_speed) / line_width
```
High saturation = dark, potential sheening. Low saturation = light, visible shading.

**4. Darkness / opacity mapping (Beer-Lambert inspired):**
```
opacity = 1 - exp(-k * saturation)    // where k is a dye concentration constant
```
This gives a curve that starts transparent, rises quickly, then asymptotes toward full opacity. It naturally captures the diminishing-returns nature of ink saturation.

**5. Edge darkening (coffee ring effect):**
```
edge_darkness_boost = edge_factor * (1 - distance_from_edge / stroke_half_width)^2
```
Apply a subtle darkness increase near stroke edges, more pronounced for:
- Wider strokes (more time for capillary flow)
- Slower-drying conditions (higher paper quality)
- Wetter inks

**6. Pooling at velocity changes:**
```
pooling_factor = max(0, velocity_decrease_rate * pooling_coefficient)
// Apply extra ink at locations where velocity decreases rapidly
// (stroke starts, ends, direction changes)
```

**7. Sheen overlay:**
```
if saturation > sheen_threshold:
    sheen_opacity = (saturation - sheen_threshold) / saturation_range
    blend(base_color, sheen_color, sheen_opacity)
```

**8. Intersection darkening:**
```
// When a new stroke crosses an existing stroke, the ink volumes ADD:
intersection_saturation = stroke1_saturation + stroke2_saturation
// This naturally produces darker crossings
```

---

## 8. Relevant Academic Papers and Key References

### Academic / Scientific

1. **Kim, J., Moon, M-W., Lee, K-R., Mahadevan, L., Kim, H-Y.** "Hydrodynamics of Writing with Ink." *Physical Review Letters*, 107, 264502 (2011).
   - The foundational physics paper on ink-paper-pen interaction
   - Establishes the competition model between pen and paper for ink
   - Derives line width as a function of writing speed and ink/paper properties
   - [PubMed](https://pubmed.ncbi.nlm.nih.gov/22243158/)

2. **Jona Ines, Fritz.** "Identification of fountain pen ink properties which determine the amount put on paper during handwriting." *Materials & Design*, 2022.
   - Measured surface tension (39.3-73.1 mN/m) and viscosity (0.999-1.374 mPa*s) across commercial inks
   - Established surface tension as primary determinant of ink wetness
   - [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0264127522003616)

3. **Kim et al.** "How the capillarity and ink-air flow govern the performance of a fountain pen." *Journal of Colloid and Interface Science*, 2020.
   - Detailed analysis of feed air-ink exchange dynamics
   - [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0021979720305877)

4. **Deegan, R.D. et al.** "Capillary flow as the cause of ring stains from dried liquid drops." *Nature*, 389, 827-829 (1997).
   - Original coffee ring effect paper
   - Explains edge darkening mechanism applicable to ink drying
   - [Wikipedia summary](https://en.wikipedia.org/wiki/Coffee_ring_effect)

### Computer Graphics / Digital Rendering

5. **Curtis, C.J., Anderson, S.E., et al.** "Computer-Generated Watercolor." *SIGGRAPH 1997*.
   - Three-layer fluid model (shallow water, pigment deposition, capillary)
   - Kubelka-Munk optical compositing for translucent ink layers
   - Edge darkening, backrun, and granulation algorithms
   - [Paper PDF](https://grail.cs.washington.edu/projects/watercolor/paper_small.pdf)
   - [US Patent 6198489](https://patents.google.com/patent/US6198489)

6. **Tyler Hobbs.** "A Guide to Simulating Watercolor Paint with Generative Art."
   - Practical approach: 30-100 stacked transparent layers at ~4% opacity
   - Recursive polygon deformation for edge variation
   - Texture masking for granulation effects
   - [Article](https://www.tylerxhobbs.com/words/a-guide-to-simulating-watercolor-paint-with-generative-art)

### Fountain Pen Technical References

7. **Fountain Pen Design** (blog) -- Comprehensive engineering analysis
   - [Capillary forces in feeds](https://fountainpendesign.wordpress.com/fountain-pen-feed-function/capillary-force-fountain-pen-feed/)
   - [Flex nib quantitative classification](https://fountainpendesign.wordpress.com/fountain-pen-nib-design-function/fountain-pen-flex-nibs-classification/)
   - [Ink chemistry and properties](https://fountainpendesign.wordpress.com/fountain-pen-ink-function-chemistry-quality/)

8. **Tom Gidden.** "Flex and the Art of Line Variation."
   - Explains mechanical flex behavior: deflection vs flexibility, tine splay mechanics
   - Nib thickness measurements: flex nibs ~0.25mm vs standard ~0.45mm
   - [Article](https://gidden.net/2018/12/12/flex-and-the-art-of-line-variation/)

9. **Mountain of Ink.** "Fountain Pen Ink Properties."
   - Comprehensive catalog of ink behaviors: shading, sheening, shimmer, dry time, flow
   - Dry time range: 2-90 seconds, average 31.5 seconds
   - [Article](https://mountainofink.com/blog/ink-properties)

10. **Left Hook Pens.** "The Scale of Paper Absorption."
    - Systematic paper absorbency testing with quantitative data
    - Dry time measurements across papers and inks
    - [Article](https://lefthookpens.com/2020/11/14/the-scale-of-paper-absorption/)

11. **Unsharpen.** "What Is Fountain Pen Ink Sheen?"
    - Explains sheen as dye crystallization creating thin-film interference
    - Conditions: non-absorbent paper, wide nib, saturated ink
    - [Article](https://unsharpen.com/fountain-pen-ink-sheen/)

12. **Fountain Pen Love.** "What Is Fountain Pen Ink Shading?"
    - Shading as differential ink thickness across a stroke
    - Paper, nib, and ink factors
    - [Article](https://fountainpenlove.com/fountain-pen-ink/fountain-pen-ink-shading/)

13. **Pen Heaven.** "Fountain Pen Nib Width Comparison."
    - Nib size chart: EF 0.3-0.5mm, F 0.5-0.7mm, M 0.7-0.9mm, B ~1.2mm
    - [Article](https://www.penheaven.com/blog/fountain-pen-nib-width-comparison)

---

## 9. Key Takeaways for Digital Rendering Implementation

### Must-Have Effects (in order of visual impact)

1. **Speed-dependent ink density** -- Slower strokes are darker, faster strokes are lighter. This is the single most characteristic fountain pen behavior and produces natural shading.

2. **Pooling at velocity changes** -- Extra ink accumulation at stroke starts, ends, direction reversals, and sharp corners. These should be subtly darker spots.

3. **Pressure-dependent line width** -- For flex/brush pen modes. Apple Pencil pressure maps directly to tine splay model.

4. **Edge darkening** -- Subtle darkening at stroke edges from the coffee ring effect. This gives ink strokes their characteristic "depth" compared to flat digital lines.

5. **Intersection darkening** -- Where strokes cross, the combined ink is darker. Simple additive compositing.

### Nice-to-Have Effects

6. **Sheening** -- Secondary color overlay in highly saturated areas. Visually striking but only for specific ink selections.

7. **Shimmer** -- Random metallic specks within strokes. Purely cosmetic texture.

8. **Chromatographic shading** -- Color variation across the stroke width (different hue at edges vs center). Subtle but adds realism.

9. **Railroading** -- Visual artifact at extreme flex. Only relevant if supporting flex nib simulation.

### Simplified Model for Real-Time Rendering

For a practical Apple Pencil implementation, the key insight is:

**Ink darkness at any point = f(time_spent_at_that_location / speed) * f(pressure)**

This single relationship, properly tuned, captures the majority of visible fountain pen ink behavior. Everything else (sheening, edge darkening, pooling) is refinement of this core principle.
