# Plan: Fix Pointer Event Delivery for Rapid Apple Pencil Strokes

## Root Cause Analysis

The diagnostic strip-down proved that even with ~0ms processing in callbacks, the second stroke of a rapid "t" shape is missed. This means the issue is **not** in our processing pipeline — it's at the pointer event delivery level.

Three issues identified in `InputManager.ts` and `styles.css`:

### 1. `setPointerCapture()` conflicts with implicit pointer capture (Primary suspect)

Per the W3C Pointer Events spec, direct manipulation devices (pen digitizers, touchscreens) have **implicit pointer capture**: after `pointerdown`, all subsequent events for that pointer are automatically targeted to the `pointerdown` element until `pointerup`.

Our code also calls `this.el.setPointerCapture(e.pointerId)` explicitly on every `pointerdown`. On iPad Safari, this redundant explicit capture can interfere with the browser's pointer lifecycle:
- On `pointerup`, both explicit and implicit capture are released
- The browser may need extra time to reset the pointer state
- If the pen touches again during this reset, the `pointerdown` can be dropped

This is a **known issue** with `setPointerCapture` and rapid pen interactions on WebKit.

### 2. Missing `touch-action: none` on the container

`touch-action: none` is set on `.paper-canvas` elements but NOT on `.paper-view-container` — the element that InputManager listens on. While pointer events target the canvas and bubble to the container, after `setPointerCapture` releases, the browser re-evaluates the target using the container's properties.

### 3. No guard against overlapping pointer states

If `pointerup` from stroke 1 is delayed/dropped and `pointerdown` for stroke 2 arrives, the code silently overwrites `drawPointerId` without ending the previous stroke. The orphaned first stroke never gets `onStrokeEnd`.

## Changes

### 1. `src/input/InputManager.ts` — Remove `setPointerCapture`

Delete the `setPointerCapture` call entirely:

```typescript
// REMOVE:
try {
  this.el.setPointerCapture(e.pointerId);
} catch {
  // setPointerCapture can fail in some edge cases
}
```

Implicit pointer capture already handles pen events. For mouse events (which don't have implicit capture), the drawing canvas fills the entire view so the pointer won't leave the element.

### 2. `src/input/InputManager.ts` — Guard against overlapping draw pointers

At the top of `handlePointerDown`, if a draw is already active, end it first:

```typescript
if (action === "draw") {
  // If a previous draw is still active (missed pointerup), end it
  if (this.drawPointerId !== null) {
    this.callbacks.onStrokeCancel();
    this.drawPointerId = null;
    this.penActive = false;
  }

  this.drawPointerId = e.pointerId;
  // ...
}
```

### 3. `styles.css` — Add `touch-action: none` to container

```css
.paper-view-container {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  touch-action: none;
}
```

### 4. `src/input/InputManager.ts` — Add temporary event logging

Add console logging at the top of each handler to diagnose if events are still being missed after the above fixes. Will be removed once the issue is confirmed fixed.

```typescript
private handlePointerDown(e: PointerEvent): void {
  console.log(`[PTR] down id=${e.pointerId} type=${e.pointerType} drawId=${this.drawPointerId}`);
  // ...
}

private handlePointerUp(e: PointerEvent): void {
  console.log(`[PTR] up id=${e.pointerId} type=${e.pointerType} drawId=${this.drawPointerId}`);
  // ...
}

private handlePointerCancel(e: PointerEvent): void {
  console.log(`[PTR] cancel id=${e.pointerId} type=${e.pointerType} drawId=${this.drawPointerId}`);
  // ...
}
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Pen stroke leaves canvas area | Implicit capture keeps events targeted to the canvas. Mouse strokes might lose events at edges, but drawing fills the view. |
| Rapid pen up/down | Without explicit capture, each pointerdown gets its own implicit capture. No interference between strokes. |
| Missed pointerup | Guard in handlePointerDown cancels the orphaned stroke and starts the new one. |
| Touch panning while pen draws | Touch events are classified as "pan" and ignored when `penActive` is true. No change. |

## Verification

1. `yarn test` — all tests pass
2. `yarn lint` — clean
3. `yarn build` — builds successfully
4. On iPad: rapid "t" shape should register both strokes. Console logs confirm events fire correctly.
5. After confirming fix, remove diagnostic logging.
