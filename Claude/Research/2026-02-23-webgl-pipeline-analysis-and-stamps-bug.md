# WebGL Rendering Pipeline Analysis & Stamps Pipeline Bug Investigation

## Executive Summary

The Stamps pipeline is the only broken rendering path in WebGL tile baking. Basic (fillPath) and Textures (fillPath + grain/destination-out) both work correctly, which tells us:

- Coordinate transforms (world → tile pixel) are correct
- The stencil INVERT fillPath trick works
- Blend mode switching (destination-out for grain) works
- FBO rendering and compositing work (Y-flip handling is correct)
- Tile allocation, caching, and eviction work

**The problem is isolated to the two stamp code paths**: pencil stamps (`drawStamps`) and fountain pen ink shading (offscreen `drawStamps` + `destination-in` mask). This document traces the exact data flow, identifies the bugs, and presents architectural recommendations.

---

## Part 1: Complete WebGL Rendering Pipeline Documentation

### 1.1 Architecture Overview

The system has a **dual-engine architecture** with four rendering paths for baked tile content:

| Path | Engine | Thread | Output |
|------|--------|--------|--------|
| WebGLTileEngine | WebGL2Engine | Main | FBO texture (zero-copy) |
| WorkerTileScheduler | Canvas 2D | Worker | ImageBitmap → GPU texture upload |
| TileRenderScheduler | Canvas 2D | Main | OffscreenCanvas |
| TileRenderer (engine) | Canvas2DEngine | Main | OffscreenCanvas |

All paths converge at compositing: `WebGLTileCompositor` draws tile textures as textured quads on the default framebuffer.

### 1.2 Coordinate Spaces

| Space | Description | Units |
|-------|-------------|-------|
| **World** | Infinite document plane | Stroke coordinates (e.g., x=500, y=200) |
| **Tile** | Fixed grid overlay | `(col, row)` where `col = floor(worldX / tileWorldSize)` |
| **Tile Pixel** | Pixels within a tile's FBO | `0..tilePhysical` (e.g., 0..256) |
| **Screen** | Canvas pixels | `(worldX - camera.x) * zoom * dpr` |

**World → Tile Pixel transform** (used in WebGLTileEngine.renderTile):
```
scale = tilePhysical / tileWorldSize
tx = -worldBounds[0] * scale
ty = -worldBounds[1] * scale
setTransform(scale, 0, 0, scale, tx, ty)
```

### 1.3 Zoom Band System

Continuous zoom is discretized to avoid constant re-rendering:
- `zoomBand = floor(log2(zoom) * 2)` — bands at √2 intervals
- `tilePhysical = tileWorldSize * 2^(band/2) * dpr` — clamped to [128, 2048]
- Tiles scale by at most ~1.41x before the next band triggers re-render

### 1.4 Tile Lifecycle

1. **Allocation**: `WebGLTileCache.allocate()` creates FBO via `createOffscreenTarget()` — the FBO's color texture IS the tile texture (zero-copy)
2. **Rendering**: `WebGLTileEngine.renderTile()` binds FBO, renders background + strokes
3. **Compositing**: `WebGLTileCompositor.composite()` draws tile textures as quads
4. **Invalidation**: Tiles marked dirty when strokes are added/removed
5. **Eviction**: LRU eviction when memory exceeds budget (default 200MB)

### 1.5 WebGL2Engine Key Methods

**fillPath(vertices)** — Stencil INVERT trick for concave polygons:
- Pass 1: TRIANGLE_FAN with stencil INVERT on bit 0, color write disabled
- Pass 2: Draw where stencil bit 0 is set, auto-clear bit
- No triangulation library needed

**drawStamps(texture, data)** — Instanced rendering:
- Each stamp is `[x, y, size, opacity]` in the instance buffer
- Unit quad (-0.5 to 0.5) scaled by size, translated by position
- Single `drawElementsInstanced` call for all stamps
- Transform: `u_transform = projection * currentTransform`

**applyGrain(texture, offsetX, offsetY, strength)** — Fullscreen eraser:
- Fullscreen quad in clip space (no projection)
- REPEAT-wrapped grain texture
- `destination-out` blend mode

