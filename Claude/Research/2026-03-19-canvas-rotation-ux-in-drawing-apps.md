# Canvas/Paper Rotation UX in Drawing and Note-Taking Apps

## Research Date: 2026-03-19

## Overview

This document surveys how popular iPad drawing and note-taking apps handle canvas rotation, covering gesture mechanics, visual indicators, interaction with drawing input, and best practices relevant to implementing rotation in ObsidianPaper.

---

## App-by-App Analysis

### Procreate

**Gesture:** Two-finger pinch-twist. Place two fingers on the canvas and twist them in a circular motion while maintaining the pinch. Rotation is combined with zoom/pan in a single fluid gesture -- you can simultaneously zoom, pan, and rotate.

**Snap Angles:** Rotation snaps at key angles. When Magnetics is toggled on, rotation snaps to more precise degree increments. Users can also rotate selected objects in fixed 45-degree increments via the Transform toolbar.

**Angle Display:** A real-time readout shows the current rotational angle as you adjust, updating continuously during the gesture.

**Reset:** Quick-pinch gesture (rapidly pinch fingers together) resets both zoom and rotation back to default. This is Procreate's "fit to screen" gesture.

**Toggle:** Canvas rotation can be toggled on/off. Users who find accidental rotation annoying can disable it entirely. The toggle can be assigned to a three- or four-finger tap gesture for quick access.

**Input Separation:** When Apple Pencil is active, fingers are reserved for navigation (pan, zoom, rotate). Finger drawing can be disabled in Preferences > Gesture Controls, ensuring the Pencil draws while fingers only navigate. This is key for preventing accidental rotation while writing.

**QuickMenu:** A customizable radial menu can include canvas flip/rotation shortcuts for quick access.

**Key Insight:** Procreate combines rotation with zoom/pan as a unified navigation gesture. Rotation is always relative to the viewport, never altering the actual image data. This is purely a view transform.

---

### GoodNotes

**Canvas Rotation: NOT SUPPORTED.** GoodNotes does not offer free canvas rotation. This is one of the most requested features on their feedback forums.

**What It Offers:** Object rotation via the lasso tool (select objects, then resize/rotate the selection). But there is no way to rotate the overall canvas/page view.

**User Pain Points:**
- Left-handed users cite this as a major limitation
- Users who prefer writing at an angle must physically rotate the iPad
- Some users report switching back to Procreate specifically because of canvas rotation
- Feature requests dating back years remain unaddressed

**Key Insight:** GoodNotes' lack of rotation is considered a significant shortcoming by its user base, particularly for handwriting-focused use cases. This represents a clear opportunity for ObsidianPaper to differentiate.

---

### Notability

**Canvas Rotation: NOT SUPPORTED** at the viewport/page level.

**What It Offers:**
- Selected content rotation via two-finger twist on a lasso selection
- Bounding box rotation handle for precision rotation of selected objects
- Page orientation switching (portrait/landscape) via settings
- Left-handed mode with wrist guard positioning

**Key Insight:** Like GoodNotes, Notability focuses on object-level rotation rather than viewport rotation. The lack of canvas rotation is a gap that handwriting-focused users notice.

---

### Noteshelf (v3)

**Canvas Rotation: PARTIALLY SUPPORTED** -- page orientation can be changed, but rotating a page does NOT rotate the notes on it. This is described by reviewers as "the worst kind of rotation."

**What It Offers:**
- Lasso tool can select and rotate individual handwriting strokes, text boxes, photos, and shapes
- Page orientation changes (but content stays fixed)

**Key Insight:** Noteshelf demonstrates a common pitfall -- offering page-level rotation that doesn't rotate the content defeats the purpose. True canvas rotation needs to be a view transform that rotates everything together.

---

### Photoshop (iPad)

**Gesture:** Two-finger twist to rotate the canvas. Same gesture family as pan/zoom.

**Compass Indicator:** Photoshop displays a prominent compass widget in the center of the screen during rotation:
- A red needle/arrow always points to the actual top of the image
- The compass appears when rotation begins and helps maintain orientation
- The red direction marker is the visual anchor -- it always points "up" relative to the original image orientation
- Users can see how far they've rotated by comparing the red needle's position to vertical

