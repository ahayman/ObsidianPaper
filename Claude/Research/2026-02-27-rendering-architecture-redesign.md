# Rendering Architecture Redesign Research

**Date:** 2026-02-27
**Purpose:** Define a modular, extensible architecture for the rendering pipeline that eliminates recurring mistakes when adding/updating pen types with stamps and textures.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Industry Research](#3-industry-research)
4. [Design Pattern Evaluation](#4-design-pattern-evaluation)
5. [Recommended Architecture: Bridge + Material System](#5-recommended-architecture-bridge--material-system)
6. [Detailed Design](#6-detailed-design)
7. [Stress Test: Felt-Tip Stamps](#7-stress-test-felt-tip-stamps)
8. [Revised Architecture (Post Stress Test)](#8-revised-architecture-post-stress-test)
9. [Migration Strategy](#9-migration-strategy)

---

## 1. Problem Statement

Every time we add or update a pen type with stamps/textures, we repeat the same mistakes:

1. **10-12 files must be modified** to add a new pen type with stamps
2. **Rendering logic is duplicated 3x**: `renderStrokeToContext` (Canvas2D), `renderStrokeToEngine` (WebGL), and `renderActiveStroke` (in-progress)
3. **Conditional dispatch grows** -- each new pen adds another if/else branch in the waterfall
4. **Resource plumbing is manual** -- each stamp/texture type requires 7+ forwarding methods across Renderer, TiledStaticLayer, TileRenderer, and WebGLTileEngine
5. **Stamp systems are parallel but not shared** -- `StampRenderer` and `InkStampRenderer` duplicate path-walking, packing, and drawing logic without a common abstraction

The goal is an architecture where adding a new pen type is a **localized change** -- define its config, define its rendering behavior, register it -- with zero modifications to the rendering dispatch, tile system, or resource plumbing.

---

## 2. Current Architecture Analysis

### Where the Pain Lives

#### StrokeRenderCore.ts (743 lines) -- The Central Dispatcher

Two near-identical top-level functions with the same branching:

```
renderStrokeToContext() (Canvas2D)     renderStrokeToEngine() (WebGL)
├── inkStamp? (fountain advanced)      ├── inkStamp? (fountain advanced)
├── stamp? (pencil advanced)           ├── stamp? (pencil advanced)
├── grain? (pencil, not basic)         ├── grain? (pencil, not basic)
├── highlighter?                       ├── highlighter?
├── normal fill                        ├── normal fill (+ italic branching x4)
└── ink pooling? (fountain, advanced)  └── ink pooling? (TODO)
```

Each branch pair duplicates logic with only the drawing primitives changed (`ctx.fill(path)` vs `engine.fillPath(vertices)`). The WebGL path also has 4 separate italic/non-italic branches for `fillTriangles` vs `fillPath`.

Helper functions are also duplicated:
- `renderInkShadedStroke()` + `renderInkShadedStrokeEngine()` (62 + 52 lines)
- `renderStrokeWithGrain()` + `renderStrokeWithGrainEngine()` (57 + 51 lines)

#### Renderer.ts (2,110 lines) -- Active Stroke Rendering

`renderActiveStroke()` (198 lines) re-implements the same dispatch:
- Fountain pen ink shading: 93 lines duplicating StrokeRenderCore's offscreen compositing
- Pencil stamps: 38 lines duplicating stamp computation
- Default fill + grain: 51 lines duplicating grain overlay

`renderPointsToStatic()` (83 lines) is a third copy of the same branching.

#### PenConfigs.ts -- Flat Bag of Nullable Fields

`PenConfig` has 20+ fields, most null for any given pen:
- `grain`, `stamp`, `inkStamp`, `nibAngle`, `nibThickness`, `highlighterMode`, `tiltConfig`...
- Each new pen type's features get added as more nullable fields, expanding the interface for all pens
- Configs describe parameters but not rendering behavior -- the behavior mapping is implicit in the if/else chains

#### Stamp Systems -- Parallel Without Sharing

`StampRenderer.ts` (461 lines) and `InkStampRenderer.ts` (380 lines):
- Both have: params type, accumulator, `computeStamps()`, `computeAllStamps()`, `drawStamps()`, `createAccumulator()`
- Both walk the stroke path with identical interpolation logic
- `StampPacking.ts` has two near-identical packing functions

No shared `BaseStampParams`, no common path-walking framework, no unified draw function.

#### Resource Forwarding -- 7+ Methods Per Texture Type

Adding a new stamp type requires:
1. `Renderer.initNewStamps()` -- create manager, pre-warm cache
2. Forward to `tiledLayer.tileRenderer.setNewStampManager()`
3. Forward to `tiledLayer.webglTileEngine.setNewStampManager()`
4. Forward to `tiledLayer.initWorkerNewStamps()`
5. `TileRenderer` setter + context creation update
6. `WebGLTileEngine` setter + context creation update
7. `TiledStaticLayer` forwarding method

### Files That Must Change to Add a Stamped Pen Type

| File | Changes Required |
|------|-----------------|
| `types.ts` | Extend `PenType` union |
| `PenConfigs.ts` | New config entry, possibly new nullable fields |
| `StrokeRenderCore.ts` | New branch in `renderStrokeToContext()` |
| `StrokeRenderCore.ts` | Same branch in `renderStrokeToEngine()` |
| `Renderer.ts` | New branch in `renderActiveStroke()` |
| `Renderer.ts` | New branch in `renderPointsToStatic()` |
| `Renderer.ts` | New `initNewStamps()` method + forwarding |
| `TiledStaticLayer` | New forwarding methods |
| `TileRenderer.ts` | Setter, context creation update |
| `WebGLTileEngine.ts` | Setter, context creation update |
| New `NewStampRenderer.ts` | Copy patterns from existing stamp renderers |
| `StampPacking.ts` | New packing function |

**Total: 10-12 locations.** This is the root cause of repeated mistakes -- the blast radius is too large.

---

## 3. Industry Research

### Key Projects Analyzed

| Project | Pattern | Pen Extensibility | Backend Abstraction | Relevance |
|---------|---------|-------------------|---------------------|-----------|
| **Krita** | Factory + Plugin + Abstract PaintOp | Very High (18 brush engines, zero existing code changes) | N/A (C++) | Gold standard for extensibility |
| **libmypaint** | Surface Abstraction + Dab Pipeline | High (data-driven JSON brush defs) | Yes (MyPaintSurface interface) | Cleanest backend separation |
| **tldraw** | ShapeUtil Strategy + Registry | High (implement interface, register) | None (DOM) | Clean dispatch pattern |
| **PixiJS** | Abstract Renderer + Modular Systems | N/A | Yes (WebGL/WebGPU/Canvas) | Multi-backend pattern |
| **Konva** | Strategy (`_sceneFunc`) | High | None (Canvas2D) | Per-shape render strategy |
| **Excalidraw** | Type-dispatch switch/if | Low (modify central render fn) | None | **Same as our current approach** |
| **Fabric.js** | Class hierarchy + Template Method | Medium | None | Simple inheritance |
| **Drawpile** | Union type + Layered Pipeline | Medium | Yes (CanvasWrapper) | Real-time collaborative |

### Key Insights

1. **Krita's principle: "Enforce as little policy as possible."** Brush engines are not forced into a rigid framework. Each provides a `paintAt()` method and can implement any rendering strategy internally. Convenience base classes reduce boilerplate without mandating structure.

2. **libmypaint's Surface Abstraction** is the cleanest rendering backend separation found. The brush engine generates dabs; the surface renders them through an abstract interface. Our `RenderEngine` already mirrors this.

3. **The Material metaphor** (from game engines) is the most powerful conceptual model:
   - Stroke geometry = Mesh
   - PenConfig = Material parameters (uniforms)
   - Pen rendering logic = Shader program
   - Stamp/grain textures = Material textures
   - RenderEngine = Graphics backend

4. **Excalidraw uses our current approach** (type-dispatch in a monolithic render function) -- and it's identified as the least extensible pattern across all projects analyzed.

5. **PixiJS validates feature subsetting** -- the Canvas2D backend deliberately supports only a subset of WebGL features. Feature detection over feature parity.

---

## 4. Design Pattern Evaluation

### Patterns Analyzed

| Pattern | Pen Extensibility | Engine Dedup | Effect Composability | Complexity | Verdict |
|---------|-------------------|-------------|---------------------|------------|---------|
| Strategy | Excellent | None (needs Bridge) | Poor | Low | Good for pen dispatch |
| Template Method | Good | None | Moderate | Low-Med | Fragile base class risk |
| ECS | Good | Via system | Excellent | High | Overkill for 5 pens |
| Command | Moderate | Via context | Moderate | Med-High | GC pressure, ordering still manual |
| Pipeline (middleware) | Good | Via context | Good | Moderate | Subtle control flow |
| Visitor | Poor | Via context | Poor | High | Expression problem |
| Abstract Factory | N/A | Excellent | N/A | Low | Only solves engine dimension |
| **Bridge** | **Excellent** (w/Strategy) | **Excellent** | Moderate | Moderate | **Best for engine abstraction** |
| Decorator | Good for effects | Via context | Excellent | Moderate | Awkward for exclusive body types |
| **Material System** | **Excellent** | **Excellent** | **Good** | Moderate | **Best for pen dispatch** |

### Why Bridge + Material System

**Bridge Pattern** solves the engine dimension: A unified `DrawingBackend` interface means pen rendering logic is written once and works with both Canvas2D and WebGL. This directly eliminates the `renderStrokeToContext` / `renderStrokeToEngine` duplication.

**Material System** solves the pen type dimension: Each pen type is a declarative `StrokeMaterial` data object (body type, blend mode, effects list). A single `executeMaterial()` function interprets materials against any backend. Adding a pen type = defining a new material data object.

Together they eliminate both axes of duplication while keeping complexity moderate.

### Rejected Alternatives

- **Pure Strategy**: Solves pen dispatch but doesn't address engine duplication. Each strategy would still need Canvas2D and WebGL code paths.
- **Template Method**: Fragile base class. Adding a pen that needs a fundamentally different flow (e.g., multiple offscreen passes) forces base class changes.
- **ECS**: 5 pen types with 3-4 effects each doesn't justify the overhead. Ordering dependencies between components (fill before grain, stamps before mask) reintroduce complexity.
- **Decorator**: Excellent for layered effects but awkward for mutually exclusive body types (stamps vs fill). Order sensitivity is a debugging hazard.

---

## 5. Recommended Architecture: Bridge + Material System

### Architecture Overview

```
PenConfig + Pipeline + Style
        |
        v
  resolveMaterial(penType, pipeline, style)
        |
        v
  StrokeMaterial (pure data)
  {
    body: "fill" | "stamps" | "inkShading",
    blending: { mode, opacity },
    effects: [grain?, outlineMask?, inkPooling?],
    isolation: "none" | "offscreen"
  }
        |
        v
  executeMaterial(backend, material, strokeData)
        |
        v
  DrawingBackend interface
       / \
      /   \
Canvas2D  WebGL
Backend   Backend
```

### Core Principles

1. **Pen types are data, not code branches.** A `StrokeMaterial` is a declarative recipe that says "draw stamps, then apply grain" -- not imperative code that calls Canvas2D methods.

2. **One rendering path, two backends.** The `executeMaterial()` function is written once. It calls `DrawingBackend` methods. Canvas2D and WebGL implement those methods differently but the dispatch logic is identical.

3. **Effects are composable building blocks.** Grain, ink pooling, outline masking are `MaterialEffect` types. The executor applies them in order. New effects are added to the discriminated union with compile-time exhaustiveness checking.

4. **Active strokes use the same materials.** Active stroke rendering calls the same `executeMaterial()` with a simplified material (effects omitted for performance where appropriate), eliminating the duplicated dispatch in `Renderer.renderActiveStroke()`.

5. **Resources are managed by the material system.** Stamp textures, grain textures, and offscreen buffers are accessed through a `MaterialResources` context object, eliminating per-type forwarding boilerplate.

---

## 6. Detailed Design

### 6.1 DrawingBackend Interface (Bridge)

```typescript
/**
 * Unified drawing interface that abstracts Canvas2D and WebGL.
 * All pen rendering logic calls this interface -- never raw ctx or engine methods.
 */
interface DrawingBackend {
  // --- Geometry ---
  fillPath(vertices: Float32Array, color: string, opacity: number): void;
  fillTriangles(vertices: Float32Array, color: string, opacity: number): void;

  // --- Stamps ---
  drawStampDiscs(color: string, data: Float32Array, opacity: number): void;
  drawStamps(texture: TextureRef, data: Float32Array, opacity: number): void;

  // --- Effects ---
  applyGrain(texture: TextureRef, anchorX: number, anchorY: number, strength: number): void;
  maskToPath(vertices: Float32Array): void;
  maskToTriangles(vertices: Float32Array): void;

  // --- Offscreen Isolation ---
  beginOffscreen(width: number, height: number): void;
  endOffscreen(): void;
  compositeOffscreen(dx: number, dy: number, dw: number, dh: number): void;

  // --- State ---
  save(): void;
  restore(): void;
  setBlendMode(mode: BlendMode): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  getTransform(): TransformData;

  // --- Clipping ---
  clipRect(x: number, y: number, w: number, h: number): void;

  // --- Canvas Info ---
  readonly width: number;
  readonly height: number;
}
```

**Canvas2DBackend** wraps `CanvasRenderingContext2D`:
- `fillPath()` converts Float32Array to Path2D via `outlineToPath2D()`, calls `ctx.fill()`
- `drawStampDiscs()` loops `ctx.arc()` per stamp
- `applyGrain()` creates CanvasPattern, fills with `destination-out`
- `maskToPath()` sets `globalCompositeOperation = "destination-in"`, fills path
- `beginOffscreen()` creates/reuses OffscreenCanvas, saves transform

**WebGLBackend** wraps `WebGL2Engine`:
- `fillPath()` calls `engine.fillPath()` (stencil nonzero winding)
- `fillTriangles()` calls `engine.fillTriangles()` (stencil replace)
- `drawStampDiscs()` calls `engine.drawStampDiscs()` (instanced SDF)
- `applyGrain()` calls `engine.applyGrain()` (fullscreen shader)
- `maskToPath()` calls `engine.maskToPath()` (3-pass stencil)
- `beginOffscreen()` binds FBO

**Key design decision: operation granularity.** Operations like `fillPath` combine setting color + opacity + filling in one call. This is higher-level than raw `ctx.fillStyle = color; ctx.globalAlpha = opacity; ctx.fill(path)`, reducing boilerplate in materials without being so high-level that backends duplicate pen logic. The guiding principle: **operations correspond to visual concepts (fill a shape, draw stamps, apply grain), not to API calls.**

### 6.2 StrokeMaterial (Declarative Pen Definition)

```typescript
/**
 * Declarative description of how a stroke should be rendered.
 * Pure data -- no rendering logic, no engine references.
 */
interface StrokeMaterial {
  /** The main body rendering strategy */
  body: StrokeBody;

  /** Blend mode and base opacity */
  blending: {
    mode: BlendMode;
    opacity: number;           // 1.0 for most pens, 0.3 for highlighter
    opacitySource: "fixed" | "style";  // "style" reads from PenStyle.opacity
  };

  /** Whether body rendering uses italic (triangle-based) vertices */
  italic: boolean;

  /** Whether the body + effects need offscreen isolation */
  isolation: "none" | "offscreen";

  /** Post-effects applied after body rendering, in order */
  effects: MaterialEffect[];
}

/** Body rendering strategy -- discriminated union */
type StrokeBody =
  | { type: "fill" }
  | { type: "stamps"; stampConfig: PenStampConfig }
  | { type: "inkShading"; inkConfig: InkStampConfig; preset: InkPresetConfig };

/** Post-effect -- discriminated union */
type MaterialEffect =
  | { type: "grain"; strengthSource: "config" | "override" }
  | { type: "outlineMask" }
  | { type: "inkPooling" };
```

### 6.3 Material Definitions Per Pen Type

```typescript
function resolveMaterial(
  penType: PenType,
  pipeline: RenderPipeline,
  penConfig: PenConfig,
  style: PenStyle,
): StrokeMaterial {
  const isAdvanced = pipeline === "advanced";

  switch (penType) {
    case "ballpoint":
      return {
        body: { type: "fill" },
        blending: { mode: "source-over", opacity: 1.0, opacitySource: "style" },
        italic: false,
        isolation: "none",
        effects: [],
      };

    case "felt-tip":
      return {
        body: { type: "fill" },
        blending: { mode: "source-over", opacity: 1.0, opacitySource: "style" },
        italic: false,
        isolation: "none",
        effects: [],
      };

    case "pencil":
      if (isAdvanced && penConfig.stamp) {
        return {
          body: { type: "stamps", stampConfig: penConfig.stamp },
          blending: { mode: "source-over", opacity: 1.0, opacitySource: "style" },
          italic: false,
          isolation: penConfig.grain?.enabled ? "offscreen" : "none",
          effects: penConfig.grain?.enabled
            ? [{ type: "grain", strengthSource: "config" }]
            : [],
        };
      }
      return {
        body: { type: "fill" },
        blending: { mode: "source-over", opacity: 1.0, opacitySource: "style" },
        italic: false,
        isolation: penConfig.grain?.enabled ? "offscreen" : "none",
        effects: penConfig.grain?.enabled
          ? [{ type: "grain", strengthSource: "config" }]
          : [],
      };

    case "fountain":
      if (isAdvanced && penConfig.inkStamp) {
        return {
          body: { type: "inkShading", inkConfig: penConfig.inkStamp, preset: resolveInkPreset(style) },
          blending: { mode: "source-over", opacity: 1.0, opacitySource: "style" },
          italic: style.nibAngle != null,
          isolation: "offscreen",
          effects: [
            { type: "outlineMask" },
            ...(style.nibAngle == null ? [{ type: "inkPooling" } as const] : []),
          ],
        };
      }
      return {
        body: { type: "fill" },
        blending: { mode: "source-over", opacity: 1.0, opacitySource: "style" },
        italic: style.nibAngle != null,
        isolation: "none",
        effects: [],
      };

    case "highlighter":
      return {
        body: { type: "fill" },
        blending: { mode: "multiply", opacity: penConfig.baseOpacity, opacitySource: "fixed" },
        italic: false,
        isolation: "none",
        effects: [],
      };

    default: {
      const _exhaustive: never = penType;
      throw new Error(`Unknown pen type: ${_exhaustive}`);
    }
  }
}
```

**Adding a new pen type** = adding a new case to this switch. If the new pen uses existing body types and effects, that's the only change needed. The exhaustive switch ensures the compiler flags any missing cases.

### 6.4 Material Executor

```typescript
/**
 * Resources needed to execute materials. Injected by the caller,
 * eliminating per-type resource forwarding.
 */
interface MaterialResources {
  getStampTexture(color: string, grainValue: number): TextureRef;
  getInkStampTexture(presetId: string, color: string): TextureRef;
  getGrainTexture(): TextureRef;
  getGrainStrength(strokeId: string, configStrength: number): number;
}

/**
 * Pre-computed stroke data passed to the executor.
 * Separates data preparation from rendering.
 */
interface StrokeRenderData {
  /** Path vertices (Float32Array) -- outline or italic triangles */
  vertices: Float32Array;
  /** Resolved color string */
  color: string;
  /** World-space bounding box */
  bbox: [number, number, number, number];
  /** Stamp data (if body.type === "stamps") */
  stampData?: Float32Array;
  /** Ink stamp data (if body.type === "inkShading") */
  inkStampData?: Float32Array;
  /** Ink pools (if effects include inkPooling) */
  inkPools?: InkPool[];
  /** Grain anchor point */
  grainAnchor?: { x: number; y: number };
  /** Style opacity */
  styleOpacity: number;
  /** Pen config grain settings */
  grainConfig?: PenGrainConfig;
}

/**
 * Execute a material against a backend. This is the SINGLE rendering
 * function that replaces all if/else chains.
 */
function executeMaterial(
  backend: DrawingBackend,
  material: StrokeMaterial,
  data: StrokeRenderData,
  resources: MaterialResources,
): void {
  // 1. Compute screen-space region for offscreen isolation
  let region: ScreenRegion | null = null;
  if (material.isolation === "offscreen") {
    region = computeScreenBBox(data.bbox, backend.getTransform(), backend.width, backend.height);
    if (region) {
      backend.beginOffscreen(region.sw, region.sh);
    }
  }

  // 2. Set blending
  const opacity = material.blending.opacitySource === "style"
    ? data.styleOpacity * material.blending.opacity
    : material.blending.opacity;

  if (material.blending.mode !== "source-over") {
    backend.save();
    backend.setBlendMode(material.blending.mode);
  }

  // 3. Render body
  renderBody(backend, material.body, data, resources, opacity, material.italic);

  if (material.blending.mode !== "source-over") {
    backend.restore();
  }

  // 4. Apply effects in order
  for (const effect of material.effects) {
    applyEffect(backend, effect, data, resources, region);
  }

  // 5. Close offscreen isolation
  if (material.isolation === "offscreen" && region) {
    backend.endOffscreen();
    backend.compositeOffscreen(region.sx, region.sy, region.sw, region.sh);
  }
}

function renderBody(
  backend: DrawingBackend,
  body: StrokeBody,
  data: StrokeRenderData,
  resources: MaterialResources,
  opacity: number,
  italic: boolean,
): void {
  switch (body.type) {
    case "fill":
      if (italic) {
        backend.fillTriangles(data.vertices, data.color, opacity);
      } else {
        backend.fillPath(data.vertices, data.color, opacity);
      }
      break;

    case "stamps":
      if (data.stampData) {
        backend.drawStampDiscs(data.color, data.stampData, opacity);
      }
      break;

    case "inkShading":
      if (data.inkStampData) {
        const texture = resources.getInkStampTexture(body.preset.id, data.color);
        backend.drawStamps(texture, data.inkStampData, opacity);
      }
      break;

    default: {
      const _exhaustive: never = body;
      throw new Error(`Unknown body type: ${(_exhaustive as StrokeBody).type}`);
    }
  }
}

function applyEffect(
  backend: DrawingBackend,
  effect: MaterialEffect,
  data: StrokeRenderData,
  resources: MaterialResources,
  region: ScreenRegion | null,
): void {
  switch (effect.type) {
    case "grain": {
      const configStrength = data.grainConfig?.strength ?? 0;
      const strength = effect.strengthSource === "override"
        ? resources.getGrainStrength(/* strokeId */ "", configStrength)
        : configStrength;
      if (strength > 0 && data.grainAnchor) {
        const tex = resources.getGrainTexture();
        backend.applyGrain(tex, data.grainAnchor.x, data.grainAnchor.y, strength);
      }
      break;
    }

    case "outlineMask":
      if (data.vertices) {
        // Material knows whether italic triangles or path outline
        // Backend handles the distinction internally
        backend.maskToPath(data.vertices);
      }
      break;

    case "inkPooling":
      if (data.inkPools && data.inkPools.length > 0) {
        renderInkPools(backend, data.inkPools, data.color);
      }
      break;

    default: {
      const _exhaustive: never = effect;
      throw new Error(`Unknown effect type: ${(_exhaustive as MaterialEffect).type}`);
    }
  }
}
```

### 6.5 Active Stroke Integration

Active stroke rendering uses the same material system:

```typescript
// In Renderer.renderActiveStroke():
function renderActiveStroke(
  backend: DrawingBackend,
  points: StrokePoint[],
  style: PenStyle,
  pipeline: RenderPipeline,
  pageRect: Rect,
  resources: MaterialResources,
): void {
  const penConfig = getPenConfig(style.pen);
  const material = resolveMaterial(style.pen, pipeline, penConfig, style);

  // For active strokes, simplify: skip ink pooling (only on completed strokes)
  const activeMaterial = {
    ...material,
    effects: material.effects.filter(e => e.type !== "inkPooling"),
  };

  // Prepare data from live points (not encoded stroke)
  const data = prepareActiveStrokeData(points, style, penConfig, pipeline, resources);

  // Same executor, same backend, same material system
  executeMaterial(backend, activeMaterial, data, resources);
}
```

This eliminates the 198-line `renderActiveStroke()` method with its duplicated dispatch.

### 6.6 Unified Resource Management

Replace per-type forwarding with a single resource context:

```typescript
/**
 * Manages all stamp, grain, and texture resources.
 * Single object forwarded to tile renderers, replacing
 * per-type setters.
 */
class MaterialResourceManager implements MaterialResources {
  private grainGenerator: GrainTextureGenerator | null = null;
  private stampManagers: Map<string, StampTextureManager> = new Map();
  private grainStrengthOverrides: Map<string, number> = new Map();

  // Initialization
  initGrain(generator: GrainTextureGenerator): void { ... }
  registerStampManager(id: string, manager: StampTextureManager): void { ... }

  // MaterialResources interface
  getStampTexture(color: string, grainValue: number): TextureRef { ... }
  getInkStampTexture(presetId: string, color: string): TextureRef { ... }
  getGrainTexture(): TextureRef { ... }
  getGrainStrength(strokeId: string, configStrength: number): number { ... }
}
```

Now adding a new stamp type = calling `resources.registerStampManager("myNewStamp", manager)` once. No forwarding methods needed. TileRenderer, WebGLTileEngine, and workers all receive the same `MaterialResources` reference.

### 6.7 Unified Stamp Abstraction

Replace parallel stamp systems with a shared framework:

```typescript
/**
 * Base stamp parameters -- shared by all stamp types.
 */
interface StampParams {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

/**
 * Stamp generator interface -- each stamp type implements this.
 */
interface StampGenerator {
  computeStamps(
    points: StrokePoint[],
    style: PenStyle,
    config: PenStampConfig | InkStampConfig,
    fromIndex: number,
  ): StampParams[];

  computeAllStamps(
    points: StrokePoint[],
    style: PenStyle,
    config: PenStampConfig | InkStampConfig,
  ): StampParams[];
}

/**
 * Shared path-walking logic -- extracted from both StampRenderer and InkStampRenderer.
 */
function walkStrokePath(
  points: StrokePoint[],
  spacing: number,
  fromIndex: number,
  callback: (point: InterpolatedPoint, segIndex: number) => void,
): void {
  // Common interpolation logic, called by all stamp generators
}

/**
 * Shared stamp packing.
 */
function packStamps(stamps: StampParams[], minOpacity?: number): Float32Array {
  // Single packing function for all stamp types
}
```

### 6.8 File Structure

```
src/
  rendering/
    DrawingBackend.ts          # Interface definition
    Canvas2DBackend.ts         # Canvas2D implementation
    WebGLBackend.ts            # WebGL implementation
    StrokeMaterial.ts          # Material types + resolveMaterial()
    MaterialExecutor.ts        # executeMaterial(), renderBody(), applyEffect()
    MaterialResources.ts       # Resource management interface + manager
    StrokeDataPreparer.ts      # prepareStrokeData() + prepareActiveStrokeData()
  stamps/
    StampTypes.ts              # Shared StampParams, StampGenerator interface
    PathWalker.ts              # Shared path-walking logic
    StampPacking.ts            # Unified packing (single function)
    PencilStampGenerator.ts    # Pencil-specific scatter stamps
    InkStampGenerator.ts       # Fountain pen ink stamps
    NewPenStampGenerator.ts    # (future) New pen type stamps
```

---

## 7. Stress Test: Felt-Tip Stamps

To validate the architecture before implementation, we tested it against a concrete upcoming feature: advanced pipeline rendering for felt-tip pens. This exposed three gaps in the initial design.

### Requirements

Felt-tip pens in the advanced pipeline need:

1. **Inverse grain (paper texture)**: A solid color fill with lighter, transparent dot patterns representing the paper texture underneath. This is the visual inverse of pencil grain -- where pencil is sparse dots on empty space, felt-tip is solid color with subtle texture holes.
2. **Frayed outline**: Slightly irregular, fibrous edges -- not the clean Bezier curves that `perfect-freehand` produces. Real felt-tip markers leave slightly ragged edges as fibers at the tip splay.

### What the Initial Architecture Handles

The "inverse grain" is the **same compositing operation** as pencil grain -- `destination-out`. The difference is texture character and intensity:

| | Pencil Grain | Felt-Tip Paper Texture |
|--|--|--|
| Texture | Coarse simplex noise clusters | Fine dot/fiber pattern |
| Strength | Heavy erasure (sparse graphite look) | Light erasure (subtle paper texture) |
| Compositing | `destination-out` | `destination-out` (identical) |
| Visual Result | Sparse marks on paper | Solid color with micro-texture |

So the existing `grain` effect type works for the compositing logic. The material definition would use the same structure as pencil's grain effect. **The material system's body + effects model handles this correctly.**

### Gap 1: Single Grain Texture (No Texture Registry)

**Problem:** The initial `MaterialResources.getGrainTexture()` returns one texture. The pencil needs coarse simplex noise clusters; the felt-tip needs a fine dot/fiber pattern. These are different textures.

**Root cause:** The initial design assumed grain = one texture. In reality, different pen types need different grain textures, and potentially at different sizes and with different generation algorithms.

**Fix:** The grain effect needs a `textureId` field, and `MaterialResources` must support a texture registry:

```typescript
// BEFORE (initial design)
type MaterialEffect =
  | { type: "grain"; strengthSource: "config" | "override" }

interface MaterialResources {
  getGrainTexture(): TextureRef;
}

// AFTER (revised)
type MaterialEffect =
  | { type: "grain"; textureId: string; strengthSource: "config" | "override" }

interface MaterialResources {
  getGrainTexture(textureId: string): TextureRef;
}
```

Material definitions become:

```typescript
// Pencil
effects: [{ type: "grain", textureId: "pencil-graphite", strengthSource: "config" }]

// Felt-tip
effects: [{ type: "grain", textureId: "felt-tip-paper", strengthSource: "config" }]
```

The `MaterialResourceManager` holds a `Map<string, GrainTextureGenerator>` instead of a single generator. Each pen type registers its grain texture at initialization. This is a small change to the resource manager, and the registration is a one-time setup call -- no forwarding boilerplate.

### Gap 2: No Outline Generation Strategy

**Problem:** The material system describes how to render pre-computed vertices, but a frayed felt-tip outline changes the *geometry itself*. The initial architecture has no way to specify which outline generation strategy to use per pen type.

**Root cause:** Outline generation was treated as an implicit pre-processing step, not as a configurable part of the pipeline.

Currently, outline generation is already pen-specific:
- Most pens: `OutlineGenerator` wrapping `perfect-freehand`
- Fountain pen: `ItalicOutlineGenerator`

But this selection is hardcoded in the data preparation code, not declared in the pen configuration.

**Fix:** Add an `outlineStrategy` to `PenConfig` and create an `OutlineGenerator` registry:

```typescript
// In PenConfig
interface PenConfig {
  // ... existing fields ...
  outlineStrategy: OutlineStrategyId;
}

type OutlineStrategyId = "standard" | "italic" | "frayed";

// Registry
interface OutlineStrategy {
  generateOutline(
    points: StrokePoint[],
    style: PenStyle,
    config: PenConfig,
    dejitter: boolean,
  ): OutlineResult;
}

interface OutlineResult {
  /** Float32Array of path vertices OR italic triangle vertices */
  vertices: Float32Array;
  /** Whether vertices are triangle-based (italic) or polygon-based (standard) */
  italic: boolean;
}

const OUTLINE_STRATEGIES: Record<OutlineStrategyId, OutlineStrategy> = {
  standard: new StandardOutlineStrategy(),   // wraps perfect-freehand
  italic: new ItalicOutlineStrategy(),       // wraps ItalicOutlineGenerator
  frayed: new FrayedOutlineStrategy(),       // new: perfect-freehand + edge noise
};
```

The data preparation step (`prepareStrokeData`) looks up the strategy from the pen config:

```typescript
function prepareStrokeData(stroke: Stroke, style: PenStyle, penConfig: PenConfig): StrokeRenderData {
  const strategy = OUTLINE_STRATEGIES[penConfig.outlineStrategy];
  const { vertices, italic } = strategy.generateOutline(points, style, penConfig, true);
  // ... rest of data preparation
}
```

The `FrayedOutlineStrategy` implementation would:
1. Generate a smooth outline via `perfect-freehand` (same as standard)
2. Apply displacement noise to the polygon vertices (perpendicular to edge direction)
3. The noise is seeded from the stroke's first point for determinism across redraws

This keeps the material system clean -- it still receives pre-computed vertices and doesn't need to know about fraying. The outline strategy is a **data preparation concern**, separate from but parallel to the material system.

**Full pipeline with the fix:**

```
StrokePoint[] + PenConfig
        |
        v
  OutlineStrategy registry        <-- NEW: pen-specific geometry
  (standard, italic, frayed)
        |
        v
  StrokeRenderData { vertices, italic, stampData?, ... }
        |
        v
  resolveMaterial() → StrokeMaterial
        |
        v
  executeMaterial(backend, material, data, resources)
        |
        v
  DrawingBackend interface
       / \
      /   \
Canvas2D  WebGL
Backend   Backend
```

### Gap 3: No Stamp Generator Registry

**Problem:** If felt-tip stamps differ from pencil stamps (different scatter distribution, particle size, density model), each pen needs its own stamp generation logic. The initial design had a unified `StampGenerator` interface but no formal way to select which generator a pen uses.

**Root cause:** Stamp generation was implicitly per-pen-type (pencil uses `StampRenderer`, fountain uses `InkStampRenderer`) but the selection was hardcoded in the dispatch branches rather than declared in configuration.

**Fix:** Add a `stampGeneratorId` to the stamp body type and create a stamp generator registry:

```typescript
// Body type references a generator by ID
type StrokeBody =
  | { type: "fill" }
  | { type: "stamps"; generatorId: string; stampConfig: PenStampConfig }
  | { type: "inkShading"; generatorId: string; inkConfig: InkStampConfig; preset: InkPresetConfig };

// Registry
const STAMP_GENERATORS: Record<string, StampGenerator> = {
  "pencil-scatter": new PencilScatterGenerator(),
  "ink-shading": new InkShadingGenerator(),
  "felt-tip-fiber": new FeltTipFiberGenerator(),  // future
};
```

The data preparation step uses the generator ID from the material's body to compute stamps:

```typescript
function prepareStrokeData(stroke, style, penConfig, material): StrokeRenderData {
  // ...
  if (material.body.type === "stamps") {
    const generator = STAMP_GENERATORS[material.body.generatorId];
    data.stampData = packStamps(generator.computeAllStamps(points, style, material.body.stampConfig));
  }
  // ...
}
```

All generators share the same `StampGenerator` interface and reuse the common `walkStrokePath()` and `packStamps()` functions. The per-pen differences live in the generator implementations -- scatter distribution, particle size, density model, tilt response, etc.

### Felt-Tip Complete Example (With Revised Architecture)

Here's how the felt-tip advanced pipeline would be added, end-to-end:

**Step 1: PenConfig (modify existing entry)**
```typescript
// In PEN_CONFIGS["felt-tip"]
{
  // ... existing fields ...
  outlineStrategy: "frayed",           // NEW: frayed edges
  grain: {                             // NEW: paper texture
    enabled: true,
    strength: 0.15,                    // Much lighter than pencil's 0.5
  },
  stamp: null,                         // Felt-tip uses fill body, not stamps
}
```

**Step 2: Grain texture generator (new file)**
```typescript
// src/rendering/textures/FeltTipGrainGenerator.ts
class FeltTipGrainGenerator extends GrainTextureGenerator {
  // Override to produce fine dot/fiber pattern instead of simplex noise clusters
  // Different threshold, softness, and noise frequency
}
```

**Step 3: Register grain texture (one-time init)**
```typescript
resources.registerGrainTexture("felt-tip-paper", new FeltTipGrainGenerator());
```

**Step 4: Outline strategy (new file)**
```typescript
// src/stroke/FrayedOutlineStrategy.ts
class FrayedOutlineStrategy implements OutlineStrategy {
  generateOutline(points, style, config, dejitter): OutlineResult {
    // 1. Generate smooth outline via perfect-freehand
    const smoothOutline = generateStandardOutline(points, style, config, dejitter);
    // 2. Apply perpendicular displacement noise to vertices
    const frayedVertices = applyEdgeNoise(smoothOutline.vertices, {
      amplitude: style.width * 0.08,  // Fraying proportional to pen width
      frequency: 0.3,                  // Noise frequency along edge
      seed: hashPoint(points[0]),      // Deterministic per stroke
    });
    return { vertices: frayedVertices, italic: false };
  }
}
```

**Step 5: Register outline strategy (one-time init)**
```typescript
OUTLINE_STRATEGIES["frayed"] = new FrayedOutlineStrategy();
```

**Step 6: Material definition (modify resolveMaterial)**
```typescript
case "felt-tip":
  if (isAdvanced && penConfig.grain?.enabled) {
    return {
      body: { type: "fill" },
      blending: { mode: "source-over", opacity: 1.0, opacitySource: "style" },
      italic: false,
      isolation: "offscreen",
      effects: [
        { type: "grain", textureId: "felt-tip-paper", strengthSource: "config" },
      ],
    };
  }
  return {
    body: { type: "fill" },
    blending: { mode: "source-over", opacity: 1.0, opacitySource: "style" },
    italic: false,
    isolation: "none",
    effects: [],
  };
```

**What was NOT modified:**
- `executeMaterial()` -- unchanged, it already handles `fill` body + `grain` effect
- `DrawingBackend` / `Canvas2DBackend` / `WebGLBackend` -- unchanged
- `Renderer.ts` / `renderActiveStroke()` -- unchanged (uses material system)
- `StrokeRenderCore.ts` -- unchanged (replaced by material system)
- `TileRenderer.ts` / `WebGLTileEngine.ts` -- unchanged (uses `MaterialResources`)
- `TiledStaticLayer` -- unchanged (no forwarding methods needed)
- `StampPacking.ts` -- unchanged (no stamps for felt-tip)

**Files touched: 4** (PenConfig, grain generator, outline strategy, material definition) vs **10-12** in the current architecture.

### Stress Test: Truly Novel Rendering

What about a pen type that doesn't fit existing body types at all -- say, a watercolor pen with multi-pass wet-edge diffusion?

This would require:
1. A new `StrokeBody` variant: `{ type: "watercolor"; diffusionConfig: WatercolorConfig }`
2. A new case in `renderBody()` within the executor
3. Possibly new `DrawingBackend` methods if the rendering needs primitives not yet abstracted

This means the executor is **not fully closed** to modification for truly novel body types. However:
- It's **one** place to add the logic (not 3 copies)
- The TypeScript exhaustive switch forces handling everywhere
- It works with both backends automatically through `DrawingBackend`
- Effects remain composable -- watercolor + grain would just work

The architecture is designed for the **common case** (new pens reuse existing body types and effects) to be zero-modification, while the **novel case** (genuinely new rendering strategy) requires targeted, minimal changes to the executor.

---

## 8. Revised Architecture (Post Stress Test)

The stress test revealed three registries that the initial design was missing. Here is the complete revised architecture:

### 8.1 Three-Registry Architecture

```
                    PenConfig
                   /    |    \
                  /     |     \
                 v      v      v
  OutlineStrategy   StrokeMaterial    StampGenerator
    Registry          (data)           Registry
        |               |                 |
        v               v                 v
  StrokeRenderData   executeMaterial()   stampData
  { vertices }       { body, effects }  (Float32Array)
                        |
                        v
                MaterialResources
                (GrainTexture Registry
                 + StampTexture Registry)
                        |
                        v
                  DrawingBackend
                     /     \
                    /       \
              Canvas2D    WebGL
              Backend     Backend
```

**Registry 1: Outline Strategies** -- How stroke geometry is generated from input points.
```typescript
const OUTLINE_STRATEGIES: Record<OutlineStrategyId, OutlineStrategy> = {
  standard: new StandardOutlineStrategy(),   // perfect-freehand
  italic:   new ItalicOutlineStrategy(),     // ItalicOutlineGenerator
  frayed:   new FrayedOutlineStrategy(),     // perfect-freehand + edge noise
};
```

**Registry 2: Stamp Generators** -- How stamp/particle positions are computed along the stroke path.
```typescript
const STAMP_GENERATORS: Record<string, StampGenerator> = {
  "pencil-scatter":  new PencilScatterGenerator(),   // center-biased polar scatter
  "ink-shading":     new InkShadingGenerator(),      // velocity-dependent ink deposit
  "felt-tip-fiber":  new FeltTipFiberGenerator(),    // (future example)
};
```

**Registry 3: Grain Textures** -- Named texture generators, each producing a different tileable pattern.
```typescript
const GRAIN_TEXTURES: Record<string, GrainTextureGenerator> = {
  "pencil-graphite": new PencilGrainGenerator(),     // coarse simplex noise clusters
  "felt-tip-paper":  new FeltTipGrainGenerator(),    // fine dot/fiber pattern
};
```

### 8.2 Revised Type Definitions

```typescript
/** Outline generation strategy, declared per pen type */
type OutlineStrategyId = "standard" | "italic" | "frayed";

interface OutlineStrategy {
  generateOutline(
    points: StrokePoint[],
    style: PenStyle,
    config: PenConfig,
    dejitter: boolean,
  ): OutlineResult;
}

interface OutlineResult {
  vertices: Float32Array;
  italic: boolean;
}

/** Stamp generator interface -- shared path-walking, pen-specific scatter */
interface StampGenerator {
  computeAllStamps(
    points: StrokePoint[],
    style: PenStyle,
    config: PenStampConfig | InkStampConfig,
  ): StampParams[];

  /** Incremental computation for active strokes */
  computeStamps(
    points: StrokePoint[],
    style: PenStyle,
    config: PenStampConfig | InkStampConfig,
    fromIndex: number,
    accumulator: StampAccumulator,
  ): StampParams[];
}

/** Base stamp params -- shared by all stamp types */
interface StampParams {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

/** Grain texture referenced by ID in material effects */
type MaterialEffect =
  | { type: "grain"; textureId: string; strengthSource: "config" | "override" }
  | { type: "outlineMask" }
  | { type: "inkPooling" };

/** Body types reference stamp generators by ID */
type StrokeBody =
  | { type: "fill" }
  | { type: "stamps"; generatorId: string; stampConfig: PenStampConfig }
  | { type: "inkShading"; generatorId: string; inkConfig: InkStampConfig; preset: InkPresetConfig };

/** Material resources with keyed texture access */
interface MaterialResources {
  getGrainTexture(textureId: string): TextureRef;
  getStampTexture(managerId: string, color: string, grainValue: number): TextureRef;
  getInkStampTexture(managerId: string, presetId: string, color: string): TextureRef;
  getGrainStrength(textureId: string, strokeId: string, configStrength: number): number;
}
```

### 8.3 Revised PenConfig

```typescript
interface PenConfig {
  // --- Existing fields (unchanged) ---
  pressureWidthRange: [number, number];
  pressureOpacityRange: [number, number] | null;
  thinning: number;
  smoothing: number;
  streamline: number;
  taper: { start: number; end: number } | null;
  tiltConfig: PenTiltConfig | null;
  baseOpacity: number;
  highlighterMode: boolean;

  // --- Revised fields ---
  /** Which outline generation algorithm to use */
  outlineStrategy: OutlineStrategyId;

  /** Grain texture configuration (null = no grain for this pen) */
  grain: PenGrainConfig | null;

  /** Stamp rendering configuration (null = no stamps for this pen) */
  stamp: (PenStampConfig & { generatorId: string }) | null;

  /** Ink stamp rendering configuration (null = no ink stamps) */
  inkStamp: (InkStampConfig & { generatorId: string }) | null;

  // --- Removed (absorbed into outlineStrategy) ---
  // nibAngle, nibThickness → part of italic OutlineStrategy config
  // (PenStyle still carries these for the strategy to read)
}
```

### 8.4 Revised Material Executor (applyEffect)

Only the grain effect handler changes:

```typescript
function applyEffect(
  backend: DrawingBackend,
  effect: MaterialEffect,
  data: StrokeRenderData,
  resources: MaterialResources,
  region: ScreenRegion | null,
): void {
  switch (effect.type) {
    case "grain": {
      const configStrength = data.grainConfig?.strength ?? 0;
      const strength = effect.strengthSource === "override"
        ? resources.getGrainStrength(effect.textureId, data.strokeId, configStrength)
        : configStrength;
      if (strength > 0 && data.grainAnchor) {
        const tex = resources.getGrainTexture(effect.textureId);  // keyed lookup
        backend.applyGrain(tex, data.grainAnchor.x, data.grainAnchor.y, strength);
      }
      break;
    }
    // ... outlineMask and inkPooling unchanged
  }
}
```

### 8.5 Revised Data Preparation

```typescript
function prepareStrokeData(
  stroke: Stroke,
  style: PenStyle,
  penConfig: PenConfig,
  material: StrokeMaterial,
  resources: MaterialResources,
  pathCache: StrokePathCache,
  lod: LodLevel,
): StrokeRenderData {
  // 1. Decode points
  const points = decodePoints(stroke.encoded);

  // 2. Generate outline via strategy registry
  const outlineStrategy = OUTLINE_STRATEGIES[penConfig.outlineStrategy];
  const { vertices, italic } = outlineStrategy.generateOutline(points, style, penConfig, true);

  // 3. Compute stamps if material body requires them
  let stampData: Float32Array | undefined;
  let inkStampData: Float32Array | undefined;

  if (material.body.type === "stamps") {
    const generator = STAMP_GENERATORS[material.body.generatorId];
    const stamps = generator.computeAllStamps(points, style, material.body.stampConfig);
    stampData = packStamps(stamps);
  } else if (material.body.type === "inkShading") {
    const generator = STAMP_GENERATORS[material.body.generatorId];
    const stamps = generator.computeAllStamps(points, style, material.body.inkConfig);
    inkStampData = packStamps(stamps);
  }

  // 4. Detect ink pools if effects include inkPooling
  let inkPools: InkPool[] | undefined;
  if (material.effects.some(e => e.type === "inkPooling")) {
    inkPools = detectInkPools(points, style);
  }

  return {
    vertices,
    italic,
    color: resolveColor(style.color, useDarkColors),
    bbox: stroke.bbox,
    stampData,
    inkStampData,
    inkPools,
    grainAnchor: points.length > 0 ? { x: points[0].x, y: points[0].y } : undefined,
    grainConfig: penConfig.grain ?? undefined,
    styleOpacity: style.opacity,
    strokeId: stroke.id,
  };
}
```

### 8.6 Adding a New Pen Type -- Complete Checklist

With the revised architecture, adding a new pen type that uses **existing** body types, effects, outline strategies, and stamp generators:

| Step | File | Change |
|------|------|--------|
| 1 | `types.ts` | Add to `PenType` union |
| 2 | `PenConfigs.ts` | Add config entry (referencing existing strategy/generator IDs) |
| 3 | `StrokeMaterial.ts` | Add case to `resolveMaterial()` |

**3 files, 3 localized changes.** Down from 10-12.

Adding a new pen type with **novel** rendering needs:

| Step | File | Change |
|------|------|--------|
| 1 | `types.ts` | Add to `PenType` union |
| 2 | `PenConfigs.ts` | Add config entry |
| 3 | `StrokeMaterial.ts` | Add case to `resolveMaterial()` |
| 4 | New file | New `OutlineStrategy` implementation (if novel geometry) |
| 5 | New file | New `StampGenerator` implementation (if novel stamps) |
| 6 | New file | New `GrainTextureGenerator` (if novel texture) |
| 7 | Registration | Register new strategy/generator/texture at init |

**3-7 files, all localized.** No existing rendering code modified. No forwarding boilerplate. Both engines work automatically.

### 8.7 Revised File Structure

```
src/
  rendering/
    DrawingBackend.ts              # Interface definition
    Canvas2DBackend.ts             # Canvas2D implementation
    WebGLBackend.ts                # WebGL implementation
    StrokeMaterial.ts              # Material types + resolveMaterial()
    MaterialExecutor.ts            # executeMaterial(), renderBody(), applyEffect()
    MaterialResources.ts           # Resource management interface + manager
    StrokeDataPreparer.ts          # prepareStrokeData() + prepareActiveStrokeData()
  stroke/
    OutlineStrategy.ts             # Interface + registry
    StandardOutlineStrategy.ts     # Wraps perfect-freehand
    ItalicOutlineStrategy.ts       # Wraps ItalicOutlineGenerator
    FrayedOutlineStrategy.ts       # perfect-freehand + edge noise
  stamps/
    StampTypes.ts                  # StampParams, StampGenerator interface, StampAccumulator
    PathWalker.ts                  # Shared path-walking logic
    StampPacking.ts                # Single packStamps() function
    PencilScatterGenerator.ts      # Pencil-specific scatter
    InkShadingGenerator.ts         # Fountain pen ink stamps
  textures/
    GrainTextureRegistry.ts        # Map<string, GrainTextureGenerator>
    PencilGrainGenerator.ts        # Coarse simplex noise
    FeltTipGrainGenerator.ts       # Fine dot/fiber pattern
```

---

## 9. Migration Strategy

### Phase 1: DrawingBackend Interface (Additive, No Risk)

Create `DrawingBackend` interface and both implementations (`Canvas2DBackend`, `WebGLBackend`). These wrap the existing `CanvasRenderingContext2D` and `WebGL2Engine` without modifying them.

**Files created:** `DrawingBackend.ts`, `Canvas2DBackend.ts`, `WebGLBackend.ts`
**Existing files modified:** None
**Validates:** Can both engines be driven through a unified interface? Are there operations that don't translate cleanly?

### Phase 2: Outline Strategy Registry (Additive, No Risk)

Extract existing outline generation into the `OutlineStrategy` interface. Wrap `OutlineGenerator` as `StandardOutlineStrategy` and `ItalicOutlineGenerator` as `ItalicOutlineStrategy`. Add `outlineStrategy` field to `PenConfig` (defaulting to current behavior).

**Files created:** `OutlineStrategy.ts`, `StandardOutlineStrategy.ts`, `ItalicOutlineStrategy.ts`
**Existing files modified:** `PenConfigs.ts` (add `outlineStrategy` field to each config)
**Validates:** Can outline generation be selected by config without changing visual output?

### Phase 3: Material Types + Executor (Additive, No Risk)

Define `StrokeMaterial`, `StrokeBody`, `MaterialEffect` types (revised versions with `textureId` on grain, `generatorId` on stamp bodies). Implement `resolveMaterial()` and `executeMaterial()`. Write unit tests comparing executor output against current rendering.

**Files created:** `StrokeMaterial.ts`, `MaterialExecutor.ts`, `StrokeDataPreparer.ts`
**Existing files modified:** None
**Validates:** Does the declarative material model capture all existing rendering behaviors?

### Phase 4: Resource Manager + Grain Texture Registry (Additive, Low Risk)

Introduce `MaterialResourceManager` with `Map<string, GrainTextureGenerator>` for grain textures and `Map<string, StampTextureManager>` for stamp textures. Register existing generators under their IDs (`"pencil-graphite"`, `"pencil-scatter"`, `"ink-shading"`).

**Files created:** `MaterialResources.ts`, `GrainTextureRegistry.ts`
**Existing files modified:** None initially (registration wired in alongside existing code)
**Validates:** Can all existing resources be accessed through the unified registry?

### Phase 5: Stamp Unification (Additive, Low Risk)

Extract shared `StampGenerator` interface, `walkStrokePath()`, and `packStamps()`. Wrap existing `StampRenderer` as `PencilScatterGenerator` and `InkStampRenderer` as `InkShadingGenerator`.

**Files created:** `StampTypes.ts`, `PathWalker.ts`, `PencilScatterGenerator.ts`, `InkShadingGenerator.ts`
**Existing files modified:** None (wrappers delegate to existing code)
**Validates:** Stamp generators produce identical output to existing renderers.

### Phase 6: Replace renderStrokeToContext/Engine (High Risk)

Replace `StrokeRenderCore.renderStrokeToContext()` and `renderStrokeToEngine()` with calls to `executeMaterial()`. Both old functions become thin wrappers that construct a backend, prepare data, resolve material, and delegate.

**Existing files modified:** `StrokeRenderCore.ts` (rewrite)
**Validates:** Visual parity with existing rendering across all pen types, pipelines, engines, and LODs. **This phase requires thorough visual regression testing.**

### Phase 7: Unified Active Stroke Rendering (Medium Risk)

Replace `Renderer.renderActiveStroke()` dispatch with material-based rendering. Active strokes use the same `executeMaterial()` with simplified materials (no ink pooling, etc.).

**Existing files modified:** `Renderer.ts` (replace `renderActiveStroke`, `renderPointsToStatic`)
**Validates:** Active stroke rendering matches quality and performance. **60fps with Apple Pencil is the performance bar.**

### Phase 8: Replace Resource Forwarding (Medium Risk)

Replace per-type setters and forwarding methods in `TiledStaticLayer`, `TileRenderer`, and `WebGLTileEngine` with a single `MaterialResources` reference. Remove the 7+ forwarding methods per texture type.

**Existing files modified:** `Renderer.ts`, `TileRenderer.ts`, `WebGLTileEngine.ts`
**Validates:** Tile rendering works with unified resource management. Worker tile rendering is unaffected.

### Phase 9: Cleanup

Remove dead code: old `StrokeRenderCore` rendering functions, old per-type forwarding methods, duplicate stamp packing functions, unused context interfaces (`GrainRenderContext`, `StampRenderContext`, `EngineGrainContext`, `EngineStampContext`).

### Key Constraints

1. **Each phase is independently shippable.** The old and new systems coexist during migration.
2. **Phases 1-5 are additive** -- they create new code alongside existing code. Zero risk of regression.
3. **Phase 6 is the high-risk phase** -- this is where old rendering code is replaced. Visual regression testing is critical.
4. **Phases 7-8 are medium-risk** -- active stroke performance and tile resource management. Testable in isolation.
5. **Phase 9 is cleanup** -- only done after all previous phases are stable.

### Adding Felt-Tip Stamps (Post Migration)

Once the migration is complete, adding felt-tip advanced rendering is:

1. Create `FeltTipGrainGenerator.ts` (fine dot/fiber texture)
2. Create `FrayedOutlineStrategy.ts` (perfect-freehand + edge noise)
3. Register both at init
4. Update `PenConfigs["felt-tip"]` to set `outlineStrategy: "frayed"` and `grain.enabled: true`
5. Update `resolveMaterial()` felt-tip case to include grain effect with `textureId: "felt-tip-paper"`

**5 localized changes. Zero modifications to rendering dispatch, backends, tile system, or resource plumbing.**

---

## Sources

### Open-Source Projects
- [Krita Brush Engine Wiki](https://community.kde.org/Krita/BrushEngine) | [How to Write Brush Engines](https://community.kde.org/Krita/How_To_Write_Brush_Engines)
- [libmypaint Architecture](https://deepwiki.com/mypaint/libmypaint) | [MyPaintBrush API](https://deepwiki.com/mypaint/libmypaint/6.1-mypaintbrush-api)
- [tldraw Shapes Docs](https://tldraw.dev/docs/shapes) | [Canvas Rendering](https://deepwiki.com/tldraw/tldraw/3.1-canvas-rendering)
- [PixiJS Renderers](https://pixijs.com/8.x/guides/components/renderers) | [v8 Beta](https://pixijs.com/blog/pixi-v8-beta)
- [Konva Architecture](https://deepwiki.com/konvajs/konva) | [Custom Shapes](https://konvajs.org/docs/shapes/Custom.html)
- [Excalidraw Canvas Pipeline](https://deepwiki.com/excalidraw/excalidraw/5.1-canvas-rendering-pipeline)
- [Fabric.js BaseBrush](https://fabricjs.com/api/classes/basebrush/)
- [Drawpile Brush System](https://deepwiki.com/drawpile/Drawpile/4.1-brush-system)

### Design Patterns
- [Vulkan Engine Architecture Patterns](https://docs.vulkan.org/tutorial/latest/Building_a_Simple_Engine/Engine_Architecture/02_architectural_patterns.html)
- [FrameGraph: Extensible Rendering in Frostbite (GDC 2017)](https://www.gdcvault.com/play/1024612/FrameGraph-Extensible-Rendering-Architecture-in)
- [TypeScript Discriminated Unions](https://basarat.gitbook.io/typescript/type-system/discriminated-unions)
- [Procreate Brush Studio](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