**beginOffscreen / endOffscreen** — FBO stack:
- Pushes current FBO binding + viewport + projection + scissor
- Binds offscreen FBO, sets viewport/projection to offscreen dimensions
- Disables scissor (outer rect is in wrong coordinate space)
- `endOffscreen()` pops and restores all state

### 1.6 Shader Programs

| Program | Usage | Key Feature |
|---------|-------|-------------|
| Solid | fillRect, fillPath, clipPath | `u_color` uniform, premultiplied |
| Texture | drawImage, drawOffscreen, tile compositing | `u_alpha` modulation |
| Stamp | drawStamps (instanced) | `a_instance` with divisor=1 |
| Grain | applyGrain (fullscreen) | REPEAT wrap, `destination-out` |
| Circle | dot-grid backgrounds (instanced) | SDF with smoothstep AA |
| Line | ruled/grid backgrounds | Edge anti-aliasing |

### 1.7 Baking Process

When a stroke is finalized:
1. `scheduleFinalization()` queues adding stroke to document (next RAF)
2. `scheduleBake()` queues rendering to static layer (next RAF)
3. In RAF: finalizations first, then bakes
4. `TiledStaticLayer.bakeStroke()`:
   - Gets affected tiles from stroke bbox
   - For each: allocate GLTileEntry, call `WebGLTileEngine.renderTile()` (full re-render of that tile)
   - Sync doc to workers, re-composite

### 1.8 Concurrency Model

- **Main thread**: Owns WebGL context, renders visible tiles synchronously, composites
- **Workers**: Render tiles via Canvas 2D, return ImageBitmap for GPU upload
- **Version stamping**: `docVersion` / `workerDocVersion` prevents stale worker results
- **FBO protection**: Worker bitmaps never overwrite FBO tiles (`handleWebGLTileResult` checks `existing?.fbo`)
- **GLState reset**: After compositor (raw GL calls), `resetState()` invalidates GLState caches

---

## Part 2: Stamps Pipeline Bug Analysis

### 2.1 What Works (and What That Tells Us)

**Basic pipeline**: `renderStrokeToEngine()` → `engine.fillPath(vertices)` → stencil INVERT → draws correctly in tile FBOs. This confirms:
- The world-to-tile transform is applied correctly
- The projection matrix is correct for tile dimensions
- The FBO rendering and compositing work

**Textures pipeline**: `renderStrokeWithGrainEngine()` → `engine.beginOffscreen()` → fill + grain → `engine.endOffscreen()` → `engine.drawOffscreen()` → draws correctly. This confirms:
- Offscreen FBO nesting works (offscreen within tile FBO)
- `beginOffscreen` correctly saves/restores the tile FBO
- `drawOffscreen` Y-flip handling works
- `destination-out` blend mode works

### 2.2 The Stamps Pipeline Code Path

**Pencil stamps** (`StrokeRenderCore.ts:527-534`):
```typescript
const stamps = computeAllStamps(points, style, penConfig, penConfig.stamp);
const texture = stampCtx.getStampTexture(style.grain ?? DEFAULT_GRAIN_VALUE, color);
engine.drawStamps(texture, packStampsToFloat32(stamps));
```

**Ink shading** (`StrokeRenderCore.ts:602-647`, `renderInkShadedStrokeEngine`):
```typescript
engine.beginOffscreen(offscreen);   // Push tile FBO, bind ink offscreen
engine.clear();
engine.setTransform(...);           // World-to-tile with screen bbox offset
engine.drawStamps(texture, data);   // Deposit ink stamps
engine.setBlendMode("destination-in");
engine.fillPath(vertices);          // Mask to outline
engine.endOffscreen();              // Restore tile FBO
engine.drawOffscreen(offscreen, ...); // Composite back
```

### 2.3 Identified Issues

#### Issue 1: Stamp positions are in WORLD SPACE but `computeScreenBBox` uses PIXEL-SPACE transform

In `renderInkShadedStrokeEngine()` (line 618-619):
```typescript
const m = engine.getTransform();  // This is the world-to-tile-pixel transform
const region = computeScreenBBox(expandedBbox, m, grainCtx.canvasWidth, grainCtx.canvasHeight);
```

