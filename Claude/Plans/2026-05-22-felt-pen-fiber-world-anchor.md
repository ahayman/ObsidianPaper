# Felt Pen Fiber Overlay — World-Space Anchoring

**Date:** 2026-05-22
**Status:** Implemented 2026-05-22 — superseded the same day by
`2026-05-22-felt-pen-flow-buildup.md`, which removes the fiber-overlay machinery
entirely (the felt pen becomes a particle-flow brush).
**Area:** Felt-tip (marker) rendering — fiber overlay texture

## Summary

The felt-tip pen's fiber-streak texture slides under the stroke while drawing and
jumps when the stroke is baked. The root cause: the fiber overlay is **not anchored
in world space**. It is tiled relative to transient buffers (the active offscreen
canvas / the WebGL tile viewport) and offset by the stroke's bounding-box minimum.
As the stroke grows — especially leftward, which moves `bbox[0]` — the overlay
re-tiles at a different position every frame. Worse, the three code paths that draw
the fiber each use a *different* coordinate system, so the pattern visibly shifts
when an active (Canvas2D) stroke becomes a baked (WebGL) tile.

The fix: sample the fiber as a deterministic function of **world position**, identical
in every path — exactly the principle the pencil grain already uses
(`computeGrainOpacity(worldX, worldY, …)` in `StampRenderer.ts`).

## Symptoms (reported)

1. "The underlying pattern of the entire stroke follows my pen as it moves to the
   left" — the fiber texture is pulled along the minimum-x axis as the stroke grows.
2. "The entire pattern shifts when the stroke is baked into WebGL" — the active
   (pre-bake) and baked rendering use different fiber logic.

## Root Cause Analysis

### The fiber overlay

Felt-tip strokes are drawn as rotated rounded-rectangle stamps onto an isolation
offscreen, then a tileable anisotropic-noise texture (`generateFiberOverlayCanvas`,
`src/stamp/MarkerStampTexture.ts:206`) is composited with `destination-out` to carve
visible fiber streaks. This overlay is the "static image" the user sees sliding.

### Three paths, three coordinate systems — none world-anchored

| Path | Where | How the fiber is positioned |
|------|-------|------------------------------|
| **A. Active stroke** (Canvas2D) | `Renderer.renderActiveStroke` → `executeMaterial(Canvas2DBackend)` → `MaterialExecutor.applyFiberOverlay` → `Canvas2DBackend.applyGrain(…, pixelAligned=true)` (`Canvas2DBackend.ts:173`) | `setTransform(1,0,0,1, bbox[0], bbox[1])` then fills a `"repeat"` pattern. Pattern is in **device-pixel space**, translated by the world-space bbox minimum. `pixelAligned` is ignored. |
| **B. Committed, Canvas2D** | `renderStrokeToContext` → `drawMarkerStampsToContext` (`StrokeRenderCore.ts:495`) | Tiles `getFiberOverlay()` with `setTransform(1,0,0,1,0,0)` (identity) in **offscreen-buffer-pixel space**, starting at `-(bbox[0] mod 128)`. |
| **C. Committed, WebGL** | `renderStrokeToEngine` → `executeMaterial(WebGLBackend)` → `WebGL2Engine.applyGrain(…, pixelAligned=true)` (`WebGL2Engine.ts:1114`) | Fullscreen quad; `GRAIN_FRAG` computes `uv = (v_texcoord + u_offset) * u_scale` where `v_texcoord` is the **tile-viewport UV**. Offset is `bbox[0] * scale²` (dimensionally wrong). |

In every path the fiber anchor is `fiberAnchor = [stroke.bbox[0], stroke.bbox[1]]`
(set in `StrokeDataPreparer.ts:142` and `:238`, and `StrokeRenderCore.ts:170`).

### Why it slides on the min-x axis

`bbox[0]` is the stroke's minimum x. It only changes when the pen draws *further
left*; drawing right/down leaves it fixed. Each frame the in-progress stroke is
re-rendered: when `bbox[0]` decreases, both the offscreen buffer origin **and** the
fiber tiling offset move, so the whole overlay translates with the pen. Drawing
right does not move `bbox[0]`, so the pattern looks pinned to the left edge — "pulled
on the min x-axis."

### Why it jumps when baked

Path A tiles in the active offscreen's device pixels; Path C tiles in the WebGL
tile's viewport UVs. These are unrelated coordinate frames, so the moment a stroke
transitions from active (A) to baked (C) the fiber pattern relocates.

