# Shared MSAA Scratch Buffer for Tile Rendering (Options A + B)

**Date:** 2026-05-18
**Research:** `Claude/Research/2026-05-18-webgl2-antialiasing-options.md`

## Goal

Stop allocating MSAA renderbuffers per cached tile. Today every `GLTileEntry`
holds its own `GLMSAAOffscreenTarget` (`px × 24` bytes at 4× MSAA) for its whole
cached lifetime, even though the multisampled buffers are scratch — used only
during the tile's `renderTile()` call. Replace this with **one shared MSAA scratch
target** that all tiles render through. Per-tile storage drops to a plain color
texture (`px × 4`, **6×** smaller); total MSAA storage goes from O(tile count) to
one fixed allocation.

- **Option A** — shared MSAA scratch + explicit `blitFramebuffer` resolve. Works
  everywhere, no extension. The mandatory baseline.
- **Option B** — when `WEBGL_multisampled_render_to_texture` is present, use
  implicit-resolve (`framebufferTexture2DMultisampleEXT`) so the multisample
  samples stay in on-chip tile memory on the iPad's TBDR GPU. Layered on A,
  runtime-detected, A is the fallback.

## Design

### Tile entries hold only a texture

`GLTileEntry` currently carries `fbo: GLOffscreenTarget | null` and
`msaa: GLMSAAOffscreenTarget | null`. Both are removed. A tile entry becomes a
plain `texture: WebGLTexture` plus a boolean discriminator `fboRendered`
(`true` = rendered via `renderTile`, Y-flipped; `false` = worker bitmap upload,
not flipped). All FBOs move to the engine side.

### New: `MSAAResolver` (`src/canvas/engine/MSAAResolver.ts`)

A single engine-owned object that provides a multisampled render target sized to
`maxTilePhysical` and resolves tile content into a caller-supplied texture. Two
modes, chosen once at construction:

- **explicit** (no extension): owns `msaaFBO` + multisampled color RB + multisampled
  stencil RB (all `maxTilePhysical²`), plus a `resolveFBO`.
  - `beginTile(tex, w, h)` — `bindFramebuffer(msaaFBO)`, `viewport(0,0,w,h)`.
  - `endTile(tex, w, h)` — point `resolveFBO`'s `COLOR_ATTACHMENT0` at `tex` via
    `framebufferTexture2D`, then `blitFramebuffer(msaaFBO → resolveFBO, 0,0,w,h)`
    (MSAA resolve).
- **implicit** (extension present): owns `scratchFBO` + one shared multisampled
  stencil RB created via `renderbufferStorageMultisampleEXT`.
  - `beginTile(tex, w, h)` — `bindFramebuffer(scratchFBO)`, attach `tex` as the
    color attachment via `framebufferTexture2DMultisampleEXT(..., samples)`,
    `viewport(0,0,w,h)`.
  - `endTile` — no-op; the implicit resolve happens when the texture is next
    sampled (by the compositor) or re-pointed (next tile).

Mode selection: `gl.getExtension("WEBGL_multisampled_render_to_texture")`, then
verify `typeof ext.framebufferTexture2DMultisampleEXT === "function"` and
`typeof ext.renderbufferStorageMultisampleEXT === "function"`. Build the implicit
target and **probe `checkFramebufferStatus`** with a dummy texture; if not
`FRAMEBUFFER_COMPLETE`, tear down and fall back to explicit mode. This makes B
safe even on drivers that expose but mishandle the extension.

`samples = min(4, gl.getParameter(gl.MAX_SAMPLES))` (WebGL2 guarantees ≥ 4).
Scratch sized to `config.maxTilePhysical` (1024 on mobile → one 1024² 4×MSAA
renderbuffer, which `Renderer.ts` already documents as the reliable size; 2048 on
desktop). Tiles are clamped to `maxTilePhysical` by `tileSizePhysicalForBand`, so
the scratch always fits any tile. `destroy()` frees all GL objects.

### `WebGL2Engine.beginOffscreen()` is out of scope

It has its own MSAA targets pooled by id (`offscreens` map) — a separate, bounded,
non-O(tiles) usage. Leave it and all the `GLTextures` MSAA helpers it depends on
(`createMSAAOffscreenTarget`, `resolveMSAA`, `destroyMSAAOffscreenTarget`,
`createOffscreenTarget`, `destroyOffscreenTarget`, `resizeOffscreenTarget`)
untouched.

