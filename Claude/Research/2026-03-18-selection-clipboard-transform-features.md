# Selection, Clipboard, and Transform Features Research

Date: 2026-03-18

## 1. Copy/Cut/Paste for Strokes

### Clipboard Format Approaches

There are three tiers of clipboard implementation for ink/drawing apps:

**Internal-only clipboard (most common for handwriting apps):**
- GoodNotes, Notability, and similar iPad handwriting apps use an internal clipboard that stores stroke data in their proprietary format
- The clipboard holds the full stroke model: points array, pressure/tilt data, drawing attributes (color, width, pen type), and per-stroke metadata
- This is the simplest approach and covers the primary use case (copy within the same app)

**System clipboard with custom format (professional drawing apps):**
- Microsoft's Ink platform defines ISF (Ink Serialized Format) as the native clipboard format for ink, plus fallbacks: Enhanced Metafile (EMF), Bitmap, Text Ink, and Sketch Ink
- The Windows Ink API supports `ClipboardCopy(strokes, formats, modes)` which can place multiple representations simultaneously
- Excalidraw uses a custom MIME type `excalidraw/clipboard` with JSON containing full element definitions (id, type, x, y, width, height, angle, strokeColor, backgroundColor, fillStyle, strokeWidth, opacity, groupIds, etc.)
- Figma embeds binary data (their Kiwi format) as base64-encoded strings in HTML `data-` attributes, enabling clipboard interop across apps

**Web clipboard constraints:**
- The async Clipboard API restricts writes to `text/plain`, `text/html`, and `image/png`
- The older `clipboardData.setData()` API allows arbitrary MIME types during copy/paste events
- Chromium's "web custom formats" proposal (2022+) allows prefixing with `web ` for custom types
- Practical approach: store custom JSON in `text/html` as a data attribute (Figma pattern), or use `text/plain` with JSON for simple cases

**Recommendation for ObsidianPaper:** Use an internal clipboard object (not the system clipboard) for stroke-to-stroke copy/paste. This avoids all web clipboard API limitations. Optionally, also place a PNG on the system clipboard for paste-into-other-apps support.

### Paste Positioning

Apps handle paste position differently:

- **Same page, same viewport:** Paste with a small offset (typically 10-20px down and right) from the original position, so the user can see the paste happened
- **Same page, different scroll position:** Paste at center of current viewport
- **Different page:** Paste at center of viewport on the new page
- **Illustrator/Photoshop pattern:** Paste at center of viewport by default; "Paste in Place" (Shift+Ctrl+V) pastes at exact original coordinates

**Microsoft Ink sample** pastes at a computed offset from the origin: the upper-left corner plus the width of a selection handle, converted from pixel to ink space.

**GoodNotes** users have requested "paste in place" as a feature, suggesting the default behavior is to paste with an offset or at viewport center.

### Post-Paste Behavior

- **Pasted strokes enter selection mode automatically** in all major apps (GoodNotes, Notability, OneNote, Microsoft Ink sample). The Microsoft Ink sample explicitly calls `SetSelection(pastedStrokes)` after paste.
- Pasted strokes can be immediately moved/resized without re-selecting
- Multiple pastes from the same copy are supported -- each paste creates independent copies with new IDs
- Each subsequent paste on the same page typically adds another offset increment

### Duplicate vs Copy+Paste

- **Notability** has an explicit Duplicate action (Cmd+D) separate from Copy+Paste. Duplicate creates a copy with a small offset immediately, without touching the clipboard.
- **GoodNotes** users have requested a one-tap Duplicate in the selection menu (suggesting it was added later)
- **Concepts app** has Duplicate in the selection popup menu
- **Duplicate** is more convenient for "stamp" workflows -- it doesn't overwrite clipboard contents

### Undo/Redo Integration

- Paste is a single undoable action using the Command pattern
- The undo of a paste removes all pasted strokes
- The clipboard contents are NOT affected by undo (you can undo paste, then paste again)
- Cut is two operations internally (copy to clipboard + delete strokes) but should be a single undo unit
- Deep copy is essential: clipboard must hold independent copies of stroke data, not references, because the original strokes may be modified or deleted after copy

