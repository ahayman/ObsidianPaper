# Phase 1: Engine Abstraction & Canvas2D Adapter

## Goal

Introduce a `RenderEngine` abstraction layer and a `Canvas2DEngine` implementation that wraps the existing Canvas 2D API. This phase is a **pure refactor** — no visual or behavioral changes. It creates the foundation for Phase 3 (WebGL2Engine) to slot in cleanly.

## Scope Refinement

After reading the full codebase, I'm **narrowing Phase 1** to focus only on the foundational abstractions and type plumbing. We will NOT refactor `StrokeRenderCore`, `TileRenderer`, `Renderer`, or `BackgroundRenderer` in this phase. Those files are deeply coupled to Canvas 2D APIs (`Path2D`, `CanvasPattern`, `DOMMatrix`, `ctx.fill(path)`, etc.), and trying to abstract all of that at once would be too large and too risky.

Instead, Phase 1 establishes:
1. The `RenderEngineType` type and settings integration
2. The `RenderEngine` interface (documented, not yet consumed by rendering code)
3. The `Canvas2DEngine` class implementing the interface
4. An `EngineFactory` to instantiate engines
5. Feature detection for WebGL2 availability

The actual wiring of `RenderEngine` into `StrokeRenderCore` / `TileRenderer` / `Renderer` happens in Phase 2-3 when we have both engines available and can test them against each other.

## Step-by-Step Implementation

### Step 1: Add `RenderEngineType` to types.ts

**File:** `src/types.ts`

Add alongside the existing `RenderPipeline` type:

```typescript
export type RenderEngineType = "canvas2d" | "webgl";
```

---

### Step 2: Add engine setting to PaperSettings

**File:** `src/settings/PaperSettings.ts`

Add to `PaperSettings` interface:
```typescript
defaultRenderEngine: RenderEngineType;
```

Add to `DEFAULT_SETTINGS`:
```typescript
defaultRenderEngine: "canvas2d",
```

**File:** `src/settings/PaperSettingsTab.ts`

Add a "Rendering Engine" dropdown in the rendering section (near the existing "Rendering Pipeline" dropdown). Options:
- "Canvas 2D" → `"canvas2d"`
- "WebGL (GPU)" → `"webgl"`

Grey out/disable the WebGL option if `isWebGL2Available()` returns false, with a "(not supported)" label.

---

### Step 3: Create the RenderEngine interface

**File:** `src/canvas/engine/RenderEngine.ts` (new)

This is the core abstraction. The interface captures what ObsidianPaper actually needs — not a generic Canvas 2D replacement.

