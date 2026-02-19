# Control Panel Redesign Research

**Date:** 2026-02-19
**Purpose:** Research for redesigning the ObsidianPaper toolbar/control panel system with custom pens, configurable placement, quick color changes, page management, and undo/redo buttons.

---

## Current State Analysis

### What Exists Today

**ToolPalette** (`src/view/ToolPalette.ts`) — A monolithic DOM overlay positioned at bottom-center of the canvas. Contains:
- Pen/Eraser toggle buttons
- Pen type dropdown (6 types: ballpoint, brush, felt-tip, pencil, fountain, highlighter)
- Color swatches (10 semantic colors with light/dark theme pairs)
- Width slider (0.5–30)
- Nib settings row (fountain pen only): angle, aspect, pressure sliders

**Problems with current design:**
1. **Bottom placement** — highest palm interference zone for right-handed users
2. **No custom pen presets** — users must manually reconfigure pen type + color + width every time
3. **Monolithic** — all controls always visible, cluttered
4. **Not repositionable** — fixed bottom-center only
5. **No undo/redo buttons** — keyboard shortcuts exist (Cmd+Z/Cmd+Shift+Z) but no touch-friendly buttons
6. **No add page button** — must use command palette
7. **Color system is ID-based only** — 10 fixed semantic colors, no custom hex colors

### What Exists That We Build On

- **UndoManager** (`src/document/UndoManager.ts`) — Complete dual-stack undo/redo with `canUndo()`/`canRedo()` state queries
- **PenConfigs** (`src/stroke/PenConfigs.ts`) — 6 pen types with full config: pressureWidthRange, opacity, thinning, smoothing, streamline, taper, tiltSensitivity, pressureCurve, nibAngle/nibThickness, barrelRotation, highlighterMode
- **Page system** — Full page model with `addPage()`, `scrollToPage()`, layout engine
- **Color system** — `SemanticColor` with light/dark pairs, `resolveColor()` already handles raw hex fallback
- **Settings persistence** — `PaperSettings` with `loadData()`/`saveData()` via Obsidian API

---

## UX Research: Best Practices from Leading Apps

### Toolbar Placement

| Position | Pros | Cons |
|----------|------|------|
| **Top** | Away from writing hand; familiar; consistent with most apps | Competes with Obsidian header/tabs |
| **Bottom** | Easy thumb access | **Highest palm interference risk** |
| **Left** | Good for right-handed users (non-dominant hand) | Blocks content for left-handed users |
| **Right** | Good for left-handed users | Blocks content for right-handed users |

**Industry consensus:** Floating/movable toolbars are the gold standard (Notability, Procreate). At minimum, support top/bottom/left/right docking.

**Key insight from Notability:** Auto-minimize during active writing is critical — the toolbar shrinks or hides when the user starts writing, then reappears when they stop. This maximizes canvas space while keeping tools accessible.

### Pen Preset Systems

**The winning pattern** (used by Notability + GoodNotes combined):

1. **3–5 pen presets visible directly in the toolbar** — each stores a complete configuration (pen type + color + width + all pen-specific settings)
2. **Single tap** to switch between presets
3. **Tap active preset** to open customization popover
4. **Tool duplication** — multiple instances of the same pen type with different settings (e.g., two fountain pens: thin black + thick blue)

### Color Picker: Two-Level Access

Nearly all successful apps use this pattern:

- **Level 1 (quick colors):** 5–8 color swatches visible in the pen customization popover. Covers 90% of use cases.
- **Level 2 (full picker):** Color wheel + HEX input, opened on demand. Plus a "recent colors" row (last 5–8 colors used).

### Preset vs. Temporary Override Model

**Recommended: Hybrid approach (Approach D)**

1. Pen presets are saved, named configurations (immutable by default)
2. Selecting a preset loads its exact settings
3. Changing any setting (e.g., color) creates a **temporary override** — the preset button shows a visual indicator (dot, modified border)
4. The preset deselects visually to signal "custom state"
5. User can: create a new preset from current settings, update the selected preset, or just keep writing with the temporary config
6. Switching to a different preset and back reloads the **saved** preset (discards overrides)