### The pencil, by contrast

The pencil never tiles a texture. `computeGrainOpacity(x, y, grainValue, diameter)`
(`StampRenderer.ts:418`) evaluates `smoothNoise2D` at **world coordinates** and bakes
the result into each particle's alpha. The same function runs in the active and
baked paths, so the grain is a fixed function of world position — it never slides
and never jumps. That is the property we want for the felt-tip fiber.

## Design Principle

**The fiber overlay must be sampled at `worldPos / FIBER_WORLD_SIZE`, with a
REPEAT-wrapped texture, identically in every backend.**

- `FIBER_WORLD_SIZE` = the world-space side length one fiber tile covers.
- World-anchored ⇒ the pattern is fixed to the page: it does not slide as the stroke
  grows (fixes symptom 1) and zooms/pans with the document like real ink fiber.
- Identical mapping in both backends ⇒ active and baked agree (fixes symptom 2).
- The per-stroke `fiberAnchor` is **removed**. Every stroke samples one global
  world-locked fiber field. Overlapping strokes still layer correctly because each
  is a separate `destination-out` pass inside its own isolation offscreen; they do
  not need *different* patterns. A single shared field is also more physically
  honest — fiber is a property of pen + paper, not of an individual stroke.

### Deliberate behavior change

Today the fiber is a fixed **screen-pixel** size (≈128 device px regardless of
zoom). After this change it is a fixed **world-space** size and therefore zooms with
the page. This is correct (a screen-locked texture would swim across the ink during
pan/zoom) and matches the pencil grain. Called out here so it is a conscious choice.

## Implementation

### 1. Define the world tile size

In `src/stamp/MarkerStampTexture.ts`, export a constant:

```ts
/** World-space side length covered by one fiber overlay texture tile. */
export const FIBER_WORLD_SIZE = 64; // tune visually; see Testing
```

Starting value is a tuning target — pick so the fiber looks right at zoom 1. The
fiber texture is 128 px and seamlessly tileable (torus-mapped 4D noise), so REPEAT
wrapping is valid.

### 2. New backend method: `applyFiberOverlay`

Add a dedicated method rather than overloading `applyGrain`. `applyGrain`'s
`pixelAligned` flag is used *only* by the fiber path (confirmed: the only
`applyGrain(…, true)` call site is `MaterialExecutor.ts:292`), so fiber can move out
cleanly and `applyGrain` keeps its existing pencil-grain behavior untouched.

Contract:
```ts
applyFiberOverlay(texture, worldTileSize: number, strength: number): void
```
No anchor parameter — the world origin is the anchor. Each backend maps world →
fiber UV using its own current transform.

Files (mirror everywhere `applyGrain` is declared/implemented):

- **`src/rendering/DrawingBackend.ts`** — add `applyFiberOverlay` to the interface.
- **`src/canvas/engine/RenderEngine.ts`** — add `applyFiberOverlay` to the interface.
- **`src/rendering/WebGLBackend.ts`** — delegate to `engine.applyFiberOverlay`.
- **`src/canvas/__tests__/RecordingEngine.ts`** — record the call (test engine).

### 3. Canvas2D backend (`Canvas2DBackend.applyFiberOverlay`)

The active offscreen ctx already carries the world→device transform. Use a
`"repeat"` pattern whose pattern-space equals world-space, anchored at world origin:

```ts
applyFiberOverlay(texture, worldTileSize, strength) {
  const ctx = this.activeCtx;
  const worldTransform = ctx.getTransform();          // world → device
  const tex = texture as Canvas2DTextureRef;
  if (!tex.pattern) tex.pattern = ctx.createPattern(tex.source, "repeat");
  if (!tex.pattern) return;
  // texture-px → world (scale), then world → device (worldTransform)
  const s = worldTileSize / tex.width;
  tex.pattern.setTransform(worldTransform.multiply(new DOMMatrix([s, 0, 0, s, 0, 0])));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);                 // fill in device space
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = strength;
  ctx.fillStyle = tex.pattern;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
```

No bbox, no anchor — the pattern transform includes only `worldTransform` (the
camera), which is constant as the stroke grows ⇒ no slide. `createPattern` +
`setTransform` is already used by the existing `Canvas2DBackend.applyGrain`, so this
is consistent with proven code on this path.

