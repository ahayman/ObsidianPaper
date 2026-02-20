# Overscan Buffer Rendering

**Date:** 2026-02-20
**Status:** Draft

## Context

Phase 2 of the performance optimization applies CSS `transform: translate(tx, ty) scale(s)` to all four canvas layers during pan/zoom gestures, avoiding per-frame re-renders. However, because the canvases are exactly viewport-sized, any CSS transform that moves or shrinks them reveals blank (transparent) areas:

- **Zoom out**: CSS `scale(0.5)` shrinks the canvas to half size, leaving 75% of the viewport empty.
- **Pan**: CSS `translate(-100px, 0)` shifts the canvas left, revealing 100px of blank space on the right.

The fix is to render the background and static canvases larger than the viewport (overscan), so CSS transforms during gestures stay within the pre-rendered area. When the gesture exceeds the overscan margin, a throttled mid-gesture re-render recenters the buffer.

## Design

### Overscan Factor Calculation

**Goals:**
- Pan: 0.5x viewport margin in each direction (user can pan half a screen before hitting the edge)
- Zoom: support zoom-out to ~0.5x of the base zoom before revealing blank area (a `scale(0.5)` CSS transform shrinks the canvas to half, but we need the half-sized canvas to still fill the viewport)
- Memory budget: <100 MB extra on iPad (2x DPR)

**Overscan dimensions:**
- `overscanWidth = cssWidth * 2` (0.5x margin left + 1x viewport + 0.5x margin right)
- `overscanHeight = cssHeight * 2` (0.5x margin top + 1x viewport + 0.5x margin bottom)
- At 2x DPR on iPad (1024x768 CSS): canvas backing = 4096x3072 pixels = ~50 MB per canvas
- Two overscan canvases (background + static) = ~100 MB total
- Active + prediction canvases stay viewport-sized (no overscan) = ~25 MB total
- Grand total: ~125 MB (acceptable for iPad with 4-8 GB RAM)

The overscan factor is a constant `OVERSCAN_FACTOR = 2.0`, meaning each overscan canvas is 2x the CSS viewport in each dimension.

**Zoom coverage analysis:**
- At `scale(0.5)` the overscan canvas appears as `overscanWidth * 0.5` = `cssWidth * 1.0` on screen, which exactly fills the viewport. This means we can zoom out to half the base zoom before revealing edges.
- At `scale(0.67)` the canvas appears as `cssWidth * 1.33`, providing comfortable margin.
- For more extreme zoom-outs (below 0.5x base), the mid-gesture re-render kicks in.

### Canvas Positioning

The overscan canvases are positioned with negative CSS offsets so the viewport sees the center portion:

```
overscanOffsetX = -(overscanWidth - cssWidth) / 2 = -cssWidth * 0.5
overscanOffsetY = -(overscanHeight - cssHeight) / 2 = -cssHeight * 0.5
```

These offsets are applied via CSS `left` and `top` on the background and static canvas elements. The container already has `overflow: hidden`, so the overscan area outside the viewport is clipped.

### Architecture Overview

```
Container (overflow: hidden)
  +------------------------------------------+
  |  viewport (cssWidth x cssHeight)         |
  |                                          |
  |    +--overscan canvas------------------+ |
  |    |  (positioned with negative offset)| |
  |    |  overscanWidth x overscanHeight   | |
  |    |  CSS left/top = negative offset   | |
  |    +-----------------------------------+ |
  |                                          |
  |    +--active canvas--------------------+ |
  |    |  viewport-sized, top:0 left:0     | |
  |    +-----------------------------------+ |
  |                                          |
  |    +--prediction canvas----------------+ |
  |    |  viewport-sized, top:0 left:0     | |
  |    +-----------------------------------+ |
  +------------------------------------------+
```

---

## Step 1: Add overscan state to Renderer

**File:** `src/canvas/Renderer.ts`

Add fields to track overscan dimensions and offset:

```typescript
// Overscan configuration
private static readonly OVERSCAN_FACTOR = 2.0;
private overscanCssWidth = 0;
private overscanCssHeight = 0;
private overscanOffsetX = 0;  // Negative CSS offset (e.g., -512)
private overscanOffsetY = 0;  // Negative CSS offset (e.g., -384)
```

Add public getters so `PaperView` can read the current overscan offsets for transform composition:

```typescript
getOverscanOffset(): { x: number; y: number } {
  return { x: this.overscanOffsetX, y: this.overscanOffsetY };
}

getOverscanCssSize(): { width: number; height: number } {
  return { width: this.overscanCssWidth, height: this.overscanCssHeight };
}
```

---

## Step 2: Modify `resize()` to size overscan canvases

**File:** `src/canvas/Renderer.ts`

The `resize()` method currently sizes all 4 canvases identically. Change it to:

