# Rendering Architecture Redesign: Implementation Plan

## Context

Every time we add or update a pen type with stamps/textures, 10-12 files must be modified and the same mistakes recur. The rendering logic is duplicated 3x (`renderStrokeToContext`, `renderStrokeToEngine`, `renderActiveStroke`), resource forwarding requires 7+ methods per texture type, and the stamp systems (`StampRenderer`/`InkStampRenderer`) duplicate logic without shared abstractions.

This plan implements a **Bridge + Material System** with three registries that reduces new pen additions to 3-7 localized file changes with zero modifications to rendering dispatch, backends, tile system, or resource plumbing.

**Research reference:** `Claude/Research/2026-02-27-rendering-architecture-redesign.md`

---

## Phase 0: Golden Master Characterization Tests

**Goal:** Lock in current rendering behavior as a regression safety net before any architecture changes. Record the exact sequence of RenderEngine method calls produced by every pen type / pipeline / LOD combination, then verify the new architecture produces identical call sequences.

### Approach: Recording RenderEngine Spy

Since jsdom can't produce actual pixel output, we record the **method call sequence** on the `RenderEngine` interface. This captures every drawing operation (fillPath, drawStampDiscs, applyGrain, etc.), every state change (setFillColor, setAlpha, setBlendMode), and every structural operation (save, restore, beginOffscreen, maskToPath). If the new architecture produces the same call sequence, it renders identically.

For Canvas2D, we apply the same approach with a recording spy over the `CanvasRenderingContext2D` methods -- capturing `fill()`, `fillStyle`, `globalAlpha`, `globalCompositeOperation`, `save()`, `restore()`, `setTransform()`, `drawImage()`, `clip()`, etc.

### Create files

**`src/canvas/__tests__/RecordingEngine.ts`** -- A `RenderEngine` implementation that records all calls:

```typescript
interface RecordedCall {
  method: string;
  args: unknown[];  // Float32Array serialized to number[], TextureHandle to { id }
}

class RecordingEngine implements RenderEngine {
  readonly calls: RecordedCall[] = [];

  // Implement every RenderEngine method to:
  // 1. Push { method, args } to this.calls
  // 2. Handle state (transform stack, offscreen stack) minimally so
  //    getTransform() returns a DOMMatrix and beginOffscreen/endOffscreen work

  // Transform state needed for getTransform() calls inside rendering code:
  private transformStack: DOMMatrix[] = [];
  private currentTransform = new DOMMatrix();

  // Offscreen targets (simple objects with width/height)
  private offscreens = new Map<string, OffscreenTarget>();

  // Implement key methods:
  save() { this.calls.push({ method: "save", args: [] }); ... }
  restore() { this.calls.push({ method: "restore", args: [] }); ... }
  setTransform(a, b, c, d, e, f) { this.calls.push({ method: "setTransform", args: [a,b,c,d,e,f] }); ... }
  getTransform() { return this.currentTransform; }
  setFillColor(color) { this.calls.push({ method: "setFillColor", args: [color] }); }
  setAlpha(alpha) { this.calls.push({ method: "setAlpha", args: [alpha] }); }
  setBlendMode(mode) { this.calls.push({ method: "setBlendMode", args: [mode] }); }
  fillPath(vertices) { this.calls.push({ method: "fillPath", args: [Array.from(vertices)] }); }
  fillTriangles(vertices) { this.calls.push({ method: "fillTriangles", args: [Array.from(vertices)] }); }
  drawStampDiscs(color, data) { this.calls.push({ method: "drawStampDiscs", args: [color, Array.from(data)] }); }
  drawStamps(texture, data) { this.calls.push({ method: "drawStamps", args: [{ id: "tex" }, Array.from(data)] }); }
  applyGrain(tex, ox, oy, strength) { this.calls.push({ method: "applyGrain", args: [{ id: "grain" }, ox, oy, strength] }); }
  maskToPath(v) { this.calls.push({ method: "maskToPath", args: [Array.from(v)] }); }
  maskToTriangles(v) { this.calls.push({ method: "maskToTriangles", args: [Array.from(v)] }); }
  beginOffscreen(target) { this.calls.push({ method: "beginOffscreen", args: [{ w: target.width, h: target.height }] }); }
  endOffscreen() { this.calls.push({ method: "endOffscreen", args: [] }); }
  drawOffscreen(target, dx, dy, dw, dh) { this.calls.push({ method: "drawOffscreen", args: [{ w: target.width, h: target.height }, dx, dy, dw, dh] }); }
  clipPath(v) { this.calls.push({ method: "clipPath", args: [Array.from(v)] }); }
  clipRect(x, y, w, h) { this.calls.push({ method: "clipRect", args: [x, y, w, h] }); }
  clear() { this.calls.push({ method: "clear", args: [] }); }
  // ... remaining methods as no-ops or minimal implementations

  // Utility
  reset() { this.calls.length = 0; }
  snapshot(): RecordedCall[] { return structuredClone(this.calls); }
}
```