`grainCtx.canvasWidth` / `canvasHeight` are set to `tilePhysical` (e.g., 256). The `computeScreenBBox` function clips to `[0, canvasWidth] x [0, canvasHeight]`. But when a stroke spans multiple tiles, its bbox in tile-pixel space may extend well beyond the tile's bounds. The region computation clips to tile bounds, but the offscreen FBO is sized to only the clipped portion. When stamps are then drawn with the offset transform, stamps outside the clipped region are lost or mispositioned.

This is actually correct behavior for grain/textures (which also use this same pattern and work), so this alone isn't the bug. But it's worth noting.

#### Issue 2: `drawStamps` stamp coordinates are in world space, transformed by `u_transform`

The stamp vertex shader computes:
```glsl
vec2 worldPos = a_instance.xy + a_position * a_instance.z;
gl_Position = u_transform * vec3(worldPos, 1.0);
```

Where `a_instance.xy` are the stamp's (x, y) position from `computeAllStamps()`. These are in **world coordinates** (same as stroke points). The `u_transform = projection * currentTransform` where `currentTransform` is the world-to-tile-pixel matrix.

For **pencil stamps** (direct draw, no offscreen): The transform is the tile's world-to-pixel transform. This should work correctly — stamps at world positions get transformed to tile pixel positions. The same transform works for `fillPath`.

For **ink stamps** (offscreen draw): The transform inside the offscreen is:
```typescript
engine.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);
```
This is the tile's world-to-pixel transform but with translation offset by the screen bbox origin. This maps world coordinates to offscreen pixel coordinates. This should also work.

#### Issue 3: The critical FBO context issue — `beginOffscreen` reads `gl.getParameter(gl.FRAMEBUFFER_BINDING)`

In `WebGL2Engine.beginOffscreen()` (line 598-631):
```typescript
this.fboStack.push({
  fbo: gl.getParameter(gl.FRAMEBUFFER_BINDING),  // <-- READS CURRENT FBO FROM GL
  viewport: [...gl.getParameter(gl.VIEWPORT)],
  projection: this.projection,
  scissor: savedScissor,
});
```

This is a **gl.getParameter** call, which reads the actual GPU state. In `WebGLTileEngine.renderTile()`, the tile's FBO is bound via:
```typescript
gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo.fbo);  // Raw GL call, bypasses GLState
```