1. Size background and static canvases to the overscan dimensions.
2. Size active and prediction canvases to the viewport dimensions (unchanged).
3. Apply CSS positioning offsets to the overscan canvases.

```typescript
resize(width: number, height: number): void {
  this.cssWidth = width;
  this.cssHeight = height;

  // Compute overscan dimensions
  this.overscanCssWidth = Math.ceil(width * Renderer.OVERSCAN_FACTOR);
  this.overscanCssHeight = Math.ceil(height * Renderer.OVERSCAN_FACTOR);
  this.overscanOffsetX = -Math.round((this.overscanCssWidth - width) / 2);
  this.overscanOffsetY = -Math.round((this.overscanCssHeight - height) / 2);

  // Position overscan canvases with negative offset
  this.backgroundCanvas.style.left = `${this.overscanOffsetX}px`;
  this.backgroundCanvas.style.top = `${this.overscanOffsetY}px`;
  this.staticCanvas.style.left = `${this.overscanOffsetX}px`;
  this.staticCanvas.style.top = `${this.overscanOffsetY}px`;

  // Size overscan canvases (background + static)
  const bgCtx = this.backgroundCanvas.getContext("2d");
  if (bgCtx) {
    resizeHighDPICanvas(this.backgroundCanvas, bgCtx, this.overscanCssWidth, this.overscanCssHeight, this.isMobile);
  }

  this.dpr = setupHighDPICanvas(
    this.staticCanvas,
    this.staticCtx,
    this.overscanCssWidth,
    this.overscanCssHeight,
    this.isMobile
  );

  // Active + prediction stay viewport-sized (no overscan)
  this.activeCanvas.style.left = "0px";
  this.activeCanvas.style.top = "0px";
  resizeHighDPICanvas(this.activeCanvas, this.activeCtx, width, height, this.isMobile);
  resizeHighDPICanvas(this.predictionCanvas, this.predictionCtx, width, height, this.isMobile);

  // Update BackgroundRenderer with overscan size
  this.backgroundRenderer.setSize(this.overscanCssWidth, this.overscanCssHeight, this.dpr);
}
```

Add a pixel-dimension cap to keep memory reasonable on large screens:

```typescript
private static readonly MAX_OVERSCAN_PIXELS = 4096; // Per axis, at DPR resolution

// In resize():
const dpr = getEffectiveDPR(this.isMobile);
const maxCssOverscan = Renderer.MAX_OVERSCAN_PIXELS / dpr;

this.overscanCssWidth = Math.min(
  Math.ceil(width * Renderer.OVERSCAN_FACTOR),
  Math.max(width, maxCssOverscan),
);
this.overscanCssHeight = Math.min(
  Math.ceil(height * Renderer.OVERSCAN_FACTOR),
  Math.max(height, maxCssOverscan),
);
```

---

## Step 3: Update `clearCanvas()` for overscan

**File:** `src/canvas/Renderer.ts`

The current `clearCanvas()` clears using `this.cssWidth` and `this.cssHeight`. Split into two methods:

```typescript
private clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(this.dpr, this.dpr);
  ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
}

private clearOverscanCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(this.dpr, this.dpr);
  ctx.clearRect(0, 0, this.overscanCssWidth, this.overscanCssHeight);
}
```

Update `renderStaticLayer()` to use `clearOverscanCanvas(ctx)` for the static context.

---

## Step 4: Update Camera to support overscan visible rect

**File:** `src/canvas/Camera.ts`

Add a method that computes the visible rect for a canvas that is offset from the viewport origin:

```typescript
/**
 * Get the visible world-space rectangle for an overscan canvas.
 * The overscan canvas covers screen-space from (offsetX, offsetY)
 * to (offsetX + overscanWidth, offsetY + overscanHeight),
 * where offsetX/offsetY are negative.
 */
getOverscanVisibleRect(
  overscanCssWidth: number,
  overscanCssHeight: number,
  overscanOffsetX: number,
  overscanOffsetY: number,
): [number, number, number, number] {
  const topLeft = this.screenToWorld(overscanOffsetX, overscanOffsetY);
  const bottomRight = this.screenToWorld(
    overscanOffsetX + overscanCssWidth,
    overscanOffsetY + overscanCssHeight,
  );
  return [topLeft.x, topLeft.y, bottomRight.x, bottomRight.y];
}
```

---

## Step 5: Update `renderStaticLayer()` for overscan

**File:** `src/canvas/Renderer.ts`

Key changes:
1. Clear the full overscan canvas
2. Apply camera transform with offset compensation
3. Use the overscan visible rect for viewport culling (larger area)

The camera transform for the overscan canvas accounts for the canvas offset. The standard transform maps world coords so that screen (0,0) maps to canvas pixel (0,0). For the overscan canvas, screen (0,0) maps to canvas pixel `(-overscanOffsetX, -overscanOffsetY)`. So the translation terms shift by the offset:

```typescript
// Standard camera on context (after DPR scale):
ctx.transform(zoom, 0, 0, zoom, -camera.x * zoom, -camera.y * zoom);

// With overscan offset (after DPR scale):
ctx.transform(zoom, 0, 0, zoom, -camera.x * zoom - overscanOffsetX, -camera.y * zoom - overscanOffsetY);
```

Replace `this.camera.applyToContext(ctx)` in `renderStaticLayer()` with the offset-aware transform. Use `getOverscanVisibleRect()` for culling.

Similarly update `bakeStroke()` and `renderPointsToStatic()`.

Note: `renderStrokeWithGrain()` uses `this.staticCanvas.width/height` for `computeScreenBBox`. Since the static canvas is now overscan-sized, these values are automatically correct.

---

## Step 6: Update BackgroundRenderer for overscan

**File:** `src/canvas/BackgroundRenderer.ts`

The `render()` method needs to accept overscan offset params:
1. Fill the entire overscan canvas with desk color
2. Apply camera transform with offset compensation
3. Use the overscan visible rect for page culling

Add offset parameters to the `render()` signature:

```typescript
render(
  config: BackgroundConfig,
  pageLayout: PageRect[],
  pages: Page[],
  afterPages?: (ctx: CanvasRenderingContext2D, visibleRect: [...]) => void,
  overscanOffsetX = 0,
  overscanOffsetY = 0,
): void
```

---

## Step 7: Update `setGestureTransform()` for overscan offset composition

**File:** `src/canvas/Renderer.ts`

During gestures, the CSS transform needs to compose correctly with the canvas offset. The overscan canvases have `left/top` CSS offsets. With `transform-origin: 0 0`, scaling around the canvas corner (not the viewport center) requires translation adjustment.

For a canvas at CSS position `(ox, oy)` with `transform: translate(tx_adj, ty_adj) scale(s)`:
- A point at canvas CSS pixel `(cx, cy)` maps to viewport position: `ox + cx * s + tx_adj`
- The viewport center of the overscan canvas is at canvas pixel `(-ox, -oy)`
- We want this point to map to viewport position `(tx, ty)` (the gesture translation)
- Solving: `tx_adj = tx + ox * (s - 1)`, `ty_adj = ty + oy * (s - 1)`

```typescript
setGestureTransform(tx: number, ty: number, scale: number): void {
  // Overscan canvases: adjust translation for canvas offset + scale interaction
  const oxAdj = tx + this.overscanOffsetX * (scale - 1);
  const oyAdj = ty + this.overscanOffsetY * (scale - 1);
  const overscanValue = `translate(${oxAdj}px, ${oyAdj}px) scale(${scale})`;
  this.backgroundCanvas.style.transform = overscanValue;
  this.staticCanvas.style.transform = overscanValue;

  // Active/prediction canvases: no offset adjustment needed
  const viewportValue = `translate(${tx}px, ${ty}px) scale(${scale})`;
  this.activeCanvas.style.transform = viewportValue;
  this.predictionCanvas.style.transform = viewportValue;
}
```

---

## Step 8: Mid-gesture re-render when overscan is exceeded

**File:** `src/view/PaperView.ts`

When the gesture moves far enough that the overscan buffer no longer covers the viewport, trigger a throttled re-render.

### Detection

After each `applyGestureTransform()`, check whether the transformed overscan canvas still fully covers the viewport:

```typescript
private isOverscanSufficient(tx: number, ty: number, scale: number): boolean {
  if (!this.renderer) return true;
  const { x: ox, y: oy } = this.renderer.getOverscanOffset();
  const { width: ow, height: oh } = this.renderer.getOverscanCssSize();

  const txAdj = tx + ox * (scale - 1);
  const tyAdj = ty + oy * (scale - 1);

  const leftEdge = ox + txAdj;
  const rightEdge = ox + txAdj + ow * scale;
  const topEdge = oy + tyAdj;
  const bottomEdge = oy + tyAdj + oh * scale;

  // Allow a small tolerance (2px) to avoid jitter
  return leftEdge <= 2 && rightEdge >= this.cssWidth - 2
      && topEdge <= 2 && bottomEdge >= this.cssHeight - 2;
}
```

### Throttled mid-gesture re-render

New state fields:

```typescript
private midGestureRenderPending = false;
private lastMidGestureRenderTime = 0;
private static readonly MID_GESTURE_THROTTLE_MS = 250;
```

Update `applyGestureTransform()`:

```typescript
private applyGestureTransform(): void {
  if (!this.gestureBaseCamera || !this.renderer) return;
  const base = this.gestureBaseCamera;
  const cam = this.camera;
  const scale = cam.zoom / base.zoom;
  const tx = (base.x - cam.x) * cam.zoom;
  const ty = (base.y - cam.y) * cam.zoom;
  this.renderer.setGestureTransform(tx, ty, scale);

  // Check if overscan buffer still covers viewport
  if (!this.isOverscanSufficient(tx, ty, scale)) {
    this.requestMidGestureRender();
  }
}
```