Key design: The recording engine must maintain a real transform stack and DOMMatrix because `renderStrokeToEngine` calls `engine.getTransform()` and uses the result for `computeScreenBBox()`. Similarly, `getOffscreen()` must return objects with real `width`/`height` because `beginOffscreen`/`drawOffscreen` use those dimensions.

**`src/canvas/__tests__/RecordingContext2D.ts`** -- A mock `CanvasRenderingContext2D` that records calls:

```typescript
class RecordingContext2D {
  readonly calls: RecordedCall[] = [];

  // State that renderStrokeToContext reads:
  fillStyle: string = "";
  globalAlpha: number = 1;
  globalCompositeOperation: string = "source-over";
  private transformStack: DOMMatrix[] = [];
  private currentTransform = new DOMMatrix();

  // Mock canvas (needed by createPattern, etc.)
  canvas = { width: 2048, height: 2048 };

  // Recording + state management for key methods:
  save() { this.calls.push({ method: "save", args: [] }); ... }
  restore() { this.calls.push({ method: "restore", args: [] }); ... }
  setTransform(...args) { this.calls.push({ method: "setTransform", args }); ... }
  getTransform() { return this.currentTransform; }
  fill(path?) { this.calls.push({ method: "fill", args: [path ? "Path2D" : "current"] }); }
  clip(path?) { this.calls.push({ method: "clip", args: [path ? "Path2D" : "current"] }); }
  clearRect(x, y, w, h) { this.calls.push({ method: "clearRect", args: [x, y, w, h] }); }
  drawImage(...args) { this.calls.push({ method: "drawImage", args: ["canvas", ...args.slice(1)] }); }
  arc(x, y, r, ...) { this.calls.push({ method: "arc", args: [x, y, r] }); }
  beginPath() { this.calls.push({ method: "beginPath", args: [] }); }
  // createPattern returns a mock pattern
  createPattern() { return { setTransform: jest.fn() }; }
}
```

Note: Canvas2D recording captures state changes (fillStyle, globalAlpha, globalCompositeOperation) as calls too, since `renderStrokeToContext` sets these as property assignments. We record them by using `Object.defineProperty` setters that push to the calls array.

**`src/canvas/__tests__/stroke-fixtures.ts`** -- Comprehensive test stroke data factory:

```typescript
// Stroke point generators for different input scenarios
function generateStraightLine(length: number, options?: { speed, pressure, tilt }): StrokePoint[]
function generateCurve(points: number, curvature: number, options?): StrokePoint[]
function generateZigzag(segments: number, amplitude: number, options?): StrokePoint[]
function generateSpiral(turns: number, options?): StrokePoint[]
function generateDot(options?): StrokePoint[]  // Single tap

// Pressure profiles
function constantPressure(value: number): (t: number) => number
function rampPressure(start: number, end: number): (t: number) => number
function bellPressure(peak: number): (t: number) => number
function jitterPressure(base: number, amplitude: number): (t: number) => number

// Tilt profiles
function noTilt(): (t: number) => { tiltX: number; tiltY: number }
function constantTilt(x: number, y: number): (t: number) => { tiltX: number; tiltY: number }
function sweepingTilt(startAngle: number, endAngle: number, magnitude: number): (t: number) => { tiltX: number; tiltY: number }

// Speed profiles (affects timestamp spacing)
function constantSpeed(pixelsPerMs: number): (t: number) => number
function deceleratingSpeed(startSpeed: number, endSpeed: number): (t: number) => number
function variableSpeed(speeds: number[]): (t: number) => number

// Build a complete Stroke object from points + style
function buildStroke(points: StrokePoint[], styleId: string, overrides?: Partial<Stroke>): Stroke

// Quantize points through encode/decode round-trip (important: ensures test data matches real encoding precision)
function quantizeStroke(stroke: Stroke): Stroke

// Style definitions for each pen type
const TEST_STYLES: Record<string, PenStyle> = {
  "ballpoint-default": { pen: "ballpoint", color: "#1a1a1a", width: 2, opacity: 1, smoothing: 0.5, pressureCurve: 1, tiltSensitivity: 0 },
  "felt-tip-default": { pen: "felt-tip", color: "#333333", width: 6, opacity: 1, smoothing: 0.5, pressureCurve: 1, tiltSensitivity: 0 },
  "pencil-default": { pen: "pencil", color: "#2d2d2d", width: 3, opacity: 0.85, smoothing: 0.4, pressureCurve: 1, tiltSensitivity: 0, grain: 0.5 },
  "fountain-default": { pen: "fountain", color: "#000000", width: 6, opacity: 1, smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0, nibAngle: Math.PI / 6, nibThickness: 0.25, inkPreset: "classic" },
  "fountain-no-nib": { pen: "fountain", color: "#000000", width: 6, opacity: 1, smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0 },
  "fountain-no-shading": { pen: "fountain", color: "#000000", width: 6, opacity: 1, smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0, nibAngle: Math.PI / 6, nibThickness: 0.25 },
  "highlighter-default": { pen: "highlighter", color: "#FFD700", width: 24, opacity: 0.3, smoothing: 0.8, pressureCurve: 1, tiltSensitivity: 0 },
  "pencil-low-grain": { pen: "pencil", color: "#2d2d2d", width: 3, opacity: 0.85, smoothing: 0.4, pressureCurve: 1, tiltSensitivity: 0, grain: 0.1 },
  "pencil-high-grain": { pen: "pencil", color: "#2d2d2d", width: 3, opacity: 0.85, smoothing: 0.4, pressureCurve: 1, tiltSensitivity: 0, grain: 0.9 },
  "fountain-barrel-rotation": { pen: "fountain", color: "#000000", width: 6, opacity: 1, smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0, nibAngle: Math.PI / 6, nibThickness: 0.25, useBarrelRotation: true, inkPreset: "classic" },
};
```

