# Recent Color Palette

## Overview

Add a collapsible single-row color palette below the toolbar that displays recently-used colors. Tapping a color updates the current pen and promotes that color to the front. A color-wheel button at the end opens a full color picker for choosing new colors. This gives users a fast way to switch between colors without opening the customize popover.

## Design

### Visual Layout

```
┌─────────────────── Toolbar ───────────────────────┐
│ [undo][redo] | [pen] | [preset1][preset2]... | ... │
└───────────────────────────────────────────────────┘
┌─────────── Recent Color Strip ────────────────────┐
│ [▼] [●][●][●][●][●][●][●][●][●]         [🎨]    │
└───────────────────────────────────────────────────┘
```

- **Toggle button** (`▼`/`▲`): Collapses/expands the strip. Collapsed state shows just the toggle.
- **Color swatches**: Circular buttons with diagonal light/dark split (same style as preset buttons, but without pen icon). MRU order, no duplicates. The currently-active color has an accent ring.
- **Color wheel button** (`🎨`): Far right. Opens a popover with the reusable `ColorPickerPanel`.
- The strip adapts to toolbar position:
  - `top` → strip sits below the toolbar
  - `bottom` → strip sits above the toolbar
  - `left` → strip sits to the right of the toolbar (becomes a column)
  - `right` → strip sits to the left of the toolbar (becomes a column)

### Behavior

