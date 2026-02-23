# WebGL Rendering Engine Plan

## Overview

Add WebGL2 as an optional rendering engine alongside the existing Canvas 2D engine. Users select both a **rendering pipeline** (`basic | textures | stamps`) and a **rendering engine** (`canvas2d | webgl`). The WebGL engine uses the GPU for all drawing, offering significant performance gains for stamp-heavy workloads and eliminating the catastrophic `clip()` penalty on iPad Safari.

## Architecture Strategy

### Engine Abstraction Layer

Introduce a `RenderEngine` interface that abstracts over Canvas 2D and WebGL. This is the core architectural change — rather than refactoring the entire codebase at once, we create a clean boundary that both engines implement.

```typescript
type RenderEngineType = "canvas2d" | "webgl";

interface RenderEngine {
  readonly type: RenderEngineType;

  // Lifecycle
  init(canvas: HTMLCanvasElement | OffscreenCanvas): void;
  resize(width: number, height: number, dpr: number): void;
  destroy(): void;

  // Frame operations
  beginFrame(): void;
  endFrame(): void;
  clear(): void;

  // Transform stack
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  scale(sx: number, sy: number): void;

  // Drawing primitives
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  fillPath(vertices: Float32Array, color: string, alpha: number): void;
  drawImage(source: ImageSource, sx: number, sy: number, sw: number, sh: number,
            dx: number, dy: number, dw: number, dh: number): void;

  // Compositing
  setBlendMode(mode: BlendMode): void;
  setAlpha(alpha: number): void;

  // Clipping (stencil-based in WebGL)
  clipRect(x: number, y: number, w: number, h: number): void;
  clipPath(vertices: Float32Array): void;

  // Offscreen rendering (FBO in WebGL)
  createOffscreen(width: number, height: number): OffscreenTarget;
  renderToOffscreen(target: OffscreenTarget, fn: () => void): void;
  compositeOffscreen(target: OffscreenTarget, dx: number, dy: number, dw: number, dh: number): void;

  // Texture management
  createTexture(source: ImageData | HTMLCanvasElement | OffscreenCanvas): TextureHandle;
  drawStamps(stamps: Float32Array, texture: TextureHandle, color: string, alpha: number): void;
  applyGrainPattern(texture: TextureHandle, path: Float32Array, strength: number,
                     anchorX: number, anchorY: number): void;

  // Stroke-specific operations
  drawStrokeLine(x1: number, y1: number, x2: number, y2: number,
                  color: string, width: number): void;
}

type BlendMode = "source-over" | "destination-in" | "multiply" | "destination-out";

interface OffscreenTarget {
  readonly width: number;
  readonly height: number;
}

interface TextureHandle {
  readonly id: number;
  destroy(): void;
}

type ImageSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap | TextureHandle;
```

### Why This Interface?

The interface is designed around what ObsidianPaper actually does, not as a generic Canvas 2D wrapper:

1. **`fillPath(vertices)`** instead of `fill(Path2D)` — WebGL needs triangulated vertices, and the outline generators already produce vertex arrays. We convert `number[][]` → `Float32Array` instead of `number[][]` → `Path2D`.

2. **`drawStamps(Float32Array)`** — The stamp system produces arrays of `{x, y, size, opacity}` tuples. In Canvas 2D this means thousands of `drawImage()` calls. In WebGL, this is a single instanced draw call. This is the single biggest perf win.

3. **`clipPath(vertices)` / `clipRect()`** — In Canvas 2D: `ctx.clip()`. In WebGL: stencil buffer. Eliminates the iPad Safari `clip()` catastrophe.

4. **`applyGrainPattern()`** — In Canvas 2D: create pattern, fill with destination-out. In WebGL: single-pass fragment shader with texture sampling. Eliminates an entire offscreen compositing step.

5. **`OffscreenTarget`** — In Canvas 2D: `OffscreenCanvas` + `getContext('2d')`. In WebGL: framebuffer object (FBO). Used for ink stamp masking pipeline.

---

## Implementation Phases

### Phase 1: Engine Abstraction & Canvas2D Adapter

