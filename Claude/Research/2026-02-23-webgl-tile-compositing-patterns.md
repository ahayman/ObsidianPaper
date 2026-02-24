# WebGL Tile Rendering & Compositing Patterns — Production Research

## Research Date: 2026-02-23

## Context

ObsidianPaper is considering a tile-based WebGL rendering architecture where:
1. A single hidden WebGL2 canvas renders each tile into an FBO
2. Blits the FBO to the default framebuffer
3. Uses `ctx.drawImage(webglCanvas)` to transfer pixels to an OffscreenCanvas tile cache
4. A Canvas2D compositor draws cached tiles to the display

This research evaluates whether this is the standard approach, what production apps do, and whether better patterns exist.

---

## 1. How Production Web Drawing Apps Use WebGL

### Excalidraw

Excalidraw does **not use WebGL**. It uses a dual Canvas2D architecture:
- **Static Canvas**: Renders drawing elements using RoughJS (sketch-style rendering)
- **Interactive Canvas**: Handles real-time overlays (selection, hover)
- Performance optimization via viewport culling and render throttling
- No tile system; re-renders visible elements each frame

Source: [Excalidraw Rendering Architecture (DeepWiki)](https://deepwiki.com/excalidraw/excalidraw/5-rendering-and-export)

### tldraw

tldraw primarily uses **DOM/SVG rendering**, not WebGL:
- Shapes are rendered as React components producing SVG/HTML
- Shape indicators (selection outlines) recently moved from SVG to a 2D canvas for ~25x performance improvement
- WebGL is used optionally for **shader backgrounds** (via a separate WebGLManager class that syncs a WebGL2 context with the tldraw viewport)
- No tile system; renders via DOM compositing

Source: [tldraw Canvas Rendering Pipeline (DeepWiki)](https://deepwiki.com/tldraw/tldraw/3.1-canvas-rendering)

### Key Takeaway

Neither Excalidraw nor tldraw uses WebGL for primary rendering or tile-based caching. They rely on Canvas2D or DOM rendering. ObsidianPaper's handwriting workload (thousands of stamps per stroke, complex compositing) is fundamentally different from these diagram-oriented apps and genuinely benefits from WebGL.

---

## 2. FBO-to-Canvas2D Transfer Patterns

### How `drawImage(webglCanvas)` Works Internally

When you call `canvas2DContext.drawImage(webglCanvas, ...)`, the browser must transfer the WebGL canvas content. The mechanism varies by browser:

**Chrome/Chromium**: Performs a GPU-to-GPU texture copy in most cases. Chrome can blit canvas content from a WebGL canvas to a 2D canvas "without any performance penalty" when both are in the same GPU process. The operation is fast (~0.5-2ms for a tile-sized region).

**Safari/WebKit**: Safari 17.1+ handles this efficiently. Earlier versions had issues, but modern Safari performs this as a GPU-side operation via Metal's shared texture infrastructure. iPad Safari benefits from the unified memory architecture (CPU and GPU share the same memory), meaning "transfers" often involve just passing a pointer rather than copying data.

**Firefox**: Historically very slow (~200ms for a full-screen copy due to GPU readback). This has been a documented bug since 2015. Firefox is **not a target platform** for ObsidianPaper (iPad Safari is), so this is not a concern.

Sources: [Mozilla Bug 1163426](https://bugzilla.mozilla.org/show_bug.cgi?id=1163426), [Chromium Graphics Dev Discussion](https://groups.google.com/a/chromium.org/g/graphics-dev/c/pjXEk2o4aZE)

### The `preserveDrawingBuffer` Requirement

With `preserveDrawingBuffer: false` (the default), the WebGL drawing buffer is cleared after the browser composites it. This means `drawImage(webglCanvas)` **will get a blank canvas** if called after control returns to the browser's event loop.

**Critical rule**: You must call `drawImage` (or `readPixels`, `toDataURL`, etc.) **within the same synchronous execution block** as your render calls, before yielding to the browser.

```
// SAFE: render + drawImage in same synchronous block
engine.renderTile(...);
engine.drawOffscreen(tileFBO, 0, 0, size, size); // blit FBO -> default framebuffer
tileCtx.drawImage(webglCanvas, ...); // immediate copy, buffer still valid

// UNSAFE: drawImage after yielding to event loop
engine.renderTile(...);
await somePromise(); // <-- buffer may be cleared here
tileCtx.drawImage(webglCanvas, ...); // may get blank!
```

**If you follow this synchronous pattern, you do NOT need `preserveDrawingBuffer: true`.** The drawing buffer remains valid until you yield to the browser. This is explicitly specified in the WebGL specification.

Sources: [WebGL2 Fundamentals Tips](https://webgl2fundamentals.org/webgl/lessons/webgl-tips.html), [WebGL Specification](https://registry.khronos.org/webgl/specs/latest/1.0/)

### Alternatives to `drawImage`

| Method | Mechanism | Performance | Notes |
|--------|-----------|-------------|-------|
| `drawImage(webglCanvas)` | GPU-GPU copy (Chrome/Safari) | Fast (~0.5-2ms) | Requires synchronous call; simplest approach |
| `readPixels()` | GPU->CPU sync readback | Slow (~5-50ms), causes pipeline stall | Avoid for real-time; OK for async background work |
| `readPixels()` + PIXEL_PACK_BUFFER | Async GPU readback (WebGL2) | Fast (~0.3ms initial, then async) | Complex; needs fence sync polling |
| `transferToImageBitmap()` | Zero-copy bitmap transfer | Fast on Chrome; **slow on Safari** (incurs a copy) | Not recommended for Safari target |
| `blitFramebuffer()` | GPU-GPU FBO copy | Fast, but stays within WebGL | Cannot transfer to Canvas2D; only useful for WebGL-to-WebGL |
| `texImage2D(canvas)` | Upload canvas as WebGL texture | GPU-GPU on most browsers | Useful for the reverse direction (Canvas2D -> WebGL) |

**Recommendation**: `drawImage(webglCanvas)` is the correct approach for our architecture. It is the standard pattern used by virtual-webgl, OpenLayers, and other libraries that bridge WebGL output to Canvas2D. On Safari (our target), it performs well.

---

## 3. preserveDrawingBuffer: Actual Cost and Avoidance

### What `preserveDrawingBuffer: true` Does

When false (default), WebGL uses a double-buffer swap. After compositing, the front buffer is presented and the back buffer is cleared (or undefined). When true, the browser must either:
- Copy the back buffer after swap (extra blit per frame)
- Use a single-buffer approach (prevents certain optimizations)

### Actual Performance Cost

The cost is **platform-dependent and often overstated**:

- **On desktop Chrome/Firefox**: Minimal measurable cost in most cases (~0.1-0.3ms per frame)
- **On mobile (TBDR GPUs like Apple's)**: More significant because TBDR GPUs optimize around the assumption that tile memory can be discarded after resolve. Preserving forces an explicit store-back to VRAM.
- **On iPad specifically**: The cost is moderate. Apple's unified memory architecture mitigates some of the penalty, but the TBDR pipeline still loses the "don't store" optimization.

### How to Avoid It

**For our hidden tile-rendering canvas: we should NOT need `preserveDrawingBuffer: true`.**

The rendering flow is:
1. Render strokes into FBO
2. Blit FBO to default framebuffer
3. `drawImage(webglCanvas)` to OffscreenCanvas tile

Steps 2 and 3 happen synchronously in the same function call, before yielding to the browser. The drawing buffer is guaranteed to be intact. No `preserveDrawingBuffer` needed.

**Exception**: If you ever need to call `drawImage` from a different event (e.g., the compositor reads the WebGL canvas asynchronously), then you would need `preserveDrawingBuffer: true`. But our architecture does not require this.

Sources: [WebGL2 Tips](https://webgl2fundamentals.org/webgl/lessons/webgl-tips.html), [OpenLayers preserveDrawingBuffer PR](https://github.com/openlayers/openlayers/pull/12956)

---

## 4. WebGL Tile Rendering in Map Libraries

### Mapbox GL JS

Mapbox GL JS uses **a single WebGL canvas** for all rendering. Key architecture details:

- **Single context**: One WebGL context manages all map rendering (no per-tile canvases)
- **No FBO-per-tile**: Tiles are parsed into `Bucket` objects containing vertex/index buffers
- **Direct rendering**: The `Painter` class iterates style layers, and for each layer iterates visible tiles, drawing directly to the single WebGL canvas
- **Tile caching**: Tiles are cached as **parsed data structures** (vertex buffers, textures), NOT as rendered images. The tile cache uses LRU eviction with a two-tier system (_tilesInUse for active tiles, _tileCache for LRU).
- **Workers for parsing**: Web Workers parse vector tile data into Buckets, which are transferred to the main thread. Workers do NOT render.

**Pattern**: Parse/prepare on workers -> Cache as GPU buffers -> Render directly to single WebGL canvas

Source: [Mapbox GL JS ARCHITECTURE.md](https://github.com/mapbox/mapbox-gl-js/blob/main/ARCHITECTURE.md), [Mapbox GL JS Core Architecture (DeepWiki)](https://deepwiki.com/mapbox/mapbox-gl-js/2-core-architecture)

### deck.gl / luma.gl

deck.gl uses a single WebGL/WebGPU context with layer-based rendering:
- Tiles are loaded and cached as data, not as rendered images
- GPU resources (textures, buffers) are created via luma.gl's device abstraction
- Tile cache keeps loaded tiles in memory across views, shared via single cache
- No FBO-per-tile pattern; renders all visible tile data in a single pass per layer

Source: [deck.gl TileLayer](https://deck.gl/docs/api-reference/geo-layers/tile-layer)

### Lumo (WebGL Tile Library)

Lumo is the closest to our use case — a dedicated WebGL tile rendering library:
- Uses **texture atlases** for tile data storage on GPU
- `WebGLTileRenderer` provides abstractions for vertex and texture tile formats
- Tiles stored as GPU textures in an atlas, composited via textured quads
- Single WebGL context, atlas-based tile management

Source: [Lumo GitHub](https://github.com/unchartedsoftware/lumo)

### Key Insight for ObsidianPaper

Map libraries keep **everything in WebGL** — they never transfer tile pixels back to Canvas2D. Their tile caches store data (vertex buffers, parsed geometry), not rendered bitmaps. When they composite, they render all visible tile data directly to one WebGL canvas.

**Our architecture is different because**: We cache rendered tile bitmaps (not raw stroke data) because re-rendering all strokes on every frame would be too expensive. Map tiles have relatively simple geometry; our tiles can have thousands of stamps and complex compositing per tile. The bitmap cache is the right choice for our workload.

---

## 5. WebGL Context Sharing

### The Problem

WebGL contexts cannot share resources (textures, buffers, programs) across contexts. Each context has its own GPU state.

### Single Context Approaches

**Viewport/Scissor technique**: Render to different regions of a single large canvas using `gl.viewport()` and `gl.scissor()`. Used by Mapbox, deck.gl, and the webglfundamentals "multiple views" approach.
- Pros: No resource duplication, single context
- Cons: All output goes to one canvas; doesn't help with off-DOM tile caching

**FBO-per-tile (our approach)**: Single context, render to different FBOs for each tile.
- Pros: Each tile can be different size; FBOs are cheap to create/bind
- Cons: Must transfer FBO content out of WebGL for caching

### Virtual-WebGL

Greggman's [virtual-webgl](https://github.com/greggman/virtual-webgl) virtualizes multiple WebGL contexts on a single real context:
- Each virtual context gets an FBO as its "drawing buffer"
- The compositor draws each FBO to its corresponding canvas via `drawImage()`
- The WebGL2 version shadows state for fast context switching
- **Uses exactly our pattern**: FBO -> blit to shared canvas -> `drawImage()` to target canvas

This validates our approach — virtual-webgl uses the same FBO-to-drawImage pattern we're planning.

Source: [virtual-webgl GitHub](https://github.com/greggman/virtual-webgl)

### Context Limits

Browsers limit simultaneous WebGL contexts (typically 8-16). On iPad Safari, the practical limit is lower. Our single-context + FBO approach avoids this issue entirely.

---

## 6. OffscreenCanvas + WebGL2

### Browser Support

| Browser | OffscreenCanvas + WebGL2 | In Worker | Notes |
|---------|--------------------------|-----------|-------|
| Chrome 69+ | Yes | Yes | Stable, well-optimized |
| Firefox 105+ | Yes | Yes | Works but drawImage transfer is slow |
| Safari 17+ (iOS 17+) | **Yes** | **Yes** | Confirmed working; earlier compat data was incorrect |
| Safari 18+ | Yes | Yes | Bug fixes for nested workers |

Source: [Can I Use - OffscreenCanvas WebGL2](https://caniuse.com/mdn-api_offscreencanvas_getcontext_webgl2_context), [MDN Browser Compat Issue #21127](https://github.com/mdn/browser-compat-data/issues/21127)

### Known Issues on Safari

1. **Context type confusion**: A WebKit bug where requesting "webgl2" on an OffscreenCanvas that previously had a "webgl" context would return the WebGL1 context. Fixed in recent WebKit commits.
2. **Context loss on background**: iOS 17 has reports of WebGL context loss when Safari goes to background. Must handle `webglcontextlost`/`webglcontextrestored` events.
3. **Float textures**: 32-bit float textures and float texture filtering are NOT supported on iOS. Use `UNSIGNED_BYTE` or `HALF_FLOAT`.

Source: [WebKit Commit 355b4e8](https://github.com/WebKit/WebKit/commit/355b4e8956f0c1bd5cdbdadae91036cb366da07e)

### Implications for Our Architecture

We could create the WebGL2 context on an OffscreenCanvas instead of a hidden HTMLCanvasElement:

```typescript
// Option A: Hidden DOM canvas (current plan)
const canvas = document.createElement("canvas");
const gl = canvas.getContext("webgl2", { ... });

// Option B: OffscreenCanvas (simpler, no DOM)
const offscreen = new OffscreenCanvas(2048, 2048);
const gl = offscreen.getContext("webgl2", { ... });
```

**Advantages of OffscreenCanvas**:
- No DOM element needed
- Could theoretically run in a worker (though we don't need to for our architecture)
- Cleaner lifecycle management

**Potential concern**: The `drawImage` transfer from OffscreenCanvas WebGL2 to another OffscreenCanvas 2D context hasn't been as thoroughly tested as the HTMLCanvasElement path. On Safari, the HTMLCanvasElement path is more battle-tested.

**Recommendation**: Start with HTMLCanvasElement (safer). Test OffscreenCanvas as an optimization later.

---

## 7. Alternative: Full WebGL Compositing

### The Concept

Instead of:
```
WebGL FBO -> blit to default FB -> drawImage -> OffscreenCanvas tile cache -> Canvas2D compositor -> display
```

Use:
```
WebGL FBO -> store as WebGL texture in tile cache -> WebGL compositor draws textured quads -> display
```

Everything stays in WebGL. No cross-context transfer. Each cached tile is a WebGL texture, and the compositor draws them as textured quads on the display canvas.

### How This Would Work

```typescript
class WebGLTileCache {
  private tiles: Map<string, WebGLTexture>; // tile key -> GPU texture
  private gl: WebGL2RenderingContext;

  cacheTile(key: string, fboTexture: WebGLTexture): void {
    // Just store the texture reference — no readback needed
    this.tiles.set(key, fboTexture);
  }
}

class WebGLTileCompositor {
  composite(visibleTiles: TileInfo[], viewTransform: DOMMatrix): void {
    const gl = this.gl;
    for (const tile of visibleTiles) {
      const tex = this.cache.get(tile.key);
      // Draw tile as textured quad at correct screen position
      this.drawTexturedQuad(tex, tile.screenRect);
    }
  }
}
```

### Advantages

1. **No FBO-to-Canvas2D transfer**: Eliminates the `drawImage(webglCanvas)` step entirely
2. **GPU-native compositing**: Drawing textured quads is the fastest operation WebGL can do
3. **Lower latency**: No CPU involvement in compositing
4. **Simpler pipeline**: Fewer cross-API boundaries
5. **Enables GPU effects**: Could add per-tile effects (blur, opacity transitions) cheaply in the compositor shader
6. **Batch compositing**: All visible tiles in one or few draw calls

### Disadvantages

1. **All-or-nothing**: The entire rendering pipeline must be WebGL. Cannot mix with Canvas2D compositor. Worker-rendered Canvas2D tiles would need `texImage2D` to upload as textures.
2. **Context loss is catastrophic**: If WebGL context is lost, ALL cached tiles are gone (not just the renderer). Must re-render everything. With the hybrid approach, Canvas2D tile caches survive context loss.
3. **Active stroke rendering**: Active strokes (during writing) also need to be composited via WebGL. Currently they render to a separate Canvas2D canvas.
4. **Text rendering**: Any Canvas2D text (page numbers, labels) must either use a separate overlay canvas or be rendered via WebGL (complex).
5. **Memory management**: GPU textures are harder to track and manage than OffscreenCanvas objects. No automatic garbage collection.
6. **Worker tile compatibility**: Workers currently produce Canvas2D ImageBitmaps. These would need to be uploaded to WebGL textures via `texImage2D`, which has a cost (~0.5-2ms per tile).

### The Hybrid Compromise

A middle ground: Use WebGL for compositing but allow tiles to be cached as either WebGL textures (rendered on main thread via WebGL) or uploaded from ImageBitmaps (rendered by workers via Canvas2D):

```
Worker tiles: Canvas2D -> ImageBitmap -> texImage2D upload -> WebGL texture
Main thread tiles: WebGL FBO -> keep as WebGL texture (zero-cost)
Compositing: All tiles as textured quads via WebGL
```

### Assessment

Full WebGL compositing is the **superior long-term architecture** but requires more upfront work and introduces context-loss fragility. The **hybrid FBO-to-drawImage approach** is pragmatic for initial implementation:
- Keeps the existing Canvas2D compositor
- Workers continue to function unchanged
- WebGL tile rendering can be tested independently
- Migration to full WebGL compositing can happen incrementally

---

## 8. GPU Readback Costs on iPad

### Apple GPU Architecture (TBDR)

iPad uses Apple's custom GPU with **Tile-Based Deferred Rendering** (TBDR):
- Screen is divided into hardware tiles (~32x32 pixels)
- All geometry for each hardware tile is processed before any pixel shading
- Fragment shading happens in fast on-chip tile memory
- Results written to VRAM only when the hardware tile is complete
- `invalidateFramebuffer()` tells the driver it doesn't need to write certain attachments back to VRAM (important optimization for DEPTH/STENCIL)

### readPixels Performance

No public benchmarks exist for iPad-specific `readPixels` timing, but general findings:

| Operation | Estimated Cost | Mechanism |
|-----------|---------------|-----------|
| Synchronous `readPixels` (512x512 RGBA) | ~2-10ms | Forces GPU pipeline flush + DMA transfer |
| Async readPixels (PIXEL_PACK_BUFFER) | ~0.3ms setup, then async | Non-blocking; poll fence for completion |
| `drawImage(webglCanvas)` (512x512) | ~0.5-2ms | GPU-GPU copy via Metal shared textures |

**PIXEL_PACK_BUFFER async readback** showed a **3x performance improvement** over synchronous readPixels even on Safari, according to three.js testing. This justifies using WebGL2 over WebGL1 for readback scenarios.

### Unified Memory Advantage

iPad's unified memory architecture means CPU and GPU share the same physical RAM. This fundamentally changes the readback cost model:
- `readPixels` doesn't actually "transfer" data across a bus — it syncs cache coherency and maps the GPU buffer to CPU address space
- `drawImage` between canvases may resolve to a pointer/reference copy rather than a data copy
- The main cost is **pipeline synchronization** (forcing the GPU to finish rendering before reading), not the data transfer itself

### Metal Emulation Overhead

Safari implements WebGL on top of Metal. This translation layer has known costs:
- **Uniform Buffer Objects (UBOs)**: Can cause 150ms hitches when uploaded at the wrong moment
- **WebGL 2.0 features**: Some are more expensive than WebGL 1.0 equivalents due to Metal emulation
- **`getParameter`/`getError`**: These calls can be expensive (~1ms+) because they force synchronization with the Metal command queue

Source: [WebGL Performance on Safari (Wonderland Engine)](https://wonderlandengine.com/news/webgl-performance-safari-apple-vision-pro/)

### Practical Implications

1. **Avoid `readPixels` in the rendering hot path.** Use `drawImage` for tile transfer instead.
2. **Call `invalidateFramebuffer` after rendering each tile** to allow the TBDR pipeline to discard depth/stencil without writing back.
3. **Minimize state queries** (`getParameter`, `getError`). Our GLState wrapper that shadows state is the right approach.
4. **Batch tile rendering** to minimize the number of FBO binds and pipeline synchronization points.

---

## 9. Summary: Is Our FBO-to-drawImage Approach Standard?

### Verdict: Yes, with caveats.

Our proposed architecture (single WebGL context -> render to FBO -> blit to default FB -> `drawImage` to OffscreenCanvas tile cache -> Canvas2D compositor) is a **well-established pattern** used by:

- **virtual-webgl**: Exactly this pattern for compositing multiple virtual WebGL contexts
- **OpenLayers**: Uses `drawImage(webglCanvas)` for tile rendering, with `preserveDrawingBuffer` considerations
- **Three.js multi-view setups**: Render to WebGL, copy to 2D canvases via `drawImage`

### What's Standard

1. Single WebGL context with FBOs for off-screen rendering
2. Synchronous `drawImage(webglCanvas)` without `preserveDrawingBuffer: true`
3. FBO pool with pre-configured framebuffers (avoid re-creating per tile)
4. `invalidateFramebuffer` for DEPTH/STENCIL attachments on TBDR GPUs

### What Could Be Better

1. **Full WebGL compositing** (tiles as textures, compositor as WebGL) eliminates the cross-API transfer. Map libraries do this. Should be the end-state architecture.
2. **Texture atlas for tile cache**: Instead of individual FBO textures, pack tiles into a large atlas texture. Reduces texture bind overhead during compositing.
3. **Async readback via PIXEL_PACK_BUFFER**: If any tile rendering needs CPU-side pixel access (e.g., for workers), async readback avoids the pipeline stall.

### Recommended Architecture Evolution

**Phase 1 (Now)**: FBO -> drawImage -> OffscreenCanvas tile cache -> Canvas2D compositor
- Minimal changes to existing architecture
- Workers continue unchanged
- Validates WebGL rendering quality

**Phase 2 (After validation)**: FBO -> WebGL texture tile cache -> WebGL compositor
- Eliminates drawImage transfer
- All compositing stays GPU-side
- Worker tiles uploaded via `texImage2D`
- Active strokes rendered via WebGL on overlay canvas

**Phase 3 (Future)**: WebGPU rendering + compositing
- iOS 26+ (Fall 2025+)
- Direct Metal mapping eliminates translation overhead
- Compute shaders for stamp generation
- Render bundles for cached tile replay

---

## Key Sources

- [MDN WebGL Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [WebGL2 Fundamentals Tips (preserveDrawingBuffer)](https://webgl2fundamentals.org/webgl/lessons/webgl-tips.html)
- [virtual-webgl (Greggman)](https://github.com/greggman/virtual-webgl)
- [Mapbox GL JS Architecture](https://github.com/mapbox/mapbox-gl-js/blob/main/ARCHITECTURE.md)
- [Mapbox GL JS Core Architecture (DeepWiki)](https://deepwiki.com/mapbox/mapbox-gl-js/2-core-architecture)
- [Excalidraw Rendering System (DeepWiki)](https://deepwiki.com/excalidraw/excalidraw/5-rendering-and-export)
- [tldraw Canvas Rendering (DeepWiki)](https://deepwiki.com/tldraw/tldraw/3.1-canvas-rendering)
- [Lumo WebGL Tile Library](https://github.com/unchartedsoftware/lumo)
- [deck.gl TileLayer](https://deck.gl/docs/api-reference/geo-layers/tile-layer)
- [OpenLayers preserveDrawingBuffer](https://github.com/openlayers/openlayers/pull/12956)
- [Mozilla Bug: drawImage(webglCanvas) slow](https://bugzilla.mozilla.org/show_bug.cgi?id=1163426)
- [Three.js Async Readback Discussion](https://github.com/mrdoob/three.js/issues/22779)
- [WebGL Performance on Safari (Wonderland Engine)](https://wonderlandengine.com/news/webgl-performance-safari-apple-vision-pro/)
- [Can I Use: OffscreenCanvas WebGL2](https://caniuse.com/mdn-api_offscreencanvas_getcontext_webgl2_context)
- [Apple TBDR Architecture](https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering)
- [Chromium Canvas Transfer Discussion](https://groups.google.com/a/chromium.org/g/graphics-dev/c/pjXEk2o4aZE)
- [WebGL Multiple Views (webglfundamentals)](https://webglfundamentals.org/webgl/lessons/webgl-multiple-views.html)
- [transferToImageBitmap Performance (Flutter)](https://github.com/flutter/flutter/issues/145420)
- [MDN OffscreenCanvas Browser Compat](https://github.com/mdn/browser-compat-data/issues/21127)
- [WebGPU in Safari 26 (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/236/)
- [HackMD WebGL Best Practices](https://hackmd.io/@jgilbert/WebGLBestPractices)