### 4. WebGL engine (`WebGL2Engine.applyFiberOverlay`)

Add a fiber fragment shader to `src/canvas/engine/shaders.ts` (reuse `GRAIN_VERT`):

```glsl
// FIBER_FRAG
uniform sampler2D u_texture;
uniform float u_strength;
uniform vec2  u_worldOrigin;   // world coord at quad UV (0,0)
uniform vec2  u_worldExtent;   // world delta across quad UV (0→1)
uniform float u_worldTileSize;
in  vec2 v_texcoord;
out vec4 fragColor;
void main() {
  vec2 worldPos = u_worldOrigin + v_texcoord * u_worldExtent;
  vec2 uv = worldPos / u_worldTileSize;               // REPEAT-wrapped texture
  float fiber = texture(u_texture, uv).a;
  fragColor = vec4(fiber * u_strength);
}
```

`applyFiberOverlay` draws the fullscreen quad with `destination-out` (like
`applyGrain`) but supplies `u_worldOrigin` / `u_worldExtent`:

- `combined = mat3Multiply(this.projection, this.currentTransform)` maps world → clip.
- Invert `combined` (add a `mat3Invert` helper next to `mat3Multiply` in
  `WebGL2Engine.ts` — these are 2D-affine matrices, so the inverse is trivial).
- Map the two UV-extreme corners of the fullscreen quad to clip space using the
  **same UV↔clip convention as `fullscreenQuadVBO`** (read the VBO layout to confirm
  orientation / Y direction), then through the inverse to world space.
- `u_worldOrigin` = world at UV (0,0); `u_worldExtent` = world(UV 1,1) − world(UV 0,0).

This makes the WebGL fiber UV `worldPos / u_worldTileSize` — identical to the
Canvas2D mapping in §3.

### 5. WebGL fiber texture must use REPEAT wrap

`worldPos / worldTileSize` ranges far outside [0,1]; the texture must wrap.

- `GLTextures.ts:63` `createGrainTexture` already sets `TEXTURE_WRAP_S/T = REPEAT`.
- `WebGLTileEngine.ts:236` already uses `createGrainTexture` for the fiber — correct.
- **`TileRenderer.ts:307` uses `createTexture` (CLAMP_TO_EDGE).** Audit: if that
  `engine` is WebGL, switch to `createGrainTexture`. If it is `Canvas2DEngine`, wrap
  mode is irrelevant.
- `Renderer.ts:1338` uses `Canvas2DBackend.createTexture` — Canvas2D, REPEAT comes
  from `createPattern`, fine.

### 6. Canvas2D *engine* (`Canvas2DEngine.applyFiberOverlay`)

`Canvas2DEngine` implements `RenderEngine` (`applyGrain` at `Canvas2DEngine.ts:333`).
It is reachable when `renderStrokeToEngine` wraps a Canvas2D engine. Implement
`applyFiberOverlay` mirroring §3 (it has a ctx + transform like `Canvas2DBackend`).

### 7. `drawMarkerStampsToContext` (committed Canvas2D path B)

`StrokeRenderCore.ts:495` hand-rolls fiber tiling. Make it world-anchored too:
- Drop the `fiberAnchor` parameter.
- Replace the identity-transform tile loop (`StrokeRenderCore.ts:553-569`) with
  world-space tiling: keep the offscreen's world transform `m` and either
  `drawImage` the fiber tile at world positions `k * FIBER_WORLD_SIZE` covering the
  region, or use `createPattern` + `setTransform` as in §3.
- Extract the world→fiber math into a small shared helper so paths B and the
  Canvas2D backend cannot drift apart.
- Remove the `fiberAnchor` construction at `StrokeRenderCore.ts:170`.

### 8. Remove `fiberAnchor` plumbing

- `src/rendering/MaterialExecutor.ts`: drop `fiberAnchor` from `StrokeRenderData`
  (the interface, ~line 51); `applyFiberOverlay` (~line 281) calls
  `backend.applyFiberOverlay(resources.fiberOverlayTexture, FIBER_WORLD_SIZE, strength)`.
- `src/rendering/StrokeDataPreparer.ts`: delete the `fiberAnchor` blocks in both
  `prepareStrokeData` (lines 140-143) and `prepareActiveStrokeData` (lines 235-239).

### 9. Optional cleanup

