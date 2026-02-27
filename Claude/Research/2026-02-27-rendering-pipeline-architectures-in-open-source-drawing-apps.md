# Rendering Pipeline Architectures in Open-Source Drawing Applications

**Date:** 2026-02-27
**Purpose:** Architectural research for ObsidianPaper rendering pipeline redesign

## Executive Summary

This research analyzes rendering pipeline architectures across 8 open-source drawing/canvas projects plus game engine patterns, focusing on how they handle multiple pen/brush types, rendering backend abstraction, stamp/texture-based natural media simulation, and extensibility. The findings are mapped to ObsidianPaper's existing architecture to identify applicable patterns.

---

## 1. tldraw - ShapeUtil Strategy Pattern

**Source:** [tldraw GitHub](https://github.com/tldraw/tldraw) | [Canvas Rendering Pipeline (DeepWiki)](https://deepwiki.com/tldraw/tldraw/3.1-canvas-rendering) | [tldraw Shapes Docs](https://tldraw.dev/docs/shapes)

### Key Architectural Pattern: **ShapeUtil (Strategy + Registry)**

tldraw uses a **ShapeUtil** pattern where each shape type has a dedicated class that encapsulates all rendering and behavioral logic. This is effectively the Strategy pattern combined with a type registry.

**Core Architecture:**
- Shape records are plain JSON objects in the store (data model)
- Each shape type has a `ShapeUtil` class (behavioral model)
- The canvas pipeline queries each shape's `ShapeUtil` for rendering

**Every ShapeUtil must implement four methods:**
1. `getDefaultProps()` - Initial property values
2. `getGeometry()` - Hit testing and bounds
3. `component()` - React component rendering (returns JSX)
4. `indicator()` - Selection overlay rendering

**Shape-specific rendering strategies:**
- SVG rendering for geometric shapes (arrows, rectangles)
- HTML rendering for text/media shapes
- SVG `<pattern>` definitions for fills (solid, semi, pattern)

**Extension model:**
- Inheritance: Extend `BaseBoxShapeUtil` for rectangular shapes
- Configuration: `ShapeUtil.configure()` to customize built-in shapes without subclassing
- Registration: Pass custom ShapeUtils via `shapeUtils` prop on the `<Tldraw>` component

**Rendering pipeline flow:**
```
Store (shape records)
  -> editor.getRenderingShapes() (sort, filter, compute opacity)
    -> ShapeCullingProvider (viewport culling, O(1) visibility)
      -> Shape component (CSS transforms, reactive updates)
        -> util.component() (shape-specific rendering)
```

**Performance optimizations:**
- R-tree spatial indexing for O(log n) shape queries
- Centralized culling via `CullingController`
- Direct DOM manipulation (avoids React reconciliation for transforms)
- Content equality checks to prevent re-renders on non-visual property changes

### Strengths
- Clean separation between shape data and shape behavior
- Easy to add new shape types (implement ShapeUtil interface)
- React-based rendering allows rich per-shape UI
- `ShapeUtil.configure()` enables customization without subclassing

### Weaknesses
- DOM-based rendering (HTML + SVG), not Canvas2D/WebGL -- not applicable to pixel-level brush rendering
- Each shape is a React component, which adds overhead for thousands of shapes
- No concept of "rendering backend" abstraction -- tightly coupled to DOM/SVG

### Applicability to ObsidianPaper
**Low for rendering** (wrong rendering target), **High for architectural pattern**. The ShapeUtil pattern of separating data (stroke record) from behavior (pen-specific rendering strategy) is highly applicable. The registry pattern for pen types is worth adopting.

---

## 2. Excalidraw - Type-Dispatched Canvas Rendering

**Source:** [Excalidraw GitHub](https://github.com/excalidraw/excalidraw) | [Canvas Rendering Pipeline (DeepWiki)](https://deepwiki.com/excalidraw/excalidraw/5.1-canvas-rendering-pipeline) | [Rendering Architecture (DeepWiki)](https://deepwiki.com/zsviczian/excalidraw/6.1-rendering-architecture)

### Key Architectural Pattern: **Type-Dispatched Rendering with Dual Canvas**

Excalidraw uses a **dual-canvas architecture** (static + interactive) with rendering dispatched by element type through switch-case logic in `renderElement.ts`.

**Core Architecture:**
- 13+ element types (rectangle, ellipse, line, freedraw, text, image, frame, etc.)
- `renderElement.ts` contains a `drawElementOnCanvas()` function with type-dispatch
- RoughJS used for geometric shapes (hand-drawn aesthetic)
- `perfect-freehand` used for freedraw strokes (same library as ObsidianPaper)
- Static canvas renders elements; interactive canvas renders UI overlays

**Dual canvas system:**
- **StaticCanvas**: Background, grid, all drawing elements. Throttled to ~60fps. Only redraws when elements change.
- **InteractiveCanvas**: Selection handles, cursors, resize indicators. Updates on every user interaction independently.

**Element lifecycle:**
```
Scene.elements[]
  -> Renderer.getRenderableElements() (memoized, excludes editing text)
    -> isElementInViewport() (viewport culling)
      -> renderStaticScene() (throttled)
        -> drawElementOnCanvas(element, context) (type-dispatched)
```

**Freedraw rendering specifically:**
- `ExcalidrawFreeDrawElement` type with pressure-sensitive points
- Points added on every pointer move event during drawing
- Rendered via perfect-freehand's `getStroke()` producing outline polygons

### Strengths
- Simple dual-canvas separation (static vs. interactive) is highly effective
- Memoized element filtering with composite cache keys
- Viewport culling reduces rendering load on large scenes
- Throttled static rendering prevents excessive redraws

### Weaknesses
- Type-dispatch via switch-case in a monolithic rendering file -- not extensible
- No rendering backend abstraction -- hardcoded to Canvas2D
- Adding new element types requires modifying the central render function
- All rendering logic in one file (`renderElement.ts`) creates a large module

### Applicability to ObsidianPaper
**Medium**. The dual-canvas pattern (which ObsidianPaper already uses via offscreen compositing) is validated. The type-dispatch approach is what ObsidianPaper currently uses in `StrokeRenderCore.ts` with if/else chains, and this research confirms it should be refactored toward a strategy-based pattern.

---

## 3. perfect-freehand - Rendering-Agnostic Geometry Library

**Source:** [perfect-freehand GitHub](https://github.com/steveruizok/perfect-freehand) | [npm](https://www.npmjs.com/package/perfect-freehand)

### Key Architectural Pattern: **Geometry Generator (Rendering-Agnostic)**

perfect-freehand is intentionally *not* a rendering library. It generates stroke outline geometry (polygon points) and leaves rendering entirely to the consumer.

**Core API:**
```typescript
// Main function: input points -> outline polygon points
getStroke(points: InputPoint[], options?: StrokeOptions): number[][]

// Advanced: two-stage pipeline
getStrokePoints(points, options)    // -> processed stroke points with metadata
getStrokeOutlinePoints(points, options) // -> outline from processed points
```

**Options control brush character:**
- `size` (diameter), `thinning` (pressure->width), `smoothing`, `streamline`
- `simulatePressure` (velocity-based when no pressure data)
- `start`/`end` tapering with custom easing
- `easing` function for pressure curve

**Recommended rendering approaches by the author:**
- **SVG**: Convert outline points to quadratic Bezier path data string
- **Canvas2D**: Convert to Path2D via SVG path data, then `ctx.fill(path)`
- **WebGL**: Use outline points as vertex buffer directly

**Self-intersection handling:**
- Default output includes self-crossings in the polygon
- Optional flattening via `polygon-clipping` package removes self-intersections

### Strengths
- Pure geometry -- completely rendering-agnostic
- Two-stage pipeline allows intercepting at different processing stages
- Small, focused library (no rendering dependencies)
- TypeScript types for all options

### Weaknesses
- Only generates outline polygons -- no stamp-based, texture, or particle rendering
- Single brush model (variable-width filled polygon) -- cannot represent pencil scatter or ink deposit
- No support for grain/texture effects

### Applicability to ObsidianPaper
**Already in use.** ObsidianPaper uses perfect-freehand for outline generation in `OutlineGenerator.ts`. The key insight is that perfect-freehand handles only one layer of the rendering pipeline (geometry generation), and ObsidianPaper has already built stamp rendering, grain textures, and ink shading on top of it. The two-stage API (`getStrokePoints` / `getStrokeOutlinePoints`) could be leveraged if custom outline generation is needed.

---

## 4. Krita - Pluggable Brush Engine (Factory + Plugin)

**Source:** [Krita Brush Engine Wiki](https://community.kde.org/Krita/BrushEngine) | [How to Write Brush Engines](https://community.kde.org/Krita/How_To_Write_Brush_Engines) | [Brushes and Presets (DeepWiki)](https://deepwiki.com/KDE/krita/4.2-brushes-and-presets) | [Brush Engines Docs](https://docs.krita.org/en/reference_manual/brushes/brush_engines.html)

### Key Architectural Pattern: **Factory + Plugin Registry + Abstract PaintOp**

Krita has the most sophisticated brush engine architecture of any project analyzed. It supports **18 distinct brush engines** through a pluggable factory system.

**Core class hierarchy:**
```
KisPaintOp (abstract base)
  - paintAt(KisPaintInformation) -> paint a single dab at a position
  - paintLine(p1, p2, KisPaintInformation) -> paint between two points
  - paintBezierCurve(p1, cp1, cp2, p2) -> paint along a curve

KisPaintOpFactory (abstract factory)
  - Creates instances of specific KisPaintOp implementations
  - Creates settings widgets and settings objects
  - Registered in KisPaintOpRegistry (singleton)

KisPaintOpSettings
  - Serializes/deserializes brush configuration (XML/properties)
  - Contains all parameters for a specific brush engine instance

KisPaintOpPreset (resource)
  - Named preset wrapping a KisPaintOpSettings
  - Loadable/savable as .kpp files
```

**Plugin structure (each brush engine is a plugin with 4 components):**
1. **Factory** (extends `KisPaintOpFactory`) - creates instances
2. **Settings widget** - UI for editing brush parameters
3. **Settings object** (extends `KisPaintOpSettings`) - stores parameters
4. **Paint operation** (extends `KisPaintOp`) - implements actual painting

**Key design principles:**
- "Enforce as little policy as possible" -- brush engines are not forced into a rigid framework
- Brush engines can cooperate but don't have to
- `KisBrushBasedPaintOp` is a convenience base class that handles brush spacing automatically
- Two deposition modes: **direct** (paint on the node's paint device) and **indirect** (paint on temporary device, composite on stroke completion)

**Modern Lager-based architecture (value-oriented design):**
Each brush option has 5 entities:
1. **Data** - reads/writes from XML/properties
2. **State** - single source of truth
3. **Model** - dependencies between settings
4. **Widget** - UI
5. **Option** - used by KisPaintOp to apply the effect

**18 brush engines:**
Pixel, Color Smudge, Bristle, Chalk, Clone, Curve, Deform, Dyna, Filter, Grid, Hatching, MyPaint, Particle, Quick, Shape, Sketch, Spray, Tangent Normal.

### Strengths
- Most extensible architecture -- adding a brush engine requires zero changes to existing code
- Clean separation: factory creates, settings store, paintop renders
- "As little policy as possible" philosophy enables diverse rendering approaches
- Convenience base classes (`KisBrushBasedPaintOp`) reduce boilerplate
- Direct/indirect deposition modes handle both immediate and composited rendering

### Weaknesses
- High complexity (4 classes per brush engine)
- C++ plugin system -- not directly portable to TypeScript
- Factory registry pattern requires more infrastructure than simpler approaches
- Over-engineered for an application with 5 pen types

### Applicability to ObsidianPaper
**High for architecture, scaled down.** The Factory + PaintOp pattern is the gold standard for extensible brush systems. For ObsidianPaper (with 5 pen types), a simplified version would work:
- `PenRenderer` interface (like `KisPaintOp`)
- `PenConfig` (like `KisPaintOpSettings`) -- already exists
- `PenRendererFactory` or registry -- already partially exists as `PEN_CONFIGS`
- Skip the factory class -- use a simple map or switch

---

## 5. MyPaint / libmypaint - Surface Abstraction + Dab-Based Rendering

**Source:** [libmypaint GitHub](https://github.com/mypaint/libmypaint) | [libmypaint Architecture (DeepWiki)](https://deepwiki.com/mypaint/libmypaint) | [MyPaintBrush API (DeepWiki)](https://deepwiki.com/mypaint/libmypaint/6.1-mypaintbrush-api) | [MyPaint Brush Engine Docs](https://www.mypaint.app/en/docs/backend/brush-engine/)

### Key Architectural Pattern: **Surface Abstraction + Dab Pipeline + Dynamic Mapping**

libmypaint's key innovation is its **complete separation between brush engine and rendering surface**. The brush engine generates dabs; the surface renders them. They communicate through an abstract interface.

**Two-system architecture:**
1. **Brush Engine (MyPaintBrush)** - Processes inputs (pressure, speed, tilt), maintains state, calculates settings, generates dabs. Completely independent of rendering.
2. **Surface System (MyPaintSurface)** - Abstract rendering interface. Brush engine calls surface methods to draw dabs without knowing the implementation.

**Surface abstraction hierarchy:**
```
MyPaintSurface (abstract interface)
  - draw_dab() -> render a single circular dab
  - get_color() -> sample color at a position (for smudge)
    |
    v
MyPaintTiledSurface (tile-based implementation, 64x64 tiles)
    |
    v
FixedTiledSurface / GeglTiledSurface (concrete implementations)
```

**Dab-based rendering model:**
Rather than drawing continuous strokes, libmypaint generates discrete circular "dabs":
1. **Dab generation**: Stroke algorithm determines how many dabs based on distance and time
2. **Dab calculation**: Each dab gets position, radius, hardness, color, opacity
3. **Mask creation**: Circular mask with hardness falloff from center to edge
4. **Blend mode**: Dabs composite onto surface (normal, spectral pigment, eraser, etc.)
5. **Accumulation**: Overlapping dabs build up the final stroke

**Dynamic settings mapping (key innovation):**
- Brush settings are defined in `brushsettings.json` (data-driven)
- Each setting can be **static** (constant) or **dynamic** (mapped from inputs)
- Inputs: pressure, speed, tilt, random, stroke progress, direction, etc.
- Mapping uses response curves defined by control points
- Example: pressure 0.0 -> radius 1.0; pressure 1.0 -> radius 3.0

**Full rendering pipeline:**
```
Input event (position, pressure, tilt)
  -> mypaint_brush_stroke_to()
    -> Input processing (filtering, normalization)
      -> Mapping calculation (input -> setting values via curves)
        -> Dab generation (spacing algorithm)
          -> draw_dab() on surface
            -> Tile-based compositing
```

### Strengths
- Surface abstraction is the cleanest rendering backend separation of any project analyzed
- Data-driven brush definitions (JSON) -- no code changes to add new brushes
- Dab-based model naturally handles pressure, tilt, speed dynamics
- Used by GIMP, Krita, Pixelmator -- proven at scale
- Tile-based surface enables infinite canvas and memory efficiency

### Weaknesses
- Dab-based only -- no support for filled-outline strokes (like perfect-freehand)
- Circular dabs limit the visual vocabulary (no rectangular nibs without workarounds)
- Complex mapping system adds overhead for simple brushes
- C library -- not directly usable in web context

### Applicability to ObsidianPaper
**Very high for the Surface abstraction pattern.** ObsidianPaper's `RenderEngine` interface already mirrors `MyPaintSurface` conceptually (abstract rendering operations, concrete Canvas2D and WebGL implementations). The dab-based model directly maps to ObsidianPaper's stamp-based pencil and ink rendering. The key insight is that **ObsidianPaper already uses a dab/stamp model for pencil and fountain pen** -- this validates the approach and suggests it could be formalized.

---

## 6. Fabric.js - Class-Based Brush Hierarchy

**Source:** [Fabric.js GitHub](https://github.com/fabricjs/fabric.js) | [Fabric.js BaseBrush API](https://fabricjs.com/api/classes/basebrush/) | [Fabric.js Intro Part 4](https://fabricjs.com/docs/old-docs/fabric-intro-part-4/) | [fabric-brushes](https://github.com/av01d/fabric-brushes)

### Key Architectural Pattern: **Classical Inheritance (Template Method)**

Fabric.js uses a traditional class hierarchy with `BaseBrush` as the abstract parent and specialized brush types extending it.

**Class hierarchy:**
```
BaseBrush
  - color: string
  - width: number
  - shadow: Shadow
  - canvas: Canvas
  |
  +-- PencilBrush (default, creates Path objects)
  |     - decimate: 0.4 (point reduction)
  |     - drawStraightLine: boolean
  |
  +-- CircleBrush (spray of circles)
  +-- SprayBrush (spray of small dots)
  +-- PatternBrush (extends PencilBrush, custom pattern fill)
```

**Drawing lifecycle:**
1. `isDrawingMode = true` on canvas
2. Mouse/touch events forwarded to active brush
3. Brush renders live preview on overlay canvas
4. On mouseup: brush converts drawing to `fabric.Path` or group of objects
5. `path:created` event fired

**Third-party brush extensions:**
- `fabric-brush`: MarkerBrush, RibbonBrush, ShadedBrush, SketchyBrush, SpraypaintBrush, SquaresBrush
- `fabricjs-psbrush`: Pressure-sensitive brush for Fabric.js

### Strengths
- Simple, well-understood OOP pattern
- Easy to create new brush types by extending BaseBrush
- Brush output becomes a regular Fabric.js object (serializable, manipulable)

### Weaknesses
- Classical inheritance is rigid -- deep hierarchies become brittle
- No rendering backend abstraction -- hardcoded to Canvas2D
- Brush rendering and brush definition are coupled in the same class
- No concept of brush "settings" separate from the brush instance

### Applicability to ObsidianPaper
**Low for architecture** (too simple, inheritance-based), **Medium for concepts**. The lifecycle pattern (live preview during drawing -> finalize as object) is similar to ObsidianPaper's live stroke -> committed stroke pipeline. The PatternBrush concept (custom fill pattern) relates to grain texture rendering.

---

## 7. Paper.js - Scene Graph with Polymorphic `_draw()`

**Source:** [Paper.js GitHub](https://github.com/paperjs/paper.js) | [View and Canvas Rendering (DeepWiki)](https://deepwiki.com/paperjs/paper.js/5-view-and-canvas-rendering) | [Paper.js Features](http://paperjs.org/features/)

### Key Architectural Pattern: **Scene Graph + Polymorphic Draw**

Paper.js uses a document object model / scene graph where each item type implements its own `_draw()` method.

**Rendering hierarchy:**
```
View (manages canvas, coordinate transforms)
  -> Project (holds scene graph)
    -> Layer._draw(ctx)
      -> Group._draw(ctx) [applies group transforms]
        -> Path._draw(ctx)
        -> Raster._draw(ctx)
        -> Shape._draw(ctx)
        -> PointText._draw(ctx)
```

**Rendering pipeline:**
1. View configures canvas and transformation matrix (zoom, pan, rotation)
2. Scene graph traversed front-to-back (hierarchical order)
3. Each item applies its own transforms, styles, blend modes, clipping
4. `_draw()` is polymorphic -- each item type renders itself
5. HiDPI support: automatic device pixel ratio detection and scaling

**Update modes:**
- **Automatic** (default): View schedules `requestAnimationFrame` when changes detected
- **Manual**: Developer calls `view.update()` explicitly

**Coordinate system:**
- `projectToView(point)`: logical -> screen pixels
- `viewToProject(point)`: screen pixels -> logical

### Strengths
- Clean scene graph with intuitive hierarchy
- Highly optimized Bezier math (bounds, length, parameterization)
- Good coordinate system abstraction (project vs. view space)
- Built-in HiDPI handling

### Weaknesses
- Single rendering backend (Canvas2D only, chosen over SVG for performance)
- No brush/pen concept -- purely a vector graphics library
- `_draw()` polymorphism means rendering logic embedded in item classes
- Not designed for freehand drawing

### Applicability to ObsidianPaper
**Low for rendering**, **Medium for coordinate system patterns**. The scene graph approach is too heavyweight for stroke-based rendering, but the coordinate transformation abstraction (project-space vs. view-space) and automatic HiDPI handling patterns are relevant.

---

## 8. Konva - Dual-Canvas Strategy Pattern

**Source:** [Konva GitHub](https://github.com/konvajs/konva) | [Konva Architecture (DeepWiki)](https://deepwiki.com/konvajs/konva) | [Konva Overview](https://konvajs.org/docs/overview.html)

### Key Architectural Pattern: **Scene Graph + Dual Canvas (Scene + Hit) + Strategy (_sceneFunc)**

Konva separates shape definition from rendering using a Strategy pattern where each shape provides a `_sceneFunc` and `_hitFunc`.

**Node hierarchy:**
```
Node (base class)
  -> Container (can hold children)
    -> Stage (root, tied to DOM element)
    -> Layer (canvas-backed, has scene + hit canvases)
    -> Group (logical container, no canvas)
  -> Shape (visual elements)
    -> Rect, Circle, Text, Line, Path, Image, etc.
```

**Dual-canvas architecture:**
Each Layer has two canvas renderers:
- **Scene canvas**: Visible rendering output
- **Hit canvas**: Hidden canvas with unique RGB color per shape for pixel-perfect event detection

**Shape rendering via Strategy pattern:**
```typescript
class CustomShape extends Shape {
  _sceneFunc(context: Context) {
    // Custom drawing logic
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(100, 50);
    context.fillStrokeShape(this);  // Apply fill/stroke from shape properties
  }

  _hitFunc(context: Context) {
    // Optional: custom hit region (defaults to _sceneFunc)
  }
}
```

**Design patterns identified:**
1. **Composite pattern**: Scene graph hierarchy
2. **Factory pattern**: Auto-generated getters/setters via `Factory` system
3. **Observer pattern**: Event system with bubbling (`on()`, `off()`, `fire()`)
4. **Strategy pattern**: `_sceneFunc` / `_hitFunc` for shape-specific rendering
5. **Adapter pattern**: `Context` wraps native Canvas 2D API
6. **Caching pattern**: `node.cache()` renders subtrees to offscreen canvas

**Performance:**
- Layer-based separation of static and dynamic content
- `batchDraw()` defers updates to next `requestAnimationFrame`
- Caching complex subtrees as single images

### Strengths
- Clean strategy-based rendering (each shape owns its drawing logic)
- Context adapter wraps raw Canvas2D, adding convenience methods
- Hit detection via color-keyed canvas is elegant
- Layer separation enables selective redraw

### Weaknesses
- Single rendering backend (Canvas2D)
- Scene graph overhead for large numbers of shapes
- Hit canvas doubles memory usage per layer
- No brush/pen concept -- shapes only

### Applicability to ObsidianPaper
**Medium**. The Strategy pattern for rendering (each shape/pen provides its own `_sceneFunc`) is directly applicable. The Context adapter pattern (wrapping raw canvas API) parallels ObsidianPaper's `RenderEngine` interface. The caching pattern (complex subtree -> single image) maps to ObsidianPaper's tile caching.

---

## 9. PixiJS - Multi-Backend Renderer Abstraction

**Source:** [PixiJS GitHub](https://github.com/pixijs/pixijs) | [PixiJS Renderers](https://pixijs.com/8.x/guides/components/renderers) | [PixiJS v8 Beta](https://pixijs.com/blog/pixi-v8-beta)

### Key Architectural Pattern: **Abstract Renderer + Backend Detection + Modular Systems**

PixiJS provides the most relevant multi-backend rendering abstraction for web applications.

**Renderer hierarchy:**
```
AbstractRenderer (common base)
  - render(), resize(), clear()
  - Shared systems: canvas, texture GC, events
  |
  +-- WebGLRenderer (default, stable)
  +-- WebGPURenderer (experimental, modern)
  +-- CanvasRenderer (subset of features)
```

**Backend detection and fallback:**
```typescript
// Automatic (tries WebGL -> WebGPU -> Canvas)
const renderer = await autoDetectRenderer({ preference: 'webgl' });

// Explicit
const renderer = new WebGLRenderer();
```

**Key design decisions:**
- Common interface across all renderers (.render(), .resize(), .clear())
- Modular system composition (texture upload, events, GC are separate systems)
- Canvas renderer supports a **subset** of features (no filters, advanced blends, shaders)
- Feature detection rather than feature parity across backends

### Strengths
- Clean multi-backend abstraction (WebGL, WebGPU, Canvas2D)
- Automatic backend detection with graceful fallback
- Shared systems reduce code duplication
- Battle-tested at scale

### Weaknesses
- Canvas2D renderer is deliberately incomplete (subset of features)
- Complex internal architecture
- Not designed for freehand drawing/brushes

### Applicability to ObsidianPaper
**High for backend abstraction pattern.** ObsidianPaper's `RenderEngine` interface with `Canvas2DEngine` and `WebGL2Engine` implementations already follows this exact pattern. The key lesson from PixiJS is that **feature subsetting is acceptable** -- the Canvas2D backend doesn't need to support every WebGL feature. ObsidianPaper's `EngineFactory.createRenderEngine()` already mirrors `autoDetectRenderer()`.

---

## 10. Drawpile - Union Brush Type + Layered Pipeline

**Source:** [Drawpile Brush System (DeepWiki)](https://deepwiki.com/drawpile/Drawpile/4.1-brush-system)

### Key Architectural Pattern: **Union Type + Layered Pipeline + Slot System**

Drawpile is included because it's a real-time collaborative drawing app with multiple brush types, making it highly relevant.

**ActiveBrush union pattern:**
- `ActiveBrush` maintains one active brush type at a time via `m_activeType`
- Brush types: PixelRound, PixelSquare, SoftRound, MyPaint
- Memory-efficient: only one brush engine active at a time

**Layered rendering pipeline:**
```
UI Layer: BrushSettings (user configuration)
  -> Application Layer: ToolController + CanvasModel (state coordination)
    -> Paint Engine: TileCache (64x64 tiles)
      -> DrawDance Engine (C): Core low-level rendering
```

**Slot-based brush system:**
- 10 brush slots (9 regular + 1 eraser)
- Each slot maintains independent configuration
- Slots can be: Detached (standalone), Attached (preset-linked), Modified (local changes)
- Enables rapid tool switching

**CanvasWrapper abstraction:**
- Unified interface for different rendering implementations
- Supports QGraphicsView, OpenGL, and software rendering

### Strengths
- Union type pattern is simple and efficient for a fixed set of brush types
- Slot-based quick switching is good UX
- Layered pipeline with clear separation
- Real-time collaborative (validates architecture for low-latency needs)

### Weaknesses
- Union approach doesn't scale well for many brush types
- C engine code not portable to web
- Tight Qt coupling

### Applicability to ObsidianPaper
**Medium-High**. The union/discriminated type pattern maps directly to ObsidianPaper's `PenType` union. The slot-based system relates to ObsidianPaper's toolbar pen presets. The layered pipeline (UI -> State -> Engine) is a pattern worth formalizing.

---

## 11. Game Engine Material/Shader Patterns

**Source:** [Vulkan Engine Architecture Patterns](https://docs.vulkan.org/tutorial/latest/Building_a_Simple_Engine/Engine_Architecture/02_architectural_patterns.html) | [Shader Abstraction (Logan Harvell)](https://logantharvell.github.io/rendering-abstraction-dev-diary-8/) | [Game Engine Architecture (GeneralistProgrammer)](https://generalistprogrammer.com/game-engine-architecture)

### Key Architectural Patterns: **Component-Based + Layered + Data-Oriented**

Game engines use several patterns relevant to pen rendering:

**Material/Shader abstraction:**
- A "Material" describes visual appearance (shader + parameters + textures)
- Analogous to a pen type: shader = rendering algorithm, parameters = pen settings, textures = grain/stamp textures
- Graphics Objects have a Model (geometry) and Material (appearance)
- Specialized Graphics Objects associate with specialized Shaders

**Component-Based Architecture:**
- Entities contain modular components (geometry, material, lighting, transform)
- Systems process specific component combinations
- "Easily add, remove, or swap rendering features without major refactoring"

**Layered Architecture:**
- Platform abstraction (hardware differences)
- Resource management (textures, buffers)
- Rendering (draw calls, state management)
- Scene management (spatial data structures)
- Application (game logic)

**Service Locator Pattern:**
- "Provides a global point of access to services without coupling consumers to concrete implementations"
- Relevant for accessing rendering backends, texture caches, etc.

### Applicability to ObsidianPaper
**High for conceptual patterns.** The Material concept directly maps to pen types:
- **Shader** = pen rendering algorithm (ballpoint fills path, pencil renders stamps, fountain uses ink shading)
- **Parameters** = PenConfig values (width, pressure curve, thinning, etc.)
- **Textures** = Grain textures, stamp textures, ink stamp textures
- **Geometry** = Stroke outline vertices (from perfect-freehand)

This is perhaps the most powerful insight: **each pen type is a "material" applied to stroke geometry.**

---

## 12. Multi-Backend Abstraction Patterns

**Source:** [Canvas2DtoWebGL](https://github.com/jagenjo/Canvas2DtoWebGL) | [SpritejsNext (npm)](https://www.npmjs.com/package/spritejs) | [Infinite Canvas Tutorial](https://github.com/xiaoiver/infinite-canvas-tutorial)

### Key Patterns Found:

**Canvas2D-over-WebGL shims:**
- `Canvas2DtoWebGL` ports Canvas 2D API to WebGL calls
- Allows mixing 2D and 3D on a single canvas
- This is the approach ObsidianPaper takes (Canvas2DEngine implements the same API as WebGL2Engine)

**Renderer-agnostic libraries:**
- SpritejsNext supports WebGL2, WebGL, and Canvas2D from the same API
- Hardware abstraction layer (e.g., `@antv/g-device-api`) supporting WebGL1/2 and WebGPU

**Common fallback strategy:**
- Try GPU first (WebGL2 -> WebGL -> WebGPU)
- Fall back to Canvas2D
- Feature detection rather than feature parity
- This is exactly what ObsidianPaper's `EngineFactory` does

---

## 13. Stamp/Texture-Based Natural Media Rendering

**Source:** [Krita Artists Discussion](https://krita-artists.org/t/paper-texture-brushes-and-digital-painting/47810) | [Diffusion Texture Painting (ACM)](https://dl.acm.org/doi/fullHtml/10.1145/3641519.3657458)

### Key Concepts:

**Dab/Stamp model (used by libmypaint, Krita, ObsidianPaper):**
- Place discrete circular or textured "stamps" along the stroke path
- Overlapping stamps accumulate (more overlap = darker/denser)
- Spacing controls overlap: 0.1 = heavy overlap, 0.5 = sparse
- Stamp texture can be: circle (hard/soft), image, procedural

**Grain/Paper texture (separate from brush texture):**
- Texture associated with canvas/paper, not the brush
- Brush deposits ink that interacts with paper texture
- Applied as destination-out (eraser) compositing on the deposited ink
- Paper texture position is fixed relative to canvas (not stroke)

**ObsidianPaper's existing implementation:**
- Pencil: Disc stamps along stroke path (`drawStampDiscs`) with grain overlay
- Fountain pen: Ink stamp textures (`drawStamps`) masked to italic outline
- Both match the industry-standard approaches

---

## Comparative Analysis

| Project | Pattern | Backend Abstraction | Brush Extensibility | Stamp/Texture | Complexity |
|---------|---------|-------------------|--------------------| --------------|------------|
| tldraw | ShapeUtil Registry | None (DOM) | High (plugin) | None | Medium |
| Excalidraw | Type-Dispatch | None (Canvas2D) | Low (switch-case) | None | Low |
| perfect-freehand | Geometry Generator | N/A (no rendering) | N/A | None | Very Low |
| Krita | Factory + Plugin | N/A (C++) | Very High | Full | Very High |
| libmypaint | Surface Abstraction | Yes (Surface interface) | High (data-driven) | Dab-based | High |
| Fabric.js | Class Inheritance | None (Canvas2D) | Medium | Via extension | Low |
| Paper.js | Scene Graph | None (Canvas2D) | Low | None | Medium |
| Konva | Strategy (_sceneFunc) | None (Canvas2D) | High | None | Medium |
| PixiJS | Abstract Renderer | Yes (WebGL/WebGPU/Canvas) | N/A | N/A | High |
| Drawpile | Union Type + Layers | Yes (wrapper) | Medium | Dab-based | Medium |
| **ObsidianPaper** | **Config-Driven + if/else** | **Yes (RenderEngine)** | **Medium** | **Stamps + Grain** | **Medium** |

---

## Recommendations for ObsidianPaper

### Current Architecture Assessment

ObsidianPaper's current architecture already incorporates several best-practice patterns:
- **RenderEngine interface** (like PixiJS AbstractRenderer, libmypaint Surface)
- **Canvas2D + WebGL backends** with automatic fallback (like PixiJS)
- **Stamp/dab rendering** (like libmypaint, Krita)
- **Grain texture** via destination-out compositing (standard approach)
- **Config-driven pen types** via `PenConfig` (like Krita presets)

The primary weakness is in `StrokeRenderCore.ts`, which uses **if/else dispatch** based on pen config flags (`penConfig.inkStamp`, `penConfig.stamp`, `penConfig.grain?.enabled`, `penConfig.highlighterMode`). This is the Excalidraw approach and doesn't scale well.

### Recommended Architecture: Simplified Krita Pattern

Based on this research, the recommended pattern combines:
1. **Krita's Factory/PaintOp pattern** (scaled down)
2. **libmypaint's Surface abstraction** (already have as `RenderEngine`)
3. **tldraw's ShapeUtil registry** (simple registration)
4. **Game engine Material concept** (pen as "material" applied to stroke geometry)

**Proposed structure:**

```typescript
// 1. PenRenderer interface (like KisPaintOp, Konva's _sceneFunc)
interface PenRenderer {
  /** Render a stroke using the Canvas2D context path */
  renderToContext(ctx: Ctx2D, stroke: Stroke, style: PenStyle, ...): void;

  /** Render a stroke using the RenderEngine abstraction */
  renderToEngine(engine: RenderEngine, stroke: Stroke, style: PenStyle, ...): void;
}

// 2. Concrete implementations (like Krita's specific PaintOps)
class BallpointRenderer implements PenRenderer { ... }
class PencilRenderer implements PenRenderer { ... }    // stamps + grain
class FountainRenderer implements PenRenderer { ... }  // ink shading + stamps
class FeltTipRenderer implements PenRenderer { ... }
class HighlighterRenderer implements PenRenderer { ... }

// 3. Registry (like KisPaintOpRegistry, tldraw's shapeUtils)
const PEN_RENDERERS: Record<PenType, PenRenderer> = {
  ballpoint: new BallpointRenderer(),
  pencil: new PencilRenderer(),
  fountain: new FountainRenderer(),
  "felt-tip": new FeltTipRenderer(),
  highlighter: new HighlighterRenderer(),
};

// 4. Dispatch (replaces if/else chains in StrokeRenderCore)
function renderStroke(engine: RenderEngine, stroke: Stroke, style: PenStyle) {
  const renderer = PEN_RENDERERS[style.pen];
  renderer.renderToEngine(engine, stroke, style, ...);
}
```

**Benefits of this approach:**
- Adding a new pen type requires: (1) new PenConfig, (2) new PenRenderer class, (3) register in map
- Zero changes to existing rendering code
- Each pen renderer can use completely different rendering strategies
- Both Canvas2D and RenderEngine paths supported per pen
- `PenConfig` remains as the "settings" / "material parameters"
- `PenRenderer` is the "shader" / "paint operation"

### Complexity Budget

Given ObsidianPaper has 5 pen types (not 18 like Krita), the architecture should be:
- **Simpler than Krita** (no factory classes, no plugin loading, no XML serialization)
- **More structured than Excalidraw** (no switch-case monolith)
- **Similar to Konva** (Strategy pattern via interface implementation)
- **Keep `PenConfig`** as-is (it's already a good "settings" object)
- **Extract rendering logic** from `StrokeRenderCore.ts` into per-pen renderer classes

### Key Insight: The Material Metaphor

The strongest conceptual model from this research is the **game engine Material**:
- **Stroke geometry** (from perfect-freehand) = Mesh
- **PenConfig** = Material parameters (uniforms)
- **PenRenderer** = Shader program (rendering algorithm)
- **Stamp textures / grain textures** = Material textures
- **RenderEngine** = Graphics backend (OpenGL, Vulkan, etc.)

This metaphor cleanly separates what is being drawn (stroke shape) from how it looks (pen material) and where it renders (backend engine).

---

## Sources

### Projects Analyzed
- [tldraw GitHub](https://github.com/tldraw/tldraw) | [Canvas Rendering (DeepWiki)](https://deepwiki.com/tldraw/tldraw/3.1-canvas-rendering) | [Shapes Docs](https://tldraw.dev/docs/shapes) | [ShapeUtil Reference](https://tldraw.dev/reference/editor/ShapeUtil)
- [Excalidraw GitHub](https://github.com/excalidraw/excalidraw) | [Canvas Pipeline (DeepWiki)](https://deepwiki.com/excalidraw/excalidraw/5.1-canvas-rendering-pipeline) | [Rendering Architecture (DeepWiki)](https://deepwiki.com/zsviczian/excalidraw/6.1-rendering-architecture)
- [perfect-freehand GitHub](https://github.com/steveruizok/perfect-freehand) | [npm](https://www.npmjs.com/package/perfect-freehand) | [Prior Art Discussion](https://github.com/steveruizok/perfect-freehand/discussions/16)
- [Krita Brush Engine Wiki](https://community.kde.org/Krita/BrushEngine) | [How to Write Brush Engines](https://community.kde.org/Krita/How_To_Write_Brush_Engines) | [Brushes & Presets (DeepWiki)](https://deepwiki.com/KDE/krita/4.2-brushes-and-presets) | [Brush Engines Docs](https://docs.krita.org/en/reference_manual/brushes/brush_engines.html) | [Lager GUI Design](https://docs.krita.org/en/untranslatable_pages/brush_editor_gui_with_lager.html)
- [libmypaint GitHub](https://github.com/mypaint/libmypaint) | [Architecture (DeepWiki)](https://deepwiki.com/mypaint/libmypaint) | [MyPaintBrush API (DeepWiki)](https://deepwiki.com/mypaint/libmypaint/6.1-mypaintbrush-api) | [Brush Engine Docs](https://www.mypaint.app/en/docs/backend/brush-engine/)
- [Fabric.js GitHub](https://github.com/fabricjs/fabric.js) | [BaseBrush API](https://fabricjs.com/api/classes/basebrush/) | [PencilBrush API](https://fabricjs.com/api/classes/pencilbrush/) | [Intro Part 4](https://fabricjs.com/docs/old-docs/fabric-intro-part-4/)
- [Paper.js GitHub](https://github.com/paperjs/paper.js) | [View Rendering (DeepWiki)](https://deepwiki.com/paperjs/paper.js/5-view-and-canvas-rendering) | [Features](http://paperjs.org/features/)
- [Konva GitHub](https://github.com/konvajs/konva) | [Architecture (DeepWiki)](https://deepwiki.com/konvajs/konva) | [Custom Shapes](https://konvajs.org/docs/shapes/Custom.html) | [Overview](https://konvajs.org/docs/overview.html)
- [PixiJS GitHub](https://github.com/pixijs/pixijs) | [Renderers](https://pixijs.com/8.x/guides/components/renderers) | [v8 Beta Announcement](https://pixijs.com/blog/pixi-v8-beta)
- [Drawpile Brush System (DeepWiki)](https://deepwiki.com/drawpile/Drawpile/4.1-brush-system)

### Architecture Patterns
- [Vulkan Engine Architecture Patterns](https://docs.vulkan.org/tutorial/latest/Building_a_Simple_Engine/Engine_Architecture/02_architectural_patterns.html)
- [Shader Abstraction Dev Diary](https://logantharvell.github.io/rendering-abstraction-dev-diary-8/)
- [Game Engine Architecture 2025](https://generalistprogrammer.com/game-engine-architecture)
- [Plugin Architecture Design Pattern](https://www.devleader.ca/2023/09/07/plugin-architecture-design-pattern-a-beginners-guide-to-modularity/)
- [Canvas2DtoWebGL](https://github.com/jagenjo/Canvas2DtoWebGL)
- [SpritejsNext](https://www.npmjs.com/package/spritejs)
- [MDN Canvas Optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
