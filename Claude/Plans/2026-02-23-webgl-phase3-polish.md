# Plan: Phase 3 — WebGL Tile Pipeline Polish & Bug Fixes

## Context

Phase 2 implemented the WebGL tile cache, compositor, and tile engine. Code review revealed several issues ranging from blank-screen-on-context-loss to memory waste. This phase fixes all of them.

## Issues to Fix

### HIGH Priority

**1. No context loss fallback (blank screen)**
- `useWebGLTiles` is never set to `false` on context loss
- Need `webglcontextlost` listener on `webglStaticCanvas` in TiledStaticLayer
- On loss: set `useWebGLTiles = false`, show staticCanvas, trigger re-render
- On restore: recreate GL resources, set `useWebGLTiles = true`, invalidate all

**2. Unused `getOffscreen` allocation + GLState pollution in WebGLTileEngine**
- `engine.getOffscreen("tile-fbo", ...)` allocates a wasted FBO
- Direct `gl.bindFramebuffer` bypasses GLState, causing stale cached state
- Fix: Remove the unused `getOffscreen` call, use `engine.beginOffscreen`/`endOffscreen` properly with a wrapper, OR reset GLState after manual FBO bind

### MEDIUM Priority

**3. Wasteful Canvas2D TileCache allocation in WebGL mode**
- `WorkerTileScheduler.schedule()` calls `this.cache.allocate()` for every tile even when `onTileResult` is set
- Fix: Skip `this.cache.allocate()` when `this.onTileResult` is set

**4. `getGL()` calls `getContext("webgl2")` repeatedly**
- Fix: Cache the GL context in a field during construction

**5. Per-tile Float32Array allocations in compositor**
- Fix: Reuse a single Float32Array buffer, only update values per tile
- Also cache the projection matrix, only recompute on canvas resize

**6. GLState coordination between TileEngine and Compositor**
- After compositor runs, engine's GLState is stale
- Fix: After compositor `composite()`, reset the engine's GLState so next tile render starts clean. Or: have the compositor reset GL state at end.

## Steps

### Step 1: Fix context loss (HIGH)
- In TiledStaticLayer constructor, when `webglCanvas` is provided, add `webglcontextlost`/`webglcontextrestored` listeners
- On loss: `useWebGLTiles = false`, clear glCache (GPU resources auto-destroyed)
- On restore: re-init WebGLTileEngine, WebGLTileCompositor, WebGLTileCache, set `useWebGLTiles = true`, invalidate all tiles

### Step 2: Fix WebGLTileEngine FBO management (HIGH)
- Remove the unused `engine.getOffscreen("tile-fbo")` call
- Cache the GL context instead of calling `getContext("webgl2")` repeatedly
- Clean up the render flow: bind FBO, set viewport, set projection, render, unbind

### Step 3: Fix WorkerTileScheduler waste (MEDIUM)
- Skip `this.cache.allocate()` when `this.onTileResult` is set

### Step 4: Optimize compositor allocations (MEDIUM)
- Reuse a single Float32Array(16) for quad vertices
- Cache projection matrix, recompute only when dimensions change

### Step 5: Fix GLState coordination (MEDIUM)
- After compositor.composite(), the engine's GLState caches are wrong
- Solution: Have compositor save/restore minimal GL state, or have engine's GLState expose a `reset()` method to invalidate caches

### Step 6: Build, test, deploy
