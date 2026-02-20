# Page Management Menu

## Overview

Add a per-page settings button (circle surrounding an ellipsis icon) to the top-right corner of each page. Tapping it opens a popover menu with options to configure that individual page: delete, page size, grid/line pattern, and background color. When resizing a page that has strokes, prompt the user to either leave strokes as-is or scale them to fit.

## Architecture Decisions

### Button Rendering: Canvas vs DOM Overlay

**Chosen: Canvas-rendered on the background layer** with a transparent DOM hit-area overlay.

Rationale:
- The button must appear at a fixed position relative to each page in world space, moving with pan/zoom
- Canvas rendering keeps it visually consistent with the page (shadows, scaling)
- A small invisible DOM element per visible page handles tap detection (avoids complex canvas hit-testing)
- The DOM overlay layer sits at z-index 4 (between prediction canvas at z-index 3 and hover cursor at z-index 5)

### Menu/Popover: Reuse CustomizePopover Pattern

The page menu will follow the same popover pattern as `CustomizePopover`: a backdrop + fixed-position panel with sections. This keeps the UI consistent and avoids introducing React or a new component framework.

### Undo for Page Operations

The `UndoManager` currently only supports stroke add/remove. Page operations (delete, resize, style change) will **not** be undoable in this initial implementation. Delete will require a confirmation dialog. This avoids a complex undo system redesign.

### Background Color: Per-Page Property

Add `backgroundColor` and `backgroundColorTheme` fields to the `Page` interface.

**Options presented to the user:**
- **Auto** (default) — Uses the current Obsidian theme's paper color. Light theme → light paper, dark theme → dark paper. This is the existing behavior.
- **Light** — Always uses light paper color regardless of theme.
- **Dark** — Always uses dark paper color regardless of theme.
- **Custom** — User picks a hex color for the paper fill.

**Theme detection for custom colors:**
When the user selects a custom background color, we calculate its perceived luminance to determine whether it's "light" or "dark". This controls the pattern colors (grid lines, dots, ruled lines) and the page menu button appearance — light backgrounds get dark-themed patterns, dark backgrounds get light-themed patterns.

The user can override this auto-detected theme via a "Pattern colors" toggle (Light/Dark) that appears below the custom color picker. This allows e.g. a medium-toned background to use whichever pattern style the user prefers.

**Luminance calculation:** `L = 0.299*R + 0.587*G + 0.114*B` (standard perceived luminance). If `L > 128`, the background is considered "light".

