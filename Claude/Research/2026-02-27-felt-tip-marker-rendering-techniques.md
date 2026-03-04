# Felt Tip Marker Rendering Techniques for Real-Time Digital Applications

**Date**: 2026-02-27
**Focus**: Comprehensive research on rendering realistic felt tip marker strokes using WebGL/Canvas2D

---

## 1. Physical Characteristics of Felt Tip Markers

### 1.1 Tip Construction and Ink Mechanics

Felt tip marker nibs are made of **highly compressed synthetic fibers or porous ceramics** pressed together tightly enough for ink to creep and crawl through the spaces between fibers via capillary action. The porous structure is fundamental to how these instruments function -- ink is stored in a reservoir (typically a felt or polyester wadding saturated with ink) and drawn to the tip through capillary wicking.

**Key physical properties:**

| Property | Description |
|----------|-------------|
| **Tip material** | Compressed polyester, nylon, or acetal fibers; some use sintered porous plastic beads |
| **Tip shapes** | Round (bullet), chisel (rectangular), brush (flexible), fine point |
| **Ink types** | Water-based (washable), alcohol-based (permanent, blendable), oil-based |
| **Ink carrier** | Solvents (water, ethanol, or isopropanol) carry dye or pigment to paper |

### 1.2 What Makes Felt Tip Marks Distinctive

**a) Semi-transparency and ink layering:**
Marker ink is inherently semi-transparent. A single pass deposits a layer of color that allows the paper (or underlying colors) to show through. Subsequent passes over the same area **build up opacity progressively**, creating darker/richer color at overlaps. This is the defining visual characteristic -- markers self-blend where strokes overlap.

For alcohol-based markers, the alcohol acts as a solvent that reactivates previously deposited ink, creating smooth gradients at overlap boundaries. Water-based markers have less reactivation, producing more distinct layer boundaries.

**b) Chisel/rectangular tip behavior:**
A chisel tip produces **variable-width strokes depending on the angle of contact**. When dragged along its wide edge, it creates broad strokes; turned to the corner, it creates thin lines. The stroke width at any point is determined by:
- The **azimuth angle** (rotation around the vertical axis) -- which face of the chisel contacts paper
- The **altitude angle** (tilt) -- how much of the chisel face is in contact
- The **direction of motion** -- the tip naturally rotates to align with stroke direction

**c) Edge characteristics:**
Real marker strokes have **slightly fuzzy/fibrous edges**, not perfectly smooth boundaries. This comes from:
- Individual fiber tips at the nib edge creating micro-irregularities
- Ink feathering into paper fibers at the stroke boundary
- Capillary spreading in the paper substrate
- The edges are softer than pen ink but sharper than watercolor

**d) Ink saturation patterns:**
- **Stroke start**: Heavy ink deposit (the tip is loaded/saturated)
- **Mid-stroke**: Even, consistent deposit
- **Stroke end**: Slight feathering/lightening
- **After extended use without re-saturation**: Gradual drying producing streaks where individual fibers leave visible trails (the "dry marker" effect)
- **Pausing on paper**: Heavy ink deposit/pooling (blunt, saturated start/end marks)

**e) Speed effects:**
- **Slow strokes**: More ink deposit, richer color, more time for capillary spreading (wider effective stroke)
- **Fast strokes**: Less ink deposit, lighter color, potential for skipping/streaking at high speeds
- **Very fast**: Can produce broken, streaky marks showing individual fiber trails

### 1.3 Chisel Tip Geometry

The chisel tip can be modeled as a **rounded rectangle** with:
- **Major axis**: The wide face of the chisel (typically 3-8mm for standard markers)
- **Minor axis**: The thin edge (typically 1-2mm)
- **Corner radius**: Small rounding at the corners

The effective footprint on paper at any moment is determined by projecting this rectangle onto the drawing surface at the current tilt and azimuth angles:

```
Effective footprint = project(chiselRect, altitude, azimuth)

Where:
- At altitude = 90deg (perpendicular): Full rectangle contact
- At altitude < 90deg: Elliptical projection of the rectangle
- Rotation = azimuth angle determines which edge leads
```

---

## 2. Digital Rendering Techniques for Felt Tip Markers

### 2.1 Stamp-Based Rendering (Primary Approach)

Stamp-based rendering is the dominant technique used by professional drawing applications (Procreate, Krita, Concepts). A stroke is formed by repeatedly "stamping" a brush shape along the stroke path.

**Core algorithm:**
1. Generate a **stamp texture** representing the marker tip footprint
2. Place stamps at **evenly-spaced intervals** along the stroke path (arc-length parameterized)
3. Each stamp varies in **size, rotation, and opacity** based on pressure/tilt/speed
4. Stamps **blend together** using appropriate compositing to create the continuous stroke