```typescript
import type { RenderEngineType } from "../../types";

/** Opaque handle to a GPU/offscreen texture. */
export interface TextureHandle {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  destroy(): void;
}

/** Opaque handle to an offscreen render target (FBO in WebGL, OffscreenCanvas in 2D). */
export interface OffscreenTarget {
  readonly width: number;
  readonly height: number;
}

/** Blend modes used by ObsidianPaper's rendering pipeline. */
export type BlendMode = "source-over" | "destination-in" | "destination-out" | "multiply";

/** Image sources that can be drawn. */
export type ImageSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

/**
 * Abstract rendering engine interface.
 *
 * Both Canvas2DEngine and (future) WebGL2Engine implement this.
 * The interface is designed around ObsidianPaper's specific rendering
 * needs rather than as a generic 2D graphics API.
 *
 * Coordinate system: all positions are in world units unless otherwise noted.
 * The engine maintains a transform stack for world→screen mapping.
 */
export interface RenderEngine {
  readonly type: RenderEngineType;

  // ── Lifecycle ──────────────────────────────────────────────────

  /** Initialize the engine with a canvas element. */
  init(canvas: HTMLCanvasElement | OffscreenCanvas): void;

  /** Resize the rendering surface. */
  resize(width: number, height: number, dpr: number): void;

  /** Release all GPU/canvas resources. */
  destroy(): void;

  // ── Frame Operations ───────────────────────────────────────────

  /** Signal the start of a new frame (WebGL may need to set up state). */
  beginFrame(): void;

  /** Signal the end of a frame (WebGL may flush). */
  endFrame(): void;

  /** Clear the entire canvas to transparent. */
  clear(): void;

  // ── Transform Stack ────────────────────────────────────────────

  /** Save the current transform + state. */
  save(): void;

  /** Restore the previously saved transform + state. */
  restore(): void;

  /** Set the transform matrix directly. */
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;

  /** Apply a translation. */
  translate(x: number, y: number): void;

  /** Apply a scale. */
  scale(sx: number, sy: number): void;

  /** Apply an arbitrary transform multiplication. */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;

  /** Get the current transform as a flat 6-element array [a, b, c, d, e, f]. */
  getTransform(): [number, number, number, number, number, number];

  // ── Drawing Primitives ─────────────────────────────────────────

  /** Fill a rectangle with a solid color. */
  fillRect(x: number, y: number, w: number, h: number, color: string, alpha?: number): void;

  /** Fill a closed polygon path. `vertices` is a flat Float32Array of [x,y] pairs. */
  fillPath(vertices: Float32Array, color: string, alpha?: number): void;

  /**
   * Draw an image (canvas, bitmap, or texture) onto the rendering surface.
   * Parameters mirror Canvas 2D drawImage with source and dest rects.
   */
  drawImage(
    source: ImageSource,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;

  // ── Compositing ────────────────────────────────────────────────

  /** Set the blend mode for subsequent draw operations. */
  setBlendMode(mode: BlendMode): void;

  /** Set the global alpha for subsequent draw operations. */
  setAlpha(alpha: number): void;

  // ── Clipping ───────────────────────────────────────────────────

  /**
   * Clip to a rectangle. Subsequent draws only affect pixels within the rect.
   * Must be paired with restore() to remove the clip.
   */
  clipRect(x: number, y: number, w: number, h: number): void;

  /**
   * Clip to a polygon path. `vertices` is a flat Float32Array of [x,y] pairs.
   * Must be paired with restore() to remove the clip.
   * In Canvas 2D: ctx.clip(). In WebGL: stencil buffer.
   */
  clipPath(vertices: Float32Array): void;

  // ── Offscreen Rendering ────────────────────────────────────────

  /**
   * Get (or create) a reusable offscreen render target of at least the given size.
   * Returns null if offscreen rendering is unavailable.
   */
  getOffscreen(minWidth: number, minHeight: number): OffscreenTarget | null;

  /**
   * Redirect subsequent draw operations to an offscreen target.
   * Call endOffscreen() to return to the main canvas.
   */
  beginOffscreen(target: OffscreenTarget): void;

  /** Stop rendering to the offscreen target and return to the main canvas. */
  endOffscreen(): void;

  /**
   * Draw the contents of an offscreen target onto the current surface.
   * Source rect is [0, 0, sw, sh], dest rect is [dx, dy, dw, dh].
   */
  drawOffscreen(
    target: OffscreenTarget,
    sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;

  /** Clear a region of an offscreen target to transparent. */
  clearOffscreen(target: OffscreenTarget, w: number, h: number): void;

  /**
   * Set the transform on an offscreen target's rendering context.
   * Used to map world coordinates into offscreen pixel coordinates.
   */
  setOffscreenTransform(
    target: OffscreenTarget,
    a: number, b: number, c: number, d: number, e: number, f: number,
  ): void;

  // ── Texture Management ─────────────────────────────────────────

  /**
   * Create a texture handle from pixel data.
   * In Canvas 2D this wraps a canvas; in WebGL it uploads to GPU.
   */
  createTexture(source: ImageData | HTMLCanvasElement | OffscreenCanvas): TextureHandle;

  // ── Stamp Rendering ────────────────────────────────────────────

  /**
   * Draw multiple stamps (textured quads) in a batch.
   * `stamps` is a flat Float32Array of [x, y, size, opacity] tuples.
   *
   * In Canvas 2D: loop with drawImage.
   * In WebGL: single instanced draw call.
   */
  drawStamps(
    stamps: Float32Array,
    texture: TextureHandle | ImageSource,
    color: string,
    alpha: number,
  ): void;

  // ── Grain Pattern ──────────────────────────────────────────────

  /**
   * Apply grain texture to the current clip region via destination-out compositing.
   *
   * In Canvas 2D: createPattern + destination-out fill.
   * In WebGL: single-pass fragment shader.
   */
  applyGrain(
    texture: TextureHandle,
    vertices: Float32Array,
    strength: number,
    anchorX: number,
    anchorY: number,
    patternScale: number,
  ): void;

  // ── Line Drawing (for grids/backgrounds) ───────────────────────

  /**
   * Draw a batch of line segments.
   * `lines` is a flat Float32Array of [x1, y1, x2, y2] tuples.
   */
  drawLines(lines: Float32Array, color: string, lineWidth: number): void;

  /**
   * Draw a batch of filled circles (for dot grid).
   * `circles` is a flat Float32Array of [cx, cy, radius] tuples.
   */
  drawCircles(circles: Float32Array, color: string): void;

  // ── Shadow (for page background) ───────────────────────────────

  /** Set shadow parameters for subsequent fillRect calls. */
  setShadow(offsetX: number, offsetY: number, blur: number, color: string): void;

  /** Clear shadow parameters. */
  clearShadow(): void;
}
```

