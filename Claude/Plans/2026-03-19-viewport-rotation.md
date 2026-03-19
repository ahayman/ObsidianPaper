# Plan: Viewport Rotation

## Summary

Add two-finger rotation gesture to rotate the entire viewport. Rotation is ephemeral (resets on document close), full 360°, with a compass indicator that resets rotation on tap.

## Approach

Viewport-level rotation (Approach 1 from research). Single `rotation` value on Camera. All existing rendering pipelines inherit rotation through the camera transform. No document format changes. No worker changes.

## Pen Behavior with Rotation

- **Fixed (paper) nib**: nibAngle is world-space → naturally rotates with the page. No code changes needed.
- **Scaled (screen) nib**: nibAngle must be counter-rotated by `camera.rotation` to stay screen-fixed. Analogous to dividing width by zoom.
- **Barrel rotation + fixed**: twist (screen-space from pencil hardware) needs `+ camera.rotation` to become page-relative in world space.
- **Barrel rotation + scaled**: twist used as-is (already screen-relative, and we want screen behavior).

## Implementation Steps

### Step 1: Camera — Add Rotation

**File: `src/canvas/Camera.ts`**

1. Add `rotation: number` field (radians, 0 = no rotation, positive = clockwise), initialized to 0
2. Add `screenWidth` and `screenHeight` fields (needed for rotation center). Set via a `setScreenSize(w, h)` method called from PaperView on resize.
3. Update `screenToWorld(sx, sy)`:
   - Inverse-rotate screen point around viewport center before applying zoom+pan
   ```
   cx = screenWidth / 2, cy = screenHeight / 2
   cos = cos(-rotation), sin = sin(-rotation)
   rx = cos*(sx-cx) - sin*(sy-cy) + cx
   ry = sin*(sx-cx) + cos*(sy-cy) + cy
   return { x: rx/zoom + this.x, y: ry/zoom + this.y }
   ```
4. Update `worldToScreen(wx, wy)`:
   - Apply zoom+pan, then rotate around viewport center
   ```
   sx = (wx - this.x) * zoom, sy = (wy - this.y) * zoom
   cx = screenWidth / 2, cy = screenHeight / 2
   cos = cos(rotation), sin = sin(rotation)
   return { x: cos*(sx-cx) - sin*(sy-cy) + cx, y: sin*(sx-cx) + cos*(sy-cy) + cy }
   ```
5. Update `applyToContext(ctx)`:
   - Pre-multiply rotation into the transform matrix:
   ```
   ctx.save()
   ctx.translate(cx, cy)
   ctx.rotate(rotation)
   ctx.translate(-cx, -cy)
   ctx.transform(zoom, 0, 0, zoom, -x*zoom, -y*zoom)
   ```
   - Or compute the combined 3×2 matrix directly for a single `ctx.transform()` call.
6. Update `applyToEngine(engine)`:
   - Same rotation logic for WebGL render engine.
7. Update `getVisibleRect()`:
   - Transform all four screen corners through `screenToWorld()`, return AABB.
   - Same for `getOverscanVisibleRect()`.
8. Update `isVisible()` to use the expanded visible rect.
9. Add `rotateAt(screenX, screenY, newRotation)` method:
   - Like `zoomAt()` — keeps world point under gesture center stationary.
   - Convert gesture center to world before rotation change, adjust pan after.
10. Add `getState()`/`setState()` updates to include rotation (for gestureBaseCamera).
11. Update `clampPan()` — use rotated viewport corners for bounds checking.
12. Add `setRotation(r)` / `getRotation()` accessors.

### Step 2: InputManager — Track Rotation Angle

**File: `src/input/InputManager.ts`**

1. Add `initialPinchAngle: number | null = null` field
2. In pinch start (when `activeTouches.size === 2`):
   ```
   this.initialPinchAngle = Math.atan2(
     touches[1].y - touches[0].y,
     touches[1].x - touches[0].x
   );
   ```
3. In pinch move, compute rotation delta:
   ```
   const currentAngle = Math.atan2(touches[1].y - touches[0].y, touches[1].x - touches[0].x);
   const rotationDelta = currentAngle - this.initialPinchAngle;
   ```
4. Update `onPinchMove` callback signature:
   ```
   onPinchMove: (centerX, centerY, scale, panDx, panDy, rotationDelta: number) => void
   ```
