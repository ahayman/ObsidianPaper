# Fix Pencil Grain Texture Snap After Stroke

## Problem

After completing a pencil stroke, the grain texture visibly "snaps" to a different pattern. This happens because the grain pattern's anchor point differs between live and final rendering:

- **Live rendering** (`Renderer.ts:609`): anchors grain to `points[0].x, points[0].y` (first stroke point)
- **Final rendering** (`StrokeRenderCore.ts:105`): anchors grain to `stroke.bbox[0], stroke.bbox[1]` (bounding box min corner)

When a stroke curves or goes upward, `bbox[0], bbox[1]` differs from the first point, causing the grain pattern to shift.

## Fix

Store the grain anchor (first point) on the `Stroke` type and use it consistently in both rendering paths.

### Step 1: Add `grainAnchor` to the `Stroke` interface

**File:** `src/types.ts`

Add an optional field to `Stroke`:
```ts
grainAnchor?: [number, number]; // [x, y] of first point, for stable grain texture
```

Making it optional preserves backward compatibility with existing saved strokes.

### Step 2: Set `grainAnchor` during stroke finalization

**File:** `src/stroke/StrokeBuilder.ts`

In `finalize()`, record the first point:
```ts
grainAnchor: this.points.length > 0 ? [this.points[0].x, this.points[0].y] : undefined,
```

### Step 3: Use `grainAnchor` in final rendering

**File:** `src/canvas/StrokeRenderCore.ts` (line ~105)

Change the anchor from `stroke.bbox[0], stroke.bbox[1]` to use `stroke.grainAnchor` when available, falling back to bbox for old strokes:
```ts
const anchorX = stroke.grainAnchor?.[0] ?? stroke.bbox[0];
const anchorY = stroke.grainAnchor?.[1] ?? stroke.bbox[1];
```

### Summary of changes

| File | Change |
|------|--------|
| `src/types.ts` | Add optional `grainAnchor` field to `Stroke` |
| `src/stroke/StrokeBuilder.ts` | Set `grainAnchor` in `finalize()` |
| `src/canvas/StrokeRenderCore.ts` | Use `grainAnchor` for anchor coordinates |

No changes needed to `Renderer.ts` — the live path already uses `points[0]` correctly.

### Backward compatibility

- Old strokes without `grainAnchor` fall back to `bbox[0], bbox[1]` (current behavior)
- The field is optional and small (`[number, number]`), so document size impact is negligible
- No migration needed
