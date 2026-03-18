# Lasso Selection Tool — Stage 2 Plan

## Overview

This plan covers the advanced features built on top of the Stage 1 lasso implementation (tool infrastructure, selection algorithm, bounding box/handles, move/resize, property changes). Stage 2 adds: copy/cut/paste, tap-to-select, add-to-selection, rotation, midpoint resize handles, incremental lasso feedback, and cross-page drag.

---

## Phase 5: Copy / Cut / Paste / Duplicate

### 5.1 Internal Clipboard

Use an in-memory clipboard object rather than the system clipboard. This avoids all web/Electron clipboard API limitations and is what GoodNotes, Notability, and similar apps do.

```typescript
interface InternalClipboard {
  strokes: Stroke[];       // Deep copies (independent of document)
  styles: Record<string, PenStyle>; // Referenced styles
  sourceBBox: { x: number; y: number; width: number; height: number };
  sourcePageIndex: number;
}
```

- Store on `PaperView` (lives for plugin session)
- Deep copy strokes on copy/cut — the clipboard must be independent of document mutations
- Preserve full stroke data: points, styleOverrides, bbox, grainAnchor

### 5.2 Copy

- Trigger: context menu button or keyboard shortcut (Cmd+C)
- Deep clone all selected strokes and their resolved styles
- Store in internal clipboard with source bounding box and page index
- Non-destructive — no undo entry needed
- Selection remains active after copy

### 5.3 Cut

- Trigger: context menu button or keyboard shortcut (Cmd+X)
- Copy to clipboard (same as 5.2), then delete selected strokes from document
- Single undo unit: undoing a cut restores the strokes and clears the clipboard? No — clipboard is unaffected by undo (matches all apps)
- Undo action type: `"remove-strokes"` (existing type)
- Clear selection state after cut
- Re-render affected tiles

### 5.4 Paste

- Trigger: context menu button or keyboard shortcut (Cmd+V)
- Guard: no-op if clipboard is empty

**Positioning logic:**
1. If pasting on the **same page at a similar viewport position** as the copy source: offset by +20, +20 world units from the source bounding box origin
2. If pasting on the **same page but scrolled away**: center the pasted strokes in the current viewport
3. If pasting on a **different page**: center in the current viewport on the target page
4. Each successive paste on the same page increments the offset (+20 each time) so pastes don't stack exactly

**Implementation:**
1. Deep clone clipboard strokes (new IDs via `generateStrokeId()`)
2. Compute translation to position pasted strokes
3. Apply translation to all points: decode → translate → re-encode → update bbox
4. Set `pageIndex` to the current page
5. Add strokes to `document.strokes`, insert into spatial index
6. Push undo action: `"add-strokes"` (new batch type, inverse of `"remove-strokes"`)
7. Enter selection state with pasted strokes selected (immediate move/resize available)
8. Re-render

**Undo:** Removes the pasted strokes. Clipboard remains intact (user can paste again).

### 5.5 Duplicate

- Trigger: context menu button (no standard shortcut, but could use Cmd+D)
- Equivalent to copy + paste but does NOT overwrite the clipboard
- Deep clone selected strokes, offset by +20/+20, add to document
- Select the duplicates (not the originals)
- Single undo action
- Useful for "stamp" workflows where users want repeated copies without losing clipboard

### 5.6 New Undo Action Type

```typescript
| { type: "add-strokes"; strokes: Stroke[] }
```

This is the inverse of the existing `"remove-strokes"`. Needed for paste/duplicate undo.

### 5.7 Keyboard Shortcut Registration

Register commands via Obsidian's `addCommand()` in `main.ts`:
- `paper:copy` → Cmd+C (only active when PaperView is focused with selection)
- `paper:cut` → Cmd+X
- `paper:paste` → Cmd+V
- `paper:duplicate` → Cmd+D
- `paper:select-all` → Cmd+A (select all strokes on current page)

These should only fire when a PaperView is the active leaf and the lasso tool context is relevant.

### Key Files

| File | Purpose |
|------|---------|
| `src/selection/Clipboard.ts` | Internal clipboard state, deep clone logic |
| `src/selection/PastePositioner.ts` | Compute paste position based on context |
| `src/document/UndoManager.ts` | Add `"add-strokes"` action type |
| `src/view/PaperView.ts` | Wire up copy/cut/paste/duplicate actions |
| `src/main.ts` | Register keyboard commands |

---

## Phase 6: Tap-to-Select

### 6.1 Single-Stroke Selection via Tap

When the lasso tool is active and the user taps (short touch, minimal movement), select the nearest stroke.

