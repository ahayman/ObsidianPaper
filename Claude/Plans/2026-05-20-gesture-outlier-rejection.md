# Reject Palm-Induced Gesture Outliers (Rotation / Zoom / Pan)

**Date:** 2026-05-20

## Problem

When the user begins writing, the canvas occasionally snaps to a new rotation —
sometimes 90° or 180°. The trigger is palm contact arriving before the pen, which
seeds the pinch baseline with a finger arrangement that no longer reflects the
user's intent by the time the gesture activates (or by the time the touch set
changes mid-gesture). Once activated, the rotation/scale deltas are computed
against that stale baseline and the camera leaps.

Two real-world scenarios produce the jump:

1. **Stale activation baseline.** A palm contact + a secondary palm/finger
   contact arrive in sequence. `initialPinchAngle` and `initialPinchDistance`
   are captured the instant the second touch lands (`InputManager.ts:297-311`).
   The contacts then drift while the pinch is still below the 8 px activation
   threshold. When activation eventually fires, the cumulative delta from that
   stale initial state is applied in one frame.
2. **Touch-set change mid-pinch.** The pinch math always uses `touches[0]` and
   `touches[1]` (`InputManager.ts:354-394`), but the baseline is set only when
   `activeTouches.size === 2` in `handlePointerDown`. If the touch count goes
   2→3→2 and one of the original two touches is the one that lifted, the
   surviving pair now has different identities than the pair the baseline was
   captured against — so `currentAngle - initialPinchAngle` is comparing
   different physical fingers and can be huge.

Today there is no clamp, no smoothing, and no outlier check on the pinch path
(`rotationDelta`, `scale`, `panDx/panDy` flow raw from finger positions into
`Camera.rotateAt` / `zoomAt` / `pan`). The `palmRejection` setting on
`DeviceSettings` exists but is unused — palm rejection is hardcoded to "ignore
touch while pen is drawing", which doesn't help when the palm registers *before*
the pen lands.

## Goal

Prevent large, sudden jumps in rotation/zoom/pan during a pinch by:

1. Anchoring the pinch baseline at the moment of true activation, not at the
   moment the second touch first landed (root cause for the stale-activation
   case).
2. Rebasing the pinch baseline whenever the identity of the two participating
   touches changes mid-gesture (root cause for the touch-set-change case).
3. As defense-in-depth, rejecting any single-frame `rotationDelta` / `scale` /
   pan magnitude that exceeds a "humanly plausible" per-frame threshold, and
   rebasing rather than passing the outlier through.

Goal is *not* to add input lag. Normal pinches must remain crisp; clamps must
sit well outside the range of intentional fast gestures.

## Design

### `onPinchRebase()` callback

Add a new callback to `InputCallbacks` (`InputManager.ts:11-27`):

```ts
onPinchRebase: () => void;
```

When `InputManager` rebases the pinch baseline mid-gesture (any of the three
cases below), it calls `onPinchRebase()` before the next `onPinchMove()`.

`PaperView.onPinchRebase` (and the parallel handler in `EmbeddedPaperModal`)
sets:

```ts
this.pinchBaseZoom = null;
this.pinchBaseRotation = null;
```

so the next `onPinchMove` re-anchors `pinchBaseZoom/Rotation` to the camera's
*current* state (existing logic at `PaperView.ts:1711-1714`). The cumulative
deltas from the rebased `initialPinch*` then build on top of where the camera
already is — no jump, no reset.

This callback is the cleanest way to keep `PaperView`'s "delta from gesture
start" model intact while letting the input layer redefine "gesture start"
midstream.

### Rebase helper inside `InputManager`

Factor the baseline reset into a private method so all three rebase triggers
share the same code:

```ts
private rebasePinch(touches: ActiveTouch[]): void {
  this.initialPinchDistance = this.touchDistance(touches[0], touches[1]);
  this.initialPinchAngle = Math.atan2(
    touches[1].y - touches[0].y,
    touches[1].x - touches[0].x,
  );
  this.lastPinchCenterX = (touches[0].x + touches[1].x) / 2;
  this.lastPinchCenterY = (touches[0].y + touches[1].y) / 2;
  this.pinchTouchIds = [touches[0].id, touches[1].id];
  // Tell the consumer to re-anchor its base zoom/rotation on the next move.
  this.callbacks.onPinchRebase();
}
```

