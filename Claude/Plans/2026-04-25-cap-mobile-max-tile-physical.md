# Cap `maxTilePhysical` at 1024 on mobile

## Problem

After shipping adaptive `tileWorldSize=64` for mobile (plan: `2026-04-25-adaptive-tile-world-size.md`), an iPad crash recurred during extended testing. Most likely cause: zoom > ~10× pushes into band 7, where `tilePhysical = 64 × 11.31 × 2 ≈ 1448²` — still uncapped under default `maxTilePhysical=2048`, and a 1448² 4× MSAA renderbuffer (~42 MB single allocation) is enough for iPad WebKit to refuse.

## Fix

Add `maxTilePhysical: 1024` to the mobile `tileConfig` in `Renderer.enableTiling`. Hard-stops every tile allocation at 1024² regardless of zoom band — matches the actual failure mode (per-allocation, not cumulative). Desktop keeps the default 2048.

## Tradeoffs

- **Tiles above band 6 (zoom > 8×)** clamp to 1024² instead of growing. Texture sampling does the rest — gradual softening that maxes at 2× upscale at zoom 16×, 4× at zoom 32× (purely theoretical; iPad won't be there).
- **At zoom ≤ 8×**: zero change.
- **Memory ceiling**: per-tile worst case drops from ~96 MB (2048² 4×MSAA) to ~24 MB (1024² 4×MSAA). The user's primary writing zoom of 10× lands at 1448² → 1024² clamp; one band of mild softening they likely won't notice.

## Implementation

```ts
// In enableTiling, alongside the existing derived tileWorldSize:
const tileConfig: TileGridConfig = {
  ...DEFAULT_TILE_CONFIG,
  dpr,
  tileWorldSize: derivedTileWorldSize,
  ...(this.isMobile ? { maxTilePhysical: 1024 } : {}),
  ...config,
};
```

## Files

- `src/canvas/Renderer.ts` — single addition in `enableTiling()`. ~2 lines.

## Validation

`yarn build && yarn test && yarn build:copy`. iPad: zoom and rotate at 10–14×, watch for crash.
