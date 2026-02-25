/**
 * WebGL2 implementation of RenderEngine.
 *
 * Key design decisions:
 * - Premultiplied alpha throughout (context, textures, shaders, blending)
 * - fillPath uses stencil nonzero-winding (INCR_WRAP) for correct self-intersection fill
 * - Stencil bits 0-4 for fillPath winding count, bits 5-7 for nested clips (up to 3 levels)
 * - Offscreen targets use FBOs with color texture + stencil renderbuffer
 * - setShadow/clearShadow are no-ops (background canvas stays Canvas 2D for shadows)
 */

import type {
  RenderEngine,
  TextureHandle,
  OffscreenTarget,
  BlendMode,
  ImageSource,
} from "./RenderEngine";
import { GLState } from "./GLState";
import { createShaderProgram, deleteShaderProgram } from "./GLShaders";
import type { ShaderProgram } from "./GLShaders";
import { DynamicBuffer, createStaticBuffer, createIndexBuffer, UNIT_QUAD_VERTICES, UNIT_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES, FULLSCREEN_QUAD_INDICES } from "./GLBuffers";
import { uploadTexture, uploadGrainTexture, createOffscreenTarget, resizeOffscreenTarget, destroyOffscreenTarget, createMSAAOffscreenTarget, resolveMSAA, destroyMSAAOffscreenTarget } from "./GLTextures";
import type { GLOffscreenTarget, GLMSAAOffscreenTarget } from "./GLTextures";
import { parseColor } from "./GLColor";
import {
  SOLID_VERT, SOLID_FRAG,
  TEXTURE_VERT, TEXTURE_FRAG,
  STAMP_VERT, STAMP_FRAG,
  GRAIN_VERT, GRAIN_FRAG,
  CIRCLE_VERT, CIRCLE_FRAG,
  LINE_VERT, LINE_FRAG,
} from "./shaders";

// ─── Stencil bit layout ─────────────────────────────────────────
// Bits 0-4: winding count for fillPath/maskToPath (nonzero winding rule)
// Bits 5-7: clip levels (up to 3 nested clips)
const FILL_MASK = 0x1F;       // bits 0-4 for winding count
const CLIP_BIT_OFFSET = 4;    // clip bits start at bit 5 (1 << (clipLevel + 4))
const MAX_CLIP_DEPTH = 3;     // bits 5, 6, 7

// ─── Internal types ─────────────────────────────────────────────

interface GLTextureHandle extends TextureHandle {
  readonly glTexture: WebGLTexture;
}

interface GLOffscreen extends OffscreenTarget {
  width: number;
  height: number;
  target: GLOffscreenTarget;
  /** MSAA render target — render here, resolve to target.colorTexture */
  msaa: GLMSAAOffscreenTarget | null;
}

interface SavedState {
  transform: Float32Array; // Column-major mat3
  alpha: number;
  blendMode: BlendMode;
  clipDepth: number;
  scissor: [number, number, number, number] | null;
}

// ─── Mat3 helpers (column-major for GLSL) ───────────────────────

function mat3Identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

function mat3Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(9);
  out[0] = a[0] * b[0] + a[3] * b[1] + a[6] * b[2];
  out[1] = a[1] * b[0] + a[4] * b[1] + a[7] * b[2];
  out[2] = a[2] * b[0] + a[5] * b[1] + a[8] * b[2];
  out[3] = a[0] * b[3] + a[3] * b[4] + a[6] * b[5];
  out[4] = a[1] * b[3] + a[4] * b[4] + a[7] * b[5];
  out[5] = a[2] * b[3] + a[5] * b[4] + a[8] * b[5];
  out[6] = a[0] * b[6] + a[3] * b[7] + a[6] * b[8];
  out[7] = a[1] * b[6] + a[4] * b[7] + a[7] * b[8];
  out[8] = a[2] * b[6] + a[5] * b[7] + a[8] * b[8];
  return out;
}

/** Pixel coords → clip space projection (Y-flipped). */
function mat3Projection(width: number, height: number): Float32Array {
  return new Float32Array([
    2 / width, 0, 0,
    0, -2 / height, 0,
    -1, 1, 1,
  ]);
}

/** CSS/Canvas 2D style affine transform [a,b,c,d,e,f] → column-major mat3. */
function mat3FromTransform(a: number, b: number, c: number, d: number, e: number, f: number): Float32Array {
  return new Float32Array([
    a, b, 0,
    c, d, 0,
    e, f, 1,
  ]);
}

// ─── WebGL2Engine ───────────────────────────────────────────────

export class WebGL2Engine implements RenderEngine {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private state: GLState;
  private valid = true;

  // Shader programs
  private solidProg!: ShaderProgram;
  private textureProg!: ShaderProgram;
  private stampProg!: ShaderProgram;
  private grainProg!: ShaderProgram;
  private circleProg!: ShaderProgram;
  private lineProg!: ShaderProgram;

  // Shared geometry
  private unitQuadVBO!: WebGLBuffer;
  private unitQuadIBO!: WebGLBuffer;
  private fullscreenQuadVBO!: WebGLBuffer;
  private fullscreenQuadIBO!: WebGLBuffer;

  // Dynamic buffers
  private pathBuffer!: DynamicBuffer;
  private instanceBuffer!: DynamicBuffer;
  private lineBuffer!: DynamicBuffer;