5. Pass `rotationDelta` through in the callback call.
6. Reset `initialPinchAngle = null` on pinch end.
7. Add a rotation activation threshold — don't activate rotation until angle changes by a few degrees (prevents accidental rotation during pure zoom). Could combine with the existing `PINCH_ACTIVATE_THRESHOLD`.

### Step 3: PaperView — Handle Rotation in Gesture Callbacks

**File: `src/view/PaperView.ts`**

1. Add `pinchBaseRotation: number | null = null` (like `pinchBaseZoom`).
2. Update `gestureBaseCamera` to include `rotation`:
   ```
   gestureBaseCamera: { x, y, zoom, rotation } | null
   ```
3. Update `onPinchMove` callback to receive `rotationDelta`:
   ```
   onPinchMove: (centerX, centerY, scale, panDx, panDy, rotationDelta) => {
     if (this.pinchBaseZoom === null) {
       this.pinchBaseZoom = this.camera.zoom;
       this.pinchBaseRotation = this.camera.rotation;
     }
     this.camera.pan(panDx, panDy);
     const newZoom = this.pinchBaseZoom * scale;
     this.camera.zoomAt(centerX, centerY, newZoom);
     const newRotation = this.pinchBaseRotation + rotationDelta;
     this.camera.rotateAt(centerX, centerY, newRotation);
     this.camera.clampPan(this.cssWidth, this.cssHeight);
     if (!this.gestureBaseCamera) { ... }
     this.applyGestureTransform();
   }
   ```
4. Update `onPinchEnd` to reset `pinchBaseRotation = null`.
5. Update `applyGestureTransform()` to include rotation:
   ```
   const scale = cam.zoom / base.zoom;
   const rotation = cam.rotation - base.rotation;
   const tx = ...;
   const ty = ...;
   this.renderer.setGestureTransform(tx, ty, scale, rotation);
   ```
6. Update `gestureBaseCamera` snapshots everywhere to include `rotation`.
7. Add setting check: if rotation is disabled in settings, pass `rotationDelta: 0` to camera.

### Step 4: Renderer — CSS Gesture Transform with Rotation

**File: `src/canvas/Renderer.ts`**

1. Update `setGestureTransform(tx, ty, scale, rotation)` signature.
2. For non-tiled mode CSS transforms:
   ```
   // Compute transform-origin at gesture center (viewport center)
   canvas.style.transformOrigin = `${cx}px ${cy}px`;
   canvas.style.transform = `rotate(${rotation}rad) translate(${tx}px, ${ty}px) scale(${scale})`;
   ```
   Note: transform order matters. Rotation should be relative to the viewport center. Need to test exact order for correct visual result.
3. For tiled mode: pass rotation to the WebGL compositor for tile compositing.
4. Ensure `clearGestureTransform()` resets `transformOrigin` too.

### Step 5: Camera Transform in Static Rendering

This step is largely automatic — `applyToContext()` and `applyToEngine()` (updated in Step 1) are used by the full rendering pipeline. Once those include rotation, all static renders will be correct. Verify:

1. `renderStaticLayer()` — uses `camera.applyToContext()` ✓
2. Background rendering — uses camera transform ✓
3. Active stroke rendering — uses camera transform ✓
4. Prediction rendering — uses camera transform ✓
5. Tile rendering — tiles rendered in world space (no rotation needed), compositing applies rotation ✓

### Step 6: Tile Compositing with Rotation

**Files: `src/canvas/tiles/WebGLTileCompositor.ts` (or Canvas2D fallback)**

1. When compositing tiles to the screen:
   - Tile world positions → screen positions via `camera.worldToScreen()` (already includes rotation from Step 1)
   - Tile scale factor = camera.zoom × tileWorldSize / tilePixelSize
   - Each tile is placed at its rotated screen position
2. For WebGL: update the projection/view matrix to include rotation.
3. For Canvas2D fallback: use `ctx.translate/rotate/scale` around viewport center.

### Step 7: Nib Angle Rotation Compensation

**File: `src/view/PaperView.ts`** (in `onPointerDown`, `onStrokeMove`, `onStrokeEnd`)

Currently, when `strokeScaling === "scaled"`, width is divided by zoom:
```typescript
if (this.currentStrokeScaling === "scaled") {
  style.width = style.width / this.camera.zoom;
}
```

