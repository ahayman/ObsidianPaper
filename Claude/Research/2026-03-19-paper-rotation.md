# Paper Rotation Research

## Overview

This document explores adding a two-finger rotation gesture to ObsidianPaper, allowing users to rotate the canvas/page for more comfortable writing angles. This is a significant differentiator — **no major note-taking app** (GoodNotes, Notability, Noteshelf) supports canvas rotation, despite it being one of the most requested features on their feedback forums. Drawing apps (Procreate, Photoshop, Clip Studio Paint) all support it.

---

## What Other Apps Do

### Drawing Apps (All Support Rotation)

| App | Gesture | Indicator | Snap | Reset |
|-----|---------|-----------|------|-------|
| **Procreate** | Two-finger twist (combined with pinch/pan) | Numeric angle readout during gesture | Snaps to 0° with haptic | Quick-pinch resets all |
| **Photoshop** | Two-finger twist | Red compass needle, center-screen | 0°, 90°, 180°, 270° | Double-tap with two fingers |
| **Clip Studio Paint** | Two-finger twist | Rotation widget on toolbar | 5° increments optional | Reset button |
| **Concepts** | Two-finger twist | Persistent angle in status bar (tap to edit) | Configurable | Tap angle display |

**Common patterns:**
- Rotation is always a **two-finger touch** gesture, never interferes with Apple Pencil
- Combined with pinch-to-zoom and pan in a single gesture (all three simultaneously)
- Rotation is **purely a view transform** — stored content is never rotated
- Toggle in settings to disable rotation (some users find it annoying during pan/zoom)

### Note-Taking Apps (None Support Rotation)

- **GoodNotes**: Most-requested feature on their forum, especially by left-handed users
- **Notability**: No rotation support
- **Noteshelf**: No rotation support

This is a clear **differentiation opportunity** for ObsidianPaper.

---

## Three Approaches Considered

### Approach 1: Rotate Entire Canvas (Viewport Rotation)

Rotate the entire viewport around its center. All pages rotate together, maintaining their spatial relationship. Adjacent pages move radially around the rotation center.

**How it works:**
- Add `rotation: number` (radians) to the Camera
- All coordinate transforms (screen↔world) include rotation matrix
- CSS gesture transforms include `rotate()` during gesture
- Tiles, strokes, and pages are rendered normally — rotation is applied at the camera level

**Pros:**
- Simplest to implement — single rotation value on the Camera
- Matches how Procreate/Photoshop work (viewport-level rotation)
- No per-page state to manage
- Tile cache remains valid (rotation is a compositing transform, not a content transform)
- Natural for "angling the desk" metaphor

**Cons:**
- Adjacent pages rotate too — the gap between vertically-stacked pages becomes a diagonal gap
- At large angles (e.g., 45°), pages look oddly arranged
- "Desk" feels tilted rather than "paper" feeling tilted

**Impact on current code:**
- `Camera`: Add `rotation` field, update `screenToWorld`/`worldToScreen` with rotation matrix, update `applyToContext`/`applyToEngine` transforms
- `InputManager`: Track rotation angle between two touch points during pinch gesture
- `Renderer.setGestureTransform()`: Add rotation to CSS transform string
- `Renderer.renderStaticLayer()`: Camera transform handles rotation automatically
- Tile compositing: Rotate tile positions when compositing to screen
- `getVisibleRect()`: Compute axis-aligned bounding box of rotated viewport (larger than unrotated)

### Approach 2: Rotate Individual Pages

Each page has its own rotation angle. Two-finger twist rotates only the page under the gesture center. Different pages can have different rotations.

**How it works:**
- Add `rotation: number` to the `Page` type
- Each page is rendered with its own rotation transform around its center
- Strokes on a rotated page are stored in the page's local (unrotated) coordinate space
- Input coordinates are inverse-rotated before being stored as stroke points

**Pros:**
- Most flexible — users can angle different pages differently
- Page labels, graph axes, etc. can each be at optimal angle
- Pages that aren't being written on stay clean/aligned