  // VAOs
  private solidVAO!: WebGLVertexArrayObject;
  private textureVAO!: WebGLVertexArrayObject;
  private stampVAO!: WebGLVertexArrayObject;
  private grainVAO!: WebGLVertexArrayObject;
  private circleVAO!: WebGLVertexArrayObject;
  private lineVAO!: WebGLVertexArrayObject;

  // Transform state
  private currentTransform: Float32Array;
  private projection: Float32Array;
  private stateStack: SavedState[] = [];
  private currentAlpha = 1;
  private currentBlendMode: BlendMode = "source-over";
  private clipDepth = 0;
  private currentScissor: [number, number, number, number] | null = null;

  // Offscreen FBO stack
  private offscreens = new Map<string, GLOffscreen>();
  private fboStack: { fbo: WebGLFramebuffer; viewport: [number, number, number, number]; projection: Float32Array; scissor: [number, number, number, number] | null; msaa: GLMSAAOffscreenTarget | null }[] = [];

  /** Current viewport height — used for scissor Y-flip in clipRect. */
  private viewportHeight: number;

  constructor(canvas: HTMLCanvasElement, options?: { preserveDrawingBuffer?: boolean }) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      stencil: true,
      depth: false,
      preserveDrawingBuffer: options?.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    this.state = new GLState(gl);

    this.currentTransform = mat3Identity();
    this.projection = mat3Projection(canvas.width, canvas.height);
    this.viewportHeight = canvas.height;
    this.initResources();
    this.setupContextLoss();

    // Initial state
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // --- Lifecycle ---

  get width(): number { return this.canvas.width; }
  get height(): number { return this.canvas.height; }

  /** Expose the underlying canvas (used by WebGLTileEngine for drawImage transfer). */
  getCanvas(): HTMLCanvasElement { return this.canvas; }

  /** Whether the WebGL context is still valid (not lost). */
  isValid(): boolean { return this.valid; }

  /**
   * Invalidate all GLState caches. Call after external code (e.g. WebGLTileCompositor)
   * has modified GL state via raw gl.* calls that bypass GLState tracking.
   */
  resetState(): void { this.state.reset(); }

  /** Upload a grain texture with REPEAT wrapping (vs CLAMP_TO_EDGE in createTexture). */
  createGrainTexture(source: ImageSource): TextureHandle {
    const glTexture = uploadGrainTexture(this.gl, source);
    const w = getSourceDimension(source, "width");
    const h = getSourceDimension(source, "height");
    const handle: GLTextureHandle = { width: w, height: h, glTexture };
    return handle;
  }