Since `beginOffscreen` reads from `gl.getParameter()` (not from GLState's cache), **it correctly gets the tile's FBO**. So when `endOffscreen` restores, it correctly rebinds the tile's FBO. This is NOT a bug — the `getParameter` approach is actually the correct way to handle this.

However, there IS a GLState cache consistency issue: after `endOffscreen` calls `this.state.bindFramebuffer(prev.fbo)`, GLState now thinks it has the tile FBO bound. But later, when `WebGLTileEngine.renderTile()` finishes and rebinds the default framebuffer via `gl.bindFramebuffer(gl.FRAMEBUFFER, null)`, GLState is NOT updated. This is handled by `resetState()` after compositing, but could cause issues if multiple strokes in the same tile use offscreen rendering.

#### Issue 4: `pathBuffer` shared between fillPath and drawStamps

Looking at the draw sequence in `renderInkShadedStrokeEngine`:
1. `engine.drawStamps(texture, data)` — uploads stamp data to `instanceBuffer`, binds `unitQuadVBO`
2. `engine.fillPath(vertices)` — uploads path vertices to `pathBuffer`, binds `solidVAO`

These use different buffers (`instanceBuffer` vs `pathBuffer`) so there's no conflict here.

But look more carefully at `drawStamps()` (line 689-730):
```typescript
this.state.bindVAO(this.stampVAO);
// Upload instance data
this.instanceBuffer.upload(data);
const instanceLoc = prog.attributes.get("a_instance")!;
gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer.buffer);
gl.vertexAttribPointer(instanceLoc, 4, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(instanceLoc);
gl.vertexAttribDivisor(instanceLoc, 1);
// Bind unit quad
gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadVBO);
```

After binding the unit quad, the attribute pointers for position/texcoord are set from `unitQuadVBO`. But the **instance attribute pointer was just set from `instanceBuffer`**. Then `drawElementsInstanced` is called. This should work because VAO stores the per-attribute buffer binding.

Wait — actually there's a subtle issue: **VAO state**. When `stampVAO` is bound, all vertex attribute settings are stored in it. But the VAOs are created empty in `initResources()` and configured dynamically on every draw call. This means each `drawStamps` call fully reconfigures the VAO. This is correct but wasteful.

#### Issue 5: THE LIKELY BUG — Scissor test during stamp rendering in tiles

In `WebGLTileEngine.renderTile()` (line 158-172):
```typescript
engine.save();
engine.clipRect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
// ... render strokes ...
engine.restore();
```

`clipRect` enables GL scissor test. For `fillPath`, the scissor clips correctly to the page boundary within the tile. But for `drawStamps`, the instanced rendering draws stamp quads that may extend beyond the page rect. **The scissor correctly clips these** — this is the intended behavior.

But is the scissor Y-flip correct for tile FBOs? In `clipRect()` (line 514-534):
```typescript
const glY = Math.floor(this.viewportHeight - Math.max(sy, ey));
```

`this.viewportHeight` is set to `tilePhysical` by `setViewport()` in `renderTile()`. The Y-flip converts from top-down pixel coords to bottom-up GL coords. For FBO rendering, this Y-flip is actually correct because the FBO renders with the same coordinate convention.

#### Issue 6: THE MOST LIKELY BUG — Screen bbox computation uses tile dimensions as canvas dimensions

In `renderInkShadedStrokeEngine()` (line 619):
```typescript
const region = computeScreenBBox(expandedBbox, m, grainCtx.canvasWidth, grainCtx.canvasHeight);
```

`grainCtx.canvasWidth/Height` come from `WebGLTileEngine.getEngineGrainContext()` (line 221-229):
```typescript
private getEngineGrainContext(canvasWidth: number, canvasHeight: number): EngineGrainContext {
  return { ..., canvasWidth, canvasHeight };
}
```

Called at line 139:
```typescript
const engineGrainCtx = this.getEngineGrainContext(tilePhysical, tilePhysical);
```

So `canvasWidth = canvasHeight = tilePhysical` (e.g., 256). `computeScreenBBox` clips the bbox to `[0, tilePhysical]`. For strokes that span the full tile, the screen bbox would be approximately `(0, 0, tilePhysical, tilePhysical)`.

The offscreen FBO is then sized to `(region.sw, region.sh)`. The transform inside the offscreen shifts by `(-region.sx, -region.sy)` to map world coordinates to offscreen pixel coordinates.

**The problem**: For a stroke that extends beyond the tile boundary (which is common — strokes span multiple tiles), the clipped bbox creates a smaller offscreen FBO. Stamps at the edges of the stroke may be positioned outside this offscreen, causing clipping artifacts. When these offscreen results are composited back, the stamp content is truncated at tile boundaries.

But wait — this same pattern is used by `renderStrokeWithGrainEngine()` (Textures pipeline) and it works. The difference is:
- **Textures pipeline**: `fillPath` renders the outline, which is clipped to the tile by the page scissor. Grain is applied as destination-out. The offscreen only needs to contain what's visible in the tile.
- **Stamps pipeline**: Individual stamps near tile boundaries may be positioned partially inside and partially outside the tile. The offscreen FBO clips them, but since stamps are tiny particles, some get completely cut off, creating visible seams at tile boundaries.

**This is the root cause for pencil stamps appearing fragmented across tiles.** Individual stamp particles that cross tile boundaries are clipped differently by each tile, creating visible seams.

For **ink shading (fountain pen)**, the situation is worse because the entire 3-step compositing (stamps → mask → composite) happens within a screen-bbox-sized offscreen. If the stroke extends beyond the tile, the screen bbox clips the stamps, then the mask clips to the outline, and the composite puts it back. At tile boundaries, you get:
- Stamps in tile A are clipped at the right edge
- Stamps in tile B are clipped at the left edge
- The mask (destination-in with outline) may also behave differently because the outline vertices extend beyond the offscreen

### 2.4 Why Active Strokes Look Fine

Active strokes are rendered on the full-resolution active canvas (not tile-based). There's no tile boundary to clip stamps. The entire stroke is rendered in one pass on one canvas with one coordinate system. No fragmentation.

---

## Part 3: External Research — Architectures for WebGL Drawing Apps

### 3.1 Do Production Drawing Apps Use Tile-Based WebGL?

**Very few do.** The landscape:

| App | Rendering | Tiles? | Notes |
|-----|-----------|--------|-------|
| **Figma** | WebGL (C++/WASM) | Yes | Full custom renderer compiled to WASM. Recently migrating to WebGPU. Enormous engineering investment. |
| **Excalidraw** | Canvas 2D | No | Two canvases (static + interactive). Viewport culling via memoized element filtering. |
| **tldraw** | DOM/SVG + React | No | CSS transforms for pan/zoom. Not suitable for freeform drawing. |
| **Krita (web)** | Canvas 2D + WebGL compositing | Yes | Tiles for undo/memory management, WebGL for layer compositing only |
| **Procreate** | Metal (native) | Yes | GPU tiles with custom shaders, but this is native Metal, not web |

**Key insight**: The major production web drawing tools either avoid WebGL entirely (Excalidraw, tldraw) or invest massively in a custom WebGL/WASM renderer (Figma). There's no established open-source pattern for "WebGL tile-based stroke rendering in a web app."

### 3.2 Is Tile-Based Rendering Necessary for WebGL?

**For Canvas 2D, tiles are essential** — you can't render a 10,000x10,000 pixel canvas. Tiles let you render only visible portions and cache results.

**For WebGL, tiles are one option but not the only one.** WebGL alternatives:

1. **Single large texture / render-to-texture ("ping-pong")**: Render all strokes to a single large texture (FBO). Active strokes render to a separate FBO. Composite both to screen. Re-render only when strokes change (undo/redo). Pan/zoom is just changing the compositing viewport — no re-rendering needed.
   - **Pro**: No tile boundaries, no seam artifacts, simpler coordinate system
   - **Con**: Memory-limited (max texture size), must re-render all strokes on undo/redo, can't partially invalidate
   - **Feasibility**: WebGL2 `MAX_TEXTURE_SIZE` is typically 4096-16384. At 2x DPR, that's 2048-8192 CSS pixels. For a single-page note, this could work. For infinite canvas, you'd need multiple textures or virtual texturing.

2. **Hybrid: Canvas 2D tiles + WebGL compositing**: Render tile content via Canvas 2D (in workers), upload as textures, use WebGL only for compositing (pan/zoom/transform/effects). This is essentially what the worker path already does.
   - **Pro**: Proven Canvas 2D rendering, WebGL only for what it's best at (compositing)
   - **Con**: No GPU acceleration for stamp rendering
   - **Feasibility**: This is your current architecture's fallback path and it works.

3. **Stroke-level GPU rendering (no tiles)**: Each stroke is a GPU object (VBO + texture). Render all visible strokes each frame. GPU handles culling via viewport.
   - **Pro**: No tile boundaries, GPU-accelerated everything, natural fit for pan/zoom
   - **Con**: Must re-render all visible strokes every frame (expensive if thousands of strokes), complex GPU resource management
   - **Feasibility**: Works well for vector-style apps (Figma), less proven for handwriting with hundreds of thousands of stamp particles per stroke.

4. **Dirty-region rendering**: Don't use fixed tiles. Instead, track which rectangular regions of the canvas are dirty, and only re-render those regions into the accumulated framebuffer.
   - **Pro**: Adapts to actual content changes, no tile boundary issues
   - **Con**: Complex dirty region tracking, still needs full re-render for undo/redo
   - **Feasibility**: Common in native apps, less common on web.

### 3.3 Concurrency Patterns

**Best practices from Mapbox GL JS** (the most mature web tile renderer):
- Message passing without shared memory (your current approach)
- Request versioning to discard stale results (your `docVersion` approach)
- Single writer per tile — never let two threads render the same tile simultaneously
- Abort stale work early (your `cancel` message, currently a no-op)

**Your architecture aligns well with these patterns.** The version stamping and FBO protection (`never overwrite FBO with bitmap`) are correct.

### 3.4 Stroke Rendering in WebGL

The seminal "Drawing Lines is Hard" (Matt DesLauriers) establishes that `gl.LINES` is unusable for production. The main approaches:

1. **Triangulated polylines**: Tessellate stroke outline into triangle mesh (your `fillPath` approach with stencil INVERT)
2. **Instanced stamp particles**: Your `drawStamps` approach — proven for pencil/spray brush textures
3. **SDF rendering**: Compute distance field in fragment shader — beautiful but expensive per-pixel
4. **Signed-distance line rendering**: Generate line segments as expanded quads with SDF AA in fragment shader

Your approach of stencil INVERT for outline fills + instanced stamps for particles is sound. The issue isn't the rendering technique — it's the tile boundary handling.

### 3.5 Testing Graphics Code

Three tiers:
1. **Pure data tests**: Test stamp generation, outline generation, coordinate transforms as pure functions (no GL). Fast, reliable.
2. **Mock GL tests**: Track GL calls without real GPU (your `GLState.test.ts`). Good for state management.
3. **Visual regression tests**: Render to canvas, compare against baselines. Catches shader bugs but brittle.

**The command buffer pattern** (recommended): Separate "what to render" from "how to render". Your `RenderEngine` interface is already this pattern. The key improvement would be making the stamp rendering logic more testable by separating stamp position computation from GL draw calls.

---

## Part 4: Architectural Recommendations

### 4.1 Fix the Immediate Bug: Tile Boundary Stamp Clipping

The root cause is that stamps are small particles that can cross tile boundaries. Each tile renders stamps independently, clipping at its own boundary. This creates visible seams.

**Option A — Bleed/overlap margin**: When rendering stamps for a tile, include stamps from a margin beyond the tile boundary. Each stamp particle is typically small (0.08 * stroke width), so a margin of `maxStrokeWidth` in world coordinates would catch all stamps. This is analogous to how font renderers handle glyph overflow.

**Option B — Full-stroke stamp rendering**: Instead of clipping stamps to the tile boundary, render ALL stamps for any stroke that overlaps the tile, then use the tile's scissor rect to clip the result. The stamps outside the tile are discarded by GL scissor, but stamps that straddle the boundary are correctly partial-rendered. This may already be happening for pencil stamps (they don't use an offscreen) but NOT for ink shading (which uses an offscreen sized to the screen bbox).