### Implementation Pattern (Command Pattern)

```
PasteCommand {
  execute(): create deep copies of clipboard strokes, apply position offset, add to document, select them
  undo(): remove the pasted strokes from document
}

CutCommand {
  execute(): copy strokes to clipboard (deep copy), remove from document
  undo(): re-add the strokes to document
}

CopyCommand {
  execute(): deep copy strokes to clipboard (no undo needed -- copy is non-destructive)
}
```

## 2. Tap-to-Select Individual Strokes

### Hit Testing Approaches

**Microsoft Ink Platform (most mature API):**
- `Ink.HitTest(Point point, float radius)` -- point-based hit test with configurable radius
- `Ink.NearestPoint(Point point, out float indexOnStroke, out float distance)` -- returns nearest stroke and distance
- The radius creates a circular hit zone around the tap point to compensate for imprecise finger/pen taps
- Typical hit radius: 15-25 points (device-dependent)

**Canvas2D native methods:**
- `isPointInStroke(path, x, y)` -- checks if point is on the stroke path
- Tolerance hack: temporarily set `lineWidth` to a larger value (e.g., 10-20px) before testing, then reset. This pads the hit target without changing visual rendering.
- Use `Path2D` objects created alongside strokes for efficient hit testing without redrawing

**Distance-to-polyline approach (recommended for custom implementation):**
- For each stroke, compute minimum distance from tap point to any segment in the stroke polyline
- A stroke is "hit" if minimum distance < threshold (e.g., 20px in screen coordinates)
- Return the nearest stroke if multiple are within threshold
- Performance: O(n * m) where n = stroke count, m = average points per stroke
- Optimization: use spatial index (grid or quadtree) to skip strokes whose bounding box is far from the tap point

### OneNote Multi-Tap Gesture (Innovative Pattern)

OneNote introduced a progressive tap-to-select system:
1. **First tap:** Selects initial stroke or word
2. **Second tap:** Expands to line
3. **Third tap:** Expands to paragraph
4. **Fourth tap:** Selects entire page

For drawings/non-text ink, the progression is: stroke -> visible ink on page -> entire page. Highlighters and drawings are treated as ink strokes in this hierarchy.

### Tap-Select Visual Feedback

- Selected strokes typically show a **bounding box with handles** immediately
- Some apps also change the stroke rendering (e.g., Microsoft WPF sample changes color to red; Concepts app highlights selected strokes in full color while graying out everything else)
- The bounding box should appear with corner handles, midpoint handles, and optionally a rotation handle

## 3. Add-to-Selection / Multi-Lasso

### Approaches by App

**Desktop pattern (Shift+click/lasso):**
- Toon Boom Harmony: Hold Shift + click or Shift + lasso to add strokes to existing selection
- Krita: Hold Shift while dragging to add to selection
- This is the standard convention in professional drawing/animation software

**iPad/touch pattern (no modifier keys):**
- **Concepts app** uses Item Picker mode: tap individual strokes to toggle them in/out of selection
- **GoodNotes:** Does NOT support add-to-selection on iPad. You must re-lasso to create a new selection. Users tap outside to deselect, then create a new larger lasso.
- **OneNote iPad:** Multi-tap expands selection progressively but doesn't support arbitrary add-to-selection

**Ink & Switch research (directional lasso):**
- Clockwise lasso (blue): selects only fully enclosed strokes
- Counterclockwise lasso (green): selects all strokes the lasso touches
- Post-selection slider: adjust specificity from "all visually connected ink" to "only fully enclosed strokes"

### Subtracting from Selection

- On desktop: Alt+click typically removes a stroke from selection (Photoshop pattern)
- On iPad: No standard convention. Concepts app's Item Picker lets you tap to toggle individual items.
- Tapping an already-selected stroke could toggle it out of the selection

### Bounding Box Updates

