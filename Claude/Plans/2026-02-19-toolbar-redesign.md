# Toolbar Redesign: Modular Control Panel with Pen Presets

## Context

The current `ToolPalette` (`src/view/ToolPalette.ts`, 307 lines) is a monolithic bottom-center overlay with all controls always visible. It has several problems: bottom placement causes palm interference, no custom pen presets exist, there's no undo/redo or add-page buttons, and it can't be repositioned. This plan replaces it with a modular, repositionable toolbar supporting custom pen presets (up to 20, scrollable after 8), auto-minimize during writing, undo/redo buttons, add-page button, and a customization popover with hex color input.

## New File Structure

```
src/view/toolbar/
  ToolbarTypes.ts           -- Interfaces (PenPreset, ToolbarPosition, ToolbarState, callbacks)
  Toolbar.ts                -- Main toolbar container (orchestrator)
  PresetStrip.ts            -- Scrollable preset buttons region
  PresetButton.ts           -- Individual preset color swatch button
  ToolbarButton.ts          -- Generic icon/text button (undo, redo, eraser, add-page, more)
  CustomizePopover.ts       -- Pen customization floating panel
  AutoMinimizer.ts          -- Auto-minimize state machine
  PresetManager.ts          -- CRUD operations on presets array
  PresetManager.test.ts
  AutoMinimizer.test.ts
```

## Files Modified

- `src/settings/PaperSettings.ts` — Add `penPresets`, `activePresetId`, `toolbarPosition` fields
- `src/view/PaperView.ts` — Replace `ToolPalette` with `Toolbar`, wire new callbacks, add stroke start/end hooks
- `src/main.ts` — Add settings-push callback to PaperView
- `styles.css` — Replace `.paper-tool-palette` CSS with new toolbar styles

## Files Removed

- `src/view/ToolPalette.ts` — Replaced entirely

---

## Phase 1: Data Model & PresetManager

### 1a. Create `src/view/toolbar/ToolbarTypes.ts`

```typescript
export interface PenPreset {
  id: string;              // UUID
  name: string;            // User-editable display name
  penType: PenType;
  colorId: string;         // Semantic ID ("ink-black") or "#hex"
  width: number;
  smoothing: number;       // 0-1
  nibAngle?: number;       // Radians, fountain only
  nibThickness?: number;   // 0-1, fountain only
  nibPressure?: number;    // 0-1, fountain only
}

export type ToolbarPosition = "top" | "bottom" | "left" | "right";
export type ActiveTool = "pen" | "eraser";

export interface ToolbarState {
  activeTool: ActiveTool;
  activePresetId: string | null;  // null = custom/no preset selected
  penType: PenType;
  colorId: string;
  width: number;
  smoothing: number;
  nibAngle: number;
  nibThickness: number;
  nibPressure: number;
}

export interface ToolbarCallbacks {
  onToolChange: (tool: ActiveTool) => void;
  onPenSettingsChange: (state: ToolbarState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddPage: () => void;
  onPresetSave: (presets: PenPreset[], activePresetId: string | null) => void;
  onPositionChange: (position: ToolbarPosition) => void;
}

export interface ToolbarQueries {
  canUndo: () => boolean;
  canRedo: () => boolean;
  pageCount: () => number;
}
```

### 1b. Update `src/settings/PaperSettings.ts`

Add to `PaperSettings` interface:
- `penPresets: PenPreset[]`
- `activePresetId: string | null`
- `toolbarPosition: ToolbarPosition`

Add `DEFAULT_PRESETS` constant with 5 built-in presets:
1. "Black Ballpoint" — ballpoint, ink-black, width 2, smoothing 0.3
2. "Blue Ballpoint" — ballpoint, ink-blue, width 2, smoothing 0.3
3. "Red Felt Tip" — felt-tip, ink-red, width 3, smoothing 0.5
4. "Pencil" — pencil, ink-gray, width 3, smoothing 0.4
5. "Yellow Highlighter" — highlighter, `#FFE066`, width 24, smoothing 0.8

Add to `DEFAULT_SETTINGS`:
- `penPresets: DEFAULT_PRESETS`
- `activePresetId: "preset-ballpoint-black"`
- `toolbarPosition: "top"` (safer than bottom for palm avoidance)

Migration: `mergeSettings()` already does `{ ...DEFAULT_SETTINGS, ...loaded }` — old users get new defaults automatically.

### 1c. Create `src/view/toolbar/PresetManager.ts`

Pure logic, no DOM. Methods:
- `getPresets()`, `getPreset(id)`
- `addPreset(preset)` — generates UUID, enforces 20-preset max
- `updatePreset(id, changes)` — partial update
- `deletePreset(id)` — returns boolean
- `reorderPreset(id, newIndex)`
- `createFromState(name, state)` — creates PenPreset from ToolbarState
- `findMatchingPreset(state)` — exact match check (for auto-detecting if manual changes match an existing preset)

### 1d. Create `src/view/toolbar/PresetManager.test.ts`

Test CRUD, max limit, reorder, match detection.

---

## Phase 2: Toolbar Shell (Replaces ToolPalette)

