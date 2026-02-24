/**
 * Composites visible tile textures onto the default framebuffer as textured quads.
 *
 * Single-pass: for each visible grid position, draws a textured quad with the
 * tile's cached texture. Camera transform is built into vertex positions.
 *
 * FBO-rendered tiles have Y-inverted content (standard OpenGL) and use flipped
 * V texture coordinates. Bitmap-uploaded tiles use normal coordinates.
 */

import type { Camera } from "../Camera";
import type { TileGridConfig } from "./TileTypes";
import type { WebGLTileCache } from "./WebGLTileCache";
import { TileGrid } from "./TileGrid";
import { createShaderProgram, deleteShaderProgram } from "../engine/GLShaders";
import type { ShaderProgram } from "../engine/GLShaders";
import { createStaticBuffer, createIndexBuffer, DynamicBuffer } from "../engine/GLBuffers";
import { parseColor } from "../engine/GLColor";
import { DESK_COLORS } from "../BackgroundRenderer";
import { TEXTURE_VERT, TEXTURE_FRAG } from "../engine/shaders";

export class WebGLTileCompositor {
  private gl: WebGL2RenderingContext;
  private grid: TileGrid;
  private config: TileGridConfig;

  private prog: ShaderProgram;
  private quadVBO: WebGLBuffer;
  private quadIBO: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private quadBuffer: DynamicBuffer;

  private clearColor: Float32Array;

  /** Cached projection matrix — recomputed when canvas dimensions change. */
  private projMatrix = new Float32Array(9);
  private projCanvasW = 0;
  private projCanvasH = 0;

  /** Reusable buffer for per-tile quad vertices (avoids GC pressure). */
  private readonly tileVerts = new Float32Array(16);

  constructor(gl: WebGL2RenderingContext, grid: TileGrid, config: TileGridConfig) {
    this.gl = gl;
    this.grid = grid;
    this.config = config;

    this.prog = createShaderProgram(gl, TEXTURE_VERT, TEXTURE_FRAG);

    // Unit quad for index buffer reuse
    this.quadVBO = createStaticBuffer(gl, new Float32Array([
      0, 0, 0, 0,
      1, 0, 1, 0,
      1, 1, 1, 1,
      0, 1, 0, 1,
    ]));
    this.quadIBO = createIndexBuffer(gl, new Uint16Array([0, 1, 2, 0, 2, 3]));
    this.vao = gl.createVertexArray()!;

    // Dynamic buffer for per-tile quad vertices
    this.quadBuffer = new DynamicBuffer(gl, 4096);

    // Default to light desk color
    this.clearColor = parseColor(DESK_COLORS.light, 1.0);
  }

  setDarkMode(isDark: boolean): void {
    this.clearColor = parseColor(isDark ? DESK_COLORS.dark : DESK_COLORS.light, 1.0);
  }

  /**
   * Composite all visible tile textures onto the default framebuffer.
   */
  composite(
    camera: Camera,
    screenWidth: number,
    screenHeight: number,
    tileCache: WebGLTileCache,
  ): void {
    const gl = this.gl;
    const dpr = this.config.dpr;
    const canvasW = Math.round(screenWidth * dpr);
    const canvasH = Math.round(screenHeight * dpr);

    // Bind default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);

    // Clear with desk color
    gl.clearColor(
      this.clearColor[0],
      this.clearColor[1],
      this.clearColor[2],
      this.clearColor[3],
    );
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Set up blending for premultiplied alpha
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);

    const prog = this.prog;
    gl.useProgram(prog.program);

    // Recompute projection only when canvas dimensions change
    if (canvasW !== this.projCanvasW || canvasH !== this.projCanvasH) {
      this.projCanvasW = canvasW;
      this.projCanvasH = canvasH;
      const p = this.projMatrix;
      p[0] = 2 / canvasW; p[1] = 0; p[2] = 0;
      p[3] = 0; p[4] = -2 / canvasH; p[5] = 0;
      p[6] = -1; p[7] = 1; p[8] = 1;
    }
    gl.uniformMatrix3fv(prog.uniforms.get("u_transform")!, false, this.projMatrix);
    gl.uniform1f(prog.uniforms.get("u_alpha")!, 1.0);
    gl.uniform1i(prog.uniforms.get("u_texture")!, 0);

    gl.bindVertexArray(this.vao);

    const tileWorldSize = this.config.tileWorldSize;
    const tileScreenSize = tileWorldSize * camera.zoom * dpr;
    const visibleTiles = this.grid.getVisibleTiles(camera, screenWidth, screenHeight);

    const posLoc = prog.attributes.get("a_position")!;
    const tcLoc = prog.attributes.get("a_texcoord")!;
    const v = this.tileVerts;

    // Set up vertex attributes once (buffer pointer updates per tile via upload)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer.buffer);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(tcLoc);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIBO);

    for (const key of visibleTiles) {
      const entry = tileCache.getStale(key);
      if (!entry) continue;

      const screenX = (key.col * tileWorldSize - camera.x) * camera.zoom * dpr;
      const screenY = (key.row * tileWorldSize - camera.y) * camera.zoom * dpr;
      const sx1 = screenX + tileScreenSize;
      const sy1 = screenY + tileScreenSize;

      // FBO-rendered tiles have Y-inverted content → flip V coords
      const isFBO = entry.fbo !== null || entry.msaa !== null;
      const v0 = isFBO ? 1 : 0;
      const v1 = isFBO ? 0 : 1;

      // Fill reusable vertex buffer (position.xy, texcoord.uv)
      v[0] = screenX; v[1] = screenY; v[2] = 0; v[3] = v0;
      v[4] = sx1;     v[5] = screenY; v[6] = 1; v[7] = v0;
      v[8] = sx1;     v[9] = sy1;     v[10] = 1; v[11] = v1;
      v[12] = screenX; v[13] = sy1;   v[14] = 0; v[15] = v1;

      this.quadBuffer.upload(v);

      // Bind tile texture and draw
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    // Unbind to prevent polluting tile engine's GLState
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
  }

  destroy(): void {
    const gl = this.gl;
    deleteShaderProgram(gl, this.prog);
    gl.deleteBuffer(this.quadVBO);
    gl.deleteBuffer(this.quadIBO);
    gl.deleteVertexArray(this.vao);
    this.quadBuffer.destroy();
  }
}
