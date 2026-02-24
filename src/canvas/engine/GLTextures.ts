/**
 * Texture upload from ImageSource and FBO color attachments.
 */

import type { ImageSource } from "./RenderEngine";

/**
 * Upload an image source to a WebGL texture.
 * Uses premultiplied alpha for correct blending.
 */
export function uploadTexture(
  gl: WebGL2RenderingContext,
  source: ImageSource,
  texture?: WebGLTexture | null,
): WebGLTexture {
  const tex = texture ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // Enable premultiplied alpha on upload
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA,
    gl.RGBA, gl.UNSIGNED_BYTE,
    source as TexImageSource,
  );

  // Standard filtering for stamp textures
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return tex;
}

/**
 * Create an empty RGBA texture for use as an FBO color attachment.
 */
export function createColorTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8,
    width, height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * Create a grain texture with REPEAT wrapping.
 */
export function uploadGrainTexture(
  gl: WebGL2RenderingContext,
  source: ImageSource,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA,
    gl.RGBA, gl.UNSIGNED_BYTE,
    source as TexImageSource,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

/**
 * FBO with color texture attachment and stencil renderbuffer.
 */
export interface GLOffscreenTarget {
  fbo: WebGLFramebuffer;
  colorTexture: WebGLTexture;
  stencilRB: WebGLRenderbuffer;
  width: number;
  height: number;
}

export function createOffscreenTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): GLOffscreenTarget {
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  const colorTexture = createColorTexture(gl, width, height);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);

  const stencilRB = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, stencilRB);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencilRB);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, colorTexture, stencilRB, width, height };
}

export function resizeOffscreenTarget(
  gl: WebGL2RenderingContext,
  target: GLOffscreenTarget,
  width: number,
  height: number,
): void {
  target.width = width;
  target.height = height;

  gl.bindTexture(gl.TEXTURE_2D, target.colorTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.bindRenderbuffer(gl.RENDERBUFFER, target.stencilRB);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, width, height);
}

export function destroyOffscreenTarget(
  gl: WebGL2RenderingContext,
  target: GLOffscreenTarget,
): void {
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.colorTexture);
  gl.deleteRenderbuffer(target.stencilRB);
}

// ─── MSAA offscreen targets ────────────────────────────────────

/**
 * MSAA FBO for rendering, with a resolve FBO holding the final texture.
 * Render into msaaFBO, then blitFramebuffer → resolveFBO to produce the texture.
 */
export interface GLMSAAOffscreenTarget {
  /** Resolve FBO — its color attachment is the usable texture */
  resolveFBO: WebGLFramebuffer;
  colorTexture: WebGLTexture;
  /** MSAA FBO — render target with multisampled renderbuffers */
  msaaFBO: WebGLFramebuffer;
  msaaColorRB: WebGLRenderbuffer;
  msaaStencilRB: WebGLRenderbuffer;
  samples: number;
  width: number;
  height: number;
}

export function createMSAAOffscreenTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  requestedSamples: number,
): GLMSAAOffscreenTarget {
  const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
  const samples = Math.min(requestedSamples, maxSamples);

  // --- MSAA FBO (render target) ---
  const msaaFBO = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFBO);

  const msaaColorRB = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, msaaColorRB);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaColorRB);

  const msaaStencilRB = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, msaaStencilRB);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.STENCIL_INDEX8, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, msaaStencilRB);

  // --- Resolve FBO (texture target) ---
  const resolveFBO = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFBO);

  const colorTexture = createColorTexture(gl, width, height);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { resolveFBO, colorTexture, msaaFBO, msaaColorRB, msaaStencilRB, samples, width, height };
}

/**
 * Blit MSAA renderbuffer → resolve texture via glBlitFramebuffer.
 */
export function resolveMSAA(
  gl: WebGL2RenderingContext,
  target: GLMSAAOffscreenTarget,
): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.msaaFBO);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.resolveFBO);
  gl.blitFramebuffer(
    0, 0, target.width, target.height,
    0, 0, target.width, target.height,
    gl.COLOR_BUFFER_BIT,
    gl.NEAREST,
  );
}

export function destroyMSAAOffscreenTarget(
  gl: WebGL2RenderingContext,
  target: GLMSAAOffscreenTarget,
): void {
  gl.deleteFramebuffer(target.msaaFBO);
  gl.deleteRenderbuffer(target.msaaColorRB);
  gl.deleteRenderbuffer(target.msaaStencilRB);
  gl.deleteFramebuffer(target.resolveFBO);
  gl.deleteTexture(target.colorTexture);
}