**Hit testing:**
- Reuse the eraser's `pointToSegmentDistanceSq()` from `StrokeEraser.ts`
- Convert tap to world coords, query `spatialIndex.queryPoint(x, y, radius)`
- For each candidate, compute minimum distance to any segment
- Select the **nearest** stroke within threshold (not all strokes in radius)
- Threshold: ~15 world units (adjusted for zoom: `threshold / camera.zoom`)

**Tap detection:**
- Use existing InputManager tap detection: `pointerdown` → `pointerup` within 300ms, movement < 10px²
- Add tap callback to `InputCallbacks`: `onTap?: (point: StrokePoint) => void`
- InputManager already tracks `TAP_MOVE_THRESHOLD_SQ = 100` and timing

**Behavior:**
- Tap on a stroke with no active selection → select that single stroke (bounding box + handles appear)
- Tap on empty space with no active selection → no-op
- Tap on empty space with active selection → deselect (already in Stage 1)

### 6.2 Progressive Multi-Tap (Future Enhancement)

Inspired by OneNote's multi-tap gesture:
1. First tap: select single stroke
2. Second tap (within 500ms, near same location): expand to nearby strokes (spatially clustered)
3. Third tap: select all strokes on page

This is a nice-to-have. Defer until basic tap-select is working well.

### Key Files

| File | Change |
|------|--------|
| `src/input/InputManager.ts` | Add `onTap` callback, detect tap vs stroke gesture |
| `src/selection/StrokeHitTester.ts` | Nearest-stroke-to-point using segment distance |
| `src/view/PaperView.ts` | Handle tap in lasso mode |

---

## Phase 7: Add-to-Selection & Subtract-from-Selection

### 7.1 Tap-to-Toggle (When Selection Exists)

When strokes are already selected:
- Tap on an **unselected** stroke → add it to the selection
- Tap on a **selected** stroke → remove it from the selection
- Update bounding box to encompass the new selection set
- Update the selection overlay canvas

This is the most natural iPad-friendly pattern (no modifier keys needed). Concepts app uses this approach.

### 7.2 Add-to-Lasso Mode

For lassoing additional strokes into an existing selection:

**Option A: Toolbar toggle (Recommended)**
- When a selection exists, show an "Add" toggle button in the selection action bar
- When "Add" is active, drawing a new lasso adds to the selection instead of replacing it
- Toggle automatically turns off after one lasso operation

**Option B: Draw lasso starting inside the selection**
- If the lasso starts inside the existing bounding box, enter "add" mode
- If it starts outside, replace the selection
- Pro: No extra UI. Con: Less discoverable, can conflict with move gesture.

**Recommendation:** Option A — explicit toggle is clearer, especially on iPad where there are no modifier keys.

### 7.3 Bounding Box Update on Selection Change

When strokes are added or removed from the selection:
1. Recompute bounding box as union of all selected strokes' bboxes
2. Re-render the selection overlay:
   - Remove deselected strokes from overlay, add to main render pass
   - Add newly selected strokes to overlay, remove from main render pass
3. Reposition handles
4. Optional: animate the bounding box transition (CSS transition on the handle positions)

### Key Files

| File | Change |
|------|--------|
| `src/selection/SelectionState.ts` | `addStroke()`, `removeStroke()`, `recomputeBBox()` |
| `src/selection/SelectionRenderer.ts` | Update overlay on selection change |
| `src/view/toolbar/Toolbar.ts` | "Add" toggle in selection action bar |
| `src/view/PaperView.ts` | Tap-to-toggle logic, add-to-lasso mode |

---

## Phase 8: Rotation

### 8.1 Rotation Handle

- Position: circular handle above the top-center of the bounding box, connected by a short line
- Size: ~12pt circle, white fill with blue border (matches corner handles)
- Offset: ~30 screen-space pixels above the bounding box top edge
- Hit target: expanded to ~22pt radius for stylus, ~44pt for finger

### 8.2 Rotation Interaction

- Drag the rotation handle to rotate
- Rotation center: geometric center of the selection bounding box
- Compute angle: `Math.atan2(pointerY - centerY, pointerX - centerX)` relative to the initial angle
- **During rotation:** Apply CSS `transform: rotate(angle)` to the selection overlay canvas, pivoting around the center. GPU-composited, no re-rendering.
- **On commit:** Bake the rotation into stroke points, re-render

### 8.3 Angle Snapping

- Snap angles: 0, 45, 90, 135, 180, 225, 270, 315 degrees
- Snap tolerance: 5 degrees (if within ±5° of a snap angle, snap to it)
- Visual feedback: briefly show the snapped angle value near the rotation handle