**Option C — For ink shading specifically**: Size the offscreen FBO to the FULL stroke bbox (in tile pixel space), not just the clipped-to-tile region. Then composite the full offscreen back to the tile. The tile's scissor will clip the result. This wastes some offscreen pixels but eliminates boundary artifacts.

### 4.2 Simplify the Architecture

The current system has high complexity from supporting four rendering paths simultaneously. Recommendations:

1. **Eliminate the direct `gl.bindFramebuffer` bypass in WebGLTileEngine**: Instead, register each tile's FBO with the engine's offscreen system and use `beginOffscreen`/`endOffscreen`. This keeps all FBO management in one place and avoids GLState cache invalidation issues.

2. **Make the compositor go through GLState**: Currently the compositor uses raw `gl.*` calls, requiring a `resetState()` afterward. If the compositor used the same GLState tracker, this wouldn't be needed.

3. **Consider dropping the WebGL tile rendering path**: Given that:
   - Canvas 2D tile rendering works correctly
   - Worker-based Canvas 2D rendering is already parallel
   - The only advantage of WebGL tile rendering is instanced stamps, which is the broken part
   - WebGL compositing (drawing tile textures to screen) works and provides the pan/zoom performance benefit

   A simpler architecture would be: **Canvas 2D tiles (in workers) + WebGL compositing only**. This eliminates the entire class of FBO management issues while keeping the performance benefit of GPU compositing.

