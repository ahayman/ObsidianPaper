# Diagnostic: Strip Down to Bare Drawing

## Goal
Isolate whether the missed-stroke problem is in pointer event delivery or in our processing pipeline.

## Approach
Disable everything except raw point collection and canvas rendering:
- No input smoothing (OneEuroFilter)
- No prediction rendering
- No stroke finalization / encoding
- No spatial index, undo, save, bake
- No palm rejection side-effects
- Render active stroke directly, commit raw points to static canvas on stroke end

Add `renderPointsToStatic()` to Renderer for direct raw-point rendering without encode/decode roundtrip.

If strokes still get missed → problem is in pointer event delivery / InputManager.
If strokes work fine → re-enable features one at a time to find the culprit.