### 2a. Create `src/view/toolbar/ToolbarButton.ts`

Simple DOM button: `createEl("button", { cls: "paper-toolbar__btn" })`. 44x44 touch targets. `setActive()`, `setDisabled()`, `destroy()`.

### 2b. Create `src/view/toolbar/Toolbar.ts`

Main orchestrator. Constructor takes `container`, `callbacks`, `queries`, `initialState`, `presets`, `position`, `isDarkMode`.

DOM layout:
```
div.paper-toolbar[data-position="top"]
├── button (undo)
├── button (redo)
├── div.paper-toolbar__separator
├── div.paper-toolbar__presets (PresetStrip, Phase 3)
├── div.paper-toolbar__separator
├── button (eraser, toggle)
├── div.paper-toolbar__separator
├── button (add page)
├── button (more/customize)
└── div.paper-toolbar__handle (only visible when minimized)
```

Public API:
- `setState(partial)` — update pen state, refresh preset selection
- `setDarkMode(isDark)` — propagate to presets and popover
- `setPosition(position)` — update `data-position` attribute
- `refreshUndoRedo()` — re-query `canUndo()`/`canRedo()`, update button disabled state
- `notifyStrokeStart()` / `notifyStrokeEnd()` — auto-minimize hooks
- `destroy()` — remove element, clean up popover

### 2c. Wire into PaperView (`src/view/PaperView.ts`)

Replace `ToolPalette` references:
- Import `Toolbar` and toolbar types instead of `ToolPalette`
- Change `private toolPalette: ToolPalette | null` → `private toolbar: Toolbar | null`
- In `onOpen()`: create `Toolbar` with `createToolbarCallbacks()`, `createToolbarQueries()`, initial state from settings
- New `createToolbarCallbacks()` method replacing `createToolPaletteCallbacks()`:
  - `onPenSettingsChange` updates all pen state fields at once (replacing 7 individual callbacks)
  - `onUndo` → `this.undo()`
  - `onRedo` → `this.redo()`
  - `onAddPage` → `this.addPage()`
  - `onPresetSave` → update `this.settings.penPresets` and push settings
  - `onPositionChange` → update `this.settings.toolbarPosition`, call `toolbar.setPosition()`
- New `createToolbarQueries()` method:
  - `canUndo: () => this.undoManager.canUndo()`
  - `canRedo: () => this.undoManager.canRedo()`
  - `pageCount: () => this.document.pages.length`
- After undo/redo operations: call `this.toolbar?.refreshUndoRedo()`
- In `onStrokeStart`/`onStrokeEnd` callbacks: call `this.toolbar?.notifyStrokeStart()`/`notifyStrokeEnd()`
- In `onClose()`: `this.toolbar?.destroy()`
- In theme change: `this.toolbar?.setDarkMode(isDark)`
- In `setSettings()`: `this.toolbar?.setState(...)` with settings values

### 2d. Update `src/main.ts`

Add settings-push callback so PaperView can persist preset/position changes:
```typescript
this.registerView(VIEW_TYPE_PAPER, (leaf) => {
  const view = new PaperView(leaf);
  view.setSettings(this.settings);
  view.onSettingsChange = (changes) => {
    Object.assign(this.settings, changes);
    void this.saveSettings();
    this.notifySettingsListeners();
  };
  return view;
});
```

Add `onSettingsChange` callback field to `PaperView`.

### 2e. Update `styles.css`

Remove all `.paper-tool-palette` styles (lines 92-216). Add new toolbar CSS:

**Position variants** via `data-position` attribute:
- `top`: `top: 12px; left: 50%; transform: translateX(-50%); flex-direction: row;`
- `bottom`: `bottom: 12px; left: 50%; transform: translateX(-50%); flex-direction: row;`
- `left`: `left: 12px; top: 50%; transform: translateY(-50%); flex-direction: column;`
- `right`: `right: 12px; top: 50%; transform: translateY(-50%); flex-direction: column;`

**Minimized state**: `.is-minimized` hides all children except `.paper-toolbar__handle`.

**Separators**: 1px×24px vertical for horizontal toolbar, 24px×1px for vertical. Adapts via `data-position` selectors.

**Buttons**: 44×44 min touch targets, `.is-active` for accent highlight, `.is-disabled` for grayed out.

### 2f. Delete `src/view/ToolPalette.ts`

---

## Phase 3: Preset Strip

### 3a. Create `src/view/toolbar/PresetButton.ts`

Circular color swatch button. Shows resolved color via `resolveColor(colorId, isDarkMode)`. Active state = ring border. Long-press (500ms hold) triggers customization popover for that preset. Highlighter presets render with reduced opacity.

### 3b. Create `src/view/toolbar/PresetStrip.ts`

Scrollable flex container of `PresetButton` instances. CSS:
- Horizontal: `max-width: 360px; overflow-x: auto; scrollbar-width: none;` (fits ~8 at 44px)
- Vertical: `max-height: 352px; overflow-y: auto;`

Methods: `setActivePreset(id | null)`, `updatePresets(presets, activeId)`, `setDarkMode()`, `destroy()`.

