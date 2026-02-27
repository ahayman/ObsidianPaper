# Rendering Pipeline Reference

This document covers the complete rendering system: pen types, pipelines (Basic/Advanced), engines (Canvas2D/WebGL), in-progress stroke rendering, and the tile-based static layer.

**Key source files:**

| File | Role |
|------|------|
| `src/types.ts` | `PenType`, `PenStyle`, `StrokePoint`, `RenderPipeline`, `RenderEngineType` |
| `src/stroke/PenConfigs.ts` | Per-pen configuration (`PEN_CONFIGS`) |
| `src/stroke/OutlineGenerator.ts` | `perfect-freehand` wrapper + `Path2D`/`Float32Array` output + `StrokePathCache` |
| `src/stroke/ItalicOutlineGenerator.ts` | Fountain pen italic nib outline |
| `src/stroke/InkPooling.ts` | Ink pool detection + radial gradient rendering |
| `src/stamp/StampRenderer.ts` | Pencil particle scatter stamps |
| `src/stamp/InkStampRenderer.ts` | Fountain pen ink shading stamps |
| `src/stamp/InkPresets.ts` | Ink presets (Standard, Shading, Iron Gall, Flat Black) |
| `src/stamp/GrainMapping.ts` | Grain slider to texture strength mapping |
| `src/canvas/Renderer.ts` | Main `Renderer` class, active stroke rendering, 4-canvas stack |
| `src/canvas/StrokeRenderCore.ts` | Central stroke rendering dispatcher |
| `src/canvas/GrainTextureGenerator.ts` | 256x256 tileable simplex noise grain texture |
| `src/canvas/engine/RenderEngine.ts` | Abstract engine interface |
| `src/canvas/engine/Canvas2DEngine.ts` | Canvas 2D engine implementation |
| `src/canvas/engine/WebGL2Engine.ts` | WebGL2 engine (stencil winding, instanced rendering, FBOs) |
| `src/canvas/engine/shaders.ts` | All GLSL ES 300 shaders |
| `src/canvas/engine/EngineFactory.ts` | Engine creation with WebGL fallback |
| `src/canvas/tiles/` | Tile grid, cache, renderer, compositor (Canvas2D + WebGL) |
| `src/input/InputManager.ts` | Pointer event capture, coalesced/predicted events |
| `src/settings/DeviceSettings.ts` | Per-device pipeline/engine settings |

---

## Table of Contents

