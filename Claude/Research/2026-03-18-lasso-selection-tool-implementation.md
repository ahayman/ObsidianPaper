# Lasso Selection Tool Implementation Research

## 1. Selection Mechanics

### How the Lasso Path is Drawn

All major handwriting apps use a freeform lasso drawn by finger or stylus. The lasso path is rendered as a visually distinct stroke (typically dashed, gray, or semi-transparent) to differentiate it from actual ink. When the user lifts their finger/stylus, the path is auto-closed by connecting the endpoint back to the start point with a straight line.

**App-specific behaviors:**
- **GoodNotes**: Freeform lasso with marching-ants style dashed border. Also supports "pen circle" selection (draw a circle with the pen tool while holding a modifier). After lasso completion, the Object Menu appears immediately without requiring a tap.
- **Notability**: Offers both freeform (lasso) and boxed (rectangular) selection modes via a toggle.
- **Apple Notes**: Lasso tool in the markup toolbar. Dotted motion line surrounds selection.
- **OneNote**: Freeform lasso. The end point must connect to start point. After selection, 8 handles appear.
- **Procreate**: Freeform, rectangle, and ellipse selection modes, plus "automatic" (flood-fill-based) selection.

### Stroke Containment Algorithm

The core question: how does the app determine which strokes are "inside" the lasso?

#### Point-in-Polygon with Percentage Threshold (Industry Standard)

The Microsoft Tablet PC Platform (used by OneNote and WPF InkCanvas) established the dominant approach:

1. Each ink stroke is decomposed into its constituent sample points.
2. Each point is tested against the lasso polygon using a **ray-casting point-in-polygon** algorithm.
3. If **N% of the stroke's points** fall inside the polygon, the stroke is considered selected.

**Typical percentage thresholds:**
- Microsoft's sample code uses **80%** for lasso selection and **70%** for rectangular selection.
- The referenced Tablet PC book mentions **60%** for lasso and **70%** for rectangle selection as sample values.
- These are not fixed standards -- the principle is "as long as the percentage is kind of correct, users will be happy."

The percentage-based approach compensates for the imprecise control humans exhibit when drawing freeform selection boundaries with a pen.

#### Ray-Casting Algorithm (Point-in-Polygon)

The most common algorithm for testing if a point is inside a polygon:

1. Cast a horizontal ray from the test point to infinity (typically rightward).
2. Count intersections with the polygon's edges.
3. **Odd count = inside**, even count = outside.

This works correctly for both convex and concave polygons, and even self-intersecting lasso paths (common in hurried selection gestures).

**Alternative: Winding Number Algorithm**
- Counts how many times the polygon winds around the point.
- Non-zero winding = inside, zero = outside.
- Handles self-intersecting polygons more correctly than ray casting.
- Slightly more expensive but more robust.

For handwriting apps with simple lasso paths, ray-casting is sufficient and faster.

#### Performance Optimization: Bounding Box Pre-Filter

Before running point-in-polygon on every stroke point:

1. Compute the **axis-aligned bounding box (AABB)** of the lasso polygon.
2. Skip any stroke whose bounding box does **not intersect** the lasso AABB.
3. For remaining strokes, run the percentage-based point-in-polygon test.

This dramatically reduces the number of point-in-polygon tests needed.

#### Incremental Hit Testing (Microsoft's Approach)

Microsoft's `IncrementalLassoHitTester` tests strokes against the lasso **as it is being drawn**, not just at completion:

1. As each new point is added to the lasso path, test affected strokes.
2. Fire `SelectionChanged` events with `SelectedStrokes` and `DeselectedStrokes` lists.
3. Strokes can be visually highlighted in real-time (e.g., changing their color to red).
4. If the user reverses the lasso direction, previously-selected strokes may become deselected.

This provides instant visual feedback during the selection gesture, which feels much more responsive than waiting for the lasso to close.