**Goal:** Define the `RenderEngine` interface and implement `Canvas2DEngine` that wraps the existing Canvas 2D code. No behavior change — this is a pure refactor.

**Files to create:**
- `src/canvas/engine/RenderEngine.ts` — Interface + types
- `src/canvas/engine/Canvas2DEngine.ts` — Wraps existing Canvas 2D API
- `src/canvas/engine/EngineFactory.ts` — Creates engine by type

**Files to modify:**
- `src/types.ts` — Add `RenderEngineType` type
- `src/settings/PaperSettings.ts` — Add `defaultRenderEngine: RenderEngineType` setting

**Key decisions:**
- `Canvas2DEngine.fillPath()` will accept `Float32Array` vertices and internally convert to `Path2D` using the existing `outlineToPath2D()` approach. This means the outline generators will output `Float32Array` instead of (or in addition to) `number[][]`.
- `Canvas2DEngine.drawStamps()` delegates to existing `drawStamps()` / `drawInkShadingStamps()` functions.
- Path cache moves from `Path2D` caching to vertex array caching (both engines can use it; Canvas2DEngine converts on the fly).

**Testing:** All existing tests pass. No visual change.

---

### Phase 2: Vertex Pipeline

**Goal:** Modify outline generators to produce `Float32Array` vertex data alongside (or instead of) `Path2D`. Add triangulation for WebGL path fill.

**Files to create:**
- `src/canvas/engine/Triangulator.ts` — Wraps `earcut` for polygon triangulation
- `src/canvas/engine/VertexCache.ts` — Caches triangulated vertex data per stroke

**Files to modify:**
- `src/stroke/OutlineGenerator.ts` — Add `generateStrokeVertices()` that returns `Float32Array`
- `src/stroke/ItalicOutlineGenerator.ts` — Same treatment
- `src/canvas/StrokeRenderCore.ts` — Refactor to work with `RenderEngine` instead of raw `Ctx2D`

**Vertex format:**
```
// Per-vertex: [x, y] pairs
// Stored as Float32Array for direct GPU upload
// Triangle indices from earcut stored separately
```

**Triangulation approach:**
- Use `earcut` (~2KB, well-tested) for CPU-side triangulation
- Outline generators already produce closed polygons — feed directly to earcut
- Cache triangulated index buffers alongside vertex data
- For simple convex-ish strokes, triangle fan may suffice (check winding)

---

### Phase 3: WebGL2 Engine — Core

**Goal:** Implement `WebGL2Engine` with basic drawing capabilities: fill rects, fill paths, draw images, blend modes.

**Files to create:**
- `src/canvas/engine/WebGL2Engine.ts` — Main WebGL2 implementation
- `src/canvas/engine/shaders/` — GLSL shader source files:
  - `solid.vert` / `solid.frag` — Solid color fill (rects, paths)
  - `texture.vert` / `texture.frag` — Textured quads (drawImage)
  - `common.glsl` — Shared uniforms (transform matrix, viewport)
- `src/canvas/engine/GLState.ts` — WebGL state management (avoid redundant state changes)
- `src/canvas/engine/GLBuffers.ts` — VBO/VAO management, buffer pooling

**Shader architecture:**

```glsl
// solid.vert
uniform mat3 u_transform;   // Combined model-view-projection
attribute vec2 a_position;

void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
}

// solid.frag
uniform vec4 u_color;       // Premultiplied RGBA

void main() {
  gl_FragColor = u_color;
}
```

**Transform stack:**
- Maintain a stack of `mat3` transforms (2D affine)
- Multiply into single matrix before uploading to GPU
- Equivalent to Canvas 2D `save()/restore()/setTransform()`

**Blend mode mapping (premultiplied alpha):**
| Canvas 2D | WebGL |
|---|---|
| `source-over` | `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` |
| `destination-in` | `blendFunc(ZERO, SRC_ALPHA)` |
| `destination-out` | `blendFunc(ZERO, ONE_MINUS_SRC_ALPHA)` |
| `multiply` | `blendFunc(DST_COLOR, ONE_MINUS_SRC_ALPHA)` |

