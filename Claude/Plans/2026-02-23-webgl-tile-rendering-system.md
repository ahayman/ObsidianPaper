# Plan: WebGL Tile Rendering System

## Context

When the user selects "webgl" as the rendering engine, tiles still render via Canvas2D because:
1. `WebGL2Engine.setCanvas()` is a no-op — WebGL contexts are bound to their creation canvas
2. `TileEntry.canvas` is `OffscreenCanvas` which can't have a WebGL context
3. Workers can't access the GPU

The existing `renderStrokeToEngine()`, `renderDeskFillEngine()`, `renderPageBackgroundEngine()`, and the entire `renderTileEngine()` flow already work with any `RenderEngine`. The only missing piece is getting a `WebGL2Engine` into the tile rendering path.

**Solution**: A dedicated `WebGLTileEngine` that owns a single hidden `WebGL2Engine`, renders tiles into FBOs, then transfers pixels to the tile's `OffscreenCanvas` via synchronous `drawImage`. Everything downstream (TileCache, TileCompositor, WorkerTileScheduler) is unchanged.

This approach is validated by production libraries (virtual-webgl, OpenLayers, Three.js multi-view) that use the same FBO → `drawImage(webglCanvas)` pattern. See `Claude/Research/2026-02-23-webgl-tile-compositing-patterns.md` for full research.

## Architecture

```
User selects "webgl":
  ├── Workers → Canvas2D → ImageBitmap → TileEntry.ctx     (unchanged)
  └── Main thread → TileRenderer.renderTile()
        └── WebGLTileEngine.renderTile()
              ├── WebGL2Engine renders into FBO
              ├── drawOffscreen(fbo) → default framebuffer
              ├── invalidateFramebuffer(STENCIL) — iPad TBDR optimization
              └── tile.ctx.drawImage(hiddenCanvas) → TileEntry (synchronous, same execution block)
```

**Transfer strategy**: Render into FBO → `engine.drawOffscreen()` blits FBO to the default framebuffer (Y-flip handled by existing flipped tex coords) → `tile.ctx.drawImage(hiddenCanvas, ...)` copies to the OffscreenCanvas. No `preserveDrawingBuffer` needed since render + drawImage happen synchronously before yielding to the event loop (per WebGL spec, the drawing buffer remains valid within the same synchronous block).

## Steps

### Step 1: Add accessor methods to WebGL2Engine

**File**: `src/canvas/engine/WebGL2Engine.ts`

- Add `getCanvas(): HTMLCanvasElement` getter (needed by WebGLTileEngine for `drawImage` transfer)
- Add `createGrainTexture(source: ImageSource): TextureHandle` — calls `uploadGrainTexture()` from GLTextures.ts (needs REPEAT wrapping, vs CLAMP_TO_EDGE in `createTexture()`)
- Add `isValid(): boolean` getter (exposes existing `this.valid` field for context loss checking)
- Add `invalidateFramebuffer()` method — calls `gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.STENCIL_ATTACHMENT])` to optimize iPad's TBDR pipeline (avoids writing stencil buffer back to VRAM after tile render)

~25 lines added. No behavioral change to existing code.

### Step 2: Create WebGLTileEngine

**New file**: `src/canvas/tiles/WebGLTileEngine.ts` (~250 lines)

Class that encapsulates a dedicated WebGL2Engine for tile rendering:

**Constructor**:
- Creates hidden `document.createElement("canvas")` at `config.maxTilePhysical` size (2048×2048). Not appended to DOM.
- Creates `WebGL2Engine(hiddenCanvas)` — default `preserveDrawingBuffer: false` is fine since we never yield between render and drawImage
- Sets up context loss listeners

**`renderTile(tile, doc, pageLayout, spatialIndex, isDarkMode)`**:
- Bail early if `!valid` (context loss — TileRenderer falls through to Canvas2D)
- Gets/resizes reusable FBO via `engine.getOffscreen("tile", tilePhysical, tilePhysical)`
- `engine.beginOffscreen(fbo)` → renders background + strokes (same logic as `TileRenderer.renderTileEngine()`) → `engine.endOffscreen()`
- `engine.invalidateFramebuffer()` — discard stencil (iPad TBDR optimization)
- Calls `transferFBOToTile()` to synchronously blit to tile canvas

**`transferFBOToTile(fbo, tile, tilePhysical)`** — all synchronous, same execution block:
- `engine.resize(tilePhysical, tilePhysical)` — adjusts viewport/projection to tile size
- `engine.drawOffscreen(fbo, 0, 0, tilePhysical, tilePhysical)` — blits FBO to default framebuffer (handles Y-flip via flipped tex coords in drawOffscreen)
- `tile.ctx.drawImage(hiddenCanvas, 0, 0, tilePhysical, tilePhysical, 0, 0, tilePhysical, tilePhysical)` — GPU→GPU transfer on iPad (unified memory = cache coherency sync, not a data copy)

**Grain/stamp management** (persisted across tiles — key WebGL advantage):
- `engineGrainTexture: TextureHandle` created via `engine.createGrainTexture()` from GrainTextureGenerator's ImageData (needs temp canvas for ImageData → ImageSource conversion)
- `stampTextureCache: Map<string, TextureHandle>` keyed by `stamp-{grainValue}-{color}` / `ink-{presetId}-{color}`
- Textures persist for the engine's lifetime, re-created only on context restore