This matches exactly what the user requested: "selecting a pen updates all pen settings, but the user can then change those settings. If they do, the selected pen deselects."

### Undo/Redo Button Placement

**Best practices:**
- Place at the **start** of the toolbar (leftmost for horizontal, topmost for vertical)
- Visually separate from drawing tools with a divider
- Support tap-and-hold for rapid undo
- Disable visually when stack is empty
- Keep keyboard shortcuts (Cmd+Z / Cmd+Shift+Z) — already implemented

### Add Page

For our page-based system, a `+` button at the end of the toolbar or in a separate area makes sense. Since we already have pages (not infinite canvas), this is straightforward — just needs a touch target.

---

## Proposed Architecture

### Data Model: Custom Pen Presets

```typescript
interface PenPreset {
  id: string;                    // UUID
  name: string;                  // User-editable name
  penType: PenType;              // ballpoint, brush, felt-tip, pencil, fountain, highlighter
  colorId: string;               // Semantic ID or hex color
  width: number;                 // Stroke width
  smoothing: number;             // 0–1
  // Pen-type-specific settings (only relevant ones stored)
  nibAngle?: number;             // Fountain: radians
  nibThickness?: number;         // Fountain: 0–1 aspect ratio
  nibPressure?: number;          // Fountain: pressure sensitivity
  pressureSensitivity?: number;  // Global pressure multiplier
}
```