Add rotation compensation in the same block:
```typescript
if (this.currentStrokeScaling === "scaled") {
  style.width = style.width / this.camera.zoom;
  // Counter-rotate nib angle so it stays screen-fixed
  if (style.nibAngle !== undefined) {
    style.nibAngle = style.nibAngle - this.camera.rotation;
  }
}
```

For barrel rotation (twist → effective nib angle), the compensation happens in the outline generators:

**Files: `src/stroke/PenEngine.ts`, `src/stroke/ItalicOutlineGenerator.ts`, `src/stamp/InkStampRenderer.ts`**

These compute `effectiveNibAngle` from twist:
```typescript
const effectiveNibAngle = config.useBarrelRotation && point.twist !== 0
  ? (point.twist * Math.PI) / 180
  : config.nibAngle;
```

This needs to become rotation-aware. Two options:
- **Option A**: Pass `viewportRotation` through the config and apply in each generator.
- **Option B**: Pre-adjust twist values in PaperView before they reach the outline generators.

**Recommend Option B** — adjust twist in PaperView's input handlers, keeping generators rotation-unaware:
```typescript
// In onStrokeMove, before passing to strokeBuilder:
if (this.currentStrokeScaling === "fixed" && this.camera.rotation !== 0) {
  // Fixed: twist (screen-space) → page-relative: add rotation
  point.twist = (point.twist + this.camera.rotation * 180 / Math.PI) % 360;
}
// Scaled: twist stays as-is (screen-relative)
```

Wait — but for **fixed** mode, the static nibAngle is already world-space (no adjustment needed). Only the twist needs adjusting for fixed mode. And for **scaled** mode, the static nibAngle needs counter-rotation, but twist stays as-is.

Summary:
| Mode | Static nibAngle | Barrel twist |
|------|----------------|-------------|
| Fixed | No change (already world-space) | Add `camera.rotation` (screen→world) |
| Scaled | Subtract `camera.rotation` (world→screen) | No change (already screen-space) |

### Step 8: Hover Cursor Nib Angle

**File: `src/view/PaperView.ts`** (onHover callback, ~line 1573)

Apply the same rotation compensation to the hover cursor preview:
```typescript
if (this.currentStrokeScaling === "scaled" && nibAngle !== null) {
  nibAngle = nibAngle - this.camera.rotation;
}
if (this.currentStrokeScaling === "fixed" && this.currentUseBarrelRotation && twist !== 0) {
  nibAngle = (twist + this.camera.rotation * 180 / Math.PI) * Math.PI / 180;
}
```

### Step 9: Angle Snapping

**File: `src/canvas/Camera.ts`** (or new utility)

Snap angles during rotation:
```typescript
const SNAP_ANGLES = [0, Math.PI/2, Math.PI, 3*Math.PI/2, 2*Math.PI];
const SNAP_TOLERANCE = 5 * Math.PI / 180; // 5 degrees

function snapRotation(angle: number): number {
  // Normalize to [0, 2π)
  angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  for (const snap of SNAP_ANGLES) {
    if (Math.abs(angle - snap) < SNAP_TOLERANCE) return snap;
  }
  return angle;
}
```

Apply in `rotateAt()` or in PaperView's pinch handler.

### Step 10: Compass Indicator

**New file: `src/view/CompassIndicator.ts`**

Lightweight HTML element overlaid on the paper view:

```typescript
export class CompassIndicator {
  private container: HTMLElement;
  private needle: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement, private onTap: () => void) {
    // Create DOM: container > needle
    // Position: top-right corner, fixed offset
    // Click handler: onTap callback
  }

  update(rotation: number): void {
    if (rotation === 0 && this.visible) {
      this.hide();
    } else if (rotation !== 0 && !this.visible) {
      this.show();
    }
    // Rotate needle by -rotation to always point "north"
    this.needle.style.transform = `rotate(${-rotation}rad)`;
  }

  private show(): void { /* fade in */ }
  private hide(): void { /* fade out */ }
  destroy(): void { /* cleanup */ }
}
```

**Integration in PaperView:**
1. Create compass in `initCanvas()` or similar.
2. Update compass in `applyGestureTransform()` and after gesture end.
3. `onTap` callback: animate rotation to 0° via spring/ease-out animation.

### Step 11: Reset Animation

