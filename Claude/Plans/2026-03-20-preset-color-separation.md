# Plan: Preset/Color Separation Redesign

**Date:** 2026-03-20
**Goal:** Decouple color from pen presets, redesign preset icons to show pen settings, and split the color strip into saved/history sections.

---

## Overview

Three interconnected changes:
1. **Pen presets become color-independent** — presets define pen type, width, nib settings, smoothing, etc. but not color (unless linked)
2. **Preset icons show pen settings** — nib shape, size, angle rendered directly in the icon instead of color fill
3. **Color strip gains saved/pinned colors** — strip splits into saved (pinned) colors + MRU history, with a unified pin interaction pattern

---

## Phase 1: Data Model Changes

### 1.1 Update PenPreset type

**File:** `src/view/toolbar/ToolbarTypes.ts`

```typescript
interface PenPreset {
  id: string;
  name: string;
  penType: PenType;
  width: number;
  smoothing: number;
  nibAngle?: number;        // fountain only
  nibThickness?: number;    // fountain only
  nibPressure?: number;     // fountain only
  useBarrelRotation?: boolean; // fountain only
  grain?: number;           // pencil only
  inkPreset?: string;       // fountain only
  inkDepletion?: number;    // felt-tip only
  strokeScaling?: StrokeScaling;
  // NEW: optional linked color
  linkedColorId?: string | null;  // null/undefined = no linked color
}
```

- Remove `colorId` as a required field
- Add `linkedColorId` as optional — when set, selecting the preset also sets this color
- The preset's `name` auto-generation changes from `"Type (Color)"` to just the pen type name (or user-set name)

### 1.2 Update PresetManager

**File:** `src/view/toolbar/PresetManager.ts`

- `createFromState()`: no longer copies `colorId` into the preset by default. Only copies it if `linkedColorId` is explicitly set.
- `findMatchingPreset()`: exclude `colorId` from matching logic. A preset matches if pen type + width + smoothing + nib settings match, regardless of current color.
- `updatePreset()`: support setting/clearing `linkedColorId`

### 1.3 Migration

- Existing presets with `colorId` → migrate to `linkedColorId = colorId` so users don't lose their current setup
- Add a version flag or migration check in `loadData()`

---

## Phase 2: Color Strip Redesign (Saved + History)

### 2.1 Update RecentColorManager → ColorStripManager

**File:** `src/view/toolbar/RecentColorManager.ts` (rename or extend)

New data model:
```typescript
interface ColorStripManager {
  savedColors: string[];      // pinned colors, max 12, user-ordered
  recentColors: string[];     // MRU history, fills remaining slots
  maxTotal: 16;               // total visible slots

  // Saved color operations
  pinColor(colorId: string): boolean;    // add to saved, max 12
  unpinColor(colorId: string): boolean;  // remove from saved
  reorderSaved(from: number, to: number): void;
  isSaved(colorId: string): boolean;

  // History operations (existing)
  promote(colorId: string): boolean;     // add/promote in history

  // Combined view
  getStrip(): { saved: string[]; history: string[] };  // saved colors, then up to (16 - saved.length) history items
}
```

Key behavior:
- Saved colors occupy the left side of the strip, up to 12 slots
- History fills the remaining slots (16 - savedColors.length)
- A color that exists in saved is not duplicated in history
- History still uses MRU ordering (most recent first)

### 2.2 Update RecentColorStrip UI

**File:** `src/view/toolbar/RecentColorStrip.ts`

Visual changes:
- Render saved colors first, then a subtle `|` divider, then history colors
- Saved color swatches get a small pin indicator (tiny pin icon below/on the swatch)
- History swatches have no indicator (or a subtle clock/recent icon if needed for clarity)

Interaction changes:
- **Tap swatch (saved or history):** select color immediately
- **Long-press swatch → context menu:**
  - On a **saved** color: show "Unpin" option
  - On a **history** color: show "Pin" option
  - Both: show "Delete" option to remove entirely
- **Right-click swatch:** same context menu as long-press

### 2.3 Pin Icon Integration

Use a consistent pin icon across the app:

1. **Color strip:** small pin indicator on saved swatches (subtle, maybe bottom-right corner or a tiny dot)
2. **Color picker popover:** add a pin toggle button next to the color selection. When enabled, selecting a color auto-saves it to the strip
3. **Preset customize popover:** "Link Color" toggle with the pin icon. When toggled on, shows a color swatch of the linked color

Design the pin icon as a small SVG in `PenIcons.ts` (or a new `Icons.ts` utility) — reusable at different sizes.

### 2.4 Persistence

Update `saveData()`/`loadData()` to persist:
- `savedColors: string[]`
- `recentColors: string[]` (history, as before)

---

## Phase 3: Preset Icon Redesign

### 3.1 Nib Shape Rendering

**File:** `src/view/toolbar/PresetButton.ts` (major rewrite of icon rendering)

Replace the current color-fill + pen-silhouette icon with a nib shape visualization:

**Icon layout (24-unit viewBox):**
- Center of icon: nib shape at appropriate size, angle, and aspect ratio
- Background: neutral/muted fill (e.g., light grey or theme-appropriate) — no color fill
- If `linkedColorId` is set: show a small color ring/border around the icon

**Nib shape by pen type:**

| Pen Type | Shape | Parameters Used |
|----------|-------|----------------|
| Ballpoint | Filled circle | width |
| Felt-tip | Rounded rectangle (landscape) | width |
| Pencil | Filled circle (slightly rough/textured edge?) | width |
| Fountain | Filled ellipse, rotated | width, nibThickness, nibAngle |
| Highlighter | Wide rectangle (landscape) | width |

