# iPad Crash + Stutter on Zoom + Rotate — Investigation

## Symptom

User reports that on iPad (Safari WebView via Obsidian), zooming in while rotating reliably crashes the plugin and triggers an Obsidian reload. Stutter is also observable during zoom even when the rendering pipeline is set to "basic". User believes this is a recent regression — within the last day or two.

## What's NOT it

- **Not file-format related.** Reproducible on legacy `.paper` files, which bypass all the recent `.paper.md` / fingerprint / Dataview-hooks / `paper-plugin: parsed` work.
- **Not the dirty-indicator hot path.** Pan/zoom/rotate doesn't fire `requestSave()` (verified — every requestSave call site in PaperView is tied to actual content changes). No saves, no `vault.modify`, no fingerprint or timestamp comparisons during gestures.
- **Not the active-stroke engine.** `activeEngine` was dead code; active strokes always rendered via `activeCtx` (Canvas 2D). Removing the dead field changed nothing about active rendering. Tiles have always been WebGL2 and still are.
- **Not the recent WebGL2 changes.** The constructor now retries with relaxed options if `{antialias: true, stencil: true}` is refused, but on tile canvases (which had no prior 2D context) the first-attempt options succeed; the retry path is for the active-canvas attempt that was always going to fail anyway.

## Working hypotheses

In rough order of likelihood:

1. **GPU memory pressure under zoom + rotate.** Per-tile MSAA buffers run ~5 MB at moderate zoom (per memory). Combined with rotation forcing many tiles to re-render at a new transform, total GPU memory across active+pending tiles may exceed iPad Safari's threshold and trigger the WebKit GPU watchdog.
2. **Tile cache thrash at deep zoom.** Each zoom level instantiates new tiles. Continuous zoom means tile cache continuously inflates. Once it crosses a memory boundary, eviction churn → main-thread stalls → stutter.
3. **CSS transform compounding.** Active/prediction canvases get CSS transforms during pan/pinch gestures and are cleared via `clearGestureTransform()` on gesture end including pointercancel. If the cleanup misses an event (e.g., gesture interrupted by the rotate trigger), transforms compound across gestures → visual artifacts and possibly extra layout work.
4. **iPadOS / Safari change.** Independent of our code; possible if user updated iPadOS recently.
5. **iCloud sync mismatch.** iPad has stale `main.js`; local vault changes haven't synced. Ruling this out should be fast — user can manually verify the engine indicator says "WebGL 2" after their next test (it now reflects tile WebGL truthfully, so a stale main.js would show wrong indicator).

## Diagnostic plan

User has agreed to an on-screen overlay that prints during gestures since iPad has no console access. Plan:

1. **Add a diagnostic overlay component** (~50 lines), conditionally rendered. Shows:
   - Current frame time (ms) — updated each rAF
   - Tile count: in cache / pending render
   - GPU memory estimate: sum of `tileWidth * tileHeight * 4 * 4 (RGBA + 4× MSAA)` across active tiles, per memory's 5 MB/tile observation
   - Camera state: zoom, rotation
   - "Last gesture cleanup" timestamp — to spot transform compounding
2. **Toggle behavior**: gated behind a setting (e.g. `Debug overlay`) so it only renders when the user enables it. Disabled in normal use to keep the indicator overlay area uncluttered.
3. **What to watch on iPad**:
   - Just before crash: does GPU memory estimate climb and then disappear (suggests OOM kill)?
   - Frame time during stutter: is it consistently >16ms or spiking?
   - Tile cache count: does it grow without bound during zoom?
   - Last gesture cleanup: does it stop updating before crash?

## Possible mitigations (depending on finding)

- **GPU memory pressure**: cap active MSAA tiles based on Platform.isMobile, or fall back to non-MSAA tiles on iPad when total estimated memory crosses a threshold.
- **Tile cache thrash**: tighter eviction on iPad — drop tiles outside a small radius of the viewport at deep zoom.
- **CSS transform compounding**: add a defensive cleanup on every gesture start (clear before applying new transform) so a missed cleanup from the previous gesture can't accumulate.
- **iPadOS/Safari**: if confirmed external, document and possibly disable affected paths conditional on `navigator.userAgent`.

## Files most likely relevant

- `src/canvas/Renderer.ts` — top-level orchestrator; tile setup, gesture transforms, MSAA configuration.
- `src/canvas/tiles/WebGLTileCache.ts` — tile cache eviction policy.
- `src/canvas/tiles/WorkerTileScheduler.ts` — tile render scheduling under load.
- `src/canvas/tiles/TileGrid.ts` — visible-tile computation; likely involved in zoom/rotate transform math.
- `src/input/InputManager.ts` — gesture handling, possibly `clearGestureTransform` call sites.

## Validation

After landing the diagnostic overlay:
1. User reproduces the crash with overlay enabled.
2. Notes which numbers spike just before the crash.
3. Reports back. We pick the matching mitigation based on signal.