4. **If keeping WebGL tile rendering**: Extract the stamp rendering into a separate, testable pipeline stage. Instead of rendering stamps inline during tile rendering, have a separate pass:
   - Pass 1: Render all non-stamp content to tile FBO (fillPath, grain — this works)
   - Pass 2: For each stamp-based stroke, render stamps in a separate fullscreen FBO (no tile boundaries), then blit the relevant tile-sized region back

### 4.3 Make the Code More Testable

The current architecture mixes coordinate computation, GL state management, and rendering logic in tightly coupled ways. Recommendations:

1. **Extract stamp position computation as a pure function**: `computeAllStamps()` already exists and is pure. Add tests that verify stamp positions for known inputs.

2. **Extract coordinate transforms as pure functions**: The world→tile→screen transforms should be independently testable. Create a `TileCoordinates` utility with pure transform functions.

3. **Extract the offscreen render-and-composite pattern**: The 3-step pattern (beginOffscreen → render → endOffscreen → drawOffscreen) is used in both grain and ink shading. Extract it into a helper that handles screen bbox computation, offscreen sizing, transform offsetting, and compositing. This helper can be tested in isolation.

4. **Add a "render command log" mode**: Instead of executing GL calls, record them as an array of command objects. Tests can assert on the command sequence without needing a real GL context. This is the command buffer pattern.

