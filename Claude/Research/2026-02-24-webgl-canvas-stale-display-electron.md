# WebGL Canvas Stale Display in Electron/Chromium

## Date: 2026-02-24

## Problem Statement

A WebGL2 canvas renders correctly to its drawing buffer (confirmed via `readPixels`), but the browser/Electron compositor does not visually update the on-screen display after the initial frame. The canvas continues to show the first frame visually, even though subsequent draws complete successfully at the GPU level.

### Environment
- Obsidian plugin (Electron/Chromium)
- `preserveDrawingBuffer: true` on WebGL2 context
- WebGL canvas has `position: absolute` with no z-index
- Multiple Canvas2D canvases stacked on top (higher z-index: 1, 2, 3)
- Already tried: CSS opacity toggle, drawImage to Canvas2D, readPixels + putImageData

---

## Root Cause Analysis

### How WebGL Presentation Works in Chromium

Per the [WebGL Specification](https://registry.khronos.org/webgl/specs/latest/1.0/):

> "WebGL presents its drawing buffer to the HTML page compositor immediately before a compositing operation, but only if at least one of the following have occurred since the previous compositing operation: context creation, canvas resize, or any draw operation called while the drawing buffer is the currently bound framebuffer."

Key points:
1. The drawing buffer is only **presented** when the compositor runs AND draws have occurred
2. The compositor decides **when** to composite -- it is not directly under JS control
3. With `preserveDrawingBuffer: true`, the buffer is not cleared after presentation

### Chromium's GPU Compositing Architecture

Per [GPU Accelerated Compositing in Chrome](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/):

- Each canvas gets its own **compositing layer**
- GPU-rendered content (WebGL) renders into a **texture via FBO** that the compositor context grabs
- The compositor decides when to re-composite layers based on **damage/invalidation signals**
- If the compositor doesn't detect that the WebGL layer is "damaged" (changed), it may skip re-compositing it, reusing the cached texture

### The Likely Bug: Missing Compositor Invalidation

The most probable cause is that Chromium's compositor is not being notified that the WebGL canvas's content has changed. This can happen when:

1. **The WebGL canvas has no z-index and is under other layers** -- the compositor may optimize by not re-reading the WebGL texture if it believes it's fully occluded or unchanged
2. **The WebGL canvas lacks CSS properties that promote it to its own compositor layer** -- without `will-change` or `transform: translateZ(0)`, the canvas may share a compositing layer and not get independent invalidation
3. **Electron's GPU process caching** -- Electron wraps Chromium's rendering pipeline and may have additional caching of the SharedImage textures used for canvas compositing

---

## Confirmed Workarounds (Ordered by Likelihood of Success)

### 1. Use `desynchronized: true` Context Attribute (HIGHEST PRIORITY)

The `desynchronized` hint was **specifically designed for pen-drawing applications** and completely bypasses the normal compositor pipeline. Per [Chrome's documentation](https://developer.chrome.com/blog/desynchronized):

> "The desynchronized hint invokes a different code path that bypasses the usual DOM update mechanism. Instead, the canvas's underlying buffer is sent directly to the screen's display controller."

This eliminates the compositor queue entirely, which would bypass any caching/invalidation bug.

**Implementation:**
```typescript
const gl = canvas.getContext("webgl2", {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  stencil: true,
  depth: false,
  preserveDrawingBuffer: true,
  desynchronized: true,  // <-- ADD THIS
});

// Verify it's actually active:
if (gl.getContextAttributes()?.desynchronized) {
  console.log("Low-latency desynchronized mode active");
}
```

**Caveats:**
- Translucent canvases (alpha: true) with `desynchronized` cannot have DOM elements layered above them per Chrome's docs. This is a **critical constraint** given the stacked Canvas2D layers on top.
- Possible workaround: set `alpha: false` on the WebGL canvas if the content is opaque (desk/page backgrounds are drawn first)
- May introduce tearing on some devices
- Must keep `preserveDrawingBuffer: true` to prevent flickering

### 2. Add CSS Layer Promotion to the WebGL Canvas

The `paper-webgl-static-canvas` class currently inherits `position: absolute` from `.paper-canvas` but has **no z-index, no will-change, no transform** of its own. This means Chromium may not give it its own compositing layer.

**Add explicit CSS:**
```css
.paper-webgl-static-canvas {
  z-index: 1;  /* Give it a stacking position */
  will-change: contents;  /* Tell compositor this element changes frequently */
  transform: translateZ(0);  /* Force GPU layer promotion */
}
```

The `will-change: contents` hint tells the browser to expect the element's contents to change, which may trigger the compositor to re-read the WebGL texture on each composite cycle. Per [CSS GPU Animation](https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/), `will-change` and `translateZ(0)` force the element to its own compositor layer.

### 3. Force Canvas Resize Trick (Canvas Dimension Toggle)

Per the WebGL spec, a canvas resize triggers re-presentation. Toggling the canvas width by +1/-1 pixel forces Chromium to recreate the compositor texture:

```typescript
function forceWebGLPresentation(canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;
  canvas.width = w + 1;
  canvas.width = w;  // Restore immediately
  canvas.height = h; // Ensure height is also restored
  // Re-set the viewport after resize
  gl.viewport(0, 0, w, h);
}
```

**Warning:** This is destructive if `preserveDrawingBuffer: false` (clears the buffer). With `preserveDrawingBuffer: true`, the resize itself triggers an implicit clear in most implementations, so you would need to **re-render after the resize**. This makes it a "force full re-render" approach rather than a "force display update" approach.

### 4. Use `gl.flush()` After Every Composite

Per [MDN WebGL Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices):

> "When not using requestAnimationFrame, use `webgl.flush()` to encourage eager execution of enqueued commands. WebGL doesn't have a SwapBuffers call by default, so a flush can help fill the gap."

After the compositor finishes drawing all tile quads to the default framebuffer, call:

```typescript
gl.flush();
```

This doesn't guarantee presentation, but it signals to the GPU process that the drawing buffer is ready.

### 5. Display: None / offsetHeight / Display: "" Reflow Trick

This is the [Electron v28 canvas recovery technique](https://markaicode.com/electron-v28-rendering-issues-fixed/):

```typescript
function forceCanvasRepaint(canvas: HTMLCanvasElement): void {
  canvas.style.display = 'none';
  void canvas.offsetHeight; // Force reflow
  canvas.style.display = '';
}
```

This forces the browser to remove and re-add the element to the compositing tree, which should trigger a fresh read of the WebGL texture. However:
- This may cause a visible flicker
- It invalidates the element's compositing layer
- It's a sledgehammer approach but confirmed to work in Electron v28 contexts

### 6. readPixels + putImageData to a Canvas2D Layer (Current Approach -- Debugging)

The current `blitWebGLToStatic()` implementation reads pixels from the WebGL framebuffer and writes them to a Canvas2D canvas. The code currently has diagnostic logging that confirms `readPixels` returns non-zero data. If this is still showing stale visuals, the issue may be:

- **Timing:** The `readPixels` call may be executing before the compositor has finished rendering. Add a `gl.finish()` (blocking) call before `readPixels`:
  ```typescript
  gl.finish(); // Wait for all GPU operations to complete
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  ```
- **Canvas2D canvas is hidden or clipped:** Verify that `this.staticCanvas` is actually visible and has the correct dimensions/position
- **ImageData interpretation:** Ensure the `Uint8ClampedArray` conversion is correct (it should be, but verify RGBA ordering)

### 7. requestAnimationFrame-Based Rendering

If the compositor draws are happening outside of `requestAnimationFrame`, Chromium may not associate them with a frame boundary. The spec says the drawing buffer is presented "immediately before a compositing operation" -- but the compositor only runs at vsync within RAF.

Ensure the composite call happens inside a RAF callback:

```typescript
requestAnimationFrame(() => {
  this.glCompositor.composite(camera, screenWidth, screenHeight, tileCache);
  gl.flush();
});
```

### 8. Electron-Specific: GPU Cache and Command-Line Flags

Per [Electron WebGL debugging](https://markaicode.com/electron-v28-rendering-issues-fixed/), try these app command-line switches:

```javascript
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-webgl2-compute-context');
```

For the Obsidian context (plugin, not app), you can't control these flags. But you can:
- Delete the GPU cache: `rm -rf ~/.config/obsidian/GPUCache` (per [Obsidian forum](https://forum.obsidian.md/t/mesa-package-that-provides-webgl-is-broken-in-version-23-1-4-affecting-obsidian-graph-view/63721/3))
- Check `chrome://gpu` in Obsidian's devtools to verify hardware acceleration and WebGL status

---

## Recommended Implementation Order

Given the specific setup (pen-drawing app, stacked canvases, Electron):

1. **Try `desynchronized: true`** -- if the alpha/overlay constraint can be worked around, this is the cleanest fix since it was literally designed for this exact use case (pen drawing apps that need low-latency canvas updates)

2. **Add CSS compositing hints** (`will-change: contents` + `transform: translateZ(0)` + explicit `z-index`) to the WebGL canvas -- low-risk, may fix the compositor invalidation issue

3. **Ensure rendering happens within RAF** and call `gl.flush()` after compositing

4. **If all else fails: the `display:none` reflow trick** after each composite operation

5. **Nuclear option: keep the readPixels blit path** but add `gl.finish()` before the read to ensure GPU sync

---

## Critical Insight: The `alpha` + `desynchronized` Constraint

The most promising fix (`desynchronized: true`) has a key constraint: translucent canvases with desynchronized mode cannot have DOM elements layered above them. In the current architecture:

- The WebGL canvas (`paper-webgl-static-canvas`) is under Canvas2D layers (active, prediction)
- Those Canvas2D layers use `pointer-events: none` and transparent backgrounds
- If the WebGL canvas uses `alpha: false`, the compositing layers above it would need to be visible

**Architecture option:** Make the WebGL canvas the **top rendering layer** (highest z-index) with `alpha: false` and `desynchronized: true`, and render the active/prediction strokes directly in WebGL rather than on separate Canvas2D layers. This aligns with the direction the codebase is already heading (WebGL2Engine for rendering).

---

## Sources

- [WebGL Specification - Drawing Buffer Presentation](https://registry.khronos.org/webgl/specs/latest/1.0/)
- [GPU Accelerated Compositing in Chrome](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/)
- [Chrome Low-Latency Rendering with desynchronized](https://developer.chrome.com/blog/desynchronized)
- [Canvas desynchronized attribute spec discussion](https://github.com/whatwg/html/issues/5466)
- [MDN WebGL Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [Electron v28 Rendering Fixes](https://markaicode.com/electron-v28-rendering-issues-fixed/)
- [Electron WebGL Canvas Resize Issue #16211](https://github.com/electron/electron/issues/16211)
- [CSS GPU Animation](https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/)
- [Chromium Canvas Rendering Architecture](https://deepwiki.com/chromium/chromium/4.1-canvas-rendering)
- [Optimizing Repaints](https://www.afasterweb.com/2017/07/27/optimizing-repaints/)
- [WebGL Tips](https://webgl2fundamentals.org/webgl/lessons/webgl-tips.html)