**Context loss handling**:
- `webglcontextlost`: `e.preventDefault()`, sets `valid = false`, clears stamp/grain texture references (GPU objects auto-destroyed)
- `webglcontextrestored`: sets `valid = true`, re-creates grain texture; stamps re-created lazily on demand
- When `renderTile()` sees `!valid`, it returns immediately — TileRenderer falls through to Canvas2D `renderTileEngine()`

**Config forwarding**: `setGrainGenerator()`, `setGrainStrength()`, `setPipeline()`, `setStampManager()`, `setInkStampManager()`

**Utility**: Duplicate `bboxOverlaps()` locally (it's 3 lines, not worth extracting to a shared module).

### Step 3: Wire WebGLTileEngine into TileRenderer

**File**: `src/canvas/tiles/TileRenderer.ts`

- Add `private webglEngine: WebGLTileEngine | null = null` field
- In constructor: if `useEngine`, try `new WebGLTileEngine(grid, config, pathCache)` with try/catch fallback
- Modify `renderTile()` to have three tiers:
  ```
  if (webglEngine?.isValid()) → webglEngine.renderTile()      // WebGL GPU path
  else if (useEngine) → renderTileEngine()                     // Canvas2DEngine path
  else → existing raw Canvas2D path                            // Direct ctx path
  ```
- Forward all config setters to `webglEngine` (alongside existing forwarding to internal state)
- Forward `destroy()` to `webglEngine`

~30 lines changed/added.

### Step 4: No changes needed

These files require **no modifications**:
- `TileCache.ts` — still allocates `OffscreenCanvas` + 2D ctx
- `TileCompositor.ts` — still `ctx.drawImage(entry.canvas, ...)`
- `TileGrid.ts` / `TileTypes.ts` — pure data/math
- `WorkerTileScheduler.ts` / `TileRenderScheduler.ts` — scheduling unchanged
- `Renderer.ts` — already passes `useEngine = this.engineType !== "canvas2d"`
- `StrokeRenderCore.ts` / `BackgroundRenderer.ts` — engine functions already work with any RenderEngine

### Step 5: Build, test, deploy

- `yarn build && yarn test && yarn build:copy`

## iPad-Specific Optimizations

Based on research into Apple's TBDR GPU architecture:

1. **`invalidateFramebuffer(STENCIL)`** after each tile render — tells the TBDR pipeline it doesn't need to write stencil back from tile memory to VRAM. The stencil is used for fillPath's INVERT trick and clipping but is not needed after the tile is complete.

2. **Avoid `getParameter`/`getError` calls** — these force Metal command queue sync (~1ms+). The existing `GLState` wrapper that shadows GL state is already the right approach.

3. **No `preserveDrawingBuffer`** — on TBDR GPUs, preserving forces an explicit store-back from hardware tile memory to VRAM. Since our render + drawImage are synchronous, we avoid this cost entirely.

4. **`drawImage(webglCanvas)`** on iPad unified memory — the "transfer" is a cache coherency sync, not a data copy. Expected ~0.5-1ms per 512×512 tile.

## Notes

**Shadows**: `WebGL2Engine.setShadow()` is a no-op, so page drop-shadows won't render on the WebGL path. Acceptable for initial implementation (shadow is subtle: 2px offset, 8px blur, 20% black). Can add a blurred-rect approximation later.

**Memory**: Hidden WebGL canvas (2048×2048 × 4 = 16MB) + FBO (16MB) = ~32MB fixed overhead. Well within the 200MB tile cache budget.

**WebGL context limit**: Active stroke canvas uses one context, tile engine uses one = 2 total. Well within browser limits (8-16).

**Performance**: Stamp-heavy tiles should see ~5-10x speedup from instanced rendering (1 GPU draw call vs 1000 Canvas2D `drawImage` calls). The FBO→tile transfer adds ~0.5-1ms per tile but is offset by much faster stroke rendering.

## Future Evolution

This is Phase 1 of a potential three-phase evolution:

1. **Phase 1 (this plan)**: FBO → `drawImage` → OffscreenCanvas tile cache → Canvas2D compositor. Minimal changes, validates WebGL rendering.
2. **Phase 2**: FBO → WebGL texture tile cache → WebGL compositor. Eliminates `drawImage` transfer entirely. Worker tiles uploaded via `texImage2D`. Requires reworking TileCompositor.
3. **Phase 3**: WebGPU rendering + compositing. Direct Metal mapping, compute shaders for stamp generation.

## Verification

1. `yarn build` — compiles without errors
2. `yarn test` — existing tests pass (Canvas2D paths unchanged)
3. `yarn build:copy` — deploy to Obsidian vault
4. In Obsidian on iPad: toggle WebGL engine in settings, verify tiles render correctly with all pen types
5. Test with stamp-heavy strokes (ink pen, pencil) — should feel snappier on tile re-renders
6. Test zoom in/out — tiles should re-render at correct resolution bands
7. Test pan gesture — compositing from tile cache should work normally
8. Test context loss (close/reopen app, switch tabs) — should fall back to Canvas2D gracefully and recover