## Files & changes

1. **`src/canvas/engine/MSAAResolver.ts`** — *new*. The class above.

2. **`src/canvas/tiles/WebGLTileCache.ts`**
   - `GLTileEntry`: drop `fbo` and `msaa`; add `fboRendered: boolean`.
   - Drop `msaaSamples` / `msaaMaxBand` / `samplesForBand`. Constructor →
     `(gl, config)`.
   - `allocate()` — create a plain texture via `createColorTexture`; no MSAA/FBO
     branch; set `fboRendered = true`.
   - `uploadFromBitmap()` — set `fboRendered = false`.
   - `memoryBytesFor()` → `px * 4`.
   - `destroyEntry()` → `gl.deleteTexture(entry.texture)`.
   - `allocateEntryTarget()` collapses to a texture (re)allocation.
   - Drop imports of the offscreen-target helpers; import `createColorTexture`.

3. **`src/canvas/tiles/WebGLTileEngine.ts`**
   - Own `private resolver: MSAAResolver`, created in the constructor from
     `config.maxTilePhysical`; recreate on `webglcontextrestored`; `destroy()` it.
   - `renderTile()` — guard on `!entry.fboRendered`; replace the
     `bindFramebuffer` + `viewport` with `resolver.beginTile(entry.texture, …)`;
     keep `engine.invalidateFramebuffer()` (stencil discard); replace
     `resolveMSAA` with `resolver.endTile(entry.texture, …)`.

4. **`src/canvas/tiles/WebGLTileCompositor.ts`** — `isFBO` (lines 167, 177) →
   `entry.fboRendered`.

5. **`src/canvas/Renderer.ts`**
   - Remove `MSAA_MAX_BAND`; both `new WebGLTileCache(gl, config, 4, MSAA_MAX_BAND)`
     → `new WebGLTileCache(gl, config)`.
   - Line ~1698 `existing?.fbo` → `existing?.fboRendered`.
   - Refresh now-stale MSAA comments in `enableTiling` (the renderbuffer-size
     reasoning now describes the single shared scratch, not per-tile buffers).

6. **Tests** — `WebGLTileCache.test.ts`, `WebGLTileEngine.test.ts`,
   `WebGLTileCompositor.test.ts`: drop `entry.msaa`/`entry.fbo` assertions and the
   MSAA-mode/`MSAA_MAX_BAND` tests; assert `fboRendered` and `px*4` memory;
   extend the mock GL with `blitFramebuffer`, `renderbufferStorageMultisample`,
   `framebufferRenderbuffer`, `checkFramebufferStatus`, `getExtension`,
   `getParameter(MAX_SAMPLES)`. Add focused `MSAAResolver` coverage (explicit mode
   under a mock GL; mode selection falling back when the extension is absent).

## Steps

1. Add `MSAAResolver`.
2. Simplify `WebGLTileCache` (entry shape, memory, constructor).
3. Wire `MSAAResolver` into `WebGLTileEngine.renderTile` + lifecycle.
4. Update `WebGLTileCompositor` + `Renderer.ts`.
5. Update/extend tests.
6. `yarn build` + `yarn test`; fix.
7. `yarn build:copy`.

## Risks & notes

- **Mode B may never run on the iPad** — Safari support for the extension is
  unconfirmed and historically absent. That is acceptable: A alone fixes the
  memory problem and the per-allocation renderbuffer pressure (one 1024² scratch
  vs. N). B is a TBDR optimization that benefits Chrome/Electron now and Safari if
  it ever ships the extension.
- **`maxMemoryBytes` is left unchanged** — it is an eviction ceiling, not a
  target. Real working-set memory drops ~5–6× because tiles are no longer fat;
  the ceiling can optionally be lowered later as separate tuning.
- **`MSAA_MAX_BAND` removal** — with shared scratch, MSAA cost is no longer
  per-tile, so the deep-zoom non-MSAA cliff is pointless; all tiles get MSAA. Net
  simplification and a small quality gain at deep zoom.
- Per-frame re-pointing of a shared FBO's color attachment is a cheap state
  change at tile-render frequency (tens of tiles/frame).
- Scratch is sized to `maxTilePhysical`; lazy-growing it to the largest tile
  actually used is a possible later optimization, not done here.