**`src/canvas/__tests__/golden-master.test.ts`** -- The main characterization test suite:

```typescript
// Matrix dimensions:
// - 5 pen types (+ fountain variants: with/without nib, with/without ink preset, barrel rotation)
// - 2 pipelines (basic, advanced)
// - 4 LOD levels (0, 1, 2, 3)
// - 6+ stroke shapes (straight, curve, zigzag, spiral, dot, fast-scribble)
// - 3+ pressure profiles (constant, ramp, bell, jitter)
// - 2+ tilt profiles (none, constant, sweeping)
// - 2 rendering paths (Canvas2D context, RenderEngine)

// We don't test every combination -- we test the meaningful combinations:
// LOD 0 only for stamp/grain/ink-shading (higher LODs skip advanced effects)
// Tilt only for pencil and felt-tip (only pens with tiltConfig)

describe("Golden Master: renderStrokeToEngine", () => {
  for (const [styleName, style] of Object.entries(TEST_STYLES)) {
    for (const pipeline of ["basic", "advanced"] as const) {
      for (const lod of [0, 1, 2, 3] as const) {
        // Skip advanced-specific tests at high LOD (effects only at LOD 0)
        if (lod > 0 && pipeline === "advanced") continue;

        for (const strokeShape of ["straight", "curve", "zigzag", "spiral", "dot"]) {
          for (const pressure of ["constant", "ramp", "bell"]) {
            it(`${styleName} / ${pipeline} / LOD ${lod} / ${strokeShape} / ${pressure}`, () => {
              const points = generateStroke(strokeShape, pressure, ...);
              const stroke = buildStroke(quantizePoints(points), styleName);

              const engine = new RecordingEngine({ width: 2048, height: 2048 });
              engine.setTransform(2, 0, 0, 2, -100, -100); // Typical tile transform

              const pathCache = new StrokePathCache();
              const grainCtx = makeEngineGrainContext(pipeline);
              const stampCtx = makeEngineStampContext();

              renderStrokeToEngine(engine, stroke, { [styleName]: style }, lod, false, pathCache, grainCtx, stampCtx);

              expect(engine.snapshot()).toMatchSnapshot();
            });
          }
        }
      }
    }
  }
});

describe("Golden Master: renderStrokeToContext", () => {
  // Same matrix but using RecordingContext2D
  for (const [styleName, style] of Object.entries(TEST_STYLES)) {
    // ... same iteration ...
    it(`${styleName} / ${pipeline} / LOD ${lod} / ${strokeShape} / ${pressure}`, () => {
      const ctx = new RecordingContext2D({ width: 2048, height: 2048 });
      // ... same setup ...
      renderStrokeToContext(ctx, stroke, { [styleName]: style }, lod, false, pathCache, grainCtx, stampCtx);
      expect(ctx.snapshot()).toMatchSnapshot();
    });
  }
});
```

### Stroke generation coverage

Each stroke generator produces quantized points (via `encodePoints` -> `decodePoints` round-trip) to match real-world precision:

| Generator | Points | Pressure | Speed | Tilt | Purpose |
|-----------|--------|----------|-------|------|---------|
| `straightLine` | 30-50 | constant 0.5 | moderate | none | Baseline |
| `straightLine` | 30-50 | ramp 0.1→1.0 | moderate | none | Pressure transitions |
| `straightLine` | 30-50 | bell peak 0.8 | moderate | none | Press-release |
| `curve` | 40-60 | constant 0.5 | moderate | none | Bezier interpolation |
| `zigzag` | 60-80 | jitter 0.3-0.7 | fast | none | Direction changes + jitter |
| `spiral` | 80-100 | ramp 0.3→0.9 | decelerating | none | Curvature + speed change |
| `dot` | 1-3 | bell 0.6 | instant | none | Edge case: minimal points |
| `straightLine` | 30 | constant 0.5 | moderate | constant 30,0 | Tilt response |
| `curve` | 40 | constant 0.5 | moderate | sweeping 0→45 | Tilt variation |
| `straightLine` | 30 | constant 0.5 | fast (2px/ms) | none | High speed (ink pooling) |
| `straightLine` | 30 | constant 0.5 | slow (0.2px/ms) | none | Slow speed (ink deposit) |

### Mock contexts for `GrainRenderContext` / `StampRenderContext` / `EngineGrainContext` / `EngineStampContext`

```typescript
function makeEngineGrainContext(pipeline: RenderPipeline): EngineGrainContext {
  return {
    grainTexture: pipeline === "advanced" ? { width: 256, height: 256 } as TextureHandle : null,
    strengthOverrides: new Map(),
    pipeline,
    canvasWidth: 2048,
    canvasHeight: 2048,
  };
}

function makeEngineStampContext(): EngineStampContext {
  return {
    getStampTexture: (grainValue: number, color: string) => ({ width: 48, height: 48 } as TextureHandle),
    getInkStampTexture: (presetId: string | undefined, color: string) => ({ width: 64, height: 64 } as TextureHandle),
  };
}

function makeGrainRenderContext(pipeline: RenderPipeline): GrainRenderContext {
  return {
    generator: pipeline === "advanced" ? mockGrainGenerator : null,
    strengthOverrides: new Map(),
    pipeline,
    getOffscreen: (w, h) => ({ canvas: mockOffscreenCanvas(w, h), ctx: new RecordingContext2D({ width: w, height: h }) }),
    canvasWidth: 2048,
    canvasHeight: 2048,
  };
}

function makeStampRenderContext(): StampRenderContext {
  return {
    getCache: (grainValue) => mockStampCache,
    getInkCache: (presetId) => mockInkStampCache,
  };
}
```

### How snapshots verify the new architecture

Once Phase 6 replaces `renderStrokeToEngine` / `renderStrokeToContext` with `executeMaterial()`, the tests run again:

1. Same test stroke + style + pipeline + LOD
2. Same `RecordingEngine` / `RecordingContext2D`
3. Same function signature (`renderStrokeToEngine` now internally uses `executeMaterial()`)
4. Jest snapshot comparison: **if the call sequence differs, the test fails**

This catches:
- Missing rendering operations (forgot to apply grain)
- Reordered operations (grain before fill instead of after)
- Wrong state (opacity not set, blend mode missing)
- Different vertex data (outline generation regression)
- Different stamp data (stamp computation regression)

### Estimated test count

| Style Variant | Pipeline | LOD | Strokes | Pressure | Total per engine |
|---------------|----------|-----|---------|----------|-----------------|
| 10 styles | 2 | meaningful combos | 5-11 shapes | 3 profiles | ~200-300 |

We'll keep the matrix focused -- not every combination is meaningful. For example, LOD > 0 with advanced pipeline is skipped (effects disabled). Tilt only tested with pencil/felt-tip. Barrel rotation only with fountain. Total: **~400-600 snapshot tests** across both rendering paths.

### Tests location
- `src/canvas/__tests__/RecordingEngine.ts` -- RenderEngine spy
- `src/canvas/__tests__/RecordingContext2D.ts` -- Canvas2D context spy
- `src/canvas/__tests__/stroke-fixtures.ts` -- Stroke data generators
- `src/canvas/__tests__/golden-master.test.ts` -- Main snapshot test suite

### Validation
- `yarn test` generates `__snapshots__/golden-master.test.ts.snap`
- All snapshots reviewed manually for sanity (correct method sequences)
- Snapshots committed to git -- any rendering change triggers snapshot mismatch
- `yarn test -u` to update snapshots only when intentional changes are made

---

## Phase 1: DrawingBackend Interface (Additive, Zero Risk)

**Goal:** Create a unified `DrawingBackend` interface abstracting Canvas2D and WebGL, with two implementations.

### Create files

**`src/rendering/DrawingBackend.ts`** -- Interface with operations at the visual-concept level:
- Geometry: `fillPath(vertices, color, opacity)`, `fillTriangles(vertices, color, opacity)`
- Stamps: `drawStampDiscs(color, data, opacity)`, `drawStamps(texture, data, opacity)`
- Effects: `applyGrain(texture, anchorX, anchorY, strength)`, `maskToPath(vertices)`, `maskToTriangles(vertices)`
- Offscreen: `beginOffscreen(width, height)`, `endOffscreen()`, `compositeOffscreen(dx, dy, dw, dh)`
- State: `save()`, `restore()`, `setBlendMode(mode)`, `setTransform(...)`, `getTransform()`, `clipRect(...)`
- Info: `readonly width`, `readonly height`
- Also defines `TextureRef` (opaque handle) and `TransformData`

