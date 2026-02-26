/**
 * Abstract rendering engine interface.
 *
 * Canvas2DEngine wraps the existing Canvas 2D API.
 * A future WebGL2Engine will implement the same interface using GPU rendering.
 *
 * Key design choice: paths are represented as Float32Array vertex pairs
 * [x0, y0, x1, y1, ...] rather than Path2D, since WebGL cannot use Path2D.
 * Canvas2DEngine converts vertices to Path2D internally.
 */

/** Opaque handle to a texture loaded into the engine. */
export interface TextureHandle {
  readonly width: number;
  readonly height: number;
}

/** Opaque handle to an offscreen render target (FBO in WebGL, canvas in 2D). */
export interface OffscreenTarget {
  readonly width: number;
  readonly height: number;
}

/** Blend modes supported by both Canvas 2D and WebGL. */
export type BlendMode = "source-over" | "destination-in" | "destination-out" | "multiply";

/** Accepted image sources for drawImage / texture creation. */
export type ImageSource =
  | HTMLCanvasElement
  | OffscreenCanvas
  | HTMLImageElement
  | ImageBitmap;

export interface RenderEngine {
  // --- Lifecycle ---
  readonly width: number;
  readonly height: number;
  resize(width: number, height: number): void;
  destroy(): void;

  /**
   * Switch the engine to render to a different canvas.
   * Used by TileRenderer to reuse one engine instance across many tile canvases.
   * Canvas2DEngine: gets a new 2D context from the canvas.
   */
  setCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void;

  // --- Transform stack ---
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  scale(sx: number, sy: number): void;
  getTransform(): DOMMatrix;

  // --- Style ---
  setFillColor(color: string): void;
  setStrokeColor(color: string): void;
  setLineWidth(width: number): void;
  setAlpha(alpha: number): void;
  setBlendMode(mode: BlendMode): void;

  // --- Drawing ---
  clear(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;

  /**
   * Fill a path defined by Float32Array vertex pairs [x0, y0, x1, y1, ...].
   * Uses midpoint quadratic Bézier interpolation for smooth curves.
   */
  fillPath(vertices: Float32Array): void;

  /**
   * Draw an image at the given position and size.
   */
  drawImage(
    source: ImageSource | OffscreenTarget,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;

  // --- Clipping ---
  clipRect(x: number, y: number, w: number, h: number): void;

  /**
   * Clip to a path defined by Float32Array vertex pairs.
   */
  clipPath(vertices: Float32Array): void;

  // --- Offscreen rendering ---
  /**
   * Get or create a reusable offscreen target of the given size.
   * The target is lazily allocated and may be reused across frames.
   */
  getOffscreen(id: string, width: number, height: number): OffscreenTarget;

  /**
   * Begin rendering to an offscreen target. All subsequent draw calls
   * go to this target until endOffscreen() is called.
   */
  beginOffscreen(target: OffscreenTarget): void;

  /**
   * End offscreen rendering and restore the previous render target.
   */
  endOffscreen(): void;

  /**
   * Draw an offscreen target to the current render target.
   */
  drawOffscreen(
    target: OffscreenTarget,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;

  /**
   * Apply destination-in masking to the entire framebuffer using a path.
   * Pixels INSIDE the path are kept; pixels OUTSIDE are cleared to transparent.
   * Canvas2D: setBlendMode("destination-in") + fill(path).
   * WebGL: stencil mark + fullscreen destination-in clear for exterior pixels.
   */
  maskToPath(vertices: Float32Array): void;

  /**
   * Fill explicit triangles. Vertices: [x0,y0, x1,y1, ...], every 3 vertices = 1 triangle.
   * Used for quad-per-segment italic stroke rendering where each segment is two triangles.
   */
  fillTriangles(vertices: Float32Array): void;

  /**
   * Destination-in mask using explicit triangles.
   * Same as maskToPath but draws with gl.TRIANGLES instead of gl.TRIANGLE_FAN.
   */
  maskToTriangles(vertices: Float32Array): void;

  // --- Stamp rendering ---
  /**
   * Draw a batch of stamps from a texture.
   * Data is a Float32Array of [x, y, size, opacity] tuples.
   * WebGL uses instanced drawing; Canvas2D loops drawImage calls.
   */
  drawStamps(texture: TextureHandle, data: Float32Array): void;

  /**
   * Draw a batch of stamp particles as hard circles (no texture).
   * Data is a Float32Array of [x, y, size, opacity] tuples.
   * WebGL uses instanced SDF discs; Canvas2D loops arc() calls.
   * Used for pencil stamps to match active Canvas2D arc() rendering.
   */
  drawStampDiscs(color: string, data: Float32Array): void;

  // --- Grain texture ---
  /**
   * Apply a grain texture as an eraser pattern over the current content.
   * Canvas2D: createPattern + destination-out fill.
   * WebGL: fragment shader.
   */
  applyGrain(
    texture: TextureHandle,
    offsetX: number,
    offsetY: number,
    strength: number,
  ): void;

  // --- Texture management ---
  createTexture(source: ImageSource): TextureHandle;
  deleteTexture(handle: TextureHandle): void;

  // --- Background drawing ---
  /**
   * Draw a set of lines (used for ruled/grid backgrounds).
   * Lines is a Float32Array of [x1, y1, x2, y2] tuples.
   */
  drawLines(lines: Float32Array, color: string, lineWidth: number): void;

  /**
   * Draw a set of circles (used for dot-grid backgrounds).
   * Circles is a Float32Array of [cx, cy, radius] tuples.
   */
  drawCircles(circles: Float32Array, color: string): void;

  // --- Shadow (for background elements) ---
  setShadow(color: string, blur: number, offsetX: number, offsetY: number): void;
  clearShadow(): void;
}