The mid-gesture render:

```typescript
private requestMidGestureRender(): void {
  if (this.midGestureRenderPending) return;

  const now = performance.now();
  const elapsed = now - this.lastMidGestureRenderTime;

  if (elapsed < PaperView.MID_GESTURE_THROTTLE_MS) {
    this.midGestureRenderPending = true;
    setTimeout(() => {
      this.midGestureRenderPending = false;
      this.executeMidGestureRender();
    }, PaperView.MID_GESTURE_THROTTLE_MS - elapsed);
  } else {
    this.executeMidGestureRender();
  }
}

private executeMidGestureRender(): void {
  if (!this.renderer) return;

  this.lastMidGestureRenderTime = performance.now();

  // Reset gesture base to current camera position
  this.gestureBaseCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };

  // Clear CSS transform (base = current, so delta is zero)
  this.renderer.clearGestureTransform();

  // Re-render centered on new viewport (synchronous)
  this.renderStaticWithIcons();
}
```

### Edge cases

- **Re-render while pending**: The `midGestureRenderPending` flag ensures only one is scheduled at a time.
- **Very fast scrolling**: The 250ms throttle limits re-renders to ~4/sec. Between re-renders, the user sees desk color at edges (not jarring).
- **Gesture ends while pending**: Clear `midGestureRenderPending` in `onPanEnd`/`onPinchEnd`. Normal end-of-gesture render handles the final state.

---

## Step 9: Update gesture end handlers

**File:** `src/view/PaperView.ts`

Add to `onPanEnd` and `onPinchEnd`:

```typescript
this.midGestureRenderPending = false;
```

The existing `clearGestureTransform()` → `requestStaticRender()` flow handles the final state.

---

## Step 10: CSS changes

**File:** `styles.css`

Add `will-change: transform` to overscan canvas classes for GPU acceleration:

```css
.paper-background-canvas,
.paper-static-canvas {
  will-change: transform;
}
```

No other CSS changes needed — inline styles from `resize()` override `left`/`top`.

---

## Memory Analysis

| Device | CSS viewport | DPR | Overscan canvas (px) | Per canvas MB | Total (4 canvases) |
|--------|-------------|-----|---------------------|--------------|-------------------|
| iPad Air | 820 x 1180 | 2 | 3280 x 4720 | 62 | ~149 MB |
| iPad Pro 11" | 834 x 1194 | 2 | 3336 x 4776 | 64 | ~152 MB |
| iPad Pro 12.9" | 1024 x 1366 | 2 | 4096 x 4096* | 67 | ~159 MB |

*Capped to 4096px per axis at DPR resolution.

---

## Files Changed

| File | Changes |
|------|---------|
| `src/canvas/Renderer.ts` | Add overscan fields, update resize/clear/render/bake/gesture methods |
| `src/canvas/Camera.ts` | Add `getOverscanVisibleRect()` method |
| `src/canvas/BackgroundRenderer.ts` | Accept overscan offset params, use wider visible rect |
| `src/view/PaperView.ts` | Add mid-gesture re-render detection and throttling |
| `styles.css` | Add `will-change: transform` to overscan canvas classes |
| `src/canvas/Renderer.test.ts` | Add overscan transform math tests |
| `src/canvas/Camera.test.ts` | Add `getOverscanVisibleRect` tests |

---

## Implementation Order

1. Add overscan state and resize logic (Renderer.ts) — Steps 1-2
2. Update clearCanvas for overscan (Renderer.ts) — Step 3
3. Add overscan visible rect to Camera (Camera.ts) — Step 4
4. Update renderStaticLayer and BackgroundRenderer for overscan offset — Steps 5-6
5. Fix gesture transform composition (Renderer.ts) — Step 7
6. Add mid-gesture re-render detection (PaperView.ts) — Step 8
7. Update bakeStroke and renderPointsToStatic (Renderer.ts) — Step 5 callouts
8. CSS changes (styles.css) — Step 10
9. Tests — Step 4, Step 7 math
10. Memory cap tuning — Step 2 cap

## Verification

1. `yarn build` — compiles without errors
2. `yarn test` — all tests pass
3. Manual: zoom out during pinch — no blank edges until extreme zoom
4. Manual: pan in all directions — no blank edges during normal scroll
5. Manual: very fast long scroll — mid-gesture re-render fills in after brief delay
6. Manual: draw strokes immediately after pan/zoom — strokes land at correct positions
7. Manual: background patterns render correctly in overscan area
8. Manual: eraser works correctly after pan/zoom
9. Manual: resize window during/after gesture — overscan recalculates correctly
