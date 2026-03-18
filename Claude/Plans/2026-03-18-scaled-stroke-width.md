# Scaled Stroke Width Feature

## Goal
Add a per-pen setting that scales stroke width to the current zoom level. When set to "Scaled", zooming in produces thinner strokes in world space (but they look the same screen size while drawing). This makes it easy to draw fine details or diagrams without manually switching pen sizes.

## Design Decision: Bake at Creation Time
The zoom-adjusted width is computed at **stroke creation time** and baked into the stroke's style. This means:
- Zoomed in 2x, pen width 6 → stored width = 3 world units
- While drawing: appears as 6 screen pixels (3 × 2x zoom) — same as the pen size shown in UI
- When zoomed out to 1x: appears as 3 pixels — correctly thinner in world space

This is the simplest approach: the stroke is just a normal stroke with a different width. No render-time changes needed.

## Changes

### 1. Type Definitions — `src/types.ts`
- Add `StrokeScaling` type: `"fixed" | "scaled"`
- Add `strokeScaling?: StrokeScaling` to `PenStyle` interface (optional, defaults to `"fixed"`)

### 2. Toolbar Types — `src/view/toolbar/ToolbarTypes.ts`
- Add `strokeScaling: StrokeScaling` to `ToolbarState`
- Add `strokeScaling?: StrokeScaling` to `PenPreset`

### 3. Toolbar State Defaults — `src/view/toolbar/ToolbarState.ts` (or wherever defaults live)
- Default `strokeScaling` to `"fixed"` in initial toolbar state
- Include `strokeScaling` in preset save/load

### 4. CustomizePopover UI — `src/view/toolbar/CustomizePopover.ts`
- Add a toggle/segmented control for "Fixed" / "Scaled" stroke width
- Place it near the width slider (since it modifies width behavior)
- Show for all pen types

### 5. PaperView Stroke Creation — `src/view/PaperView.ts`
- In `getCurrentStyle()`, include `strokeScaling` from toolbar state
- In `onStrokeStart`, if `style.strokeScaling === "scaled"`:
  - Compute effective width: `style.width / camera.zoom`
  - Override `style.width` with this value for the stroke being created
  - The stored stroke gets the zoom-adjusted width
- The active stroke rendering uses this adjusted style, so it renders at the correct world-space size

### 6. Preset Handling
- Ensure `strokeScaling` is persisted in pen presets
- Backward compat: missing `strokeScaling` defaults to `"fixed"`

### 7. Width Display (Optional Enhancement)
- When `strokeScaling === "scaled"`, could show effective width in the toolbar (e.g., "6 → 3 at 2x zoom")
- Not required for initial implementation

## Files to Modify
1. `src/types.ts` — Add `StrokeScaling` type and field to `PenStyle`
2. `src/view/toolbar/ToolbarTypes.ts` — Add to `ToolbarState` and `PenPreset`
3. `src/view/toolbar/ToolbarState.ts` — Default value
4. `src/view/toolbar/CustomizePopover.ts` — UI toggle
5. `src/view/PaperView.ts` — Width computation in stroke creation
6. Any preset serialization code

## Testing
- Unit test: width computation with different zoom levels
- Manual test: draw at various zoom levels, verify strokes appear same screen size while drawing but different world sizes when zoomed out
