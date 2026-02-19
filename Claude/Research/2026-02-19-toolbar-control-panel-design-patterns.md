# Toolbar & Control Panel Design Patterns for Stylus Handwriting Apps

**Date:** 2026-02-19
**Purpose:** Research best practices and patterns for toolbar/control panel design in stylus-based handwriting and drawing apps, with focus on iPad/Apple Pencil and applicability to an Obsidian plugin context.

---

## Table of Contents

1. [App-by-App Toolbar Analysis](#1-app-by-app-toolbar-analysis)
2. [Toolbar Placement & Palm Interference](#2-toolbar-placement--palm-interference)
3. [Pen Preset Systems](#3-pen-preset-systems)
4. [Color Picker Patterns](#4-color-picker-patterns)
5. [Selected Preset vs Temporary Overrides](#5-selected-preset-vs-temporary-overrides)
6. [Compact Toolbar Designs for Edge Docking](#6-compact-toolbar-designs-for-edge-docking)
7. [Undo/Redo Placement](#7-undoredo-placement)
8. [Add New Page Patterns](#8-add-new-page-patterns)
9. [Recommendations for ObsidianPaper](#9-recommendations-for-obsidianpaper)

---

## 1. App-by-App Toolbar Analysis

### Procreate

**Layout:** Three-part design optimized for maximum canvas visibility.

- **Top-left toolbar:** Gallery, Actions menu, Adjustments, Selections, Transform -- "editing" tools for complex adjustments.
- **Top-right toolbar:** Paint, Smudge, Erase, Layers, Color selection -- "painting" tools for direct creation.
- **Left sidebar (or right, configurable):** Two vertical sliders (brush size, brush opacity), Modify button (eyedropper/custom shortcut), Undo/Redo arrows.

**Key design decisions:**
- Sidebar is "designed to be in easy reach of your left hand while you paint with your right" but can be flipped for left-handed users.
- Sidebar height is adjustable -- users can drag it to a preferred vertical position.
- Full-screen mode hides the entire interface with a 4-finger tap.
- Double-tapping Apple Pencil switches between current tool and previous tool (quick toggle).
- Tap-and-hold on an unselected tool (Paint/Smudge/Erase) transfers current brush settings to the new tool.

**Color:** Accessed via a color circle in the top-right. Opens a panel with multiple modes: Disc (hue ring + saturation disc), Classic (square + hue bar), Harmony (complementary colors), Value (numeric HSB/RGB), and Palettes. Color History shows last 10 used colors. Active palette displayed at bottom of all color modes.

### GoodNotes 6

**Layout:** Horizontal toolbar, positionable at top or bottom of screen.

- **Default tool order (left to right):** Pen, Eraser, Highlighter, Tape, Shapes, Lasso, Elements, Image/Camera, Ruler, Laser pointer.
- **Undo/Redo:** Positioned at leftmost position on toolbar by default; position can be changed in settings.
- Each pen tool shows 3 quick-select colors in the toolbar's contextual area.
- Tapping a tool twice opens its customization popup (color, thickness, pen type).

**Key design decisions:**
- Toolbar can be positioned at top or bottom of screen.
- Tools can be reordered via drag-and-drop in settings.
- Tools can be hidden/shown -- move between "Visible in Toolbar" and "Hidden Tools" lists.
- Floating menus (Shapes, Writing Tools) can be dragged to snap to any screen edge -- top, bottom, left, or right.
- Custom colors can be added to presets via color wheel or HEX code.

**Limitations:** Users have long requested a "favorite pens" bar for one-click access to saved pen+color+thickness combinations, but this is not fully implemented. Current workaround is the 3-color quick-select per tool.

### Notability

**Layout:** Floating, movable toolbar that snaps to any screen edge.

- **Movable Toolbox:** Can be positioned on any side of the iPad screen. Snaps to edges. Can be tucked away when not needed.
- **Favorites Toolbar:** Holds up to 8 saved tool configurations. Snaps to screen edge. Features auto-minimize -- automatically hides when user starts writing, reappears when needed.
- **Tool customization:** Tools can be duplicated with different styles. For example, two Pen tools: one thin black, one thick blue.

**Three ways to customize tools:**
1. **Presets per tool:** Each tool has its own style tray with customizable presets. Tap a preset for one-tap access to a specific color/size/style.
2. **Toolbox customization:** Choose which tools appear, reorder them, add duplicates with different configurations.
3. **Individual tool styling:** Tap a tool again to adjust color, line weight, and style inline.

**Key design decisions:**
- Each writing tool has a customizable color palette (max 8 colors per tool).
- The auto-minimize feature is critical -- toolbar gets out of the way during active writing and returns when the user pauses or lifts the pencil.
- The movable/edge-snapping design lets users choose the position that works best for their handedness and workflow.

### Apple Notes (iPadOS Markup)

**Layout:** Bottom-anchored horizontal toolbar (the standard PencilKit/Markup toolbar).

- **Tool palette:** Pen, Marker, Pencil, Eraser, Lasso, Ruler. Scrollable if too many tools for screen width.
- **Undo/Redo:** Available as buttons in the toolbar area, plus system gestures (3-finger swipe left for undo, 3-finger swipe right for redo).
- Each tool has independent color and size settings.
- Tap a selected tool again to open its size/opacity/color customization popover.

**Key design decisions:**
- Minimal, unobtrusive design -- tools are small icons in a thin strip.
- PencilKit's `PKToolPicker` on iPad appears as a floating palette that can be repositioned. On iPhone, it's a fixed bottom toolbar.
- Recent iOS/iPadOS versions support customization via `accessoryItem` property.
- Multiple independent `PKToolPicker` instances can exist for different canvases.

### Excalidraw (Web-based canvas app)

**Layout:** Responsive multi-toolbar system.

- **Top toolbar:** Tool selection (shapes, arrows, text, hand, etc.), pen mode toggle, lock, hand tool.
- **Left panel:** Properties/styling for selected elements.
- **Bottom bar (mobile):** Condensed controls split into left (colors, properties, font) and right (undo/redo, duplicate, delete).

**Three responsive variants:**
1. **SelectedShapeActions** (desktop): Full property controls in fieldsets -- stroke, background, fill, roundness, text, opacity, layers, alignment.
2. **CompactShapeActions** (medium screens): Frequently-used controls as standalone buttons, related properties grouped into popovers.
3. **MobileShapeActions** (small screens): Dynamic width calculation. Uses constants (GAP=6px, WIDTH=32px, MIN_ACTIONS=9). Delete shows at 374px, Duplicate at 412px. Buttons that don't fit migrate into a "more" popover.

**Key design decisions:**
- Tool-scoped style persistence -- each tool type maintains its own style cache (color, thickness, etc.). Switching tools restores that tool's last-used styles.
- Selection, Hand, and Eraser tools are excluded from style persistence (they don't have meaningful styles).
- State syncs both on property change and on tool switch, surviving page reloads.

### Miro (Web-based whiteboard)

- Pen tool supports up to 3 presets per tool. Each preset stores color and thickness.
- Double-click a preset to edit it. Click to activate.
- Simple, practical approach for quick switching between a small number of configurations.

---

## 2. Toolbar Placement & Palm Interference

### Core Principles

1. **Palm rejection is handled at the input level**, not the toolbar level. iPadOS distinguishes between stylus tip (intentional) and palm (reject) using touch size and pressure characteristics. This means toolbar buttons respond to finger taps but ignore palm resting on them -- however, accidental finger touches near toolbar edges remain a concern.

2. **Top-positioned toolbars are safer for right-handed users** because the writing hand moves downward and to the right, away from the top. Bottom toolbars risk palm brushing against controls.

3. **Left-edge toolbars suit right-handed users; right-edge toolbars suit left-handed users** -- the non-dominant hand can reach the toolbar while the dominant hand writes.

4. **Floating/movable toolbars are the gold standard** (Notability, Procreate sidebar) because they let users position controls wherever is most comfortable for their handedness and grip style.

### Handedness Considerations

- Approximately 10% of users are left-handed. A fixed toolbar position will disadvantage one group.
- **Best practice:** Allow toolbar position to be configured (left/right/top/bottom), or make it draggable.
- Procreate's approach -- "Right-hand interface" toggle -- is the minimum viable solution.
- Notability's approach -- fully movable toolbar with edge snapping -- is the most flexible.

### Auto-Hide / Auto-Minimize

- Notability's auto-minimize feature is highly valued: the toolbar shrinks or hides when the user starts writing, then reappears when they stop.
- This maximizes canvas space during active writing while keeping tools accessible.
- For an embedded Obsidian plugin where screen space is already constrained, auto-hide behavior is especially important.

### Safe Areas for Toolbar Placement

| Position | Pros | Cons |
|----------|------|------|
| **Top** | Away from writing hand; familiar position; consistent with most apps | Competes with Obsidian's own header/tabs; requires reaching up |
| **Bottom** | Easy thumb access; natural for iOS conventions | Risk of palm interference; competes with mobile keyboards |
| **Left edge** | Good for right-handed users; Procreate-style vertical sliders work well here | Blocks content for left-handed users; narrow space |
| **Right edge** | Good for left-handed users | Blocks content for right-handed users |
| **Floating** | Maximum flexibility | More complex to implement; can obscure content; needs drag handling |

---

## 3. Pen Preset Systems

### Common Patterns Across Apps

**Pattern A: Per-Tool Presets (Notability, GoodNotes)**
- Each tool type (pen, highlighter, eraser) has its own set of style presets.
- A preset stores: color, thickness, sometimes pen type (ballpoint/fountain/brush).
- Tapping a tool opens a tray of presets; tapping a preset applies it instantly.
- Typical preset count: 3-8 per tool.

**Pattern B: Tool Duplication (Notability)**
- Users can add multiple instances of the same tool type to the toolbar, each with different settings.
- Example: Three pen icons in the toolbar -- thin black, medium blue, thick red.
- One-tap switching between configurations without opening any menus.
- This is the fastest interaction model for switching between writing styles.

**Pattern C: Brush Library (Procreate)**
- Deep hierarchy: Library > Category > Brush.
- Each brush has extensive customization (shape, grain, dynamics, pencil settings).
- "Recent" brushes appear at top of library for quick access.
- Designed for artists who need hundreds of brush variants -- overkill for handwriting apps.

**Pattern D: Limited Presets (Miro)**
- 3 presets per tool, each storing color + thickness.
- Double-click to edit, single-click to activate.
- Extremely simple, suitable for apps where drawing is secondary.

### Recommended Pattern for a Handwriting App

The **Tool Duplication** pattern (Pattern B) combined with **Per-Tool Presets** (Pattern A) is the sweet spot for handwriting:

- Keep 3-5 pen presets directly visible in the toolbar (one tap to switch).
- Each preset stores: pen type, color, thickness.
- Tapping an active preset opens its customization popover.
- Tapping an inactive preset switches to it immediately.

---

## 4. Color Picker Patterns

### Two-Level Color Access

Nearly all successful stylus apps use a two-level approach:

**Level 1: Quick Colors (always visible, one tap)**
- 3-8 color swatches displayed directly in the toolbar or tool popover.
- GoodNotes shows 3 colors per pen tool in the toolbar.
- Notability provides up to 8 custom colors per tool.
- Miro bundles color into each of its 3 presets.

**Level 2: Full Color Picker (opened on demand)**
- Accessed by tapping a "more colors" button, a color wheel icon, or a custom color swatch.
- Typical modes offered:
  - **Color wheel/disc** (hue ring + saturation area) -- Procreate, GoodNotes
  - **Grid of preset colors** -- Apple Notes, Notability
  - **HSB/RGB sliders** -- Procreate Value mode
  - **HEX input** -- GoodNotes, Procreate
- Selected colors can be "pinned" to the quick-access palette.

### Procreate's Color Interface (Gold Standard for Full Picker)

- **Disc:** Outer hue ring + inner zoomable saturation disc. Fine touch control.
- **Classic:** Square saturation/brightness area + vertical hue slider.
- **Harmony:** Shows complementary/analogous colors automatically.
- **Value:** Numeric HSB and RGB sliders + HEX input.
- **Palettes:** Named color sets, compact or card view. Importable/exportable.
- **History:** Last 10 colors used, visible across all modes (except Palettes tab).
- **Active palette:** Shown at bottom of Disc/Classic/Harmony/Value tabs.
- **Compare feature:** While picking, shows split circle -- new color vs. most recently used color.

### Recommended Color Picker for a Handwriting Plugin

For a handwriting-focused (not drawing-focused) app, simplicity wins:

1. **Quick palette:** 5-8 color swatches per pen preset, directly in toolbar/popover. This covers 90% of use cases.
2. **Color wheel + HEX:** A single expandable color picker for custom colors. No need for Harmony/Value modes.
3. **Recent colors:** Show last 5-8 colors used. Automatically maintained.
4. **"Add to preset" action:** Let users pin any custom color to their quick palette.

---

## 5. Selected Preset vs Temporary Overrides

### The Problem

When a user has "Pen Preset 1" selected (thin black pen) and temporarily changes the thickness to draw something thicker, what happens when they switch to "Pen Preset 2" and then back to "Pen Preset 1"? Do they get the original thin black pen, or the temporarily modified thick black pen?

### How Apps Handle This

**Approach A: Presets Are Immutable, Active State Is Separate (Excalidraw)**
- Each tool type has a "current active style" that is separate from any saved preset.
- Switching to a preset loads its values into the active style.
- Modifying properties changes the active style, not the preset.
- Switching away and back to the same preset re-loads the preset, discarding overrides.
- **This is the most predictable model.** Users always know what a preset will give them.

**Approach B: Tool State Persists Per-Tool (Procreate)**
- Each tool (Paint, Smudge, Erase) remembers its last-used brush and settings.
- There are no "presets" in the toolbar -- just the last state.
- Switching between Paint/Smudge/Erase restores each tool's independent state.
- Brush selection within a tool is persistent until the user explicitly changes it.

**Approach C: Presets Are Mutable (Some simpler apps)**
- Changing a property while a preset is active modifies the preset itself.
- This can be confusing -- users accidentally modify carefully configured presets.
- Generally considered a poor UX pattern.

**Approach D: Hybrid - Temporary Override with Visual Indicator (Recommended)**
- Presets are stored configurations (immutable by default).
- Selecting a preset loads its values as the active configuration.
- Modifying any property creates a "temporary override" -- the preset button shows a visual indicator (dot, asterisk, modified border) that the current state differs from the saved preset.
- Switching away discards the override and restores the preset when switching back.
- Users can explicitly "save" overrides back to the preset via a long-press or menu action.
- **This balances predictability with flexibility.**

### Recommendation for ObsidianPaper

Use **Approach D (Hybrid)** with these specifics:
- Pen presets are named, saved configurations.
- Selecting a preset loads its exact settings.
- Any modification creates a temporary override, shown via a subtle visual change on the preset indicator (e.g., a small dot or the border color changes).
- Switching to a different preset and back reloads the original saved preset.
- Long-press on a modified preset shows "Save changes" / "Reset to saved" options.

---

## 6. Compact Toolbar Designs for Edge Docking

### Patterns That Work on All Edges

**Vertical Strip (Procreate sidebar style)**
- Two sliders (size + opacity) + a few icon buttons.
- Works on left or right edges.
- Width: ~44-60px (one icon column).
- For top/bottom edges, the same layout rotates to a horizontal strip.

**Pill/Capsule Toolbar (Notability style)**
- Rounded rectangle containing a row (or column) of tool icons.
- Floats over content, snaps to any edge.
- Auto-minimizes to a small handle/tab when writing.
- Typical: 6-10 tool slots, each ~36-44px.

**Segmented Toolbar (GoodNotes style)**
- Fixed horizontal bar spanning the width of the view.
- Divided into sections: tools | undo-redo | zoom/nav.
- Works at top or bottom; not designed for left/right edges.

**Adaptive Toolbar (Excalidraw style)**
- Changes layout based on available space.
- Desktop: Full horizontal bar with all controls visible.
- Tablet: Compact bar with popovers for grouped controls.
- Mobile: Minimal bar with progressive disclosure.

### Design Principles for Compact Toolbars

1. **Minimum touch target size:** 44x44pt (Apple HIG). Never go smaller.
2. **Progressive disclosure:** Show the 5-7 most-used tools directly. Put everything else behind a single tap (popover or expandable section).
3. **Consistent tool positions:** Users build muscle memory. Don't shift tool positions based on context.
4. **Visual grouping:** Separate tool groups with subtle dividers or spacing (e.g., drawing tools | selection tools | undo/redo).
5. **Selected state:** Clear visual indicator for the active tool (filled vs. outline icon, accent color background, underline).
6. **Overflow handling:** If tools exceed available space, use a scrollable strip or a "more" button -- never stack or wrap.

### Compact Toolbar for Obsidian Plugin Context

Obsidian already has its own UI chrome (sidebar, tabs, header). The writing toolbar must:
- Not compete with Obsidian's existing UI elements.
- Be clearly associated with the handwriting canvas, not the broader Obsidian interface.
- Work within a view that might be split-screened (narrow width).

**Recommended approach:** A floating pill toolbar inside the canvas area that:
- Snaps to any edge of the canvas (not the window -- the canvas).
- Collapses to a small handle during active writing (auto-minimize).
- Expands on tap to show tools.
- Defaults to top-center or left-edge, depending on detected handedness.

---

## 7. Undo/Redo Placement

### Patterns Across Apps

| App | Undo/Redo Position | Additional Gesture Support |
|-----|-------------------|---------------------------|
| **Procreate** | Left sidebar, below size/opacity sliders | Tap-and-hold for rapid repeat; 2-finger tap = undo, 3-finger tap = redo |
| **GoodNotes** | Leftmost position on main toolbar (configurable) | Standard iOS 3-finger gestures |
| **Notability** | Part of the movable toolbox | Standard iOS 3-finger gestures |
| **Apple Notes** | In the Markup toolbar | 3-finger swipe left = undo, 3-finger swipe right = redo |
| **Excalidraw** | Right side of bottom mobile bar; top bar on desktop | Ctrl+Z / Ctrl+Shift+Z |
| **Concepts** | On the Tool Wheel (radial menu) | 2-finger tap = undo, 3-finger tap = redo (customizable) |

### Best Practices

1. **Always provide undo/redo buttons** -- gesture-only is not discoverable enough.
2. **Place near but not inside the main tool group** -- visually separate undo/redo from drawing tools to prevent accidental activation.
3. **Support rapid undo** -- tap-and-hold should repeat undo rapidly (Procreate supports up to 250 levels).
4. **Keyboard shortcuts are essential** for users with external keyboards: Cmd+Z / Cmd+Shift+Z.
5. **Position undo near the non-dominant hand** -- left side for right-handed users (Procreate's default).
6. **Consider gesture support:** 2-finger tap for undo, 3-finger tap for redo are becoming conventional on iPad.

### Recommendation for ObsidianPaper

- Place undo/redo as the leftmost (or topmost, if vertical) items in the toolbar, separated from drawing tools by a divider.
- Support Cmd+Z / Cmd+Shift+Z keyboard shortcuts.
- Support tap-and-hold for rapid undo.
- Optionally support 2-finger tap gesture for undo (if technically feasible with the canvas input handling).

---

## 8. Add New Page Patterns

### Patterns Across Apps

**Pattern A: Inline Page Navigation (GoodNotes, Notability)**
- Page thumbnails or a page indicator (e.g., "3/12") displayed outside the toolbar, typically at the bottom or in a sidebar.
- "+" button at the end of the page list or next to the page indicator to add a new page.
- The action is separate from the drawing toolbar -- it's a document-level action, not a tool.

**Pattern B: Continuous Scroll with Auto-Extension (Apple Notes)**
- No discrete "pages" -- the canvas extends infinitely downward.
- New writing area is created automatically as the user writes near the bottom.
- No "add page" button needed.

**Pattern C: Infinite Canvas (Endless Paper, Concepts)**
- No pages at all -- a single infinite 2D canvas.
- Users zoom and pan freely.
- No pagination concept, so no "add page" action.

**Pattern D: Explicit Page Management (Document-style apps)**
- Page list in a sidebar or bottom strip.
- "Add Page" button (+ icon) in the page navigation area.
- Options for page templates (blank, lined, grid, dotted).
- Long-press or context menu for: insert page before/after, duplicate page, delete page.

### For ObsidianPaper (Embedded in Obsidian)

Since Obsidian operates on a per-file basis, the "page" concept maps to either:
1. **Multiple pages within a single .paper file** -- need explicit page navigation and "add page."
2. **One page per file, continuous scroll** -- simpler, aligns with Obsidian's one-note-per-file model.
3. **Infinite canvas per file** -- most flexible but hardest to implement.

**Recommendation:** Start with a continuous vertical scroll model (Pattern B) that automatically extends. This aligns best with Obsidian's scrollable note paradigm. If discrete pages are needed later (e.g., for PDF export with page breaks), add a page indicator and "+" button in a bottom navigation strip separate from the main toolbar.

---

## 9. Recommendations for ObsidianPaper

### Toolbar Architecture

```
+--[Canvas Area]------------------------------------------+
|                                                          |
|  [Floating Pill Toolbar - snaps to any canvas edge]     |
|  +----------------------------------------------------+ |
|  | Undo Redo | Pen1 Pen2 Pen3 Hili Eraser | ... More | |
|  +----------------------------------------------------+ |
|                                                          |
|                   [Writing Area]                         |
|                                                          |
+----------------------------------------------------------+
```

### Key Design Decisions

1. **Floating pill toolbar** that snaps to canvas edges (not window edges). Default: top of canvas area. Auto-minimizes during active writing.

2. **3-5 pen presets** directly visible in the toolbar. Each is a complete configuration (pen type + color + thickness). One tap to switch. Tap active preset to customize. Long-press for save/reset.

3. **Color access:** Quick palette (5-8 colors) in the preset customization popover. "More colors" opens a color wheel + HEX input. Recent colors row maintained automatically.

4. **Undo/Redo** at the left end of the toolbar, separated by a divider. Support Cmd+Z and tap-and-hold for rapid undo.

5. **Eraser** as a distinct tool in the toolbar (not a preset).

6. **Highlighter** as a distinct tool or as a pen type within presets.

7. **"More" button** at the right end for: toolbar position settings, handedness toggle, additional tools (lasso, shapes if needed).

8. **Auto-minimize** during active writing: toolbar collapses to a thin line or small handle. Expands on tap or when stylus is lifted for a period.

9. **Handedness setting** in plugin settings: flips default toolbar position and undo/redo placement.

10. **No "add page" button in v1:** Use continuous vertical scroll. Add page management later if needed.

### Toolbar State Model

```
ToolbarState {
  presets: PenPreset[]           // 3-5 saved configurations
  activePresetIndex: number       // which preset is selected
  activeOverrides: Partial<PenConfig> | null  // temporary changes
  activeTool: 'pen' | 'eraser' | 'highlighter' | 'selection'
  eraserConfig: EraserConfig
  highlighterConfig: HighlighterConfig
  isMinimized: boolean
  position: 'top' | 'bottom' | 'left' | 'right'
}

PenPreset {
  name: string
  penType: 'ballpoint' | 'fountain' | 'felt'
  color: string                   // hex color
  thickness: number
  opacity: number
}
```

### Implementation Priority

1. **Phase 1:** Static horizontal toolbar with 3 pen presets + eraser + undo/redo. Pen presets with tap-to-switch.
2. **Phase 2:** Customization popovers for pen presets (color, thickness). Quick color palette.
3. **Phase 3:** Auto-minimize behavior. Toolbar position settings.
4. **Phase 4:** Full color picker. Preset save/reset with override indicators.
5. **Phase 5:** Floating/draggable toolbar. Edge snapping. Handedness support.

---

## Sources

- [Paperlike - GoodNotes vs Notability Review](https://paperlike.com/blogs/paperlikers-insights/app-review-goodnotes-vs-notability)
- [UX Collective - Designing for iPad Pro and Apple Pencil 2.0](https://uxdesign.cc/how-to-design-for-the-new-ipad-pro-and-apple-pencil-2-0-dbda572cc7d4)
- [Apple HIG - Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)
- [Procreate Handbook - Interface](https://help.procreate.com/procreate/handbook/interface-gestures/interface)
- [Procreate Handbook - Brush Library](https://help.procreate.com/procreate/handbook/brushes/brush-library)
- [Procreate Handbook - Colors Interface](https://help.procreate.com/procreate/handbook/colors/colors-interface)
- [Procreate Handbook - Color Disc](https://help.procreate.com/procreate/handbook/colors/colors-disc)
- [GoodNotes Support - Customize the Toolbar](https://support.goodnotes.com/hc/en-us/articles/8900755183631-Customize-the-toolbar)
- [GoodNotes Support - Using the Pen Tool](https://support.goodnotes.com/hc/en-us/articles/7353756785679-Using-the-Pen-tool)
- [GoodNotes Support - Adding Colors to Presets](https://support.goodnotes.com/hc/en-us/articles/360000630575-Adding-colors-to-the-pen-and-highlighter-presets)
- [Notability - Favorite Tools](https://support.gingerlabs.com/hc/en-us/articles/360048463032-Favorite-Tools)
- [Notability - Three Ways to Customize Your Tools](https://support.gingerlabs.com/hc/en-us/articles/6735217964570-Three-ways-to-customize-your-tools)
- [Notability - Customize Your Toolbox](https://support.gingerlabs.com/hc/en-us/articles/6272405402650-Customize-your-Toolbox)
- [Paperless X - What's New in Notability 14](https://beingpaperless.com/whats-new-in-notability-14/)
- [Apple Support - Add Drawings and Handwriting in Notes](https://support.apple.com/guide/ipad/add-drawings-and-handwriting-ipada87a6078/ipados)
- [Apple Developer - PKToolPicker](https://developer.apple.com/documentation/pencilkit/pktoolpicker)
- [Wesley Matlock - Customizing PencilKit](https://medium.com/@wesleymatlock/customizing-pencilkit-going-past-apples-tool-picker-b82eca7bfbe2)
- [Excalidraw - Actions and Toolbars (DeepWiki)](https://deepwiki.com/excalidraw/excalidraw/4.1-actions-and-toolbars)
- [Excalidraw - Persistent Per-Tool Style Settings PR](https://github.com/excalidraw/excalidraw/pull/10743)
- [Miro Help Center - Pen](https://help.miro.com/hc/en-us/articles/360017730573-Pen)
- [Concepts App - How to Use the Color Picker](https://concepts.app/en/tutorials/how-use-color-picker/)
- [Mobbin - Toolbar UI Design Best Practices](https://mobbin.com/glossary/toolbar)
- [Material Design - Toolbars](https://m3.material.io/components/toolbars/overview)
- [Xournalpp - Tablet Mode Issue Discussion](https://github.com/xournalpp/xournalpp/issues/5869)
- [UX Collective - Inclusivity Guide for Left-Handedness](https://uxdesign.cc/inclusivity-guide-usability-design-for-left-handedness-101-2bc0265ae21e)
- [IXD@Pratt - Design Critique: Notability](https://ixd.prattsi.org/2026/02/design-critique-notability-ipad-app-3/)
- [Concepts Help Center - Undo or Redo](https://tophatch.helpshift.com/hc/en/3-concepts/faq/115-how-do-i-undo-or-redo-an-action/)