**Cons:**
- Significantly more complex implementation
- Per-page rotation means the page layout system needs to handle rotated bounding boxes
- Tile rendering needs per-page rotation awareness
- Background patterns (lines, grid) rotate with the page, which may look odd at small angles
- Overlapping rotated pages create visual complexity
- Persisting rotation per page adds document format complexity
- Workers need rotation state per page

**Impact on current code:**
- `Page` type: Add `rotation` field
- `PageLayout`: Compute rotated bounding boxes for overlap/gap calculations
- `BackgroundRenderer`: Rotate pattern rendering per page
- `TileRenderer`: Apply per-page rotation when rendering strokes
- `SpatialIndex`: Queries need rotation-aware bounding boxes
- `InputManager`: Determine which page is under gesture, apply rotation only to that page
- Document format: New field, migration needed
- Workers: Must receive and apply per-page rotation

### Approach 3: Rotate All Pages Uniformly (Positions Static)

All pages rotate by the same angle, but each page rotates **around its own center**. Pages stay in their vertical/horizontal positions — only the page content rotates in place.

**How it works:**
- Single global `rotation` value (like Approach 1)
- But instead of rotating the viewport, each page is rotated around its own center
- Page centers remain at their computed layout positions

**Pros:**
- Pages stay neatly aligned (vertical stack remains vertical)
- Simpler than per-page rotation (single rotation value)
- Natural "rotating paper on a fixed desk" metaphor
- Background grid/lines rotate with pages (useful for angled writing)

**Cons:**
- More complex rendering than viewport rotation — each page needs its own transform
- At large angles, rotated pages may overlap (especially similar-sized pages stacked closely)
- Tiles need per-page rotation (same as Approach 2)
- The "gap" between pages doesn't rotate, which may look odd
- Workers need rotation awareness
- Input inverse-rotation needed per page

**Impact on current code:** Similar to Approach 2 but slightly simpler since there's only one rotation value.

---

## Recommended Approach: Viewport Rotation (Approach 1)

### Why

1. **Simplest implementation** — rotation lives in a single place (Camera), and all existing rendering pipelines get it for free via the camera transform
2. **Proven UX** — this is exactly how Procreate, Photoshop, and every professional drawing app works
3. **No document format changes** — rotation is ephemeral view state, not persisted per-page
4. **No tile cache invalidation** — rotation is a compositing transform applied after tiles are rendered
5. **No worker changes** — workers render tiles in world space; rotation happens at compositing time
6. **Natural gesture** — two-finger twist around the pinch center, combined with simultaneous zoom and pan

The "adjacent pages rotate too" downside is minor in practice — this is how every drawing app works and users are accustomed to it. The "rotating paper on a desk" metaphor works well when the entire desk surface rotates.

---

## Technical Implementation Details (Approach 1)

### Camera Changes

```typescript
// Camera adds:
rotation: number;  // radians, 0 = normal, positive = clockwise

screenToWorld(sx: number, sy: number): { x: number; y: number } {
  // 1. Translate to viewport center
  // 2. Inverse-rotate
  // 3. Translate back
  // 4. Apply zoom + pan (existing)
  const cx = screenWidth / 2;
  const cy = screenHeight / 2;
  const cos = Math.cos(-this.rotation);
  const sin = Math.sin(-this.rotation);
  const rx = cos * (sx - cx) - sin * (sy - cy) + cx;
  const ry = sin * (sx - cx) + cos * (sy - cy) + cy;
  return { x: rx / this.zoom + this.x, y: ry / this.zoom + this.y };
}

applyToContext(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  // Translate to rotation center, rotate, translate back, then apply zoom+pan
  const cx = screenWidth / 2;
  const cy = screenHeight / 2;
  ctx.translate(cx, cy);
  ctx.rotate(this.rotation);
  ctx.translate(-cx, -cy);
  ctx.transform(this.zoom, 0, 0, this.zoom, -this.x * this.zoom, -this.y * this.zoom);
}
```