**`src/rendering/Canvas2DBackend.ts`** -- Wraps `CanvasRenderingContext2D`:
- Constructor: `new Canvas2DBackend(ctx)`
- `fillPath()` converts `Float32Array` to `Path2D` using `verticesToPath2D()` extracted from `Canvas2DEngine.ts` (~line 410)
- `drawStampDiscs()` loops `ctx.arc()` (same pattern as `StampRenderer.drawStamps()`)
- `applyGrain()` creates `CanvasPattern`, fills with `destination-out`
- `beginOffscreen()` creates/reuses `OffscreenCanvas` (same pattern as `Canvas2DOffscreenTarget`)

**`src/rendering/WebGLBackend.ts`** -- Wraps `RenderEngine` interface:
- Constructor: `new WebGLBackend(engine: RenderEngine)`
- Thin delegation: each method maps 1:1 to existing engine methods
- `fillPath()` -> `engine.setFillColor(); engine.setAlpha(); engine.fillPath()`
- `TextureRef` = `TextureHandle` from RenderEngine

### Key integration
- Extract `verticesToPath2D()` and `trianglesToPath2D()` from `Canvas2DEngine.ts` into shared importable helpers (or import directly from Canvas2DEngine)
- `WebGLBackend` wraps `RenderEngine` -- does NOT replace it

### Tests
- `Canvas2DBackend.test.ts`: Mock ctx, verify correct method calls (~25 tests)
- `WebGLBackend.test.ts`: Mock RenderEngine, verify delegation (~25 tests)

### Validation
- Both backends instantiate without error
- `yarn test` passes, `yarn build` succeeds

---

## Phase 2: Outline Strategy Registry (Additive, Zero Risk)

**Goal:** Extract outline generation into a strategy pattern with a config-driven registry.

### Create files

**`src/stroke/OutlineStrategy.ts`** -- Interface + registry:
```typescript
type OutlineStrategyId = "standard" | "italic";

interface OutlineStrategy {
  generateOutline(points, style, config, dejitter): OutlineResult;
}

interface OutlineResult {
  vertices: Float32Array;
  italic: boolean;
  rawOutline?: number[][];          // For StrokePathCache
  rawItalicSides?: ItalicOutlineSides; // For StrokePathCache
}

const OUTLINE_STRATEGIES: Record<OutlineStrategyId, OutlineStrategy>;
```

**`src/stroke/StandardOutlineStrategy.ts`** -- Delegates to existing `generateOutline()` from `OutlineGenerator.ts`

