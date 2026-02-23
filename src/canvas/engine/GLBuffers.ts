/**
 * VBO/VAO management and dynamic buffer with auto-growth.
 */

/**
 * A dynamic GPU buffer that auto-grows to accommodate data.
 * Avoids frequent re-allocation for small changes.
 */
export class DynamicBuffer {
  private gl: WebGL2RenderingContext;
  readonly buffer: WebGLBuffer;
  private capacity: number;
  private usage: number;

  constructor(gl: WebGL2RenderingContext, initialCapacity: number, usage: number = gl.DYNAMIC_DRAW) {
    this.gl = gl;
    this.buffer = gl.createBuffer()!;
    this.capacity = initialCapacity;
    this.usage = usage;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, initialCapacity, usage);
  }

  /**
   * Upload data to the buffer, growing if necessary.
   * Growth strategy: double capacity until it fits.
   */
  upload(data: Float32Array): void {
    const gl = this.gl;
    const bytes = data.byteLength;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (bytes > this.capacity) {
      while (this.capacity < bytes) this.capacity *= 2;
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, this.usage);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  destroy(): void {
    this.gl.deleteBuffer(this.buffer);
  }
}

/**
 * Create a static VBO from a Float32Array (e.g. unit quad vertices).
 */
export function createStaticBuffer(
  gl: WebGL2RenderingContext,
  data: Float32Array,
): WebGLBuffer {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

/**
 * Create a static index buffer from a Uint16Array.
 */
export function createIndexBuffer(
  gl: WebGL2RenderingContext,
  data: Uint16Array,
): WebGLBuffer {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

// Unit quad for stamp/circle instanced rendering:
// Two triangles forming a square from (-0.5, -0.5) to (0.5, 0.5)
// Interleaved: position.xy, texcoord.uv
export const UNIT_QUAD_VERTICES = new Float32Array([
  // x,    y,    u,   v
  -0.5, -0.5,  0.0, 0.0,
   0.5, -0.5,  1.0, 0.0,
   0.5,  0.5,  1.0, 1.0,
  -0.5,  0.5,  0.0, 1.0,
]);

export const UNIT_QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

// Fullscreen quad (clip-space, for grain shader)
// Position is in [-1, 1] clip space, texcoord in [0, 1]
export const FULLSCREEN_QUAD_VERTICES = new Float32Array([
  // x,    y,    u,   v
  -1.0, -1.0,  0.0, 0.0,
   1.0, -1.0,  1.0, 0.0,
   1.0,  1.0,  1.0, 1.0,
  -1.0,  1.0,  0.0, 1.0,
]);

export const FULLSCREEN_QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