### 8.4 Oriented Bounding Box (OBB)

After rotation, the bounding box should rotate with the content (Procreate pattern):
- Store `rotation: number` on `SelectionState`
- Render the bounding box and handles with the rotation transform applied
- Handle hit testing must account for the rotation (inverse-transform the tap point)
- Resize handles continue to work along the rotated axes

### 8.5 Baking Rotation into Points

On commit (finger lift):
```
for each selected stroke:
  decode points
  for each point:
    // Rotate around selection center
    dx = point.x - centerX
    dy = point.y - centerY
    point.x = centerX + dx * cos(angle) - dy * sin(angle)
    point.y = centerY + dx * sin(angle) + dy * cos(angle)
  re-encode points
  recompute bbox
```

Also rotate `grainAnchor` if present (keeps grain texture stable relative to stroke).

### 8.6 Undo

Store before/after stroke data in the `"transform-strokes"` undo action (same as Stage 1 move/resize). Full point data is stored for precise reversal (avoids floating-point drift from inverse rotation).

### Key Files

| File | Change |
|------|--------|
| `src/selection/SelectionState.ts` | Add `rotation` field |
| `src/selection/SelectionRenderer.ts` | Render rotated bounding box, rotation handle |
| `src/selection/SelectionTransform.ts` | Add rotation transform + bake logic |
| `src/selection/HandleHitTester.ts` | Inverse-rotate tap points for handle detection |
| `src/view/PaperView.ts` | Rotation gesture handling |

---

## Phase 9: Midpoint Resize Handles (Non-Proportional)

### 9.1 Handle Placement

- 4 midpoint handles: top-center, bottom-center, left-center, right-center of the bounding box
- Smaller than corner handles (~8pt vs ~10pt) to visually distinguish
- Same expanded hit targets as corner handles

### 9.2 Axis-Constrained Stretch

- Top/bottom midpoint: vertical stretch only (scaleY changes, scaleX = 1)
- Left/right midpoint: horizontal stretch only (scaleX changes, scaleY = 1)
- Anchor: opposite edge midpoint

### 9.3 During Drag

Apply CSS transform to selection overlay:
```css
transform: scaleX(sx) scaleY(sy);
transform-origin: anchorX anchorY;
```

### 9.4 On Commit

Bake the non-proportional scale into points:
```
for each point:
  point.x = anchorX + (point.x - anchorX) * scaleX
  point.y = anchorY + (point.y - anchorY) * scaleY
```

Stroke thickness: scale by the average of scaleX and scaleY, or by the axis perpendicular to the stroke direction. For simplicity, scale by `Math.sqrt(scaleX * scaleY)` (geometric mean — preserves visual weight).

### 9.5 Interaction with Rotation

If the selection is rotated (Phase 8), midpoint handles operate along the rotated axes, not the canvas axes. The stretch direction follows the OBB orientation.

### Key Files

| File | Change |
|------|--------|
| `src/selection/SelectionRenderer.ts` | Render midpoint handles |
| `src/selection/HandleHitTester.ts` | Detect midpoint handle hits |
| `src/selection/SelectionTransform.ts` | Non-proportional scale math |
| `src/view/PaperView.ts` | Midpoint drag gesture handling |

---

## Phase 10: Incremental Lasso Feedback

### 10.1 Real-Time Stroke Highlighting During Lasso Drawing

As the user draws the lasso, strokes that would be selected are highlighted in real time (before the lasso is completed).

### 10.2 IncrementalLassoHitTester

Create `src/selection/IncrementalLassoHitTester.ts`:

```typescript
class IncrementalLassoHitTester {
  private lassoPoints: Point[] = [];
  private selectedIds: Set<string> = new Set();
  private threshold: number = 0.75;

  addPoint(point: Point): { selected: string[]; deselected: string[] }
  finalize(): Set<string>
}
```

**Algorithm (affected triangle optimization):**
1. Maintain the lasso start point as the anchor
2. For each new point, form a triangle: anchor → previous point → new point
3. Query spatial index for strokes whose bbox intersects the triangle's bbox
4. Only re-test those candidate strokes against the full lasso polygon
5. Return lists of newly selected / newly deselected strokes

This avoids re-testing every stroke on every pointermove.

### 10.3 Visual Feedback

- Highlight selected-so-far strokes with a semi-transparent blue overlay
- Implementation: render a tinted version of each candidate stroke on the active canvas
- Alternative (simpler): draw the stroke's bounding box with a blue fill at 15% opacity
- Strokes that enter/leave selection get their highlight added/removed

