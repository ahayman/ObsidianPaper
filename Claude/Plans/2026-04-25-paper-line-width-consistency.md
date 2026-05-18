# Paper line/grid/dot width consistency across zoom levels

## Problem

Paper patterns (lines, grid, dots) appear inconsistently bold across zoom levels — at some zooms they look correct, at others they're heavy enough to compete with handwriting for attention.

## Root cause

Three rendering paths exist for paper patterns and they disagree on width:

| Path | Line width | Dot radius |
|---|---|---|
| `BackgroundRenderer` class (legacy Canvas 2D) | `1 / camera.zoom` | `1.5 / camera.zoom` |
| Tiled Canvas 2D path (`renderLines`/`renderGrid`/`renderDotGrid`) | `lineScale` | `1.5 * lineScale` |
| Tiled WebGL path (`renderLinesEngine`/`renderGridEngine`/`renderDotGridEngine`) | **`lineScale * 2`** | **`2.5 * lineScale`** |

The `* 2` and `2.5 *` were introduced in commit `1b6e6c2` ("Full WebGL rendering", 2026-02-24) when the WebGL tile engine was added — likely to compensate for thin lines disappearing without proper anti-aliasing. **MSAA was added later** (4× samples on tile FBOs, per memory) and now provides correct sub-pixel coverage. The old compensation was never reverted.

## Fix

Match the WebGL tile path to the Canvas 2D paths:
- `renderLinesEngine`: `lineScale * 2` → `lineScale`
- `renderGridEngine`: `lineScale * 2` → `lineScale`
- `renderDotGridEngine`: `2.5 * lineScale` → `1.5 * lineScale`

That brings all three rendering paths into agreement at "1 physical pixel wide line, 1.5 physical pixel dot radius" at the tile's native zoom band.

## Why this should be visually fine now

`lineScale = tileWorldSize / tilePhysical`. A line of width `lineScale` in world space is exactly 1 tile-physical-pixel wide.

Within a zoom band, the tile gets composited at scale `zoomBandBaseZoom / zoom`, so 1 tile-pixel maps to `zoomBandBaseZoom / zoom` CSS pixels — i.e., between 0.71× and 1.0× CSS pixel across the band. With 4× MSAA inside the tile and the active stroke layer's `imageSmoothingEnabled=false` only applying to stamps (not lines), MSAA gives lines correct sub-pixel coverage during tile rendering.

If lines visibly disappear at the top of a zoom band post-revert, the next move is to investigate tile compositor filtering rather than re-bold the source.

## Files

- `src/canvas/BackgroundRenderer.ts` — three constant adjustments in the engine helpers.

## Validation

- `yarn build && yarn test`
- `yarn build:copy`
- Desktop: cycle through zoom 0.25× → 16× on a lined / grid / dot-grid page; lines should stay consistently subtle.
- iPad: same cycle, verify no zoom level looks bolded relative to others.

## What this is NOT

- Not changing tile compositor sampling (still NEAREST per memory note about Canvas 2D `imageSmoothingEnabled=false` parity).
- Not adjusting MSAA samples.
- Not touching the legacy `BackgroundRenderer` class — its widths are already correct.
