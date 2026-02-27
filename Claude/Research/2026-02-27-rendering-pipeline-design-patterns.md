# Rendering Pipeline Design Patterns for Drawing/Handwriting Applications

## Problem Statement

ObsidianPaper's stroke rendering has grown organically into a central dispatch file (`StrokeRenderCore.ts`) containing large if/else chains that select rendering behavior based on:

- **Pen type** (ballpoint, felt-tip, pencil, fountain, highlighter)
- **Pipeline** (basic = simple fills, advanced = stamps/textures/grain)
- **Engine** (Canvas2D via `renderStrokeToContext()`, RenderEngine via `renderStrokeToEngine()`)
- **Stroke state** (active = in-progress on active canvas, completed = baked to static layer)

This creates a **cross-product explosion**: 5 pens x 2 pipelines x 2 engines x 2 states = 40 potential code paths, many of which are duplicated. The two top-level functions (`renderStrokeToContext` and `renderStrokeToEngine`) follow nearly identical branching logic but use different drawing primitives (Canvas2D `ctx.fill(path)` vs engine `engine.fillPath(vertices)`). Active stroke rendering in `Renderer.renderActiveStroke()` duplicates large sections of this logic again.

### Current Duplication Inventory

1. **Ink-shaded fountain pen**: ~40 lines duplicated between Context and Engine paths
2. **Stamp-based pencil**: ~10 lines duplicated between Context and Engine paths
3. **Grain-isolated rendering**: ~40 lines duplicated between Context and Engine paths
4. **Highlighter compositing**: ~10 lines duplicated between Context and Engine paths
5. **Basic fill**: ~10 lines duplicated between Context and Engine paths
6. **Active stroke rendering**: `Renderer.renderActiveStroke()` re-implements ink shading (~50 lines), stamp rendering (~30 lines), grain overlay (~20 lines), and highlighter mode (~10 lines) from scratch

---

## Pattern Analysis

### 1. Strategy Pattern

**Concept**: Define a family of algorithms (one per pen type), encapsulate each one, and make them interchangeable. The rendering context calls the strategy without knowing which pen-specific algorithm it uses.

**Application to This Problem**:

```typescript
// Strategy interface — one render method per pen type
interface PenRenderStrategy {
  renderCompleted(ctx: RenderContext, stroke: StrokeData): void;
  renderActive(ctx: RenderContext, points: StrokePoint[], style: PenStyle): void;
}

// Concrete strategies
class BallpointStrategy implements PenRenderStrategy {
  renderCompleted(ctx: RenderContext, stroke: StrokeData): void {
    ctx.setFillColor(stroke.color);
    ctx.setAlpha(stroke.style.opacity);
    ctx.fillPath(stroke.vertices);
    ctx.setAlpha(1);
  }
  renderActive(ctx: RenderContext, points: StrokePoint[], style: PenStyle): void {
    // Same as completed — ballpoint has no special active behavior
    this.renderCompleted(ctx, buildStrokeData(points, style));
  }
}

class PencilStrategy implements PenRenderStrategy {
  renderCompleted(ctx: RenderContext, stroke: StrokeData): void {
    if (ctx.pipeline === "advanced" && stroke.stampData) {
      ctx.drawStampDiscs(stroke.color, stroke.stampData);
    } else {
      ctx.setFillColor(stroke.color);
      ctx.fillPath(stroke.vertices);
      this.applyGrain(ctx, stroke);
    }
  }
  // ...
}

class FountainPenStrategy implements PenRenderStrategy {
  renderCompleted(ctx: RenderContext, stroke: StrokeData): void {
    if (ctx.pipeline === "advanced" && stroke.inkStampData) {
      this.renderInkShaded(ctx, stroke);
    } else {
      ctx.setFillColor(stroke.color);
      ctx.fillPath(stroke.vertices);
      this.renderInkPools(ctx, stroke);
    }
  }
  // ...
}

// Registry
const strategies: Record<PenType, PenRenderStrategy> = {
  ballpoint: new BallpointStrategy(),
  "felt-tip": new FeltTipStrategy(),
  pencil: new PencilStrategy(),
  fountain: new FountainPenStrategy(),
  highlighter: new HighlighterStrategy(),
};

// Usage — replaces the if/else chain
function renderStroke(ctx: RenderContext, stroke: Stroke, styles: Record<string, PenStyle>): void {
  const style = resolveStyle(stroke, styles);
  const strategy = strategies[style.pen];
  strategy.renderCompleted(ctx, prepareStrokeData(stroke, style, ctx));
}
```

**How It Handles the Cross-Product**:
- Pen type: Each strategy class handles one pen type. No if/else dispatch.
- Pipeline: Each strategy internally checks `ctx.pipeline` for basic vs advanced behavior. This is still conditional, but localized to the relevant pen.
- Engine: The `RenderContext` interface abstracts Canvas2D vs WebGL. Strategies call `ctx.fillPath()` regardless of engine.
- Active vs Completed: Separate methods on the strategy interface.

**Adding a New Pen Type**: Create a new class implementing `PenRenderStrategy`, add it to the registry. Zero changes to existing code.

**Code Duplication Reduction**: Moderate. Each strategy encapsulates its own logic, so ballpoint and felt-tip (which are similar) would have duplicated fill code. Can be mitigated with shared base methods or utility functions.

**Drawbacks**:
- Pipeline and LOD branching still exists inside each strategy, just moved from one file to five files.
- Effects like grain and ink pooling that apply to multiple pen types need to be shared somehow (utility functions or mixins).
- If two pen types share 80% of their rendering logic (e.g., ballpoint and felt-tip), the shared code must be factored into a base class or helper, undermining the "one class per pen" simplicity.

**Complexity Cost**: Low. Well-understood pattern. TypeScript interfaces enforce the contract.

---

### 2. Template Method Pattern

**Concept**: Define the skeleton of the rendering algorithm in a base class. Subclasses override specific "hook" methods to customize behavior for each pen type.

**Application to This Problem**:

```typescript
abstract class StrokeRenderer {
  // Template method — defines the rendering algorithm skeleton
  render(ctx: RenderContext, stroke: StrokeData): void {
    const color = this.resolveColor(stroke);

    if (this.needsOffscreen(ctx, stroke)) {
      ctx.beginOffscreen(this.computeOffscreenRegion(stroke));
      this.drawStrokeBody(ctx, stroke, color);
      this.applyEffects(ctx, stroke, color);
      ctx.endOffscreen();
      ctx.compositeOffscreen();
    } else {
      this.drawStrokeBody(ctx, stroke, color);
      this.applyPostEffects(ctx, stroke, color);
    }
  }

  // Hook methods — overridden by subclasses
  protected abstract drawStrokeBody(ctx: RenderContext, stroke: StrokeData, color: string): void;

  // Default implementations (optional hooks)
  protected needsOffscreen(ctx: RenderContext, stroke: StrokeData): boolean {
    return false;
  }
  protected applyEffects(ctx: RenderContext, stroke: StrokeData, color: string): void {
    // no-op by default
  }
  protected applyPostEffects(ctx: RenderContext, stroke: StrokeData, color: string): void {
    // no-op by default
  }
  protected resolveColor(stroke: StrokeData): string {
    return resolveColor(stroke.style.color, stroke.useDarkColors);
  }
  protected computeOffscreenRegion(stroke: StrokeData): ScreenRegion {
    return computeScreenBBox(stroke.bbox, /* ... */);
  }
}

class BallpointRenderer extends StrokeRenderer {
  protected drawStrokeBody(ctx: RenderContext, stroke: StrokeData, color: string): void {
    ctx.setFillColor(color);
    ctx.setAlpha(stroke.style.opacity);
    ctx.fillPath(stroke.vertices);
    ctx.setAlpha(1);
  }
}

class PencilRenderer extends StrokeRenderer {
  protected needsOffscreen(ctx: RenderContext, stroke: StrokeData): boolean {
    return ctx.pipeline === "advanced" && stroke.penConfig.grain?.enabled;
  }
  protected drawStrokeBody(ctx: RenderContext, stroke: StrokeData, color: string): void {
    if (ctx.pipeline === "advanced" && stroke.stampData) {
      ctx.drawStampDiscs(color, stroke.stampData);
    } else {
      ctx.setFillColor(color);
      ctx.fillPath(stroke.vertices);
    }
  }
  protected applyEffects(ctx: RenderContext, stroke: StrokeData, color: string): void {
    // Grain texture eraser pass
    ctx.applyGrain(stroke.grainTexture, stroke.grainAnchor, stroke.grainStrength);
  }
}

class FountainPenRenderer extends StrokeRenderer {
  protected needsOffscreen(ctx: RenderContext, stroke: StrokeData): boolean {
    return ctx.pipeline === "advanced" && stroke.penConfig.inkStamp != null;
  }
  protected drawStrokeBody(ctx: RenderContext, stroke: StrokeData, color: string): void {
    if (ctx.pipeline === "advanced" && stroke.inkStampData) {
      ctx.drawStamps(stroke.inkStampTexture, stroke.inkStampData);
    } else {
      ctx.setFillColor(color);
      ctx.fillPath(stroke.vertices);
    }
  }
  protected applyEffects(ctx: RenderContext, stroke: StrokeData, color: string): void {
    // Mask to outline path (destination-in)
    ctx.maskToPath(stroke.vertices);
  }
  protected applyPostEffects(ctx: RenderContext, stroke: StrokeData, color: string): void {
    // Ink pooling at stroke termination points
    if (stroke.inkPools && stroke.inkPools.length > 0) {
      this.renderInkPools(ctx, stroke.inkPools, color);
    }
  }
}
```

**How It Handles the Cross-Product**:
- The base class template method handles the common flow (color resolution, offscreen management, compositing).
- Subclasses only override what differs.
- Pipeline branching is pushed into hooks (`needsOffscreen`, `drawStrokeBody`).
- Engine abstraction is handled by the `RenderContext` interface (same as Strategy).

**Adding a New Pen Type**: Create a new subclass, override 1-3 methods. The template ensures the overall flow is correct.

**Code Duplication Reduction**: Good for the common scaffolding (offscreen setup/teardown, color resolution, bbox computation). Pen-specific logic is cleanly separated.

**Drawbacks**:
- Inheritance hierarchy can become rigid. If a new pen type needs a fundamentally different rendering flow (e.g., multiple offscreen passes), the template method may not accommodate it without modification.
- "Fragile base class" problem: changes to the base class template affect all subclasses.
- Hook methods can proliferate as new effects are added, making the base class bloated with optional hooks.
- TypeScript abstract classes are less composable than interfaces. Difficult to mix and match behaviors.

**Complexity Cost**: Low-moderate. Straightforward inheritance. The risk is future rigidity.

---

### 3. Component/Entity-Component-System (ECS)

**Concept**: Instead of defining pen types as monolithic classes, decompose rendering behavior into small, reusable components. Each pen type is an entity composed of the components it needs. A system iterates over entities with matching components and executes the rendering logic.

**Application to This Problem**:

```typescript
// Components — pure data describing rendering capabilities
interface FillComponent {
  kind: "fill";
  opacity: number;
}

interface StampComponent {
  kind: "stamp";
  stampData: Float32Array;
  stampType: "disc" | "textured";
}

interface GrainComponent {
  kind: "grain";
  strength: number;
  anchorX: number;
  anchorY: number;
}

interface InkShadingComponent {
  kind: "inkShading";
  inkStampData: Float32Array;
  inkTexture: TextureHandle;
  maskVertices: Float32Array;
}

interface InkPoolingComponent {
  kind: "inkPooling";
  pools: InkPool[];
}

interface HighlighterComponent {
  kind: "highlighter";
  baseOpacity: number;
}

type RenderComponent = FillComponent | StampComponent | GrainComponent
  | InkShadingComponent | InkPoolingComponent | HighlighterComponent;

// Entity — a stroke with its rendering components
interface StrokeEntity {
  id: string;
  vertices: Float32Array;
  color: string;
  bbox: [number, number, number, number];
  components: RenderComponent[];
}

// Factory — builds the component list based on pen type + pipeline
function buildStrokeEntity(stroke: Stroke, style: PenStyle, pipeline: RenderPipeline): StrokeEntity {
  const penConfig = getPenConfig(style.pen);
  const components: RenderComponent[] = [];

  if (penConfig.highlighterMode) {
    components.push({ kind: "highlighter", baseOpacity: penConfig.baseOpacity });
  } else if (pipeline === "advanced" && penConfig.stamp) {
    components.push({ kind: "stamp", stampData: computeStamps(stroke, style, penConfig), stampType: "disc" });
  } else if (pipeline === "advanced" && penConfig.inkStamp) {
    components.push({ kind: "inkShading", /* ... */ });
  } else {
    components.push({ kind: "fill", opacity: style.opacity });
  }

  if (pipeline === "advanced" && penConfig.grain?.enabled) {
    components.push({ kind: "grain", strength: penConfig.grain.strength, /* ... */ });
  }
  if (pipeline === "advanced" && style.pen === "fountain") {
    components.push({ kind: "inkPooling", pools: detectInkPools(stroke) });
  }

  return { id: stroke.id, vertices, color, bbox: stroke.bbox, components };
}

// System — processes entities by iterating their components
function renderStrokeEntity(ctx: RenderContext, entity: StrokeEntity): void {
  const needsOffscreen = entity.components.some(c => c.kind === "grain" || c.kind === "inkShading");

  if (needsOffscreen) {
    ctx.beginOffscreen(/* region */);
  }

  for (const component of entity.components) {
    switch (component.kind) {
      case "fill":
        ctx.setFillColor(entity.color);
        ctx.setAlpha(component.opacity);
        ctx.fillPath(entity.vertices);
        ctx.setAlpha(1);
        break;
      case "stamp":
        ctx.drawStampDiscs(entity.color, component.stampData);
        break;
      case "highlighter":
        ctx.save();
        ctx.setAlpha(component.baseOpacity);
        ctx.setBlendMode("multiply");
        ctx.setFillColor(entity.color);
        ctx.fillPath(entity.vertices);
        ctx.restore();
        break;
      case "grain":
        ctx.applyGrain(/* ... */);
        break;
      case "inkShading":
        ctx.drawStamps(component.inkTexture, component.inkStampData);
        ctx.maskToPath(component.maskVertices);
        break;
      case "inkPooling":
        renderInkPools(ctx, component.pools, entity.color);
        break;
    }
  }

  if (needsOffscreen) {
    ctx.endOffscreen();
    ctx.compositeOffscreen();
  }
}
```

**How It Handles the Cross-Product**:
- Pen type: The factory function selects which components to attach based on pen config.
- Pipeline: The factory checks pipeline to decide whether to include grain, stamps, etc.
- Engine: The `RenderContext` abstracts Canvas2D vs WebGL.
- Active vs Completed: The factory can produce different component lists for active (no grain, simpler stamps) vs completed (full effects).

**Adding a New Pen Type**: Define its component list in the factory. If the new pen reuses existing components (fill + grain), zero new rendering code is needed. If it needs a new effect, create a new component type and add a case to the system.