---

### Step 4: Create Canvas2DEngine implementation

**File:** `src/canvas/engine/Canvas2DEngine.ts` (new)

This wraps the existing Canvas 2D API behind the `RenderEngine` interface. It's a thin adapter — all the actual rendering logic stays in `StrokeRenderCore`, `TileRenderer`, etc. for now.

Key implementation details:

- `fillPath()`: Convert `Float32Array` vertices to `Path2D` using the midpoint-Bézier technique from `outlineToPath2D()`, then `ctx.fill(path)`.
- `drawStamps()`: Loop over stamp tuples, call `ctx.drawImage()` for each (matching existing behavior).
- `clipPath()`: Convert vertices to `Path2D`, call `ctx.clip()`.
- `applyGrain()`: Use existing `createPattern()` + `destination-out` approach.
- `getOffscreen()`: Return a lazily-allocated `OffscreenCanvas` or `HTMLCanvasElement`.
- `beginOffscreen()/endOffscreen()`: Switch context to offscreen canvas.
- `drawLines()`: Use `ctx.beginPath()` + `moveTo/lineTo` + `ctx.stroke()`.
- `drawCircles()`: Use `ctx.arc()` + `ctx.fill()` loop.
- `setShadow()/clearShadow()`: Set `ctx.shadowOffsetX/Y`, `ctx.shadowBlur`, `ctx.shadowColor`.
- Transform stack: Delegate to `ctx.save()/restore()/setTransform()/transform()`.
- `getTransform()`: Use `ctx.getTransform()` and return `[a, b, c, d, e, f]`.

The offscreen target implementation:
```typescript
class Canvas2DOffscreenTarget implements OffscreenTarget {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
}
```

---

### Step 5: Create EngineFactory

**File:** `src/canvas/engine/EngineFactory.ts` (new)

```typescript
import type { RenderEngineType } from "../../types";
import type { RenderEngine } from "./RenderEngine";
import { Canvas2DEngine } from "./Canvas2DEngine";

/** Check if WebGL2 is available on this device. */
export function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    // Verify minimum capabilities
    const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    canvas.remove();
    return maxTexSize >= 2048;
  } catch {
    return false;
  }
}

/** Create a RenderEngine instance for the given type. */
export function createRenderEngine(type: RenderEngineType): RenderEngine {
  switch (type) {
    case "canvas2d":
      return new Canvas2DEngine();
    case "webgl":
      // Phase 3 will add: return new WebGL2Engine();
      // For now, fall back to Canvas2D
      console.warn("WebGL engine not yet implemented, falling back to Canvas 2D");
      return new Canvas2DEngine();
  }
}
```

---

### Step 6: Add barrel export

**File:** `src/canvas/engine/index.ts` (new)

```typescript
export type { RenderEngine, TextureHandle, OffscreenTarget, BlendMode, ImageSource } from "./RenderEngine";
export { Canvas2DEngine } from "./Canvas2DEngine";
export { createRenderEngine, isWebGL2Available } from "./EngineFactory";
```

---

### Step 7: Settings UI for engine selection

**File:** `src/settings/PaperSettingsTab.ts`

Add a dropdown in the rendering section:

