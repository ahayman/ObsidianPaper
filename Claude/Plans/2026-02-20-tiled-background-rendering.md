# Tiled Background Rendering

## Problem

The background canvas (desk color, page shadows, paper color, grid/lines/dots) still uses the old overscan + CSS transform approach. During pan/zoom gestures, the tiled static layer composites strokes at the live camera position, but the background lags behind on a CSS-transformed overscan buffer. This produces handwritten strokes floating over a blank (or misaligned) background.

## Approach: Render Background Into Existing Tiles

Include the background as part of each tile's render rather than maintaining a separate background canvas. Each tile renders: desk color → page shadow/fill → grid/lines/dots → strokes. This eliminates the background canvas entirely when tiling is enabled.

### Why not a separate background tile system?

- Doubles memory usage for no benefit
- Two tile systems to synchronize
- Background is cheap to render (fills, lines) vs strokes (complex paths)

### Why not keep the CSS-transform background canvas?

- It's the source of the problem — CSS transform lags behind the live camera during gestures
- The overscan buffer has finite size, so fast/large gestures expose blank edges

## Design

### TileRenderer changes

`renderTile()` gains a new first phase: render background before strokes.

```
renderTile(tile, doc, pageLayout, spatialIndex, isDarkMode):
  clear tile canvas
  set world→pixel transform

  // Phase 1: Background
  fill with desk color
  for each page overlapping tile.worldBounds:
    draw page shadow (optional — may skip for perf)
    fill page rect with paper color
    clip to page rect
    render patterns (lines/grid/dots) within tile bounds

  // Phase 2: Strokes (unchanged)
  query spatial index for intersecting strokes
  render strokes grouped by page with clipping
```

The background rendering logic is extracted from `BackgroundRenderer` into a shared helper or moved directly into `TileRenderer`. The key difference from `BackgroundRenderer`:
- No camera transform needed — tiles already have their own world→pixel transform
- Line width / dot radius should be based on the tile's zoom band, not the live camera zoom
- Shadow blur/offset scaled by tile's zoom band, not live camera zoom
- Only renders the region covered by the tile's world bounds (not entire viewport)

### BackgroundRenderer changes

- When tiling is enabled, the background canvas is hidden (`display: none` or removed from DOM)
- `BackgroundRenderer` continues to exist for the legacy (non-tiled) path
- The `afterPages` callback (page menu icons) moves to the compositor or is rendered as a separate overlay

### Compositor changes

None — the compositor already draws tiles as opaque rects. Since tiles now include the background, they're fully opaque and cover the viewport completely. No desk color bleed-through.

### Renderer changes

- `renderStaticLayer()` tiled path: skip `backgroundRenderer.render()`, hide background canvas
- `setGestureTransform()`: skip background CSS transform when tiling (background is in tiles)
- `clearGestureTransform()`: skip background transform reset when tiling

### Page menu icons

Currently rendered via `afterPages` callback into the background canvas in camera space. Options:
1. **Render into tiles** — icons would need invalidation when pages change, adds complexity
2. **Render as overlay on static canvas** — after compositing tiles, draw icons on top in camera space
3. **Keep on background canvas** — but background canvas is hidden in tiled mode

Option 2 is cleanest: after `compositor.composite()`, apply camera transform to the static canvas context and draw icons. This keeps icons sharp (not affected by tile resolution) and doesn't require tile invalidation.

### Pattern rendering at tile zoom band

Current `BackgroundRenderer` uses `1 / camera.zoom` for line widths and dot radii to keep them 1 CSS pixel wide regardless of zoom. For tiles, we need the equivalent: `1 / zoomBandBaseZoom(tile.renderedAtBand)` scaled by the tile's world→pixel transform.

Actually, since the tile's context already has a `scale = tilePhysical / tileWorldSize` transform, and `tilePhysical = tileWorldSize * zoomBandBaseZoom * dpr`, we get `scale = zoomBandBaseZoom * dpr`. Drawing a line with `lineWidth = 1 / (zoomBandBaseZoom * dpr)` in this context produces a 1-physical-pixel line. Simpler: `lineWidth = 1 / scale` where `scale = tilePhysical / tileWorldSize`.

### Invalidation

Background changes when:
- Dark mode toggle → already triggers full re-render (`invalidateAll`)
- Page background color change → triggers full re-render
- Paper type change (blank/lined/grid/dot) → triggers full re-render
- Grid size / line spacing change → triggers full re-render

All of these already call `renderStaticLayer` which re-renders all visible tiles. No additional invalidation needed.

## Implementation Steps

1. **Extract background rendering helpers** from `BackgroundRenderer` into functions that accept a canvas context and world bounds (no camera dependency):
   - `renderDeskColor(ctx, worldBounds, isDarkMode)`
   - `renderPageBackground(ctx, page, pageRect, isDarkMode, lineScale)` — fills + patterns
   - `renderPageShadow(ctx, pageRect, shadowScale)`

2. **Update `TileRenderer.renderTile()`** to call background helpers before stroke rendering

3. **Update `Renderer` tiled path**:
   - Hide background canvas when tiling is enabled
   - Skip `backgroundRenderer.render()` in `renderStaticLayer` tiled path
   - Skip background CSS transforms in `setGestureTransform` / `clearGestureTransform`
   - Render page menu icons as overlay after tile compositing

4. **Update `TiledStaticLayer`** to accept and pass through page menu icon rendering callback

5. **Tests**: Verify tile renderer produces correct output with background content

## Edge Cases

- **Desk color between pages**: Tiles covering the gap between pages show desk color. This happens naturally since each tile fills with desk color first, then overlays page rects.
- **Page shadow across tile boundaries**: Shadow blur from one tile won't bleed into adjacent tiles. This is acceptable — shadows are subtle (2px offset, 8px blur) and the visual seam at tile boundaries will be imperceptible.
- **Overscan tiles**: Tiles outside the viewport but within overscan still render background. This is correct — they're pre-rendered for upcoming pan/zoom.