1. **Tapping a recent color**: Updates the current pen's `colorId` (via `onPenSettingsChange`), moves that color to position 0 in the MRU list. Does NOT change pen type, width, or other pen settings — only the color. If a preset matches the new combination, it becomes active.
2. **Tapping the color wheel**: Opens a small popover anchored to the color wheel button containing a `ColorPickerPanel`. Selecting a color there updates the current pen live (for preview), but promotes to MRU only when the popover is dismissed (see rule 3).
3. **Color tracking — deferred promotion**: MRU is only updated when the user **commits** to a color, not while browsing. The rules:
   - **Preset selection** → promotes immediately (tapping a preset is a deliberate choice).
   - **Recent color swatch tap** → promotes immediately (deliberate choice).
   - **Customize popover / Color wheel popover** → color changes apply to the pen live (for preview), but MRU promotion is **deferred until the popover closes**. Only the final `colorId` at dismissal time is promoted. This avoids polluting the MRU when the user taps through several colors before settling.
   - **Editing a non-active preset via long-press** → does NOT promote (doesn't change the current pen).
   - **Editing the active preset via long-press** → promotion deferred until popover close (same deferred rule).
4. **Long-press to remove**: Long-pressing a recent color swatch removes it from the MRU list. Simple gesture, no confirmation dialog.
5. **Auto-minimize**: The strip participates in the same auto-minimize behavior as the toolbar — it hides during strokes and reappears after.
6. **Max colors**: 16 recent colors. Oldest colors are evicted when the limit is reached.
7. **Persistence**: The `recentColors` array and collapsed state are saved to `PaperSettings`.
8. **Collapse state**: Saved per user. Default is expanded. Toggle button collapses/expands with a CSS transition.

## Implementation

### Step 1: Data Model — `PaperSettings`

**File**: `src/settings/PaperSettings.ts`

Add to `PaperSettings` interface:
```typescript
recentColors: string[];           // MRU colorId list (dual-hex or single hex)
recentColorsCollapsed: boolean;   // Whether the strip is collapsed
```

Add to `DEFAULT_SETTINGS`:
```typescript
recentColors: [],
recentColorsCollapsed: false,
```

### Step 2: New Component — `RecentColorStrip`

**File**: `src/view/toolbar/RecentColorStrip.ts` (new)

```typescript
export interface RecentColorStripCallbacks {
  onColorSelect: (colorId: string) => void;
  onColorRemove: (colorId: string) => void;  // Long-press to remove
  onCollapseChange: (collapsed: boolean) => void;
  onOpenColorPicker: (anchor: HTMLElement) => void;
}

export class RecentColorStrip {
  readonly el: HTMLElement;

  constructor(
    container: HTMLElement,
    recentColors: string[],
    activeColorId: string,
    collapsed: boolean,
    position: ToolbarPosition,
    callbacks: RecentColorStripCallbacks
  );

  // Update the displayed colors
  updateColors(colors: string[], activeColorId: string): void;

  // Highlight the active color swatch
  setActiveColor(colorId: string): void;

  // Position adapts with toolbar
  setPosition(position: ToolbarPosition): void;

  // Participate in auto-minimize
  setMinimized(minimized: boolean): void;

  // Toggle collapsed state
  setCollapsed(collapsed: boolean): void;

  // Dark mode
  setDarkMode(isDark: boolean): void;

  destroy(): void;
}
```

**Structure**:
- Root element: `div.paper-recent-colors` with `data-position` attribute
- Toggle button: `button.paper-recent-colors__toggle` with chevron icon
- Swatch container: `div.paper-recent-colors__swatches` (flex row/column, scrollable)
  - Each swatch: `button.paper-recent-colors__swatch` with diagonal light/dark gradient
- Color wheel button: `button.paper-recent-colors__wheel` with a palette/color-wheel Obsidian icon

**Swatch rendering**: Reuse the same CSS pattern as `.paper-toolbar__preset-color` for the diagonal split. No pen icon overlay — just the raw color pair.

### Step 3: Recent Color Manager Logic

**File**: `src/view/toolbar/RecentColorManager.ts` (new)

Pure logic class (no DOM) for managing the MRU list:

```typescript
export class RecentColorManager {
  private colors: string[];
  private maxColors: number;

  constructor(initial: string[], maxColors = 16);

  // Push/promote a color to front. Returns true if list changed.
  promote(colorId: string): boolean;

  // Remove a color from the list. Returns true if it was present.
  remove(colorId: string): boolean;

  // Get current list (MRU order)
  getColors(): string[];

  // Serialize for settings persistence
  toArray(): string[];
}
```

Logic:
- `promote(colorId)`: If colorId exists in list, remove it from current position and insert at index 0. If not in list, insert at index 0 and evict the last entry if at max capacity.
- Color equality is string equality on the colorId (exact match of `"#light|#dark"`).

### Step 4: Integration into Toolbar

**File**: `src/view/toolbar/Toolbar.ts`

Changes:
1. Add `RecentColorStrip` and `RecentColorManager` as class members.
2. In constructor, accept `recentColors: string[]` and `recentColorsCollapsed: boolean` parameters.
3. In `build()`, create the `RecentColorStrip` after the main toolbar element (as a sibling, not a child).
4. Wire the `RecentColorStrip` callbacks:
   - `onColorSelect`: Update `state.colorId`, call `onPenSettingsChange`, promote color.
   - `onCollapseChange`: Persist via new callback.
   - `onOpenColorPicker`: Open a popover with `ColorPickerPanel` anchored to the wheel button.
5. **Deferred MRU promotion** — track a `pendingColorPromotion: string | null` field:
   - When the popover opens, record the current `state.colorId` as `colorIdBeforePopover`.
   - While the popover is open, do NOT promote on color changes (they're live preview only).
   - When `closePopover()` runs, if `this.state.colorId !== colorIdBeforePopover` and this was an active-pen edit, promote `this.state.colorId` to MRU.
   - **Immediate promotion** (no deferral) for: `handlePresetClick`, recent strip `onColorSelect`.
   - NOT promoted at all: editing a non-active preset via long-press (doesn't change the current pen).
6. Wire `RecentColorStrip` long-press callback:
   - `onColorRemove: (colorId: string) => void` — calls `recentColorManager.remove(colorId)`, updates strip and persists.
6. Share the auto-minimizer state with the strip: when `AutoMinimizer` fires, also call `strip.setMinimized()`.

**New callback** in `ToolbarCallbacks`:
```typescript
onRecentColorsChange: (colors: string[], collapsed: boolean) => void;
```

### Step 5: Color Wheel Popover

When the color wheel button is tapped, the Toolbar creates a lightweight popover (similar to `CustomizePopover` but simpler) containing just a `ColorPickerPanel`. This could be:

- A new small class `ColorWheelPopover` that creates a backdrop + positioned container with a `ColorPickerPanel` inside.
- Or reuse the existing popover infrastructure by opening a stripped-down version.

Simplest approach: Create a minimal popover class (`ColorWheelPopover`) that:
1. Creates a backdrop div for click-outside dismissal.
2. Creates a positioned container anchored to the wheel button.
3. Mounts a `ColorPickerPanel` inside.
4. On color selection, calls back to the Toolbar which updates the pen and promotes the color.

### Step 6: Styling

**File**: `styles.css`

Add CSS for `.paper-recent-colors` that mirrors the toolbar's position-aware layout:

```css
/* Recent Color Strip */
.paper-recent-colors {
  position: absolute;
  z-index: 9; /* Below toolbar (10) */
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  pointer-events: auto;
  touch-action: manipulation;
  transition: opacity 0.2s, transform 0.2s;
}

/* Position variants — offset from toolbar */
.paper-recent-colors[data-position="top"] {
  top: 68px; /* toolbar top (12px) + toolbar height (~56px) */
  left: 50%;
  transform: translateX(-50%);
  flex-direction: row;
}

/* ... bottom, left, right variants ... */

/* Collapsed state */
.paper-recent-colors.is-collapsed .paper-recent-colors__swatches,
.paper-recent-colors.is-collapsed .paper-recent-colors__wheel {
  display: none;
}

/* Auto-minimize (same as toolbar) */
.paper-recent-colors.is-minimized {
  opacity: 0;
  pointer-events: none;
}

/* Swatches */
.paper-recent-colors__swatch {
  width: 28px;
  height: 28px;
  /* Same diagonal split pattern as preset buttons */
}

/* Toggle button */
.paper-recent-colors__toggle {
  /* Small chevron button */
}

/* Color wheel button */
.paper-recent-colors__wheel {
  /* Obsidian icon button at end */
}
```

### Step 7: PaperView Integration

**File**: `src/view/PaperView.ts`

1. Pass `settings.recentColors` and `settings.recentColorsCollapsed` to the `Toolbar` constructor.
2. Add `onRecentColorsChange` callback that persists to settings:
   ```typescript
   onRecentColorsChange: (colors, collapsed) => {
     this.onSettingsChange?.({ recentColors: colors, recentColorsCollapsed: collapsed });
   }
   ```

### Step 8: Unit Tests

**File**: `src/view/toolbar/RecentColorManager.test.ts` (new)

Test cases for `RecentColorManager`:
- Promoting a new color adds it to front
- Promoting an existing color moves it to front
- List respects max capacity (oldest evicted)
- Duplicate detection works for dual-hex strings
- Empty initial list works
- Promote returns correct boolean for change detection
- Removing a color that exists returns true and removes it
- Removing a color that doesn't exist returns false
- Removing from an empty list returns false

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/settings/PaperSettings.ts` | Modify | Add `recentColors` + `recentColorsCollapsed` fields |
| `src/view/toolbar/RecentColorManager.ts` | New | MRU list logic |
| `src/view/toolbar/RecentColorManager.test.ts` | New | Tests for MRU logic |
| `src/view/toolbar/RecentColorStrip.ts` | New | UI component for the color strip |
| `src/view/toolbar/ColorWheelPopover.ts` | New | Minimal popover wrapping ColorPickerPanel |
| `src/view/toolbar/Toolbar.ts` | Modify | Integrate strip + manager |
| `src/view/toolbar/ToolbarTypes.ts` | Modify | Add callback to `ToolbarCallbacks` |
| `src/view/PaperView.ts` | Modify | Pass recent colors data, handle persistence |
| `styles.css` | Modify | Add recent color strip styles |

## Considerations

- **Swatches are color-only**: No pen type icon. This strip is purely about color, not full pen configuration. This keeps it visually clean and distinct from the preset strip.
- **Position offset**: The strip must be offset from the toolbar dynamically. Since the toolbar is absolutely positioned and its height can vary, we may need to measure the toolbar's bounding rect or use a fixed offset that accounts for the toolbar's padding + content height.
- **Touch targets**: Swatches at 28px are below the 44px minimum. Since this is a secondary quick-access strip (not the primary input), and the spacing between swatches provides some additional tap area, 28px is acceptable. If needed, increase to 32px.
- **Scroll**: If many recent colors accumulate, the swatch container should scroll horizontally (for top/bottom) or vertically (for left/right), matching the preset strip pattern.
- **iPad Safari**: Keep DOM simple. Avoid complex CSS that could cause compositor issues on iPad.