```typescript
new Setting(containerEl)
  .setName("Rendering engine")
  .setDesc("Canvas 2D works everywhere. WebGL uses the GPU for better performance on supported devices.")
  .addDropdown(drop => {
    drop.addOption("canvas2d", "Canvas 2D");
    if (isWebGL2Available()) {
      drop.addOption("webgl", "WebGL (GPU)");
    } else {
      drop.addOption("webgl", "WebGL (not supported)");
      // Disable the option
    }
    drop.setValue(this.settings.defaultRenderEngine);
    drop.onChange(async value => {
      this.settings.defaultRenderEngine = value as RenderEngineType;
      await this.saveSettings();
    });
  });
```

Note: Changing the engine won't take effect until the view is reopened (or we add hot-switching in Phase 8). Add a note in the description: "Requires reopening the note."

---

### Step 8: Unit tests

**File:** `src/canvas/engine/Canvas2DEngine.test.ts` (new)

Tests for `Canvas2DEngine`:
- `init()` successfully gets 2D context
- `fillRect()` delegates to `ctx.fillRect()`
- `save()/restore()` stack works
- `setTransform()/getTransform()` round-trips
- `setBlendMode()` maps to correct `globalCompositeOperation`
- `setAlpha()` sets `globalAlpha`
- `clipRect()` calls `ctx.clip()`
- `getOffscreen()` returns a usable target
- `beginOffscreen()/endOffscreen()` switches contexts
- `fillPath()` with simple triangle vertices produces a valid Path2D fill
- `drawLines()` and `drawCircles()` produce correct stroke/fill calls

**File:** `src/canvas/engine/EngineFactory.test.ts` (new)

Tests for factory:
- `createRenderEngine("canvas2d")` returns `Canvas2DEngine`
- `createRenderEngine("webgl")` falls back to `Canvas2DEngine` (for now)
- `isWebGL2Available()` returns boolean (mock WebGL context)

---

## Files Summary

### New files (6):
- `src/canvas/engine/RenderEngine.ts` — Interface + types
- `src/canvas/engine/Canvas2DEngine.ts` — Canvas 2D adapter
- `src/canvas/engine/EngineFactory.ts` — Factory + WebGL2 detection
- `src/canvas/engine/index.ts` — Barrel exports
- `src/canvas/engine/Canvas2DEngine.test.ts` — Engine tests
- `src/canvas/engine/EngineFactory.test.ts` — Factory tests

### Modified files (3):
- `src/types.ts` — Add `RenderEngineType`
- `src/settings/PaperSettings.ts` — Add `defaultRenderEngine` setting + default
- `src/settings/PaperSettingsTab.ts` — Add engine dropdown

### NOT modified (intentionally deferred):
- `src/canvas/StrokeRenderCore.ts` — Phase 2
- `src/canvas/Renderer.ts` — Phase 2-3
- `src/canvas/tiles/TileRenderer.ts` — Phase 6
- `src/canvas/tiles/TileCompositor.ts` — Phase 6
- `src/canvas/BackgroundRenderer.ts` — Phase 7
- `src/stroke/OutlineGenerator.ts` — Phase 2

## Key Design Decisions

1. **`fillPath()` takes `Float32Array` vertices, not `Path2D`**. This is intentional — WebGL can't use `Path2D` objects. The Canvas2D adapter converts vertices to `Path2D` internally. Phase 2 will modify outline generators to output `Float32Array`.

2. **Offscreen targets are opaque**. The `OffscreenTarget` interface hides whether it's an `OffscreenCanvas` (Canvas 2D) or an FBO (WebGL). Callers use `beginOffscreen()/endOffscreen()` to redirect rendering.

3. **Stamps use `Float32Array` tuples**. Both `drawStamps()` and `drawInkShadingStamps()` currently receive arrays of stamp objects. The interface standardizes on `Float32Array` of `[x, y, size, opacity]` tuples for GPU-friendly data.

4. **No immediate wiring**. Phase 1 creates the abstraction but doesn't force existing code to use it. This means we can validate the interface design before committing to a large refactor.

5. **WebGL fallback**. `createRenderEngine("webgl")` returns `Canvas2DEngine` until Phase 3 implements `WebGL2Engine`. This means the setting can exist in the UI without breaking anything.
