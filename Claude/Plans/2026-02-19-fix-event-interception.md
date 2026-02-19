# Plan: Fix Pointer Event Interception via Document-Level Capture

## Context

After 5 rounds of changes (deferred baking, deferred finalization, compression cache, diagnostic strip-down, removing setPointerCapture + adding touch-action), rapid Apple Pencil strokes are still missed. Even with ~0ms processing in callbacks, strokes are dropped during fast writing.

This definitively proves the issue is NOT in our processing pipeline. Events are being intercepted before they reach our container element.

## Root Cause Hypothesis

Obsidian's framework likely has event listeners on ancestor elements (capture phase or early bubble phase) that interfere with rapid pen pointer events. This could be gesture recognition, navigation handling, or focus management that occasionally `stopPropagation()`s or consumes pen events.

## Approach: Document-Level Capture Listeners

The Pointer Events specification defines event dispatch in two phases:
1. **Capture phase**: document → ... → target (top-down)
2. **Bubble phase**: target → ... → document (bottom-up)

A `document`-level capture listener fires FIRST — before ANY other handler. By intercepting pen events at this level, we bypass all potential interference from Obsidian's DOM.

## Changes

### 1. `src/input/InputManager.ts` — Document-level pen event capture

Add document-level capture-phase listeners specifically for pen events:

```typescript
// In attach():
document.addEventListener("pointerdown", this.boundDocPointerDown, true);  // capture
document.addEventListener("pointermove", this.boundDocPointerMove, true);
document.addEventListener("pointerup", this.boundDocPointerUp, true);
document.addEventListener("pointercancel", this.boundDocPointerCancel, true);
```

In these handlers:
- Check `e.pointerType === "pen"` — only intercept pen events
- Check that event target is within `this.el` (our container)
- Call `e.stopPropagation()` to prevent Obsidian's handlers from consuming it
- Dispatch to existing handler logic

Keep existing container-level listeners for mouse and touch events (these work fine).

### 2. Visual diagnostic overlay

Add a temporary on-screen counter showing:
- Number of pen `pointerdown` events received at document level
- Number of pen `pointerdown` events that reached our handler
- Whether any `pointercancel` events were fired

This provides immediate visual feedback without requiring the developer console.

### 3. Clean up in `destroy()`

Remove all document-level listeners on destroy.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Pen event outside our container | Check target element — ignore if not within container |
| Multiple PaperView instances | Each instance checks its own container |
| Touch events | Not affected — still use container-level listeners |
| Mouse events | Not affected — still use container-level listeners |

## Verification

1. `yarn test` — all tests pass
2. `yarn lint` — clean
3. `yarn build` — builds successfully
4. On iPad: rapid "the quick brown fox" should register all strokes
5. Diagnostic overlay confirms all events are captured
