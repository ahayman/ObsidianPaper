# WebGL-Based 2D Rendering for Handwriting/Stroke Applications

## Research Date: 2026-02-22

## Context

This research investigates whether and how WebGL could replace or augment Canvas 2D for stroke rendering in ObsidianPaper. The current architecture uses Canvas 2D with tile-based rendering via Web Workers (OffscreenCanvas). Key rendering operations include: filled path rendering (stroke outlines), stamp-based texture compositing (grain, ink shading), destination-in masking, and offscreen buffer compositing. Target platform is iPad Safari (WebKit).

---

## 1. WebGL for 2D Rendering: Best Practices

### Core Concept

WebGL provides low-level GPU access through a programmable pipeline (vertex shaders + fragment shaders). Unlike Canvas 2D which provides high-level drawing commands (`fill()`, `drawImage()`, `globalCompositeOperation`), WebGL requires you to:

1. **Triangulate** all geometry into triangles
2. **Write shaders** for vertex transformation and pixel coloring
3. **Manage state** manually (blending, textures, framebuffers)

### Emulating Canvas 2D Operations in WebGL

| Canvas 2D Operation | WebGL Equivalent |
|---|---|
| `fill()` on Path2D | Triangulate path, render triangles with solid color fragment shader |
| `drawImage()` | Textured quad (two triangles), sample texture in fragment shader |
| `globalCompositeOperation` | `gl.blendFunc()` / `gl.blendFuncSeparate()` + sometimes FBO multi-pass |
| `clip()` | Stencil buffer or destination-in masking via FBO |
| `globalAlpha` | Multiply alpha in fragment shader or use `gl.blendColor()` |
| `createPattern()` | Tiling texture with `GL_REPEAT` wrap mode |
| `getImageData()`/`putImageData()` | `gl.readPixels()` / `gl.texImage2D()` |
| OffscreenCanvas | Framebuffer Objects (FBOs) with texture attachments |

### Key Principle: Premultiplied Alpha

WebGL canvases are **always composited over the page using premultiplied alpha** by the browser. This is the single most important thing to get right. When working with transparent output:

**Wrong** (common mistake):
```javascript
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
// This doesn't calculate the resulting alpha channel correctly
```

**Correct** for premultiplied-alpha source-over:
```javascript
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
```

**Correct** for straight-alpha input with transparent output:
```javascript
gl.blendFuncSeparate(
  gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,  // RGB
  gl.ONE, gl.ONE_MINUS_SRC_ALPHA          // Alpha
);
```

All textures should be pre-multiplied on load using `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)`.