Also add `private pinchTouchIds: [number, number] | null = null;` to track the
IDs of the two touches the current baseline was captured against.

### Fix 1 — Rebase on activation crossing

In `handlePointerMove`, the activation block becomes:

```ts
if (!this.isPinchActive) {
  const distDelta = Math.abs(currentDistance - this.initialPinchDistance);
  // ... center delta calc unchanged
  if (distDelta > PINCH_ACTIVATE_THRESHOLD || centerDist > PINCH_ACTIVATE_THRESHOLD) {
    this.isPinchActive = true;
    this.rebasePinch(touches);
    return; // First frame post-activation is zero-delta; skip it.
  } else {
    return;
  }
}
```

The early `return` after rebase skips the no-op frame (scale=1,
rotationDelta=0, panDx/Dy=0). The next pointermove fires with real deltas
measured from the activation point, not from the original touchdown.

### Fix 2 — Rebase on touch-set change

In `handlePointerDown` when going from 1→2 touches, record the IDs:

```ts
this.pinchTouchIds = [touches[0].id, touches[1].id];
// initialPinchDistance/Angle/lastPinchCenter as today
```

In `handlePointerDown` when a new touch arrives while *already* in a pinch
(`activeTouches.size > 2` after the add), check whether the new `touches[0]`
and `touches[1]` IDs still match `pinchTouchIds`. They will (Map preserves
insertion order), so no rebase is needed for 2→3. Strictly no-op, but cheap
to verify.

In `handlePointerUp` and `handlePointerCancel`, after removing the lifted
touch: if `activeTouches.size >= 2` *and* `pinchTouchIds` is set *and* the
current first two IDs differ from `pinchTouchIds`, rebase against the new
pair. This is the case that matters: one of the original pinch touches has
lifted, leaving a different pair.

Clear `pinchTouchIds = null` everywhere the existing code clears
`initialPinchDistance` (the two should always move together).

### Fix 3 — Per-frame outlier rejection

Track the prior frame's delta values on the instance:

```ts
private lastRotationDelta = 0;     // cumulative; matches what we last emitted
private lastScale = 1;             // cumulative; matches what we last emitted
```

In `handlePointerMove`, after computing `scale`, `rotationDelta`, `panDx`,
`panDy`, but before calling `onPinchMove`:

```ts
const frameRotation = rotationDelta - this.lastRotationDelta;
const frameScaleRatio = scale / this.lastScale;
const framePanMag = Math.hypot(panDx, panDy);

const ROTATION_OUTLIER = Math.PI / 6;          // 30° per frame
const SCALE_OUTLIER_HI = 1.5;                  // > 1.5× growth in one frame
const SCALE_OUTLIER_LO = 1 / SCALE_OUTLIER_HI; // < 0.67× shrink in one frame
const PAN_OUTLIER = 150;                       // 150 px per frame

if (
  Math.abs(frameRotation) > ROTATION_OUTLIER ||
  frameScaleRatio > SCALE_OUTLIER_HI ||
  frameScaleRatio < SCALE_OUTLIER_LO ||
  framePanMag > PAN_OUTLIER
) {
  this.rebasePinch(touches);
  this.lastRotationDelta = 0;
  this.lastScale = 1;
  return; // Skip this frame; next frame's deltas are from rebased baseline.
}

this.lastRotationDelta = rotationDelta;
this.lastScale = scale;
this.callbacks.onPinchMove(centerX, centerY, scale, panDx, panDy, rotationDelta);
```

Reset `lastRotationDelta = 0` / `lastScale = 1` wherever a fresh pinch baseline
is established (on activation rebase, on touch-set rebase, on `onPinchEnd`).

#### Threshold rationale

- **30° per frame.** A fast intentional rotate is ~180° in 1 s ≈ 3°/frame at
  60 Hz; even an aggressive flick rarely exceeds 10°/frame. 30° is well outside
  intentional gestures but catches the 90°/180° snaps the user reported.
- **1.5× scale per frame.** A fast pinch zooms ~2× per second ≈ 1.012×/frame;
  even rapid pinches stay well under 1.5× per frame. Catches sudden ID-swap
  jumps where a different finger pair produces a much larger separation
  instantly.