The camera transform becomes: **translate to center → rotate → translate back → scale + pan**. This is a single `ctx.transform()` call when pre-multiplied into one matrix.

### Gesture Detection Changes

Currently, `InputManager` tracks two-finger pinch using distance only. Rotation requires also tracking the **angle** between the two touch points:

```typescript
// Add to pinch tracking:
private initialPinchAngle: number | null = null;

// In pinch start:
this.initialPinchAngle = Math.atan2(
  touch2.y - touch1.y,
  touch2.x - touch1.x
);

// In pinch move:
const currentAngle = Math.atan2(touch2.y - touch1.y, touch2.x - touch1.x);
const rotationDelta = currentAngle - this.initialPinchAngle;

// Callback becomes:
onPinchMove(centerX, centerY, scale, panDx, panDy, rotationDelta)
```

The rotation delta is passed alongside the existing scale and pan deltas, making it a natural extension of the existing gesture.

### CSS Gesture Transform

During the gesture, before the full re-render:

```typescript
// Current:
canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;

// With rotation:
canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${angle}rad)`;
```

The transform origin needs to be the gesture center point for correct visual feedback.

### Visible Rect Expansion

When the viewport is rotated, the axis-aligned bounding box of visible world space is **larger** than the unrotated viewport:

```typescript
getVisibleRect(screenWidth, screenHeight): [number, number, number, number] {
  // Transform all four corners of the screen through inverse rotation
  const corners = [
    this.screenToWorld(0, 0),
    this.screenToWorld(screenWidth, 0),
    this.screenToWorld(screenWidth, screenHeight),
    this.screenToWorld(0, screenHeight),
  ];
  return [
    Math.min(...corners.map(c => c.x)),
    Math.min(...corners.map(c => c.y)),
    Math.max(...corners.map(c => c.x)),
    Math.max(...corners.map(c => c.y)),
  ];
}
```

This means slightly more tiles are visible at any rotation != 0°, but the overhead is small.

### WebGL Tile Compositing

The WebGL tile compositor already positions tiles in screen space. With rotation, tile screen positions need the rotation transform:

```typescript
// When compositing tile at world position (wx, wy):
// Apply: translate to center → rotate → translate back → zoom+pan
// This is handled by the camera's projection matrix
```

If using a projection matrix in the compositor shader, rotation is a single matrix multiplication. If positioning tiles via CSS/Canvas2D compositing, apply the same rotation transform.

### Input Coordinate Transformation

When the user draws with Apple Pencil while the canvas is rotated, the pointer event coordinates (screen space) must be inverse-rotated before converting to world space. This is already handled by the updated `screenToWorld()` — no additional changes needed in the stroke recording pipeline.

### Pan Clamping

`clampPan()` needs to account for the rotated viewport. The visible world rect is larger when rotated, so the clamping bounds should use the expanded rect.

---

## Compass / Rotation Indicator

### Design

Show a small compass indicator when rotation != 0°:

- **Position**: Top-right corner of the canvas (or configurable)
- **Appearance**: Small circular indicator with a needle/arrow pointing to the original "up" direction
- **Behavior**:
  - Hidden when rotation = 0°
  - Fades in when rotation changes
  - Shows numeric angle (optional, toggle in settings)
  - **Tap to reset**: Tapping the compass animates rotation back to 0°
- **Animation**: Smooth spring animation when resetting (CSS transition or requestAnimationFrame)

### Implementation

The compass can be a lightweight HTML element (not a canvas) overlaid on the paper view:

```html
<div class="paper-compass" style="transform: rotate(${-rotation}rad)">
  <div class="paper-compass-needle"></div>
  <div class="paper-compass-angle">15°</div>