**For a felt tip marker, the stamp should be:**
- A **rounded rectangle** (not a circle) for chisel tips
- **Oriented to follow the stroke direction** (or pencil azimuth if available)
- Semi-transparent (alpha ~ 0.3-0.6 per stamp)
- Placed with **tight spacing** (3-8% of stamp diameter) for smooth coverage

**Stamp placement (from existing codebase pattern):**

```typescript
// Incremental stamp placement along stroke path
// From StampTypes.ts pattern -- [x, y, size, opacity] tuples
interface MarkerStampPlacement {
  x: number;
  y: number;
  width: number;    // Major axis of chisel footprint
  height: number;   // Minor axis of chisel footprint
  rotation: number; // Orientation of the chisel tip
  opacity: number;  // Per-stamp opacity
}
```

### 2.2 Alpha Blending Strategy for Ink Layering

The critical challenge for marker rendering is achieving the correct **within-stroke vs. between-stroke** transparency behavior:

**Within a single stroke**: Stamps should blend together without creating visible darkening at overlaps. The ink should appear as a uniform semi-transparent wash.

**Between strokes**: Where two separate strokes overlap, the ink should build up (darken), simulating real marker layering.

#### Technique: Offscreen Isolation (Render-to-Texture)

This is the standard solution used by professional drawing apps:

1. **Render the entire stroke** to an offscreen buffer/framebuffer at **full opacity**
2. **Composite** the finished stroke onto the canvas at the **stroke's target opacity**
3. This prevents within-stroke alpha accumulation while preserving between-stroke layering

```
// Pseudocode for isolated marker stroke rendering:
offscreen = createOffscreenBuffer(canvasWidth, canvasHeight)
offscreen.clear()

// Render all stamps at full opacity to offscreen buffer
for each stamp in stroke:
    offscreen.drawStamp(stamp, opacity=1.0)

// Composite finished stroke to canvas at marker opacity
canvas.globalAlpha = markerOpacity  // e.g., 0.6
canvas.drawImage(offscreen, 0, 0)
```

**WebGL implementation using framebuffers:**

```typescript
// 1. Create framebuffer for stroke isolation
const fb = gl.createFramebuffer();
const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

// 2. Render stroke stamps to framebuffer
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT);
// Enable max blending to prevent within-stroke darkening:
gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
renderAllStamps(strokeStamps);

// 3. Composite to main canvas
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
drawFullscreenQuad(tex, markerOpacity);
```

#### Alternative: Max-Alpha Blending Within Stroke

Instead of offscreen isolation, use a custom blend function that takes the **maximum** alpha rather than accumulating:

```
// WebGL custom blending for marker-like behavior:
gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX);  // MAX for alpha channel
gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
```

This makes overlapping stamps within a stroke take the maximum alpha value rather than accumulating, preventing darkening. However, this requires WebGL2 or the `EXT_blend_minmax` extension.

**Note**: The existing codebase already supports offscreen isolation via `DrawingBackend.beginOffscreen()`/`endOffscreen()` and the `StrokeMaterial.isolation` flag. This is the mechanism to use.

### 2.3 Chisel Tip Rotation with Stroke Direction

For a chisel/rectangular tip that rotates with stroke direction:

```typescript
function computeChiselRotation(
  prevPoint: { x: number; y: number },
  currPoint: { x: number; y: number },
  azimuthAngle: number | null,  // From Apple Pencil, if available
): number {
  if (azimuthAngle != null) {
    // Use actual pencil azimuth for realistic chisel rotation
    return azimuthAngle;
  }

  // Fall back to stroke direction
  const dx = currPoint.x - prevPoint.x;
  const dy = currPoint.y - prevPoint.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return 0;

  return Math.atan2(dy, dx);
}
```

**Apple Pencil integration**: Apple Pencil provides both altitude (tilt) and azimuth (rotation) angles. For chisel tip simulation:
- **Azimuth** directly maps to chisel tip orientation
- **Altitude** affects the contact footprint area (more tilt = more of the chisel face contacts paper)
- iPadOS 16.4+ provides tilt and azimuth in hover mode, enabling preview of the mark before contact

**From the Kodeco Apple Pencil tutorial:**
The azimuth unit vector has length 1 and points from (0,0) towards the pencil's tilt direction. When the pencil tip points right, the vector approximates (1, 0). The formula for calculating variable width based on chisel orientation:

```typescript
// Angle between stroke direction and pencil azimuth
// Maximum width when stroking perpendicular to tilt direction
const strokeAngle = Math.atan2(dy, dx);
const azimuthAngle = Math.atan2(azimuthY, azimuthX);
const angleDiff = Math.abs(strokeAngle - azimuthAngle);
const normalizedAngle = angleDiff / (Math.PI / 2); // 0-1 range
const effectiveWidth = minWidth + normalizedAngle * (maxWidth - minWidth);
```