With fiber on its own method, `applyGrain`'s `pixelAligned` parameter is dead. It
can be removed from `DrawingBackend`, `Canvas2DBackend`, `WebGLBackend`,
`RenderEngine`, `WebGL2Engine`, `Canvas2DEngine`, and `RecordingEngine` — and
`GRAIN_FRAG`'s `u_offset`/`u_scale` path simplified — in a follow-up commit. Keep it
out of the core fix to limit blast radius.

## Files Touched

| File | Change |
|------|--------|
| `src/stamp/MarkerStampTexture.ts` | Export `FIBER_WORLD_SIZE` |
| `src/rendering/DrawingBackend.ts` | Add `applyFiberOverlay` to interface |
| `src/rendering/Canvas2DBackend.ts` | Implement `applyFiberOverlay` (world pattern) |
| `src/rendering/WebGLBackend.ts` | Delegate `applyFiberOverlay` |
| `src/canvas/engine/RenderEngine.ts` | Add `applyFiberOverlay` to interface |
| `src/canvas/engine/WebGL2Engine.ts` | Implement `applyFiberOverlay`; add `mat3Invert` |
| `src/canvas/engine/Canvas2DEngine.ts` | Implement `applyFiberOverlay` |
| `src/canvas/engine/shaders.ts` | Add `FIBER_FRAG` |
| `src/canvas/__tests__/RecordingEngine.ts` | Record `applyFiberOverlay` |
| `src/rendering/MaterialExecutor.ts` | Remove `fiberAnchor`; call `applyFiberOverlay` |
| `src/rendering/StrokeDataPreparer.ts` | Remove `fiberAnchor` (both preparers) |
| `src/canvas/StrokeRenderCore.ts` | World-anchor `drawMarkerStampsToContext`; drop `fiberAnchor` |
| `src/canvas/tiles/TileRenderer.ts` | Fiber texture REPEAT wrap (if WebGL engine) |

## Testing

### Automated (`yarn test`)
- Update `MaterialExecutor.test.ts` — fiber effect now calls `applyFiberOverlay`,
  not `applyGrain(…, true)`.
- Update `StrokeDataPreparer.test.ts` — drop `fiberAnchor` expectations.
- Update `Canvas2DBackend.test.ts` / `WebGLBackend.test.ts` — add `applyFiberOverlay`.
- **New regression test** for the core property: the world→fiber-UV mapping is a
  pure function of world position and is **independent of stroke bbox**. Put the
  mapping in a testable helper and assert that two strokes with different bboxes
  produce the same UV for the same world point. This directly guards symptom 1.

### Manual (build → `yarn build:copy` → iPad)
- Draw a long felt-tip stroke leftward: the fiber streaks must stay fixed on the
  page, not drag with the pen tip.
- Watch a stroke bake (active → committed): the fiber pattern must not jump.
- Overlapping felt-tip strokes still show layered fiber.
- Pan and zoom: fiber stays locked to the page (zooms with content).
- Tune `FIBER_WORLD_SIZE` so streak scale looks right at zoom 1.

## Risks & Considerations

- **WebGL world-rect math** is the subtle part. Verify the UV↔clip convention
  against `fullscreenQuadVBO` (Y orientation) so the inverse-mapped world rect is
  correct. A wrong sign yields a mirrored/offset fiber.
- **Zoom-in softness:** a 128 px texture stretched in world space goes soft (LINEAR
  filter) at deep zoom. Acceptable for organic fiber; a higher-res fiber texture is
  a possible follow-up.
- **`DOMMatrix` in tests:** §3 uses `DOMMatrix.multiply` / the array constructor —
  already used elsewhere in the codebase; confirm the obsidian mock / jsdom support
  it, otherwise factor the 2×3 affine math into a plain helper.
- **Tile worker:** `tileWorker.ts` has its own `applyGrainToStroke`. Confirm the
  worker does not separately render felt-tip strokes; if it does, it needs the same
  world-anchored fiber treatment.

## Out of Scope

- Making fiber streaks follow stroke *direction* (the overlay is a global wash;
  per-stamp fiber in the stamp texture already follows direction). Pre-existing.
- Rewriting felt-tip to a particle model like the pencil. The overlay architecture
  is fine once world-anchored; this plan delivers the pencil's *property*
  (world-locked, consistent, non-sliding) without that rewrite.
- The `applyGrain` `pixelAligned` cleanup (§9) — separate follow-up commit.
