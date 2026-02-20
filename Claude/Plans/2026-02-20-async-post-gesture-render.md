# Async Post-Gesture Render

## Problem

When a pan/zoom gesture ends, `renderVisible()` synchronously re-renders all visible tiles at the correct zoom band. This blocks the UI for ~500ms. Users commonly release and immediately start a new gesture, but the UI is frozen during the re-render.

## Solution

Make `renderVisible()` only synchronously render tiles that are **truly missing** (no cached content at all — would be blank spots). For tiles that have stale content (dirty or wrong zoom band), schedule them for async background rendering via the existing `TileRenderScheduler`. The stale content remains visible while new content renders progressively.

### Behavior

- **Truly missing tiles**: rendered synchronously (blank spots are unacceptable)
- **Wrong zoom band tiles**: shown at old resolution, re-rendered asynchronously
- **Dirty tiles**: shown with stale content, re-rendered asynchronously
- **User starts new gesture**: scheduler is cancelled/replaced, stale content remains (perfectly usable)

### Changes

1. **`renderVisible()`**: Only sync-render missing tiles. Collect dirty + wrong-band tiles and schedule them. Composite immediately with whatever is available.

2. **`renderOneTile()`**: Update skip condition to check both dirty flag AND zoom band (skip only if clean at the correct band).

3. **Protection**: Keep visible tiles protected from eviction for the duration of async rendering (don't unprotect until next `renderVisible`, `gestureUpdate`, or `endGesture`).