**Stencil-based clipping:**
```
clipRect → gl.scissor() (fast path)
clipPath → stencil buffer:
  1. Clear stencil to 0
  2. Draw path triangles with stencil ALWAYS/INVERT
  3. Set stencil test to EQUAL/1
  4. Draw fill
  5. Clear stencil
```

**FBO management:**
- Pool of framebuffers for offscreen rendering
- Sized to match tile dimensions
- Reused across frames (avoid allocation per stroke)

---

### Phase 4: Stamp & Grain Shaders

**Goal:** Implement the stamp rendering and grain overlay as GPU-native operations. This is where the biggest performance wins come from.

**Files to create:**
- `src/canvas/engine/shaders/stamp.vert` / `stamp.frag` — Instanced stamp rendering
- `src/canvas/engine/shaders/grain.vert` / `grain.frag` — Grain pattern overlay
- `src/canvas/engine/shaders/ink.vert` / `ink.frag` — Ink stamp with destination-in masking

**Stamp rendering (instanced drawing):**
```glsl
// stamp.vert — one quad per stamp, instanced
attribute vec2 a_quad;           // Unit quad corners
attribute vec4 a_instance;       // Per-stamp: x, y, size, opacity

uniform mat3 u_transform;

varying vec2 v_uv;
varying float v_opacity;

void main() {
  vec2 worldPos = a_instance.xy + a_quad * a_instance.z;
  vec3 pos = u_transform * vec3(worldPos, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_uv = a_quad * 0.5 + 0.5;
  v_opacity = a_instance.w;
}

// stamp.frag
uniform sampler2D u_stampTexture;
uniform vec4 u_color;

varying vec2 v_uv;
varying float v_opacity;

void main() {
  float alpha = texture2D(u_stampTexture, v_uv).a * v_opacity;
  gl_FragColor = u_color * alpha;  // Premultiplied
}
```

**Performance impact:**
- Current: N stamps × `drawImage()` → N draw calls
- WebGL: 1 instanced draw call for all stamps in a stroke
- For a typical fountain pen stroke with ~500 stamps: **500x fewer draw calls**

**Grain as fragment shader:**
```glsl
// grain.frag — applied during stroke fill
uniform sampler2D u_grainTexture;
uniform float u_grainStrength;
uniform vec2 u_grainAnchor;
uniform vec2 u_grainScale;

varying vec2 v_worldPos;

void main() {
  vec2 grainUV = (v_worldPos - u_grainAnchor) * u_grainScale;
  float grain = texture2D(u_grainTexture, grainUV).a;
  float mask = 1.0 - u_grainStrength * (1.0 - grain);
  gl_FragColor = u_color * mask;  // Grain applied in single pass
}
```

**This eliminates:** The offscreen canvas → fill → destination-out → composite pipeline that currently requires 4 operations per stroke.

---

### Phase 5: Ink Stamp Pipeline (Fountain Pen)

**Goal:** Implement the full ink stamp compositing pipeline in WebGL using FBOs.

**Pipeline (mirrors Canvas 2D approach):**
1. Bind FBO (offscreen target)
2. Clear to transparent
3. Set blend mode to source-over
4. Draw all ink stamps via instanced rendering (stamp shader with ink texture)
5. Set blend mode to destination-in
6. Draw stroke outline path (masks stamps to stroke shape)
7. Unbind FBO
8. Composite FBO texture onto tile with source-over blend

**Key insight:** The destination-in masking step that currently uses `ctx.globalCompositeOperation = "destination-in"` maps directly to `gl.blendFunc(GL.ZERO, GL.SRC_ALPHA)`.

---

### Phase 6: Tile Integration

**Goal:** Connect WebGL engine to the tile system. Both worker and main-thread paths.

**Files to modify:**
- `src/canvas/tiles/TileRenderer.ts` — Accept `RenderEngine` instead of assuming Canvas 2D
- `src/canvas/tiles/TileCache.ts` — Support WebGL textures as tile storage (alongside OffscreenCanvas)
- `src/canvas/tiles/TileCompositor.ts` — Composite WebGL textures onto display
- `src/canvas/tiles/WorkerTileScheduler.ts` — Initialize WebGL engines in workers
- `src/canvas/tiles/worker/tileWorker.ts` — Use engine abstraction