When selection changes:
- Recompute the axis-aligned bounding box of all selected strokes
- Animate the bounding box transition for smooth UX
- Reposition all handles (corner, midpoint, rotation)
- The Microsoft Ink sample recomputes `selectedStrokes.GetBoundingBox()` and inflates it by a buffer (8px) for visual padding

### Recommended iPad Approach

Since iPads lack modifier keys during pen use:
1. **Primary:** Lasso to select (replaces previous selection)
2. **Add-to mode toggle:** A toolbar toggle or gesture that switches lasso into "add" mode
3. **Tap-to-toggle:** When a selection exists, tapping an unselected stroke adds it; tapping a selected stroke removes it
4. **Long-press:** Could activate add-to-selection mode temporarily

## 4. Rotation

### Rotation Handle Position and Size

- **Procreate:** Green rotation node positioned ABOVE the bounding box (separate from resize handles). Users drag it to rotate. A numeric readout displays the current angle. Tapping the node opens a keypad for precise degree entry.
- **Konva.js:** Rotation anchor position is configurable: 0 = top-center (default), 90 = middle-right, 180 = bottom-center, -90 = middle-left
- **GoodNotes:** White circle handle on the bounding box for rotation
- **Microsoft Ink:** Standard selection rectangle with 8 handles (4 corner + 4 midpoint), no dedicated rotation handle in their basic sample
- **Common pattern:** Rotation handle is a circular node positioned above the top-center of the bounding box, connected by a short line

### Rotation Anchor Point