**Snap Angles:** Rotation snaps at 0, 90, 180, and 270 degrees. Both rotation and snapping can be toggled on/off in Settings > Touch.

**Reset:** Quick-pinch gesture resets both rotation and zoom. Rotation is not persistent across sessions (resets to 0 degrees when reopening a file).

**Toggle:** Rotation can be disabled entirely in Settings > Touch.

**Key Insight:** Photoshop's centered compass with a red "north" needle is the gold standard for rotation indicators. It provides clear, non-intrusive orientation feedback. The compass is especially valuable because it appears only during rotation, not permanently on screen.

---

### Concepts App

**Gesture:** Two-finger twist to rotate the infinite canvas. Combined with pan and zoom in a single gesture.

**Status Bar Display:** The current rotation angle is displayed in the status bar (upper right corner). Users can tap+hold the degree value to enter a precise angle via keyboard.

**Snap Angles:** Shape guide rotation snaps at 15-degree increments. Rotation handles show snap target lines every 45 degrees. Letting go while a snap target line is visible snaps to that angle; holding still until the line disappears allows free-angle setting.

**Toggle/Lock:** Canvas rotation can be locked in Settings > Gestures by unchecking "Enable Canvas Rotation." Can also be assigned to two-, three-, or four-finger tap toggles.

**Left-Handed Support:** UI elements (tool wheel) can be dragged to either side of the canvas.

**Key Insight:** Concepts' approach of showing the angle in the status bar with tap-to-edit for precision is elegant for an infinite canvas. The 15-degree snap increment (vs. 45 or 90 degrees) is more granular, which suits technical drawing.

---

### Clip Studio Paint

**Rotation Methods:** Navigator palette slider, scroll bar buttons, keyboard shortcuts, and touch gestures.

**Rotation Increment:** Default rotation is 5-degree increments (configurable in Preferences > Canvas > Angle).

**Navigator Palette:** Shows a thumbnail of the canvas with current rotation, plus rotation slider and buttons.

**Reset:** Multiple reset methods:
- Reset icon on scroll bar or Navigator palette
- View > Rotate/Flip > Reset Rotation menu
- Keyboard shortcut (default Ctrl+1)

**Key Insight:** Clip Studio Paint's approach of having rotation controls in multiple places (navigator, scroll bar, menu, shortcuts) ensures accessibility. The configurable rotation increment is a thoughtful detail.

---

## Common Patterns and Best Practices

### 1. Gesture Design

| Pattern | Details |
|---------|---------|
| **Primary gesture** | Two-finger twist/rotate (universal across all apps that support it) |
| **Combined with** | Pinch-to-zoom and pan in a single gesture |
| **Reset** | Quick-pinch (rapid pinch-in) resets zoom + rotation to default |
| **Toggle** | Option to disable rotation entirely to prevent accidental activation |

### 2. Visual Indicators

| Indicator Type | Used By | Description |
|----------------|---------|-------------|
| **Center compass** | Photoshop | Red needle always points to original "up"; appears during rotation |
| **Angle readout** | Procreate, Concepts | Numeric degree display, updates in real-time during rotation |
| **Status bar angle** | Concepts | Persistent angle display with tap-to-edit for precision |
| **Navigator thumbnail** | Clip Studio Paint | Miniature rotated view showing current orientation |

### 3. Snap Angles

| App | Snap Increments |
|-----|-----------------|
| Photoshop | 0, 90, 180, 270 degrees |
| Procreate | With Magnetics on, more precise increments; 45-degree button in Transform |
| Concepts | 15-degree increments for handles; 45-degree snap lines |
| Clip Studio Paint | 5-degree default increments (configurable) |

### 4. Input Separation (Critical for Apple Pencil)

All apps that support both drawing and rotation follow the same fundamental principle:

- **Apple Pencil = drawing input** (always)
- **Finger touch = navigation** (pan, zoom, rotate)
- **Palm rejection** is handled at the OS level by iPadOS
- **Optional:** Disable finger drawing entirely so fingers are ONLY for navigation

This separation is essential. During an active Apple Pencil stroke, finger touches should be interpreted as navigation gestures (or ignored), never as drawing input. Conversely, when the Pencil is the active tool, two-finger gestures should always navigate, never draw.

### 5. Rotation Scope

