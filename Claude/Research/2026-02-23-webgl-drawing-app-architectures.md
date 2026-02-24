# WebGL-Based Drawing/Handwriting App Architectures - Research

**Date:** 2026-02-23
**Purpose:** Understand best practices, common approaches, and trade-offs for WebGL-based drawing/handwriting applications, specifically targeting iPad Safari.

---

## Table of Contents
1. [WebGL Tile-Based Rendering for Drawing Apps](#1-webgl-tile-based-rendering-for-drawing-apps)
2. [Concurrency Issues with Tile-Based Rendering](#2-concurrency-issues-with-tile-based-rendering)
3. [Alternative Architectures (Production Apps)](#3-alternative-architectures-production-apps)
4. [Stroke Rendering in WebGL](#4-stroke-rendering-in-webgl)
5. [Testing and Architecture Patterns](#5-testing-and-architecture-patterns)
6. [iPad Safari Specific Considerations](#6-ipad-safari-specific-considerations)
7. [Recommendations for ObsidianPaper](#7-recommendations-for-obsidianpaper)

---

## 1. WebGL Tile-Based Rendering for Drawing Apps

### Do drawing/painting apps actually use tile-based rendering with WebGL?

**Yes, but it is rare and confined to the most sophisticated apps.** The only widely-known production web drawing tool that uses a true tile-based WebGL renderer is **Figma**. Figma's renderer is a "highly-optimized tile-based engine" written in C++ (compiled to WASM) that calls WebGL/WebGPU for GPU rendering. It supports masking, blurring, dithered gradients, blend modes, nested layer opacity, and full antialiasing, all on the GPU. Internally, Figma's code "looks a lot like a browser inside a browser" with its own DOM, compositor, and text layout engine.

Most other web drawing tools (Excalidraw, tldraw, etc.) do NOT use tile-based WebGL. They use Canvas2D or DOM-based rendering instead.

### Common Approaches

| Approach | Used By | Description |
|----------|---------|-------------|
| **Tile-based WebGL (WASM)** | Figma | C++/WASM renderer, tiles rendered on GPU, composited. Highest performance ceiling but enormous engineering investment. |
| **Full-canvas WebGL** | Small demos, WebGL paint experiments | Single WebGL context renders entire viewport. Simple but struggles with very large canvases. |
| **Canvas2D (direct)** | Excalidraw, many drawing apps | Standard HTML Canvas 2D API. Simpler API, good for moderate complexity. |
| **DOM/SVG-based** | tldraw | Shapes rendered as DOM elements with CSS transforms. Good for structured content, not ideal for freeform drawing. |
| **Hybrid (Canvas2D + WebGL)** | Some mapping libraries | Use Canvas2D for simple operations, WebGL for heavy compositing/transforms. |

### WebGL vs Canvas2D Performance

Key benchmarks (from [semisignal.com](https://semisignal.com/a-look-at-2d-vs-webgl-canvas-performance/)):

- **First render**: Canvas2D is faster (~15ms vs WebGL ~40ms) due to WebGL setup/shader compilation overhead
- **Subsequent renders**: WebGL is dramatically faster (~0.01ms vs ~1.2ms per draw command) after GPU warm-up
- **Large datasets (50k+ elements)**: Canvas drops to 22 FPS; WebGL maintains 58 FPS
- **Zoom/pan transforms**: WebGL performs matrix transforms on GPU; Canvas2D is CPU-bound and degrades with more data

Key insight: **WebGL's advantage is in repeated, GPU-parallel operations.** For a handwriting app that accumulates thousands of strokes and frequently redraws during pan/zoom, WebGL has a substantial advantage.

### When WebGL Tile-Based Makes Sense

Tile-based rendering is valuable when:
- The canvas is very large (infinite canvas, large documents)
- You need to render only what's visible (viewport culling)
- You want to cache rendered regions and only re-render dirty tiles
- You need consistent performance regardless of total content volume

For a handwriting app, tile-based rendering helps because:
- Handwriting documents can have many pages or very long scroll areas
- Only the visible viewport needs rendering at full quality
- Baked/finalized strokes can be cached as tile textures
- Active drawing only needs to render the current tile(s)

### Sources
- [Lumo - WebGL tile rendering library](https://github.com/unchartedsoftware/lumo)
- [WebGL vs Canvas: Best Choice for Browser-Based CAD Tools](https://altersquare.medium.com/webgl-vs-canvas-best-choice-for-browser-based-cad-tools-231097daf063)
- [Canvas 2D vs WebGL Performance](https://semisignal.com/a-look-at-2d-vs-webgl-canvas-performance/)
- [Past and Future of HTML Canvas](https://demyanov.dev/past-and-future-html-canvas-brief-overview-2d-webgl-and-webgpu)
- [WebGL Best Practices - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)

---

## 2. Concurrency Issues with Tile-Based Rendering

### Known Problems

#### Race Conditions in Tile Workers
The **Mapbox GL JS** project documented a concrete race condition ([Issue #6308](https://github.com/mapbox/mapbox-gl-js/issues/6308)): when `reloadTile()` receives three sequential requests and the third arrives after the first completes but while the second is still processing, the callback for the third request is never called. This is a classic message-ordering problem.

#### Web Worker + Shared Memory Risks
JavaScript was designed to be single-threaded, so many browser APIs are not thread-safe. SharedArrayBuffer introduces genuine race conditions. Careful use of the Atomics API (read, write, add, compare-and-swap) is required for safe shared memory operations.

#### OffscreenCanvas Limitations
- `OffscreenCanvas` decouples canvas rendering from the DOM, enabling rendering in workers
- `transferControlToOffscreen()` mirrors a regular canvas to an OffscreenCanvas in a worker
- Worker animations remain smooth even when the main thread is congested
- **However**: DOM-dependent APIs are unavailable in workers; some style properties are missing; library compatibility varies
- **OffscreenCanvas + WebGL**: Workers can hold a WebGL context on an OffscreenCanvas, but this means the worker "owns" the context -- you cannot share a single WebGL context across threads

#### GPU Timeline Issues (WebGPU-relevant)
Every performance problem and race condition traces back to misunderstanding three distinct timelines: Content timeline (JS), Device timeline (driver), and Queue timeline (GPU). Operations submitted in order from JS may not complete in that order on the GPU.

### Mitigation Strategies

| Strategy | Description | Trade-off |
|----------|-------------|-----------|
| **Message-passing (no shared memory)** | Workers communicate via postMessage only | Simplest, avoids races, but serialization overhead |
| **Request ID / versioning** | Each tile request has a monotonic version; stale results are discarded | Prevents stale data but wastes work |
| **Single-writer pattern** | Only one thread writes to any given tile at a time | Eliminates write conflicts, requires scheduling discipline |
| **Ping-pong framebuffers** | Two FBOs alternate read/write roles | Prevents read-while-write GPU hazards |
| **SharedArrayBuffer + Atomics** | Lock-free concurrent data structures | Maximum performance but complex, error-prone |

### Recommendation for ObsidianPaper
The current architecture (message-passing with `bumpDocVersion()` + `syncDocumentToWorkers()`) is a good pattern. The version-stamping approach correctly handles stale results. Avoid SharedArrayBuffer complexity -- message-passing with structured clone is sufficient for tile rendering workloads.

### Sources
- [Mapbox GL JS Race Condition - Issue #6308](https://github.com/mapbox/mapbox-gl-js/issues/6308)
- [The State of Web Workers in 2021 - Smashing Magazine](https://www.smashingmagazine.com/2021/06/web-workers-2021/)
- [OffscreenCanvas - web.dev](https://web.dev/articles/offscreen-canvas)
- [OffscreenCanvas - MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [WebGPU Concurrency Guide](https://www.sitepoint.com/the-webgpu-concurrency-guide-mastering-async-compute-shaders/)

---

## 3. Alternative Architectures (Production Apps)

### Excalidraw (Canvas2D)

**Architecture: Two-canvas system with Canvas2D and RoughJS**

- **Static Canvas**: Renders all drawing elements (rectangles, arrows, text, images) using RoughJS for the hand-drawn aesthetic. Only redraws when elements or viewport change.
- **Interactive Canvas**: Renders UI overlays (selection handles, cursors) using a continuous animation loop. Lightweight, redraws every frame.
- **Renderer class**: Central coordinator that filters elements by viewport visibility via memoized `getRenderableElements()`. A `sceneNonce` invalidation token increments whenever the scene changes.
- **Performance**: Static rendering throttled to ~60fps (16ms). Reference equality checks avoid unnecessary redraws.
- **No WebGL**: Uses plain Canvas2D throughout.

**Relevance to ObsidianPaper**: The two-canvas pattern (static content + interactive overlay) maps directly to the baked-strokes vs active-strokes separation.

### tldraw (DOM/SVG)

**Architecture: DOM-based rendering with React**

- **SVG for geometric shapes** (arrows, shapes, frames) with path data and stroke styling
- **HTML for text and media** with native font rendering and editing
- **CSS matrix transforms** for positioning -- GPU-accelerated hardware transforms for smooth pan/zoom
- **Centralized culling**: A single reactor watches `editor.getCulledShapes()` and updates all shape visibility in one pass (O(1) complexity vs O(N) per-shape subscriptions)
- **Direct DOM manipulation**: `updateCulling` manipulates `display` properties directly, bypassing React reconciliation
- **Level of Detail (LOD)**: Adjusts rendering fidelity based on zoom level
- **useQuickReactor**: Updates CSS transforms without triggering React re-renders during geometry changes

**Relevance to ObsidianPaper**: tldraw's DOM approach is not suitable for high-frequency handwriting input, but its culling strategies and LOD concepts are applicable.

### Figma (WebGL/WebGPU + WASM)

**Architecture: C++ tile-based GPU renderer compiled to WASM**

- Custom rendering stack bypassing browser HTML pipeline entirely
- **Tile-based engine**: Divides viewport into tiles, renders each on GPU
- Supports masking, blurring, dithered gradients, blend modes, nested opacity
- All rendering fully GPU-accelerated and anti-aliased
- Uses **Loop-Blinn algorithm** (decade-old technique) for GPU vector rendering
- Written in C++ compiled to WASM via Emscripten; TypeScript UI layer on top
- Recently migrated to WebGPU (2023+) for compute shaders and MSAA
- WebAssembly cut load time by 3x
- "Internally looks like a browser inside a browser" with own DOM, compositor, text layout engine

**Key limitations encountered**: WASM 32-bit addressing (4GB max), mobile memory crashes, Safari debugging difficulties.

**Relevance to ObsidianPaper**: Figma validates that tile-based WebGL rendering works extremely well on the web, but the C++/WASM approach is a massive engineering investment. The tile-based concept is sound; the implementation complexity should be managed carefully.

### Summary Comparison

| App | Renderer | GPU Usage | Tile-Based | Complexity |
|-----|----------|-----------|------------|------------|
| Excalidraw | Canvas2D + RoughJS | None | No | Low |
| tldraw | DOM + SVG + CSS | CSS transforms only | No (culling-based) | Medium |
| Figma | WebGL/WebGPU + WASM | Full GPU rendering | Yes | Very High |
| **Typical painting app** | Canvas2D or WebGL FBO | Varies | Sometimes | Medium-High |

### Sources
- [Excalidraw Canvas Rendering Pipeline - DeepWiki](https://deepwiki.com/excalidraw/excalidraw/5.1-canvas-rendering-pipeline)
- [Excalidraw Rendering System - DeepWiki](https://deepwiki.com/excalidraw/excalidraw/5-rendering-and-export)
- [tldraw Canvas Rendering - DeepWiki](https://deepwiki.com/tldraw/tldraw/3.1-canvas-rendering)
- [tldraw Performance Docs](https://tldraw.dev/sdk-features/performance)
- [Figma: Building a Professional Design Tool on the Web](https://madebyevan.com/figma/building-a-professional-design-tool-on-the-web/)
- [Figma Rendering: Powered by WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)
- [Notes from Figma II: Engineering Learnings](https://andrewkchan.dev/posts/figma2.html)
- [How to Create a Figma-like Infinite Canvas in WebGL](https://medium.com/better-programming/how-to-create-a-figma-like-infinite-canvas-in-webgl-8be94f65674f)
- [Infinite Canvas Tutorial](https://infinitecanvas.cc/guide/lesson-004)

---

## 4. Stroke Rendering in WebGL

### "Drawing Lines is Hard"

This is the seminal article on the topic by [Matt DesLauriers](https://mattdesl.svbtle.com/drawing-lines-is-hard). The core problem: WebGL's native `gl.LINES` primitive is severely limited -- max width is driver-dependent (1.0px on ANGLE/Windows, ~10px on macOS), no joins/caps, inconsistent across devices, no antialiasing without MSAA.

### Four Main Approaches

#### 1. GL Line Primitives (`gl.LINES`)
- **Pros**: Simple, built-in
- **Cons**: Width limited by driver (often 1px), no joins/caps, inconsistent rendering, no dash support
- **Verdict**: Unusable for production drawing apps

#### 2. Triangulated Lines (Triangle Strips/Meshes)
- **Technique**: Tessellate polyline into triangles. For each segment, compute perpendicular normals, expand outward by half stroke width on each side to create 4 vertices (2 triangles). Handle joins (bevel, round, miter) and caps (butt, square, round) as additional geometry.
- **Pros**: Maximum control over appearance -- caps, joins, variable width, antialiasing, texturing
- **Cons**: Complex mesh generation, must rebuild on style changes, many edge cases (sharp angle miter explosion)
- **Performance**: Can be done in CPU or vertex shader. CPU tessellation generates more vertices but simpler shaders; GPU tessellation requires passing neighbor vertex data.
- **Verdict**: Best for production drawing apps. This is what most serious WebGL drawing tools use.

#### 3. Vertex Shader Expansion
- **Technique**: Pass line as a series of points; vertex shader expands each point into a quad perpendicular to the line direction
- **Pros**: Simpler than full tessellation, supports effects via fragment shader (dashes, gradients)
- **Cons**: Best for 2D/orthographic; thickness may be inconsistent in 3D
- **Verdict**: Good middle ground for 2D apps

#### 4. Signed Distance Field (SDF) in Fragment Shader
- **Technique**: Render a quad covering the stroke area; fragment shader computes signed distance to the curve boundary and uses it for antialiasing
- **Pros**: Resolution-independent, beautiful antialiasing, supports Bezier curves directly
- **Cons**: Expensive per-pixel computation, complex for long polylines, quad must be sized to cover stroke bounds
- **Verdict**: Excellent for isolated curves; impractical for polylines with many segments

### Instanced Line Rendering
An advanced technique using WebGL instancing to render many line segments efficiently ([Ricky Reusser's regl-gpu-lines](https://github.com/rreusser/regl-gpu-lines)). Each line segment is an "instance" rendered with the same geometry but different per-instance attributes (positions, colors, widths).
- **Pros**: Extremely efficient for large numbers of segments, good GPU utilization
- **Cons**: Requires WebGL 2 (or OES_vertex_array_object extension), more complex setup

### Bezier Curves on the GPU

**Resolution-independent Bezier rendering** ([NVIDIA GPU Gems 3, Chapter 25](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-25-rendering-vector-art-gpu)):
- Tessellate each Bezier convex hull into triangles
- Fragment shader evaluates curve equation to determine inside/outside
- Antialiasing via signed distance approximation in pixel shader
- Works for quadratic and cubic Bezier curves

**2D Quadratic Curves on the GPU** ([Matt DesLauriers - Observable](https://observablehq.com/@mattdesl/2d-quadratic-curves-on-the-gpu)):
- Fragment shader distance function approach
- Supports variable thickness, texturing, per-vertex attributes
- Much faster than CPU-rasterized approaches for many curves

### Brush/Stamp Texture Approach (for ink simulation)

This is the approach closest to traditional painting/handwriting apps:
- **Canvas image kept as a texture**: The drawing surface is a framebuffer-attached texture
- **New strokes rendered to texture**: Each stroke deposits color via render-to-texture
- **Ping-pong framebuffers**: Two FBOs alternate read/write. Frame N reads from texture A, draws new stroke content, writes to texture B. Frame N+1 swaps. This is essential because WebGL prohibits reading and writing the same texture simultaneously.
- **Soft brush via fragment shader**: Compute brush shape (Gaussian falloff, etc.) per-pixel in fragment shader rather than stamp blitting

**This is the most relevant approach for a handwriting app.** Rather than re-rendering all strokes every frame, you accumulate them into a persistent texture. Only active/in-progress strokes need per-frame rendering.

### Sources
- [Drawing Lines is Hard - Matt DesLauriers](https://mattdesl.svbtle.com/drawing-lines-is-hard)
- [Instanced Line Rendering](https://wwwtyro.net/2019/11/18/instanced-lines.html)
- [regl-gpu-lines](https://github.com/rreusser/regl-gpu-lines)
- [Rendering SVG Paths in WebGL - CSS Tricks](https://css-tricks.com/rendering-svg-paths-in-webgl/)
- [NVIDIA GPU Gems 3: Rendering Vector Art on the GPU](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-25-rendering-vector-art-gpu)
- [2D Quadratic Curves on the GPU - Observable](https://observablehq.com/@mattdesl/2d-quadratic-curves-on-the-gpu)
- [Efficient WebGL Stroking - Ibon Tolosana](https://hypertolosana.wordpress.com/2015/03/10/efficient-webgl-stroking/)
- [brushtips - WebGL brush drawing](https://github.com/darknoon/brushtips)
- [WebGL Render to Texture](https://webglfundamentals.org/webgl/lessons/webgl-render-to-texture.html)
- [Ping-Pong Technique for Stateful Rendering](https://olha-stefanishyna.medium.com/stateful-rendering-with-ping-pong-technique-6c6ef3f5091a)
- [Polyline Rendering in Infinite Canvas](https://infinitecanvas.cc/guide/lesson-012)
- [How to draw lines in WebGL - Khronos presentation](https://www.khronos.org/assets/uploads/developers/presentations/Crazy_Panda_How_to_draw_lines_in_WebGL.pdf)
- [Drawing Lines with WebGL - Scott Logic](https://blog.scottlogic.com/2019/11/18/drawing-lines-with-webgl.html)

---

## 5. Testing and Architecture Patterns for Graphics Code

### Testing Approaches

#### 1. Visual Regression / Snapshot Testing
- Render to a canvas/FBO, save output as PNG
- Compare pixel-for-pixel against known-good baseline images using image-diff libraries
- **Pros**: Tests actual visual output, catches shader bugs, works for any rendering technology
- **Cons**: Fragile (anti-aliasing differences across platforms), slow, difficult to debug failures, requires baseline maintenance

#### 2. Unit Testing (Logic Separation)
The key principle from [chinedufn's WebGL testing tutorial](https://www.chinedufn.com/unit-testing-webgl/):
- A WebGL component is "a function that takes in your canvas's WebGL context and any relevant data, and then draws something onto your canvas"
- Separate pure data-transformation logic from GPU calls
- Test the data layer independently (geometry generation, coordinate transforms, buffer construction)
- **Pros**: Fast, reliable, catches logic bugs
- **Cons**: Does not verify GPU rendering correctness

#### 3. Integration Testing with Headless Browser
- Puppeteer or Playwright with headless Chrome
- **glcheck**: A dedicated [WebGL testing framework](https://github.com/tsherif/glcheck) that runs unit and render tests in puppeteer
- deck.gl's approach: Unit tests capture initialization/prop-update issues but acknowledge "some issues in e.g. GPU shaders can only be spotted in an integration test"
- **Pros**: Tests real WebGL context, catches driver-level issues
- **Cons**: Slow, environment-dependent, flaky

### Architecture Patterns for Testability

#### 1. Command Buffer Pattern
Separate "what to render" from "how to render":
- **Upper layer (Graphics Rendering)**: Creates render jobs/commands as plain data objects (draw call + buffer ranges + state)
- **Lower layer (Graphics Device)**: Translates commands to actual WebGL API calls
- Test the upper layer with mock device; test lower layer with integration tests

#### 2. Wrapper Abstraction Pattern
Create thin wrappers around GPU resources:
- `VertexBuffer`, `IndexBuffer`, `Shader`, `Texture2D` classes that encapsulate WebGL state
- Models/rendering logic never touches GL API directly
- Wrappers can be mocked for testing
- **This is what ObsidianPaper's `GLState` class appears to do already**

#### 3. Rendering Thread Separation
- Rendering thread's sole responsibility is sending GPU commands
- Engine-abstracted command buffers are generated on the game/main thread
- Sent to rendering thread for translation to GPU commands
- Each layer is independently testable

### Debugging Tools
- **Spector.js**: Browser extension that captures WebGL frames and inspects every API call, draw call, texture, shader, and buffer
- **WebGL Inspector**: Similar capabilities for frame-by-frame debugging
- **Chrome DevTools**: Built-in GPU profiling

### Recommendations for ObsidianPaper

1. **Separate geometry generation from GPU submission**: Stroke tessellation (outline generation, Bezier subdivision) should produce plain TypeScript arrays/typed arrays. These are easily unit-testable.
2. **Use command buffer / render job pattern**: Build a list of render operations (draw tile, composite layers, etc.) as data, then execute them against the GL context. Test the list generation without GL.
3. **Snapshot tests for critical visual features**: Set up a small set of reference images for key rendering scenarios (stroke appearance, blending, tile compositing). Run these in CI with headless Chrome.
4. **Mock the GL context for unit tests**: Create a lightweight mock that tracks calls made (like `GLState.test.ts` already does).

### Sources
- [Unit Testing WebGL Components - chinedufn](https://www.chinedufn.com/unit-testing-webgl/)
- [glcheck - WebGL testing framework](https://github.com/tsherif/glcheck)
- [deck.gl Testing Guide](https://deck.gl/docs/developer-guide/testing)
- [Decoupling the Graphics System - GameDev.net](https://www.gamedev.net/forums/topic/652771-decoupling-the-graphics-system-render-engine/)
- [Separating Game Logic from Rendering - GameDev.net](https://www.gamedev.net/forums/topic/648413-about-separating-game-logic-from-rendering/)
- [Rendering Thread Architecture - GameDev.net](https://www.gamedev.net/forums/topic/690447-rendering-thread-architecture/)

---

## 6. iPad Safari Specific Considerations

### Known Issues

1. **WebGL Context Loss**: Backgrounding Safari and returning can trigger `WEBGL_lose_context`, crashing WebGL rendering. Apps must handle `webglcontextlost` and `webglcontextrestored` events gracefully.

2. **Memory Limits**: Safari's Metal backend imposes buffer size limits -- 256MB on iPhone 6, scaling to ~993MB on iPad Pro. Large texture atlases or many FBOs can hit these limits.

3. **iOS 18.4+ Compatibility**: Recent updates have caused WebGL failures on older iPads (9th gen and lower). Testing across iOS versions is critical.

4. **`flat` Qualifier Bug**: Usage of the `flat` qualifier in shaders can trigger context loss on some Safari versions.

5. **Performance Regressions**: Safari 14.1, 15.2, and other versions have had documented WebGL performance regressions (e.g., [WebKit Bug #230749](https://bugs.webkit.org/show_bug.cgi?id=230749)).

6. **No WebGPU on iOS**: As of early 2026, WebGPU is not available in Safari on iOS/iPadOS. WebGL 2 is the ceiling.

### Apple Pencil Latency

- iPadOS reduced Apple Pencil latency from 20ms to 9ms via prediction algorithms
- 4ms improvement from "mid-frame event processing" technique
- Requires 120Hz ProMotion display for best results
- Predicted touches available via UIKit since iOS 9; in web context, these map to `pointerEvent.getPredictedPoints()` (limited browser support)
- **For web apps**: Cannot access native PencilKit prediction. Must implement own prediction using pointer events. The `coalesced` and `predicted` pointer events are available in Safari.

### Safari-Specific WebGL Tips

- Prefer WebGL 2 (widely supported on modern iPads)
- Be conservative with texture sizes (max 4096x4096 is safe; 8192 may work on newer devices)
- Handle context loss aggressively -- rebuild all GL state on restore
- Minimize shader complexity to avoid compiler timeouts
- Test with Safari's Web Inspector GPU timeline profiling
- Avoid the `flat` interpolation qualifier in shaders

### Sources
- [Safari WebGL Performance - Apple Developer Forums](https://developer.apple.com/forums/thread/696821)
- [WebGL Context Loss on iOS - Apple Developer Forums](https://developer.apple.com/forums/thread/737042)
- [WebGL Performance on Safari - Wonderland Engine](https://wonderlandengine.com/news/webgl-performance-safari-apple-vision-pro/)
- [WebKit Bug #230749 - Performance Regression](https://bugs.webkit.org/show_bug.cgi?id=230749)
- [Minimizing Latency with Predicted Touches - Apple Docs](https://developer.apple.com/documentation/uikit/touches_presses_and_gestures/handling_touches_in_your_view/minimizing_latency_with_predicted_touches)
- [Apple Pencil Latency Improvements - idownloadblog](https://www.idownloadblog.com/2019/06/06/ipados-13-overview-apple-pencil/)

---

## 7. Recommendations for ObsidianPaper

### Architecture Assessment

The current ObsidianPaper architecture (tile-based rendering with web workers, Canvas2D tile rendering, separate active/prediction canvases) is sound and aligns with industry patterns. Here are specific recommendations for a potential WebGL migration:

### What WebGL Would Improve

1. **Pan/Zoom Performance**: Matrix transforms on GPU instead of CPU. Currently CSS transforms handle this during gestures, but the tile re-render after gesture end would be faster.
2. **Tile Compositing**: Compositing multiple tile textures into the viewport is extremely fast in WebGL (simple textured quad rendering).
3. **Stroke Baking**: Rendering many strokes into a tile texture can leverage GPU parallelism.
4. **Blending/Effects**: GPU blend modes, alpha compositing, and effects (blur, grain texture) are native WebGL operations.

### What WebGL Would NOT Improve (or would complicate)

1. **Active Stroke Rendering**: The current stamp-based approach with Canvas2D may actually be hard to beat for small numbers of active strokes. The overhead of GPU setup can exceed the benefit for 1-3 strokes.
2. **Text Rendering**: WebGL text is notoriously difficult. Keep text in Canvas2D/DOM.
3. **Debugging**: WebGL is harder to debug than Canvas2D, especially on Safari.
4. **Code Complexity**: Substantial increase in shader code, buffer management, state tracking.

### Recommended Hybrid Architecture

Based on the research, the optimal architecture for a handwriting app on iPad Safari would be:

```
┌─────────────────────────────────────────────┐
│                Main Thread                   │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Input/Events│  │ WebGL Compositor     │  │
│  │ (pointer    │  │ - Tile texture comp. │  │
│  │  events,    │  │ - Viewport rendering │  │
│  │  gestures)  │  │ - Active stroke FBO  │  │
│  └─────────────┘  │ - Prediction FBO     │  │
│                    │ - Grain/effects      │  │
│                    └──────────────────────┘  │
│                              ▲               │
│                    Tile textures uploaded     │
│                              │               │
├──────────────────────────────┼───────────────┤
│              Worker Threads  │               │
│  ┌──────────────────────┐   │               │
│  │ Tile Renderer (C2D)  │───┘               │
│  │ - Stroke tessellation│                    │
│  │ - Canvas2D bake      │                    │
│  │ - ImageBitmap output │                    │
│  └──────────────────────┘                    │
└─────────────────────────────────────────────┘
```

**Key design decisions:**

1. **WebGL for compositing, Canvas2D for tile baking**: Workers render individual tiles using Canvas2D (which they already do), then transfer ImageBitmaps to the main thread. The main thread WebGL compositor uploads these as textures and composites them into the viewport. This gets the zoom/pan performance benefits of WebGL without rewriting all stroke rendering in shaders.

2. **Render active strokes to FBO**: Active/in-progress strokes render to a dedicated framebuffer object, composited over the tile layer. This avoids re-rendering all tiles when just the active stroke changes.

3. **Ping-pong FBOs for stroke accumulation**: When baking active strokes into tiles, use ping-pong framebuffers to safely accumulate stroke data.

4. **Progressive migration**: Start with WebGL compositor only (tiles still rendered by workers in Canvas2D). Later, optionally move stroke rendering to WebGL shaders for further performance gains.

### Risk Factors for iPad Safari

- WebGL context loss is a real risk; must implement full state reconstruction
- Memory limits require careful texture budget management
- Test across iOS versions (15, 16, 17, 18) for regression coverage
- Keep a Canvas2D fallback path for devices where WebGL fails

### Key Principle from the Research

**The most successful web drawing apps match their rendering technology to their content type:**
- Structured shapes (rectangles, arrows) --> DOM/SVG (tldraw)
- Sketch-like drawings with moderate content --> Canvas2D (Excalidraw)
- Professional design with massive documents --> WebGL tile-based (Figma)
- Handwriting with many strokes + infinite scroll --> **WebGL compositing + Canvas2D/WebGL tile rendering** (recommended for ObsidianPaper)

---

## Appendix: Key Open Source Projects to Study

| Project | Technology | Relevance |
|---------|-----------|-----------|
| [Excalidraw](https://github.com/excalidraw/excalidraw) | Canvas2D + RoughJS | Two-canvas pattern, viewport culling, memoization |
| [tldraw](https://github.com/tldraw/tldraw) | DOM + SVG + React | Centralized culling, LOD, performance optimization |
| [Lumo](https://github.com/unchartedsoftware/lumo) | WebGL tiles | Tile-based WebGL rendering library |
| [regl-gpu-lines](https://github.com/rreusser/regl-gpu-lines) | WebGL (regl) | Instanced GPU line rendering |
| [brushtips](https://github.com/darknoon/brushtips) | WebGL + TypeScript | Brush drawing in WebGL |
| [glcheck](https://github.com/tsherif/glcheck) | Puppeteer + WebGL | WebGL testing framework |
| [gpu-io](https://github.com/ihc523/webgl-gpu-io) | WebGL compute | GPU-accelerated computing library |
| [Infinite Canvas Tutorial](https://github.com/xiaoiver/infinite-canvas-tutorial) | WebGL/Canvas | Step-by-step infinite canvas implementation |