Sources: [Limnu - WebGL Blending](https://limnu.com/webgl-blending-youre-probably-wrong/), [Premultiplied Alpha Primer](https://limnu.com/premultiplied-alpha-primer-artists/)

---

## 2. Path Rendering in WebGL

### The Problem

Canvas 2D has `fill()` which handles arbitrary concave paths with holes. WebGL only draws triangles. Converting 2D vector paths to triangles is non-trivial.

### Option A: Earcut Triangulation (CPU-side)

**How it works**: The [earcut](https://github.com/mapbox/earcut) library implements modified ear-clipping triangulation. Given a polygon (as a flat array of xy coordinates), it produces triangle indices.

```javascript
import earcut from 'earcut';
// Flat array of vertices: [x0,y0, x1,y1, x2,y2, ...]
const triangles = earcut(vertices); // Returns index array
```

**Pros**:
- Very fast (~2-3ms for complex polygons)
- Small library (~2KB minified)
- Handles holes and self-intersections
- Used in production by Mapbox GL

**Cons**:
- CPU-side computation; must be done before each draw
- Sacrifices triangulation quality for speed (some degenerate triangles)
- For stroke outlines that change every frame during active drawing, this could be a bottleneck

**Relevance to ObsidianPaper**: Our stroke outlines are already computed as vertex arrays (OutlineGenerator produces left/right edge arrays). These could be triangulated as a triangle strip directly (left[0], right[0], left[1], right[1], ...) without needing earcut at all, since stroke outlines are inherently simple ribbon shapes.

Sources: [Mapbox Earcut](https://github.com/mapbox/earcut), [CSS-Tricks SVG Paths in WebGL](https://css-tricks.com/rendering-svg-paths-in-webgl/)

### Option B: Stencil Buffer Trick (GPU-side)

**How it works**: Uses the stencil buffer to determine interior of any arbitrary polygon, even concave ones, without triangulation.

**Algorithm** (two-pass):

**Pass 1 - Build stencil mask**:
```javascript
gl.enable(gl.STENCIL_TEST);
gl.clear(gl.STENCIL_BUFFER_BIT);
gl.colorMask(false, false, false, false);  // Don't write color
gl.stencilFunc(gl.ALWAYS, 0, 1);
gl.stencilOp(gl.INVERT, gl.INVERT, gl.INVERT);
// Draw polygon as triangle fan from any vertex
gl.drawArrays(gl.TRIANGLE_FAN, 0, vertexCount);
```

**Pass 2 - Fill where stencil is set**:
```javascript
gl.colorMask(true, true, true, true);      // Re-enable color
gl.stencilFunc(gl.EQUAL, 1, 1);            // Only where stencil == 1
gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);  // Clear stencil as we draw
// Draw a covering quad with the fill color
gl.drawArrays(gl.TRIANGLE_FAN, 0, vertexCount);
// or draw a full-screen quad
```

**Why it works**: Drawing a triangle fan from any vertex, areas inside the polygon get covered by an odd number of triangles (stencil inverts to 1), areas outside get covered by an even number (stencil stays 0).

**Pros**:
- No CPU triangulation needed
- Handles any concave polygon
- GPU-accelerated
- Can be extended for even-odd or winding-number fill rules

**Cons**:
- Requires stencil buffer (must request when creating WebGL context: `{ stencil: true }`)
- Two render passes per filled path
- More complex state management

**Relevance to ObsidianPaper**: This is particularly useful for the fountain pen italic outline paths and ink pooling shapes, which can be complex concave polygons. However, for simple stroke ribbon outlines (which are convex strips), direct triangle strip rendering is simpler.

Sources: [Concave Polygon Stencil Gist](https://gist.github.com/983/79c20c447457b1259ae1380ba591a42f), [Khronos Forums](https://community.khronos.org/t/concave-polygon-via-stencil-buffer/63826), [WebGL Fundamentals Stencil](https://webglfundamentals.org/webgl/lessons/webgl-qna-how-to-use-the-stencil-buffer.html)

### Option C: SDF (Signed Distance Field) Approaches

**How it works**: Compute the signed distance from each pixel to the nearest edge of the shape. Negative = inside, positive = outside. Render in fragment shader with `smoothstep()` for antialiasing.

```glsl
// Fragment shader
float d = sdfFunction(uv); // negative inside, positive outside
float alpha = 1.0 - smoothstep(-pixelWidth, pixelWidth, d);
gl_FragColor = vec4(color.rgb, color.a * alpha);
```

**Pros**:
- Perfect antialiasing at any zoom level
- Resolution-independent
- Efficient for simple shapes (circles, rounded rectangles, lines)

**Cons**:
- Computing SDF for arbitrary paths is expensive
- Not practical for complex stroke outlines with many vertices
- Better suited for UI elements, text, and simple primitives

**Relevance to ObsidianPaper**: Could be used for individual stamp particles (circles with Gaussian falloff) which are already circular SDFs. Not practical for full stroke outline rendering.

Libraries: [sdf-2d](https://github.com/schmelczer/sdf-2d), [webgl-sdf-generator](https://github.com/lojjic/webgl-sdf-generator)

### Option D: Triangle Strip from Stroke Outline (Best for Handwriting)

**How it works**: Our OutlineGenerator already produces left and right edge arrays. These form a natural triangle strip:

```
Left[0]---Left[1]---Left[2]---Left[3]
  |    \    |    \    |    \    |
Right[0]--Right[1]--Right[2]--Right[3]
```

Vertex order: `L0, R0, L1, R1, L2, R2, ...` drawn as `gl.TRIANGLE_STRIP`.

**Pros**:
- No triangulation library needed
- Directly maps to existing outline generator output
- Very efficient (single draw call per stroke)
- Natural for variable-width strokes

**Cons**:
- Only works for "ribbon" shapes (stroke outlines)
- Doesn't handle closed shapes like ink pools
- End caps need separate geometry

**This is the most relevant approach for ObsidianPaper's primary stroke rendering.**

---

## 3. Compositing in WebGL

### Porter-Duff Operations via Blend Functions

WebGL's `blendFunc()` and `blendFuncSeparate()` can implement several Porter-Duff compositing operations directly. Using **premultiplied alpha** throughout (which is the natural format for GPU rendering):

| Operation | blendFunc (src, dst) | Formula |
|---|---|---|
| **Source-Over** | `(ONE, ONE_MINUS_SRC_ALPHA)` | `Cs + Cd*(1-As)` |
| **Destination-Over** | `(ONE_MINUS_DST_ALPHA, ONE)` | `Cs*(1-Ad) + Cd` |
| **Source-In** | `(DST_ALPHA, ZERO)` | `Cs*Ad` |
| **Destination-In** | `(ZERO, SRC_ALPHA)` | `Cd*As` |
| **Source-Out** | `(ONE_MINUS_DST_ALPHA, ZERO)` | `Cs*(1-Ad)` |
| **Destination-Out** | `(ZERO, ONE_MINUS_SRC_ALPHA)` | `Cd*(1-As)` |
| **Source-Atop** | `(DST_ALPHA, ONE_MINUS_SRC_ALPHA)` | `Cs*Ad + Cd*(1-As)` |
| **Destination-Atop** | `(ONE_MINUS_DST_ALPHA, SRC_ALPHA)` | `Cs*(1-Ad) + Cd*As` |
| **Clear** | `(ZERO, ZERO)` | `0` |
| **XOR** | `(ONE_MINUS_DST_ALPHA, ONE_MINUS_SRC_ALPHA)` | `Cs*(1-Ad) + Cd*(1-As)` |
| **Multiply** | `(DST_COLOR, ZERO)` | `Cs*Cd` |

### Destination-In for Masking (Critical for ObsidianPaper)

ObsidianPaper currently uses `destination-in` for ink stamp compositing: stamps deposit color via source-over, then destination-in masks to the outline path. In WebGL:

```javascript
// Step 1: Render stamps to FBO with source-over blending
gl.bindFramebuffer(gl.FRAMEBUFFER, stampFBO);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // source-over (premultiplied)
// ... draw all stamps ...

// Step 2: Apply destination-in mask
gl.blendFunc(gl.ZERO, gl.SRC_ALPHA); // destination-in
// Draw the outline path as a filled shape
// Result: stamps are masked to the outline shape
```

### Operations That Require Fragment Shader (Cannot Use Blend Hardware)

Some Canvas 2D composite operations cannot be achieved with WebGL's fixed-function blending and require multi-pass rendering with FBOs:

- **Multiply with alpha** (true Photoshop-style multiply): Requires reading the destination, which blend functions cannot do arbitrarily. Solution: Render destination to texture, bind as sampler, multiply in fragment shader.
- **Screen**, **Overlay**, **Soft Light**: All require custom fragment shaders with destination texture sampling.

```glsl
// Fragment shader for multiply blend (requires destination as texture)
uniform sampler2D uSrc;
uniform sampler2D uDst;
varying vec2 vUV;

void main() {
    vec4 src = texture2D(uSrc, vUV);
    vec4 dst = texture2D(uDst, vUV);
    gl_FragColor = src * dst; // multiply
}
```

The [glsl-blend](https://github.com/jamieowen/glsl-blend) library provides GLSL implementations of all Photoshop blend modes.

Sources: [MDN blendFunc](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendFunc), [MDN blendFuncSeparate](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendFuncSeparate), [Porter/Duff Compositing](https://ssp.impulsetrain.com/porterduff.html), [Alpha Compositing](https://apoorvaj.io/alpha-compositing-opengl-blending-and-premultiplied-alpha)

---

## 4. Texture-Based Grain/Stamp Rendering

### Approach: Stamp as Textured Quad

Each stamp particle (currently rendered via `drawImage()` in Canvas 2D) becomes a textured quad in WebGL:

```javascript
// Upload stamp texture once
const stampTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, stampTexture);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stampCanvas);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
```

### Grain Overlay via Fragment Shader

Instead of using a separate canvas for grain overlay (current approach), grain can be applied directly in the fragment shader:

```glsl
// Fragment shader with grain overlay
uniform sampler2D uStampTexture;
uniform sampler2D uGrainTexture;
uniform float uGrainStrength;
uniform vec4 uColor;

varying vec2 vTexCoord;
varying vec2 vWorldPos; // for grain tiling

void main() {
    float stampAlpha = texture2D(uStampTexture, vTexCoord).a;
    vec4 grainSample = texture2D(uGrainTexture, vWorldPos * 0.01); // tiled

    // Apply grain as opacity modulation
    float grainFactor = mix(1.0, grainSample.r, uGrainStrength);

    vec4 color = uColor;
    color.a *= stampAlpha * grainFactor;
    color.rgb *= color.a; // premultiply
    gl_FragColor = color;
}
```

This eliminates the need for a separate grain offscreen canvas and compositing pass. The grain texture can use `GL_REPEAT` wrap mode for seamless tiling.

### Noise-Based Grain (No Texture Needed)

Grain can also be generated procedurally in the fragment shader without a texture:

```glsl
// Simple hash-based noise (fast, no texture lookup)
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// In fragment shader:
float noise = hash(floor(vWorldPos * grainScale));
float grainFactor = mix(1.0, noise, uGrainStrength);
```

For higher quality, use the [glsl-film-grain](https://github.com/mattdesl/glsl-film-grain) approach which uses 3D Perlin noise with luminance-based grain reduction via `smoothstep()`.

### Alpha Dithering in Fragment Shader

The current InkStampRenderer uses alpha dithering to reduce stamp banding. This translates naturally to a fragment shader:

```glsl
// Dithering to reduce banding in alpha gradients
float dither = hash(gl_FragCoord.xy) / 255.0;
color.a = color.a + dither - 0.5/255.0;
```

Sources: [MDN Using Textures in WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Using_textures_in_WebGL), [GLSL Film Grain](https://github.com/mattdesl/glsl-film-grain), [GLSL Noise Algorithms](https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83)

---

## 5. Framebuffer Objects (FBOs)

### Concept

FBOs are the WebGL equivalent of OffscreenCanvas. They allow rendering to a texture instead of the screen, enabling multi-pass compositing.

### Setup

```javascript
// Create framebuffer
const fbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

// Create color texture attachment
const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
              gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

// Attach texture to framebuffer
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                        gl.TEXTURE_2D, texture, 0);

// Optional: attach stencil buffer
const stencilBuffer = gl.createRenderbuffer();
gl.bindRenderbuffer(gl.RENDERBUFFER, stencilBuffer);
gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, width, height);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT,
                           gl.RENDERBUFFER, stencilBuffer);

// Check completeness
if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer not complete');
}
```

### Usage Pattern for Ink Stamp Compositing

Mapping ObsidianPaper's current ink stamp pipeline to WebGL FBOs:

```
Current Canvas 2D Pipeline:
1. Create offscreen canvas
2. Draw stamps with source-over
3. Draw outline path with destination-in (masks stamps to outline)
4. Draw offscreen result onto main canvas with source-over

WebGL FBO Pipeline:
1. Bind stampFBO
2. Clear stampFBO
3. Set blend: source-over (gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
4. Draw all stamps as instanced textured quads
5. Set blend: destination-in (gl.ZERO, gl.SRC_ALPHA)
6. Draw outline path (stencil fill or triangle strip)
7. Bind default framebuffer (or tile FBO)
8. Set blend: source-over
9. Draw stampFBO texture as full-screen quad
```

### FBO Pool for Tile Rendering

For tile-based rendering, maintain a pool of FBOs (one per tile size):

```javascript
class FBOPool {
    private pool: Map<string, { fbo: WebGLFramebuffer, texture: WebGLTexture }[]>;

    acquire(width: number, height: number) { /* ... */ }
    release(fbo: WebGLFramebuffer) { /* ... */ }
}
```

Sources: [WebGL Fundamentals - Render to Texture](https://webglfundamentals.org/webgl/lessons/webgl-render-to-texture.html), [WebGL Fundamentals - Framebuffers](https://webglfundamentals.org/webgl/lessons/webgl-framebuffers.html), [LearnOpenGL Framebuffers](https://learnopengl.com/Advanced-OpenGL/Framebuffers)

---

## 6. WebGL in Web Workers (OffscreenCanvas)

### Safari Support Status

| Safari Version | OffscreenCanvas 2D | OffscreenCanvas WebGL | OffscreenCanvas WebGL2 | Worker Support |
|---|---|---|---|---|
| Safari 16.4 | Yes | Buggy | Buggy | Partial |
| **Safari 17+** (iOS 17+) | Yes | **Yes** | **Yes** | **Yes** |
| Safari 18+ | Yes | Yes | Yes | Yes (fixed nested workers) |
| Safari 26+ (iOS 26) | Yes | Yes | Yes | Yes |

**Key finding**: OffscreenCanvas with WebGL2 context **works in Web Workers** on Safari 17+ (iOS 17+). This was confirmed by direct testing and MDN compatibility data was updated to reflect this (previously marked as unsupported).

### Usage

```javascript
// In Web Worker:
const offscreen = new OffscreenCanvas(512, 512);
const gl = offscreen.getContext('webgl2', {
    stencil: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false
});
// Full WebGL2 API available
```

### Limitations

- **No DOM access**: Cannot use `requestAnimationFrame` from worker (not an issue for tile rendering)
- **No `commit()` method**: Safari 18 removed `OffscreenCanvasRenderingContext2D.commit()`. For off-screen tile rendering this doesn't matter -- we read back via `transferToImageBitmap()` or use the texture directly.
- **Float textures**: 32-bit float textures and float texture filtering are **NOT supported on any iOS device**. Must use `UNSIGNED_BYTE` or `HALF_FLOAT` textures.
- **WebGL context limits**: Each worker creating a WebGL context consumes GPU resources. On iPad, there may be a practical limit of ~4-8 simultaneous WebGL contexts before performance degrades.

### Implication for ObsidianPaper

The current WorkerTileScheduler uses Web Workers with OffscreenCanvas (Canvas 2D). Migrating to WebGL in workers is feasible on iOS 17+. However, the worker tile rendering architecture would need to change:

- **Current**: Each worker gets an OffscreenCanvas with a 2D context, renders strokes via Canvas 2D API
- **With WebGL**: Each worker gets an OffscreenCanvas with a WebGL2 context, renders strokes via GL draw calls
- **Consideration**: Shader compilation happens per-context. Workers should compile shaders once and reuse programs. Initial tile render may be slower due to shader compilation.

Sources: [MDN Browser Compat Issue #21127](https://github.com/mdn/browser-compat-data/issues/21127), [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas), [WebKit Safari 18 Features](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/)

---

## 7. Performance Considerations

### Where WebGL Excels vs Canvas 2D

| Operation | Canvas 2D | WebGL | Winner |
|---|---|---|---|
| **Initial setup** | ~15ms | ~40ms (shader compilation) | Canvas 2D |
| **Per-frame draw commands** | ~1.2ms | ~0.01ms | **WebGL (120x faster)** |
| **Filling complex paths** | Fast (native) | Needs triangulation or stencil | Canvas 2D |
| **Drawing many stamps** | N draw calls | 1 instanced draw call | **WebGL** |
| **Texture compositing** | Multiple canvas copies | Single shader pass | **WebGL** |
| **Grain overlay** | Separate offscreen + composite | Inline in fragment shader | **WebGL** |
| **Destination-in masking** | One `globalCompositeOperation` | FBO + blend mode | Comparable |
| **Batch rendering** | Each stroke = separate state | Batched into single VBO | **WebGL** |
| **Complex clip paths** | **Catastrophically slow on iPad** | Stencil buffer (fast) | **WebGL** |

### Key Performance Insight

The massive win for WebGL in this application is **stamp rendering**. Currently, each stamp is drawn individually via `drawImage()`. With instanced rendering, thousands of stamps can be drawn in a single draw call:

```javascript
// Set up instanced quad
const quadVerts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]); // 4 vertices
// Per-instance data: x, y, size, opacity, rotation
const instanceData = new Float32Array(stampCount * 5);

// One draw call for ALL stamps
ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, stampCount);
// WebGL2: gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, stampCount);
```

**Performance expectation**: Drawing 1000 stamps goes from ~1000 `drawImage()` calls (~5-10ms on iPad) to 1 instanced draw call (~0.1ms).

### Batch Rendering Strategy

For tile rendering with many strokes:

1. **Sort strokes by pen type** (same shader/texture = same batch)
2. **Concatenate all stroke outlines** into a single vertex buffer
3. **Use index buffers** to delineate individual strokes within the batch
4. **Draw all strokes of the same type** in one or few draw calls

For stamps across multiple strokes:

1. **Collect all stamp parameters** (position, size, opacity, color) into instance buffer
2. **Group by stamp texture** (one draw call per texture)
3. **Use instanced rendering** for massive batch sizes

### Texture Upload Bottleneck

The biggest performance cost in WebGL is `texImage2D()` - uploading data from CPU to GPU. First upload can be ~40-500ms. Subsequent updates benefit from GPU caching (~0.1ms). Strategy:

- Upload stamp textures **once** at initialization
- Use **texture atlases** (multiple stamp variants in one texture) to reduce texture switches
- For grain textures, generate procedurally in fragment shader to avoid upload entirely

### Memory Considerations on iPad

- iPad has shared CPU/GPU memory, reducing the texture upload penalty
- But total GPU memory is limited (~1-4GB depending on model)
- Each 512x512 RGBA tile FBO = 1MB GPU memory
- With 50 visible tiles = 50MB just for tile textures (manageable)
- Stamp FBOs for compositing add another ~10-20MB

Sources: [2D vs WebGL Canvas Performance](https://semisignal.com/a-look-at-2d-vs-webgl-canvas-performance/), [SVG vs Canvas vs WebGL Benchmarks](https://www.svggenie.com/blog/svg-vs-canvas-vs-webgl-performance-2025), [WebGL Instanced Drawing](https://webglfundamentals.org/webgl/lessons/webgl-instanced-drawing.html), [GPU Particles with WebGL2](https://gpfault.net/posts/webgl2-particles.txt.html)

---

## 8. Libraries and Approaches

### Low-Level Helpers (Recommended)

**[TWGL.js](https://twgljs.org/)** - Tiny WebGL helper (~12KB)
- Reduces boilerplate (buffer creation, uniform setting, texture loading)
- Does NOT abstract away WebGL concepts
- Perfect for: custom rendering pipelines where you want full control
- Example: `twgl.createBufferInfoFromArrays(gl, { position: [...], texcoord: [...] })`

**[regl](https://regl-project.github.io/regl/)** - Functional WebGL (~70KB)
- Wraps WebGL state into "draw commands" (declarative objects)
- Automatic state management and cleanup
- Good for: organized rendering with many different draw configurations
- Example: Define a draw command with `regl({ vert, frag, attributes, uniforms, blend })`

### Higher-Level 2D Libraries

**[PixiJS](https://pixijs.com/)** - Fast 2D rendering engine (~200KB)
- WebGL-powered with Canvas 2D fallback
- Rich API: sprites, filters, blend modes, masks
- **Overkill** for ObsidianPaper but demonstrates patterns
- Note: Has its own rendering pipeline that may conflict with custom tile architecture

**[Two.js](https://two.js.org/)** - Renderer-agnostic 2D API
- Can target SVG, Canvas 2D, or WebGL
- API similar to Canvas 2D (moveTo, lineTo, fill)
- Lighter than PixiJS but less WebGL-optimized

### Triangulation Libraries

**[earcut](https://www.npmjs.com/package/earcut)** - Polygon triangulation (~2KB)
- For converting filled paths to triangle indices
- Used by Mapbox GL

**[cdt2d](https://www.npmjs.com/package/cdt2d)** - Constrained Delaunay triangulation
- More robust than earcut for complex paths with holes
- Used by the CSS-Tricks SVG-in-WebGL approach

### Shader Utilities

**[glsl-blend](https://github.com/jamieowen/glsl-blend)** - All Photoshop blend modes in GLSL
**[glsl-film-grain](https://github.com/mattdesl/glsl-film-grain)** - Natural film grain noise
**[GLSL Noise Algorithms](https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83)** - Perlin, Simplex, Worley noise implementations

### Recommendation for ObsidianPaper

**Use TWGL.js or raw WebGL2** (no high-level library). Reasons:
1. The rendering pipeline is highly custom (tile-based, stamp compositing, destination-in masking)
2. Need precise control over FBOs, blend modes, and stencil operations
3. High-level libraries add abstraction layers that may conflict with the worker-based architecture
4. TWGL.js reduces boilerplate without hiding WebGL concepts

---

## 9. WebGPU: The Future Direction

### Safari 26 (iOS 26, Fall 2025)

Apple ships WebGPU in Safari 26 for macOS, iOS, iPadOS, and visionOS. Apple explicitly states: **"WebGPU supersedes WebGL on macOS, iOS, iPadOS, and visionOS and is preferred for new sites and web apps."**

### WebGPU Advantages Over WebGL for This Use Case

- **Compute shaders**: Could run stamp computation on GPU (currently CPU)
- **Better pipeline state management**: No global state; explicit render pipeline objects
- **Modern API design**: Maps directly to Metal on Apple devices (zero translation overhead vs WebGL-to-Metal)
- **Render bundles**: Pre-record draw commands for replay (perfect for cached tiles)

### WebGPU Disadvantages (for now)

- **iOS 26+ only**: Excludes users on iOS 17-25 (large installed base as of Feb 2026)
- **New API to learn**: WGSL shader language instead of GLSL
- **Less mature ecosystem**: Fewer tutorials, libraries, and examples
- **OffscreenCanvas+Worker support**: Not yet confirmed for WebGPU in workers on Safari

### Recommendation

Target **WebGL2** now for broad compatibility (iOS 17+). Design the rendering abstraction layer to be swappable, so WebGPU can be adopted later when iOS 26+ has sufficient market penetration (likely 2027+).

Sources: [WebKit Safari 26 Beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [WebGPU in iOS 26](https://appdevelopermagazine.com/webgpu-in-ios-26/)

---

## 10. Practical Architecture for ObsidianPaper WebGL Migration

### Proposed Rendering Pipeline

```
┌─────────────────────────────────────────────────┐
│                    Per Tile                       │
│                                                   │
│  1. Bind tile FBO                                │
│  2. Clear with page background color             │
│                                                   │
│  For each stroke (sorted by type):               │
│  ┌───────────────────────────────────────────┐   │
│  │ Ballpoint / Pencil (simple strokes):       │   │
│  │  a. Build triangle strip from outline      │   │
│  │  b. Set blend: source-over                 │   │
│  │  c. Fragment shader: solid color + grain   │   │
│  │  d. Draw triangle strip                    │   │
│  └───────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────┐   │
│  │ Fountain Pen (ink stamp strokes):          │   │
│  │  a. Bind stamp FBO                         │   │
│  │  b. Clear stamp FBO                        │   │
│  │  c. Draw stamps (instanced) source-over    │   │
│  │  d. Draw outline mask (destination-in)     │   │
│  │  e. Bind tile FBO                          │   │
│  │  f. Draw stamp FBO texture (source-over)   │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  3. Result: tile texture ready for compositing   │
└─────────────────────────────────────────────────┘
```

### Shader Programs Needed

1. **Solid fill shader**: Vertex transform + solid color fragment (for outlines, backgrounds)
2. **Textured quad shader**: For drawing stamp textures and FBO results
3. **Instanced stamp shader**: Per-instance position/size/opacity + texture sampling + grain
4. **Grain-integrated fill shader**: Solid color + grain texture sampling in one pass

### Key Wins Over Current Canvas 2D

1. **Stamp rendering**: Instanced drawing replaces thousands of `drawImage()` calls
2. **Grain overlay**: Integrated into fragment shader, no offscreen canvas needed
3. **Clip masking**: Stencil buffer replaces catastrophically slow `clip()` on iPad Safari
4. **Batch rendering**: Multiple strokes of the same type in a single draw call
5. **Alpha dithering**: Natural in fragment shader, no separate pass

### Migration Strategy

1. **Phase 1**: Create WebGL rendering backend alongside Canvas 2D (feature flag to switch)
2. **Phase 2**: Implement basic stroke rendering (triangle strips + solid color)
3. **Phase 3**: Add stamp rendering (instanced drawing + grain shaders)
4. **Phase 4**: Add ink stamp compositing (FBOs + destination-in blending)
5. **Phase 5**: Migrate tile workers to use WebGL contexts
6. **Phase 6**: Performance comparison and tuning
7. **Phase 7**: Design abstraction layer for future WebGPU migration

---

## Key Sources

- [Drawing Lines is Hard - Matt DesLauriers](https://mattdesl.svbtle.com/drawing-lines-is-hard)
- [WebGL, Blending, and Why You're Probably Doing it Wrong - Limnu](https://limnu.com/webgl-blending-youre-probably-wrong/)
- [Rendering SVG Paths in WebGL - CSS-Tricks](https://css-tricks.com/rendering-svg-paths-in-webgl/)
- [Concave Polygon Stencil Buffer - GitHub Gist](https://gist.github.com/983/79c20c447457b1259ae1380ba591a42f)
- [Porter/Duff Compositing and Blend Modes](https://ssp.impulsetrain.com/porterduff.html)
- [Alpha Compositing, OpenGL Blending and Premultiplied Alpha](https://apoorvaj.io/alpha-compositing-opengl-blending-and-premultiplied-alpha)
- [WebGL Instanced Drawing - WebGL Fundamentals](https://webglfundamentals.org/webgl/lessons/webgl-instanced-drawing.html)
- [GPU-Accelerated Particles with WebGL 2](https://gpfault.net/posts/webgl2-particles.txt.html)
- [WebGL Render to Texture - WebGL Fundamentals](https://webglfundamentals.org/webgl/lessons/webgl-render-to-texture.html)
- [MDN blendFunc](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendFunc)
- [MDN blendFuncSeparate](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendFuncSeparate)
- [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [2D vs WebGL Canvas Performance](https://semisignal.com/a-look-at-2d-vs-webgl-canvas-performance/)
- [Mapbox Earcut Triangulation](https://github.com/mapbox/earcut)
- [TWGL.js](https://twgljs.org/)
- [regl - Functional WebGL](https://github.com/regl-project/regl)
- [PixiJS](https://pixijs.com/)
- [glsl-blend - GLSL Blend Modes](https://github.com/jamieowen/glsl-blend)
- [glsl-film-grain](https://github.com/mattdesl/glsl-film-grain)
- [GLSL Noise Algorithms](https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83)
- [sdf-2d Library](https://github.com/schmelczer/sdf-2d)
- [WebKit Safari 26 Beta - WebGPU](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
- [SVG vs Canvas vs WebGL Benchmarks 2025](https://www.svggenie.com/blog/svg-vs-canvas-vs-webgl-performance-2025)
- [OffscreenCanvas WebGL2 in Safari Workers](https://github.com/mdn/browser-compat-data/issues/21127)