**Size mapping (split logic):**

The nib shape's size in the icon represents the pen's width setting.

```
iconWidth = 24 units (viewBox)
penWidthRange = 0.5 to 30

if (penWidth <= 12):
    // Direct mapping: shape diameter = penWidth (in icon units)
    shapeSize = penWidth
else:
    // Compressed mapping: 12→12, 30→19.2 (80% of 24)
    shapeSize = 12 + (penWidth - 12) / 18 * 7.2
```

- Widths 0.5–12 → 0.5–12 icon units (2%–50% of icon), linear 1:1
- Widths 12–30 → 12–19.2 icon units (50%–80% of icon), compressed linear
- On retina displays (2x), width 0.5 ≈ 1.5 device pixels — tiny but visible dot
- Minimum minor axis for ellipses: 0.5 icon units (prevents invisible thin dimension on fountain nibs)

**Additional visual indicators in the icon:**
- **Stroke scaling ("Fixed to"):** If set to "screen", show a small `S` or screen icon indicator in a corner. If "paper" (default), no indicator.
- **Linked color:** If `linkedColorId` is set, render a thin color ring around the icon border (using the linked color). This makes it immediately obvious which presets have colors linked.

### 3.2 Active State

- Active preset: highlighted border (existing `.is-active` style)
- The active preset's nib shape could use a slightly stronger fill to stand out

### 3.3 CurrentPenButton Update

**File:** `src/view/toolbar/CurrentPenButton.ts`

The current pen button continues to show color (it represents the active pen state, including color). It keeps its diagonal color split + pen icon. No changes needed here — this button shows "what you're drawing with right now" including color.

---

## Phase 4: Preset Selection Behavior

### 4.1 Applying a Preset

**File:** `src/view/toolbar/Toolbar.ts`

When a user taps a preset:

```
if (preset.linkedColorId):
    // Linked color mode: apply pen settings AND color
    applyPenSettings(preset)
    applyColor(preset.linkedColorId)
    // → 1 tap for full pen+color switch
else:
    // Independent mode: apply pen settings only, keep current color
    applyPenSettings(preset)
    // → 1 tap for pen switch, color unchanged
```

### 4.2 Preset Matching

`findMatchingPreset()` now ignores color entirely (unless a preset has `linkedColorId` set, in which case it also checks `colorId === linkedColorId`).

### 4.3 Link Color Toggle in Customize Popover

**File:** `src/view/toolbar/CustomizePopover.ts`

When editing a preset, add a "Link Color" toggle (with pin icon):
- **Off (default for new presets):** preset does not store a color
- **On:** shows a color swatch of the currently-linked color. The user can tap it to change via the color picker. When the preset is selected, this color is applied.
- Toggle uses the same pin icon used in the color strip for visual consistency

---

## Phase 5: Color Picker Pin Integration

### 5.1 Color Picker Popover

**File:** `src/view/toolbar/ColorWheelPopover.ts`

Add a pin toggle to the color picker UI:
- Small pin icon button near the color selection area
- When toggled on (filled pin), the selected color will be auto-saved to the color strip's saved section
- When toggled off (outline pin), the color goes to history only
- The pin state is sticky (remembers last choice for convenience)

### 5.2 Color Palette Panel

**File:** `src/view/toolbar/CustomizePopover.ts` (ColorPickerPanel)

Same pin toggle available when selecting colors from the palette grid.

---

## Implementation Order

1. **Phase 1** (Data model) — foundation for everything else
2. **Phase 2.1** (ColorStripManager) — new data logic, tests
3. **Phase 3.1-3.2** (Preset icon rendering) — visual redesign
4. **Phase 4** (Selection behavior) — wire up new logic
5. **Phase 2.2-2.4** (Color strip UI + persistence) — visual strip changes
6. **Phase 5** (Color picker pin) — pin integration
7. **Phase 1.3** (Migration) — handle existing user data

Each phase should be independently testable. Phase 1 + 2.1 are pure logic (unit tests). Phase 3 is visual (manual testing on iPad). Phase 4 ties it together.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default for new presets | No linked color | Encourages the separated model; users opt-in to linking |
| Migration of existing presets | Auto-link existing colors | Users don't lose current behavior; can unlink later |
| Max saved colors | 12 | Leaves at least 4 history slots in a 16-slot strip |
| Nib size split threshold | 50% / 80% | Small sizes stay true, large sizes compress to avoid dominating the icon |
| Min ellipse minor axis | 0.5 icon units | Prevents invisible thin dimension on extreme fountain nib settings |
| Linked color indicator | Thin color ring on icon border | Visible at a glance without cluttering the nib shape visualization |
| Pin icon style | Consistent across strip, picker, and preset settings | Unified visual language; users learn one metaphor |

---

## Risk & Edge Cases

- **Very thin fountain nibs:** nibThickness 0.05 at width 1.5 → minor axis 0.075 units. Clamped to 0.5 units minimum, which is still proportionally exaggerated but readable.
- **Highlighter widths (24+):** compressed to 18-19 icon units. The wide rectangle shape still communicates "highlighter" effectively.
- **Color strip overflow:** if user has 12 saved + colors being promoted to history, ensure saved colors never get evicted by history promotion.
- **Linked color deleted from palette:** if a linked color no longer exists in any palette, the preset keeps its `linkedColorId` — it's just a hex value, not a reference to a palette slot.
- **Theme switching (light/dark):** linked color ring uses the dual-hex format (`#light|#dark`), same as current color handling. Nib shapes use a neutral fill that works in both themes.