### 3c. Wire into Toolbar

- Preset click → load preset settings into `ToolbarState`, call `onPenSettingsChange`
- Long-press → open `CustomizePopover` anchored to that preset
- When `setState()` is called with values that don't match any preset → set `activePresetId = null`, deselect all
- When values match a preset exactly (via `PresetManager.findMatchingPreset()`) → auto-select it

---

## Phase 4: Customization Popover

### 4a. Create `src/view/toolbar/CustomizePopover.ts`

Floating panel on `document.body` (not in view container) with `position: fixed; z-index: 1000`. Positioned adjacent to toolbar based on `ToolbarPosition`.

**Sections:**
1. **Pen Type** — 6 buttons: ballpoint, brush, felt-tip, pencil, fountain, highlighter
2. **Color** — 10 semantic swatches from `COLOR_PALETTE` + hex text input (`<input type="text">` with `#hex` validation)
3. **Width** — range slider 0.5–30
4. **Smoothing** — range slider 0–1, step 0.05
5. **Nib Settings** (conditional, shown only for fountain) — angle (0–180°), aspect (0.05–1.0), pressure (0–1)
6. **Preset Actions:**
   - When a preset is active: "Update [name]" + "Delete" buttons
   - When no preset (custom state): "Save as New Preset" button + name text input
7. **Toolbar Position** — 4-button group (top/bottom/left/right)

**Dismiss:** Click on backdrop overlay, or Escape key.

### 4b. Wire into Toolbar

- "More" button toggles popover open/close
- Long-press on preset opens popover pre-populated with that preset
- Popover change callbacks update `ToolbarState` and propagate via `onPenSettingsChange`
- Any change that differs from active preset → set `activePresetId = null`
- "Save as New" → `PresetManager.addPreset()`, update strip, call `onPresetSave`
- "Update" → `PresetManager.updatePreset()`, update strip, call `onPresetSave`
- "Delete" → `PresetManager.deletePreset()`, update strip, call `onPresetSave`, select next preset or null

---

## Phase 5: Auto-Minimize

### 5a. Create `src/view/toolbar/AutoMinimizer.ts`

Pure state machine, no DOM:
- `notifyStrokeStart()` → immediately minimize, cancel any expand timer
- `notifyStrokeEnd()` → start 500ms timer, when it fires → expand
- `forceExpand()` → immediately expand, cancel timer
- `isMinimized()` → boolean
- `destroy()` → clear timer

`onChange(minimized: boolean)` callback fires on state transitions.

### 5b. Wire into Toolbar

- AutoMinimizer `onChange` toggles `.is-minimized` class on toolbar element
- Minimized handle button calls `autoMinimizer.forceExpand()`
- When popover is open, auto-minimize is suspended (don't minimize while configuring)
- PaperView calls `toolbar.notifyStrokeStart()`/`notifyStrokeEnd()` from InputManager callbacks

### 5c. Create `src/view/toolbar/AutoMinimizer.test.ts`

Test with `jest.useFakeTimers()`: immediate minimize, delayed expand, timer cancellation, force expand, destroy cleanup.

---

## Phase 6: Polish & Integration

### 6a. Undo/redo refresh

Call `this.toolbar?.refreshUndoRedo()` after every undo stack mutation in PaperView:
- After `undo()` method
- After `redo()` method
- After stroke finalization in `onStrokeEnd` callback
- After eraser removes strokes in `handleEraserPoint`

### 6b. Settings sync

When settings change externally (from PaperSettingsTab):
- `setSettings()` in PaperView loads the active preset if `activePresetId` is set
- If the active preset's pen type / color / width differ from the old defaults, apply them

### 6c. Preset interaction details

**Selecting a preset:**
1. Load all preset fields into PaperView's pen state
2. Update `activePresetId` in ToolbarState
3. PresetStrip highlights the selected button

**Changing a setting (via popover):**
1. Update the corresponding pen state field
2. Compare current state against active preset
3. If any field differs → set `activePresetId = null`, deselect preset in strip
4. If all fields match a different preset → auto-select that preset

**"Save as New Preset":**
1. Collect current pen state + user-provided name
2. `PresetManager.addPreset()` → new PenPreset with UUID
3. Update PresetStrip
4. Set new preset as active
5. Persist via `onPresetSave` callback

**"Update [name]":**
1. `PresetManager.updatePreset(activePresetId, currentState)`
2. Update PresetStrip button appearance
3. Persist via `onPresetSave` callback

---

## Verification

1. `yarn build` — ensure no TypeScript errors
2. `yarn test` — all existing tests pass, new tests pass
3. `yarn lint` — no lint errors
4. Manual testing in Obsidian:
   - Open a `.paper` file
   - Verify toolbar appears at configured position
   - Tap preset → pen settings change
   - Change a setting → preset deselects
   - Save as new preset → appears in strip
   - Undo/redo buttons work and disable when stack empty
   - Add page button creates a new page
   - Toolbar auto-minimizes during writing, expands on lift
   - Change toolbar position from popover → toolbar repositions
   - Close and reopen → presets and position persist
