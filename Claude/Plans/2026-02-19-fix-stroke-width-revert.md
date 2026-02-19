# Fix: Stroke Width Reverts After Pen Lift

## Problem

When drawing, the stroke appears at the user-selected thickness. However, immediately after lifting the pen, the stroke visually snaps to a different thickness (~2.0, the default ballpoint `baseWidth`).

## Root Cause

In `PaperView.ts`, all strokes reference a shared named style `"_default"` (returned by `getCurrentStyleName()`). This style entry in `document.styles` is only written **once** — on the very first stroke:

```typescript
// PaperView.ts line 450-452
if (!docStyles[styleName]) {
    docStyles[styleName] = style;
}
```

After the first stroke, subsequent strokes with different widths (or colors, pen types, etc.) still reference `"_default"` but the stored style is never updated. The `StrokeBuilder` is also constructed **without** `styleOverrides`:

```typescript
// PaperView.ts line 394-397
this.strokeBuilder = new StrokeBuilder(
  this.getCurrentStyleName(),
  { smoothing: style.smoothing },
  // no styleOverrides passed!
);
```

So when the stroke is finalized and baked to the static canvas, `resolveStyle()` returns the stale `"_default"` style (with the first stroke's width), not the current width.

**Active rendering** uses `getCurrentStyle()` directly (correct width), while **baked rendering** resolves via `document.styles["_default"]` (stale width). This causes the visible snap.

## Fix

Pass `styleOverrides` to the `StrokeBuilder` so that each stroke carries its own width/color/pen overrides when they differ from the stored base style.

### Changes in `src/view/PaperView.ts`

#### 1. Compute styleOverrides in `onStrokeStart`

When creating the `StrokeBuilder`, compare the current style against the stored base style for `"_default"`. Pass any differences as `styleOverrides`:

```typescript
onStrokeStart: (point: StrokePoint) => {
  // ...existing code...
  const style = this.getCurrentStyle();
  const styleName = this.getCurrentStyleName();

  // Compute overrides relative to the stored base style
  const baseStyle = this.document.styles[styleName];
  const overrides = baseStyle ? computeStyleOverrides(baseStyle, style) : undefined;

  this.strokeBuilder = new StrokeBuilder(
    styleName,
    { smoothing: style.smoothing },
    overrides,
  );
  this.strokeBuilder.addPoint({ ...point, x: world.x, y: world.y });
},
```

#### 2. Add `computeStyleOverrides` helper function

Add a helper at the bottom of `PaperView.ts` (or as a utility) that diffs two `PenStyle` objects:

```typescript
function computeStyleOverrides(
  base: PenStyle,
  current: PenStyle
): Partial<PenStyle> | undefined {
  const overrides: Partial<PenStyle> = {};
  let hasOverrides = false;

  if (current.pen !== base.pen) { overrides.pen = current.pen; hasOverrides = true; }
  if (current.color !== base.color) { overrides.color = current.color; hasOverrides = true; }
  if (current.width !== base.width) { overrides.width = current.width; hasOverrides = true; }
  if (current.opacity !== base.opacity) { overrides.opacity = current.opacity; hasOverrides = true; }
  if (current.smoothing !== base.smoothing) { overrides.smoothing = current.smoothing; hasOverrides = true; }
  if (current.pressureCurve !== base.pressureCurve) { overrides.pressureCurve = current.pressureCurve; hasOverrides = true; }
  if (current.tiltSensitivity !== base.tiltSensitivity) { overrides.tiltSensitivity = current.tiltSensitivity; hasOverrides = true; }

  return hasOverrides ? overrides : undefined;
}
```

### No other files need changes

- `StrokeBuilder` already accepts and stores `styleOverrides` (line 30-33)
- `Stroke` type already has the `styleOverrides` field (types.ts line 41)
- `resolveStyle()` in `Renderer.ts` already merges overrides: `{ ...base, ...stroke.styleOverrides }` (line 492)
- Serializer already handles `styleOverrides` via the `so` field

The entire infrastructure for per-stroke overrides is already in place — it's just never being populated.

## Testing

1. Draw a stroke at width 2 → should look correct before and after lift
2. Change width to 6, draw another stroke → should stay at width 6 after lift
3. Change pen type, draw → should keep the new pen type's rendering after lift
4. Change color, draw → should keep the new color after lift
5. Undo/redo → strokes should maintain their correct widths
6. Save/reload → strokes should maintain their correct widths (serialization already handles `styleOverrides`)