**Code Duplication Reduction**: Excellent. Fill logic is written once. Grain logic is written once. Each component is a reusable building block.

**Drawbacks**:
- **Ordering dependencies**: Some effects must run in a specific order (fill before grain, stamps before mask). The component array's order becomes an implicit contract that is easy to violate.
- **Offscreen management**: Grain and ink shading both require offscreen rendering, but with different setup/teardown. The system must know which combination of components requires which offscreen flow. This logic re-introduces the complexity ECS was meant to eliminate.
- **Not a natural fit for rendering**: ECS excels when many entities share the same component types and can be batch-processed. In this case, there are only ~5 entity archetypes (one per pen), and the rendering order matters. The "system iterates components" approach devolves into a switch statement that mirrors the original if/else chain.
- **Debugging difficulty**: With behavior spread across components, tracing why a stroke renders incorrectly requires examining the entity's component list, the factory, and the system.

**Complexity Cost**: High. Overkill for 5 pen types. The component decomposition adds indirection without proportional benefit at this scale.

---

### 4. Command Pattern

**Concept**: Encapsulate each rendering operation as a command object. Build a sequence of commands that can be inspected, reordered, optimized, or replayed.

**Application to This Problem**:

```typescript
// Command interface
interface RenderCommand {
  execute(ctx: RenderContext): void;
}

// Concrete commands
class SetFillColorCommand implements RenderCommand {
  constructor(private color: string) {}
  execute(ctx: RenderContext): void { ctx.setFillColor(this.color); }
}

class FillPathCommand implements RenderCommand {
  constructor(private vertices: Float32Array, private italic: boolean) {}
  execute(ctx: RenderContext): void {
    if (this.italic) ctx.fillTriangles(this.vertices);
    else ctx.fillPath(this.vertices);
  }
}

class BeginOffscreenCommand implements RenderCommand {
  constructor(private id: string, private region: ScreenRegion) {}
  execute(ctx: RenderContext): void {
    const target = ctx.getOffscreen(this.id, this.region.sw, this.region.sh);
    ctx.beginOffscreen(target);
    ctx.clear();
  }
}

class DrawStampsCommand implements RenderCommand {
  constructor(private texture: TextureHandle, private data: Float32Array) {}
  execute(ctx: RenderContext): void { ctx.drawStamps(this.texture, this.data); }
}

class ApplyGrainCommand implements RenderCommand {
  constructor(private texture: TextureHandle, private ox: number, private oy: number, private strength: number) {}
  execute(ctx: RenderContext): void { ctx.applyGrain(this.texture, this.ox, this.oy, this.strength); }
}

// Command builder — replaces the if/else dispatch
function buildRenderCommands(stroke: StrokeData, pipeline: RenderPipeline): RenderCommand[] {
  const commands: RenderCommand[] = [];
  const penConfig = stroke.penConfig;

  if (pipeline === "advanced" && penConfig.inkStamp) {
    commands.push(new BeginOffscreenCommand("inkShading", stroke.offscreenRegion));
    commands.push(new SetTransformCommand(stroke.offscreenTransform));
    commands.push(new DrawStampsCommand(stroke.inkTexture, stroke.inkStampData));
    commands.push(new MaskToPathCommand(stroke.vertices));
    commands.push(new EndOffscreenCommand());
    commands.push(new CompositeOffscreenCommand(stroke.offscreenRegion));
  } else if (pipeline === "advanced" && penConfig.stamp) {
    commands.push(new SetAlphaCommand(stroke.style.opacity));
    commands.push(new DrawStampDiscsCommand(stroke.color, stroke.stampData));
    commands.push(new SetAlphaCommand(1));
  } else if (penConfig.highlighterMode) {
    commands.push(new SaveCommand());
    commands.push(new SetAlphaCommand(penConfig.baseOpacity));
    commands.push(new SetBlendModeCommand("multiply"));
    commands.push(new SetFillColorCommand(stroke.color));
    commands.push(new FillPathCommand(stroke.vertices, stroke.italic));
    commands.push(new RestoreCommand());
  } else {
    commands.push(new SetFillColorCommand(stroke.color));
    commands.push(new SetAlphaCommand(stroke.style.opacity));
    commands.push(new FillPathCommand(stroke.vertices, stroke.italic));
    commands.push(new SetAlphaCommand(1));

    if (pipeline === "advanced" && penConfig.grain?.enabled && stroke.grainStrength > 0) {
      // Wrap in offscreen for grain isolation
      // (would need to restructure to insert offscreen commands at the beginning)
    }
  }

  return commands;
}

// Execution
function renderStroke(ctx: RenderContext, commands: RenderCommand[]): void {
  for (const cmd of commands) {
    cmd.execute(ctx);
  }
}
```

**How It Handles the Cross-Product**:
- The command builder function handles the pen type x pipeline dispatch, producing a list of commands.
- Commands are engine-agnostic (they call `RenderContext` methods).
- Active vs completed could use different command builders.

**Adding a New Pen Type**: Add a new branch to the command builder. Reuse existing command classes.

**Code Duplication Reduction**: Moderate. The individual commands are reusable, but the command builder still contains the dispatch logic. The main value is that commands can be inspected and optimized (e.g., batch multiple strokes with the same color).

**Drawbacks**:
- **Command overhead**: Each rendering operation becomes an object allocation. For a real-time drawing app processing many strokes per frame, this creates GC pressure.
- **Ordering is still manual**: The builder must construct commands in the correct order. This is the same complexity as the original code, just expressed differently.
- **Grain isolation wrapping problem**: Effects like grain require wrapping earlier commands in offscreen begin/end. This means the builder must look ahead to decide whether offscreen wrapping is needed, which is awkward.
- **Debugging**: A list of 10+ command objects is harder to follow than 10 sequential lines of code.

**Complexity Cost**: Moderate-high. Adds object overhead and indirection for unclear benefit in this domain. More suited to undo/redo systems than rendering pipelines.

---

### 5. Pipeline Pattern (Composable Stages)

**Concept**: Define rendering as a sequence of composable stages, where each stage transforms a render state. Stages can be mixed, matched, and reordered.

**Application to This Problem**:

