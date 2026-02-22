# Fountain Pen Rendering: Comprehensive Research Synthesis

**Date:** 2026-02-21
**Purpose:** Consolidated findings from three parallel research efforts on realistic fountain pen rendering for ObsidianPaper, covering ink physics, digital rendering techniques, and visual characteristics.

---

## Executive Summary

Real fountain pen ink has five core visual characteristics that distinguish it from flat digital strokes:

1. **Shading** - Speed-dependent darkness variation along strokes (slow = dark, fast = light)
2. **Edge darkening** - Coffee ring effect creates darker edges, lighter center
3. **Ink pooling** - Dark blobs at stroke start/end, direction changes, and intersections
4. **Subtle texture** - Paper grain interaction and slightly irregular edges
5. **Sheening** - (Optional) Secondary color in heavily saturated areas

All of these can be achieved through a **stamp-based rendering approach** building on the existing pencil stamp infrastructure, with key differences in stamp shape, spacing, and opacity behavior.

---

## Current State of the Codebase

### Fountain Pen (Current)
- **Outline-based rendering** via `ItalicOutlineGenerator.ts` with `Path2D.fill()`
- Italic nib model: width varies by `|sin(nibAngle - strokeAngle)|`
- Config: `baseWidth: 6, nibAngle: PI/6, nibThickness: 0.25, stamp: null`
- Ink pooling via `InkPooling.ts` as post-render radial gradients
- No texture, no shading, no velocity-dependent effects

### Pencil Stamps (Reference)
- **Particle scatter model**: Many tiny particles (0.6px) scattered within stroke disk
- `StampRenderer.ts` → `StampTexture.ts` → `StampCache.ts` → `StampTextureManager.ts`
- `StampAccumulator` tracks incremental rendering progress
- `GrainMapping.ts` maps grain slider to texture config
- Full worker support via `tileWorker.ts`

---

## The Core Insight: Ink Darkness = f(1/speed)

The single most important physical relationship (Kim et al., Physical Review Letters, 2011):

```
ink_per_unit_length = base_flow_rate / pen_speed
```

This means:
- Stamp-based rendering with **velocity-dependent spacing** naturally produces shading
- Slower movement = stamps closer together = more alpha accumulation = darker
- Faster movement = stamps farther apart = less accumulation = lighter
- No special computation needed beyond controlling stamp spacing based on point velocity

The alpha accumulation formula `totalAlpha = 1 - (1-a)^N` produces a logarithmic buildup that mirrors the Beer-Lambert law governing real ink opacity.

---

## Proposed Stamp Architecture: Ink vs Pencil

| Aspect | Pencil (Current) | Fountain Pen Ink (Proposed) |
|--------|------------------|---------------------------|
| Stamp size | Tiny (0.6-2px particles) | Large (60% of stroke width) |
| Stamps per step | Many (15+ scattered) | 1 along centerline |
| Distribution | Random scatter within disk | Centerline with slight jitter |
| Opacity per stamp | Variable (grain noise) | Low uniform (0.15-0.25, builds up) |
| Edge profile | Quadratic falloff from center | **Donut**: hollow center, peak at ~65% radius |
| Velocity effect | None | Slower = closer spacing = darker |
| Grain texture | High contrast, paper-like | Subtle, smooth variation |
| Stamps/frame | ~3000 (many particles) | ~100-200 (single per step) |

### Stamp Shape: The "Donut" Profile

The key innovation for fountain pen rendering is a stamp with a slightly hollow center that peaks near the edges. This produces edge darkening (coffee ring effect) naturally through overlap:

```
alpha(r, R) =
  gaussian(r, sigma=0.42*R)  // Base shape
  * (0.75 + 0.25 * smoothstep(0.15*R, 0.55*R, r))  // Center hollow
```

When stamps overlap along the centerline:
- Center: moderate darkness (each stamp is slightly hollow here)
- Near-edge: darker (each stamp peaks here)
- Extreme edge: Gaussian falloff

The edge darkening strength is controlled by a single parameter that adjusts the center hollow depth.

---

## Effect-by-Effect Implementation Guide

### 1. Ink Shading (Velocity-Dependent Darkness)

**Mechanism:** Combined stamp spacing + opacity modulation

```
speed_factor = clamp(velocity / velocity_ref, 0, 1)
effective_spacing = base_spacing * (1.0 + 0.5 * speed_factor)
stamp_opacity = base_opacity * (1.0 - 0.4 * speed_factor)
```

**Shading amount parameter** (0.0 = flat ink like Bulletproof Black, 1.0 = dramatic like Autumn Oak) scales the speed sensitivity:
```
speed_shading_factor = shading_amount * 2.0
```

### 2. Edge Darkening (Coffee Ring Effect)

**Mechanism:** Donut stamp opacity profile (described above)

Real ink edges are 15-30% darker than center on quality paper. The donut stamp profile creates this naturally. Controlled by `edge_darkening_strength` (0.0-1.0).

### 3. Ink Pooling (Start/End/Direction Changes)

**Already partially implemented** in `InkPooling.ts`. For stamp-based rendering, integrate directly:

**Stroke start (first 3-5 stamps):**
- Increase stamp size by 1.2-1.4x
- Decrease spacing by 0.5x
- Gradual transition back to normal

**Stroke end (last 3-5 stamps):**
- If velocity approaching zero: increase size 1.2-1.6x, decrease spacing 0.3-0.5x
- If quick lift: use natural pressure taper from Apple Pencil