Stored in `PaperSettings.penPresets: PenPreset[]` (persisted via Obsidian's `saveData()`).

Default presets (out of the box):
1. Black ballpoint, width 2
2. Blue fountain, width 6
3. Red felt-tip, width 4
4. Yellow highlighter, width 24

### Toolbar State Model

```typescript
interface ToolbarState {
  // Preset selection
  presets: PenPreset[];
  activePresetId: string | null;   // null = custom/overridden state

  // Active pen configuration (what's actually being used)
  activePenConfig: {
    penType: PenType;
    colorId: string;
    width: number;
    smoothing: number;
    nibAngle: number;
    nibThickness: number;
    nibPressure: number;
    pressureSensitivity: number;
  };

  // Tool mode
  activeTool: 'pen' | 'eraser';

  // Toolbar UI state
  position: 'top' | 'bottom' | 'left' | 'right';
  isMinimized: boolean;
  isExpanded: boolean;  // popover open
}
```

### Toolbar Layout (Horizontal — Top or Bottom)

```
┌─────────────────────────────────────────────────────────┐
│ ↩ ↪ │ [Pen1] [Pen2] [Pen3] [Pen4] │ [Eraser] │ [+pg] [⋯] │
└─────────────────────────────────────────────────────────┘
       ↑                                          ↑
   Undo/Redo                                  More menu
```

- **Undo/Redo:** Left side, always visible. Grayed when stack empty.
- **Pen presets:** Center. Each shows a small color dot + pen icon. Active preset highlighted. Modified preset shows indicator.
- **Eraser:** Separate from pens.
- **Add page (+pg):** Quick action button.
- **More menu (⋯):** Opens panel for: toolbar position, manage presets, full settings.

### Toolbar Layout (Vertical — Left or Right)

```
┌───┐
│ ↩ │  Undo
│ ↪ │  Redo
│───│
│ P1│  Pen preset 1
│ P2│  Pen preset 2
│ P3│  Pen preset 3
│ P4│  Pen preset 4
│───│
│ Er│  Eraser
│───│
│+pg│  Add page
│ ⋯ │  More
└───┘
```

### Pen Customization Popover

When tapping an active preset (or after modifying settings such that preset deselects):

```
┌─────────────────────────────┐
│ Pen Type: [▾ Fountain     ] │
│                             │
│ Color:                      │
│ ● ● ● ● ● ● ● ● ● ●      │  ← Quick palette (10 semantic)
│ [Custom color...]           │  ← Opens full color picker
│                             │
│ Width:    ━━━━━●━━━  [6.0] │
│ Angle:    ━━●━━━━━━  [30°] │  ← Only for fountain
│ Aspect:   ━●━━━━━━━  [0.25]│  ← Only for fountain
│ Pressure: ━━━●━━━━━  [0.50]│  ← Only for fountain
│ Smoothing:━━━●━━━━━  [0.50]│
│                             │
│ [Save as New] [Update Pen]  │  ← Only when modified
│ [Edit Presets...]           │
└─────────────────────────────┘
```

### Custom Color Picker (Level 2)

When "Custom color..." is tapped in the popover:

```
┌─────────────────────────────┐
│ ← Back                      │
│                             │
│    ╭──────────────────╮     │
│    │  Color Wheel      │     │
│    │  (Hue ring +      │     │
│    │   Saturation disc)│     │
│    ╰──────────────────╯     │
│                             │
│ HEX: [#2563eb           ]  │
│                             │
│ Recent:                     │
│ ● ● ● ● ● ● ● ●           │  ← Last 8 used colors
│                             │
│ [Use Color]                 │
└─────────────────────────────┘
```

### Preset Management Panel

Accessed from "Edit Presets..." or the More menu:

```
┌─────────────────────────────┐
│ Manage Pen Presets           │
│                             │
│ ≡ [●] Black Ballpoint    ✕ │  ← Drag to reorder, delete
│ ≡ [●] Blue Fountain      ✕ │
│ ≡ [●] Red Felt-tip       ✕ │
│ ≡ [●] Yellow Highlighter ✕ │
│                             │
│ [+ Add Preset]              │
│                             │
│ Tap a preset to edit name   │
│ and settings                │
└─────────────────────────────┘
```

### Auto-Minimize Behavior

1. When stylus touches canvas → toolbar minimizes to a thin line/handle (after ~200ms delay)
2. When stylus lifts and stays lifted for ~500ms → toolbar restores
3. Tap the minimized handle → force expand
4. Setting to disable auto-minimize

### Toolbar Position Setting

Added to `PaperSettings`:
```typescript
toolbarPosition: 'top' | 'bottom' | 'left' | 'right';  // default: 'top'
autoMinimizeToolbar: boolean;  // default: true
```

Also accessible from the toolbar's More menu for quick changes.

---

## Color System Expansion

The current `SemanticColor` system (10 colors with light/dark pairs) is excellent and should be kept. We need to **extend** it to also support custom hex colors:

1. **Keep semantic colors** as the default quick palette — they're theme-aware
2. **Add custom color support** — stored as raw hex strings
3. **Recent colors** — automatically track last 8 used colors (both semantic IDs and hex values)
4. `resolveColor()` already handles hex fallback, so this mostly works today

The `PenPreset.colorId` field already accepts either a semantic ID or a hex value.

---

## Settings That Apply Per-Pen vs. Globally

Per-pen preset settings (stored in each `PenPreset`):
- `penType`, `colorId`, `width`, `smoothing`
- `nibAngle`, `nibThickness`, `nibPressure` (fountain-specific)

Global settings (remain in `PaperSettings`):
- `pressureSensitivity` (hardware-level, same for all pens)
- `useBarrelRotation` (hardware feature toggle)
- `palmRejection`, `fingerAction`
- `toolbarPosition`, `autoMinimizeToolbar`
- Page defaults, file settings, etc.

**Open question:** Should `pressureSensitivity` be per-pen? Some users might want a light-pressure fountain pen and a firm-pressure ballpoint. Recommendation: keep global for now, consider per-pen later.

---

## What PenConfig Properties Should Be Exposed Per-Preset

The current `PenConfig` has many properties. Not all should be user-configurable:

| Property | User-Configurable? | Notes |
|----------|-------------------|-------|
| `baseWidth` | Yes → `width` in preset | Core setting |
| `pressureWidthRange` | No | Defined by pen type |
| `pressureOpacityRange` | No | Defined by pen type |
| `thinning` | No | Defined by pen type |
| `smoothing` | Yes | User preference |
| `streamline` | No | Defined by pen type |
| `taperStart/End` | No | Defined by pen type |
| `tiltSensitivity` | No | Defined by pen type |
| `pressureCurve` | No | Defined by pen type (or global) |
| `baseOpacity` | No | Defined by pen type |
| `highlighterMode` | No | Defined by pen type |
| `nibAngle` | Yes (fountain only) | Key fountain pen parameter |
| `nibThickness` | Yes (fountain only) | Key fountain pen parameter |
| `useBarrelRotation` | No (global setting) | Hardware feature |

So per-preset user controls are: **pen type, color, width, smoothing, nib angle, nib thickness, nib pressure**.

This matches the user's request: "a fountain pen would have: Color, Size, Angle, Aspect, Pressure, Smoothing."

---

## Implementation Approach

### Component Architecture

Replace the monolithic `ToolPalette` with a modular system:

```
Toolbar (container)
├── UndoRedoGroup
│   ├── UndoButton
│   └── RedoButton
├── PenPresetGroup
│   ├── PresetButton (× N, one per preset)
│   └── ActivePresetIndicator
├── EraserButton
├── AddPageButton
├── MoreMenuButton
└── Popovers (rendered on demand)
    ├── PenCustomizationPopover
    │   ├── PenTypeSelector
    │   ├── QuickColorPalette
    │   ├── WidthSlider
    │   ├── NibControls (conditional)
    │   ├── SmoothingSlider
    │   └── PresetActions (save/update/edit)
    ├── FullColorPicker
    │   ├── ColorWheel
    │   ├── HexInput
    │   └── RecentColors
    └── MoreMenu
        ├── ToolbarPositionSelector
        └── ManagePresetsLink
```

### Rendering Approach

Keep DOM-based (not canvas-rendered) — this is correct for UI controls that need accessibility, touch events, and Obsidian API integration. Use Obsidian's `createEl()` API consistently.

### CSS Architecture

Use CSS custom properties for the toolbar position logic:
- `.paper-toolbar[data-position="top"]` — horizontal, top of canvas
- `.paper-toolbar[data-position="bottom"]` — horizontal, bottom of canvas
- `.paper-toolbar[data-position="left"]` — vertical, left of canvas
- `.paper-toolbar[data-position="right"]` — vertical, right of canvas

The same HTML structure works for all positions — CSS handles the layout direction (flexbox `flex-direction: row` vs `column`).

### Migration Path

1. The existing `ToolPaletteState` and `ToolPaletteCallbacks` interfaces are close to what we need — extend rather than replace
2. Default presets should mirror current defaults so existing users see familiar behavior
3. Documents store `PenStyle` per stroke — this is unaffected by toolbar changes
4. Settings migration: add `penPresets` array to `PaperSettings`, `mergeSettings()` handles missing fields gracefully

---

## Key Design Decisions to Make

1. **Maximum number of presets** — Recommend 3–8 (toolbar space). More can exist but only N visible in the toolbar.
2. **Preset naming** — Auto-generate from type+color (e.g., "Blue Fountain") or let users name them?
3. **Custom color in dark mode** — Custom hex colors won't auto-adapt to themes. Show a warning? Or let it be?
4. **Eraser configuration** — Should eraser have size config in the popover too? Currently it's a simple toggle.
5. **Highlighter** — Treat as a pen type within presets (current approach), or as a separate tool like eraser?

---

## Sources

- Procreate Handbook: Interface, Brush Library, Colors Interface
- GoodNotes Support: Customize Toolbar, Pen Tool, Color Presets
- Notability: Favorite Tools, Three Ways to Customize, Customize Toolbox
- Apple Developer: PKToolPicker documentation
- Excalidraw: Actions/Toolbars architecture, per-tool style persistence PR
- Apple HIG: Designing for iPadOS (44pt minimum touch targets)
- Full source list in companion research: `Claude/Research/2026-02-19-toolbar-control-panel-design-patterns.md`