```typescript
// Render state flowing through the pipeline
interface RenderState {
  ctx: RenderContext;
  stroke: StrokeData;
  color: string;
  offscreenActive: boolean;
  rendered: boolean;  // Flag indicating the main body has been drawn
}

// Stage interface
type RenderStage = (state: RenderState, next: () => void) => void;

// Stages
const resolveColorStage: RenderStage = (state, next) => {
  state.color = resolveColor(state.stroke.style.color, state.stroke.useDarkColors);
  next();
};

const grainIsolationStage: RenderStage = (state, next) => {
  const penConfig = state.stroke.penConfig;
  if (state.ctx.pipeline !== "basic" && penConfig.grain?.enabled && state.stroke.grainStrength > 0) {
    const region = computeScreenBBox(state.stroke.bbox, /* ... */);
    if (region) {
      state.ctx.beginOffscreen("grain", region.sw, region.sh);
      state.offscreenActive = true;
      next(); // Inner stages draw to offscreen
      state.ctx.applyGrain(/* grain params */);
      state.ctx.endOffscreen();
      state.ctx.compositeOffscreen(region);
      state.offscreenActive = false;
      return;
    }
  }
  next();
};

const stampBodyStage: RenderStage = (state, next) => {
  const penConfig = state.stroke.penConfig;
  if (state.ctx.pipeline === "advanced" && penConfig.stamp && state.stroke.stampData) {
    state.ctx.drawStampDiscs(state.color, state.stroke.stampData);
    state.rendered = true;
  }
  next();
};

const fillBodyStage: RenderStage = (state, next) => {
  if (state.rendered) { next(); return; }
  if (state.stroke.penConfig.highlighterMode) {
    state.ctx.save();
    state.ctx.setAlpha(state.stroke.penConfig.baseOpacity);
    state.ctx.setBlendMode("multiply");
    state.ctx.setFillColor(state.color);
    state.ctx.fillPath(state.stroke.vertices);
    state.ctx.restore();
  } else {
    state.ctx.setFillColor(state.color);
    state.ctx.setAlpha(state.stroke.style.opacity);
    state.ctx.fillPath(state.stroke.vertices);
    state.ctx.setAlpha(1);
  }
  state.rendered = true;
  next();
};

const inkPoolingStage: RenderStage = (state, next) => {
  if (state.ctx.pipeline !== "basic" && state.stroke.style.pen === "fountain" && state.stroke.inkPools?.length) {
    renderInkPools(state.ctx, state.stroke.inkPools, state.color);
  }
  next();
};

// Pipeline composition
function composePipeline(stages: RenderStage[]): (state: RenderState) => void {
  return (state) => {
    let index = 0;
    const next = () => {
      if (index < stages.length) {
        const stage = stages[index++];
        stage(state, next);
      }
    };
    next();
  };
}

// Per-pen pipelines
const ballpointPipeline = composePipeline([
  resolveColorStage,
  fillBodyStage,
]);

const pencilPipeline = composePipeline([
  resolveColorStage,
  grainIsolationStage,   // Wraps inner stages in offscreen if needed
  stampBodyStage,         // Draws stamps if advanced pipeline
  fillBodyStage,          // Fallback fill if stamps didn't render
]);

const fountainPipeline = composePipeline([
  resolveColorStage,
  inkShadingStage,        // Offscreen stamps + mask (advanced)
  fillBodyStage,          // Fallback fill (basic)
  inkPoolingStage,
]);
```

**How It Handles the Cross-Product**:
- Each pen type has a composed pipeline of stages.
- Stages are reusable (fillBodyStage is shared by ballpoint, felt-tip, and pencil fallback).
- Pipeline (basic/advanced) is checked within stages that only apply to advanced mode.
- Engine abstraction via `RenderContext`.

**Adding a New Pen Type**: Compose a new pipeline from existing stages. Add new stages only if the pen needs novel behavior.

**Code Duplication Reduction**: Very good. Stages are the smallest reusable units of rendering behavior.

**Drawbacks**:
- **Middleware-style control flow**: The `next()` pattern (borrowed from Express.js) is powerful but can be confusing. The grain isolation stage wraps inner stages, which means the execution flow is non-linear. This makes debugging harder.
- **Shared mutable state**: The `RenderState` object is mutated as it flows through stages. Race conditions are unlikely (single-threaded), but reasoning about what state each stage sees requires understanding all previous stages.
- **Stage ordering matters**: Reordering stages can break rendering. The pipeline composition is declarative but fragile.
- **Overhead**: The `next()` closure chain adds function call overhead per stage per stroke.

**Complexity Cost**: Moderate. The middleware pattern is well-understood in web development but unfamiliar to graphics programmers. The stage wrapping pattern for offscreen management is elegant but subtle.

---

### 6. Visitor Pattern

**Concept**: Separate the rendering algorithm from the pen type data structure. A "visitor" (the renderer) visits each pen type and executes the appropriate rendering method via double dispatch.

**Application to This Problem**:

```typescript
// Pen type "element" hierarchy
interface PenTypeVisitable {
  accept(visitor: PenRenderVisitor, ctx: RenderContext, stroke: StrokeData): void;
}

class BallpointPen implements PenTypeVisitable {
  accept(visitor: PenRenderVisitor, ctx: RenderContext, stroke: StrokeData): void {
    visitor.visitBallpoint(ctx, stroke);
  }
}

class PencilPen implements PenTypeVisitable {
  accept(visitor: PenRenderVisitor, ctx: RenderContext, stroke: StrokeData): void {
    visitor.visitPencil(ctx, stroke);
  }
}

class FountainPenObj implements PenTypeVisitable {
  accept(visitor: PenRenderVisitor, ctx: RenderContext, stroke: StrokeData): void {
    visitor.visitFountain(ctx, stroke);
  }
}

// Visitor interface — one visit method per pen type
interface PenRenderVisitor {
  visitBallpoint(ctx: RenderContext, stroke: StrokeData): void;
  visitFeltTip(ctx: RenderContext, stroke: StrokeData): void;
  visitPencil(ctx: RenderContext, stroke: StrokeData): void;
  visitFountain(ctx: RenderContext, stroke: StrokeData): void;
  visitHighlighter(ctx: RenderContext, stroke: StrokeData): void;
}

// Concrete visitor — renders completed strokes
class CompletedStrokeVisitor implements PenRenderVisitor {
  constructor(private pipeline: RenderPipeline) {}

  visitBallpoint(ctx: RenderContext, stroke: StrokeData): void {
    ctx.setFillColor(stroke.color);
    ctx.setAlpha(stroke.style.opacity);
    ctx.fillPath(stroke.vertices);
    ctx.setAlpha(1);
  }

  visitPencil(ctx: RenderContext, stroke: StrokeData): void {
    if (this.pipeline === "advanced" && stroke.stampData) {
      ctx.drawStampDiscs(stroke.color, stroke.stampData);
    } else {
      this.visitBallpoint(ctx, stroke); // Reuse fill logic
    }
  }

  visitFountain(ctx: RenderContext, stroke: StrokeData): void {
    if (this.pipeline === "advanced" && stroke.inkStampData) {
      // Ink shading rendering...
    } else {
      this.visitBallpoint(ctx, stroke);
    }
  }
  // ...
}

// Separate visitor for active strokes
class ActiveStrokeVisitor implements PenRenderVisitor {
  // Different rendering behavior optimized for real-time...
}
```

**How It Handles the Cross-Product**:
- Pen type x State: Separate visitor classes for completed vs active. Each has visit methods for all pen types.
- Pipeline: Checked within visit methods.
- Engine: RenderContext abstraction.

**Adding a New Pen Type**: Requires adding a visit method to ALL visitor implementations. This is the "expression problem" — the visitor pattern makes adding new operations (visitors) easy but adding new element types (pen types) expensive.

**Code Duplication Reduction**: Poor. Each visitor (completed, active) contains the full set of pen-type-specific rendering logic. The double dispatch mechanism adds boilerplate.

**Drawbacks**:
- **Expression problem**: Adding a 6th pen type requires modifying every visitor class. This is the exact opposite of what you want in an extensible system.
- **Double dispatch boilerplate**: The accept/visit dance adds indirection without real benefit in TypeScript, which has no true method overloading.
- **Overkill for this problem**: The visitor pattern shines when you have many operations over a stable set of element types. Here, the pen type set is growing (you may add more), and the operations are relatively fixed (render completed, render active).
- **TypeScript alternative**: A simple `switch` on a discriminated union achieves the same dispatch with less ceremony.

**Complexity Cost**: High relative to benefit. The pattern is poorly suited because the "element" set (pen types) is the dimension likely to grow.

---

### 7. Abstract Factory

**Concept**: Create families of related rendering objects (context, stamps, grain) for each engine backend without specifying concrete classes.

**Application to This Problem**:

