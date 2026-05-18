# Paper line/grid/dot — width × alpha balance

## Problem

Reverting to `lineScale` (1 tile-texel) made WebGL pattern lines disappear at low zoom levels — at zooms where the tile is downsampled to screen, 1 tile-texel maps to < 1 physical pixel and NEAREST tile sampling drops it entirely. The previous `lineScale * 2` patch (always 2 tile-texels) survived sampling but looked bolded at high zoom.

## Where lines disappear

User reports disappearance at **full 10× zoom** (deep zoom, not zoomed-out). At that zoom, with the iPad config (`tileWorldSize=64`, `maxTilePhysical=1024`), the tile renders a 1-tile-texel-wide quad through MSAA — should be ~1.25 phys-px on screen after upscaling. The reason it goes invisible isn't fully nailed down (could be MSAA edge sampling on very thin quads, NEAREST upscale picking source pixels off-line, or alpha precision in the resolve step), but the empirical observation is: at this exact configuration, a 1-tile-texel line is too thin to land reliably on screen.

The previous `* 2` patch (always 2 tile-texels wide, full alpha) was stable across all zooms but visually heavy. Both extremes have a problem; a width-alpha balance threads between them.

## Fix

Render lines and dots **thicker but with reduced alpha** so total visual weight stays the same as a 1-tile-texel solid line, but sub-pixel sampling has multiple texels to hit:

| Surface | Width / radius | Alpha |
|---|---|---|
| Lines | `lineScale * 2` | 0.5 |
| Grid | `lineScale * 2` | 0.5 |
| Dot radius | `lineScale * 2` | 0.5 |

Total "ink" (width × alpha) ≈ original 1-texel solid. Sub-pixel sampling now has 2 texels to land on instead of 1, so even when the tile is downsampled to screen the line stays visible.

Apply the same in both WebGL engine path and Canvas 2D tile path (consistency across rendering modes). Legacy `BackgroundRenderer` class uses screen-zoom widths (`1 / camera.zoom`) and doesn't have this problem — leave it alone.

## Implementation

For the WebGL engine helpers, wrap draws in `engine.save()` / `engine.setAlpha(0.5)` / draw / `engine.restore()` to scope alpha cleanly.

For the Canvas 2D tile helpers, use `ctx.save()` / `ctx.globalAlpha = 0.5` / draw / `ctx.restore()`.

## Why this should look uniform across zooms

- **Sub-pixel zoom (zoomed out)**: 2 tile-texels at 50% alpha each → at least one survives NEAREST sampling at 50% alpha → ~1 phys-px line at 50% alpha. Visible.
- **Native band zoom**: 2 phys-px line at 50% alpha → visual weight ~1 phys-px solid. Subtle.
- **Top of band (sqrt(2)× upscale)**: ~2.83 phys-px at 50% → equivalent to ~1.4 phys-px solid. Slightly heavier, but bounded.

## Files

- `src/canvas/BackgroundRenderer.ts`

## Validation

- `yarn build && yarn test && yarn build:copy`
- Cycle zoom 0.25× → 16× across lined/grid/dot-grid pages on desktop.
- iPad: same.
- If a specific zoom band still looks heavy or thin, tune alpha (0.4–0.6 range).

## Why not LINEAR compositor sampling

The "right" architectural fix would be `LINEAR` filtering on tile textures (root-cause sub-pixel sampling). But it would also affect stroke compositing (strokes inside tiles are MSAA-rendered then sampled when composited at non-1:1) — possibly softening strokes during gestures. Width × alpha is the lower-risk localized fix; LINEAR remains an option if pattern issues persist.