**Worker WebGL considerations:**
- `OffscreenCanvas.getContext('webgl2')` works in Web Workers on Safari 17+ (iOS 17+)
- Each worker gets its own WebGL2 context on its own OffscreenCanvas
- Tile results still transferred as `ImageBitmap` via `transferToImageBitmap()` for compatibility
- Worker pool size may need to decrease (4 → 2-3) due to GPU context limits on iPad
- Fall back to Canvas 2D workers if WebGL context creation fails in worker

**Tile result flow:**
```
Worker WebGL2Engine renders to OffscreenCanvas
  → transferToImageBitmap()
  → postMessage with transfer
  → Main thread draws bitmap to display canvas
```

**Alternative (advanced):** For the main-thread compositor, if the display itself uses WebGL, tiles could be uploaded as textures and composited via GPU. This avoids the ImageBitmap intermediary. Worth investigating but not required for Phase 6.

---

### Phase 7: Background & Grid Rendering

**Goal:** Port background rendering (desk fill, page backgrounds, grid patterns) to WebGL.

**Files to modify:**
- `src/canvas/BackgroundRenderer.ts` — Use `RenderEngine` for drawing operations

**Approach:**
- Desk fill: `fillRect()` — trivial
- Page background: `fillRect()` with page color — trivial
- Page shadow: Textured quad with shadow gradient texture
- Grid lines: GL_LINES or thin quads with anti-aliasing
- Dot grid: Instanced point rendering or small quads

**Grid line anti-aliasing:**
- Canvas 2D auto-antialiases lines
- WebGL needs either MSAA (via `antialias: true` context attribute) or shader-based AA
- For 1px lines at various zoom levels: use a fragment shader that computes distance-to-line and applies smooth alpha falloff

---

### Phase 8: Renderer Integration & Settings

**Goal:** Wire up the engine selection in the main `Renderer` class and settings UI.

**Files to modify:**
- `src/canvas/Renderer.ts` — Accept `RenderEngineType`, create appropriate engine
- `src/settings/PaperSettings.ts` — Add engine setting with dropdown
- `src/settings/PaperSettingsTab.ts` — Add "Rendering Engine" dropdown in settings UI
- `src/view/PaperView.ts` — Pass engine type to Renderer

**Settings UI:**
```
Rendering Engine: [Canvas 2D ▼]  ← dropdown
                  [Canvas 2D]
                  [WebGL (GPU)]

Rendering Pipeline: [Stamps ▼]   ← existing dropdown
```

**Engine switching:**
- Changing engine requires destroying and recreating the Renderer
- Display a brief "Switching renderer..." indicator
- Persist preference in settings
- Auto-detect: If WebGL2 is not available, force Canvas 2D and grey out the option

**Feature detection:**
```typescript
function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    // Check for required extensions
    // Check max texture size >= 2048
    canvas.remove();
    return true;
  } catch {
    return false;
  }
}
```

---

### Phase 9: Active & Prediction Layer

**Goal:** Port the active stroke and prediction rendering to WebGL.

**Files to modify:**
- `src/canvas/Renderer.ts` — Active/prediction rendering methods

**Approach:**
- Active canvas gets its own WebGL2 context (or shares with static via FBO switching)
- Prediction canvas similarly
- Active stroke renders incrementally (only new points since last frame)
- GPU buffers updated via `bufferSubData()` for incremental vertex uploads

**Consideration:** Active stroke rendering must be extremely low-latency. The current Canvas 2D approach is already fast (single Path2D fill). WebGL may not provide a meaningful speedup here since the bottleneck is input latency, not rendering time. However, for consistency, using the same engine avoids visual discrepancies between active and baked strokes.

---

### Phase 10: Testing & Optimization

**Goal:** Comprehensive testing, performance benchmarking, and optimization.

**Testing strategy:**
- Unit tests for `Triangulator`, `VertexCache`, shader compilation
- Visual regression tests comparing Canvas 2D and WebGL output
- Performance benchmarks: measure tile render time, stamp throughput, memory usage
- iPad Safari testing: verify WebGL2 in workers, context limits, memory pressure
- Fallback testing: verify graceful degradation when WebGL unavailable