```typescript
// Abstract products
interface StrokeRenderContext {
  setFillColor(color: string): void;
  setAlpha(alpha: number): void;
  fillPath(data: PathData): void;
  drawStamps(texture: StampTexture, data: Float32Array): void;
  beginOffscreen(region: ScreenRegion): void;
  endOffscreen(): void;
  applyGrain(params: GrainParams): void;
}

interface StampTexture {
  readonly width: number;
  readonly height: number;
}

// Abstract factory
interface RenderFactory {
  createStrokeContext(canvas: HTMLCanvasElement | OffscreenCanvas): StrokeRenderContext;
  createStampTexture(source: ImageSource): StampTexture;
  createGrainTexture(generator: GrainTextureGenerator): GrainTexture;
}

// Concrete factories
class Canvas2DFactory implements RenderFactory {
  createStrokeContext(canvas: HTMLCanvasElement): StrokeRenderContext {
    return new Canvas2DStrokeContext(canvas.getContext("2d")!);
  }
  createStampTexture(source: ImageSource): StampTexture {
    return new Canvas2DStampTexture(source);
  }
  // ...
}

class WebGLFactory implements RenderFactory {
  constructor(private gl: WebGL2RenderingContext) {}
  createStrokeContext(canvas: HTMLCanvasElement): StrokeRenderContext {
    return new WebGLStrokeContext(this.gl);
  }
  createStampTexture(source: ImageSource): StampTexture {
    return new WebGLStampTexture(this.gl, source);
  }
  // ...
}

// Usage — rendering code is factory-agnostic
function renderStroke(factory: RenderFactory, canvas: HTMLCanvasElement, stroke: Stroke): void {
  const ctx = factory.createStrokeContext(canvas);
  // ... same rendering logic regardless of Canvas2D or WebGL
}
```

**How It Handles the Cross-Product**:
- Engine: The factory produces engine-specific implementations. Client code uses abstract interfaces.
- Pen type: Not addressed. Pen-type dispatch is still needed on top of the factory.
- Pipeline: Not addressed. Pipeline branching is orthogonal.

**Adding a New Pen Type**: Factory pattern does not help with pen type extensibility.

**Code Duplication Reduction**: Excellent for the Canvas2D/WebGL axis. All rendering logic is written once against the abstract interface. Each engine implements the interface.

**Drawbacks**:
- **Only solves one dimension**: Abstract Factory addresses the engine multiplicity but not the pen type or pipeline dimensions. Must be combined with another pattern (Strategy, Template Method).
- **Factory proliferation**: If the product families diverge significantly (WebGL needs shader programs, Canvas2D needs pattern objects), the abstract interface becomes a lowest-common-denominator that constrains both implementations.
- **Already partially implemented**: The existing `RenderEngine` interface in this codebase is essentially the abstract product. Adding a full factory on top adds ceremony without new capability.

**Complexity Cost**: Low for the pattern itself, but solving only 1 of 3 dimensions means other patterns are still needed.

---

### 8. Bridge Pattern

**Concept**: Decouple an abstraction (pen type rendering logic) from its implementation (Canvas2D or WebGL drawing primitives). The abstraction and implementation can vary independently.

**Application to This Problem**:

```typescript
// Implementation hierarchy (the "bridge" — drawing primitives)
interface DrawingBackend {
  fillPath(vertices: Float32Array, color: string, opacity: number): void;
  fillTriangles(vertices: Float32Array, color: string, opacity: number): void;
  drawStampDiscs(color: string, data: Float32Array, opacity: number): void;
  drawStamps(texture: TextureHandle, data: Float32Array, opacity: number): void;
  beginOffscreen(id: string, width: number, height: number): void;
  endOffscreen(): void;
  compositeOffscreen(dx: number, dy: number, dw: number, dh: number): void;
  maskToPath(vertices: Float32Array): void;
  applyGrain(texture: TextureHandle, ox: number, oy: number, strength: number): void;
  setBlendMode(mode: BlendMode): void;
  save(): void;
  restore(): void;
  getTransform(): DOMMatrix;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

class Canvas2DBackend implements DrawingBackend {
  constructor(private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {}

  fillPath(vertices: Float32Array, color: string, opacity: number): void {
    const path = verticesToPath2D(vertices);
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = opacity;
    this.ctx.fill(path);
    this.ctx.globalAlpha = 1;
  }
  // ... implement all methods using Canvas 2D API
}

class WebGLBackend implements DrawingBackend {
  constructor(private engine: WebGL2Engine) {}

  fillPath(vertices: Float32Array, color: string, opacity: number): void {
    this.engine.setFillColor(color);
    this.engine.setAlpha(opacity);
    this.engine.fillPath(vertices);
    this.engine.setAlpha(1);
  }
  // ... implement all methods using WebGL
}

// Abstraction hierarchy (pen type rendering logic)
abstract class PenRenderer {
  constructor(protected backend: DrawingBackend) {}

  abstract renderCompleted(stroke: StrokeData): void;
  abstract renderActive(points: StrokePoint[], style: PenStyle): void;
}

class BallpointPenRenderer extends PenRenderer {
  renderCompleted(stroke: StrokeData): void {
    this.backend.fillPath(stroke.vertices, stroke.color, stroke.style.opacity);
  }
  renderActive(points: StrokePoint[], style: PenStyle): void {
    const vertices = generateVertices(points, style);
    this.backend.fillPath(vertices, resolveColor(style.color), style.opacity);
  }
}

class FountainPenRenderer extends PenRenderer {
  renderCompleted(stroke: StrokeData): void {
    if (stroke.pipeline === "advanced" && stroke.inkStampData) {
      this.backend.beginOffscreen("ink", stroke.region.sw, stroke.region.sh);
      this.backend.drawStamps(stroke.inkTexture, stroke.inkStampData, stroke.style.opacity);
      this.backend.maskToPath(stroke.vertices);
      this.backend.endOffscreen();
      this.backend.compositeOffscreen(stroke.region.sx, stroke.region.sy, stroke.region.sw, stroke.region.sh);
    } else {
      this.backend.fillPath(stroke.vertices, stroke.color, stroke.style.opacity);
    }
    // Ink pooling
    if (stroke.inkPools?.length) {
      renderInkPools(this.backend, stroke.inkPools, stroke.color);
    }
  }
  // ...
}

// Usage
const backend = engineType === "webgl"
  ? new WebGLBackend(webglEngine)
  : new Canvas2DBackend(ctx);

const penRenderers: Record<PenType, PenRenderer> = {
  ballpoint: new BallpointPenRenderer(backend),
  "felt-tip": new FeltTipPenRenderer(backend),
  pencil: new PencilPenRenderer(backend),
  fountain: new FountainPenRenderer(backend),
  highlighter: new HighlighterPenRenderer(backend),
};

function renderStroke(stroke: StrokeData): void {
  penRenderers[stroke.style.pen].renderCompleted(stroke);
}
```

**How It Handles the Cross-Product**:
- **Engine**: The `DrawingBackend` interface is the bridge. Pen renderers call backend methods without knowing if it's Canvas2D or WebGL.
- **Pen type**: Each pen type has its own `PenRenderer` subclass (this is Strategy pattern on top of Bridge).
- **Pipeline**: Checked within pen renderer methods.
- **Active vs Completed**: Separate methods on the pen renderer.

**Adding a New Pen Type**: Create a new `PenRenderer` subclass. It automatically works with both backends.

**Adding a New Engine**: Create a new `DrawingBackend` implementation. All pen renderers automatically work with it.

**Code Duplication Reduction**: Excellent. The combination of Bridge (engine abstraction) + Strategy (pen dispatch) eliminates duplication in both dimensions simultaneously. This is the core insight.

