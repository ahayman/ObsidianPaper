# WebGL Anti-Aliasing and Self-Intersection Fix

## Problem

Two rendering issues in the WebGL pipeline:

1. **No anti-aliasing** — Stroke edges are jagged/pixelated. The WebGL context is created with `antialias: false`, the solid shader outputs flat color with no edge softening, and the stencil-based fill produces binary (in/out) coverage.

2. **Self-intersecting strokes have holes** — When a stroke's outline crosses itself, the overlapping region is unfilled. This happens because the stencil INVERT technique implements **even-odd fill** (overlap cancels out), while Canvas2D uses **nonzero winding rule** (overlap stays filled).

## Fix 1: Self-Intersection (Nonzero Winding Stencil)

**Files:** `src/canvas/engine/WebGL2Engine.ts`

Change `fillPath()` and `maskToPath()` from even-odd stencil INVERT to nonzero winding count:

### Current approach (even-odd):
- Pass 1: `stencilOp(KEEP, KEEP, INVERT)` on bit 0
- Pass 2: Test `EQUAL 0x01` — only fills where bit was flipped odd number of times

### New approach (nonzero winding):
- Pass 1: Use the **full 8-bit stencil** (not just bit 0) with two-sided stencil operations:
  - Front-facing triangles: `stencilOpSeparate(FRONT, KEEP, KEEP, INCR_WRAP)`
  - Back-facing triangles: `stencilOpSeparate(BACK, KEEP, KEEP, DECR_WRAP)`
  - `stencilFunc(ALWAYS, 0, 0xFF)`, `stencilMask(0xFF)`
  - Color writes disabled
  - Draw as `TRIANGLE_FAN` from vertex[0]
- Pass 2: Test `NOTEQUAL 0` — fills wherever winding count is nonzero
  - `stencilFunc(NOTEQUAL, 0, 0xFF)` (or incorporate clip mask if active)
  - `stencilOp(KEEP, KEEP, ZERO)` to auto-clear
  - Draw fullscreen quad (not TRIANGLE_FAN again) for efficiency and to ensure all marked pixels are covered

**Why fullscreen quad in pass 2:** The TRIANGLE_FAN in pass 2 might not cover all stencil-marked pixels (since the fan is from vertex[0] and may not cover the interior of self-intersections). A fullscreen quad ensures every marked pixel gets colored.

**Clip stencil interaction:** Currently clip uses higher stencil bits. The nonzero approach uses the lower bits (0-7) for winding count. We need to reserve the upper bits for clip. Options:
- Use stencil bits 0-6 for winding (mask `0x7F`), bit 7 for clip — supports winding count up to 127, more than sufficient
- Or keep the existing clip bit scheme and just use `stencilMask` to protect clip bits

### Changes needed:
1. In `fillPath()`: Replace INVERT with two-sided INCR_WRAP/DECR_WRAP, test NOTEQUAL 0, draw fullscreen quad for pass 2
2. In `maskToPath()`: Same stencil change for pass 1, adjust pass 2/3 accordingly
3. Enable `gl.enable(gl.CULL_FACE)` before pass 1 if not already — **actually no**, two-sided stencil works on both faces simultaneously without culling. Face determination is automatic from vertex winding.

## Fix 2: Anti-Aliasing

**Approach: Render at 2x resolution, downsample** — This is the simplest, most reliable AA for stencil-based rendering. Shader-based edge AA would require reworking the geometry pipeline to track edge distances, which is a larger change.

Actually, let me reconsider. The strokes are rendered into tiles, and tiles may already be at device pixel ratio. Let me think about what's simplest and most effective.

**Recommended approach: MSAA on offscreen FBOs**

Since stencil-based filling produces binary coverage, the most natural AA approach is MSAA which converts the binary stencil edges into multi-sampled coverage. The tiles render into FBOs anyway.

### Changes:

**File: `src/canvas/engine/GLTextures.ts`**
- Add a new function `createMSAAOffscreenTarget()` that creates:
  - A multisampled renderbuffer for color: `gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h)`
  - A multisampled renderbuffer for stencil: `gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.STENCIL_INDEX8, w, h)`
  - A resolve FBO with a regular texture for the resolved result
- Add `resolveMSAATarget()` function to blit from MSAA FBO to resolve FBO via `gl.blitFramebuffer()`

**File: `src/canvas/engine/WebGL2Engine.ts`**
- Modify `createOffscreen()` to optionally create MSAA targets
- Modify `drawOffscreen()` to resolve MSAA before sampling
- OR: Make the main rendering path use MSAA FBOs transparently

**Alternative simpler approach: Enable MSAA on the main canvas context**
- Change `antialias: false` to `antialias: true` in the constructor
- This gives free AA on the default framebuffer (the browser handles MSAA resolve)
- Tiles rendered via offscreen FBOs would NOT benefit from this, so this alone isn't sufficient

**Simplest viable approach: MSAA for tile FBOs**
- Tile rendering goes through offscreen FBOs (`WebGLTileEngine` creates offscreen targets for each tile)
- Make these FBOs multisampled
- Resolve before compositing tiles to screen

### Implementation plan for MSAA:

1. Add `sampleCount` parameter to `createOffscreenTarget()` (default 1 = no MSAA)
2. When `sampleCount > 1`:
   - Use `gl.renderbufferStorageMultisample()` for color and stencil attachments
   - Create a second "resolve" FBO with a regular texture attachment
3. Add `resolveOffscreenTarget(target)` that blits MSAA FBO → resolve FBO
4. In `drawOffscreen()`, if target is MSAA, resolve first then sample from the resolve texture
5. Pass `sampleCount: 4` (or detect max via `gl.getParameter(gl.MAX_SAMPLES)`) when creating tile render targets
6. Also need MSAA for ink-shading offscreen targets and grain isolation targets

## Implementation Steps

### Step 1: Fix self-intersection (nonzero winding)
1. Update `fillPath()` to use two-sided stencil with INCR_WRAP/DECR_WRAP
2. Update `maskToPath()` similarly
3. Verify clip stencil bits don't conflict
4. Test with self-intersecting strokes

### Step 2: Add MSAA support
1. Add MSAA offscreen target creation in `GLTextures.ts`
2. Add resolve function in `GLTextures.ts`
3. Update `WebGL2Engine` to support MSAA offscreen targets
4. Enable MSAA for tile rendering targets
5. Enable MSAA for ink-shading and grain isolation targets
6. Test AA quality

### Step 3: Build, test, deploy
1. `yarn build` + `yarn test`
2. `yarn build:copy` to deploy to Obsidian vault
3. Test on iPad with Apple Pencil
