import type { RenderEngineType } from "../../types";
import type { RenderEngine } from "./RenderEngine";
import { Canvas2DEngine } from "./Canvas2DEngine";
import { WebGL2Engine } from "./WebGL2Engine";

/**
 * Check whether WebGL 2 is available and meets minimum requirements.
 */
export function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    // Lose the context immediately to free resources
    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
    return maxTextureSize >= 2048;
  } catch {
    return false;
  }
}

/**
 * Create a RenderEngine of the requested type.
 * WebGL requests are attempted first; falls back to Canvas2D on failure.
 * OffscreenCanvas always gets Canvas2D (WebGL2 requires HTMLCanvasElement).
 */
export function createRenderEngine(
  type: RenderEngineType,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): RenderEngine {
  if (type === "webgl" && canvas instanceof HTMLCanvasElement) {
    if (isWebGL2Available()) {
      try {
        return new WebGL2Engine(canvas);
      } catch (e) {
        console.warn("WebGL2Engine creation failed, falling back to Canvas 2D:", e);
      }
    } else {
      console.warn("WebGL2 not available. Falling back to Canvas 2D.");
    }
  }
  return new Canvas2DEngine(canvas);
}