### 4.4 Long-Term Architecture Direction

Based on the research, the recommended architecture evolution:

**Phase 1 (Immediate)**: Fix stamp tile boundary clipping. Use bleed margin or full-stroke rendering for stamp-based strokes.

**Phase 2 (Short-term)**: Simplify to Canvas 2D workers + WebGL compositing. Remove WebGLTileEngine. This eliminates the most complex and bug-prone code path. If stamp rendering performance is acceptable in Canvas 2D (workers provide parallelism), this is the pragmatic choice.

**Phase 3 (If needed for performance)**: Re-introduce GPU stamp rendering, but as a separate compositing layer, not within the tile system. Render all stamps for visible strokes into a single FBO (no tile boundaries), then composite over the tile layer. This avoids tile boundary issues entirely.

**Phase 4 (Future)**: Evaluate WebGPU when iPad Safari supports it. WebGPU's compute shaders would enable truly efficient particle rendering without the tile boundary problem.

---

## Part 5: Specific Code Locations for Each Issue

| Issue | File | Lines | Description |
|-------|------|-------|-------------|
| Tile FBO bypass | WebGLTileEngine.ts | 100 | `gl.bindFramebuffer` bypasses GLState |
| Screen bbox clipping | StrokeRenderCore.ts | 618-619 | `computeScreenBBox` clips to tile bounds |
| Ink offscreen sizing | StrokeRenderCore.ts | 622 | Offscreen sized to clipped region |
| Pencil stamps direct draw | StrokeRenderCore.ts | 527-533 | No offscreen, stamps may cross tile boundary |
| Compositor raw GL | WebGLTileCompositor.ts | 86-164 | Bypasses GLState, requires resetState() |
| GLState reset | WebGLTileEngine.ts | 73-75 | Called after compositor; fragile coordination |
| Grain ctx dimensions | WebGLTileEngine.ts | 139, 221-228 | `canvasWidth/Height = tilePhysical` |

---

## CORRECTION — Part 2 Revised: The Actual Root Cause

*The original Part 2 analysis focused on tile boundary clipping, but the user reports that content appears at completely WRONG POSITIONS — "a stroke in the lower left shows up at upper right" and "pieces scattered all over." This is not a clipping issue. After deeper analysis, the root cause is a GLState texture cache poisoning bug.*

### The Bug: GLState Texture Cache Poisoning via `createOffscreenTarget`

**`createOffscreenTarget()` binds textures via raw `gl.bindTexture()`, bypassing GLState. This poisons GLState's texture cache, causing subsequent `state.bindTexture()` calls to skip the actual GL bind — leaving the wrong texture bound on the GPU.**

#### The Exact Sequence (during `bakeStroke`)

