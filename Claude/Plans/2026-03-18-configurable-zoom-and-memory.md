# Configurable Max Zoom & Memory Budget

## Goal
Allow users to choose a higher max zoom level (up to 10x) and configure the GPU tile memory budget per-device. This supports detailed work (diagramming, fine annotations) on devices with enough RAM.

## Background
- Current `MAX_ZOOM = 5.0` in Camera.ts, but the dynamic formula `maxZoom = (3 × screenSize) / smallestPageSize` often limits zoom below 5x on standard page sizes.
- Tile system handles 10x cleanly — zoom band 6 produces 2048×2048 tiles (exact maxTilePhysical cap), no upscaling.
- Beyond ~11.3x, tiles would be upscaled/blurry, so 10x is the natural ceiling.
- At 10x with 2048² tiles (~16.7MB each), ~12-16 visible tiles need ~200-270MB minimum. Higher budget = more cached tiles = smoother panning.

## Changes

### 1. DeviceSettings — `src/settings/DeviceSettings.ts`
- Add `maxZoomLevel: 5 | 10` (default: 5)
- Add `tileMemoryBudgetMB: number` (default: 200, options: 200, 400, 600, 1000)
- Update `DEFAULT_DEVICE_SETTINGS`

### 2. Camera — `src/canvas/Camera.ts`
- Change `MAX_ZOOM` from a constant to a configurable value
- Add `setMaxZoom(max: number)` method, or accept it in `setZoomLimits()`
- `setZoomLimits` already exists and accepts min/max — just need the callers to pass the right max

### 3. Dynamic Zoom Formula — `src/view/PaperView.ts` + `src/embed/EmbeddedPaperModal.ts`
- In `updateZoomLimits()`, change the multiplier and cap:
  - Current: `maxZoom = (3 × screenSize) / smallestPageSize`, capped at `Math.min(10, ...)`
  - New: increase the multiplier to allow higher zoom on standard pages, cap at `Math.min(deviceSettings.maxZoomLevel, ...)`
  - The multiplier `3` means "the viewport can show 1/3 of the smallest page dimension." To reach 10x on US Letter (612px) with a 1024px screen, we need `(M × 1024) / 612 >= 10`, so `M >= 5.98`. A multiplier of 6 works.
  - Use a zoom-level-dependent multiplier: `maxZoomLevel <= 5 ? 3 : 6`

### 4. Tile Memory Budget — `src/canvas/Renderer.ts`
- Pass `deviceSettings.tileMemoryBudgetMB * 1024 * 1024` as `maxMemoryBytes` in the `TileGridConfig` when calling `enableTiling()`
- Renderer needs to receive this value — either via constructor param or a method

### 5. PaperView / EmbeddedPaperModal Wiring
- Pass `deviceSettings.maxZoomLevel` into the dynamic zoom calculation
- Pass `deviceSettings.tileMemoryBudgetMB` to the Renderer's tile config
- Both PaperView and EmbeddedPaperModal need the same changes

### 6. Settings UI — `src/settings/SettingsTab.ts`
- Add "Max zoom level" dropdown: 5×, 10× (under a "Performance" or "Advanced" section)
- Add "Tile memory budget" dropdown: 200 MB, 400 MB, 600 MB, 1 GB
- When max zoom is 10×, enforce minimum memory budget of 400MB (warn or auto-adjust)

### 7. Validation
- If `maxZoomLevel = 10` and `tileMemoryBudgetMB < 400`, auto-bump to 400 and show a notice
- This prevents the tile cache from being too small to hold visible tiles at max zoom

## Files to Modify
1. `src/settings/DeviceSettings.ts` — New settings fields
2. `src/canvas/Camera.ts` — Make MAX_ZOOM a dynamic default, not a hard ceiling
3. `src/view/PaperView.ts` — updateZoomLimits(), enableTiling config, pass device settings
4. `src/embed/EmbeddedPaperModal.ts` — Same as PaperView
5. `src/canvas/Renderer.ts` — Accept memory budget in enableTiling()
6. `src/settings/SettingsTab.ts` — UI for the two new settings

## Not Changed
- TileTypes.ts — DEFAULT_TILE_CONFIG stays the same (maxTilePhysical=2048 is correct for 10x)
- WebGLTileCache.ts — LRU eviction already works with any budget
- StrokeSimplifier.ts — LOD thresholds unaffected
- Worker pipeline — receives config dynamically, no changes needed
