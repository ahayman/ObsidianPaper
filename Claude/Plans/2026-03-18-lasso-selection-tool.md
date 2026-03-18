# Lasso Selection Tool Implementation Plan

## Overview

Add a Lasso tool that lets users select groups of strokes and perform operations: change color, change pen type, adjust thickness, move, and proportionally resize.

---

## Architecture Decision: Mixed Group Property UI

When a selection contains strokes with different colors, pen types, or thicknesses, we need to decide how to present and apply property changes.

### Option A: "Apply New Value" (Recommended)

**How it works:** Show action buttons (color picker, pen selector, thickness slider) without displaying current values. Applying any value replaces it on ALL selected strokes.

**Pros:**
- Simplest to implement — no "mixed state" UI needed
- Matches GoodNotes, Notability, OneNote behavior (industry standard for handwriting apps)
- Intuitive — "I selected these strokes and want them all blue"
- Works identically for uniform and mixed selections

**Cons:**
- No way to see what the current values are before changing
- No relative adjustments (can't say "make everything 20% thicker")

### Option B: "Mixed State Indicator" (Design Tool Pattern)

**How it works:** Show current values when uniform, show "Mixed" / dash / empty when values differ. Applying a value replaces on all strokes.

**Pros:**
- More informative — user knows if strokes already share a property
- Familiar to users of Figma/Sketch

**Cons:**
- Significantly more UI complexity
- Overkill for a handwriting app — users can see the colors on screen
- No handwriting app does this

### Option C: Relative Adjustment

**How it works:** Instead of "set to 3pt", offer "scale by 1.5×" or "shift hue by 30°".

**Pros:**
- Preserves relative differences between strokes

**Cons:**
- Confusing UX for handwriting (users think in absolutes: "I want blue")
- No handwriting app does this
- Complex implementation

### Recommendation

**Option A** — it's what every handwriting app does and it's the simplest. We can always evolve to Option B later if users request it. The property panel shows action buttons only; tapping opens a picker that applies to all.

---

## Architecture Decision: Thickness Change Semantics

### Option A: Absolute Set (Recommended)

All selected strokes get the exact thickness value. Selection of [1pt, 3pt, 5pt] → all become [2pt].

**Pros:** Simple, matches Notability/OneNote behavior, intuitive for handwriting.

### Option B: Relative Scale

Scale each stroke's thickness by a factor. Selection of [1pt, 3pt, 5pt] at 2× → [2pt, 6pt, 10pt].

**Pros:** Preserves relative weight differences.

### Recommendation

**Option A** for the initial implementation. Relative scale could be added later as an advanced option.

---

## Architecture Decision: Selection Rendering Strategy

### Option A: Selection Overlay Canvas (Recommended)

When strokes are selected:
1. Render selected strokes to a dedicated overlay canvas
2. Exclude selected strokes from the main tile-based render pass
3. During transforms, apply CSS transforms to the overlay (GPU-accelerated)
4. On commit, apply transforms to stroke data and re-merge into main render

**Pros:**
- Perfectly matches our existing gesture transform pattern (`setGestureTransform` / `clearGestureTransform`)
- GPU-composited transforms = 60fps during move/resize
- Clean separation between selected and unselected content

**Cons:**
- Need a new canvas layer
- Must handle the selected/unselected split in the tile renderer

### Option B: In-Place Rendering with Visual Highlight

Keep strokes in the normal render pipeline, add a highlight overlay. During transforms, re-render affected tiles every frame.

**Pros:** Simpler layer management.

**Cons:** Can't do GPU-accelerated transforms. Re-rendering tiles per frame during drag = poor performance on iPad.

### Recommendation

**Option A** — it leverages our existing architecture and provides smooth transforms.

---

## Architecture Decision: Pen Type Change Strategy

Changing a stroke's pen type (e.g., ballpoint → fountain) requires regenerating the stroke geometry from raw input data. Our architecture already separates raw input (`pts` = encoded StrokePoints with pressure/tilt) from rendered output (outlines, stamps, etc.).

### Option A: Full Re-render from Raw Points (Recommended)

Change `style.pen` on the stroke, invalidate cache, and let the rendering pipeline regenerate the visual from the stored points and the new pen config.

**Pros:**
- Our stroke data already contains full pressure/tilt/twist data
- Rendering pipeline already handles all pen types from raw points
- PenConfigs define all parameters for each pen type
- Just change the style and re-render — architecture supports this natively

**Cons:**
- Results may look different than if originally drawn with that pen (e.g., a ballpoint stroke converted to fountain won't have the deliberate tilt variations a user would naturally produce)
- Computationally expensive for large selections (but only on commit, not during preview)

### Option B: Defer Pen Type Change

Don't support it initially, add it later.

**Pros:** Reduces scope. GoodNotes doesn't support it either.

### Recommendation

**Option A** — our architecture makes this straightforward since raw input data is preserved. The conversion may not be perfect, but users will understand that and appreciate having the option. If it proves problematic, we can remove it.

---

## Architecture Decision: Stroke Selection Algorithm

### Option A: Percentage-Based Point-in-Polygon (Recommended)

Test each stroke's decoded points against the lasso polygon. If ≥75% of points are inside, select the stroke.

**Pros:**
- Industry standard (Microsoft Tablet PC, OneNote, WPF)
- Handles imprecise lasso drawing gracefully
- Works with both convex and concave/self-intersecting lasso paths

### Option B: Bounding Box Intersection Only

Select any stroke whose bounding box intersects the lasso's bounding box.

**Pros:** Very fast, no point decoding needed.

**Cons:** Selects strokes that are clearly outside the lasso, frustrating UX.

### Option C: Any-Point-Inside

Select a stroke if ANY of its points are inside the lasso.

**Pros:** Never misses a partially-lassoed stroke.

**Cons:** Over-selects — a stroke barely clipped by the lasso edge gets fully selected.

### Recommendation

**Option A** with 75% threshold, using ray-casting point-in-polygon. Pre-filter with bounding box intersection via `SpatialIndex.queryRect()`.

---

## Implementation Plan

### Phase 1: Tool Infrastructure & Lasso Drawing

**Goal:** Register the lasso as a new tool, draw the lasso path, determine selected strokes.

#### 1.1 Add "lasso" to ActiveTool type
- Update `ActiveTool` in `ToolbarTypes.ts`: `"pen" | "eraser" | "lasso"`
- Add toolbar button in `Toolbar.build()`
- Add lasso icon (dashed circle/loop shape)
- Wire up `onToolChange("lasso")` in `PaperView.createToolbarCallbacks()`

#### 1.2 Lasso Input Handling
- In `PaperView.createInputCallbacks()`, add lasso branch to `onStrokeStart/Move/End`
- On `onStrokeStart`: Begin accumulating lasso points in world coords
- On `onStrokeMove`: Append points, render lasso path on the active canvas (dashed line, semi-transparent)
- On `onStrokeEnd`: Auto-close polygon (connect last point to first), run selection algorithm
- On `onStrokeCancel`: Clear lasso, return to idle

#### 1.3 Lasso Path Rendering
- Render lasso path on the active/prediction canvas as a dashed, semi-transparent line
- Use `ctx.setLineDash([6, 4])` with a distinct color (e.g., blue-gray)
- Clear on completion or cancel

#### 1.4 Selection Algorithm
- Create `src/selection/LassoSelector.ts`
- `selectStrokesInLasso(lassoPoints, strokes, spatialIndex, threshold=0.75) → string[]`
  1. Compute lasso bounding box
  2. `spatialIndex.queryRect(bbox)` for candidate stroke IDs
  3. For each candidate, decode points and run ray-casting point-in-polygon
  4. Return IDs of strokes meeting the threshold
- Create `src/selection/PointInPolygon.ts` — ray-casting algorithm
- Unit tests for polygon containment and edge cases

#### 1.5 Incremental Selection Feedback (Optional Enhancement)
- As the lasso is drawn, periodically test strokes against the partial polygon
- Briefly highlight strokes that would be selected (e.g., subtle blue tint overlay)
- Defer this to a later phase if it adds too much complexity

### Phase 2: Selection State & Visual Feedback

**Goal:** Manage selection state and render the bounding box with handles.

#### 2.1 Selection State
- Create `src/selection/SelectionState.ts`
  ```typescript
  interface SelectionState {
    strokeIds: Set<string>;
    boundingBox: { x: number; y: number; width: number; height: number };
    pageIndex: number; // All selected strokes should be on the same page
  }
  ```
- Store as `PaperView.selectionState: SelectionState | null`
- Compute bounding box as the union of all selected strokes' bboxes (with small padding)

#### 2.2 Selection Overlay Canvas
- Add a new canvas layer between static and active canvases: `selectionCanvas`
- When selection is active:
  - Render selected strokes to `selectionCanvas` (using existing stroke rendering)
  - Exclude selected stroke IDs from the main static render pass
  - Render bounding box, handles, and selection UI on the selection canvas

#### 2.3 Bounding Box & Handles
- Render in screen space (handles stay constant size regardless of zoom)
- Rounded-rect bounding box, 1px blue border, semi-transparent blue fill (very subtle)
- 4 corner handles (small circles, ~10pt, filled white with blue border)
- Corner handles = proportional resize
- No midpoint handles initially (simplifies first implementation)
- No rotation handle initially (can add later)

#### 2.4 Handle Hit Testing
- On tap/touch inside bounding box but not on a handle: prepare for move
- On tap/touch on a corner handle: prepare for resize
- On tap/touch outside bounding box: deselect (clear selection state)
- Expanded hit targets for handles (~22pt radius for stylus, ~44pt for finger)

#### 2.5 Deselection Triggers
- Tap outside the selection bounding box
- Switch to pen or eraser tool
- Start drawing a new lasso (old selection cleared first)
- Undo/redo (simpler than trying to maintain selection across edits)

### Phase 3: Move & Resize

**Goal:** Move and proportionally resize selected strokes.

#### 3.1 Move (Drag Inside Bounding Box)
- **During drag:** Apply CSS transform to `selectionCanvas` (translateX, translateY)
- **On drag end (commit):**
  1. Compute delta in world coords
  2. For each selected stroke: decode points, translate all points, re-encode, update bbox
  3. Update spatial index entries
  4. Push undo action
  5. Clear selection overlay, re-merge strokes into main render
  6. Invalidate affected tiles, re-render
  7. Restore selection state at new position

#### 3.2 Proportional Resize (Drag Corner Handle)
- Anchor point = opposite corner of dragged handle
- **During drag:** Apply CSS transform to `selectionCanvas` (scale + translate to keep anchor fixed)
- **On drag end (commit):**
  1. Compute scale factor from original to new bounding box size
  2. For each selected stroke:
     - Decode points
     - Transform each point: `newX = anchor.x + (pt.x - anchor.x) * scale`
     - Re-encode points, update bbox
     - Scale `styleOverrides.width` by same factor (so stroke thickness scales proportionally)
  3. Update spatial index, push undo action, re-render

#### 3.3 Undo/Redo for Transforms
- New undo action type: `"transform-strokes"`
  ```typescript
  { type: "transform-strokes"; entries: { strokeId: string; before: Stroke; after: Stroke }[] }
  ```
- Stores full before/after stroke data (including pts, bbox, styleOverrides)
- On undo: restore `before` versions; on redo: restore `after` versions

### Phase 4: Property Changes

**Goal:** Change color, pen type, and thickness of selected strokes.

#### 4.1 Selection Action Bar
- When selection is active, show a floating action bar near the bounding box (or at top/bottom of viewport)
- Buttons: Color, Pen Type, Thickness, Delete
- Position: above the bounding box if room, otherwise below, always visible

#### 4.2 Color Change
- Tap color button → show color picker (reuse existing pen color picker UI)
- On color select: set `styleOverrides.color` on every selected stroke (or update `style` reference)
- Push undo action with before/after for each stroke
- Invalidate cache for affected strokes, re-render
- Keep selection active after change

#### 4.3 Pen Type Change
- Tap pen type button → show pen type selector (ballpoint, felt-tip, pencil, fountain, highlighter)
- On select: update each stroke's resolved pen type (via `styleOverrides.pen`)
- Invalidate cache, re-render (rendering pipeline handles the rest from raw points)
- Push undo action
- Keep selection active

#### 4.4 Thickness Change
- Tap thickness button → show thickness slider or preset buttons
- On change: set `styleOverrides.width` on every selected stroke
- Absolute set (all strokes get the same thickness)
- Push undo action, invalidate, re-render
- Keep selection active

#### 4.5 Delete
- Tap delete button → remove all selected strokes from `document.strokes`
- Update spatial index, push batch undo action (`remove-strokes`)
- Clear selection state
- Re-render

### Phase 5: Copy/Cut/Paste (Future)

Not in initial scope but worth noting the path:
- Copy: serialize selected strokes to clipboard (as JSON or custom format)
- Cut: copy + delete
- Paste: deserialize, offset slightly from original position, enter selection mode with pasted strokes

### Phase 6: Refinements (Future)

- Incremental lasso feedback (highlight strokes during lasso drawing)
- Tap-to-select individual strokes
- Add-to-selection (draw another lasso while holding shift or using an "add" mode)
- Midpoint resize handles (non-proportional stretch)
- Rotation handle
- Relative thickness adjustment option
- Cross-page selection (strokes on different pages)

---

## Key Files to Create

| File | Purpose |
|------|---------|
| `src/selection/LassoSelector.ts` | Lasso polygon construction + stroke containment testing |
| `src/selection/PointInPolygon.ts` | Ray-casting point-in-polygon algorithm |
| `src/selection/SelectionState.ts` | Selection state type + bounding box computation |
| `src/selection/SelectionRenderer.ts` | Render bounding box, handles, action bar |
| `src/selection/SelectionTransform.ts` | Apply move/resize transforms to stroke data |
| `src/selection/LassoSelector.test.ts` | Tests for selection algorithm |
| `src/selection/PointInPolygon.test.ts` | Tests for point-in-polygon |
| `src/selection/SelectionTransform.test.ts` | Tests for transform math |

## Key Files to Modify

| File | Change |
|------|--------|
| `src/view/toolbar/ToolbarTypes.ts` | Add `"lasso"` to `ActiveTool` |
| `src/view/toolbar/Toolbar.ts` | Add lasso button, selection action bar |
| `src/view/PaperView.ts` | Lasso input handling, selection state, overlay canvas |
| `src/canvas/Renderer.ts` | Selection overlay canvas, exclude selected strokes from static pass |
| `src/document/UndoManager.ts` | New `"transform-strokes"` and `"modify-strokes"` action types |
| `src/types.ts` | Selection-related types (if any needed beyond SelectionState) |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Point-in-polygon too slow for many strokes | Bounding box pre-filter via SpatialIndex + lazy point decoding |
| Selection overlay rendering doesn't match main rendering | Use the same rendering codepath for both; just target a different canvas |
| Stroke transforms cause visual artifacts | Apply transform to raw points and fully re-render (no approximations) |
| Pen type change produces poor results | Warn user? Or just let them try it and undo. Users understand this is a conversion. |
| Undo complexity with transform + property changes | Store complete before/after stroke data. Slightly memory-heavy but simple and reliable. |
| iPad performance during move/resize | CSS transform approach (Phase 3) avoids per-frame re-rendering — should be smooth |
| Cross-page selection | Defer to Phase 6. Initial implementation restricts selection to single page. |

---

## Estimated Complexity

- **Phase 1** (Tool + Selection Algorithm): Medium — new tool type, polygon math, tests
- **Phase 2** (Selection UI): Medium-High — new canvas layer, handle rendering, hit testing
- **Phase 3** (Move/Resize): High — transform math, two-phase rendering, undo integration
- **Phase 4** (Property Changes): Medium — mostly wiring UI to existing style system
- **Total**: This is a substantial feature. Suggest implementing phases sequentially, testing each before proceeding.
