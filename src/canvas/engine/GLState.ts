/**
 * WebGL state tracker to skip redundant GL calls.
 * Tracks current blend mode, bound textures, active program, etc.
 */

import type { BlendMode } from "./RenderEngine";

export class GLState {
  private gl: WebGL2RenderingContext;

  // Current state
  private currentProgram: WebGLProgram | null = null;
  private currentBlendMode: BlendMode = "source-over";
  private currentVAO: WebGLVertexArrayObject | null = null;
  private currentTexture: WebGLTexture | null = null;
  private currentFBO: WebGLFramebuffer | null = null;
  private stencilEnabled = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  useProgram(program: WebGLProgram): boolean {
    if (this.currentProgram === program) return false;
    this.gl.useProgram(program);
    this.currentProgram = program;
    return true;
  }

  bindVAO(vao: WebGLVertexArrayObject | null): boolean {
    if (this.currentVAO === vao) return false;
    this.gl.bindVertexArray(vao);
    this.currentVAO = vao;
    return true;
  }

  bindTexture(texture: WebGLTexture | null, unit: number = 0): boolean {
    if (unit === 0 && this.currentTexture === texture) return false;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    if (unit === 0) this.currentTexture = texture;
    return true;
  }

  bindFramebuffer(fbo: WebGLFramebuffer | null): boolean {
    if (this.currentFBO === fbo) return false;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
    this.currentFBO = fbo;
    return true;
  }

  setBlendMode(mode: BlendMode): void {
    if (this.currentBlendMode === mode) return;
    this.currentBlendMode = mode;
    const gl = this.gl;
    switch (mode) {
      case "source-over":
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case "destination-in":
        gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
        break;
      case "destination-out":
        gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case "multiply":
        gl.blendFuncSeparate(
          gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA,
          gl.ZERO, gl.ONE,
        );
        break;
    }
  }

  enableStencil(): void {
    if (this.stencilEnabled) return;
    this.gl.enable(this.gl.STENCIL_TEST);
    this.stencilEnabled = true;
  }

  disableStencil(): void {
    if (!this.stencilEnabled) return;
    this.gl.disable(this.gl.STENCIL_TEST);
    this.stencilEnabled = false;
  }

  /** Reset tracking (after context loss/restore). */
  reset(): void {
    this.currentProgram = null;
    this.currentBlendMode = "source-over";
    this.currentVAO = null;
    this.currentTexture = null;
    this.currentFBO = null;
    this.stencilEnabled = false;
  }
}
