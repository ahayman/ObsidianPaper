# Adaptive `tileWorldSize` for iPad GPU memory pressure

## Problem

iPad crashes Obsidian when zoomed > ~8× (especially during zoom + rotate). Validated against several memory caps (200 MB → 1 GB) — `maxMemoryBytes` doesn't matter, so cache eviction isn't the bottleneck. The failure mode is per-allocation size: at zoom 10× the tile-resolution formula wants 2048² physical tiles, and each one carries a 4× MSAA color RBO + 4× MSAA stencil RBO ≈ 96 MB of GPU memory in a single allocation. iPad WebKit refuses or context-loses on large MSAA renderbuffers.

## Insight

```
tilePhysical = tileWorldSize × zoomBandBaseZoom(band) × dpr
```

To keep `tilePhysical` at or below a safe per-allocation cap (`safeRenderbufferSize`) at the deepest zoom we want sharp (`maxSharpZoom`), `tileWorldSize` is bounded above by:

```
tileWorldSize ≤ safeRenderbufferSize / (maxSharpZoom × dpr)
```

For an iPad at dpr=2 with 8× as the highest sharp zoom and 1024² as the safe MSAA renderbuffer cap: `tileWorldSize ≤ 64`. For desktop with 4096+ headroom, the current 128 stays optimal.

Above the floor (`minTilePhysical`), total tile pixel area at any given zoom is invariant to `tileWorldSize` — smaller world tiles just split the same total across more entries. What changes is the **per-allocation size**, which is the actual iPad failure mode.

## Fix

Derive `tileWorldSize` from device characteristics in `Renderer.enableTiling()` rather than relying on `DEFAULT_TILE_CONFIG`'s static 128. Mobile gets 64, desktop keeps 128. Existing `config` overrides (used for tests + future user settings) still win.

### Code

```ts
// In enableTiling, before building tileConfig:
const SAFE_RENDERBUFFER_SIZE = this.isMobile ? 1024 : 4096;
const MAX_SHARP_ZOOM = 8;  // band 6 = 8x; tiles clamp+soften beyond this
const derivedTileWorldSize = Math.max(
  32,  // floor for sanity — never go below 32 even on weird devices
  Math.floor(SAFE_RENDERBUFFER_SIZE / (MAX_SHARP_ZOOM * dpr))
);

const tileConfig: TileGridConfig = {
  ...DEFAULT_TILE_CONFIG,
  dpr,
  tileWorldSize: derivedTileWorldSize,
  ...config,  // explicit caller overrides still win (tests, future settings)
};
```

## Tradeoffs

- **iPad zoom 10×**: 9 tiles × 96 MB = 864 MB GPU → 16 tiles × 24 MB = 384 MB. ~2.25× reduction. Per-allocation peak: 2048² → 1024² (iPad handles 1024² reliably).
- **iPad zoom 1×**: tile count rises ~3× (~80 → ~250 visible). CPU iteration cost is microseconds. Per-tile pixel cost is at the `minTilePhysical=128` floor either way, so total pixel area is similar (modest increase from floor-overshoot at zoom < 1).
- **Mac**: zero change (still 128).
- **Fidelity at zoom 10×**: 1024² tiles match screen resolution exactly through zoom 8×; very mild softening between 8×–11× (single zoom band of slight upscaling); above 11× starts to soften noticeably. User writes around 10×, which lands inside the sharp window.

## Files

- `src/canvas/Renderer.ts` — derivation in `enableTiling()`. ~10 lines.

## Validation

1. `yarn build && yarn test`
2. `yarn build:copy`
3. iPad: zoom to 10×, rotate. Should not crash.
4. iPad: writing fidelity at 10× should be visibly identical or near-identical.
5. Mac: indistinguishable from current behavior.

## What we're explicitly NOT doing

Per-zoom-band adaptive grids (the "right" architectural answer if we ever need to support 16×+ zoom or multi-page documents at deep zoom). Smells like over-engineering for a problem that the cheap fix likely resolves. Revisit only if iPad still hits limits after this lands.