When the compass is tapped, smoothly animate rotation back to 0°:

```typescript
private animateRotationReset(): void {
  const startRotation = this.camera.rotation;
  const startTime = performance.now();
  const duration = 300; // ms

  const animate = (now: number) => {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    this.camera.rotation = startRotation * (1 - eased);
    this.requestStaticRender();
    this.compassIndicator?.update(this.camera.rotation);
    if (t < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}
```

### Step 12: Settings

**File: `src/settings/Settings.ts`** (or equivalent)

Add setting:
- `enableRotation: boolean` (default: `true`)

When disabled, `rotationDelta` is ignored in the pinch handler. The compass is never shown.

### Step 13: Overscan Handling

The overscan system assumes an axis-aligned viewport. With rotation, the effective visible area is larger. Two adjustments:

1. In `recalculateOverscan()`: use the expanded (rotated) visible rect from `getVisibleRect()`.
2. `isOverscanSufficient()`: account for rotation when checking coverage. The CSS-rotated overscan canvas may not cover corners. Accept this during gesture (minor clipping at corners), fix on re-render.

### Step 14: Selection Overlay

**File: `src/selection/SelectionOverlay.ts`**

The selection overlay renders bounding boxes and handles in screen space. With rotation:
1. `render()` uses `camera.worldToScreen()` for handle positions — already includes rotation (Step 1).
2. Handles should remain screen-axis-aligned for usability (don't rotate the drag handles).
3. The selection bounding box itself should rotate with the content.

Verify that selection drag operations (move, resize, rotate) still work correctly when viewport is rotated. The `screenToWorld` conversion handles the coordinate mapping.

### Step 15: Trackpad Rotation (Optional / Future)

macOS trackpads emit `gesturechange` events with a `rotation` property. This could be captured alongside the wheel-based pinch/pan. Low priority — defer unless easy to add.

---

## Testing

### Unit Tests
- `Camera.test.ts`: test `screenToWorld`/`worldToScreen` with rotation values (0, π/4, π/2, π, 3π/2)
- `Camera.test.ts`: test `rotateAt()` keeps center point stationary
- `Camera.test.ts`: test `getVisibleRect()` expansion under rotation
- `Camera.test.ts`: test round-trip: `worldToScreen(screenToWorld(x, y)) ≈ (x, y)`
- Snap angle tests

### Integration Tests
- Verify stroke points are correctly inverse-rotated when drawing at non-zero rotation
- Verify nib angle compensation for fixed and scaled modes
- Verify barrel rotation compensation

### Manual Testing (iPad)
- Two-finger rotate gesture feels smooth
- Combined pan+zoom+rotate gesture works simultaneously
- Compass appears/disappears correctly
- Compass tap resets rotation smoothly
- Fountain pen (fixed) nib angle rotates with page
- Fountain pen (scaled) nib angle stays screen-fixed
- Barrel rotation works correctly in both modes
- Strokes drawn at various rotations look correct after reset to 0°
- Eraser works correctly at non-zero rotation
- Lasso selection works correctly at non-zero rotation
- Page icons/overlays render correctly
- No visible artifacts at tile boundaries when rotated
- Performance: rotation doesn't cause frame drops

---

## File Change Summary

| File | Change |
|------|--------|
| `src/canvas/Camera.ts` | Add rotation field, update all coordinate transforms |
| `src/input/InputManager.ts` | Track pinch angle, pass rotationDelta |
| `src/view/PaperView.ts` | Handle rotation in gesture callbacks, nib compensation, compass integration |
| `src/canvas/Renderer.ts` | Rotation in CSS gesture transforms and static rendering |
| `src/canvas/tiles/WebGLTileCompositor.ts` | Rotation in tile compositing |
| `src/view/CompassIndicator.ts` | **New** — compass UI component |
| `src/selection/SelectionOverlay.ts` | Verify rotation-aware rendering |
| `src/settings/Settings.ts` | Add enableRotation setting |
| Tests | New camera rotation tests, nib compensation tests |

## Risks

- **CSS transform order**: getting rotation+translate+scale in the right order for gesture preview is fiddly. Will need iteration.
- **Overscan corner clipping**: minor visual artifact during CSS gesture — acceptable.
- **Selection drag at rotation**: coordinate transforms should handle it, but needs thorough manual testing.