### 2.4 Edge Treatment for Fibrous Look

To simulate the slightly fuzzy/fibrous edges of a marker:

**Approach 1: Noise-displaced edge**
Apply noise displacement to the stamp boundary:

```glsl
// Fragment shader: noise-displaced edge
uniform float u_edgeFuzziness;  // 0.0 = sharp, 1.0 = very fuzzy
uniform vec2 u_noiseScale;

float markerEdge(vec2 uv, vec2 halfSize) {
    // Base SDF for rounded rectangle
    vec2 d = abs(uv) - halfSize + vec2(cornerRadius);
    float baseDist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - cornerRadius;

    // Noise displacement at the edge
    float noise = snoise(uv * u_noiseScale) * u_edgeFuzziness;
    float dist = baseDist + noise * halfSize.x * 0.05;

    // Smooth edge with slight softness
    return 1.0 - smoothstep(-0.5, 0.5, dist);
}
```

**Approach 2: Pre-rendered stamp with fibrous edges**
Create the stamp texture with built-in edge irregularity:

```typescript
function createMarkerStamp(
  width: number,
  height: number,
  edgeFuzziness: number,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width + 4, height + 4); // Margin for fuzzy edge
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const data = imageData.data;

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const hw = width / 2;
  const hh = height / 2;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);

      // Rounded rectangle SDF
      const qx = Math.max(dx - hw + 1, 0);
      const qy = Math.max(dy - hh + 1, 0);
      const dist = Math.sqrt(qx * qx + qy * qy) - 1;

      // Noise for fibrous edge
      const noise = (Math.random() - 0.5) * edgeFuzziness * 2;
      const effectiveDist = dist + noise;

      // Smooth alpha with noise-displaced edge
      const alpha = Math.max(0, Math.min(1, 1 - effectiveDist));

      const idx = (y * canvas.width + x) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
```

### 2.5 Opacity vs. Flow Model

Professional drawing apps distinguish between **opacity** and **flow** for marker rendering:

- **Opacity**: The maximum alpha a single stroke can achieve. Within a stroke, alpha cannot exceed this value regardless of how many times you go over the same area. This is the "marker" behavior.
- **Flow**: The rate at which ink is deposited per stamp. Low flow means gradual buildup within a stroke; high flow means quick saturation.

**For felt tip markers:**
- Opacity should be set to the marker's target transparency (e.g., 0.5-0.8)
- Flow should be high (0.7-1.0) since markers deposit ink readily
- Within-stroke behavior: stamps blend to approach but not exceed opacity
- Between-stroke behavior: each stroke adds another layer at the stroke's opacity

The existing `StrokeMaterial` system supports this via:
- `bodyOpacity`: Maps to the stroke-level opacity
- `isolation: true`: Enables the offscreen buffer approach for within-stroke consistency

---

## 3. WebGL/GPU Shader Approaches

### 3.1 Fragment Shader for Marker Texture

A procedural marker texture in a fragment shader:

```glsl
precision highp float;

varying vec2 v_uv;           // Texture coordinates within stamp (0-1)
uniform vec2 u_stampSize;     // Width, height of chisel footprint
uniform float u_cornerRadius; // Rounded corner radius
uniform float u_edgeNoise;    // Edge fuzziness amount
uniform float u_fiberDensity; // Internal fiber texture density

// Simplex noise function (from ashima/webgl-noise)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187,   // (3.0-sqrt(3.0))/6.0
                        0.366025403784439,    // 0.5*(sqrt(3.0)-1.0)
                       -0.577350269189626,    // -1.0 + 2.0 * C.x
                        0.024390243902439);   // 1.0 / 41.0
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m;
    m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

// Rounded rectangle SDF
float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
    // Map UV to centered coordinates
    vec2 p = (v_uv - 0.5) * u_stampSize;
    vec2 halfSize = u_stampSize * 0.5;

    // Base shape: rounded rectangle
    float dist = sdRoundedBox(p, halfSize * 0.9, u_cornerRadius);

    // Edge noise displacement
    float edgeNoise = snoise(v_uv * 40.0) * u_edgeNoise;
    dist += edgeNoise;

    // Smooth alpha at edges
    float edgeAlpha = 1.0 - smoothstep(-1.0, 0.5, dist);

    // Internal fiber texture (subtle streaks along the major axis)
    float fiberNoise = snoise(vec2(v_uv.x * 2.0, v_uv.y * u_fiberDensity * 20.0));
    float fiber = 0.85 + 0.15 * fiberNoise;

    // Slight pressure falloff from center
    float centerDist = length(p / halfSize);
    float pressureFalloff = 1.0 - 0.15 * centerDist * centerDist;

    // Combine
    float alpha = edgeAlpha * fiber * pressureFalloff;

    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}
```