- **150 px per frame.** A fast two-finger swipe peaks around 50–100 px/frame.
  150 px is generous headroom; mostly catches the case where the center jumps
  because one of the two anchor touches changed identity.

If a real fast gesture trips the clamp, the user sees one skipped frame
(~16 ms) followed by the gesture resuming from the current finger positions.
That's preferable to a 90° snap, and invisible on intentional input.

### Where to apply

Edits land in:

- `src/input/InputManager.ts` — the rebase helper, the three triggers, the
  outlier check, the new `onPinchRebase` callback, the per-frame delta
  tracking.
- `src/view/PaperView.ts` — implement `onPinchRebase`, nulling
  `pinchBaseZoom/Rotation`. Wire it into the `InputCallbacks` literal at
  `PaperView.ts:1710-1729`.
- `src/embed/EmbeddedPaperModal.ts` — same `onPinchRebase` wiring at
  `EmbeddedPaperModal.ts:1112-1129`.

No changes to `Camera.ts` — the camera continues to receive whatever the input
layer decides to pass through.

## Tests

New unit tests in `src/input/InputManager.test.ts` (create if absent — search
shows no existing test for `InputManager`; if no test scaffold exists we'll
follow the pattern used by sibling tests under `src/canvas/__tests__` and
mock `HTMLElement` + `PointerEvent` minimally):

1. **Activation rebase.** Synthesize: two touchdowns 5 px apart at angle 0°.
   Move both touches such that the angle slowly rotates 80° while staying
   under the 8 px distance/center threshold (e.g., both touches rotate around
   a fixed midpoint, distance unchanged). Then nudge one touch outward to
   cross the threshold. Assert: the first `onPinchMove` after activation has
   `rotationDelta ≈ 0`, not ≈ 80°.
2. **Touch-set change rebase.** Touchdown A and B → pinch activates → move
   both → touchdown C (3 touches) → touchup A (back to 2 touches: B, C). The
   surviving pair (B, C) has a very different angle from (A, B). Assert:
   `onPinchRebase` was called between the touchup and the next `onPinchMove`,
   and the first post-rebase `onPinchMove` has `rotationDelta ≈ 0`.
3. **Outlier rotation clamp.** Force a 90° single-frame angle jump (e.g., by
   teleporting one touch). Assert: `onPinchMove` is NOT called that frame,
   `onPinchRebase` IS called, and the *next* frame's delta is measured from
   the post-jump positions.
4. **Outlier scale clamp.** Same shape: jump distance from 100 px → 300 px in
   one frame (3× ratio). Assert skip + rebase.
5. **Outlier pan clamp.** Same shape: jump center by 250 px in one frame.
   Assert skip + rebase.
6. **Normal pinch is unaffected.** Smooth 60° rotation across 20 frames, 2×
   zoom across 20 frames, 100 px pan across 20 frames — assert no rebase
   fires and all frames pass through with the expected cumulative deltas.

Existing tests in `PaperView` / `EmbeddedPaperModal` won't break (the new
callback is optional from their POV — they only need to add the handler).

## Out of scope

- **Smoothing / OneEuro on gesture deltas.** Adds lag; not needed once root
  causes are addressed. Mentioned in the input report as a future option;
  leave for later if outlier rejection proves insufficient.
- **Wiring `DeviceSettings.palmRejection` to actually toggle behavior.**
  That's a separate "make the setting do something" task; this plan focuses
  on the rotation jump regardless of the setting's state.
- **Touch-radius / pressure-based palm detection.** Out of scope; the iPad
  pointer events don't reliably expose what we'd need, and the proposed
  outlier approach handles the symptoms without it.

## Files touched

- `src/input/InputManager.ts` — rebase helper, three triggers, outlier check,
  new callback, per-frame state.
- `src/input/InputManager.test.ts` — new (or extended) test file.
- `src/view/PaperView.ts` — `onPinchRebase` handler.
- `src/embed/EmbeddedPaperModal.ts` — `onPinchRebase` handler.

## Verification

- `yarn lint && yarn test` — new tests must pass; existing must not regress.
- `yarn build && yarn build:copy` — deploy to vault.
- Manual on iPad: deliberately rest palm before placing pen, repeat several
  times. Confirm no rotation snap. Then exercise normal pinch/zoom/rotate
  gestures and confirm they still feel responsive.