**Direction changes:**
- At low-velocity high-curvature points: emit extra stamp at apex

### 4. Edge Texture / Feathering

**Mechanism:** Two-octave noise displacement on stamp positions near stroke boundary + irregular stamp edges

```
displacement = noise(x * scale, y * scale) * stroke_width * feathering_amount
// Apply perpendicular to stroke direction
```

Each stamp variant also has a slightly non-circular edge via radial noise:
```
effective_radius = base_radius * (1.0 + noise(theta * 4 + seed) * 0.06)
```

**Feathering amount:** 0.02 (Tomoe River) to 0.12 (copy paper), default 0.05

### 5. Paper Grain Interaction

**Mechanism:** Existing `GrainTextureGenerator` with ink-appropriate config

```
grain_config = { scale: 12, octaves: 2, threshold: 0.75, softness: 0.2 }
final_opacity = stamp_opacity * (1.0 - grain_influence * (1.0 - grain_value))
```

Grain is more visible in light ink areas, invisible in heavy areas:
```
grain_influence = paper_roughness * (1.0 - clamp(ink_darkness, 0, 0.8))
```

### 6. Intersection Darkening

Standard `source-over` compositing naturally produces ~20-35% darkening at crossings (wet-on-dry). This is sufficient for most cases. For wet-on-wet simulation, a subtle opacity boost at crossing positions can be added.

### 7. Sheening (Optional, Future)

Conditional overlay where ink saturation exceeds paper absorption capacity:
```
if (local_ink_volume > sheen_threshold):
  blend(base_color, sheen_color, (volume - threshold) / range)
```

---

## Paper Type Presets

### Fine Paper (Tomoe River)
```
edge_darkening: 0.80, shading: 1.30x, feathering: 0.02
grain: 0.05, stamp_sigma: 0.30*R, base_opacity: 0.22
sheen: enabled at 80% saturation
```

### Quality Paper (Rhodia) -- DEFAULT
```
edge_darkening: 0.50, shading: 1.00x, feathering: 0.05
grain: 0.12, stamp_sigma: 0.38*R, base_opacity: 0.20
sheen: disabled
```

### Standard Paper (Copy Paper)
```
edge_darkening: 0.15, shading: 0.60x, feathering: 0.12
grain: 0.25, stamp_sigma: 0.48*R, base_opacity: 0.16
sheen: disabled
```

---

## Ink Type Presets

### Shading Ink (Diamine Oxblood / Autumn Oak)
```
shading: 0.70, opacity_range: [0.12, 0.85], crossing_darkening: 0.30
```

### Flat Ink (Bulletproof Black / Carbon Black)
```
shading: 0.10, opacity_range: [0.60, 0.95], crossing_darkening: 0.15
```

### Sheening Ink (Nitrogen / Milky Ocean)
```
shading: 0.50, opacity_range: [0.15, 0.90], sheen_color: [R,G,B], sheen_max: 0.40
```

### Iron Gall Ink (KWZ IG / Salix)
```
shading: 0.35, opacity_range: [0.25, 0.80], feathering_override: 0.02
```

---

## Performance Budget

**Target:** 120fps on iPad Pro via Obsidian WebView

- `drawImage()` with pre-rendered stamp: ~0.005ms per stamp
- Ink stamp model: ~100-200 stamps per frame (vs. ~3000 for pencil scatter)
- Well within the 8ms frame budget
- Full LOD system already in place (stamps at LOD 0 only, filled polygon fallback at LOD 1+)
- Worker pool distributes tile rendering across 4+ threads

---

## Implementation Priority (Recommended Order)

### Phase 1: Core Stamp Rendering
1. Create ink stamp texture generator (donut profile, 4-8 variants)
2. Implement ink stamp computation (single stamp per step, velocity-based spacing)
3. Wire into pen config as `stamp` pipeline for fountain pen
4. Remove/replace outline-based rendering at LOD 0

### Phase 2: Shading and Pooling
5. Add velocity-based opacity + spacing modulation
6. Integrate ink pooling into stamp system (start/end blobs)
7. Add shading amount parameter to pen config

### Phase 3: Texture and Polish
8. Add feathering noise for edge irregularity
9. Integrate paper grain modulation
10. Add paper type presets

### Phase 4: Advanced Effects (Optional)
11. Sheening overlay for saturated areas
12. Ink type presets
13. Shimmer particles (metallic specks)

---

## Key References

### Academic
- Kim et al., "Hydrodynamics of Writing with Ink" (PRL, 2011) - Ink flow physics
- Curtis et al., "Computer-Generated Watercolor" (SIGGRAPH, 1997) - Fluid rendering
- Ciallo, GPU-Accelerated Brush Strokes (SIGGRAPH, 2024) - Modern stamp rendering
- Deegan et al., "Coffee Ring Effect" (Nature, 1997) - Edge darkening physics

### Technical
- Microsoft Patent US20170278275A1 - Dual-texture stamp rendering
- Wacom WILL SDK - Professional ink pipeline architecture
- Procreate Brush Engine - Shape+Grain composition model

### Fountain Pen
- Fountain Pen Design (blog) - Engineering analysis of nibs, feeds, flex
- Mountain of Ink - Comprehensive ink behavior catalog
- JetPens - Intermediate Guide to Ink Properties
- Left Hook Pens - Paper absorption scale
