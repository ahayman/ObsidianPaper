# WebGL Tile Rendering System — Architecture Research

## Goal

Add a WebGL-based tile rendering path alongside the existing Canvas2D system, so the user can select either engine. This is an **addition**, not a rewrite — both paths must coexist cleanly.

## Current Architecture

### Tile Rendering Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│ TiledStaticLayer (Renderer.ts:1289)                                 │
│   Orchestrates: TileGrid, TileCache, TileRenderer, TileCompositor   │
│   Has two schedulers:                                                │
│     • WorkerTileScheduler → workers render tiles → ImageBitmap back  │
│     • TileRenderScheduler → main-thread fallback                     │
├─────────────────────────────────────────────────────────────────────┤
│ TileCache (TileCache.ts)                                             │
│   • Stores TileEntry objects: OffscreenCanvas + ctx + metadata       │
│   • allocate() creates OffscreenCanvas + gets "2d" context           │
│   • LRU eviction, protected set for visible tiles                    │
├─────────────────────────────────────────────────────────────────────┤
│ TileRenderer (TileRenderer.ts)                                       │
│   • renderTile(): raw Canvas2D path (ctx.fill, etc.)                 │
│   • renderTileEngine(): Canvas2DEngine via setCanvas() reuse         │
│   • Both paths: background → strokes, with grain/stamp contexts      │
├─────────────────────────────────────────────────────────────────────┤
│ TileCompositor (TileCompositor.ts)                                   │
│   • ctx.drawImage(entry.canvas, ...) per visible tile                │
│   • Draws onto HTMLCanvasElement (static layer)                      │
├─────────────────────────────────────────────────────────────────────┤
│ WorkerTileScheduler (WorkerTileScheduler.ts)                         │
│   • Dispatches render jobs to worker pool (2-4 workers)              │
│   • Workers use renderStrokeToContext() (Canvas2D only)              │
│   • Results come back as ImageBitmap                                 │
│   • Main thread draws bitmap onto TileEntry's OffscreenCanvas        │
└─────────────────────────────────────────────────────────────────────┘
```

### Engine Selection (Current)

- `RenderEngineType = "canvas2d" | "webgl"` — user-selectable in settings
- `Renderer` creates `activeEngine` via `createRenderEngine()` for active/prediction strokes
- `TiledStaticLayer` receives `useEngine` flag (line 1322), passes to `TileRenderer`
- **But TileRenderer always creates `Canvas2DEngine`** (line 210), even when `useEngine = true`
- The `renderTileEngine()` path exists and works — it just never gets a WebGL2Engine

### Why WebGL Can't Drop Into the Current Architecture

Three blockers:

1. **setCanvas() is a no-op for WebGL** — `WebGL2Engine.setCanvas()` does nothing because a WebGL2 context is bound to the canvas it was created with. The current pattern of reusing one engine across many tile canvases doesn't work.

2. **TileEntry uses OffscreenCanvas** — `TileCache.allocate()` creates `new OffscreenCanvas(...)` and calls `.getContext("2d")`. WebGL2 requires `HTMLCanvasElement`, not OffscreenCanvas.

3. **Workers can't use WebGL** — Web Workers have no GPU access. The `WorkerTileScheduler` path is permanently Canvas2D.

## Proposed Architecture: FBO-Based WebGL Tile Rendering

### Core Idea

Instead of rendering into per-tile canvases, render tiles into **FBO regions** of a single WebGL2Engine, then **read the pixels back** to the tile cache. The WebGL engine acts as a rendering accelerator; the tile cache and compositor remain unchanged.

```
                     ┌──────────────────────────────┐
                     │       WebGL2Engine            │
                     │  (single instance, main thd)  │
                     │                               │
                     │   ┌───────────────────────┐   │
                     │   │  Tile FBO              │   │
  TileRenderer ──────┼──►│  (tile-sized)          │   │
  renderTileWebGL()  │   │  render strokes here   │   │
                     │   └───────┬───────────────┘   │
                     │           │ readPixels or      │
                     │           │ texImage2D copy    │
                     └───────────┼───────────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │  TileEntry            │
                     │  (OffscreenCanvas)    │
                     │  tile cache as-is     │
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │  TileCompositor       │
                     │  (unchanged)          │
                     └───────────────────────┘
```

### Why FBO → readback?

- TileCompositor and TileCache don't need to change
- Workers continue to work for Canvas2D mode
- The tile cache remains the source of truth for compositing
- Easy fallback: just switch TileRenderer's engine back to Canvas2D

### Readback Cost

The main concern with `gl.readPixels()` is GPU→CPU sync. But:
- Tiles are relatively small (128–2048px per side, typically 256-512 at normal zoom)
- Tiles are rendered asynchronously (not during gesture) — stalls are tolerable
- Alternative: use `texImage2D(ctx.canvas)` to blit WebGL canvas content into OffscreenCanvas
- Can batch: render multiple tiles to FBO sequentially, read back once per batch
- iPad GPU→CPU readback for a 512×512 RGBA tile ≈ 0.3–1ms

### Avoiding readPixels — Canvas Blit Alternative

Actually, we can avoid `readPixels` entirely:

1. WebGL2Engine renders a tile into the tile FBO
2. After rendering, blit the FBO to the screen canvas (WebGL's default framebuffer) using `drawOffscreen()`
3. Use `ctx.drawImage(webglCanvas, ...)` to copy the WebGL canvas content to the OffscreenCanvas tile

This piggybacks on the browser's internal GPU→GPU texture path for `drawImage` between canvases. The OffscreenCanvas 2D context can accept an HTMLCanvasElement as a drawImage source.

```typescript
// Pseudocode
engine.beginOffscreen(tileFBO);
// ... render background + strokes ...
engine.endOffscreen();