| Approach | Apps | Description |
|----------|------|-------------|
| **Viewport rotation** | Procreate, Photoshop, Concepts, Clip Studio Paint | Rotates the VIEW, not the content. Content data stays at 0 degrees. This is purely a rendering transform. |
| **Object rotation** | GoodNotes, Notability, Noteshelf | Rotate selected objects (strokes, images) within the canvas. Not a viewport rotation. |
| **Page orientation** | Noteshelf, Notability | Changes page from portrait to landscape. Not continuous rotation. |

**Best practice: Viewport rotation is the correct approach for a handwriting app.** The canvas data remains axis-aligned; only the rendering transform changes. This means:
- No data modification needed
- No quality loss from repeated rotation
- Ink input coordinates are transformed through the inverse rotation matrix before storage
- The same strokes render identically regardless of viewport rotation

---

## Recommendations for ObsidianPaper

### Must-Have Features

1. **Two-finger twist rotation** -- The universal gesture. Combined with existing pinch-to-zoom and pan. All three should work simultaneously in a single gesture.

2. **Rotation toggle** -- Users must be able to disable rotation entirely. Many users find accidental rotation annoying, especially during palm-resting while writing.

3. **Quick reset** -- Either a rapid-pinch gesture or a UI button to reset rotation to 0 degrees. Consider snapping back to 0 when the angle is within a small threshold (e.g., +/- 5 degrees of 0).

4. **Input coordinate transformation** -- When the canvas is rotated, incoming Apple Pencil coordinates must be transformed through the inverse rotation matrix before being stored as stroke data. Strokes are always stored in unrotated canvas space.

5. **Snap to 0 degrees** -- At minimum, provide a snap/detent at 0 degrees so users can easily return to the default orientation. A small haptic feedback (if available) when snapping to 0 would be ideal.

### Should-Have Features

6. **Rotation indicator** -- A small compass or angle display. Options:
   - **Compass widget** (Photoshop-style): Appears only during rotation gesture; a small indicator with a red/colored needle pointing to original "up." Disappears after gesture ends, keeping UI clean.
   - **Angle badge**: A small persistent or semi-persistent readout (e.g., "23 degrees") in a corner, visible only when rotation != 0 degrees.
   - **Combined**: Show compass during gesture, then fade to a small angle badge if rotation != 0.

7. **Snap at common angles** -- Snap detents at 0, 90, 180, 270 degrees. Consider optional 45-degree snaps.

8. **Rotation persistence** -- Decide whether rotation should persist across sessions. Photoshop resets on reopen; Procreate maintains it. For a note-taking app, persisting the rotation per-page or per-document may be valuable for left-handed users who always write at an angle.

### Nice-to-Have Features

9. **Configurable snap increments** -- Let users choose snap angles (off, 15, 45, 90 degrees).

10. **Preset rotation angles** -- Quick buttons for common angles (e.g., -30 degrees for left-handed, +30 degrees for right-handed tilted writing).

11. **Rotation animation** -- Smooth animated transition when snapping or resetting (spring animation to 0 degrees).

---

## Technical Considerations for ObsidianPaper

### Tile-Based Rendering Impact

With the existing tile-based rendering system, rotation introduces complexity:

- **Tile grid alignment:** Tiles are axis-aligned rectangles. When the viewport is rotated, more tiles may be visible (the rotated viewport rectangle covers a larger axis-aligned bounding box). The tile visibility calculation must account for this.
- **Tile rendering:** Individual tiles can still be rendered unrotated. The rotation is applied when compositing tiles to the screen.
- **Cache invalidation:** Rotation changes should NOT invalidate tile caches -- the tiles contain unrotated content. Only the compositing stage applies the rotation transform.

### Transform Pipeline

The rendering transform pipeline with rotation becomes:

```
Screen coordinates
  -> inverse viewport transform (pan, zoom, rotation)
  -> canvas/document coordinates
```

For input (Apple Pencil):
```
Pointer event (screen coords)
  -> apply inverse of: translate(panX, panY) * scale(zoom) * rotate(angle)
  -> document coordinates (stored in stroke data)
```

For rendering (tiles to screen):
```
Tile content (document coords)
  -> apply: rotate(angle) * scale(zoom) * translate(panX, panY)
  -> screen position
```

