# Reduce Tile Size to Improve Stroke Bake Performance

## Context

When writing in a dense area, baking a stroke causes a noticeable stutter that worsens as strokes accumulate. This is because `bakeStroke()` synchronously re-renders **all strokes** in each affected tile on the main thread (`TileRenderer.renderTile()` at `Renderer.ts:1544`). With the current `tileWorldSize: 256`, a dense writing area can have dozens of strokes per tile, each requiring expensive texture/stamp rendering.

Reducing `tileWorldSize` from 256 to 128 means each tile covers 1/4 the area, so baking touches ~1/4 as many strokes per tile. The tradeoff is more tiles to composite, but `drawImage` calls are cheap relative to stroke rendering.

## Changes

### 1. Reduce `tileWorldSize` default: `src/canvas/tiles/TileTypes.ts`
- Change `DEFAULT_TILE_CONFIG.tileWorldSize` from `256` to `128`
- Reduce `minTilePhysical` from `256` to `128` (at 128 world size × zoom 0.5 × dpr 2 = 128px, we need to allow this)

### 2. Optimize stroke lookup in `TileRenderer.renderTile()`: `src/canvas/tiles/TileRenderer.ts`
- Build a `Map<string, Stroke>` from `doc.strokes` once, then look up by ID from the spatial index results
- Eliminates the O(n) scan of all document strokes per page per tile (lines 182-191 and 280-289)
- Preserves document ordering by iterating spatial index results in document order

### 3. Same optimization in worker: `src/canvas/tiles/worker/tileWorker.ts`
- Same Map-based lookup in the worker's `renderTile()` (lines 783-789)
- Worker receives `strokes` array via doc-update; build map once on update, reuse across tile renders

### 4. Update tests: `src/canvas/tiles/TileGrid.test.ts`, `src/canvas/tiles/TileTypes.test.ts`
- Update hardcoded expected values that depend on `DEFAULT_TILE_CONFIG` defaults (tileWorldSize 256 → 128)
- Update `tileSizePhysicalForBand` test expectations for new physical sizes

## Verification

1. `yarn build` — type-checks pass
2. `yarn test` — all tile tests pass with updated expectations
3. `yarn build:copy` — deploy to Obsidian vault
4. Manual test on iPad: write 20+ strokes in a small area, confirm bake stutter is reduced