  /**
   * Discard stencil attachment on the currently bound FBO.
   * iPad TBDR optimization — avoids store-back of stencil data to VRAM.
   * Caller must ensure an FBO (not the default framebuffer) is bound.
   */
  invalidateFramebuffer(): void {
    const gl = this.gl;
    try {
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.STENCIL_ATTACHMENT]);
    } catch {
      // Some drivers don't support invalidateFramebuffer — safe to ignore
    }
  }

  /** Flush GPU command queue — ensures drawing buffer is ready for drawImage reads. */
  flush(): void {
    this.gl.flush();
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.projection = mat3Projection(width, height);
    this.viewportHeight = height;
    this.gl.viewport(0, 0, width, height);
  }

  /**
   * Set viewport and projection without resizing the canvas.
   * Used by WebGLTileEngine to render at tile resolution inside a larger canvas
   * (Safari doesn't reliably resize WebGL drawing buffers for off-screen canvases).
   */
  setViewport(width: number, height: number, offsetY = 0): void {
    this.gl.viewport(0, offsetY, width, height);
    this.projection = mat3Projection(width, height);
    this.viewportHeight = height;
  }

  setCanvas(_canvas: HTMLCanvasElement | OffscreenCanvas): void {
    // WebGL2 context is tied to the original canvas — cannot switch.
    // For tile rendering, tiles should stay Canvas 2D until full WebGL tile support.
    console.warn("WebGL2Engine.setCanvas() is a no-op. WebGL context is bound to its original canvas.");
  }

  destroy(): void {
    if (!this.valid) return;
    this.valid = false;
    const gl = this.gl;

    // Delete programs
    deleteShaderProgram(gl, this.solidProg);
    deleteShaderProgram(gl, this.textureProg);
    deleteShaderProgram(gl, this.stampProg);
    deleteShaderProgram(gl, this.grainProg);
    deleteShaderProgram(gl, this.circleProg);
    deleteShaderProgram(gl, this.lineProg);

    // Delete buffers
    gl.deleteBuffer(this.unitQuadVBO);
    gl.deleteBuffer(this.unitQuadIBO);
    gl.deleteBuffer(this.fullscreenQuadVBO);
    gl.deleteBuffer(this.fullscreenQuadIBO);
    this.pathBuffer.destroy();
    this.instanceBuffer.destroy();
    this.lineBuffer.destroy();

    // Delete VAOs
    gl.deleteVertexArray(this.solidVAO);
    gl.deleteVertexArray(this.textureVAO);
    gl.deleteVertexArray(this.stampVAO);
    gl.deleteVertexArray(this.grainVAO);
    gl.deleteVertexArray(this.circleVAO);
    gl.deleteVertexArray(this.lineVAO);

    // Delete offscreen targets
    for (const offscreen of this.offscreens.values()) {
      if (offscreen.msaa) {
        destroyMSAAOffscreenTarget(gl, offscreen.msaa);
      }
      destroyOffscreenTarget(gl, offscreen.target);
    }
    this.offscreens.clear();
  }

  // --- Transform stack ---

  save(): void {
    this.stateStack.push({
      transform: new Float32Array(this.currentTransform),
      alpha: this.currentAlpha,
      blendMode: this.currentBlendMode,
      clipDepth: this.clipDepth,
      scissor: this.currentScissor ? [...this.currentScissor] : null,
    });
  }

  restore(): void {
    const saved = this.stateStack.pop();
    if (!saved) return;

    // Restore clip depth: clear stencil bits for removed clip levels
    const hadClips = this.clipDepth > 0;
    if (saved.clipDepth < this.clipDepth) {
      this.clearClipLevels(saved.clipDepth + 1, this.clipDepth);
    }
    this.clipDepth = saved.clipDepth;

    // Disable stencil test when all clip levels are removed.
    // clipPath() enables stencil and leaves it on for subsequent draws;
    // when restore() pops all clips, stencil must be turned off so
    // drawOffscreen() and other non-clip-aware calls aren't blocked.
    if (hadClips && this.clipDepth === 0) {
      this.state.disableStencil();
    }

    this.currentTransform = saved.transform;
    this.currentAlpha = saved.alpha;
    if (saved.blendMode !== this.currentBlendMode) {
      this.currentBlendMode = saved.blendMode;
      this.state.setBlendMode(saved.blendMode);
    }

    // Restore scissor
    if (saved.scissor) {
      this.gl.enable(this.gl.SCISSOR_TEST);
      this.gl.scissor(saved.scissor[0], saved.scissor[1], saved.scissor[2], saved.scissor[3]);
      this.currentScissor = saved.scissor;
    } else if (this.currentScissor) {
      this.gl.disable(this.gl.SCISSOR_TEST);
      this.currentScissor = null;
    }
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.currentTransform = mat3FromTransform(a, b, c, d, e, f);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const m = mat3FromTransform(a, b, c, d, e, f);
    this.currentTransform = mat3Multiply(this.currentTransform, m);
  }

  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }

  scale(sx: number, sy: number): void {
    this.transform(sx, 0, 0, sy, 0, 0);
  }

  getTransform(): DOMMatrix {
    const t = this.currentTransform;
    // Column-major mat3 → DOMMatrix (a, b, c, d, e, f)
    return new DOMMatrix([t[0], t[1], t[3], t[4], t[6], t[7]]);
  }

  // --- Style ---

  setFillColor(_color: string): void {
    // Color is applied per-draw-call via uniform. Store for next draw.
    this._fillColor = _color;
  }

  setStrokeColor(_color: string): void {
    this._strokeColor = _color;
  }

  setLineWidth(_width: number): void {
    this._lineWidth = _width;
  }

  setAlpha(alpha: number): void {
    this.currentAlpha = alpha;
  }

  setBlendMode(mode: BlendMode): void {
    this.currentBlendMode = mode;
    this.state.setBlendMode(mode);
  }

  private _fillColor = "#000000";
  private _strokeColor = "#000000";
  private _lineWidth = 1;

  // --- Drawing ---

  clear(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.stencilMask(0xFF); // Ensure ALL stencil bits are cleared
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    // Build 4-vertex quad
    const verts = new Float32Array([
      x, y,
      x + w, y,
      x + w, y + h,
      x, y + h,
    ]);
    this.fillConvexQuad(verts, this._fillColor, this.currentAlpha);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    // Draw four line segments forming the rectangle
    const lw = this._lineWidth;
    const lines = new Float32Array([
      x, y, x + w, y,
      x + w, y, x + w, y + h,
      x + w, y + h, x, y + h,
      x, y + h, x, y,
    ]);
    this.drawLines(lines, this._strokeColor, lw);
  }

  fillPath(vertices: Float32Array): void {
    if (vertices.length < 6) return; // Need at least 3 vertices
    const gl = this.gl;
    const prog = this.solidProg;

    // Combined transform: projection * currentTransform
    const combined = mat3Multiply(this.projection, this.currentTransform);
    const color = parseColor(this._fillColor, this.currentAlpha);

    // Upload path vertices
    this.pathBuffer.upload(vertices);

    // === Pass 1: Two-sided stencil (nonzero winding) with color write disabled ===
    // Front-facing fan triangles increment, back-facing decrement.
    // Concave external overlaps cancel out (±1 = 0), while self-intersecting
    // interior regions accumulate (e.g. +2), correctly filling both.
    this.state.enableStencil();
    gl.stencilMask(FILL_MASK);
    gl.stencilFunc(gl.ALWAYS, 0, FILL_MASK);
    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
    gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    gl.colorMask(false, false, false, false);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform4fv(prog.uniforms.get("u_color")!, color);

    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer.buffer);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);

    // TRIANGLE_FAN from vertex[0] — two-sided stencil handles concave + self-intersecting shapes
    const vertCount = vertices.length / 2;
    gl.drawArrays(gl.TRIANGLE_FAN, 0, vertCount);

    // === Pass 2: Draw fullscreen quad where stencil winding count != 0, clear stencil ===
    gl.colorMask(true, true, true, true);
    gl.stencilMask(FILL_MASK);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO); // Auto-clear winding bits
    const clipMask = this.getClipStencilMask();
    if (clipMask > 0) {
      // Test: winding bits nonzero AND clip bits match
      gl.stencilFunc(gl.NOTEQUAL, clipMask, FILL_MASK | clipMask);
    } else {
      gl.stencilFunc(gl.NOTEQUAL, 0, FILL_MASK);
    }

    // Fullscreen quad covers all stencil-marked pixels
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, mat3Identity());
    gl.uniform4fv(prog.uniforms.get("u_color")!, color);

    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadVBO);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fullscreenQuadIBO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    this.state.disableStencil();
  }

  maskToPath(vertices: Float32Array): void {
    if (vertices.length < 6) return;
    const gl = this.gl;
    const prog = this.solidProg;

    const combined = mat3Multiply(this.projection, this.currentTransform);

    // Upload path vertices
    this.pathBuffer.upload(vertices);

    // === Pass 1: Mark interior in stencil (two-sided nonzero winding, no color) ===
    this.state.enableStencil();
    gl.stencilMask(FILL_MASK);
    gl.stencilFunc(gl.ALWAYS, 0, FILL_MASK);
    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
    gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    gl.colorMask(false, false, false, false);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform4fv(prog.uniforms.get("u_color")!, parseColor("#ffffff", 1));

    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer.buffer);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);

    const vertCount = vertices.length / 2;
    gl.drawArrays(gl.TRIANGLE_FAN, 0, vertCount);

    // === Pass 2: Clear pixels OUTSIDE the path ===
    // Stencil passes where winding bits == 0 (outside the path).
    // destination-out with alpha=1 clears dst to transparent.
    // Inside the path (winding != 0), stencil fails → stamps are preserved.
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0x00); // Don't modify stencil during mask clear
    gl.stencilFunc(gl.EQUAL, 0, FILL_MASK);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    // Use GLState for blend mode change so the cache stays in sync
    this.state.setBlendMode("destination-out");

    // Fullscreen quad in clip-space coordinates
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, mat3Identity());
    gl.uniform4fv(prog.uniforms.get("u_color")!, parseColor("#ffffff", 1));

    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadVBO);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fullscreenQuadIBO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // === Pass 3: Clear winding stencil bits everywhere ===
    gl.colorMask(false, false, false, false);
    gl.stencilMask(FILL_MASK);
    gl.stencilFunc(gl.NOTEQUAL, 0, FILL_MASK);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    gl.colorMask(true, true, true, true);
    this.state.disableStencil();

    // Restore blend mode via GLState (cache stays in sync)
    this.state.setBlendMode(this.currentBlendMode);
  }

  fillTriangles(vertices: Float32Array): void {
    if (vertices.length < 6) return; // Need at least 3 vertices (1 triangle)
    const gl = this.gl;
    const prog = this.solidProg;

    const combined = mat3Multiply(this.projection, this.currentTransform);
    const color = parseColor(this._fillColor, this.currentAlpha);

    this.pathBuffer.upload(vertices);

    // === Pass 1: Stencil mark (REPLACE) with color write disabled ===
    // Unlike fillPath (TRIANGLE_FAN needing nonzero winding count), explicit
    // triangles represent actual fill area. REPLACE sets stencil to 1 for any
    // covered pixel — no accumulation, no 5-bit wrapping at tight curves
    // where 30+ overlapping triangles would wrap INCR_WRAP back to 0.
    this.state.enableStencil();
    gl.stencilMask(FILL_MASK);
    gl.stencilFunc(gl.ALWAYS, 1, FILL_MASK);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform4fv(prog.uniforms.get("u_color")!, color);

    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer.buffer);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);

    const vertCount = vertices.length / 2;
    gl.drawArrays(gl.TRIANGLES, 0, vertCount);

    // === Pass 2: Draw fullscreen quad where stencil winding count != 0, clear stencil ===
    gl.colorMask(true, true, true, true);
    gl.stencilMask(FILL_MASK);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
    const clipMask = this.getClipStencilMask();
    if (clipMask > 0) {
      gl.stencilFunc(gl.NOTEQUAL, clipMask, FILL_MASK | clipMask);
    } else {
      gl.stencilFunc(gl.NOTEQUAL, 0, FILL_MASK);
    }

    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, mat3Identity());
    gl.uniform4fv(prog.uniforms.get("u_color")!, color);

    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadVBO);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fullscreenQuadIBO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    this.state.disableStencil();
  }

  maskToTriangles(vertices: Float32Array): void {
    if (vertices.length < 6) return;
    const gl = this.gl;
    const prog = this.solidProg;

    const combined = mat3Multiply(this.projection, this.currentTransform);

    this.pathBuffer.upload(vertices);

    // === Pass 1: Mark interior in stencil (REPLACE, no color) ===
    // REPLACE sets stencil to 1 for any covered pixel — avoids 5-bit
    // wrapping that INCR_WRAP causes at tight curves with 30+ overlapping triangles.
    this.state.enableStencil();
    gl.stencilMask(FILL_MASK);
    gl.stencilFunc(gl.ALWAYS, 1, FILL_MASK);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform4fv(prog.uniforms.get("u_color")!, parseColor("#ffffff", 1));

    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer.buffer);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);

    const vertCount = vertices.length / 2;
    gl.drawArrays(gl.TRIANGLES, 0, vertCount);

    // === Pass 2: Clear pixels OUTSIDE the path ===
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0x00);
    gl.stencilFunc(gl.EQUAL, 0, FILL_MASK);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    this.state.setBlendMode("destination-out");

    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, mat3Identity());
    gl.uniform4fv(prog.uniforms.get("u_color")!, parseColor("#ffffff", 1));

    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadVBO);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fullscreenQuadIBO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // === Pass 3: Clear winding stencil bits everywhere ===
    gl.colorMask(false, false, false, false);
    gl.stencilMask(FILL_MASK);
    gl.stencilFunc(gl.NOTEQUAL, 0, FILL_MASK);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    gl.colorMask(true, true, true, true);
    this.state.disableStencil();

    this.state.setBlendMode(this.currentBlendMode);
  }

  drawImage(
    source: ImageSource | OffscreenTarget,
    dx: number, dy: number, dw: number, dh: number,
  ): void {
    const gl = this.gl;
    const prog = this.textureProg;

    // Upload or bind existing texture
    let tex: WebGLTexture;
    if (isGLOffscreen(source)) {
      tex = source.target.colorTexture;
    } else {
      tex = uploadTexture(gl, source as ImageSource);
    }

    // Build position/texcoord quad
    const positions = new Float32Array([
      dx, dy, 0, 0,
      dx + dw, dy, 1, 0,
      dx + dw, dy + dh, 1, 1,
      dx, dy + dh, 0, 1,
    ]);

    const combined = mat3Multiply(this.projection, this.currentTransform);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform1f(prog.uniforms.get("u_alpha")!, this.currentAlpha);
    gl.uniform1i(prog.uniforms.get("u_texture")!, 0);

    this.state.bindTexture(tex);
    this.state.bindVAO(this.textureVAO);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer.buffer);
    this.pathBuffer.upload(positions);

    const posLoc = prog.attributes.get("a_position")!;
    const tcLoc = prog.attributes.get("a_texcoord")!;
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(tcLoc);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.unitQuadIBO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // Clean up temp texture if source was an image (not FBO)
    if (!isGLOffscreen(source)) {
      gl.deleteTexture(tex);
    }
  }

  // --- Clipping ---

  clipRect(x: number, y: number, w: number, h: number): void {
    // Use GL scissor for rect clips (fast path)
    const gl = this.gl;
    const m = this.currentTransform;

    // Transform the rect corners through the current transform to screen coords
    const sx = m[0] * x + m[3] * y + m[6];
    const sy = m[1] * x + m[4] * y + m[7];
    const ex = m[0] * (x + w) + m[3] * (y + h) + m[6];
    const ey = m[1] * (x + w) + m[4] * (y + h) + m[7];

    // Convert to GL viewport coords (Y-flipped using current viewport height,
    // not canvas height — critical for correct scissor when rendering into FBOs)
    const glX = Math.floor(Math.min(sx, ex));
    const glY = Math.floor(this.viewportHeight - Math.max(sy, ey));
    const glW = Math.ceil(Math.abs(ex - sx));
    const glH = Math.ceil(Math.abs(ey - sy));

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(glX, glY, glW, glH);
    this.currentScissor = [glX, glY, glW, glH];
  }

  clipPath(vertices: Float32Array): void {
    if (vertices.length < 6) return;
    const gl = this.gl;

    this.clipDepth++;
    const bit = this.clipDepth; // Clip levels 1-3 → bits 5-7
    if (bit > MAX_CLIP_DEPTH) {
      console.warn(`WebGL2Engine: max clip depth (${MAX_CLIP_DEPTH}) exceeded`);
      return;
    }

    const stencilBit = 1 << (bit + CLIP_BIT_OFFSET);
    const combined = mat3Multiply(this.projection, this.currentTransform);

    // Write the clip region to stencil using INVERT trick
    this.state.enableStencil();
    gl.stencilMask(stencilBit);
    gl.stencilFunc(gl.ALWAYS, 0, stencilBit);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    gl.colorMask(false, false, false, false);

    this.state.useProgram(this.solidProg.program);
    gl.uniformMatrix3fv(this.solidProg.uniforms.get("u_transform")!, false, combined);
    gl.uniform4fv(this.solidProg.uniforms.get("u_color")!, new Float32Array([0, 0, 0, 0]));

    this.pathBuffer.upload(vertices);
    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer.buffer);
    gl.vertexAttribPointer(this.solidProg.attributes.get("a_position")!, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.solidProg.attributes.get("a_position")!);

    const vertCount = vertices.length / 2;
    gl.drawArrays(gl.TRIANGLE_FAN, 0, vertCount);

    // Now set stencil test to require this bit
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0x00); // Don't modify stencil during drawing
    const clipMask = this.getClipStencilMask();
    gl.stencilFunc(gl.EQUAL, clipMask, clipMask);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    // Keep stencil test enabled
  }

  // --- Offscreen rendering ---

  getOffscreen(id: string, width: number, height: number): OffscreenTarget {
    let offscreen = this.offscreens.get(id);
    if (offscreen) {
      if (offscreen.width !== width || offscreen.height !== height) {
        // Size changed — destroy and recreate (MSAA renderbuffers can't be resized)
        if (offscreen.msaa) {
          destroyMSAAOffscreenTarget(this.gl, offscreen.msaa);
        }
        destroyOffscreenTarget(this.gl, offscreen.target);
        this.offscreens.delete(id);
        offscreen = undefined;
        // Fall through to create new offscreen below
      } else {
        return offscreen;
      }
    }
    // Save the currently bound FBO before creating targets, which bind
    // their own FBOs internally and then unbind to default framebuffer (null).
    // Without this restore, beginOffscreen() would save null as the "parent FBO"
    // and endOffscreen() would restore rendering to the screen canvas instead
    // of the tile FBO — causing strokes to render at wrong positions/scales.
    const gl = this.gl;
    const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);

    // Create resolve target (regular FBO with color texture for drawOffscreen to sample)
    const target = createOffscreenTarget(gl, width, height);

    // Create MSAA render target (4x multisampling for anti-aliased stencil edges)
    const msaa = createMSAAOffscreenTarget(gl, width, height, 4);

    // Restore the previous FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
    // Invalidate GLState caches — target creation bound texture + FBO
    // via raw GL calls that bypass GLState tracking.
    this.state.invalidateTexture();
    this.state.invalidateFBO();
    offscreen = { width, height, target, msaa };
    this.offscreens.set(id, offscreen);
    return offscreen;
  }

  beginOffscreen(target: OffscreenTarget): void {
    const t = target as GLOffscreen;
    const gl = this.gl;

    // Save current FBO + viewport + scissor state
    const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
    let savedScissor: [number, number, number, number] | null = null;
    if (scissorEnabled) {
      const box = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;
      savedScissor = [box[0], box[1], box[2], box[3]];
    }

    this.fboStack.push({
      fbo: gl.getParameter(gl.FRAMEBUFFER_BINDING),
      viewport: [
        gl.getParameter(gl.VIEWPORT)[0],
        gl.getParameter(gl.VIEWPORT)[1],
        gl.getParameter(gl.VIEWPORT)[2],
        gl.getParameter(gl.VIEWPORT)[3],
      ],
      projection: this.projection,
      scissor: savedScissor,
      msaa: t.msaa,
    });

    // Disable scissor for offscreen rendering — the outer scissor rect
    // is in the caller's framebuffer coordinates, not the offscreen's.
    if (scissorEnabled) {
      gl.disable(gl.SCISSOR_TEST);
    }

    // Bind MSAA FBO for rendering (resolve happens in endOffscreen)
    const renderFBO = t.msaa ? t.msaa.msaaFBO : t.target.fbo;
    this.state.bindFramebuffer(renderFBO);
    gl.viewport(0, 0, t.width, t.height);
    this.projection = mat3Projection(t.width, t.height);
    this.viewportHeight = t.height;
  }

  endOffscreen(): void {
    const prev = this.fboStack.pop();
    if (!prev) return;
    const gl = this.gl;

    // Resolve MSAA → resolve texture before leaving offscreen
    if (prev.msaa) {
      resolveMSAA(gl, prev.msaa);
      // resolveMSAA binds READ/DRAW framebuffers — need to invalidate GLState
      this.state.invalidateFBO();
    }

    this.state.bindFramebuffer(prev.fbo);
    gl.viewport(prev.viewport[0], prev.viewport[1], prev.viewport[2], prev.viewport[3]);
    this.projection = prev.projection;
    this.viewportHeight = prev.viewport[3]; // Restore viewport height for scissor Y-flip

    // Restore scissor state
    if (prev.scissor) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(prev.scissor[0], prev.scissor[1], prev.scissor[2], prev.scissor[3]);
    }
  }

  drawOffscreen(target: OffscreenTarget, dx: number, dy: number, dw: number, dh: number): void {
    const t = target as GLOffscreen;
    const gl = this.gl;
    const prog = this.textureProg;

    const combined = mat3Multiply(this.projection, this.currentTransform);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform1f(prog.uniforms.get("u_alpha")!, this.currentAlpha);
    gl.uniform1i(prog.uniforms.get("u_texture")!, 0);

    // MSAA resolve writes to msaa.colorTexture; non-MSAA renders to target.colorTexture
    const tex = t.msaa ? t.msaa.colorTexture : t.target.colorTexture;
    this.state.bindTexture(tex);

    // Build position/texcoord quad
    const positions = new Float32Array([
      dx, dy, 0, 1,           // flip V: FBO texture is Y-inverted
      dx + dw, dy, 1, 1,
      dx + dw, dy + dh, 1, 0,
      dx, dy + dh, 0, 0,
    ]);

    this.state.bindVAO(this.textureVAO);
    this.pathBuffer.upload(positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer.buffer);

    const posLoc = prog.attributes.get("a_position")!;
    const tcLoc = prog.attributes.get("a_texcoord")!;
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(tcLoc);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.unitQuadIBO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // --- Stamp rendering ---

  drawStamps(texture: TextureHandle, data: Float32Array): void {
    if (data.length === 0) return;
    const gl = this.gl;
    const prog = this.stampProg;
    const tex = texture as GLTextureHandle;
    const stampCount = data.length / 4;

    const combined = mat3Multiply(this.projection, this.currentTransform);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform1f(prog.uniforms.get("u_alpha")!, this.currentAlpha);
    gl.uniform1i(prog.uniforms.get("u_texture")!, 0);

    this.state.bindTexture(tex.glTexture);
    this.state.bindVAO(this.stampVAO);

    // Upload instance data
    this.instanceBuffer.upload(data);

    // Bind instance buffer to a_instance attribute
    const instanceLoc = prog.attributes.get("a_instance")!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer.buffer);
    gl.vertexAttribPointer(instanceLoc, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instanceLoc);
    gl.vertexAttribDivisor(instanceLoc, 1);

    // Bind unit quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadVBO);
    const posLoc = prog.attributes.get("a_position")!;
    const tcLoc = prog.attributes.get("a_texcoord")!;
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(tcLoc);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.unitQuadIBO);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, stampCount);

    // Clean up divisor
    gl.vertexAttribDivisor(instanceLoc, 0);
  }

  // --- Grain texture ---

  applyGrain(
    texture: TextureHandle,
    offsetX: number,
    offsetY: number,
    strength: number,
  ): void {
    const gl = this.gl;
    const prog = this.grainProg;
    const tex = texture as GLTextureHandle;

    // Save blend mode, switch to destination-out
    const prevBlend = this.currentBlendMode;
    this.setBlendMode("destination-out");

    this.state.useProgram(prog.program);
    gl.uniform1f(prog.uniforms.get("u_strength")!, strength);
    gl.uniform2f(prog.uniforms.get("u_offset")!, offsetX * 0.3, offsetY * 0.3);
    gl.uniform2f(prog.uniforms.get("u_scale")!, 0.3, 0.3);
    gl.uniform1i(prog.uniforms.get("u_texture")!, 0);

    this.state.bindTexture(tex.glTexture);
    this.state.bindVAO(this.grainVAO);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadVBO);
    const posLoc = prog.attributes.get("a_position")!;
    const tcLoc = prog.attributes.get("a_texcoord")!;
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(tcLoc);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fullscreenQuadIBO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // Restore blend mode
    this.setBlendMode(prevBlend);
  }

  // --- Texture management ---

  createTexture(source: ImageSource): TextureHandle {
    const glTexture = uploadTexture(this.gl, source);
    const w = getSourceDimension(source, "width");
    const h = getSourceDimension(source, "height");
    const handle: GLTextureHandle = { width: w, height: h, glTexture };
    return handle;
  }

  deleteTexture(handle: TextureHandle): void {
    const h = handle as GLTextureHandle;
    this.gl.deleteTexture(h.glTexture);
  }

  // --- Background drawing ---

  drawLines(lines: Float32Array, color: string, lineWidth: number): void {
    if (lines.length === 0) return;
    const gl = this.gl;
    const prog = this.lineProg;
    const combined = mat3Multiply(this.projection, this.currentTransform);
    const c = parseColor(color, this.currentAlpha);
    const halfW = lineWidth * 0.5;

    // Build quads for each line segment
    const lineCount = lines.length / 4;
    const quadData = new Float32Array(lineCount * 12); // 6 vertices * 2 (pos) per line, but we need edge too
    // Actually: 4 vertices per line quad, each with (x, y, edge), and 6 indices per quad
    const vertData = new Float32Array(lineCount * 4 * 3); // 4 verts * 3 floats (x, y, edge)
    const indices = new Uint16Array(lineCount * 6);

    for (let i = 0; i < lineCount; i++) {
      const x1 = lines[i * 4];
      const y1 = lines[i * 4 + 1];
      const x2 = lines[i * 4 + 2];
      const y2 = lines[i * 4 + 3];

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;

      // Perpendicular normal
      const nx = -dy / len * halfW;
      const ny = dx / len * halfW;

      const vi = i * 12; // 4 verts * 3 floats
      vertData[vi] = x1 + nx; vertData[vi + 1] = y1 + ny; vertData[vi + 2] = -1;
      vertData[vi + 3] = x1 - nx; vertData[vi + 4] = y1 - ny; vertData[vi + 5] = 1;
      vertData[vi + 6] = x2 - nx; vertData[vi + 7] = y2 - ny; vertData[vi + 8] = 1;
      vertData[vi + 9] = x2 + nx; vertData[vi + 10] = y2 + ny; vertData[vi + 11] = -1;

      const ii = i * 6;
      const base = i * 4;
      indices[ii] = base; indices[ii + 1] = base + 1; indices[ii + 2] = base + 2;
      indices[ii + 3] = base; indices[ii + 4] = base + 2; indices[ii + 5] = base + 3;
    }

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform4fv(prog.uniforms.get("u_color")!, c);

    this.lineBuffer.upload(vertData);
    this.state.bindVAO(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer.buffer);

    const posLoc = prog.attributes.get("a_position")!;
    const edgeLoc = prog.attributes.get("a_edge")!;
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(edgeLoc, 1, gl.FLOAT, false, 12, 8);
    gl.enableVertexAttribArray(edgeLoc);

    // Upload index buffer
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STREAM_DRAW);

    gl.drawElements(gl.TRIANGLES, lineCount * 6, gl.UNSIGNED_SHORT, 0);
    gl.deleteBuffer(ibo);
  }

  drawCircles(circles: Float32Array, color: string): void {
    if (circles.length === 0) return;
    const gl = this.gl;
    const prog = this.circleProg;
    const circleCount = circles.length / 3;
    const combined = mat3Multiply(this.projection, this.currentTransform);
    const c = parseColor(color, this.currentAlpha);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform4fv(prog.uniforms.get("u_color")!, c);

    // Upload instance data (circles array is already [cx, cy, radius] per instance)
    this.instanceBuffer.upload(circles);

    this.state.bindVAO(this.circleVAO);

    // Bind unit quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadVBO);
    const posLoc = prog.attributes.get("a_position")!;
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(posLoc);

    // Bind instance data
    const instanceLoc = prog.attributes.get("a_instance")!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer.buffer);
    gl.vertexAttribPointer(instanceLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instanceLoc);
    gl.vertexAttribDivisor(instanceLoc, 1);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.unitQuadIBO);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, circleCount);

    gl.vertexAttribDivisor(instanceLoc, 0);
  }

  // --- Shadow (no-op in WebGL) ---

  setShadow(_color: string, _blur: number, _offsetX: number, _offsetY: number): void {
    // No-op: background canvas stays Canvas 2D for shadow rendering
  }

  clearShadow(): void {
    // No-op
  }

  // ─── Internal helpers ─────────────────────────────────────────

  private fillConvexQuad(verts: Float32Array, color: string, alpha: number): void {
    const gl = this.gl;
    const prog = this.solidProg;
    const combined = mat3Multiply(this.projection, this.currentTransform);
    const c = parseColor(color, alpha);

    this.state.useProgram(prog.program);
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, combined);
    gl.uniform4fv(prog.uniforms.get("u_color")!, c);

    this.pathBuffer.upload(verts);
    this.state.bindVAO(this.solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer.buffer);
    gl.vertexAttribPointer(prog.attributes.get("a_position")!, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(prog.attributes.get("a_position")!);

    // Apply clip stencil if active
    if (this.clipDepth > 0) {
      this.state.enableStencil();
      const clipMask = this.getClipStencilMask();
      gl.stencilMask(0x00);
      gl.stencilFunc(gl.EQUAL, clipMask, clipMask);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    }

    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    if (this.clipDepth > 0) {
      this.state.disableStencil();
    }
  }

  private getClipStencilMask(): number {
    let mask = 0;
    for (let i = 1; i <= this.clipDepth; i++) {
      mask |= (1 << (i + CLIP_BIT_OFFSET));
    }
    return mask;
  }

  private clearClipLevels(fromLevel: number, toLevel: number): void {
    const gl = this.gl;
    let mask = 0;
    for (let i = fromLevel; i <= toLevel; i++) {
      mask |= (1 << (i + CLIP_BIT_OFFSET));
    }
    gl.stencilMask(mask);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilMask(0xFF);
  }

  private initResources(): void {
    const gl = this.gl;

    // Compile all shader programs
    this.solidProg = createShaderProgram(gl, SOLID_VERT, SOLID_FRAG);
    this.textureProg = createShaderProgram(gl, TEXTURE_VERT, TEXTURE_FRAG);
    this.stampProg = createShaderProgram(gl, STAMP_VERT, STAMP_FRAG);
    this.grainProg = createShaderProgram(gl, GRAIN_VERT, GRAIN_FRAG);
    this.circleProg = createShaderProgram(gl, CIRCLE_VERT, CIRCLE_FRAG);
    this.lineProg = createShaderProgram(gl, LINE_VERT, LINE_FRAG);

    // Create shared geometry buffers
    this.unitQuadVBO = createStaticBuffer(gl, UNIT_QUAD_VERTICES);
    this.unitQuadIBO = createIndexBuffer(gl, UNIT_QUAD_INDICES);
    this.fullscreenQuadVBO = createStaticBuffer(gl, FULLSCREEN_QUAD_VERTICES);
    this.fullscreenQuadIBO = createIndexBuffer(gl, FULLSCREEN_QUAD_INDICES);

    // Create dynamic buffers
    this.pathBuffer = new DynamicBuffer(gl, 4096);
    this.instanceBuffer = new DynamicBuffer(gl, 8192);
    this.lineBuffer = new DynamicBuffer(gl, 4096);

    // Create VAOs (one per program for clean attribute state)
    this.solidVAO = gl.createVertexArray()!;
    this.textureVAO = gl.createVertexArray()!;
    this.stampVAO = gl.createVertexArray()!;
    this.grainVAO = gl.createVertexArray()!;
    this.circleVAO = gl.createVertexArray()!;
    this.lineVAO = gl.createVertexArray()!;
  }

  private setupContextLoss(): void {
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.valid = false;
      console.warn("WebGL2Engine: context lost");
    });

    this.canvas.addEventListener("webglcontextrestored", () => {
      console.info("WebGL2Engine: context restored, rebuilding resources");
      this.state.reset();
      this.initResources();
      this.valid = true;

      const gl = this.gl;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.viewportHeight = this.canvas.height;
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function isGLOffscreen(obj: unknown): obj is GLOffscreen {
  return obj !== null && typeof obj === "object" && "target" in obj && typeof (obj as GLOffscreen).target?.fbo !== "undefined";
}

function getSourceDimension(source: ImageSource, dim: "width" | "height"): number {
  if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
    return source[dim];
  }
  if (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) {
    return source[dim];
  }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return source[dim];
  }
  return 0;
}