**Drawbacks**:
- **Two parallel hierarchies**: Both the abstraction (pen renderers) and implementation (backends) need to be maintained.
- **Backend API design is critical**: The `DrawingBackend` interface must expose operations at the right level of abstraction. Too low-level (individual `ctx.fillStyle = color` calls) and each pen renderer has too much boilerplate. Too high-level (a single `renderFountainPenInkShading()` method) and the backends duplicate pen-specific logic.
- **Still requires pen-type dispatch**: A registry or factory is needed to map pen types to their renderers.

**Complexity Cost**: Moderate. The Bridge + Strategy combination is the most architecturally sound approach for this problem, addressing the two primary dimensions of variation (engine and pen type).

**Verdict: This is the strongest candidate for the primary pattern.**

---

### 9. Decorator Pattern

**Concept**: Add effects (grain, ink pooling, highlighter blending) as decorators wrapped around a base rendering implementation. Each decorator adds one visual effect.

**Application to This Problem**:

```typescript
// Base interface
interface StrokeDrawer {
  draw(ctx: RenderContext, stroke: StrokeData): void;
}

// Core drawing — just fills the path
class BaseFillDrawer implements StrokeDrawer {
  draw(ctx: RenderContext, stroke: StrokeData): void {
    ctx.setFillColor(stroke.color);
    ctx.setAlpha(stroke.style.opacity);
    ctx.fillPath(stroke.vertices);
    ctx.setAlpha(1);
  }
}

// Decorator base
abstract class StrokeDrawerDecorator implements StrokeDrawer {
  constructor(protected inner: StrokeDrawer) {}
  abstract draw(ctx: RenderContext, stroke: StrokeData): void;
}

// Grain effect decorator
class GrainDecorator extends StrokeDrawerDecorator {
  draw(ctx: RenderContext, stroke: StrokeData): void {
    if (ctx.pipeline === "basic" || !stroke.penConfig.grain?.enabled || stroke.grainStrength <= 0) {
      this.inner.draw(ctx, stroke);
      return;
    }
    // Wrap in offscreen for grain isolation
    const region = computeScreenBBox(stroke.bbox, ctx.getTransform(), ctx.width, ctx.height);
    if (!region) { this.inner.draw(ctx, stroke); return; }

    ctx.beginOffscreen("grain", region.sw, region.sh);
    this.inner.draw(ctx, stroke);  // Inner drawer fills the stroke
    ctx.applyGrain(stroke.grainTexture, stroke.grainAnchorX, stroke.grainAnchorY, stroke.grainStrength);
    ctx.endOffscreen();
    ctx.compositeOffscreen(region);
  }
}

// Highlighter mode decorator
class HighlighterDecorator extends StrokeDrawerDecorator {
  draw(ctx: RenderContext, stroke: StrokeData): void {
    if (!stroke.penConfig.highlighterMode) {
      this.inner.draw(ctx, stroke);
      return;
    }
    ctx.save();
    ctx.setAlpha(stroke.penConfig.baseOpacity);
    ctx.setBlendMode("multiply");
    this.inner.draw(ctx, stroke);
    ctx.restore();
  }
}

// Ink pooling decorator (post-effect)
class InkPoolingDecorator extends StrokeDrawerDecorator {
  draw(ctx: RenderContext, stroke: StrokeData): void {
    this.inner.draw(ctx, stroke);  // Draw the stroke first
    if (ctx.pipeline !== "basic" && stroke.style.pen === "fountain" && stroke.inkPools?.length) {
      renderInkPools(ctx, stroke.inkPools, stroke.color);
    }
  }
}

// Composition — decorators are stacked
function createDrawerForPen(penType: PenType, pipeline: RenderPipeline): StrokeDrawer {
  let drawer: StrokeDrawer;

  // Select base drawer
  const config = getPenConfig(penType);
  if (pipeline === "advanced" && config.stamp) {
    drawer = new StampDrawer();
  } else if (pipeline === "advanced" && config.inkStamp) {
    drawer = new InkShadingDrawer();
  } else {
    drawer = new BaseFillDrawer();
  }

  // Stack decorators for applicable effects
  drawer = new HighlighterDecorator(drawer);
  drawer = new GrainDecorator(drawer);
  drawer = new InkPoolingDecorator(drawer);

  return drawer;
}
```

**How It Handles the Cross-Product**:
- Each effect (grain, ink pooling, highlighter) is isolated in its own decorator.
- Decorators check applicability internally and pass through if not relevant.
- Engine abstraction via `RenderContext`.
- The factory function selects the base drawer and stacks applicable decorators.

**Adding a New Pen Type**: Create a new base drawer if needed. Existing decorators automatically apply if their conditions are met.

**Adding a New Effect**: Create a new decorator. Wrap existing drawers with it. Existing code unchanged.

**Code Duplication Reduction**: Good for effects that wrap around the base drawing (grain isolation, highlighter blending). Each effect is written once.

**Drawbacks**:
- **Wrapping complexity**: The grain decorator must wrap the inner drawing in offscreen begin/end. This means it must call `this.inner.draw()` in the middle of its own logic. The offscreen management logic (region computation, transform adjustment) is tightly coupled to the wrapping.
- **Order sensitivity**: `GrainDecorator` must be outside `HighlighterDecorator` for correct compositing. The stacking order is implicit and easy to get wrong.
- **Performance**: Each decorator adds a function call layer. For strokes rendered at 60fps, this is negligible. For batch-rendering hundreds of strokes during a full redraw, it accumulates.
- **Debugging**: A bug in the stacking order produces subtle visual artifacts. Tracing through 3 nested decorator calls to understand the rendering sequence is not intuitive.
- **Mutual exclusivity**: Some base drawers are mutually exclusive (stamp rendering replaces fill rendering). The decorator pattern doesn't naturally model "choose one of these" — it models "add this on top of that."

**Complexity Cost**: Moderate. Elegant for layered effects. Awkward for mutually exclusive rendering strategies (stamps vs fill).

---

### 10. Material System (Game Engine Inspired)

**Concept**: Treat each pen type as a "material" with declarative properties that describe how strokes should be rendered. A material compiler translates these properties into rendering operations.

**Application to This Problem**:

```typescript
// Material definition — declarative description of rendering behavior
interface StrokeMaterial {
  name: string;

  // Body rendering
  body:
    | { type: "fill" }
    | { type: "stamps"; config: PenStampConfig }
    | { type: "inkShading"; config: InkStampConfig; preset: InkPresetConfig };

  // Blend mode
  blending: {
    mode: BlendMode;
    opacity: number;  // Base opacity (highlighter = 0.3, others = 1.0)
  };

  // Post-effects (applied in order)
  effects: MaterialEffect[];

  // Whether the body rendering requires offscreen isolation
  needsIsolation: boolean;
}

type MaterialEffect =
  | { type: "grain"; strength: number; enabled: boolean }
  | { type: "inkPooling"; enabled: boolean }
  | { type: "outlineMask" };  // destination-in mask to outline path

// Material definitions — one per pen type x pipeline combination
function getMaterial(penType: PenType, pipeline: RenderPipeline): StrokeMaterial {
  switch (penType) {
    case "ballpoint":
      return {
        name: "ballpoint",
        body: { type: "fill" },
        blending: { mode: "source-over", opacity: 1.0 },
        effects: [],
        needsIsolation: false,
      };

    case "pencil":
      return pipeline === "advanced"
        ? {
            name: "pencil-advanced",
            body: { type: "stamps", config: PEN_CONFIGS.pencil.stamp! },
            blending: { mode: "source-over", opacity: 0.85 },
            effects: [
              { type: "grain", strength: 0.5, enabled: true },
            ],
            needsIsolation: true,
          }
        : {
            name: "pencil-basic",
            body: { type: "fill" },
            blending: { mode: "source-over", opacity: 0.85 },
            effects: [
              { type: "grain", strength: 0.5, enabled: true },
            ],
            needsIsolation: true,
          };

    case "fountain":
      return pipeline === "advanced"
        ? {
            name: "fountain-advanced",
            body: { type: "inkShading", config: PEN_CONFIGS.fountain.inkStamp!, preset: getInkPreset("standard") },
            blending: { mode: "source-over", opacity: 1.0 },
            effects: [
              { type: "outlineMask" },
              { type: "inkPooling", enabled: true },
            ],
            needsIsolation: true,
          }
        : {
            name: "fountain-basic",
            body: { type: "fill" },
            blending: { mode: "source-over", opacity: 1.0 },
            effects: [
              { type: "inkPooling", enabled: true },
            ],
            needsIsolation: false,
          };

    case "highlighter":
      return {
        name: "highlighter",
        body: { type: "fill" },
        blending: { mode: "multiply", opacity: 0.3 },
        effects: [],
        needsIsolation: false,
      };

    // ...
  }
}

// Material executor — interprets a material against a RenderContext
function executeMaterial(
  ctx: RenderContext,
  material: StrokeMaterial,
  stroke: StrokeData,
): void {
  const color = stroke.color;

  if (material.needsIsolation) {
    const region = computeScreenBBox(stroke.bbox, ctx.getTransform(), ctx.width, ctx.height);
    if (region) {
      ctx.beginOffscreen("material", region.sw, region.sh);
    }
  }

  // Apply blending
  ctx.save();
  ctx.setAlpha(material.blending.opacity);
  if (material.blending.mode !== "source-over") {
    ctx.setBlendMode(material.blending.mode);
  }

  // Render body
  switch (material.body.type) {
    case "fill":
      ctx.setFillColor(color);
      ctx.fillPath(stroke.vertices);
      break;
    case "stamps":
      ctx.drawStampDiscs(color, stroke.stampData!);
      break;
    case "inkShading":
      ctx.drawStamps(stroke.inkTexture!, stroke.inkStampData!);
      break;
  }

  ctx.restore();

  // Apply effects in order
  for (const effect of material.effects) {
    switch (effect.type) {
      case "grain":
        if (effect.enabled && stroke.grainStrength > 0) {
          ctx.applyGrain(stroke.grainTexture!, stroke.grainAnchorX, stroke.grainAnchorY, stroke.grainStrength);
        }
        break;
      case "outlineMask":
        ctx.maskToPath(stroke.vertices);
        break;
      case "inkPooling":
        if (effect.enabled && stroke.inkPools?.length) {
          renderInkPools(ctx, stroke.inkPools, color);
        }
        break;
    }
  }

  if (material.needsIsolation) {
    ctx.endOffscreen();
    ctx.compositeOffscreen(/* region */);
  }
}
```

**How It Handles the Cross-Product**:
- **Pen type x Pipeline**: Each combination maps to a `StrokeMaterial` — a pure data object describing the rendering recipe.
- **Engine**: The material executor calls `RenderContext` methods. Engine-agnostic.
- **Active vs Completed**: Active materials could omit effects for performance, or use simplified body types.

**Adding a New Pen Type**: Define a new `StrokeMaterial`. If it uses existing body types and effects, zero new rendering code is needed.

**Adding a New Effect**: Add a new `MaterialEffect` variant and a case in the executor.

**Code Duplication Reduction**: Excellent. Rendering logic is centralized in the executor. Materials are pure data. The same executor serves all pen types.

**Drawbacks**:
- **Ink shading is complex**: The fountain pen ink shading flow (deposit stamps on offscreen, mask to outline, composite back) is not a simple "draw body + apply effects" sequence. The outline mask must happen after stamp deposit but before compositing. This requires the material system to support different isolation/compositing flows, which adds complexity to the executor.
- **Material definitions are still branchy**: `getMaterial()` is effectively the same dispatch logic as the current code, just returning data instead of executing imperatively.
- **Fixed effect ordering**: Effects are applied in array order. If a new effect needs to wrap around the body (like grain isolation), the linear effect list can't express that without special casing.

**Complexity Cost**: Moderate. The data-driven approach is clean conceptually, but the executor must handle complex compositing flows that resist simple linearization.

**Verdict: This is the second-strongest candidate. The declarative material definitions make it easy to reason about what each pen type does.**

---

## Supplementary Research

### Render Graph Architecture

Modern game engines (Frostbite's FrameGraph, Unreal Engine's RDG) use directed acyclic graphs to represent rendering passes and their resource dependencies. Each node declares its inputs and outputs, and the graph scheduler determines execution order, resource lifetimes, and memory allocation.

**Relevance to ObsidianPaper**: A render graph is dramatically over-engineered for this use case. Render graphs are designed for 50+ rendering passes with complex resource sharing (shadow maps, G-buffers, post-processing chains). ObsidianPaper has ~3 rendering passes (fill/stamp body, optional grain/mask effect, composite). The setup/compile/execute three-phase approach adds latency that would be noticeable at 120Hz Apple Pencil input rates.

**What to borrow**: The concept of declaring inputs/outputs for each rendering step is valuable for documentation and testing, even without a full graph scheduler. Materials (Pattern 10) accomplish this declaratively.

