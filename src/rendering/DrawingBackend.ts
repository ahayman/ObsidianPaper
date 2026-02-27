/**
 * Unified drawing backend interface that abstracts Canvas2D and WebGL.
 *
 * Operations are at the visual-concept level used by the material executor:
 * geometry fills, stamp batches, grain textures, offscreen isolation, and
 * state management. Each backend maps these to its native API.
 *
 * Canvas2DBackend wraps CanvasRenderingContext2D.
 * WebGLBackend wraps the existing RenderEngine interface.
 */

// ─── Opaque Handles ─────────────────────────────────────────

/** Opaque handle to a texture loaded into the backend. */
export interface TextureRef {
  readonly width: number;
  readonly height: number;
}

/** Opaque handle to an offscreen render target. */
export interface OffscreenRef {
  readonly width: number;
  readonly height: number;
}

// ─── Types ──────────────────────────────────────────────────

/** Blend modes supported by both Canvas 2D and WebGL backends. */
export type BackendBlendMode = "source-over" | "destination-in" | "destination-out" | "multiply";

// ─── Interface ──────────────────────────────────────────────

export interface DrawingBackend {
  /** Canvas/target width in physical pixels. */
  readonly width: number;
  /** Canvas/target height in physical pixels. */
  readonly height: number;

  // ── State stack ──────────────────────────────────────────

  save(): void;
  restore(): void;

  // ── Transform ────────────────────────────────────────────

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  getTransform(): DOMMatrix;

  // ── Style ────────────────────────────────────────────────

  setFillColor(color: string): void;
  setAlpha(alpha: number): void;
  setBlendMode(mode: BackendBlendMode): void;

  // ── Geometry fill ────────────────────────────────────────

  /**
   * Fill a closed path from Float32Array vertex pairs [x0, y0, x1, y1, ...].
   * Uses midpoint quadratic Bézier interpolation for smooth curves.
   */
  fillPath(vertices: Float32Array): void;

  /**
   * Fill explicit triangles. Vertices: [x0,y0, x1,y1, x2,y2, ...],
   * every 3 vertex pairs = 1 triangle.
   */
  fillTriangles(vertices: Float32Array): void;

  // ── Stamps ───────────────────────────────────────────────

  /**
   * Draw a batch of hard-circle stamps (no texture).
   * Data: Float32Array of [x, y, size, opacity] tuples.
   */
  drawStampDiscs(color: string, data: Float32Array): void;

  /**
   * Draw a batch of textured stamps.
   * Data: Float32Array of [x, y, size, opacity] tuples.
   */
  drawStamps(texture: TextureRef, data: Float32Array): void;

  // ── Grain texture ────────────────────────────────────────

  /**
   * Apply a grain texture as an eraser pattern over the current content.
   * Uses destination-out compositing.
   */
  applyGrain(
    texture: TextureRef,
    offsetX: number,
    offsetY: number,
    strength: number,
  ): void;

  // ── Masking ──────────────────────────────────────────────

  /**
   * Destination-in mask: keep pixels inside the path, clear pixels outside.
   */
  maskToPath(vertices: Float32Array): void;

  /**
   * Destination-in mask using explicit triangles.
   */
  maskToTriangles(vertices: Float32Array): void;

  // ── Clipping ─────────────────────────────────────────────

  clipPath(vertices: Float32Array): void;
  clipRect(x: number, y: number, w: number, h: number): void;

  // ── Offscreen rendering ──────────────────────────────────

  /**
   * Get or create a reusable offscreen target of the given size.
   */
  getOffscreen(id: string, width: number, height: number): OffscreenRef;

  /**
   * Begin rendering to an offscreen target. All subsequent draw calls
   * go to this target until endOffscreen() is called.
   */
  beginOffscreen(target: OffscreenRef): void;

  /** End offscreen rendering and restore previous render target. */
  endOffscreen(): void;

  /** Draw an offscreen target to the current render target. */
  drawOffscreen(
    target: OffscreenRef,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;

  /** Clear the current render target. */
  clear(): void;

  // ── Image drawing ────────────────────────────────────────

  /**
   * Fill a rectangle at the given position and size.
   */
  fillRect(x: number, y: number, w: number, h: number): void;
}