### 10.4 Performance Budget

- Point-in-polygon testing must complete within ~5ms per pointermove to maintain 60fps
- Sample point reduction: test every 3rd point in long strokes (>100 points)
- Throttle: only run hit testing when the lasso path has grown by >5 world units since last test
- The spatial index pre-filter is critical — most strokes will be rejected by bbox alone

### 10.5 Fallback

If incremental testing proves too expensive on large documents, fall back to non-incremental mode (no feedback during drawing, test all at once on lasso completion). The Stage 1 implementation already handles this case.

### Key Files

| File | Purpose |
|------|---------|
| `src/selection/IncrementalLassoHitTester.ts` | Core incremental algorithm |
| `src/selection/IncrementalLassoHitTester.test.ts` | Tests |
| `src/selection/LassoSelector.ts` | Integrate incremental mode |
| `src/view/PaperView.ts` | Wire up feedback rendering during lasso |

---

## Phase 11: Cross-Page Drag

No handwriting app supports cross-page **selection**, and for good reason (coordinate system conflicts, ambiguous transforms). Instead, support cross-page **drag** — moving selected strokes from one page to another.

### 11.1 Detecting Page Boundary Crossing

During a move gesture, check if the selection bounding box (after translation) overlaps a different page:
```
const newCenter = { x: bbox.centerX + deltaX, y: bbox.centerY + deltaY };
const targetPage = findPageAtPoint(newCenter.x, newCenter.y, pageLayout);
```

If `targetPage !== selectionState.pageIndex`, the selection is crossing pages.

### 11.2 Visual Feedback

- Show a subtle highlight on the target page as the selection approaches its boundary
- The selection overlay continues to render normally (CSS transform handles cross-page visual)

### 11.3 On Commit

When the move gesture ends and the selection center is on a different page:
1. Compute the position offset relative to the **new page's** coordinate system
2. Update each stroke's `pageIndex` to the target page
3. Translate points so they are correctly positioned within the new page
4. Handle edge cases: strokes that would extend beyond the new page's bounds (clip or allow overflow)
5. Update spatial index, push undo action, re-render both affected pages

### 11.4 Same-Page Constraint

The selection itself always belongs to a single page. If the user tries to lasso across pages, only strokes on the page where the lasso started are considered.

### Key Files

| File | Change |
|------|--------|
| `src/selection/SelectionTransform.ts` | Cross-page translation logic |
| `src/document/PageLayout.ts` | Already has `findPageAtPoint()` |
| `src/view/PaperView.ts` | Detect page crossing during move, commit logic |

---

## Implementation Order

Phases are ordered by user value and dependency:

| Phase | Feature | Depends On | Value |
|-------|---------|------------|-------|
| **5** | Copy/Cut/Paste/Duplicate | Stage 1 complete | High — essential for any selection tool |
| **6** | Tap-to-Select | Stage 1 complete | High — much faster than lassoing single strokes |
| **7** | Add-to-Selection | Phase 6 | Medium — power user feature |
| **8** | Rotation | Stage 1 (Phase 3) | Medium — commonly expected |
| **9** | Midpoint Handles | Stage 1 (Phase 3) | Low — proportional resize covers most needs |
| **10** | Incremental Lasso Feedback | Stage 1 (Phase 1) | Medium — polish feature, improves UX feel |
| **11** | Cross-Page Drag | Stage 1 (Phase 3) | Low — copy/paste between pages is sufficient workaround |

Recommended implementation order: **5 → 6 → 7 → 8 → 10 → 9 → 11**

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Incremental lasso too slow on large documents | Throttle + point sampling + affected-triangle optimization. Fallback to non-incremental. |
| Rotation bake introduces floating-point drift | Store full before/after in undo (no inverse computation needed) |
| OBB handle hit testing is complex | Inverse-rotate the tap point into axis-aligned space, then test normally |
| Cross-page drag coordinate math is error-prone | Unit test extensively with multi-page layouts (vertical + horizontal) |
| Clipboard deep cloning is memory-intensive | Only store the clipboard (not the whole document). For typical selections (<50 strokes), memory is negligible. |
| Tap-to-select conflicts with tap-to-deselect | Tap on a stroke = select/toggle. Tap on empty space = deselect. Unambiguous. |
| Add-to-lasso mode is not discoverable | Clear toolbar toggle with visual indicator. Tooltip on first use. |
| Non-proportional resize distorts handwriting | This is the expected behavior — users invoke midpoint handles intentionally. Undo is always available. |