// Blit FBO → WebGL's default framebuffer at (0,0)
engine.drawOffscreen(tileFBO, 0, 0, tileSize, tileSize);

// Copy WebGL canvas → OffscreenCanvas (GPU→GPU on most browsers)
tileEntry.ctx.drawImage(engine.canvas, 0, 0, tileSize, tileSize, 0, 0, tileSize, tileSize);
```

## Detailed Design

### 1. WebGLTileRenderer (New Class)

A WebGL-specific tile rendering strategy. Owns a single `WebGL2Engine` instance and a reusable FBO.

```typescript
class WebGLTileRenderer {
  private engine: WebGL2Engine;
  private tileFBO: OffscreenTarget;
  private fboSize: number = 0;
  // Grain + stamp texture handles (persisted across tiles)
  private grainTexture: TextureHandle | null = null;
  private stampTextureCache: Map<string, TextureHandle>;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new WebGL2Engine(canvas);
    this.stampTextureCache = new Map();
  }

  renderTile(
    tile: TileEntry,
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
  ): void {
    const tilePhysical = tile.canvas.width;

    // Ensure FBO is the right size
    this.ensureFBO(tilePhysical);

    // Render into FBO
    this.engine.beginOffscreen(this.tileFBO);
    this.engine.setTransform(1, 0, 0, 1, 0, 0);
    this.engine.clear();

    // Set up world → tile transform
    const scale = tilePhysical / config.tileWorldSize;
    const tx = -tile.worldBounds[0] * scale;
    const ty = -tile.worldBounds[1] * scale;
    this.engine.setTransform(scale, 0, 0, scale, tx, ty);

    // Background + strokes (same as renderTileEngine)
    renderDeskFillEngine(this.engine, tile.worldBounds, isDarkMode);
    // ... page backgrounds, strokes via renderStrokeToEngine ...

    this.engine.endOffscreen();

    // Transfer: FBO → default framebuffer → OffscreenCanvas
    this.transferToTile(tile, tilePhysical);
  }

  private transferToTile(tile: TileEntry, size: number): void {
    // Blit FBO to default framebuffer
    this.engine.clear();
    this.engine.setTransform(1, 0, 0, 1, 0, 0);
    this.engine.drawOffscreen(this.tileFBO, 0, 0, size, size);

    // Copy WebGL canvas → OffscreenCanvas via drawImage
    tile.ctx.clearRect(0, 0, size, size);
    tile.ctx.drawImage(this.engine.canvas, 0, 0, size, size, 0, 0, size, size);
  }
}
```

### 2. TileRenderer Changes

Instead of always creating `Canvas2DEngine`, support a `WebGLTileRenderer` as an alternative:

```typescript
class TileRenderer {
  private useEngine: boolean;
  private engineType: RenderEngineType;

  // Canvas2D path (existing)
  private canvas2dEngine: Canvas2DEngine | null = null;

  // WebGL path (new)
  private webglTileRenderer: WebGLTileRenderer | null = null;

  renderTile(tile, doc, pageLayout, spatialIndex, isDarkMode): void {
    if (this.engineType === "webgl") {
      this.renderTileWebGL(tile, doc, pageLayout, spatialIndex, isDarkMode);
    } else if (this.useEngine) {
      this.renderTileEngine(tile, doc, pageLayout, spatialIndex, isDarkMode);
    } else {
      // Raw Canvas2D path (existing)
      ...
    }
  }