1. [Configuration Types](#1-configuration-types)
2. [Pen Types](#2-pen-types)
3. [Outline Generation](#3-outline-generation)
4. [Rendering Pipelines: Basic vs Advanced](#4-rendering-pipelines-basic-vs-advanced)
5. [Rendering Engines: Canvas2D vs WebGL](#5-rendering-engines-canvas2d-vs-webgl)
6. [Canvas Layer Architecture](#6-canvas-layer-architecture)
7. [In-Progress Stroke Rendering](#7-in-progress-stroke-rendering)
8. [Stroke Finalization and Baking](#8-stroke-finalization-and-baking)
9. [Tile-Based Rendering](#9-tile-based-rendering)
10. [Complete Rendering Matrix](#10-complete-rendering-matrix)
11. [Flowcharts](#11-flowcharts)

---

## 1. Configuration Types

```
PenType       = "ballpoint" | "felt-tip" | "pencil" | "fountain" | "highlighter"
RenderPipeline = "basic" | "advanced"
RenderEngineType = "canvas2d" | "webgl"
```

**StrokePoint** captures per-sample input: `x, y, pressure, tiltX, tiltY, twist, timestamp`.

**PenStyle** carries all stroke parameters: pen type, color, width, opacity, smoothing, pressureCurve, tiltSensitivity, nibAngle, nibThickness, nibPressure, grain, inkPreset, useBarrelRotation.

**PenConfig** (from `PEN_CONFIGS`) defines rendering behavior per pen type: pressure/width ranges, thinning, tilt config, grain settings, stamp settings, ink stamp settings, base opacity, and highlighter mode flag.

Device settings (pipeline + engine) are stored per-device in localStorage via `DeviceSettings`. Default: `pipeline = "basic"`, `engine = "canvas2d"`.

---

## 2. Pen Types

### Ballpoint
- Narrow pressure-to-width range `[0.85, 1.15]` -- nearly uniform thickness
- No pressure-to-opacity mapping
- Low thinning (0.15)
- No tilt, grain, or stamps
- Rendering: filled outline from `perfect-freehand`

### Felt-Tip
- Wider pressure range `[0.7, 1.3]`
- More thinning (0.3)
- Tilt-sensitive: cross-axis multiplier 2.0, along-axis 1.3 (tilting widens the stroke)
- No grain or stamps
- Rendering: filled outline from `perfect-freehand`

### Pencil
- Narrow width range `[0.85, 1.15]` -- pressure affects *density*, not size
- Pressure-to-opacity mapping `[0.15, 1.0]` -- light touch = sparser particles
- Grain: enabled, strength 0.5
- Stamps: textureSize 48, spacing 0.5, rotationJitter PI/12
- Tilt: cross-axis 3.5, opacity reduction 0.4
- **Basic pipeline**: filled outline + grain overlay
- **Advanced pipeline**: particle scatter stamps (many tiny circles within stroke disk)

### Fountain Pen
- Pressure range `[0.7, 1.0]`, high thinning (0.6)
- Italic nib: nibAngle (PI/6 = 30deg), nibThickness (0.25 = 4:1 aspect ratio)
- Supports barrel rotation (Apple Pencil Pro twist for dynamic nib angle)
- Ink stamps: textureSize 64, spacing 0.15, stampSizeFraction 2.0
- Four ink presets: Standard (shading 0.6), Shading (1.0), Iron Gall (0.65), Flat Black (0.2)
- **Basic pipeline**: italic outline fill + ink pooling at slow/corner points
- **Advanced pipeline**: ink-shaded stamps clipped to italic outline + velocity-dependent opacity

### Highlighter
- No thinning, high smoothing/streamline (0.8/0.7)
- Wide base width (24), low base opacity (0.3)
- `globalCompositeOperation = "multiply"` instead of source-over
- No grain, stamps, or tilt
- Rendering: filled outline with multiply blend

---

## 3. Outline Generation

### Standard Pens (ballpoint, felt-tip, pencil, highlighter)

**`OutlineGenerator`** wraps the `perfect-freehand` library:

1. `generateOutline()` calls `getStroke()` with pen-specific parameters (thinning, smoothing, streamline, taper, pressure mapping)
2. Returns `number[][]` polygon points
3. `outlineToPath2D()` converts to `Path2D` using midpoint quadratic Bezier curves for smooth edges
4. `outlineToFloat32Array()` converts to `Float32Array` vertices for WebGL (same Bezier interpolation, 4 subdivisions per span)

### Fountain Pen (italic nib)

**`ItalicOutlineGenerator`** produces left/right side arrays:

1. `generateItalicOutlineSides()` computes stroke direction vs nib angle cross-product to determine projected width
2. Applies pressure via gamma curve, EMA smoothing, taper at start/end
3. Multi-pass post-processing: RDP de-jitter, perpendicular consistency, perpendicular smoothing, width dip elimination, pinch expansion
4. `italicSidesToPath2D()` creates two-triangles-per-segment (avoids bowtie self-intersection)
5. `italicSidesToFloat32Array()` emits `gl.TRIANGLES` format (6 vertices per segment)

### Stroke Path Cache

`StrokePathCache` lazily caches both `Path2D` (Canvas2D) and `Float32Array` (WebGL) representations per stroke+LOD. Stores raw outline data and produces the engine-specific format on demand.

---

## 4. Rendering Pipelines: Basic vs Advanced

The pipeline setting controls which visual enhancements are active. All dispatch happens in `StrokeRenderCore` (`renderStrokeToContext` / `renderStrokeToEngine`).

### Basic Pipeline

The default, fastest path. All pen types render as simple filled outlines:

| Pen | Behavior |
|-----|----------|
| Ballpoint | Fill `perfect-freehand` outline |
| Felt-tip | Fill `perfect-freehand` outline |
| Pencil | Fill `perfect-freehand` outline (no grain, no stamps) |
| Fountain | Fill italic outline (no ink shading, no ink pooling) |
| Highlighter | Fill outline with multiply blend |

### Advanced Pipeline

Adds per-pen visual enhancements at LOD 0 only (simplified at higher LODs):

**Pencil -- stamp-based particles:**
- `computeAllStamps()` walks the path, emitting many tiny circles per step
- Particle size = `max(0.6, width * 0.08)`, independent of stroke width
- Center-biased polar scatter distribution within the stroke disk
- Per-particle alpha from deterministic 2D spatial hash (grain texture)
- Pressure modulates alpha (sparse particles at light touch)
- Tilt creates elliptical scatter (wider perpendicular to tilt direction)
- Canvas2D: `arc()` calls; WebGL: instanced SDF discs

**Pencil -- grain texture overlay:**
- `GrainTextureGenerator` produces a 256x256 tileable simplex noise texture (4D torus mapping)
- Applied via `destination-out` compositing: erases alpha through the stroke to simulate paper grain
- Grain slider 0-1: 0 = coarse (heavy texture), 1 = fine (smooth)
- `grainToTextureStrength()` maps value to multiplier (1.6 at 0, 0.2 at 1)

**Fountain pen -- ink shading stamps:**
- `computeAllInkStamps()` generates stamp positions along the stroke
- Velocity-dependent opacity: slow = dark (more ink deposited), fast = light
- ~7 stamps overlap at centerline, ~2 at edges (physically accurate center-dark)
- Three-step render: (1) deposit stamps to offscreen, (2) mask to outline via `destination-in`, (3) composite back
- Ink presets control shading intensity (0 = flat fill, 1.0 = maximum variation)
- Corner fill stamps at sharp direction changes and stroke endpoints

**Fountain pen -- ink pooling:**
- Active in advanced pipeline for non-italic nibs
- `detectInkPools()` finds slow velocity + sharp curvature points
- `renderInkPools()` draws radial gradients from color to transparent

### Pipeline Dispatch Logic

```
if pipeline === "advanced" AND LOD === 0:
    if penConfig.inkStamp exists -> ink shading path
    if penConfig.stamp exists   -> stamp particle path
    if penConfig.grain.enabled  -> grain overlay path
    (ink pooling as post-pass for fountain pen)
else:
    simple outline fill (all pens)
```

### Compositing Operations

| Operation | Where | Purpose |
|-----------|-------|---------|
| `source-over` | Default stroke fill, stamp deposit | Standard alpha blending |
| `destination-out` | Grain overlay | Erases alpha through stroke to create paper texture |
| `destination-in` | Ink shading mask | Clips deposited stamps to stroke outline shape |
| `multiply` | Highlighter | Transparent highlight effect that darkens underlying content |

The `destination-out` and `destination-in` operations require **offscreen isolation**: the stroke is rendered to a temporary canvas/FBO, the compositing effect is applied there, then the result is composited back to the main canvas. Without isolation, these operations would affect all previously-drawn strokes.

---

## 5. Rendering Engines: Canvas2D vs WebGL

Both engines implement the `RenderEngine` interface: transform stack, fill/stroke, clipping, offscreen rendering, masking, stamps, grain, background drawing.

### Canvas2DEngine

**File:** `src/canvas/engine/Canvas2DEngine.ts`

- Wraps `CanvasRenderingContext2D`
- `fillPath()`: converts `Float32Array` vertices to `Path2D` via midpoint quadratic Bezier, then `ctx.fill()`
- `fillTriangles()`: converts to `Path2D` with per-triangle sub-paths (normalized winding)
- `drawStamps()`: loops `drawImage()` per stamp
- `drawStampDiscs()`: loops `arc() + fill()` per stamp
- `applyGrain()`: creates repeating `CanvasPattern`, fills with `destination-out`
- `maskToPath()`: `destination-in` compositing
- Offscreen targets: `OffscreenCanvas` or `HTMLCanvasElement` with context stack
- `setCanvas()`: switches target canvas (reused across tiles)

### WebGL2Engine

**File:** `src/canvas/engine/WebGL2Engine.ts`

7 shader programs: solid, texture, stamp, stampDisc, grain, circle, line. All GLSL ES 300, defined in `src/canvas/engine/shaders.ts`.

| Operation | WebGL Implementation |
|-----------|---------------------|
| `fillPath()` | Two-pass stencil nonzero winding (INCR_WRAP/DECR_WRAP via TRIANGLE_FAN), then fullscreen quad where stencil != 0 |
| `fillTriangles()` | Two-pass stencil REPLACE (avoids 5-bit wrapping), then fullscreen quad |
| `maskToPath()` / `maskToTriangles()` | Three-pass: (1) stencil mark, (2) clear exterior via destination-out, (3) clear stencil |
| `drawStamps()` | Instanced rendering (`drawElementsInstanced`) with per-instance `[x, y, size, opacity]` |
| `drawStampDiscs()` | Instanced with SDF circle shader (hard-circle discard) |
| `applyGrain()` | Fullscreen grain shader with destination-out blend, tiled UV with scale/offset |
| `clipPath()` | Stencil INVERT trick, bits 5-7 for up to 3 nested clips |
| `clipRect()` | GL scissor test (fast path) |

**Stencil bit layout:** bits 0-4 for winding count (fillPath/fillTriangles), bits 5-7 for clip levels.

**Offscreen targets:** FBOs with color texture + stencil renderbuffer, MSAA 4x for anti-aliased stencil edges.

**Context loss:** Handles `webglcontextlost`/`webglcontextrestored` events, recreates GPU resources on restore.

### Engine Factory

`createRenderEngine(type, canvas)`: attempts WebGL if requested, falls back to Canvas2D. WebGL requires `HTMLCanvasElement` (not `OffscreenCanvas`) and `MAX_TEXTURE_SIZE >= 2048`.

---

## 6. Canvas Layer Architecture

Four stacked HTML canvases (bottom to top):

```
+--------------------------------------------------+
|  4. Prediction Canvas (paper-prediction-canvas)   |  Viewport-sized
|     Predicted stroke extension at 50% opacity      |
+--------------------------------------------------+
|  3. Active Canvas (paper-active-canvas)            |  Viewport-sized
|     Currently-drawn stroke                         |
+--------------------------------------------------+
|  2. Static Canvas (paper-static-canvas)            |  Overscan-sized
|     All completed strokes (baked)                  |
|     [WebGL: replaced by webglStaticCanvas]         |
+--------------------------------------------------+
|  1. Background Canvas (paper-background-canvas)    |  Overscan-sized
|     Desk color, page backgrounds, ruled lines      |
+--------------------------------------------------+
```

In WebGL tiled mode, canvas 2 is replaced by `paper-webgl-static-canvas` (WebGL tile compositor output), and an additional `paper-overlay-canvas` sits on top for Canvas2D page icons.

---

## 7. In-Progress Stroke Rendering

### Touch Input Flow

```
PointerEvent (captured at document level)
    |
    v
InputManager.extractPoint()
    |- StrokePoint {x, y, pressure, tiltX, tiltY, twist, timestamp}
    |- Safari: altitudeAngle/azimuthAngle -> tiltX/tiltY conversion
    |
    +-- getCoalescedEvents()   -> high-frequency intermediate samples
    +-- getPredictedEvents()   -> estimated future positions
    |
    v
Callbacks: onStrokeStart, onStrokeMove(coalesced, predicted), onStrokeEnd
```

### Active Stroke Rendering

All active rendering is batched via `requestAnimationFrame`. `renderActiveStroke()` stores a closure in `pendingActiveRender`, executed on the next frame via `scheduleFrame()`.

**Three branches based on pen type and pipeline:**

#### Branch 1: Ink-shaded fountain pen (advanced pipeline)
```
Clear active canvas
    -> Apply DPR + camera transform
    -> Clip to page rect
    -> Quantize points (match encode/decode precision)
    -> Generate italic Path2D from live points
    -> If shading > 0 and valid screen region:
        -> Get/ensure offscreen canvas (sized to stroke bbox)
        -> Deposit ink stamps on offscreen (source-over)
        -> Mask to outline (destination-in)
        -> Composite offscreen back to active canvas
    -> Else: simple ctx.fill(path)
```

#### Branch 2: Stamp-based pencil (advanced pipeline)
```
Clear active canvas
    -> Apply DPR + camera transform
    -> Clip to page rect
    -> Quantize points (match encode/decode precision)
    -> computeAllStamps() -> StampParams[]
    -> drawStamps() as tiny circles
    Full redraw every frame (not incremental)
```

#### Branch 3: Default outline fill (all other cases)
```
Clear active canvas
    -> Apply DPR + camera transform
    -> Clip to page rect
    -> Generate Path2D from live points
    -> If highlighter: multiply blend with baseOpacity
    -> Else: fill with style.opacity
    -> If advanced + grain enabled:
        -> applyGrainToStroke() via destination-out
        -> Uses points[0] as grain anchor
```

### Prediction Rendering

Rendered on the separate prediction canvas immediately after active stroke:

- Combines last 3 real points + all predicted points for smooth continuity
- Fills at **50% of stroke opacity** (visual hint that it's speculative)
- **Skipped** for stamp-rendered pens (pencil in advanced mode) since the outline doesn't account for tilt widening
- No grain, stamps, or ink shading -- simple semi-transparent fill only

The prediction canvas is separate so predictions can be cleared/redrawn independently without redrawing the active stroke.

---

## 8. Stroke Finalization and Baking

When a stroke ends:

```
onStrokeEnd
    |
    v
clearActiveLayer()
    |- Clears active canvas
    |- Clears prediction canvas
    |- Resets stamp count + vertex cache
    |
    v
bakeStroke()
    |
    +-- [Non-tiled]: renderStrokeToContext() on static canvas
    |   Uses StrokeRenderCore directly
    |
    +-- [Tiled Canvas2D]: Invalidate affected tiles
    |   -> TileRenderer.renderTile() on dirty tiles
    |   -> TileCompositor composites to static canvas
    |
    +-- [Tiled WebGL]: Invalidate affected tiles
        -> WebGLTileEngine.renderTile() into FBO
        -> WebGLTileCompositor composites tile textures
```

The frame scheduler (`scheduleFrame()`) processes in order: finalizations, bakes, active render -- all within a single `requestAnimationFrame` callback.

---

## 9. Tile-Based Rendering

### Architecture Overview

```
TileGrid (pure math)
    |- worldToTile(), tileBounds(), getVisibleTiles(), getTilesForWorldBBox()
    |
TileCache / WebGLTileCache (LRU cache + dirty tracking)
    |- allocate(), get(), getStale(), markClean()
    |- invalidate(), invalidateStroke(), protect()
    |
TileRenderer / WebGLTileEngine (content rendering)
    |- renderTile(): background + strokes into tile canvas/FBO
    |
TileCompositor / WebGLTileCompositor (screen output)
    |- composite(): draw visible tiles to display
```

### Grid System

- Tiles cover `tileWorldSize x tileWorldSize` world units (default 128)
- Infinite grid extending into negative coordinates
- `getVisibleTiles()` expands by overscan, sorts by Manhattan distance from center (closest first)
- `getTilesForWorldBBox()` returns tiles overlapping a bounding box (used for invalidation)

### Zoom Bands

```
zoomBand = floor(log2(zoom) * 2)    // discrete bands at sqrt(2) intervals (~1.41x)
baseZoom = pow(2, band / 2)
tilePhysical = tileWorldSize * baseZoom * dpr * resolutionScale
                 clamped to [minTilePhysical, maxTilePhysical] (default [128, 2048])
```

Tiles are re-rendered at a new resolution when the zoom crosses a band boundary. Between bands, tiles are scaled by at most ~1.41x.

### Canvas2D Tile Path

**TileRenderer:**
1. Compute transform: `scale = tilePhysical / tileWorldSize`, offset by `-worldBounds`
2. Clear tile `OffscreenCanvas`
3. Render desk fill + page backgrounds (skipping non-overlapping pages)
4. Query `SpatialIndex` for strokes in tile bounds
5. Per page: clip to page rect, render strokes via `renderStrokeToContext()`
6. Record rendered stroke IDs on the tile entry

**TileCompositor:**
1. Work in physical pixel space (prevents seam artifacts)
2. Disable image smoothing
3. For each visible tile: `getStale()` from cache (shows old content rather than blank)
4. Compute destination rect with `Math.round()` integer rounding
5. `ctx.drawImage()` from tile canvas to screen

### WebGL Tile Path

**WebGLTileEngine:**
1. Reset GLState (raw GL calls in cache bypass engine state tracking)
2. Bind MSAA FBO (or regular FBO), set viewport
3. Same transform + clear + background + stroke rendering as Canvas2D path
4. `engine.invalidateFramebuffer()` to discard stencil (iPad TBDR optimization)
5. If MSAA: resolve multisampled renderbuffer to tile texture
6. Restore default framebuffer

The FBO's color attachment **is** the tile texture -- zero-copy rendering.

**WebGLTileCompositor:**
1. Bind default framebuffer, clear with desk color
2. Enable premultiplied alpha blending
3. For each visible tile: compute screen-space quad vertices
4. Y-flip detection: FBO-rendered tiles flip V texture coords (OpenGL Y convention)
5. Draw as textured quad (6 indices, 2 triangles)

### Canvas2D vs WebGL Tile Comparison

| Aspect | Canvas2D | WebGL |
|--------|----------|-------|
| Tile storage | `OffscreenCanvas` | FBO color texture (zero-copy) |
| Anti-aliasing | Implicit | MSAA 4x with explicit resolve |
| Stamp textures | Recreated per tile | Persistent class-level cache |
| Grain texture | Canvas pattern | Persistent GPU texture |
| Compositing | `drawImage()` with integer rounding | Textured quad with float positions |
| Y-flip | Not needed | FBO tiles need flipped V coords |
| iPad optimization | None | `invalidateFramebuffer()` for TBDR |

### Dirty Tile Tracking

1. Tiles marked dirty via: `allocate()`, `invalidate(keys)`, `invalidateAll()`, `invalidateStroke(strokeId)`
2. Each tile stores `strokeIds: Set<string>` populated during rendering
3. `getDirtyTiles(visibleKeys)` returns dirty tiles, visible tiles sorted first
4. Compositors always use `getStale()` -- dirty tiles show old content until re-rendered
5. Visible tiles are `protect()`ed from LRU eviction during rendering

### Worker Tile Rendering

Workers render tiles on background threads via Canvas2D, returning `ImageBitmap` results. In WebGL mode, bitmaps are uploaded as GPU textures (these have `fbo = null` and don't need Y-flip). Workers maintain their own grain textures and stamp generators.

---

## 10. Complete Rendering Matrix

### Per Pen Type x Pipeline x Engine

| Pen | Pipeline | Engine | Outline | Draw Call | Extra |
|-----|----------|--------|---------|-----------|-------|
| Ballpoint | Basic | Canvas2D | `perfect-freehand` | `ctx.fill(Path2D)` | -- |
| Ballpoint | Basic | WebGL | `perfect-freehand` | `engine.fillPath(Float32Array)` | Stencil nonzero winding |
| Ballpoint | Advanced | Canvas2D | `perfect-freehand` | `ctx.fill(Path2D)` | Same as basic (no advanced features) |
| Ballpoint | Advanced | WebGL | `perfect-freehand` | `engine.fillPath(Float32Array)` | Same as basic |
| Felt-tip | Basic | Canvas2D | `perfect-freehand` | `ctx.fill(Path2D)` | Tilt widens stroke |
| Felt-tip | Basic | WebGL | `perfect-freehand` | `engine.fillPath(Float32Array)` | Tilt widens stroke |
| Felt-tip | Advanced | Canvas2D | `perfect-freehand` | `ctx.fill(Path2D)` | Same as basic |
| Felt-tip | Advanced | WebGL | `perfect-freehand` | `engine.fillPath(Float32Array)` | Same as basic |
| Pencil | Basic | Canvas2D | `perfect-freehand` | `ctx.fill(Path2D)` | No grain, no stamps |
| Pencil | Basic | WebGL | `perfect-freehand` | `engine.fillPath(Float32Array)` | No grain, no stamps |
| Pencil | Advanced | Canvas2D | N/A | `arc()` per particle | Stamp scatter + grain overlay |
| Pencil | Advanced | WebGL | N/A | `engine.drawStampDiscs()` | Instanced SDF + grain shader |
| Fountain | Basic | Canvas2D | `ItalicOutlineGenerator` | `ctx.fill(Path2D)` [triangles] | No ink shading/pooling |
| Fountain | Basic | WebGL | `ItalicOutlineGenerator` | `engine.fillTriangles(Float32Array)` | No ink shading/pooling |
| Fountain | Advanced | Canvas2D | `ItalicOutlineGenerator` | Offscreen: ink stamps + `destination-in` mask | Velocity opacity + ink pooling |
| Fountain | Advanced | WebGL | `ItalicOutlineGenerator` | Offscreen FBO: `drawStamps` + `maskToPath`/`maskToTriangles` | Velocity opacity (no ink pooling -- TODO) |
| Highlighter | Any | Canvas2D | `perfect-freehand` | `ctx.fill(Path2D)` | `multiply` blend, baseOpacity 0.3 |
| Highlighter | Any | WebGL | `perfect-freehand` | `engine.fillPath(Float32Array)` | `multiply` blend, baseOpacity 0.3 |

---

## 11. Flowcharts

### 11.1 Touch Input to Active Stroke

```
PointerEvent (document capture phase)
         |
         v
  InputManager.extractPoint()
  {x, y, pressure, tiltX, tiltY, twist, timestamp}
         |
         +---> getCoalescedEvents()    (high-freq samples)
         +---> getPredictedEvents()    (estimated future)
         |
         v
  onStrokeMove(coalesced[], predicted[])
         |
         +---> Append coalesced to active buffer
         +---> Store predicted points
         |
         v
  Renderer.renderActiveStroke(points, style, pageRect)
         |
         v
  pendingActiveRender = closure
         |
         v
  scheduleFrame() ---> requestAnimationFrame
         |
         v
  Execute closure (next frame)
         |
         +---> Render active canvas (see 11.2)
         +---> Render prediction canvas (last 3 real + predicted, 50% opacity)
```

### 11.2 Active Stroke Render Dispatch

```
                    renderActiveStroke()
                           |
                    Clear active canvas
                    Apply DPR + camera
                    Clip to page rect
                           |
            +--------------+--------------+
            |              |              |
     Advanced +       Advanced +     All other
     inkStamp?         stamp?         cases
     (fountain)       (pencil)          |
            |              |              |
     Quantize pts    Quantize pts   Generate
     Gen italic      Compute all    Path2D
     Path2D          stamps              |
            |              |         +----+----+
     shading > 0?    drawStamps()   |         |
     |        |       (arc/SDF)   Hlighter?  Normal
     Yes      No                    |         |
     |        |                  multiply   fill()
     Offscreen:  fill()          blend       |
     deposit                     fill()   grain?
     stamps                                  |
     mask (dest-in)                     +----+----+
     composite                          Yes       No
     back                               |         |
                                   applyGrain  (done)
                                   (dest-out)
```

### 11.3 Completed Stroke Render Dispatch (StrokeRenderCore)

```
              renderStrokeToContext() / renderStrokeToEngine()
                                |
                        Resolve style
                        Get PenConfig
                                |
              +-----------------+-----------------+
              |                 |                 |
       pipeline=advanced  pipeline=advanced  (fallback)
       + inkStamp         + stamp            Generate
       + LOD=0            + LOD=0            outline
       (fountain)         (pencil)                |
              |                 |            +----+----+-------+
       Gen outline       Decode pts      grain?   hlighter?  normal
       Get ink preset    computeAll      (adv)       |        |
              |          Stamps()          |      multiply  fill()
       shading > 0?         |         offscreen    blend      |
       |         |     drawStamps()   + grain     fill()   inkPooling?
       Yes       No    / drawDiscs    overlay               (adv+ftn)
       |         |                    (dest-out)              |
    Offscreen:  fill()                               detectInkPools()
    ink stamps                                       renderInkPools()
    mask (dest-in)                                   (radial grads)
    composite
```

### 11.4 Stroke Finalization Flow

```
  onStrokeEnd
       |
       v
  clearActiveLayer()
  (clear active + prediction canvases)
       |
       v
  scheduleFrame() -> RAF
       |
       v
  Process pending finalizations
  (add stroke to document)
       |
       v
  bakeStroke(stroke)
       |
       +---------------+------------------+
       |               |                  |
   Non-tiled      Tiled Canvas2D     Tiled WebGL
       |               |                  |
  renderStroke    invalidate tiles    invalidate tiles
  ToContext()     via spatial query   via spatial query
  on static           |                  |
  canvas        getDirtyTiles()    getDirtyTiles()
                (visible first)    (visible first)
                      |                  |
                TileRenderer       WebGLTileEngine
                .renderTile()      .renderTile()
                (OffscreenCanvas)  (into FBO)
                      |                  |
                markClean()        MSAA resolve
                      |            markClean()
                      |                  |
                TileCompositor     WebGLTileCompositor
                .composite()       .composite()
                (drawImage)        (textured quads)
```

### 11.5 WebGL Fill Path (Stencil Winding)

```
  engine.fillPath(vertices)
           |
    Pass 1: Stencil fill
    |- Disable color writes
    |- Draw TRIANGLE_FAN with:
    |  Front face: INCR_WRAP
    |  Back face:  DECR_WRAP
    |- Nonzero winding rule encoded in stencil
           |
    Pass 2: Color fill
    |- Enable color writes
    |- Stencil test: pass where stencil != 0
    |- Draw fullscreen quad
    |- Clear stencil back to 0
```

### 11.6 WebGL Ink Shading (Fountain Advanced)

```
  renderInkShadedStrokeEngine()
           |
    Compute screen-space bbox
    Get/create offscreen FBO
           |
    engine.beginOffscreen(fbo)
    |- Clear offscreen
    |- Deposit stamps (source-over)
    |  instanced drawElements per stamp
    |  velocity -> opacity mapping
           |
    engine.maskToTriangles(italicVertices)
    |- Pass 1: Stencil mark (REPLACE)
    |- Pass 2: Clear exterior (dest-out where stencil=0)
    |- Pass 3: Clear stencil
           |
    engine.endOffscreen()
           |
    engine.drawOffscreen(fbo, position)
    |- Textured quad, premultiplied alpha
```

### 11.7 Tile Rendering Lifecycle

```
  Camera move / Stroke change / Theme change
                    |
           +--------+--------+
           |                 |
    getVisibleTiles()   invalidateStroke(id)
    (grid query)        / invalidateAll()
           |                 |
           v                 v
    protect(visible)    mark tiles dirty
           |
           v
    getDirtyTiles(visibleKeys)
    (visible-first sort)
           |
           v
    For each dirty tile:
       +---> allocate(key) if missing
       +---> renderTile(entry, doc, pages, spatial, dark)
       |        |- Clear canvas/FBO
       |        |- Transform: world -> tile pixels
       |        |- Render desk + page backgrounds
       |        |- Query SpatialIndex for strokes
       |        |- Per page: clip + render strokes
       |        |- [WebGL] MSAA resolve
       +---> markClean(key)
           |
           v
    composite(camera, screen, cache)
       |- For each visible tile:
       |     getStale(key)  (shows old content if still dirty)
       |     Draw to screen
       v
    unprotect()
           |
    evictIfNeeded() (LRU, skip protected)
```