**Key performance factors for incremental testing:**
- Number of strokes in the collection
- Number of sample points per stroke
- Number of points in the lasso polygon
- The enclosure percentage threshold

---

## 2. Mixed Group Handling

### How Apps Display Properties of Mixed Selections

When selected strokes have different colors, pen types, and thicknesses, apps take different approaches:

| App | Color Display | Thickness Display | Pen Type Display |
|-----|--------------|-------------------|------------------|
| **GoodNotes** | Shows color picker; applies uniformly | Cannot change thickness of selected strokes (frequently requested) | Cannot change pen type |
| **Notability** | Shows "Style" option; applies to all | Can change thickness via +/- controls | Can change ink type |
| **OneNote** | Shows pen selector on Draw tab; applies to all | Can change via pen selector | Changes with pen selection |
| **Apple Notes** | No color change option for lasso selection | No thickness change | No pen type change |
| **Procreate** | N/A (pixel-based, not stroke-based) | N/A | N/A |

### UI Patterns for Mixed States

The dominant pattern in handwriting apps is surprisingly simple: **they don't show current values at all**. Instead, they present action buttons that apply new values uniformly:

1. **"Apply new value" pattern** (GoodNotes, Notability, OneNote): A color picker is shown without indicating the current mixed state. Selecting any color applies it to ALL selected strokes, replacing their original colors.

2. **No property editing** (Apple Notes): Selection only supports spatial operations (move, copy, cut, delete). No property modification is exposed.

3. **Indeterminate/mixed state pattern** (design tools like Figma, Sketch): Show a dash, "Mixed", or empty field when values differ. This pattern is common in vector design tools but rare in handwriting apps, likely because handwriting tools prioritize simplicity.

### How Property Changes Apply to Mixed Groups

The universal approach across all apps that support it: **absolute replacement, not relative adjustment**.

- **Color change**: Every stroke in the selection gets the new color, regardless of original color.
- **Thickness change**: In Notability and OneNote, the new thickness replaces the original thickness for every stroke. There is no "scale proportionally" option -- it is an absolute set.
- **Pen type change**: When available (Notability), the pen type changes for all selected strokes. This would require regenerating the stroke's visual geometry.

---

## 3. Selection UI

### Bounding Box and Handles

After lasso completion, apps replace the lasso path with a rectangular bounding box around the selected strokes:

- **OneNote**: 8 selection handles (4 corners + 4 midpoints). Standard resize handles.
- **GoodNotes**: White square handles for scaling, blue circle handles for resizing, white circle handle for rotation. The distinction between scaling and resizing: scaling maintains stroke proportions (including thickness), resizing changes dimensions but may not scale stroke properties.
- **Notability**: Bounding box with resize handles; pinch gesture for scaling.
- **Apple Notes**: Dotted bounding outline. Yellow resize handles on tap-and-hold. Simpler than other apps.
- **Procreate**: Blue bounding box with corner and midpoint nodes. Supports freeform, uniform, distort, and warp transform modes.

### Available Actions

Common actions across apps (via context menu, toolbar, or gestures):

| Action | GoodNotes | Notability | OneNote | Apple Notes |
|--------|-----------|------------|---------|-------------|
| Move | Drag | Drag | Drag | Drag |
| Resize | Handles | Handles + Pinch | 8 handles | Yellow handles |
| Rotate | Rotation handle | Two-finger | Available | Not available |
| Copy | Menu | Menu | Menu | Menu |
| Cut | Menu | Menu | Menu | Menu |
| Delete | Menu | Menu | Menu | Menu |
| Duplicate | Menu | Menu | - | Menu |
| Color change | Color picker | Style menu | Draw tab | Not available |
| Thickness change | Not available | Style menu | Draw tab | Not available |
| Group | Not available | Menu | - | Not available |
| Screenshot | Menu | - | - | - |
| Convert to text | Menu | Menu | - | Menu |

### Resize Handle Implementation