Sources:
- [FrameGraph: Extensible Rendering Architecture in Frostbite (GDC 2017)](https://www.gdcvault.com/play/1024612/FrameGraph-Extensible-Rendering-Architecture-in)
- [Render Graphs](https://logins.github.io/graphics/2021/05/31/RenderGraphs.html)
- [Render Graphs (apoorvaj.io)](https://apoorvaj.io/render-graphs-1)
- [In-Depth Analysis of Unreal Engine RenderGraph Source Code](https://www.oreateai.com/blog/indepth-analysis-of-unreal-engine-rendergraph-source-code/097058615ef3074de5a47a667fdb6690)

### Flutter's Rendering Pipeline

Flutter's rendering pipeline has three relevant phases:
1. **Layout**: Computes the size and position of render objects.
2. **Paint**: Calls `paint()` on each render object, which draws to a `Canvas`.
3. **Compositing**: Builds a `LayerTree` of compositing layers, each independently manipulable.

**Relevance**: Flutter's `CustomPainter` is analogous to ObsidianPaper's stroke rendering — a callback that receives a canvas and size, then draws. Flutter's compositing layer tree (where each layer can be clipped, transformed, or cached independently) is similar to the offscreen isolation pattern used for grain and ink shading. The key lesson: **separate the "what to paint" decision from the "how to composite" decision**.

Flutter's `PipelineOwner` coordinates the paint phase, calling `flushPaint()` which visits dirty render objects. This is similar to the tile-based dirty tracking in ObsidianPaper's `TileCache`.

Sources:
- [Understanding the Flutter Rendering Pipeline](https://medium.com/@serikbay.a04/understanding-the-flutter-rendering-pipeline-from-widgets-to-pixels-2cef3caa57f1)
- [Flutter's Architecture: Understanding the Internals](https://flutterexperts.com/flutters-architecture-understanding-the-internals/)
- [Compositing | Flutter Internals](https://flutter.megathink.com/rendering/compositing)
- [Flutter Custom Painters and Advanced Graphics](https://dasroot.net/posts/2026/01/flutter-custom-painters-advanced-graphics-deep-dive/)

### Effect Composition in Graphics Programming

Post-processing effect composition typically uses "ping pong" buffering — alternating between two offscreen buffers, applying one effect per pass. Three.js's `EffectComposer` implements this pattern.

**Relevance**: ObsidianPaper's effects (grain, ink shading mask) already use offscreen buffers. The ping-pong pattern could be useful if effects stack (grain + ink pooling on the same stroke). Currently, grain and ink shading are mutually exclusive per pen type, so ping-pong is not needed. If future effects require chaining, this pattern becomes relevant.

The key insight from effect composition: **effects should be composable by default**. Each effect takes a buffer in and produces a buffer out. The framework handles buffer management.

Sources:
- [Post-Processing (Shader Time)](https://shadertime.betamovement.net/lecture/post-processing/)
- [Post-Processing Shaders as a Creative Medium](https://blog.maximeheckel.com/posts/post-processing-as-a-creative-medium/)
- [Effects and Shaders (Stride Manual)](https://doc.stride3d.net/latest/en/manual/graphics/effects-and-shaders/index.html)

### TypeScript-Specific Patterns

#### Discriminated Unions + Exhaustive Switch

TypeScript's discriminated unions provide compile-time exhaustiveness checking, which is more valuable than runtime polymorphism for a fixed set of pen types.

```typescript
type PenType = "ballpoint" | "felt-tip" | "pencil" | "fountain" | "highlighter";

// Material defined as discriminated union
type StrokeBodyType =
  | { kind: "fill" }
  | { kind: "stamps"; config: PenStampConfig }
  | { kind: "inkShading"; config: InkStampConfig; preset: InkPresetConfig };

// Exhaustive switch — compiler warns if a case is missing
function renderBody(ctx: RenderContext, body: StrokeBodyType, stroke: StrokeData): void {
  switch (body.kind) {
    case "fill":
      ctx.setFillColor(stroke.color);
      ctx.fillPath(stroke.vertices);
      break;
    case "stamps":
      ctx.drawStampDiscs(stroke.color, stroke.stampData!);
      break;
    case "inkShading":
      ctx.drawStamps(stroke.inkTexture!, stroke.inkStampData!);
      break;
    default: {
      const _exhaustive: never = body;
      throw new Error(`Unhandled body type: ${(_exhaustive as StrokeBodyType).kind}`);
    }
  }
}
```

**Key advantage**: When you add a new `StrokeBodyType` variant, TypeScript's `never` check forces you to handle it everywhere. This catches missing cases at compile time, unlike runtime Strategy/Template Method patterns.

#### Branded Types for Type Safety

```typescript
// Branded types prevent mixing up Float32Array uses
type PathVertices = Float32Array & { __brand: "PathVertices" };
type StampData = Float32Array & { __brand: "StampData" };
type InkStampData = Float32Array & { __brand: "InkStampData" };

function fillPath(ctx: RenderContext, vertices: PathVertices): void { /* ... */ }
function drawStamps(ctx: RenderContext, data: StampData): void { /* ... */ }

// Compiler error: StampData is not assignable to PathVertices
fillPath(ctx, stampData); // ERROR
```

Sources:
- [Discriminated Unions | TypeScript Deep Dive](https://basarat.gitbook.io/typescript/type-system/discriminated-unions)
- [Demystifying TypeScript Discriminated Unions | CSS-Tricks](https://css-tricks.com/typescript-discriminated-unions/)
- [Unions and intersections of object types in TypeScript](https://2ality.com/2025/03/object-type-union-intersection.html)

### Drawing Application Architectures

Pencil2D uses a `StrokeTool` base class with per-tool subclasses (`BrushTool`, `PencilTool`, etc.) that override `drawStroke()`. This is essentially the Template Method pattern. Each tool inherits common pointer event handling and overrides the rendering method.

Procreate's Brush Studio uses a material-like system where each brush is defined by properties (shape, grain, dynamics, rendering mode) rather than code. The rendering engine interprets these properties. This is the Material System pattern.

Sources:
- [Stroke-Based Drawing Tools (Pencil2D)](https://deepwiki.com/pencil2d/pencil/5.2-stroke-based-drawing-tools)
- [Brush Studio Settings (Procreate Handbook)](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
- [Stroke-Based Rendering (Hertzmann, SIGGRAPH 2002)](https://www.cs.ucdavis.edu/~ma/SIGGRAPH02/course23/notes/S02c23_3.pdf)

---

## Comparative Summary

| Pattern | Pen Type Extensibility | Engine Dedup | Effect Composability | Active/Completed Unification | Complexity |
|---------|----------------------|-------------|---------------------|------------------------------|------------|
| Strategy | Excellent | None (needs Bridge) | Poor | Good | Low |
| Template Method | Good | None (needs Bridge) | Moderate | Good | Low-Med |
| ECS | Good | Via system abstraction | Excellent | Moderate | High |
| Command | Moderate | Via context abstraction | Moderate | Moderate | Med-High |
| Pipeline | Good | Via context abstraction | Good | Good | Moderate |
| Visitor | Poor (expression problem) | Via context abstraction | Poor | Moderate | High |
| Abstract Factory | N/A (engine only) | Excellent | N/A | N/A | Low |
| **Bridge** | **Excellent** (combined w/Strategy) | **Excellent** | Moderate | **Good** | **Moderate** |
| Decorator | Good for effects | Via context abstraction | Excellent | Moderate | Moderate |
| **Material System** | **Excellent** | **Excellent** (via executor) | **Good** | **Good** | **Moderate** |

---

## Recommendation

### Primary Pattern: Bridge + Material System Hybrid

The recommended architecture combines:

1. **Bridge Pattern** for engine abstraction: A `DrawingBackend` interface with Canvas2D and WebGL implementations. This replaces the current dual functions (`renderStrokeToContext` / `renderStrokeToEngine`).

2. **Material System** for pen type dispatch: Each pen type x pipeline combination produces a `StrokeMaterial` data object. A single `executeMaterial()` function interprets materials against the `DrawingBackend`.

3. **TypeScript Discriminated Unions** for type-safe effect definitions: Material effects use discriminated union types with exhaustive switch handling.

This combination:
- **Eliminates the Context/Engine duplication** (Bridge handles this)
- **Eliminates the pen-type if/else chain** (Material definitions handle this)
- **Makes adding a new pen type trivial** (define a new material, zero rendering code changes if using existing body types/effects)
- **Makes adding a new engine trivial** (implement `DrawingBackend`, zero pen-type code changes)
- **Is testable** (materials are pure data, the executor is a single function that can be tested with mock backends)
- **Preserves performance** (no object allocation per stroke, no deep call stacks)

### Architecture Sketch

```
PenConfig + Pipeline + Style
        |
        v
  getMaterial(penType, pipeline)
        |
        v
  StrokeMaterial (pure data)
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

The active stroke rendering path uses the same materials with simplified effect lists (e.g., no grain isolation, no ink pooling) for performance.

### Migration Path

1. **Phase 1**: Define `DrawingBackend` interface. Implement `Canvas2DBackend` wrapping existing `CanvasRenderingContext2D` calls. Implement `WebGLBackend` wrapping existing `RenderEngine` calls.
2. **Phase 2**: Define `StrokeMaterial` types and `getMaterial()` function. Write `executeMaterial()`.
3. **Phase 3**: Replace `renderStrokeToContext()` with `executeMaterial(canvas2dBackend, ...)`.
4. **Phase 4**: Replace `renderStrokeToEngine()` with `executeMaterial(webglBackend, ...)`.
5. **Phase 5**: Unify active stroke rendering in `Renderer.renderActiveStroke()` to use materials.
6. **Phase 6**: Remove dead code from `StrokeRenderCore.ts`.

Each phase can be done incrementally. The old and new systems can coexist during migration.