</div>
```

The needle always points to true north (original up), so it rotates by the **negative** of the canvas rotation. Tapping it triggers an animated reset.

### Alternative: Tap Canvas to Reset

Per the original idea, tapping the canvas itself (not the compass) resets rotation. This could conflict with other tap actions. Options:
- **Tap the compass** to reset (clearest, no conflicts)
- **Two-finger tap** to reset (but this is currently undo)
- **Double-tap with one finger** on empty area to reset
- **Long-press compass** for more options (snap to 0°, 90°, etc.)

**Recommendation**: Tap the compass indicator to reset. It's the most discoverable and conflict-free option.

---

## Snap Angles

During rotation, provide haptic/visual snap at common angles:

- **0°** (default): Strong snap with haptic feedback
- **90°, 180°, 270°**: Medium snap
- **45° increments**: Light snap (optional, toggle in settings)

Snap tolerance: ~5° (same as selection rotation snap). When within tolerance, lock to the snap angle. Continue rotating past the snap zone to break free.

---

## Settings & Toggles

- **Enable rotation** (default: on): Toggle in settings. When off, two-finger gesture is pinch/pan only (current behavior)
- **Show compass** (default: on): Toggle compass indicator visibility
- **Snap angles** (default: on): Toggle angle snapping
- **Show angle readout** (default: off): Show numeric degrees on compass

---

## Persistence

Rotation is **ephemeral view state** — it resets to 0° when the document is closed and reopened. This matches Procreate's behavior and avoids document format changes. If users later request persistent rotation, it can be added to `CameraState` and persisted alongside zoom/pan.

---

## Edge Cases & Considerations

### Left-Handed Users
This feature is especially valuable for left-handed users who naturally angle paper 20-30° clockwise. The compass provides visual feedback on current angle.

### Palm Rejection
No changes needed — pen input is already separated from touch input. Rotation is a touch-only gesture.

### Performance
- Rotation during gesture: CSS transform only (zero rendering cost)
- After gesture ends: single re-render at new rotation (same as current pinch-end behavior)
- Tile compositing: minimal overhead (rotation matrix multiplication)
- No tile cache invalidation needed

### Overscan
The overscan canvas covers a screen-aligned rectangle. When rotated, the corners of the visible world extend beyond the overscan bounds. Two options:
1. **Increase overscan** to cover rotated corners (more memory, simpler)
2. **Accept corner clipping** during gesture, fill on re-render (less memory, minor visual artifact during gesture)

Recommendation: Accept minor corner clipping during CSS gesture transform. The full re-render after gesture end will render the correct rotated view.

### Tiled Mode Compositing
In tiled mode, the WebGL compositor already handles tile positioning. Adding rotation to the compositing projection matrix is straightforward. During the gesture, re-composite with the rotated camera (same as current pinch gesture handling).

### Selection Overlay
The selection overlay needs to respect canvas rotation. Selection handles should remain screen-aligned (not rotated with content) for usability. The selection bounding box rendering needs the rotation transform.

---

## Effort Estimate by Approach

| Approach | Complexity | Files Changed | Risk |
|----------|-----------|---------------|------|
| 1. Viewport rotation | Low-Medium | ~6-8 files | Low |
| 2. Per-page rotation | High | ~15+ files | Medium-High |
| 3. Uniform page rotation | Medium-High | ~12+ files | Medium |

### Approach 1 File Changes
1. `Camera.ts` — Add rotation, update transforms
2. `InputManager.ts` — Track rotation angle in pinch gesture
3. `PaperView.ts` — Pass rotation to camera, gesture callbacks
4. `Renderer.ts` — Rotation in CSS gesture transform and render pipeline
5. `WebGLTileCompositor.ts` — Rotation in compositing projection (if applicable)
6. New: `CompassIndicator.ts` — Compass UI component
7. Settings — Add rotation toggle
8. Types — Add rotation to CameraState (if persisting)

---

## Open Questions

1. **Persist rotation?** Current recommendation is ephemeral. Should we persist per-document?
2. **Rotation + horizontal layout?** When pages are horizontal, rotation may feel different. Test needed.
3. **Maximum rotation?** Allow full 360° or limit to ±90°? Drawing apps allow full 360°.
4. **Trackpad rotation?** macOS trackpad supports rotation gesture — should we support it via wheel events?
5. **Animation easing?** What easing curve for snap-to-0° animation? Spring? Ease-out?