### 3.2 Fiber/Grain Texture Generation

For creating the internal texture that gives markers their characteristic non-uniform appearance:

```glsl
// Directional fiber texture -- fibers run along the major axis of the chisel
float fiberTexture(vec2 uv, float angle, float density, float roughness) {
    // Rotate UV to align with fiber direction
    float c = cos(angle);
    float s = sin(angle);
    vec2 rotUV = vec2(
        uv.x * c - uv.y * s,
        uv.x * s + uv.y * c
    );

    // Multi-octave noise stretched along fiber direction
    float fiber = 0.0;
    float amplitude = 1.0;
    float frequency = density;

    for (int i = 0; i < 3; i++) {
        // Anisotropic noise: stretch along fiber direction
        vec2 noiseCoord = vec2(rotUV.x * frequency * 0.3, rotUV.y * frequency);
        fiber += snoise(noiseCoord) * amplitude;
        amplitude *= roughness;
        frequency *= 2.0;
    }

    // Normalize to 0-1
    return 0.5 + 0.5 * fiber;
}
```

**Combining fiber texture with the stamp:**

```glsl
// In the stamp fragment shader:
float fiberVal = fiberTexture(v_uv, fiberAngle, 8.0, 0.5);

// Apply fiber texture as subtle opacity variation
// This creates the characteristic non-uniform ink deposit of real markers
float fiberModulation = mix(0.85, 1.0, fiberVal); // Subtle: 85%-100% range
float finalAlpha = baseAlpha * fiberModulation;
```

### 3.3 Blending Modes for Ink Compositing

**Standard source-over** (default, suitable for opaque markers):
```
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
```

**Multiply blending** (for highlighter-style markers):
```glsl
// Fragment shader for multiply blend:
vec4 src = texture2D(u_srcTex, v_uv);
vec4 dst = texture2D(u_dstTex, v_uv);
vec4 result = src * dst; // Multiply mode
result = mix(dst, result, src.a); // Apply only where source has alpha
gl_FragColor = result;
```

The existing `StrokeMaterial.blending` field already supports `"source-over"` and `"multiply"`.

**For marker-specific compositing in WebGL:**

```typescript
// Marker stroke compositing pipeline:
function renderMarkerStroke(engine: RenderEngine, stroke: Stroke) {
  // 1. Begin offscreen isolation
  const offscreen = engine.getOffscreen('marker-stroke', width, height);
  engine.beginOffscreen(offscreen);
  engine.clear();

  // 2. Render stamps with source-over blending
  //    Alpha accumulates within the offscreen buffer
  engine.setBlendMode('source-over');
  engine.setAlpha(1.0); // Full opacity within buffer

  for (const stamp of computeStampPlacements(stroke)) {
    engine.drawStamp(markerTexture, stamp);
  }

  // 3. End offscreen and composite at marker opacity
  engine.endOffscreen();
  engine.setAlpha(stroke.style.opacity); // Marker's semi-transparency
  engine.drawOffscreen(offscreen, 0, 0, width, height);
}
```

### 3.4 SDF Approaches for Tip Shape

Signed Distance Fields are excellent for rendering the chisel tip shape because they provide:
- **Resolution independence**: The shape looks crisp at any zoom level
- **Easy anti-aliasing**: Use `smoothstep` on the distance value
- **Simple rotation**: Just rotate the input coordinates
- **Composable**: Combine multiple SDFs for complex shapes

**Core 2D SDFs for marker tips** (from Inigo Quilez):

```glsl
// Circle (round tip marker)
float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

// Box (chisel tip)
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Rounded box (chisel tip with rounded corners)
float sdRoundedBox(vec2 p, vec2 b, vec4 r) {
    r.xy = (p.x > 0.0) ? r.xy : r.zw;
    r.x  = (p.y > 0.0) ? r.x  : r.y;
    vec2 q = abs(p) - b + r.x;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

// Usage for a chisel tip stamp:
float chiselTip(vec2 uv, vec2 size, float rotation, float cornerRadius) {
    // Center and rotate
    vec2 p = uv - 0.5;
    float c = cos(rotation);
    float s = sin(rotation);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    // Scale to stamp dimensions
    p *= size;

    // Rounded rectangle SDF
    float dist = sdRoundedBox(p, size * 0.45, vec4(cornerRadius));

    // Anti-aliased edge
    return 1.0 - smoothstep(-0.5, 0.5, dist);
}
```

---

## 4. Texture and Noise Approaches

### 4.1 Textures for Marker Rendering

Realistic marker rendering uses several texture types:

**a) Stamp/footprint texture**: The base shape of a single marker dab. For felt tips, this should be a rounded rectangle with soft edges and slight internal variation.

**b) Fiber/grain texture**: Internal texture simulating the micro-pattern left by the felt tip fibers. This is typically:
- Anisotropic (stretched along one direction -- the direction of fibers in the nib)
- Low-frequency (large-scale) variation
- Subtle (5-20% opacity modulation within the stamp)

**c) Paper texture**: The substrate texture that interacts with the ink. Not part of the marker itself, but affects the final appearance. Can be applied as a post-effect or mixed into the stamp.

### 4.2 Tiling Textures Along a Stroke Path

For effects that need to tile along the stroke (like the dry-marker streaking effect):

```typescript
// Generate UV coordinates along the stroke path for texture tiling
function computeStrokeUVs(
  points: StrokePoint[],
  strokeWidth: number,
): { u: number; v: number }[] {
  const uvs: { u: number; v: number }[] = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      cumulativeDistance += Math.sqrt(dx * dx + dy * dy);
    }

    // U runs along stroke length, V runs across stroke width
    uvs.push({
      u: cumulativeDistance / strokeWidth, // Tiles based on stroke width
      v: 0.5, // Center of stroke; actual V comes from vertex position
    });
  }

  return uvs;
}
```

**In a vertex shader:**

```glsl
attribute vec2 a_position;
attribute vec2 a_strokeUV;  // Pre-computed stroke-space UVs

varying vec2 v_strokeUV;

void main() {
    v_strokeUV = a_strokeUV;
    gl_Position = u_projectionMatrix * vec4(a_position, 0.0, 1.0);
}
```

**In the fragment shader:**

```glsl
varying vec2 v_strokeUV;
uniform sampler2D u_fiberTexture;
uniform float u_tileScale;

void main() {
    // Tile the fiber texture along the stroke
    vec2 tiledUV = fract(v_strokeUV * u_tileScale);
    float fiberValue = texture2D(u_fiberTexture, tiledUV).r;

    // Modulate alpha with fiber texture
    float alpha = baseAlpha * mix(0.8, 1.0, fiberValue);
    gl_FragColor = vec4(u_color.rgb, alpha);
}
```

### 4.3 Noise Functions for Organic Feel

**Simplex noise** (from ashima/webgl-noise, GLSL):

The simplex noise function is the recommended choice for organic marker effects because:
- It is faster than classic Perlin noise
- It has fewer directional artifacts
- It scales to higher dimensions with less computational cost
- It has well-defined continuous gradients

**Fractional Brownian Motion (fBm) for complex textures:**

```glsl
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < octaves; i++) {
        value += amplitude * snoise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// Usage for marker edge displacement:
float edgeDisplacement = fbm(v_uv * 20.0, 3) * edgeFuzzAmount;

// Usage for internal fiber texture:
float fiberPattern = fbm(vec2(v_uv.x * 2.0, v_uv.y * 15.0), 2);
```

**Film grain noise** (from mattdesl/glsl-film-grain, adapted for marker grain):

```glsl
// Hash-based noise for per-frame grain variation
float random(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

float grainNoise(vec2 uv, float t) {
    float noise = random(uv + t);
    // Apply Gaussian-like distribution for more natural grain
    noise = pow(noise, 0.5); // Brighten -- felt tips deposit more than they skip
    return noise;
}
```

### 4.4 Dry Marker Effect (Ink Depletion)

One of the most distinctive marker effects is the gradual depletion of ink over a long stroke:

```typescript
// Compute ink depletion factor along stroke
function computeInkDepletion(
  cumulativeDistance: number,
  speed: number,
  depletionRate: number, // How quickly ink runs out (0.001 = slow, 0.01 = fast)
): number {
  // Ink level decreases with distance, faster at higher speeds
  const speedFactor = 1 + speed * 0.5;
  const inkLevel = Math.exp(-cumulativeDistance * depletionRate * speedFactor);
  return Math.max(0.1, inkLevel); // Never fully runs out
}

// Apply to stamp opacity:
const depletionFactor = computeInkDepletion(stamp.distance, stamp.speed, 0.003);
const finalOpacity = stamp.baseOpacity * depletionFactor;
```

For the "streaky dry marker" effect (visible individual fiber trails):

```glsl
// Fragment shader for dry marker streaks
float dryMarkerEffect(vec2 uv, float inkLevel) {
    // At full ink, uniform coverage
    // As ink depletes, individual fiber streaks become visible

    // Fiber streak pattern (high-frequency noise along major axis)
    float streaks = snoise(vec2(uv.x * 3.0, uv.y * 80.0));
    streaks = smoothstep(-0.3, 0.3, streaks); // Hard threshold for streak pattern

    // Mix between uniform (wet) and streaky (dry) based on ink level
    float coverage = mix(streaks, 1.0, inkLevel);

    return coverage;
}
```

