# Pen/Brush Presets and Color Selection UX Patterns in Drawing & Note-Taking Apps

**Date:** 2026-03-20
**Purpose:** Research how popular drawing, handwriting, and note-taking apps handle the relationship between pen/brush presets and color selection, to inform ObsidianPaper's preset/color architecture.

---

## Table of Contents

1. [App-by-App Analysis](#app-by-app-analysis)
2. [Comparative Summary Table](#comparative-summary-table)
3. [UX Pattern Taxonomy](#ux-pattern-taxonomy)
4. [General UX Principles](#general-ux-principles)
5. [Recommendations for ObsidianPaper](#recommendations-for-obsidianpaper)

---

## App-by-App Analysis

### 1. Procreate (iPad)

**Category:** Professional illustration / painting app

**Brush and Color Relationship: FULLY SEPARATED**

Procreate treats brush selection and color as entirely independent dimensions. A brush preset defines the shape, grain, behavior, taper, opacity dynamics, pressure response, and many other rendering properties -- but it does **not** store the foreground color. Color is a global, application-level state that applies to whatever brush is currently active.

- **Brush presets** store: shape, grain, dynamics, taper, opacity curve, stabilization, wet mix, color dynamics (relative hue/saturation/brightness shifts), but NOT the actual foreground color.
- **Color** is chosen via the Color Panel, which has five tabs: Disc, Classic, Harmony, Value, and Palettes.
- **Color History:** The last 10 used colors are displayed in a "History" row visible on every Color Panel tab. Each new color bumps the oldest one off. Users can tap "Clear" to reset history.
- **Saved Colors / Palettes:** Users can create unlimited palettes via the Palette Library. Palettes are collections of saved color swatches. One palette is designated as "active" and appears at the bottom of every Color Panel tab for quick access. Palettes can be created, imported, exported, and shared.
- **No pinned colors per se**, but the active palette serves a similar function -- the user's most-used colors are always visible at the bottom of the color panel.
- **Taps to change:**
  - Change brush type: 1 tap (open brush library) + 1 tap (select brush) = **2 taps**
  - Change color: 1 tap (open color panel) + 1 tap (select color) = **2 taps**
  - Change both: **4 taps** (independent operations)
- **Brush remembers its own size/opacity:** Procreate remembers the last-used size and opacity for each brush individually, so switching between brushes restores their previous size/opacity settings. But color remains global.
- **Innovative pattern:** The side slider UI -- brush size and opacity are adjusted via two sliders on the left side of the screen, always accessible without opening any panel. This keeps the most-changed attributes (size/opacity) at zero taps.

**Key Insight:** Procreate's model works because illustrators frequently use many brushes with the same color, or change colors while keeping the same brush. The independence of brush and color allows maximum flexibility for artistic workflows.

**Sources:**
- [Procreate Handbook - Color Interface](https://help.procreate.com/procreate/handbook/colors/colors-interface)
- [Procreate Handbook - Palettes](https://help.procreate.com/procreate/handbook/colors/colors-palettes)
- [Procreate Handbook - Brush Studio Settings](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
- [Procreate Handbook - Brush Libraries](https://help.procreate.com/procreate/handbook/brushes/brush-library)

---

### 2. GoodNotes

**Category:** Note-taking / handwriting app

**Brush and Color Relationship: SEPARATE DIMENSIONS, INDEPENDENTLY SELECTABLE**

GoodNotes treats pen type, thickness, and color as three separate dimensions that can be independently changed.

- **Pen types:** Three options -- Fountain Pen (pressure-sensitive), Ball Point (uniform width), Brush Pen (highly pressure-sensitive). Selected from the toolbar.
- **Thickness:** Displayed as preset slots in the contextual toolbar when a pen is selected. Users tap once to select a thickness, tap again to adjust the value via slider.
- **Color:** 3 color presets shown in the toolbar contextual area for quick selection. Tapping a color selects it; tapping an already-selected color opens the full color picker (palette, color wheel, or HEX input). Users can add extra color preset slots to the toolbar (up to ~15 visible in the expanded color panel).
- **Color presets are per-tool-type:** The pen and highlighter each have their own set of color presets.
- **No color history feature** -- GoodNotes relies on user-curated preset slots rather than automatic history.
- **No bundled presets:** You cannot save a "pen + thickness + color" combination as a single preset. Each dimension is changed separately.
- **Taps to change:**
  - Change pen type: **1 tap** (select pen type in toolbar)
  - Change color: **1 tap** (from the 3 visible presets) or **2 taps** (tap preset, then choose from expanded palette)
  - Change thickness: **1 tap** (from preset slots)
  - Change both color and type: **2 taps** (independent)
- **User feedback:** Many GoodNotes users have requested the ability to save "favorite pens" that bundle type + size + color together, indicating the separate-dimensions model creates friction for users who frequently switch between specific combinations.
- **Tip Sharpness and Pressure Sensitivity** are additional per-pen-type settings accessible through the pen tool options.

**Key Insight:** GoodNotes optimizes for the note-taking use case where users typically use 2-3 colors with the same pen type. The 3-color quick-access slots are well-suited for this. However, power users who need multiple pen+color combos find the lack of bundled presets frustrating.

**Sources:**
- [Using the Pen tool - Goodnotes Support](https://support.goodnotes.com/hc/en-us/articles/7353756785679-Using-the-Pen-tool)
- [Adding colors to the pen and highlighter presets - Goodnotes Support](https://support.goodnotes.com/hc/en-us/articles/7353743265039-Adding-colors-to-the-pen-and-highlighter-presets)
- [Multiple custom pens in the toolbar - GoodNotes Feedback](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/6011012-multiple-custom-pens-in-the-toolbar)

---

### 3. Notability

**Category:** Note-taking / handwriting app

**Brush and Color Relationship: BUNDLED PRESETS (favorites) + SEPARATE DIMENSIONS (main toolbar)**

Notability offers a hybrid approach. The main toolbar lets you change pen type, size, and color independently. But the **Favorite Tools** feature lets you save bundled presets that combine tool type + size + color into a single tap target.

- **Pen types:** Pen, Pencil, Highlighter (each can be duplicated to create multiple instances with different settings).
- **Color system:** 64 color slots in the color menu (32 default + 32 customizable). Up to 8 custom colors for immediate toolbar access. Full color wheel and HEX input available. Color eyedropper tool for sampling from the note.
- **Tool duplication:** Users can duplicate any pen/pencil/highlighter tool and set each copy to a different style and/or color. This is a key innovation -- each duplicated tool is a self-contained bundled preset.
- **Favorites Toolbar:** Snaps to the screen edge. Holds up to 8 favorite tools. Each favorite saves the complete tool state (type + size + color + style). One tap to switch between favorites.
- **Taps to change:**
  - Switch between favorite presets: **1 tap**
  - Change color within current tool: **1 tap** (from visible presets) or **2 taps** (open color picker)
  - Change pen type: **1 tap** (select from toolbar)
  - Full custom adjustment: **2-3 taps** (open tool, adjust settings)
- **Recent/history colors:** No explicit "recent colors" feature, but the 8 custom quick-access color slots serve a similar purpose.
- **Innovative patterns:**
  - Tool duplication as a preset mechanism -- instead of a separate "preset" system, users duplicate the tool itself
  - Individual tool trays -- each tool has its own settings tray so customization doesn't interfere with other tools
  - Favorites toolbar as an always-visible layer of bundled presets on top of the per-dimension editing

**Key Insight:** Notability's hybrid approach is the most flexible among note-taking apps. The favorites toolbar provides 1-tap access to bundled presets, while the main toolbar still allows independent dimension editing. This satisfies both quick-switching and fine-tuning workflows.

**Sources:**
- [Favorite Tools - Notability](https://support.gingerlabs.com/hc/en-us/articles/360048463032-Favorite-Tools)
- [Customize your Toolbox - Notability](https://support.gingerlabs.com/hc/en-us/articles/6272405402650-Customize-your-Toolbox)
- [Custom Colors - Notability](https://support.gingerlabs.com/hc/en-us/articles/360019098351-Custom-Colors)

---

### 4. Apple Notes (iPadOS Markup)

**Category:** Built-in system note-taking app

**Brush and Color Relationship: SEMI-BUNDLED (each tool remembers its last color/size)**

Apple Notes uses a minimal, streamlined approach where each tool remembers its own last-used settings.

- **Tool types:** Pen (ballpoint), Marker, Pencil, Crayon, Fountain Pen (calligraphy), Fill tool, plus Eraser and Ruler.
- **Size:** Each tool offers 5 preset line thicknesses (no custom slider beyond those 5). Selected by tapping the active tool again.
- **Opacity:** Each tool has an opacity slider.
- **Color:** A row of ~5 color circles at the end of the toolbar. The last circle (multicolor) opens the full system color picker (grid, spectrum, sliders, eyedropper). Users can add colors to a secondary palette via the "+" icon.
- **Per-tool memory:** Each tool remembers its last-used size, opacity, and color independently. Switching between tools restores each tool's previous state. This creates an implicit "bundled preset" behavior -- the pen always has "its" color, the pencil always has "its" color, etc.
- **No explicit presets or favorites.** The simplicity is intentional.
- **Taps to change:**
  - Switch tool (and implicitly switch to that tool's remembered color/size): **1 tap**
  - Change color for current tool: **1 tap** (from visible presets)
  - Change size: **1 tap** on active tool to reveal size options, then **1 tap** to select = **2 taps**
  - Open full color picker: **2 taps** (tap multicolor circle, then select)
- **Saved colors:** Users can save colors via "+" in the color picker, building a personal palette that persists across the system.

**Key Insight:** Apple's approach is the simplest model. By having each tool remember its own last settings, users get implicit preset behavior without any explicit preset management UI. This works well for casual/light use but becomes limiting for power users who need more than one color per tool type.

**Sources:**
- [Add drawings and handwriting in Notes on iPad - Apple Support](https://support.apple.com/guide/ipad/add-drawings-and-handwriting-ipada87a6078/ipados)
- [Draw with Notes on your iPhone, iPad, or iPod touch - Apple Support](https://support.apple.com/en-us/108919)
- [Apple Notes iPad Guide - Paperless Humans](https://howto.beingpaperless.com/apple-notes-for-the-ipad-user-guide/)

---

### 5. Samsung Notes

**Category:** Built-in system note-taking app (Android/Samsung)

**Brush and Color Relationship: BUNDLED PRESETS (favorites) + SEPARATE DIMENSIONS (settings panel)**

Samsung Notes follows a similar hybrid pattern to Notability.

- **Pen types:** Multiple pen styles available (fountain pen, calligraphy pen, marker, etc.).
- **Color:** 3 preset colors visible on the toolbar. Users can select which colors occupy these 3 slots, but cannot add more visible slots. Tapping the pen icon opens a full settings panel with color palette, pen style, and size options.
- **Favorites (Star icon):** Users can save specific pen + size + color combinations as favorites by tapping the Star icon after configuring a pen. Favorites are accessible from a dedicated section in the toolbar.
- **Taps to change:**
  - Switch between favorites: **1 tap** (open favorites) + **1 tap** (select) = **2 taps**
  - Change color from toolbar presets: **1 tap**
  - Full pen customization: **2 taps** (double-tap pen icon to open settings)
- **No color history.** Limited to the 3 toolbar presets plus whatever is in the full palette.
- **User complaints:** Many users request more than 3 preset colors on the toolbar, and better favorite pen organization (folders, more slots).

**Key Insight:** Samsung Notes demonstrates the tension between simplicity and power. The 3-color preset limit is a frequent complaint, suggesting that for handwriting apps, users need at minimum 5-8 quick-access colors.

**Sources:**
- [A Complete Guide to Using Samsung Notes App Like a Pro](https://www.guidingtech.com/guide-using-samsung-notes-app/)
- [Samsung Notes favorite pens - Samsung Community](https://eu.community.samsung.com/t5/suggestions/samsung-notes-favorite-pens-and-local-storage-options/idi-p/6325748)
- [More preset colours on Samsung Notes - Samsung Community](https://eu.community.samsung.com/t5/suggestions/more-preset-colours-on-samsung-notes/idi-p/7759795)

---

### 6. Concepts App

**Category:** Professional sketching / design app

**Brush and Color Relationship: FULLY SEPARATED with innovative UI**

Concepts uses a unique Tool Wheel interface that physically separates tool properties into concentric rings.

- **Tool Wheel (outer ring):** 8 customizable tool slots. Each slot holds a specific brush type (e.g., pen, pencil, marker, airbrush). The tool type is fixed per slot.
- **Middle ring:** Shortcuts to brush size, opacity, and smoothness. Each has 4 tool-specific presets (tap to select, or use slider for fine adjustment).
- **Center circle:** Shows current color. Tap to open color wheel; tap-and-hold for color menu.
- **Color is fully independent of the tool.** Changing tools does not change the color. The center color circle persists across tool switches.
- **Color Mixer (below tool wheel):** A scrollable, interactive palette. Users can customize it with saved colors. Has a unique gradient blending feature -- tap+hold and slide to blend between adjacent colors and pick intermediate shades.
- **Three color wheels:** Copic, HSL, and RGB wheels, each with a different approach to color selection.
- **Palettes:** Users can create, save, and import color palettes, including from COLOURlovers. Palettes can be swapped in and out of the Color Mixer strip.
- **Taps to change:**
  - Change tool: **1 tap** on tool wheel
  - Change color: **1 tap** on Color Mixer, or **1 tap** on center circle + **1 tap** on wheel = **2 taps**
  - Change brush size: **1 tap** on middle ring preset, or slide for custom
  - Change everything: All independently accessible, no modal dialogs
- **Innovative patterns:**
  - Concentric ring architecture physically encodes the relationship: tool type (outer) > tool properties (middle) > color (center)
  - The Color Mixer strip is always visible, providing 0-tap color access
  - Tool presets are per-slot (each of the 8 tool wheel positions remembers its own size/opacity)
  - Gradient blending in the Color Mixer lets users discover harmonious colors without opening a color picker

**Key Insight:** Concepts' concentric ring design is the most spatially intuitive approach to separating tool and color concerns. The physical layout communicates the conceptual hierarchy. The always-visible Color Mixer strip is particularly effective for workflows that require frequent color changes.

**Sources:**
- [Setting Up Your Menus, Brushes and Presets - Concepts App](https://concepts.app/en/tutorials/setting-your-menus-brushes-and-presets/)
- [Color Wheel - Concepts for iOS Manual](https://concepts.app/en/ios/manual/colors)
- [Your Workspace - Concepts for iOS Manual](https://concepts.app/en/ios/manual/yourworkspace)
- [How to Create Palettes and Mix Colors - Concepts App](https://concepts.app/en/tutorials/how-create-palettes-and-mix-colors/)

---

### 7. Noteshelf

**Category:** Note-taking / handwriting app

**Brush and Color Relationship: BUNDLED PRESETS (pen rack)**

Noteshelf uses a "pen rack" metaphor where each slot is a fully configured pen (type + color + size).

- **Pen Rack:** Contains 14+ pre-defined pen configurations. Users swipe left on the rack to see more. Each slot in the rack represents a specific pen type + color combination.
- **Favorites toolbar:** A floating mini toolbar that can be positioned anywhere on screen. Users can add favorite pen configurations. Each favorite bundles pen type + color + size.
- **Color Picker:** Enhanced UI with 14 pre-defined colors. Long-press any color to customize it. Supports HEX code input. Can import color palettes from COLOURlovers.
- **Size presets:** Each pen has 3 predefined size options, plus a slider for fine adjustment (0.1mm increments).
- **Taps to change:**
  - Switch to a saved favorite: **1 tap**
  - Change color within current pen: **1 tap** (from preset colors on sidebar)
  - Adjust size: **1 tap** (from 3 size presets)
- **Innovative patterns:**
  - Floating mini toolbar can be moved to any screen position
  - The pen rack metaphor (visual skeuomorphism) makes the bundled nature intuitive
  - Long-press to customize any color slot
  - COLOURlovers palette integration for importing curated palettes

**Key Insight:** Noteshelf's pen rack is the purest "bundled preset" model among note-taking apps. Every slot represents a complete pen configuration. This minimizes the number of taps for common note-taking workflows (switch between a blue pen and a red highlighter = 1 tap each).

**Sources:**
- [Pen rack and Color Picker UI Enhancements - Noteshelf Support](https://noteshelf-support.fluidtouch.biz/hc/en-us/articles/360060742493-Pen-rack-and-Color-Picker-UI-Enhancements)
- [The All New Floating Mini Toolbar - Noteshelf Support](https://noteshelf-support.fluidtouch.biz/hc/en-us/articles/21887313617305-The-All-New-Floating-Mini-Toolbar)
- [Experience hassle free note-taking - Noteshelf Blog](https://medium.com/noteshelf/experience-hassle-free-note-taking-with-the-new-pen-rack-and-color-picker-noteshelf-v8-2-702813d61ff4)

---

### 8. Adobe Fresco

**Category:** Professional painting / illustration app

**Brush and Color Relationship: FULLY SEPARATED**

Adobe Fresco follows the traditional Adobe model of complete separation between brush and color.

- **Brush types:** Three categories -- Pixel brushes (raster), Vector brushes, and Live brushes (oil, watercolor with realistic blending). Extensive brush library organized by categories.
- **Color is global:** Selected via the Color Panel (tap the Color Chip icon). Provides color wheel with hue, saturation, and opacity controls.
- **Color history:** Recent colors are shown at the bottom of the color wheel as swatches. All colors currently used in the document are also displayed.
- **Brush presets:** You can filter and browse pixel brushes by category. However, notably, Adobe Fresco does **not** support saving custom brush presets within the app itself. Users must create custom brushes in Adobe Capture or another Adobe app and sync via Creative Cloud Libraries.
- **Multicolor support:** Live brushes and most pixel brushes support multicolor swatches, where the brush picks up and blends multiple colors.
- **Taps to change:**
  - Change brush: **2 taps** (open brush panel, select brush)
  - Change color: **2 taps** (tap color chip, select color)
  - Recent color: **2 taps** (tap color chip, tap recent swatch)

**Key Insight:** Adobe Fresco's fully separated model follows the established Photoshop paradigm. The "recently used colors" and "colors in document" features are valuable for painting workflows where you're working within a defined palette. The inability to save custom brush presets within the app is a notable limitation.

**Sources:**
- [Draw and paint with pixel brushes - Adobe Fresco](https://helpx.adobe.com/fresco/using/pixel-brushes.html)
- [How to work with colors in Adobe Fresco](https://helpx.adobe.com/fresco/using/colors.html)
- [User interface and settings - Adobe Fresco](https://helpx.adobe.com/fresco/using/getting-started-with-user-interface.html)

---

### 9. Tayasui Sketches

**Category:** Artistic sketching app

**Brush and Color Relationship: SEMI-SEPARATED (each tool remembers its color)**

Tayasui Sketches uses a physical art supplies metaphor with a column of tools on the left.

- **Tool layout:** Brushes and tools displayed vertically on the left side of the screen. Selecting a tool reveals its size and opacity controls on the right.
- **Color selection:** A dedicated color area with an advanced palette offering Square mode, Color Disk, HEX input, and custom palettes.
- **Per-tool color memory:** Each tool appears to remember its last-used color, creating implicit bundled behavior without explicit preset management.
- **Custom palettes:** Users can save and retrieve favorite color palettes. "+" and "-" buttons to add/remove colors from the active palette. Palettes are exportable/importable and compatible with Photoshop swatches.
- **Brush Editor (Pro):** Allows personalizing brushes or creating new ones with real-time preview.
- **Color Mixer:** A physical-style color mixing tool for blending colors.
- **Taps to change:**
  - Change tool: **1 tap** on left column
  - Change color: **1 tap** from visible palette
  - Adjust size/opacity: **1 tap** + drag slider
- **Innovative patterns:**
  - Minimalist, skeuomorphic design that mimics a physical art desk
  - Color Mixer for physically-intuitive color blending
  - HSL color bar for quick tweaking of current color

**Key Insight:** Tayasui Sketches demonstrates that a clean, physical-metaphor interface can be highly effective. The separation of tools (left column) and color (right/bottom area) with size/opacity controls is intuitive and requires minimal taps.

**Sources:**
- [Tools & colors - Tayasui Sketches Help](https://www.tayasui.com/sketches/help/-tools-.html)
- [Tayasui Sketches Pro Features](https://www.tayasui.com/sketches/pro-features.html)

---

### 10. Autodesk Sketchbook

**Category:** Professional drawing / illustration app

**Brush and Color Relationship: FULLY SEPARATED with Color Puck innovation**

Sketchbook uses fully independent brush and color selection, with several distinctive UI elements.

- **Brush Palette:** Customizable palette of brush presets. Each preset defines brush shape, size, opacity, and behavior -- but NOT color.
- **Color Puck:** A floating, draggable color selector. The outer ring adjusts hue; the inner area adjusts saturation/brightness. Tapping the center opens the full Color Wheel and Color Picker. The puck can be repositioned anywhere on screen.
- **Color presets:** 4 customizable preset color slots in the toolbar. Tap to select; tap-and-hold to replace a preset with the current color from the puck.
- **Color Palettes:** Swatches palette (user-created), Copic Color Library (pre-defined), and Layer Editor palette. Custom swatches are created by tap-dragging from the puck onto a palette swatch.
- **No explicit "recent colors" feature,** but the 4 presets + swatches palette serve this purpose.
- **Taps to change:**
  - Change brush: **1 tap** on brush palette slot
  - Change color: **1 tap** on preset, or drag on puck (0 taps, just a gesture)
  - Adjust color via puck: **0 taps** (drag on the always-visible puck)
- **Innovative patterns:**
  - The Color Puck is always visible and adjustable without opening any panel -- true zero-tap color adjustment
  - The puck's concentric ring design (hue outside, saturation/brightness inside) allows quick color tweaking during active drawing
  - Tap-drag gesture for saving colors to palette slots

**Key Insight:** The Color Puck is Sketchbook's standout innovation. By making color adjustment a zero-tap, always-accessible gesture, it reduces the friction of frequent color changes to near zero. This is especially valuable for illustration workflows.

**Sources:**
- [The Color Puck - Sketchbook Help](https://help.sketchbook.com/docs/color-puck)
- [Color Palettes - Sketchbook Help](https://help.sketchbook.com/docs/color-palettes)
- [Using the Brush Palette - Sketchbook Help](https://help.autodesk.com/view/SKETPRO/ENU/?guid=SKETPRO_Help_sb_brushes_use_brush_palette_html)

---

## Comparative Summary Table

| App | Category | Brush-Color Relationship | Color Presets | Color History | Saved Palettes | Taps to Switch Color | Taps to Switch Tool | Bundled Presets? |
|-----|----------|------------------------|---------------|---------------|----------------|---------------------|--------------------|----|
| **Procreate** | Illustration | Fully Separated | Via active palette | Last 10 colors | Yes (unlimited) | 1-2 | 2 | No |
| **GoodNotes** | Note-taking | Separate Dimensions | 3 quick + expandable | No | No (just preset slots) | 1 | 1 | No |
| **Notability** | Note-taking | Hybrid (favorites + separate) | 8 custom + 64 in menu | No | No (slots only) | 1 | 1 | Yes (favorites) |
| **Apple Notes** | Note-taking | Semi-bundled (per-tool memory) | ~5 visible + custom | No | System color picker | 1 | 1 | Implicit (per-tool) |
| **Samsung Notes** | Note-taking | Hybrid (favorites + separate) | 3 visible | No | No | 1 | 1-2 | Yes (favorites) |
| **Concepts** | Design/Sketch | Fully Separated | Color Mixer strip | No | Yes (unlimited) | 1 (mixer) | 1 (wheel) | No |
| **Noteshelf** | Note-taking | Bundled (pen rack) | 14+ in rack | No | Yes (COLOURlovers) | 1 | 1 | Yes (pen rack) |
| **Adobe Fresco** | Illustration | Fully Separated | Via color panel | Recent + in-document | Via CC Libraries | 2 | 2 | No |
| **Tayasui Sketches** | Art/Sketch | Semi-separated (per-tool memory) | Custom palette | No | Yes (exportable) | 1 | 1 | Implicit (per-tool) |
| **Sketchbook** | Illustration | Fully Separated | 4 presets | No | Yes (swatches) | 0-1 (puck) | 1 | No |

---

## UX Pattern Taxonomy

From this research, three distinct architectural patterns emerge:

### Pattern A: Fully Separated (Tool + Color as Independent Global State)
**Used by:** Procreate, Concepts, Adobe Fresco, Sketchbook

**How it works:** The brush/tool defines rendering behavior (shape, pressure response, texture, etc.) and color is a separate global state. Changing the tool does not change the color, and vice versa.

**Strengths:**
- Maximum flexibility: any brush can be any color
- Familiar to artists and illustrators
- Conceptually clean -- tools are "how to draw," color is "what to draw with"
- Brush presets stay manageable (no combinatorial explosion with colors)

**Weaknesses:**
- More taps to make a compound change (different pen type AND different color)
- No quick way to recall a specific brush+color combo
- Better suited for illustration (few tool changes) than note-taking (frequent switches)

### Pattern B: Bundled Presets (Each Preset = Tool + Size + Color)
**Used by:** Noteshelf, Notability (favorites), Samsung Notes (favorites)

**How it works:** Each saved preset slot stores the complete configuration: tool type, size, color, and any other settings. One tap recalls the entire configuration.

**Strengths:**
- Minimum taps for frequent workflows (1 tap to switch to "red highlighter" or "blue fine pen")
- Intuitive for note-taking where users have 3-5 fixed configurations
- No cognitive overhead of remembering which color goes with which tool
- Physical pen analogy -- each preset is like picking up a different pen from a desk

**Weaknesses:**
- Combinatorial explosion: if you want 3 pen types x 4 colors x 2 sizes = 24 presets
- Changing just one dimension (e.g., color) requires either editing the preset or finding another preset
- Less flexible for exploratory/artistic workflows
- Preset management becomes a chore with many configurations

### Pattern C: Semi-Bundled / Per-Tool Memory (Each Tool Remembers Its Last Settings)
**Used by:** Apple Notes, Tayasui Sketches, (partially) Procreate (for size/opacity only)

**How it works:** Each tool slot remembers the last-used size, color, and opacity. Switching tools implicitly restores that tool's previous settings. No explicit "preset" management -- the system just remembers.

**Strengths:**
- Zero-configuration for most users -- "just works"
- Moderate tap count (1 tap to switch tool and implicitly switch color)
- No preset management overhead
- Good enough for users with stable habits (always use pen=blue, highlighter=yellow)

**Weaknesses:**
- Only one "remembered" configuration per tool type
- Accidentally changing a setting changes it for that tool slot permanently
- No way to have multiple configurations of the same tool type (e.g., two different blue pens)
- Limited power-user functionality

### Hybrid: Pattern B + A (Bundled Favorites Layer on Top of Separate Dimensions)
**Used by:** Notability, Samsung Notes

**How it works:** The primary toolbar allows independent dimension editing (change color separately from tool type). A secondary "favorites" layer provides bundled presets for 1-tap recall. Users can work in either mode.

**Strengths:**
- Best of both worlds: quick recall via favorites, fine-tuning via independent controls
- Scales from casual to power-user workflows
- Favorites can be gradually built up as the user discovers their preferred configurations

**Weaknesses:**
- Two systems to learn and manage
- Toolbar can become visually complex
- May be overengineered for simple use cases

---

## General UX Principles

### 1. The Note-Taking vs. Illustration Divide

The research reveals a clear divide between note-taking apps and illustration apps:

- **Note-taking apps** (GoodNotes, Notability, Noteshelf, Apple Notes, Samsung Notes) tend toward bundled or semi-bundled presets because note-takers use a small, fixed set of pen+color combinations and switch between them frequently.
- **Illustration apps** (Procreate, Adobe Fresco, Sketchbook, Concepts) use fully separated brush and color because illustrators frequently change one dimension while keeping the other constant.

**Implication for ObsidianPaper:** As a handwriting/note-taking plugin, ObsidianPaper should lean toward the bundled or hybrid model, since users will likely have 3-8 fixed pen configurations they switch between.

### 2. The Magic Number for Quick-Access Slots

Across all apps studied:
- **3 slots** is too few (Samsung Notes users complain)
- **3-5 slots** is the minimum usable range (GoodNotes, Apple Notes)
- **8 slots** is the sweet spot for note-taking (Notability favorites)
- **14+ slots** works for pen-rack models (Noteshelf) but requires scrolling
- **Unlimited** is appropriate for illustration apps with palette management (Procreate, Concepts)

For a note-taking handwriting app, **6-8 quick-access presets** appears to be the ideal range.

### 3. Color History vs. Saved Colors

Two approaches to managing "recent" colors:
- **Automatic history** (Procreate: last 10, Adobe Fresco: recent + in-document): Colors are automatically tracked. No user action required. Good for illustration where you're discovering colors as you work.
- **Manual save slots** (GoodNotes, Notability, Samsung Notes, Sketchbook): Users explicitly save colors they want to keep. Good for note-taking where you have a fixed, deliberate palette.

**Key finding:** None of the note-taking apps studied implement automatic color history. This is a deliberate choice -- note-takers use intentional, planned color sets, not exploratory color discovery. However, a small "recent colors" row could still be useful for occasional color experimentation without losing the curated palette.

### 4. Taps-to-Action as a Core Metric

The most successful UX patterns minimize taps for the most common actions:

| Action | Best-in-class | Taps |
|--------|--------------|------|
| Switch to a known pen+color combo | Noteshelf pen rack, Notability favorites | **1 tap** |
| Change color (from preset) | GoodNotes, Apple Notes, Concepts Mixer | **1 tap** |
| Adjust size | Apple Notes, Procreate (side slider) | **1 tap or drag** |
| Change color (full picker) | All apps | **2+ taps** |
| Adjust color fine-tuning | Sketchbook Color Puck | **0 taps (drag)** |

The best designs keep the most-frequent action at 1 tap or less.

### 5. Always-Visible vs. Panel-Based Controls

A critical design decision is which controls are always visible vs. hidden behind a panel:

**Always visible (best for frequently changed attributes):**
- Procreate: Size/opacity sliders always on screen edge
- Sketchbook: Color Puck always floating
- Concepts: Color Mixer strip always visible
- Noteshelf: Floating mini toolbar always visible
- GoodNotes: 3 color presets always in toolbar

**Panel-based (acceptable for less-frequently changed attributes):**
- Full color picker (all apps)
- Brush library (all apps)
- Advanced brush settings (all apps)

### 6. The "Preset Includes Everything" vs. "Independent Dimensions" Tradeoff

| Factor | Bundled Presets | Independent Dimensions |
|--------|----------------|----------------------|
| Tap efficiency for compound changes | Better (1 tap) | Worse (2+ taps) |
| Flexibility for partial changes | Worse (must edit preset or find another) | Better (change one dimension freely) |
| Number of presets needed | High (combinatorial) | Low (one set per dimension) |
| Preset management complexity | Higher | Lower |
| Learning curve | Lower (pick up a "pen") | Slightly higher (understand dimensions) |
| Best for | Fixed workflows, note-taking | Exploratory workflows, illustration |

### 7. The "Recently Used" Pattern in Context

Across all apps, there are three levels of color access speed:

1. **Instant (0-1 taps):** Currently visible preset slots, Color Puck, Color Mixer strip
2. **Quick (2 taps):** Recent history, expanded preset panel, tap to open + tap to select
3. **Full (3+ taps):** Color picker, color wheel, HEX input, eyedropper

The best designs ensure that the user's most-used colors are at level 1, recently-explored colors at level 2, and arbitrary color selection at level 3.

---

## Recommendations for ObsidianPaper

Based on this research, here are architectural considerations for ObsidianPaper's preset and color system:

### 1. Adopt the Hybrid Model (Pattern B + A)
Like Notability, offer both bundled presets (for 1-tap switching between common configurations) and independent dimension editing (for fine-tuning). This serves both quick note-taking and occasional customization.

### 2. Preset Architecture
Each preset should bundle: **pen type + size + color + opacity**. This is the natural unit of "a pen I want to grab" in a note-taking context.

### 3. Quick-Access Preset Count
Aim for **6-8 visible preset slots**. This is enough for typical note-taking workflows (2-3 pen colors + 1-2 highlighter colors + 1 pencil) without overwhelming the toolbar.

### 4. Color Management
- Maintain a curated set of **quick-access colors** (user-editable, 8-12 slots)
- Add a small **recent colors** row (last 5-8 colors used) for convenience
- Provide a full color picker for arbitrary color selection
- Consider allowing users to save/name color palettes for different note-taking contexts

### 5. Minimize Taps
- Switching between presets: **1 tap** (always-visible toolbar)
- Changing color within a preset: **1 tap** (from visible recent/saved colors)
- Full color adjustment: **2 taps** (open picker + select)
- Size adjustment: ideally a **drag gesture** (like Procreate's side slider) or **1 tap** on a preset size

### 6. Per-Preset Memory
Like Procreate's per-brush size/opacity memory, each preset slot should remember its own independently-adjusted settings. If a user tweaks the size of "preset 3," that adjustment should persist until explicitly changed.

### 7. Consider a "Recent Colors" Strip
Even though note-taking apps generally don't use automatic color history, a small recent-colors strip (a la Procreate's last 10 or Adobe Fresco's recent swatches) would help users who occasionally experiment with colors without needing to manually save them.
