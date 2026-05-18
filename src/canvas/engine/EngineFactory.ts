import type { RenderEngineType } from "../../types";
import type { RenderEngine } from "./RenderEngine";
import { Canvas2DEngine } from "./Canvas2DEngine";
import { WebGL2Engine } from "./WebGL2Engine";

/**
 * Cached probe result. The probe creates a real WebGL2 context to check
 * support and immediately loses it; doing this once per session is fine,
 * but doing it before every engine creation can race with the actual
 * engine constructor on systems with tight WebGL context limits (Safari,
 * some Mac configurations) and cause spurious "WebGL2 not available"
 * fallbacks. The cache fixes that.
 */
let probeResult: boolean | null = null;

/**
 * Check whether WebGL 2 is available and meets minimum requirements.
 * Used by settings UI to gate WebGL-only options. Result is cached for
 * the session.
 */
export function isWebGL2Available(): boolean {
  if (probeResult !== null) return probeResult;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) {
      probeResult = false;
      return false;
    }
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    // Lose the context immediately to free resources
    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
    probeResult = maxTextureSize >= 2048;
    return probeResult;
  } catch {
    probeResult = false;
    return false;
  }
}

/** Reset the cached probe result. Test-only helper. */
export function _resetWebGL2ProbeCache(): void {
  probeResult = null;
}

/**
 * Create a RenderEngine of the requested type.
 *
 * For WebGL requests we attempt the constructor directly rather than
 * gating on a separate probe call — the probe creates a real WebGL2
 * context, and on iOS Safari (and occasionally Mac) running it
 * immediately before the engine constructor races against the system's
 * ~16-context limit and causes the engine to fail with a misleading
 * "WebGL2 not available" error. Trying the constructor directly avoids
 * the doubled context creation; if it throws (truly unsupported, or
 * transient resource exhaustion), we fall back to Canvas 2D for this
 * surface only.
 *
 * OffscreenCanvas always gets Canvas2D (WebGL2 requires HTMLCanvasElement).
 */
export function createRenderEngine(
  type: RenderEngineType,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): RenderEngine {
  if (type === "webgl" && canvas instanceof HTMLCanvasElement) {
    try {
      return new WebGL2Engine(canvas);
    } catch (e) {
      console.warn("[Paper] WebGL2 unavailable for this canvas, using Canvas 2D fallback:", e);
    }
  }
  return new Canvas2DEngine(canvas);
}