---

## 5. Reference Implementations and Key Papers

### 5.1 Academic Papers

**"Efficient Rendering of Linear Brush Strokes"** -- Apoorva Joshi (JCGT, 2018)
- [Paper (PDF)](https://jcgt.org/published/0007/01/01/paper.pdf)
- [Author's explanation](https://apoorvaj.io/efficient-rendering-of-linear-brush-strokes/)
- Key innovation: Replaces discrete stamp overlays with continuous integration. Instead of repeatedly stamping circles, it models a stamp "continuously slid across the central stroke axis." For any pixel, the intensity is computed as: `alpha(X,Y) = integral from X1 to X2 of f(x, X, Y) dx`, where X1 and X2 are the first and last stamp centers that touched the pixel. Supports varying diameter, hardness, and flow along the stroke for pressure-sensitive input.

**"Ciallo: GPU-Accelerated Rendering of Vector Brush Strokes"** -- SIGGRAPH 2024
- [ACM Paper](https://dl.acm.org/doi/10.1145/3641519.3657418)
- [GitHub (Ciallo)](https://github.com/ShenCiao/Ciallo)
- [Research repo](https://github.com/ShenCiao/CialloResearch)
- [Tutorial series](https://github.com/ShenCiao/brush-rendering-tutorial)
- Introduces GPU-based rendering techniques for vanilla, stamp, and airbrush strokes. Bridges raster and vector stroke representations. Features vectorized stamp brushes entirely rendered on GPU. Key contribution: "ratio-distance" density control that sets intervals between dots proportional to their radii.

**"MoXi: Real-time ink dispersion in absorbent paper"** -- ACM TOG 2005
- [ACM Paper](https://dl.acm.org/doi/10.1145/1073204.1073221)
- Physically-based ink dispersion simulation using lattice Boltzmann equation. Relevant for understanding ink-paper interaction, though more computationally expensive than needed for real-time marker rendering.

**"Compositing Digital Images"** -- Porter & Duff (SIGGRAPH 1984)
- The foundational framework for alpha compositing. Defines the Porter-Duff operators (over, in, out, atop, etc.) used in all digital compositing.

### 5.2 Open-Source Implementations

**glbrush.js** -- WebGL brush rendering library
- [GitHub](https://github.com/Oletus/glbrush.js)
- [Design wiki](https://github.com/Oletus/glbrush.js/wiki/glbrush.js-design)
- WebGL + Canvas2D backends. Design principle: draw operations are < 1ms per event with midrange GPU. Uses PictureBuffer architecture with linear event stacks. Supports hard-edged, soft, and texturized circular airbrush with opacity, flow, and dynamic size. 16-bit internal precision for better quality than Canvas2D alone.

**brushtips** -- WebGL + TypeScript brush drawing
- [GitHub](https://github.com/darknoon/brushtips)
- Simple experiment with Catmull-rom interpolation, input distance filtering, variable sharpness, and accepts input at greater than screen refresh rate. Good reference for basic WebGL brush stroke architecture.

**p5.brush** -- p5.js brush library
- [GitHub](https://github.com/acamposuribe/p5.brush)
- Extensible brush system with marker type support. Supports custom brush tips, pressure sensitivity, spray, and watercolor-like fill effects. Uses `brush.add()` with configurable type, weight, vibration, definition, quality, opacity, spacing, blend settings, and pressure configurations.

**Canvas2DtoWebGL** -- Canvas2D API on WebGL
- [GitHub](https://github.com/jagenjo/Canvas2DtoWebGL)
- Ports Canvas2D methods to WebGL calls. Useful reference for understanding how Canvas2D operations map to GPU operations.

**ashima/webgl-noise** -- GLSL noise library
- [GitHub](https://github.com/ashima/webgl-noise)
- [Demo](https://stegu.github.io/webgl-noise/webdemo/)
- Self-contained GLSL implementations of Simplex and Perlin noise. No external data dependencies. The standard reference for noise in WebGL shaders.

**glNoise** -- WebGL noise collection
- [GitHub](https://github.com/FarazzShaikh/glNoise)
- Collection of GLSL noise functions with easy-to-use API for WebGL applications.

### 5.3 Commercial App Techniques

**Procreate** (iPad drawing app):
- Stamp-based brush engine with shape + grain system
- Stamps are placed along stroke path with configurable spacing
- Shape defines the stamp outline; grain defines the internal texture
- Rendering settings control compositing between stamps and canvas
- Apple Pencil pressure maps to size, opacity, and flow
- Tilt (altitude/azimuth) maps to stamp shape and rotation
- iPadOS 16.4+ provides hover preview with tilt/azimuth

**Paper by 53** (iPad sketch app):
- Known for its marker tool that simulates wet ink blending
- Uses velocity-based ink deposit (slower = more ink)
- Wet-on-wet effect where feathering brush strokes blend into each other
- Simple, intuitive tools prioritize feel over configurability

**Concepts** (vector sketching app):
- Custom brush system with tip assets
- Pressure-sensitive brush tips for interactive drawing
- Vector-based strokes enable infinite resolution

### 5.4 Key Resources for Shader Development

- [The Book of Shaders: Noise](https://thebookofshaders.com/11/) -- Comprehensive guide to procedural noise in GLSL
- [The Book of Shaders: Shapes](https://thebookofshaders.com/07/) -- SDF-based 2D shape rendering
- [Inigo Quilez: 2D Distance Functions](https://iquilezles.org/articles/distfunctions2d/) -- Definitive reference for 2D SDFs in GLSL
- [WebGL Fundamentals: Alpha](https://webglfundamentals.org/webgl/lessons/webgl-and-alpha.html) -- WebGL alpha handling
- [Canva Engineering: Alpha Blending](https://www.canva.dev/blog/engineering/alpha-blending-and-webgl/) -- Practical alpha blending in WebGL
- [Alpha Compositing (Bartosz Ciechanowski)](https://ciechanow.ski/alpha-compositing/) -- Interactive visual guide to alpha compositing
- [LearnOpenGL: Blending](https://learnopengl.com/Advanced-OpenGL/Blending) -- OpenGL blending modes
- [GLSL Noise Algorithms](https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83) -- Collection of noise implementations

---

## 6. Integration with ObsidianPaper Architecture

### 6.1 Current State

The codebase already has:
- A `"felt-tip"` pen type in `PenConfigs.ts` (line 115-137 of `/src/stroke/PenConfigs.ts`) with `baseWidth: 6`, `tiltConfig` for tilt sensitivity, and `outlineStrategy: "standard"`
- Currently renders as a simple `fill` body with no stamp/grain effects
- The `DrawingBackend` interface supports `drawStamps()` and offscreen isolation
- `StrokeMaterial` system supports `isolation: true` for offscreen rendering
- Existing stamp infrastructure (StampTypes, StampGenerator interface) for pencil and ink shading

### 6.2 What's Needed for Felt Tip Marker

To upgrade the felt-tip from a plain fill to a realistic marker:

**a) New stamp generator** -- A `MarkerStampGenerator` implementing `StampGenerator` that:
- Produces rounded rectangular stamps (not circular like pencil)
- Rotates stamps to follow stroke direction (or Apple Pencil azimuth)
- Applies tight spacing (3-8% of diameter)
- Includes ink depletion model for long strokes

**b) New material configuration** -- Update `resolveMaterial()` to produce a marker-specific material:
- `body: { type: "markerStamps" }` (new body type)
- `blending: "source-over"`
- `isolation: true` (to prevent within-stroke darkening)
- `bodyOpacity`: The marker's semi-transparency level

**c) Stamp texture generation** -- Either procedural (via shader) or pre-rendered:
- Rounded rectangle shape with configurable aspect ratio
- Fiber texture inside the stamp
- Slight edge noise for organic look
- Multiple variants for different ink saturation levels

**d) PenConfig updates** -- Add marker-specific configuration:
```typescript
// Potential PenStampConfig extension for markers:
interface MarkerStampConfig extends PenStampConfig {
  aspectRatio: number;      // Width/height of chisel footprint (e.g., 3.0)
  cornerRadius: number;     // Rounded corners (0-1 fraction of minor axis)
  edgeFuzziness: number;    // Edge noise amount (0-1)
  fiberDensity: number;     // Internal fiber texture density
  inkDepletionRate: number;  // How quickly ink depletes along stroke
  followDirection: boolean;  // Whether stamp rotates with stroke direction
}
```

**e) WebGL rendering path** -- The `RenderEngine` would need:
- Support for non-square stamp textures (width != height)
- Per-stamp rotation in the stamp batch data format (current format is `[x, y, size, opacity]` -- may need `[x, y, width, height, rotation, opacity]`)
- The offscreen isolation path already exists

### 6.3 Rendering Pipeline

```
Input: StrokePoints with pressure, tilt, speed
  |
  v
[1. Compute stamp placements]
  - Arc-length parameterized spacing
  - Interpolate pressure/tilt/speed at each placement
  - Compute chisel rotation per stamp
  - Compute ink depletion per stamp
  |
  v
[2. Generate stamp texture]
  - Rounded rectangle SDF shape
  - Fiber texture overlay
  - Edge noise
  - Cache/pre-generate stamp variants
  |
  v
[3. Render to offscreen buffer]
  - beginOffscreen()
  - For each stamp: drawStamp(texture, placement)
  - Stamps blend via source-over within buffer
  |
  v
[4. Composite to canvas]
  - endOffscreen()
  - setAlpha(markerOpacity)
  - drawOffscreen(buffer)
  - Result: uniform semi-transparent stroke
```

---

## 7. Summary of Recommended Approach

For ObsidianPaper's felt tip marker implementation:

1. **Stamp-based rendering** with a rounded rectangle stamp texture (procedurally generated or pre-rendered)
2. **Offscreen isolation** using the existing `beginOffscreen()`/`endOffscreen()` infrastructure to prevent within-stroke alpha accumulation
3. **Stroke-direction rotation** of stamps, with Apple Pencil azimuth override when available
4. **SDF-based shape** for the stamp footprint, with noise-displaced edges for organic feel
5. **Fiber texture** as subtle opacity modulation within the stamp (anisotropic noise stretched along the tip's major axis)
6. **Tight spacing** (3-8% of stamp diameter) for smooth coverage
7. **Ink depletion model** for long strokes (exponential decay based on cumulative distance and speed)
8. **Integration** via the existing `StampGenerator` interface and `StrokeMaterial` system

The combination of these techniques should produce a convincing felt tip marker that feels natural and performs well in real-time on iPad hardware.

---

## Sources

- [Efficient Rendering of Linear Brush Strokes (JCGT)](https://jcgt.org/published/0007/01/01/)
- [Efficient Rendering of Linear Brush Strokes -- Author Explanation](https://apoorvaj.io/efficient-rendering-of-linear-brush-strokes/)
- [Ciallo: GPU-Accelerated Rendering of Vector Brush Strokes (SIGGRAPH 2024)](https://dl.acm.org/doi/10.1145/3641519.3657418)
- [Ciallo GitHub](https://github.com/ShenCiao/Ciallo)
- [Brush Rendering Tutorial](https://github.com/ShenCiao/brush-rendering-tutorial)
- [glbrush.js](https://github.com/Oletus/glbrush.js)
- [glbrush.js Design](https://github.com/Oletus/glbrush.js/wiki/glbrush.js-design)
- [brushtips WebGL](https://github.com/darknoon/brushtips)
- [p5.brush](https://github.com/acamposuribe/p5.brush)
- [Inigo Quilez 2D SDF Functions](https://iquilezles.org/articles/distfunctions2d/)
- [The Book of Shaders: Noise](https://thebookofshaders.com/11/)
- [The Book of Shaders: Shapes](https://thebookofshaders.com/07/)
- [ashima/webgl-noise](https://github.com/ashima/webgl-noise)
- [glNoise](https://github.com/FarazzShaikh/glNoise)
- [GLSL Noise Algorithms](https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83)
- [glsl-film-grain](https://github.com/mattdesl/glsl-film-grain)
- [Canvas2DtoWebGL](https://github.com/jagenjo/Canvas2DtoWebGL)
- [WebGL and Alpha](https://webglfundamentals.org/webgl/lessons/webgl-and-alpha.html)
- [Alpha Blending and WebGL (Canva)](https://www.canva.dev/blog/engineering/alpha-blending-and-webgl/)
- [Alpha Compositing (Ciechanowski)](https://ciechanow.ski/alpha-compositing/)
- [LearnOpenGL: Blending](https://learnopengl.com/Advanced-OpenGL/Blending)
- [Procreate Brush Studio Settings](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
- [Apple Pencil Tutorial (Kodeco)](https://www.kodeco.com/1407-apple-pencil-tutorial-getting-started/page/2)
- [Efficient WebGL Stroking](https://hypertolosana.wordpress.com/2015/03/10/efficient-webgl-stroking/)
- [MoXi: Real-time Ink Dispersion (ACM)](https://dl.acm.org/doi/10.1145/1073204.1073221)
- [Marker Pen (Wikipedia)](https://en.wikipedia.org/wiki/Marker_pen)
- [Porous-Tipped Writing Instruments (JASQDE)](https://journal.asqde.org/articles/10.69525/jasqde.267)
- [Procedural Textures in GLSL (Linkoping)](https://www.diva-portal.org/smash/get/diva2:618262/FULLTEXT02.pdf)
- [Anti-Aliasing Basics for Procedural Shapes](https://shadergif.com/guides/anti-aliasing-basics/)
- [GPU 2D Drawing: Rectangle SDF, Masking, Rotations](https://hasen.substack.com/p/sdf-rectangles-masking-rotation)
- [SDF Rendering on GPU](https://astiopin.github.io/2019/01/06/sdf-on-gpu.html)
- [Efficient Computational Noise in GLSL (Gustavson)](https://www.researchgate.net/publication/222941876_Efficient_computational_noise_in_GLSL)