### CSS Transform Approach

For the active/prediction canvas overlays that already use CSS transforms during gestures, rotation can be added:

```css
transform: translate(dx, dy) scale(s) rotate(angle deg);
```

The existing gesture transform infrastructure (pan/pinch) can be extended to include rotation. The `clearGestureTransform()` pattern should also clear rotation.

### Worker Sync

Since rotation is purely a view transform, workers do not need to know about it. Tile content is rendered in document space. The main thread applies rotation when compositing tiles to the visible canvas.

---

## Sources

- [GoodNotes Free Rotate Feature Request](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/39999934-free-rotate-turn-of-page)
- [GoodNotes Handwriting Rotation Request](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/4006807-handwriting-and-text-rotation)
- [Procreate Gestures Handbook](https://help.procreate.com/procreate/handbook/interface-gestures/gestures)
- [Procreate Insight: Gestures](https://procreate.com/insight/2022/gestures)
- [12 Essential Procreate Gestures](https://www.makeuseof.com/essential-procreate-gestures/)
- [Procreate Transform Interface and Gestures](https://help.procreate.com/procreate/handbook/transform/transform-interface-gestures)
- [Procreate Snapping Handbook](https://help.procreate.com/procreate/handbook/transform/snapping)
- [Procreate QuickMenu Handbook](https://help.procreate.com/procreate/handbook/interface-gestures/quickmenu)
- [Procreate Apple Pencil Handbook](https://help.procreate.com/procreate/handbook/interface-gestures/pencil)
- [Procreate Canvas Rotation Toggle Discussion](https://folio.procreate.com/discussions/3/6/50509)
- [Procreate Canvas Rotation Snap Discussion](https://folio.procreate.com/discussions/4/10/16960)
- [Procreate Disable Canvas Rotate Discussion](https://folio.procreate.com/discussions/7/25/24002)
- [Notability Select Tool](https://support.gingerlabs.com/hc/en-us/articles/360018646412-Select-Tool)
- [Notability Image Crop and Rotation](https://support.gingerlabs.com/hc/en-us/articles/360029436151-Image-Crop-and-Rotation)
- [Noteshelf 3 Review - Paperless X](https://beingpaperless.com/noteshelf-3-for-the-ipad-complete-review/)
- [Photoshop iPad Rotate Canvas](https://helpx.adobe.com/photoshop/using/pan-zoom-rotate-ipad.html)
- [Photoshop Rotate View Tool Tutorial](https://www.photoshopessentials.com/basics/photoshop-rotate-view-tool/)
- [Photoshop Rotate View Compass Discussion](https://community.adobe.com/t5/photoshop/hiding-the-canvas-rotate-compass-rose/m-p/1544055)
- [Photoshop iPad Refine Edge and Rotate Canvas](https://blog.adobe.com/en/publish/2020/07/27/photoshop-on-ipad-adds-refine-edge-brush-and-rotate-canvas)
- [Concepts App Infinite Canvas Tutorial](https://concepts.app/en/tutorials/working-with-your-infinite-canvas/)
- [Concepts App Settings Manual](https://concepts.app/en/ios/manual/settings)
- [Concepts App Gesture Quick Reference](https://tophatch.helpshift.com/hc/en/3-concepts/faq/23-gesture-quick-reference/)
- [Clip Studio Paint Navigating the Canvas](https://help.clip-studio.com/en-us/manual_en/270_canvas/Navigating_the_canvas.htm)
- [Clip Studio Paint Rotate/Invert](http://www.clip-studio.com/site/gd_en/csp/userguide/csp_userguide/500_menu/500_menu_view_rotation.htm)
- [Clip Studio Paint Canvas Rotation Shortcuts](https://doncorgi.com/blog/rotate-the-canvas-in-clip-studio-paint/)
- [iPad Left-Handed Writing Discussion](https://discussions.apple.com/thread/252337239)
- [Best Note-Taking App for Lefties](https://forums.macrumors.com/threads/best-note-taking-app-for-lefties.1352584/)
- [Astropad: Handwriting Better on iPad](https://astropad.com/blog/how-to-make-handwriting-better-on-ipad-8-tips/)
- [MDN: CanvasRenderingContext2D rotate()](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/rotate)