**Data format:**
- `backgroundColor`: `"auto"` | `"light"` | `"dark"` | hex string. Default: `"auto"`.
- `backgroundColorTheme`: `"auto"` | `"light"` | `"dark"`. Controls which pattern colors to use. Default: `"auto"` (inferred from backgroundColor — for "auto"/"light"/"dark" it matches directly; for hex, it's computed from luminance). When the user overrides, this is set to `"light"` or `"dark"` explicitly.

## Data Model Changes

### `Page` interface (types.ts)

Add fields:
```typescript
interface Page {
  // ... existing fields ...
  backgroundColor?: string;       // "auto" | "light" | "dark" | hex color. Default/omit: "auto"
  backgroundColorTheme?: string;  // "auto" | "light" | "dark". Default/omit: "auto" (inferred)
}
```

### `SerializedPage` interface (types.ts)

Add fields:
```typescript
interface SerializedPage {
  // ... existing fields ...
  bg?: string;   // backgroundColor, omit if "auto" or undefined
  bgt?: string;  // backgroundColorTheme, omit if "auto" or undefined
}
```

### Serializer updates

Update `serializeDocument` and `deserializeDocument` in `Serializer.ts` to handle the new `bg` and `bgt` fields.

### New helper: `resolvePageBackground(page, isDarkMode)` (in `color/ColorUtils.ts` or `BackgroundRenderer.ts`)

Returns `{ paperColor: string, patternTheme: "light" | "dark" }` for a given page:

1. **Determine paper fill color:**
   - `"auto"` or undefined → theme paper color (light or dark based on `isDarkMode`)
   - `"light"` → always `PAPER_COLORS.light`
   - `"dark"` → always `PAPER_COLORS.dark`
   - hex string → use that hex directly

2. **Determine pattern theme (controls line/dot/grid colors):**
   - If `backgroundColorTheme` is `"light"` or `"dark"` → use that directly (user override)
   - If `backgroundColorTheme` is `"auto"` or undefined:
     - `backgroundColor` is `"auto"` or undefined → follows `isDarkMode`
     - `backgroundColor` is `"light"` → `"light"`
     - `backgroundColor` is `"dark"` → `"dark"`
     - `backgroundColor` is hex → compute luminance, `L > 128` → `"light"`, else `"dark"`

## New Files

### `src/view/PageMenuButton.ts` — Page Menu Button Renderer + Hit Areas

Responsibilities:
- Render the "circle with ellipsis" icon on the background canvas at each page's top-right corner
- Create/manage transparent DOM hit-area elements positioned over each button
- Convert screen coordinates on tap to identify which page was tapped
- Emit `onPageMenuTap(pageIndex: number)` callback

Key details:
- Icon: A filled circle (semi-transparent) with three horizontal dots (ellipsis) inside
- Position: top-right of page, offset inward by ~16 world units from both edges
- Size: ~32 world units diameter, scales with zoom but clamps to a readable screen size (min 24px, max 44px)
- The hit areas are repositioned on every render (pan/zoom/layout change)

### `src/view/PageMenuPopover.ts` — Page Settings Popover

A popover (similar to `CustomizePopover`) that appears when the page menu button is tapped.

Sections:
1. **Delete Page** — Red "Delete" button. Shows confirmation if the page has strokes. Disabled if only 1 page.
2. **Page Size** — Dropdown/buttons for page size preset (US Letter, US Legal, A4, A5, A3, Custom) + orientation toggle (Portrait/Landscape). Custom shows width/height inputs with unit selector (in/cm).
3. **Grid & Lines** — Paper type buttons (Blank, Lined, Grid, Dot Grid) + line spacing / grid size inputs with unit selector.
4. **Background Color** — Four options: "Auto" (follows Obsidian theme, default), "Light" (always light paper), "Dark" (always dark paper), "Custom" (hex color picker). When "Custom" is selected, a color picker appears. Below the picker, a "Pattern colors" toggle (Light/Dark) is shown, pre-set based on the custom color's luminance but overridable by the user.

### `src/view/StrokeResizeDialog.ts` — Stroke Resize Confirmation

A simple modal dialog shown when the user changes page size on a page that has strokes.

Options:
- **Keep strokes as-is** — Strokes retain their world coordinates. May be clipped if new page is smaller.
- **Scale strokes to fit** — Apply an affine transform to all strokes on this page so they proportionally fit in the new dimensions.

## Modified Files

### `src/types.ts`
- Add `backgroundColor?: string` and `backgroundColorTheme?: string` to `Page`
- Add `bg?: string` and `bgt?: string` to `SerializedPage`

### `src/document/Serializer.ts`
- Serialize/deserialize `backgroundColor` ↔ `bg` and `backgroundColorTheme` ↔ `bgt`

### `src/canvas/BackgroundRenderer.ts`
- Use `resolvePageBackground()` to get per-page paper fill color and pattern theme
- Pass pattern theme to `renderPatternForPage()` instead of using global `isDarkMode`
- Render the page menu button icon in `render()` after drawing each page

### `src/view/PaperView.ts`
- Create `PageMenuButton` instance alongside other UI components
- Wire up `onPageMenuTap` → open `PageMenuPopover`
- Add methods: `deletePage(pageIndex)`, `updatePageSize(pageIndex, size, orientation, scaleStrokes)`, `updatePageStyle(pageIndex, paperType, lineSpacing, gridSize)`, `updatePageBackground(pageIndex, color)`
- Each method: mutates `document.pages[i]`, recomputes layout, re-renders, saves
- For `updatePageSize` with `scaleStrokes=true`: compute scale factors, apply transform to each stroke on that page, update bboxes, rebuild spatial index
- Destroy `PageMenuButton` and `PageMenuPopover` in `onClose()`

### `src/document/PageLayout.ts`
- No changes needed (already handles mixed page sizes)

### `styles.css`
- Add styles for `.paper-page-menu-hit` (transparent hit area overlays)
- Add styles for `.paper-page-menu-popover` (the popover and its sections)
- Add styles for `.paper-page-menu-popover__delete-btn`, section titles, option buttons, etc.
- Add styles for `.paper-stroke-resize-dialog` (modal dialog)

## Implementation Steps

### Step 1: Data Model Updates
1. Add `backgroundColor?: string` and `backgroundColorTheme?: string` to `Page` in `types.ts`
2. Add `bg?: string` and `bgt?: string` to `SerializedPage` in `types.ts`
3. Update `Serializer.ts` to serialize/deserialize the new fields
4. Add tests for round-trip serialization of both fields

### Step 2: Background Renderer — Per-Page Background Color
1. Add `resolvePageBackground(page, isDarkMode)` helper that returns `{ paperColor, patternTheme }`
2. Add `perceivedLuminance(hex)` helper — parses hex, returns `0.299*R + 0.587*G + 0.114*B`
3. Update `BackgroundRenderer.render()` to use `resolvePageBackground()` per page
4. Pass `patternTheme` (not global `isDarkMode`) to `renderPatternForPage()` for line/dot/grid colors
5. Add tests for luminance calculation and background resolution logic

### Step 3: Page Menu Button (Canvas + DOM Hit Areas)
1. Create `PageMenuButton.ts`
2. Add rendering method called from `BackgroundRenderer.render()` (or separately after background render)
3. Create transparent DOM hit-area elements that track page positions
4. Wire tap detection to callback
5. Integrate into `PaperView.onOpen()` and `onClose()`
6. Update hit areas on every static render (pan/zoom/layout changes)

### Step 4: Page Menu Popover
1. Create `PageMenuPopover.ts` following `CustomizePopover` patterns
2. Build sections: Delete, Page Size, Grid/Lines, Background Color
3. Wire callbacks for each action back to `PaperView`
4. Add CSS styles

### Step 5: PaperView Page Operations
1. `deletePage(pageIndex)` — Remove page and its strokes, recompute layout, handle edge cases (can't delete last page)
2. `updatePageStyle(pageIndex, changes)` — Update paperType, lineSpacing, gridSize on a page
3. `updatePageBackground(pageIndex, backgroundColor, backgroundColorTheme?)` — Update background on a page. When `backgroundColor` is a hex and `backgroundColorTheme` is not provided, auto-compute from luminance.
4. `updatePageSize(pageIndex, size, orientation, scaleStrokes)` — Update size/orientation, optionally scale strokes

### Step 6: Stroke Resize Dialog
1. Create `StrokeResizeDialog.ts` — modal with two options
2. Called from `PaperView.updatePageSize()` when page has strokes and size is changing
3. If "scale strokes": compute scale factors (newWidth/oldWidth, newHeight/oldHeight), apply affine transform to each stroke's points and bbox on that page
4. Rebuild spatial index after transformation

### Step 7: Stroke Scaling Implementation
1. Add `scaleStrokesForPage(pageIndex, oldSize, newSize)` to `PaperView`
2. For each stroke on the page:
   - Decode points
   - Scale x/y coordinates relative to old page origin
   - Re-encode points
   - Update bbox
   - Clear path cache
3. Rebuild spatial index
4. Add tests for stroke scaling math

### Step 8: CSS & Polish
1. Add all CSS for new components
2. Test dark mode / light mode transitions
3. Test with multiple pages of different sizes
4. Verify page menu button visibility at various zoom levels
5. Test on mobile (touch targets ≥ 44px)

## Stroke Scaling Math

When scaling strokes from `oldSize` to `newSize`:

```
scaleX = newEffectiveWidth / oldEffectiveWidth
scaleY = newEffectiveHeight / oldEffectiveHeight
```

For each stroke point on the page:
```
// Get page-relative coordinates
relX = point.x - pageRect.x
relY = point.y - pageRect.y

// Scale
newRelX = relX * scaleX
newRelY = relY * scaleY

// Convert back to world coordinates (using new page rect)
point.x = newPageRect.x + newRelX
point.y = newPageRect.y + newRelY
```

Stroke widths are NOT scaled (they remain the same visual thickness).

Bounding boxes are recomputed from the scaled points.

## Edge Cases

- **Single page**: Delete button is disabled
- **Custom page size validation**: Width/height must be > 0 and ≤ 100 inches/cm
- **Background color on theme change**: "auto" adapts to theme; "light"/"dark" are fixed to their respective paper colors; hex stays fixed. Pattern colors for hex backgrounds are determined by luminance (overridable).
- **Pattern color override persistence**: When user overrides pattern theme for a custom color, changing the custom color resets the override back to auto-detected (so the override doesn't carry over to a completely different color)
- **Strokes partially outside page after resize**: Allowed — strokes are clipped to page during rendering
- **Zoom extremes**: Menu button clamps to min/max screen size regardless of zoom
- **Page menu during active stroke**: Menu button hit areas have `pointer-events: none` during drawing (follows toolbar pattern)