**`src/stroke/ItalicOutlineStrategy.ts`** -- Delegates to existing `generateItalicOutlineSides()` from `ItalicOutlineGenerator.ts`. Falls back to standard when `style.nibAngle == null` (handles fountain pen's dynamic italic detection via `isItalicStyle()`)

### Modify files

**`src/stroke/PenConfigs.ts`** -- Add `outlineStrategy: OutlineStrategyId` to `PenConfig`:
- ballpoint, felt-tip, pencil, highlighter: `"standard"`
- fountain: `"italic"` (runtime override to `"standard"` when `nibAngle` is null)

### Tests
- `OutlineStrategy.test.ts`: Standard and italic strategies produce byte-identical output to existing generators (~15 tests)

### Validation
- `yarn test` passes, `yarn build` succeeds
- Strategy output matches existing `generateStrokeVertices()` for all pen types

---

## Phase 3: Material Types + Executor (Additive, Zero Risk)

**Goal:** Define `StrokeMaterial` types and implement `resolveMaterial()` + `executeMaterial()`.

### Create files

**`src/rendering/StrokeMaterial.ts`** -- Types + resolver:
- `StrokeMaterial`: `{ body, blending, italic, isolation, effects }`
- `StrokeBody`: `"fill"` | `"stamps" (+ generatorId, stampConfig)` | `"inkShading" (+ generatorId, inkConfig, preset)`
- `MaterialEffect`: `"grain" (+ textureId, strengthSource)` | `"outlineMask"` | `"inkPooling"`
- `resolveMaterial(penType, pipeline, penConfig, style)`: Exhaustive switch over all 5 pen types x 2 pipelines

**`src/rendering/MaterialExecutor.ts`** -- Single rendering function:
- `executeMaterial(backend, material, data, resources)`: Handles isolation -> blending -> body -> effects -> close isolation
- `renderBody()`: Switch on `body.type` (`fill` -> fillPath/fillTriangles, `stamps` -> drawStampDiscs, `inkShading` -> drawStamps)
- `applyEffect()`: Switch on `effect.type` (`grain` -> applyGrain, `outlineMask` -> maskToPath, `inkPooling` -> renderInkPools)
- All switches use TypeScript exhaustive `never` checks

**`src/rendering/StrokeDataPreparer.ts`** -- Data preparation:
- `StrokeRenderData` interface: vertices, color, bbox, stampData?, inkStampData?, inkPools?, grainAnchor?, grainConfig?, styleOpacity, strokeId
- `prepareStrokeData(stroke, style, penConfig, material, pathCache, lod, ...)`: Decodes points, uses outline strategy, computes stamps, detects ink pools
- `prepareActiveStrokeData(points, style, penConfig, material, ...)`: For live points (not encoded strokes)

### Key integration
- Uses `OutlineStrategy` registry from Phase 2
- Uses `StampGenerator` registry from Phase 5 (stub with direct calls to existing stamp functions until Phase 5)
- Integrates with `StrokePathCache`: check cache first, store results for lazy Path2D/Float32Array conversion

### Tests
- `StrokeMaterial.test.ts`: `resolveMaterial()` for all 5 pens x 2 pipelines = 10 combinations (~20 tests)
- `MaterialExecutor.test.ts`: Mock backend + resources, verify correct call sequences (~30 tests)
- `StrokeDataPreparer.test.ts`: Data preparation produces correct structure (~15 tests)

### Validation
- TypeScript compilation catches missing pen types in exhaustive switch
- `yarn test` passes, `yarn build` succeeds

---

## Phase 4: Resource Manager + Grain Texture Registry (Additive, Low Risk)

**Goal:** Create `MaterialResources` interface and `MaterialResourceManager` with keyed resource access.

### Create files

**`src/rendering/MaterialResources.ts`** -- Interface + implementation:
```typescript
interface MaterialResources {
  getGrainTexture(textureId: string): TextureRef;
  getStampTexture(managerId: string, color: string, grainValue: number): TextureRef;
  getInkStampTexture(managerId: string, presetId: string, color: string): TextureRef;
  getGrainStrength(textureId: string, penType: PenType, configStrength: number): number;
}
```

`MaterialResourceManager` class:
- `Map<string, GrainTextureGenerator>` for grain textures
- `Map<string, StampTextureManager>` for stamp managers
- Registration: `registerGrainTexture(id, generator)`, `registerStampManager(id, manager)`
- Existing generators registered as: `"pencil-graphite"`, `"pencil-scatter"`, `"ink-shading"`

### Tests
- `MaterialResources.test.ts`: Register/retrieve textures, missing key behavior (~15 tests)

### Validation
- Existing generators accessible through keyed registry
- `yarn test` passes, `yarn build` succeeds

---

## Phase 5: Stamp Unification (Additive, Low Risk)

**Goal:** Extract shared stamp abstractions and wrap existing stamp renderers as generators.

### Create files

**`src/rendering/stamps/StampTypes.ts`** -- Shared types:
- `StampParams`: `{ x, y, size, opacity }` base
- `StampAccumulator`: base for incremental computation
- `StampGenerator` interface: `computeAllStamps()`, `computeStamps()` (incremental)
- `STAMP_GENERATORS` registry: `Record<string, StampGenerator>`

**`src/rendering/stamps/PencilScatterGenerator.ts`** -- Wraps `computeAllStamps()` / `computeStamps()` from `StampRenderer.ts`

**`src/rendering/stamps/InkShadingGenerator.ts`** -- Wraps `computeAllInkStamps()` / `computeInkStamps()` from `InkStampRenderer.ts`

**`src/rendering/stamps/StampPacking.ts`** -- Unified `packStamps(stamps, minOpacity?)` replacing both `packStampsToFloat32()` and `packInkStampsToFloat32()`

### Tests
- `PencilScatterGenerator.test.ts`: Output matches existing (~10 tests)
- `InkShadingGenerator.test.ts`: Output matches existing (~10 tests)
- Unified packing matches both existing functions (~8 tests)

### Validation
- Byte-identical stamp data compared to current renderers
- `yarn test` passes, `yarn build` succeeds

---

## Phase 6: Replace renderStrokeToContext/Engine (HIGH RISK)

**Goal:** Replace `StrokeRenderCore`'s dual rendering functions with `executeMaterial()` calls. **Golden master tests from Phase 0 are the primary safety net here.**

### Modify files

**`src/canvas/StrokeRenderCore.ts`** -- Major rewrite:

Replace `renderStrokeToContext()` (lines 89-211) and `renderStrokeToEngine()` (lines 482-632) with thin wrappers that:
1. `resolveStyle(stroke, styles)` (unchanged)
2. `getPenConfig(style.pen)` (unchanged)
3. `resolveMaterial(style.pen, pipeline, penConfig, style)`
4. Create backend: `new Canvas2DBackend(ctx)` or `new WebGLBackend(engine)`
5. `prepareStrokeData(stroke, style, penConfig, material, pathCache, lod, ...)`
6. `executeMaterial(backend, material, data, resources)`

**Temporary adapter:** `wrapContextsAsResources(grainCtx, stampCtx): MaterialResources` bridges old context interfaces to new resource interface. Removed in Phase 8.

**Preserved exports:** `resolveStyle()`, `computeScreenBBox()`, old context types (until Phase 8)

### StrokePathCache integration
- `prepareStrokeData()` checks `pathCache.getVertices(key)` first
- On miss, uses outline strategy -> stores via `pathCache.setOutline()` / `pathCache.setItalicSides()`
- Preserves the cache's lazy Path2D/Float32Array dual-format design

### Tests
- **Golden master tests must pass** -- same snapshot output for all ~400-600 test cases
- Existing `Renderer.test.ts`, `WebGLTileEngine.test.ts` must pass unchanged

### Validation -- CRITICAL
- All golden master snapshots match (automated)
- Manual visual regression in Obsidian across all pen types/pipelines/engines
- `yarn build && yarn test && yarn build:copy` -> test in Obsidian

---

## Phase 7: Unified Active Stroke Rendering (MEDIUM RISK)

**Goal:** Replace `Renderer.renderActiveStroke()` with material-based rendering.

### Modify files

**`src/canvas/Renderer.ts`** -- Replace three methods:

1. **`renderActiveStroke()` (lines 680-878):** Resolve material, create `Canvas2DBackend(activeCtx)`, prepare data from live points, `executeMaterial()`. Filter out `inkPooling` effect for active strokes.

2. **`renderPointsToStatic()` (lines 549-632):** Same pattern, renders to `staticCtx`.

3. Remove `applyGrainToStrokeLocal()` (grain now handled by `executeMaterial`).

### Performance preservation
- Current code caches stamp counts between frames via closure variables
- `prepareActiveStrokeData()` accepts previous stamp data, recomputes incrementally
- Material resolution + executor overhead is ~1-2 microseconds (negligible vs 16ms frame budget)
- **60fps with Apple Pencil is the performance bar**

### Tests
- Existing `Renderer.test.ts` must pass unchanged
- Performance benchmark: 500-point strokes across all pen types < 8ms (~10 tests)

### Validation
- Visual parity for active strokes across all pen types
- Sustained 60fps during Apple Pencil input
- `yarn build && yarn test && yarn build:copy` -> test live drawing in Obsidian

---

## Phase 8: Replace Resource Forwarding (MEDIUM RISK)

**Goal:** Replace per-type setters with single `MaterialResources` reference.

### Modify files

**`src/canvas/Renderer.ts`:**
- Replace `initGrain()`, `initStamps()`, `initInkStamps()` with `initResources()` creating one `MaterialResourceManager`
- Replace individual member variables with single `resources: MaterialResourceManager`
- `tiledLayer.setResources(resources)` instead of 7+ forwarding calls

**`src/canvas/tiles/TileRenderer.ts`:**
- Replace 5 setter methods with `setResources(resources: MaterialResources)`
- Remove old context builder methods

**`src/canvas/tiles/WebGLTileEngine.ts`:**
- Replace 5 setters with `setResources(resources: MaterialResources)`

**`TiledStaticLayer` (in `Renderer.ts`):**
- Replace per-type forwarding methods with single `setResources()`

### Worker threads
Workers remain unchanged in this phase (cannot receive class instances). Worker migration is a Phase 9 future item -- workers import pure functions (`resolveMaterial`, `executeMaterial`, `Canvas2DBackend`) and build local `MaterialResources` from their own state.

### Tests
- Existing tile rendering tests must pass unchanged
- Golden master tests must pass unchanged
- Resource manager integration tests (~12 tests)

### Validation
- Tile rendering identical across Canvas2D and WebGL
- WebGL context loss/restore works
- `yarn build && yarn test && yarn build:copy` -> test tile rendering in Obsidian

---

## Phase 9: Cleanup (Low Risk)

**Goal:** Remove dead code after all phases are stable.

### Remove from files

**`StrokeRenderCore.ts`:** Old helpers (`renderInkShadedStroke`, `renderStrokeWithGrain`, engine variants), old context interfaces (`GrainRenderContext`, `StampRenderContext`, `EngineGrainContext`, `EngineStampContext`)

**`StampPacking.ts`:** Old `packStampsToFloat32()`, `packInkStampsToFloat32()` (replaced by unified `packStamps()`)

**`Renderer.ts`:** Dead forwarding methods, old grain/stamp context builders

**`TileRenderer.ts`, `WebGLTileEngine.ts`:** Old individual setter methods

**Future (worker):** Migrate `tileWorker.ts`'s `renderStroke()` (~114 lines) to `executeMaterial()` with local `Canvas2DBackend`. Works because all new code is pure functions importable into the worker bundle.

### Validation
- All tests pass (golden masters + unit tests)
- No unused exports (`tsc --noUnusedLocals` / lint)
- `yarn build && yarn test && yarn build:copy`

---

## New Files Summary

| Phase | File | Purpose |
|-------|------|---------|
| 0 | `src/canvas/__tests__/RecordingEngine.ts` | RenderEngine spy for call recording |
| 0 | `src/canvas/__tests__/RecordingContext2D.ts` | Canvas2D context spy for call recording |
| 0 | `src/canvas/__tests__/stroke-fixtures.ts` | Comprehensive test stroke data factory |
| 0 | `src/canvas/__tests__/golden-master.test.ts` | Snapshot test suite (~400-600 tests) |
| 1 | `src/rendering/DrawingBackend.ts` | Unified backend interface |
| 1 | `src/rendering/Canvas2DBackend.ts` | Canvas2D implementation |
| 1 | `src/rendering/WebGLBackend.ts` | WebGL adapter |
| 2 | `src/stroke/OutlineStrategy.ts` | Strategy interface + registry |
| 2 | `src/stroke/StandardOutlineStrategy.ts` | Wraps perfect-freehand |
| 2 | `src/stroke/ItalicOutlineStrategy.ts` | Wraps ItalicOutlineGenerator |
| 3 | `src/rendering/StrokeMaterial.ts` | Material types + resolver |
| 3 | `src/rendering/MaterialExecutor.ts` | `executeMaterial()` |
| 3 | `src/rendering/StrokeDataPreparer.ts` | Data preparation |
| 4 | `src/rendering/MaterialResources.ts` | Resource manager |
| 5 | `src/rendering/stamps/StampTypes.ts` | Shared stamp types + registry |
| 5 | `src/rendering/stamps/PencilScatterGenerator.ts` | Wraps StampRenderer |
| 5 | `src/rendering/stamps/InkShadingGenerator.ts` | Wraps InkStampRenderer |
| 5 | `src/rendering/stamps/StampPacking.ts` | Unified packing |

## Modified Files Summary

| Phase | File | Risk |
|-------|------|------|
| 2 | `src/stroke/PenConfigs.ts` | Zero -- add `outlineStrategy` field |
| 6 | `src/canvas/StrokeRenderCore.ts` | **HIGH** -- replace rendering functions |
| 7 | `src/canvas/Renderer.ts` | Medium -- replace active stroke dispatch |
| 8 | `src/canvas/Renderer.ts` | Medium -- replace resource forwarding |
| 8 | `src/canvas/tiles/TileRenderer.ts` | Medium -- unified resources |
| 8 | `src/canvas/tiles/WebGLTileEngine.ts` | Medium -- unified resources |
| 9 | Multiple files | Low -- dead code removal |

## Existing Code to Reuse

- `verticesToPath2D()` / `trianglesToPath2D()` from `Canvas2DEngine.ts` -- for `Canvas2DBackend`
- `generateOutline()` from `OutlineGenerator.ts` -- for `StandardOutlineStrategy`
- `generateItalicOutlineSides()` from `ItalicOutlineGenerator.ts` -- for `ItalicOutlineStrategy`
- `isItalicStyle()` / `buildItalicConfig()` from `OutlineGenerator.ts` -- for italic detection
- `computeAllStamps()` / `computeStamps()` from `StampRenderer.ts` -- for `PencilScatterGenerator`
- `computeAllInkStamps()` / `computeInkStamps()` from `InkStampRenderer.ts` -- for `InkShadingGenerator`
- `StrokePathCache` from `OutlineGenerator.ts` -- data preparer integrates with existing cache
- `computeScreenBBox()` from `StrokeRenderCore.ts` -- reused by executor
- `detectInkPools()` / `renderInkPools()` from `InkPooling.ts` -- reused by data preparer and executor
- `resolveColor()` from `ColorPalette.ts` -- reused by data preparer
- `encodePoints()` / `decodePoints()` / `quantizePoints()` from `PointEncoder.ts` -- for test fixture generation

## Verification

Each phase ends with:
1. `yarn build` -- TypeScript compiles without errors
2. `yarn test` -- all existing + new tests pass (including golden masters from Phase 0)
3. `yarn build:copy` -- deploy to local Obsidian vault

Phases 6-8 additionally require:
4. All ~400-600 golden master snapshots match (automated regression detection)
5. Manual visual regression testing in Obsidian across all pen types/pipelines/engines
6. Active stroke performance testing (60fps with Apple Pencil)
7. Tile rendering verification (zoom in/out, pan, cache invalidation)