  private renderTileWebGL(...): void {
    if (!this.webglTileRenderer) {
      // Need an HTMLCanvasElement for WebGL
      this.webglTileRenderer = new WebGLTileRenderer(this.createWebGLCanvas());
    }
    this.webglTileRenderer.renderTile(tile, doc, pageLayout, spatialIndex, isDarkMode);
  }
}
```

### 3. WebGL Canvas Management

The WebGL engine needs an HTMLCanvasElement. Options:

- **Hidden DOM canvas**: Create an offscreen `document.createElement("canvas")`, set its size to the largest expected tile. Don't append to DOM. WebGL works on detached canvases.
- **Size management**: Resize to match current tile physical size. Since tiles vary (128–2048px), either resize per tile or use the max size and blit a sub-region.

**Recommendation**: Use max tile size (2048×2048) for the WebGL canvas. Render into an FBO at the actual tile size. This avoids constant resizing.

### 4. Worker + WebGL Coexistence

Workers remain Canvas2D — no changes needed. The question is scheduling:

**Option A: WebGL replaces main-thread fallback only**
- Workers still do async rendering (Canvas2D)
- WebGL used only for sync/priority tiles on main thread
- Simplest change, smallest benefit

**Option B: WebGL for all main-thread rendering, workers as supplementary**
- Main thread does sync WebGL rendering for visible tiles
- Workers handle overscan/background tiles (still Canvas2D)
- Best of both worlds: GPU speed for visible, parallelism for prefetch

**Option C: WebGL replaces workers entirely**
- All tile rendering on main thread via WebGL
- Relies on GPU being fast enough to offset losing parallelism
- Risk: GPU stalls block the main thread

**Recommendation**: Option B. Keep workers for background prefetch, use WebGL for all synchronous main-thread tile rendering (which is the bottleneck — it blocks before compositing).

### 5. TileCompositor — No Changes Needed

The compositor only calls `ctx.drawImage(entry.canvas, ...)`. Since `entry.canvas` is still an OffscreenCanvas with valid 2D content (copied from WebGL), the compositor works unchanged.

### 6. Texture Lifecycle

WebGL textures (grain, stamps) persist across tile renders:
- Created once when the engine initializes
- Shared across all tile render calls
- Destroyed on engine destroy

This is much more efficient than Canvas2D, where stamp CanvasPattern/drawImage calls recreate state per stroke.

### 7. TileEntry Type — No Changes Needed

`TileEntry` stays as `{ canvas: OffscreenCanvas, ctx: ... }`. The WebGL path writes into it via `ctx.drawImage()`. This preserves:
- TileCache eviction/allocation logic
- TileCompositor compositing
- WorkerTileScheduler result handling

## Architecture Summary

```
User selects "canvas2d":
  ├── Workers → renderStrokeToContext() → ImageBitmap → TileEntry.ctx
  └── Main thread fallback → TileRenderer.renderTile() → Canvas2D

User selects "webgl":
  ├── Workers → renderStrokeToContext() → ImageBitmap → TileEntry.ctx  (unchanged)
  └── Main thread → WebGLTileRenderer.renderTile()
        ├── WebGL2Engine renders into FBO
        ├── Blit FBO → WebGL canvas
        └── drawImage(webglCanvas) → TileEntry.ctx
```

## Key Files to Create/Modify

| File | Change |
|------|--------|
| `src/canvas/tiles/WebGLTileRenderer.ts` | **NEW** — WebGL tile rendering strategy |
| `src/canvas/tiles/TileRenderer.ts` | Add WebGL path, accept engine type |
| `src/canvas/tiles/TileTypes.ts` | No changes needed |
| `src/canvas/tiles/TileCache.ts` | No changes needed |
| `src/canvas/tiles/TileCompositor.ts` | No changes needed |
| `src/canvas/tiles/WorkerTileScheduler.ts` | No changes needed |
| `src/canvas/Renderer.ts` | Pass engine type through to TiledStaticLayer/TileRenderer |
| `src/canvas/engine/WebGL2Engine.ts` | Possibly expose canvas property for blit |

## Open Questions

1. **FBO vs direct rendering**: Should we render directly to the WebGL default framebuffer (simpler) or use an FBO (more flexible)? FBO allows rendering at tile size regardless of canvas size.

2. **Tile size mismatch**: If tiles vary between 128–2048px, should we resize the WebGL canvas per tile or use a fixed max-size canvas with viewport/FBO? FBO approach is cleaner.

3. **preserveDrawingBuffer**: WebGL2Engine currently uses `preserveDrawingBuffer: false`. For the blit-to-OffscreenCanvas approach, we need the content to survive between `endOffscreen()` and `ctx.drawImage()`. Options:
   - Set `preserveDrawingBuffer: true` on the tile-rendering WebGL canvas (not the active stroke one)
   - Or blit FBO → default framebuffer → drawImage in one synchronous block (should work without preserveDrawingBuffer since no buffer swap happens)

4. **Context loss**: WebGL contexts can be lost. The tile renderer should handle this gracefully — fall back to Canvas2D and re-render affected tiles.

5. **Memory**: An extra 2048×2048 WebGL canvas (16MB VRAM) is the overhead. Negligible compared to the existing tile cache budget (200MB).

## Performance Expectations

| Operation | Canvas2D | WebGL |
|-----------|----------|-------|
| 1000-stamp stroke | ~5-10ms (1000 drawImage calls) | ~0.5-1ms (1 instanced draw) |
| Grain application | ~1ms (pattern fill) | ~0.1ms (shader) |
| Background lines | ~0.5ms (lineTo calls) | ~0.1ms (instanced) |
| Path fill | ~0.5ms (Path2D.fill) | ~0.3ms (stencil invert) |
| FBO→tile transfer | N/A | ~0.5-1ms (drawImage blit) |
| **Total per tile** | **~7-12ms** | **~1.5-3ms** |

Stamp-heavy tiles (ink pen, pencil) see the biggest improvement — 5-10x faster per tile.
