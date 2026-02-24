# WebGL MSAA Tile FBOs

## Problem
WebGL stencil-based fills produce binary coverage (no sub-pixel AA), causing jagged stroke edges. The self-intersection fix (two-sided stencil) is now correct, so MSAA should work cleanly.

## Approach
Add 4x MSAA to tile FBOs. Strokes render into a multisampled renderbuffer, then blit (resolve) to the regular texture for compositing.

### Architecture
- **MSAA FBO** (render target): multisampled color renderbuffer + multisampled stencil renderbuffer
- **Resolve FBO** (existing): regular color texture + no stencil needed
- After rendering strokes, `blitFramebuffer()` resolves MSAA → texture

### Changes

#### 1. GLTextures.ts — New MSAA offscreen target
- Add `GLMSAAOffscreenTarget` interface extending `GLOffscreenTarget` with:
  - `msaaFBO: WebGLFramebuffer` — the multisampled FBO for rendering
  - `msaaColorRB: WebGLRenderbuffer` — multisampled color renderbuffer
  - `msaaStencilRB: WebGLRenderbuffer` — multisampled stencil renderbuffer
  - `samples: number` — actual MSAA sample count
- The existing `fbo` + `colorTexture` become the resolve target
- Add `createMSAAOffscreenTarget()`, `resolveMSAA()`, `destroyMSAAOffscreenTarget()`

#### 2. WebGLTileCache.ts — Use MSAA targets
- Change `allocate()` to create MSAA targets instead of regular targets
- Update `GLTileEntry.fbo` type to `GLMSAAOffscreenTarget | null`
- Update destroy/eviction paths

#### 3. WebGLTileEngine.ts — Bind MSAA FBO + resolve
- In `renderTile()`: bind `entry.fbo.msaaFBO` instead of `entry.fbo.fbo`
- After rendering: call `resolveMSAA()` to blit to the resolve texture
- The compositor reads the resolve texture (unchanged)

### No changes needed
- **WebGLTileCompositor** — reads `entry.texture` which is still the resolve color texture
- **WebGL2Engine** — rendering code is unchanged, just targets a different FBO
- **Shaders** — no shader changes needed

## Fallback
Query `gl.getParameter(gl.MAX_SAMPLES)` to cap sample count. Fall back to 0 (no MSAA) if not supported.