```
For each affected tile:
  1. glCache.allocate(key, worldBounds, zoomBand)
     → createOffscreenTarget(gl, tilePhysical, tilePhysical)
       → createColorTexture()
         → gl.bindTexture(gl.TEXTURE_2D, tileColorTexture)  // RAW GL — bypasses GLState!
       → gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)             // RAW GL — bypasses GLState!
       → gl.bindFramebuffer(gl.FRAMEBUFFER, null)             // RAW GL

     After this: GPU TEXTURE0 = tileColorTexture
                 GLState.currentTexture = stampTexture (stale from previous tile!)

  2. webglTileEngine.renderTile(entry, ...)
     → gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo.fbo)     // RAW GL
     → Background rendering: fillPath, fillRect (solid shader — no texture sampling)
     → Stroke rendering:
       → drawStamps(stampTexture, data)
         → this.state.bindTexture(stampTexture)
         → GLState checks: stampTexture === currentTexture?
         → currentTexture is STALE — still = stampTexture from previous tile!
         → Result: bindTexture is a NO-OP
         → GPU STILL has tileColorTexture bound!
         → Stamps sample from the tile's OWN color attachment!
```

#### Why This Produces "Scattered Content"

Each stamp quad is a small textured rectangle. The stamp shader samples the bound texture using UV coordinates (0,0)→(1,1) across each quad:

```glsl
fragColor = texture(u_texture, v_texcoord) * v_opacity * u_alpha;
```

When the correct stamp texture is bound, each quad shows a small circle. But when the tile's own color texture is bound instead, each quad samples a portion of the tile's partially-rendered content:

- The tile already has desk fill + page background rendered (Phase 1 of `renderTile`)
- Each stamp quad's UVs (0-1 range) sample random regions of this background
- Since stamp positions are scattered across the tile at many locations, you see fragments of the tile's background reproduced at stamp positions all over

This explains "lower left showing up at upper right" — a stamp positioned at the lower-left of the tile has UV coords that map to some region of the tile's color texture, and that region's content (from wherever it was in the background) gets rendered at the stamp's screen position.

#### Why It Doesn't Happen on the First Tile

If `allocate()` reuses an existing entry without recreating the FBO (same size, same band), `createOffscreenTarget` isn't called. No texture cache poisoning occurs. The first tile rendered after startup or a fresh allocation may work fine. The bug manifests on the SECOND tile, or whenever a tile allocation triggers `createOffscreenTarget` between two `renderTile` calls.

#### Why Basic and Textures Pipelines Work

These pipelines never call `engine.drawStamps()`. They use `fillPath` (solid shader — no texture needed), `applyGrain` (binds grain texture directly, which happens to be different from what's in the stale cache, so the bind succeeds), and `drawOffscreen` (binds FBO color texture directly). None of them hit the stale texture cache for stamp textures.

#### The Fix

**Option 1 — Reset state at start of each tile render** (simplest, safest):
```typescript
// In WebGLTileEngine.renderTile():
this.engine.resetState();  // Clear all stale caches
```

**Option 2 — Make `createOffscreenTarget` go through GLState** (architectural fix):
Pass the GLState instance to texture/FBO creation functions and have them update the cache.

**Option 3 — Unbind texture after creation** (minimal fix):
```typescript
// In createOffscreenTarget, after creating colorTexture:
gl.bindTexture(gl.TEXTURE_2D, null);
```
This makes GLState's stale cache value (stampTexture) not match null, so the next `state.bindTexture(stampTexture)` will correctly bind.

Option 1 is recommended — it's a one-line fix that prevents this entire class of bugs.

---

## Appendix: Existing Research Referenced

- `Claude/Research/2026-02-23-webgl-tile-compositing-patterns.md` — Validates FBO→drawImage pattern, iPad TBDR optimization, recommends full WebGL compositing (Phase 2)
- `Claude/Research/2026-02-23-webgl-tile-rendering-system.md` — Original architecture research, identified three WebGL-in-tiles blockers
- `Claude/Research/2026-02-22-webgl-2d-rendering-for-handwriting.md` — WebGL 2D rendering feasibility study
- `Claude/Plans/2026-02-23-webgl-phase3-polish.md` — Known issues: context loss, unused FBO allocation, GLState pollution, compositor allocations
- `Claude/Research/2026-02-23-webgl-drawing-app-architectures.md` — External research on production app architectures (written this session)
