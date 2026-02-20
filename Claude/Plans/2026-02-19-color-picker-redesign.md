# Color Picker Redesign

## Goal
Replace the limited color palette + hex input with a proper color picker that has two modes (Simple grid and Spectrum), ensure every color has light + dark theme variants, and display both variants with a diagonal split in toolbar swatches.

## Current State
- 10 semantic colors in `ColorPalette.ts`, each with light/dark variants
- Custom hex colors stored as single values (no dark variant)
- Color swatches in `CustomizePopover.ts` show only the current theme's color
- `PresetButton.ts` renders a single resolved color per swatch
- `PenPreset.colorId` and `ToolbarState.colorId` are single strings
- `PenStyle` already has an unused `colorDark?: string` field

## Design Decisions

### Color Data Model
Custom colors need both light and dark hex values. Rather than changing `colorId` everywhere, we encode custom color pairs as a single string using pipe delimiter: `"#AABBCC|#DDEEFF"` where left is light, right is dark. This keeps all existing string-based APIs intact.

- Semantic IDs (`"ink-black"`) continue working unchanged
- Single hex (`"#AABBCC"`) remains supported for backwards compatibility (used as-is in both themes)
- New dual-hex format (`"#AABBCC|#DDEEFF"`) stores light|dark pairs

Update `resolveColor()` to parse the new format.

### Simple Mode — Extended Apple-Style Grid
Expand the semantic palette from 10 to ~48 colors organized in a grid (6 columns × 8 rows). Colors arranged by hue (columns) and lightness (rows), similar to Apple's color picker in Notes. Each color has hand-tuned light/dark variants. The existing 10 colors are included to preserve compatibility.

### Spectrum Mode — HSL Rectangle Picker
Instead of a complex color wheel, use an HSL-based picker with two explicit selection steps — the user **must** pick both a light theme color and a dark theme color separately. No auto-generation.

**Layout:**
- Two side-by-side labeled sections: **"Light theme"** and **"Dark theme"**
- Each section contains its own:
  1. **Hue strip** — Horizontal gradient bar for selecting hue (0-360°)
  2. **Saturation/Lightness plane** — 2D rectangle where X = saturation, Y = lightness
  3. **Hex input** — For precise manual entry
- A **preview swatch** between/below the two pickers shows the diagonal-split result (dark top-left, light bottom-right) so the user can see how the pair will look
- A **"Select" button** confirms the pair — disabled until both colors have been explicitly chosen
- Both pickers start empty (no default selection) to make it clear the user must choose each one

### Dual-Color Swatch Display
Every color display (toolbar preset buttons + popover swatches) shows both theme variants:
- Diagonal split via CSS `linear-gradient(135deg, darkColor 50%, lightColor 50%)`
- Top-left triangle = dark variant, bottom-right triangle = light variant
- Applied to both `PresetButton` and color swatches in the popover

## Files to Create

### `src/color/ExtendedPalette.ts`
Extended semantic color palette (~48 colors) organized in grid layout. Each entry is a `SemanticColor` with hand-tuned light/dark pairs. Export grid dimensions and order for the Simple picker UI.

### `src/color/ColorUtils.ts`
Utility functions:
- `parseColorId(colorId: string): { light: string; dark: string }` — parses any color format (semantic ID, single hex, dual hex) into a light/dark pair
- `encodeDualHex(light: string, dark: string): string` — creates `"#light|#dark"` string
- `isDualHex(colorId: string): boolean` — format detection
- `hexToHsl(hex: string): [number, number, number]` — hex to HSL conversion
- `hslToHex(h: number, s: number, l: number): string` — HSL to hex
- `hexToRgb(hex: string): [number, number, number]` — hex to RGB
- `rgbToHex(r: number, g: number, b: number): string` — RGB to hex

### `src/view/toolbar/ColorPickerPanel.ts`
New standalone panel component replacing the inline color section in CustomizePopover. Contains:
- Mode toggle (Simple / Spectrum tabs)
- Simple mode: grid of `ExtendedPalette` colors as dual-split swatches
- Spectrum mode: canvas-based HSL picker + hue strip + dual hex inputs
- Emits selected colorId (semantic ID or dual-hex string)

## Files to Modify

### `src/color/ColorPalette.ts`
- Update `resolveColor()` to handle the `"#light|#dark"` dual-hex format
- Update `isSemanticColor()` if needed
- Keep existing 10-color `COLOR_PALETTE` for backwards compat (re-export from ExtendedPalette)

### `src/view/toolbar/CustomizePopover.ts`
- Replace `buildColorSection()` with instantiation of new `ColorPickerPanel`
- Remove `colorSwatchEls` map and `hexInput` ref
- Update `selectColor()` to handle dual-hex format
- Update `setDarkMode()` to forward to ColorPickerPanel

### `src/view/toolbar/PresetButton.ts`
- Change `renderSwatch()` to show diagonal dual-color split instead of single color
- Use `parseColorId()` to get both light and dark hex values
- Render using two-layer approach or CSS gradient

### `src/view/toolbar/ToolbarTypes.ts`
- No changes needed — `colorId` remains a string, just carries more formats now

### `src/types.ts`
- No changes needed — `PenStyle.color` already a string, `colorDark` already exists for serialization

### `styles.css`
- Add styles for the new color picker panel (mode tabs, HSL canvas, hue strip)
- Add dual-split swatch styles using `linear-gradient(135deg, ...)`
- Update `.paper-popover__color-swatch` for dual display
- Update `.paper-toolbar__preset-color` for diagonal split

## Implementation Steps

### Step 1: Color Utilities (`ColorUtils.ts`)
Create hex↔HSL↔RGB conversion and dual-hex parsing/encoding. Write tests.

### Step 2: Extended Palette (`ExtendedPalette.ts`)
Define ~48 colors with light/dark pairs arranged in a 6×8 grid. Include the original 10 as a subset. Write tests to verify all entries are valid.

### Step 3: Update `resolveColor()` in `ColorPalette.ts`
Add dual-hex format parsing. Write tests for all three formats (semantic, single hex, dual hex).

### Step 4: Dual-Split Swatch CSS
Add CSS for diagonal-split color display to `styles.css`. Apply to both toolbar preset buttons and popover swatches.

### Step 5: Update `PresetButton.ts`
Modify `renderSwatch()` to always show both light and dark variants using the diagonal split, regardless of current theme. Use `parseColorId()`.

### Step 6: Build `ColorPickerPanel.ts` — Simple Mode
Create the panel component with the extended palette grid. Each swatch shows diagonal split. Clicking selects the color.

### Step 7: Build `ColorPickerPanel.ts` — Spectrum Mode
Add two side-by-side HSL pickers (one for light theme, one for dark theme):
- Each picker has its own canvas SL plane + hue strip + hex input
- Crosshair/thumb indicators for current selection on each
- Both pickers start empty — user must explicitly choose each color
- Diagonal-split preview swatch shows the combined result
- "Select" button only enabled once both colors are chosen
- Confirm emits the dual-hex colorId

### Step 8: Integrate into `CustomizePopover.ts`
Replace `buildColorSection()` with `ColorPickerPanel`. Wire up callbacks. Remove old hex input and swatch refs.

### Step 9: Update Popover Color Swatches
The swatches inside the popover's simple grid should also show diagonal splits.

### Step 10: Test and Polish
- Verify backwards compatibility with existing documents (old hex colors still render)
- Test theme switching live
- Ensure all preset operations (save, update, delete) work with new color formats
- Test on mobile (touch interactions for HSL picker)