- **Universal convention:** Center of the bounding box (geometric center of all selected strokes)
- Procreate explicitly states content "rotates around its own midpoint"
- Some apps allow changing the anchor point (e.g., Illustrator's rotation origin can be repositioned)

### Bounding Box During Rotation: AABB vs OBB

Two approaches exist:

**Approach A: Oriented Bounding Box (OBB) -- Procreate pattern:**
- The bounding box rotates WITH the content
- Handles stay at box corners/midpoints
- The box itself is rotated relative to the canvas
- Procreate has a separate yellow "Bounding Box Adjust" node that rotates ONLY the box (not content) to optimize the fit
- Pro: Visually clear, resize handles align with content axes
- Con: More complex hit testing for handles, more complex resize math

**Approach B: Recompute AABB after rotation:**
- After rotation, compute new axis-aligned bounding box that encompasses all rotated content
- Handles stay axis-aligned
- Pro: Simpler implementation, simpler handle hit testing
- Con: Bounding box can become very large for rotated content (especially long diagonal selections)

**Recommendation:** Use OBB (Approach A). Store a rotation angle on the selection group. Apply the rotation transform when rendering the bounding box and handles. This is what users expect from modern drawing apps.

### Storing Rotated Stroke Points

Two implementation strategies:

**Strategy 1: Store transform matrix (lazy/deferred):**
- Each stroke (or group of strokes) has a transform matrix: `{ translate, rotate, scale }`
- Points remain in their original coordinates
- Rendering applies the transform at draw time
- Pro: Non-destructive, can undo rotation precisely, efficient for frequent transforms
- Con: Accumulated transforms can cause floating-point drift; rendering must compose transforms

**Strategy 2: Bake rotation into points (eager):**
- When the user confirms the transform (lifts finger, taps away), apply the rotation matrix to every point: `newPoint = rotationMatrix * oldPoint`
- Reset the transform to identity
- Pro: Simpler rendering, no transform accumulation, points always in world coordinates
- Con: Lossy (repeated rotate+bake loses precision), harder to undo precisely

**Recommended hybrid approach:**
- During interactive manipulation: store as transform matrix (fast, non-destructive)
- On commit (user finishes transform): bake into points + record the transform in undo stack
- Undo restores the original points (stored in the undo command)

### Angle Snapping

- **Konva.js:** `rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315]` with configurable `rotationSnapTolerance` (e.g., 30 degrees). Within the tolerance zone, rotation "snaps" to the nearest snap angle.
- **Procreate Magnetics:** Aligns to common angles when enabled
- **Common convention:** Snap to 0, 45, 90, 135, 180, 225, 270, 315 degrees
- Implementation: `snappedAngle = nearestSnap(currentAngle, snapAngles, tolerance)`

## 5. Non-Proportional Resize (Midpoint Handles)

### How Midpoint Handles Work

- **Procreate:** Blue transformation nodes at midpoints of each edge. "Drag a midpoint node to stretch and squash the selection along a single axis."
- **Microsoft Ink sample:** 8 handles total -- 4 corner + 4 midpoint (top, bottom, left, right)
- **Konva.js Transformer:** Supports midpoint handles. Importantly, "Transforming tool is not changing width and height properties of nodes when you resize them. Instead it changes scaleX and scaleY properties."

### Geometry Distortion

Non-proportional scaling DOES distort stroke geometry:
- A circle becomes an ellipse
- Handwriting gets stretched/squashed along one axis
- This is the expected behavior -- users invoke midpoint handles intentionally for this effect

### Stroke Thickness Behavior

Two options (configurable in some apps):

**Option A: Scale stroke thickness with content (default for handwriting):**
- A horizontally stretched stroke becomes wider horizontally
- This is what SVG does by default with transforms
- Appropriate for handwriting where the user wants to "stretch" their writing

**Option B: Non-scaling stroke (professional drawing pattern):**
- SVG `vector-effect="non-scaling-stroke"` -- stroke width stays constant regardless of scale
- Adobe Illustrator has a "Scale Strokes & Effects" toggle
- Better for technical drawings where line weight must remain consistent

**Known issue:** Non-proportional scaling with non-scaling strokes is a known source of rendering bugs in vector apps (Inkscape bug reports confirm this). Scaling strokes proportionally with the content is simpler and more predictable.

### Implementation

- Store scaleX and scaleY separately on the selection
- During drag: update the relevant scale axis based on which midpoint handle is being dragged
- The opposite edge stays fixed (anchor point is the opposite midpoint)
- On commit: bake the scale into point coordinates: `newX = point.x * scaleX`, `newY = point.y * scaleY`
- If scaling stroke thickness: `newWidth = strokeWidth * scaleX` (or average of scaleX/scaleY)

## 6. Cross-Page Selection

### Industry Practice

**No major handwriting app supports true cross-page selection.**

- **GoodNotes:** Selection is per-page. In vertical scrolling mode, you can now drag a lassoed selection from one page to another (added January 2024), but the selection itself does not span pages.
- **Notability:** Selection is per-page. Copy and paste between pages.
- **OneNote:** Selection operates within a single page context. Lasso only selects strokes on the current page.
- **Concepts app:** Has an infinite canvas (no page boundaries), so the question doesn't arise.

### Why Cross-Page Selection Is Problematic

1. **Different coordinate systems:** Each page has its own coordinate space. Strokes on different pages have positions relative to their page origin.
2. **Bounding box rendering:** The selection box would need to span the gap between pages and render across the page boundary -- visually confusing.
3. **Transform operations:** Rotating or scaling strokes that live on different pages has no clear semantics. Where does the rotation center go?
4. **Rendering complexity:** The selection overlay must be rendered across the inter-page gap.
5. **Storage model:** Moving strokes between pages means changing which page "owns" the strokes.

### Recommendation

Do NOT implement cross-page selection. Instead:
- Selection is always within a single page
- Support drag-to-move a selection across page boundaries (GoodNotes pattern): when the user drags selected strokes past the page edge in scroll mode, the strokes migrate to the adjacent page
- Support copy/paste between pages

## 7. Incremental Lasso Feedback

### Microsoft IncrementalLassoHitTester (Reference Implementation)

The WPF `IncrementalLassoHitTester` is the gold standard implementation:

**Core API:**
```
hitTester = strokes.GetIncrementalLassoHitTester(percentageThreshold)
hitTester.SelectionChanged += handler  // fires SelectedStrokes + DeselectedStrokes
hitTester.AddPoints(newPoints)         // call on every pointermove
hitTester.EndHitTesting()              // call on pointerup
```

**How it works:**
1. On pointer down: create the hit tester with a percentage threshold (e.g., 80% means 80% of a stroke's points must be inside the lasso)
2. On every pointer move: call `AddPoints()` with the new lasso path points
3. The hit tester incrementally updates which strokes are inside/outside the growing lasso polygon
4. The `SelectionChanged` event fires with `SelectedStrokes` (newly inside) and `DeselectedStrokes` (newly outside -- happens when user reverses direction)
5. On pointer up: call `EndHitTesting()` to finalize

**Key insight:** When the user reverses direction while drawing the lasso, strokes that were previously inside may become outside. The hit tester handles this automatically.

### Percentage-Based Enclosure

From the Microsoft Tablet PC documentation:
- A stroke is divided into discrete sample points
- If N% of those points lie within the lasso polygon, the stroke is considered selected
- "As long as the percentage algorithm is kind of correct, users will be happy"
- Typical threshold: 50-80% (the Microsoft Ink sample uses 50%; the WPF sample uses 80%)
- Lower percentages are more forgiving of imprecise lasso drawing

### Incremental Algorithm (Academic Research)

From "An Effective Generic Lasso Selection Tool for Multiselection":

**The "affected triangle" optimization:**
1. Maintain an "anchor point" (the lasso start point)
2. For each new lasso segment (from point N-1 to point N), form a triangle: anchor, point N-1, point N
3. Only elements whose bounding box intersects this triangle could have changed selection state
4. Use a spatial index (grid-based) to quickly find candidate elements near the triangle
5. For those candidates only, run the full point-in-polygon test

**Performance benefit:** When the lasso covers a large area, the non-incremental approach must run point-in-polygon on every element. The incremental approach only tests elements in the small "affected triangle" region, which is typically much smaller.

### Visual Feedback During Lasso

**Highlight approach (most common):**
- Microsoft WPF sample: changes selected stroke color to red in real-time as the lasso grows
- Concepts app: "Highlight Selection" mode shows selected strokes in full color, grays out unselected
- A semi-transparent overlay or glow effect on selected strokes

**Lasso path rendering:**
- Microsoft Ink sample: draws the lasso as a series of colored dots with a dashed connector line between endpoints
- GoodNotes: dotted line following the lasso path
- Common: dashed/dotted line or animated "marching ants" for the lasso boundary

### Performance Optimization for Real-Time Feedback

1. **Spatial indexing:** Build a grid or quadtree of stroke bounding boxes at selection mode entry. Query only nearby strokes for each new lasso segment.

2. **Bounding box pre-filter:** Before running point-in-polygon, check if the stroke's AABB intersects the lasso's AABB. Skip entirely if no intersection.

3. **Sample point reduction:** Don't test every point in a stroke. Sample every Nth point (e.g., every 3rd or 5th point). The percentage threshold is forgiving enough to handle this.

4. **Throttle feedback updates:** Don't update visual feedback on every single pointermove. Batch updates at 30fps or when the lasso path changes by more than a minimum distance.

5. **Incremental updates only:** Track which strokes changed state (selected/deselected) and only update their rendering, not all strokes.

### Practical Implementation Plan

```
class IncrementalLassoHitTester {
  lassoPoints: Point[] = []
  selectedStrokeIds: Set<string> = new Set()
  spatialIndex: GridIndex  // built from all stroke bounding boxes
  percentThreshold: number = 0.5  // 50% enclosure required

  addPoint(point: Point) {
    lassoPoints.push(point)
    if (lassoPoints.length < 3) return

    // Form the "affected triangle": anchor, previous point, new point
    const anchor = lassoPoints[0]
    const prev = lassoPoints[lassoPoints.length - 2]
    const curr = point
    const affectedBBox = triangleBoundingBox(anchor, prev, curr)

    // Query spatial index for candidate strokes
    const candidates = spatialIndex.query(affectedBBox)

    // Test each candidate
    for (const stroke of candidates) {
      const enclosed = percentInsideLasso(stroke.points, lassoPoints)
      const wasSelected = selectedStrokeIds.has(stroke.id)
      const isSelected = enclosed >= percentThreshold

      if (isSelected && !wasSelected) {
        selectedStrokeIds.add(stroke.id)
        emit('selected', stroke)
      } else if (!isSelected && wasSelected) {
        selectedStrokeIds.delete(stroke.id)
        emit('deselected', stroke)
      }
    }
  }
}
```

## Sources

- [GoodNotes Copy/Paste Support](https://support.goodnotes.com/hc/en-us/articles/360001471316-Copying-and-pasting-content-from-within-GoodNotes)
- [GoodNotes Select, Move, Edit](https://support.goodnotes.com/hc/en-us/articles/7353695644175-Select-move-and-edit-content-on-the-page)
- [GoodNotes Duplicate Feature Request](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/43683249-add-a-menu-item-to-duplicate-a-selection-with-one)
- [GoodNotes Paste in Place Request](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/39116926-paste-in-place)
- [GoodNotes Cross-Page Drag Request](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/40224805-use-lasso-tool-to-drag-content-to-next-page-instea)
- [Microsoft Ink Clipboard Sample](https://learn.microsoft.com/en-us/windows/win32/tablet/ink-clipboard-sample)
- [Microsoft WPF IncrementalLassoHitTester](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/how-to-select-ink-from-a-custom-control)
- [Microsoft IncrementalLassoHitTester API](https://learn.microsoft.com/en-us/dotnet/api/system.windows.ink.strokecollection.getincrementallassohittester?view=netframework-4.7.2)
- [Microsoft Targeting and Hit-Testing Ink Strokes](https://flylib.com/books/en/1.364.1.44/1/)
- [OneNote Lasso Tool](https://support.microsoft.com/en-us/office/select-handwriting-and-ink-with-the-lasso-tool-7545119f-4ac9-457c-b520-3618d3ef96cb)
- [OneNote Multi-Tap Ink Selection](https://techcommunity.microsoft.com/blog/microsoft365insiderblog/introducing-the-ink-selection-multi-tap-gesture-in-onenote-on-windows/4223015)
- [Ink & Switch Selection Gestures](https://www.inkandswitch.com/ink/notes/selection-gestures/)
- [Canvas Hit Detection Methods](https://joshuatz.com/posts/2022/canvas-hit-detection-methods/)
- [Canva Drawing Tool Engineering](https://www.canva.dev/blog/engineering/behind-the-draw/)
- [Concepts App Selection Manual](https://concepts.app/en/ios/manual/selection)
- [Notability Keyboard Shortcuts](https://support.gingerlabs.com/hc/en-us/articles/360021489291-Keyboard-shortcuts)
- [Konva.js Rotation Snaps](https://konvajs.org/docs/select_and_transform/Rotation_Snaps.html)
- [Konva.js Transformer](https://konvajs.org/docs/select_and_transform/Basic_demo.html)
- [Procreate Transform Interface](https://help.procreate.com/procreate/handbook/transform/transform-interface-gestures)
- [Excalidraw Clipboard Format](https://github.com/excalidraw/excalidraw/issues/8700)
- [Web Clipboard Data Formats](https://alexharri.com/blog/clipboard)
- [W3C Clipboard Pickling Explainer](https://github.com/w3c/editing/blob/gh-pages/docs/clipboard-pickling/explainer.md)
- [Fabric.js Object Properties](https://fabricjs.com/docs/old-docs/fabric-intro-part-4/)
- [Incremental Lasso Selection Tool (Academic)](https://bora.uib.no/bora-xmlui/bitstream/handle/1956/22873/report.pdf)
- [Handle Flags: Efficient Selections for Inking (Autodesk Research)](https://www.research.autodesk.com/app/uploads/2023/03/handle-flags-efficient-and.pdf_recnJyicSdZ5BGdau.pdf)