**Optimizations:**
- Buffer pooling: Reuse VBOs across frames
- Batch strokes: Multiple strokes per draw call when they share color/style
- Texture atlas: Combine stamp textures into atlas to reduce texture switches
- Shader warm-up: Compile and link shaders on init (avoid first-frame stall)

---

## Dependency Graph

```
Phase 1 (Abstraction) ──→ Phase 2 (Vertices)
                      └──→ Phase 3 (WebGL Core)
                                  │
                    ┌─────────────┤
                    ↓             ↓
            Phase 4 (Stamps)   Phase 7 (Background)
                    │
                    ↓
            Phase 5 (Ink Pipeline)
                    │
                    ↓
            Phase 6 (Tiles) ──→ Phase 8 (Settings/Integration)
                                         │
                                         ↓
                                 Phase 9 (Active Layer)
                                         │
                                         ↓
                                 Phase 10 (Testing)
```

Phases 2 and 3 can proceed in parallel after Phase 1.
Phases 4 and 7 can proceed in parallel after Phase 3.

---

## Risk Assessment

### High Risk
- **iPad GPU context limits**: iPads may support only 4-8 simultaneous WebGL contexts. With 2-4 workers + main thread, we could hit the limit. Mitigation: reduce worker count for WebGL mode, share contexts where possible.
- **WebGL in Workers on older iOS**: Requires Safari 17+ (iOS 17+). Mitigation: fall back to Canvas 2D workers on older devices.

### Medium Risk
- **Visual parity**: WebGL rendering may look slightly different from Canvas 2D (anti-aliasing differences, color precision). Mitigation: side-by-side comparison testing, tune shaders to match.
- **Memory usage**: WebGL textures live in GPU memory, separate from the tile cache's JS heap tracking. Mitigation: track GPU memory allocation explicitly, adjust tile cache limits.
- **Shader compilation stalls**: First-time shader compilation can cause 40-100ms stalls. Mitigation: pre-compile all shaders during init, show loading indicator.

### Low Risk
- **earcut triangulation correctness**: earcut is battle-tested (used by Mapbox). Stroke outlines are simple closed polygons.
- **Premultiplied alpha mistakes**: Well-documented gotcha. Use `gl.ONE, gl.ONE_MINUS_SRC_ALPHA` everywhere, convert colors to premultiplied on upload.

---

## Decision: What NOT to Do

1. **Don't abstract too early.** The `RenderEngine` interface should be designed around what we actually need, not what a theoretical universal 2D engine might need. We can extend it as needed.

2. **Don't use a large library.** PixiJS, Three.js, etc. are overkill. Raw WebGL2 + TWGL.js (for boilerplate reduction) is sufficient. The rendering pipeline is too custom for a generic library.

3. **Don't try to share WebGL contexts across workers.** Each worker gets its own context. Context sharing across threads is not supported.

4. **Don't port everything at once.** The phased approach means we can ship intermediate milestones where WebGL handles tiles/stamps but Canvas 2D handles active strokes, etc.

5. **Don't target WebGPU yet.** Safari ships WebGPU in iOS 26+ (Fall 2025 / 2026). User base penetration won't be sufficient until 2027+. Design the abstraction to accommodate it later.

---

## Expected Performance Wins

| Operation | Canvas 2D | WebGL | Improvement |
|---|---|---|---|
| Stamp rendering (500 stamps) | 500 drawImage calls | 1 instanced draw | ~50-100x |
| Grain overlay per stroke | offscreen + dest-out + composite | single-pass shader | ~3-5x |
| clip() for page masking | catastrophic on iPad Safari | stencil buffer | ~10-100x |
| Tile composition | N drawImage calls | N textured quads (or 1 batched) | ~2-5x |
| Background grid | individual line strokes | instanced lines | ~5-10x |

The most impactful win is stamp rendering — the stamps pipeline on fountain pen strokes currently generates hundreds of stamps per stroke, each requiring a separate `drawImage()` call. With instanced rendering, this collapses to a single GPU draw call.