Handles are typically:
- Small circles or squares (8-12pt) at corners and midpoints of the bounding box.
- Hit-tested with an expanded touch target (44pt recommended for finger, smaller for stylus).
- Corner handles: proportional resize (maintaining aspect ratio).
- Midpoint handles: stretch along one axis.
- Rotation handle: typically offset above the top-center handle, connected by a thin line.

---

## 4. Move/Resize Mechanics

### Moving Strokes

When the user drags inside the selection bounding box:

1. **During drag**: Apply a CSS/canvas transform to the visual representation of the selected strokes. This is a simple translation offset applied to the rendered bitmap or canvas layer -- no stroke data is modified yet.
2. **On commit** (finger lift): Apply the translation offset to all stroke points:
   ```
   for each stroke in selection:
     for each point in stroke.points:
       point.x += deltaX
       point.y += deltaY
   ```
3. **Re-render**: Invalidate affected tiles and re-render the strokes at their new positions.

### Proportional Resize

Two approaches observed across apps:

#### Approach A: Scale from Handle (Most Common)
1. User drags a corner handle.
2. The opposite corner is the anchor point.
3. Calculate scale factor: `scaleX = newWidth / originalWidth`, `scaleY = newHeight / originalHeight`.
4. For proportional resize (corner handles with constraint): `scale = scaleX = scaleY`.
5. Transform all points relative to anchor:
   ```
   for each point:
     point.x = anchor.x + (point.x - anchor.x) * scaleX
     point.y = anchor.y + (point.y - anchor.y) * scaleY
   ```

#### Approach B: Scale from Center (Pinch Gesture)
1. Two-finger pinch/expand gesture.
2. Center of the bounding box is the anchor.
3. Same scaling math but anchored to center.

### Visual Transform vs. Re-render (Two-Phase Approach)

The standard approach for performance:

1. **During gesture (visual transform)**: Render the selected strokes to an off-screen bitmap/canvas layer. Apply CSS transform (translate, scale, rotate) to this layer. This is GPU-accelerated and instant -- no stroke recalculation needed.

2. **On commit (re-render)**: Apply the accumulated affine transform to all stroke point data. Re-render the strokes from their new data. Discard the temporary bitmap layer.

This is directly analogous to how ObsidianPaper already handles pan/pinch gestures with `clearGestureTransform()`.

### Stroke Property Scaling

When resizing, two sub-questions arise:

**Do stroke thicknesses scale?**
- **GoodNotes**: Has separate "scale" (scales thickness) and "resize" (doesn't scale thickness) modes.
- **Procreate**: "Uniform" mode scales everything proportionally.
- **Adobe Illustrator**: Offers a "Scale Strokes & Effects" toggle.
- **Penpot**: Resize does NOT scale stroke width by default; a separate "scale" tool does.

**Recommendation**: Offer a default behavior (scale proportionally) with an option to lock stroke thickness. For handwriting, proportional scaling is almost always what users expect.

---

## 5. Property Change on Groups

### Color Change

When changing the color of a mixed-color selection:
- **Every stroke gets the new color** (unanimous across all apps that support this).
- No app offers "shift hue" or "relative color change" for mixed selections.
- The original per-stroke colors are discarded.
- This is an undoable operation.

### Pen Type Change

When changing pen type (e.g., fountain pen to ballpoint):
- **Stroke shapes must be regenerated.** The original sample points (with pressure, tilt data) are preserved, but the outline/geometry is recomputed using the new pen's rendering algorithm.
- This is a computationally expensive operation for large selections.
- GoodNotes users have requested this feature (fountain pen to ballpoint conversion to reduce file size), but it hasn't been implemented yet, suggesting it's non-trivial.
- Notability's "Style" option can change the ink type, implying they store raw input data separately from rendered geometry.

**Implementation implication**: The stroke data model must separate raw input (points with pressure/tilt) from rendered output (outlines, geometry). Changing pen type re-runs the rendering pipeline on the raw input with different parameters.

### Thickness Change

Two possible approaches:

1. **Absolute set** (OneNote, Notability): Set all strokes to the new thickness value. A selection of strokes with thicknesses [1pt, 3pt, 5pt] all become [2pt] after setting to 2pt.

2. **Relative/proportional** (not observed in any handwriting app): Scale each stroke's thickness by a ratio. This would preserve the relative differences between strokes.

**Recommendation**: Absolute set is simpler and matches user expectations in handwriting apps. The user selects text and says "make it thicker" -- they want uniform thickness, not preserved ratios.

---

## 6. Performance Considerations

### Overlay Approach (Recommended)

The dominant rendering strategy for selection uses a **layered canvas architecture**:

```
Layer 0: Background (paper texture, grid lines)
Layer 1: Non-selected strokes (bitmap cache, rarely re-rendered)
Layer 2: Selected strokes (rendered to separate bitmap/canvas)
Layer 3: Selection UI (bounding box, handles, lasso path)
Layer 4: Active drawing layer (current stroke being drawn)
```

**Key principles:**

1. **Separate selected strokes from the main canvas**: When a selection is made, render selected strokes to a dedicated overlay canvas/bitmap. Remove them from the main stroke layer (or mark them as hidden in the main render pass).

2. **Transform the overlay during gestures**: Apply CSS transforms (translate, scale, rotate) to the overlay layer during drag/resize operations. This is GPU-composited and doesn't require re-rendering individual strokes.

3. **Commit on gesture end**: When the user finishes the transform, apply the affine transform to stroke data, re-render all strokes back to the main canvas, and discard the overlay.

4. **Dirty rectangle tracking**: Only re-render tiles that overlap with the selection bounding box (before and after the transform). This is critical for large canvases.

### Selection Rendering Optimizations

1. **Bitmap snapshot for transform preview**: Capture the selected strokes as a bitmap at the start of a transform gesture. Apply CSS/canvas transforms to this bitmap during the gesture. Only re-render strokes from data when the gesture is committed. This avoids expensive per-frame stroke rendering.

2. **Incremental selection feedback**: Use `IncrementalLassoHitTester`-style approach to highlight strokes during lasso drawing, providing instant visual feedback. Change stroke color/opacity or add a highlight overlay rather than re-rendering strokes.

3. **Bounding box pre-filter for hit testing**: Before running point-in-polygon on stroke points, check if the stroke's AABB intersects the lasso's AABB. This eliminates most strokes from consideration.

4. **Spatial indexing**: For large documents, use a spatial index (R-tree, grid-based) to quickly find strokes that might intersect the lasso's bounding box. This reduces hit-testing from O(n) strokes to O(log n) or O(1) amortized.

### Integration with Tile-Based Rendering

For ObsidianPaper's tile-based architecture:

1. **Selection pass**: When strokes are selected, mark affected tiles as needing re-render. Re-render non-selected strokes to tiles. Render selected strokes to a separate overlay.

2. **During transform**: Only the overlay moves/scales -- tiles stay static.

3. **On commit**: Mark tiles affected by both old and new positions as dirty. Re-render all tiles with updated stroke data.

4. **Worker coordination**: Selection state needs to be synchronized to workers if using `WorkerTileScheduler`. The `bumpDocVersion()` + `syncDocumentToWorkers()` pattern applies here.

---

## Summary of Recommended Implementation Strategy

### Phase 1: Core Selection
1. Implement freeform lasso drawing on a dedicated overlay canvas.
2. On lasso completion, run percentage-based point-in-polygon (ray casting) on stroke points.
3. Use 75-80% containment threshold.
4. Apply bounding-box pre-filter for performance.

### Phase 2: Selection UI
1. Show axis-aligned bounding box with 8 handles (4 corner + 4 midpoint).
2. Add rotation handle above top-center.
3. Implement context menu with Cut, Copy, Delete, Duplicate, Color.

### Phase 3: Transform Operations
1. Render selected strokes to overlay bitmap on selection.
2. Apply CSS transforms to overlay during drag/resize gestures.
3. Commit transforms to stroke data on gesture end.
4. Re-render affected tiles.

### Phase 4: Property Changes
1. Color change: absolute replacement on all selected strokes.
2. Thickness change: absolute set (consider relative as future option).
3. Pen type change: regenerate stroke geometry from raw input data (deferred -- complex).

---

## Sources

- [Canvas lasso selection (Tcl/Tk wiki)](https://wiki.tcl-lang.org/page/Canvas+lasso+selection)
- [An Effective Generic Lasso Selection Tool for Multiselection (UiB research paper)](https://bora.uib.no/bora-xmlui/bitstream/handle/1956/22873/report.pdf)
- [GoodNotes: Select content with the Lasso Tool](https://support.goodnotes.com/hc/en-us/articles/10779390143247-Select-content-with-the-Lasso-Tool)
- [GoodNotes: Select, move and edit content](https://support.goodnotes.com/hc/en-us/articles/7353695644175-Select-move-and-edit-content-on-the-page)
- [GoodNotes feedback: Lasso Tool Features](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/32070280-lasso-tool-features-selection-issue-added-featu)
- [GoodNotes feedback: Change line weight of selected strokes](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/42125209-change-line-weight-of-selected-strokes)
- [Notability: Select Tool documentation](https://support.gingerlabs.com/hc/en-us/articles/360018646412-Select-Tool)
- [Apple Notes: Add drawings and handwriting on iPad](https://support.apple.com/guide/ipad/add-drawings-and-handwriting-ipada87a6078/ipados)
- [OneNote: Lasso select ink strokes](https://support.microsoft.com/en-us/office/lasso-select-ink-strokes-in-microsoft-onenote-7422e73c-1d5b-46ef-af73-df7ba140f18f)
- [OneNote: Change color and thickness of ink strokes](https://support.microsoft.com/en-us/office/change-the-color-and-thickness-of-ink-strokes-in-onenote-for-windows-10-77f41d1c-8731-4e8d-8850-5d041a0d6ead)
- [Procreate Handbook: Selections](https://help.procreate.com/procreate/handbook/selections)
- [Procreate Handbook: Transform Uniform](https://help.procreate.com/procreate/handbook/transform/transform-uniform)
- [Targeting and Hit-Testing Ink Strokes (Tablet PC Platform)](https://flylib.com/books/en/1.364.1.44/1/)
- [Microsoft WPF: How to Select Ink from a Custom Control](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/how-to-select-ink-from-a-custom-control)
- [Microsoft WPF: StrokeCollection.GetIncrementalLassoHitTester](https://learn.microsoft.com/en-us/dotnet/api/system.windows.ink.strokecollection.getincrementallassohittester)
- [Wacom Developer Docs: Ink Rendering](https://developer-docs.wacom.com/docs/sdk-for-ink/guides/rendering/)
- [Concepts App: Selection Manual](https://concepts.app/en/ios/manual/selection)
- [Point in Polygon - Wikipedia](https://en.wikipedia.org/wiki/Point_in_polygon)
- [React Flow: Lasso Selection Example](https://reactflow.dev/examples/whiteboard/lasso-selection)
- [Excalidraw: Implementing Lasso Select Discussion](https://github.com/excalidraw/excalidraw/discussions/6494)
- [Penpot: Resizing vs Proportional Scaling](https://penpot.app/courses/block-1/resizing-vs-proportional-scaling/)
- [MDN: Optimizing Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [web.dev: Optimize HTML5 Canvas with Layering](https://developer.ibm.com/tutorials/wa-canvashtml5layering/)
- [web.dev: Improving HTML5 Canvas Performance](https://web.dev/articles/canvas-performance)
