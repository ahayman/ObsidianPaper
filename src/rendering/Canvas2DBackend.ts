/**
 * Canvas2D implementation of DrawingBackend.
 *
 * Wraps a CanvasRenderingContext2D (or OffscreenCanvasRenderingContext2D)
 * and converts Float32Array vertex data to Path2D objects for drawing.
 */

import type {
  DrawingBackend,
  TextureRef,
  OffscreenRef,
  BackendBlendMode,
} from "./DrawingBackend";

// ─── Internal Types ─────────────────────────────────────────

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Canvas2DTextureRef extends TextureRef {
  readonly source: CanvasImageSource;
  pattern?: CanvasPattern | null;
}

interface Canvas2DOffscreenRef extends OffscreenRef {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: Ctx2D;
}

// ─── Blend mode mapping ─────────────────────────────────────

const BLEND_MODE_MAP: Record<BackendBlendMode, GlobalCompositeOperation> = {
  "source-over": "source-over",
  "destination-in": "destination-in",
  "destination-out": "destination-out",
  "multiply": "multiply",
};

// ─── Canvas2DBackend ────────────────────────────────────────

export class Canvas2DBackend implements DrawingBackend {
  private ctx: Ctx2D;
  private contextStack: Ctx2D[] = [];
  private offscreens = new Map<string, Canvas2DOffscreenRef>();

  constructor(ctx: Ctx2D) {
    this.ctx = ctx;
  }

  /** The currently active context (main or offscreen). */
  private get activeCtx(): Ctx2D {
    if (this.contextStack.length > 0) {
      return this.contextStack[this.contextStack.length - 1]!;
    }
    return this.ctx;
  }

  get width(): number {
    return this.activeCtx.canvas.width;
  }

  get height(): number {
    return this.activeCtx.canvas.height;
  }

  // ── State stack ──────────────────────────────────────────

  save(): void {
    this.activeCtx.save();
  }

  restore(): void {
    this.activeCtx.restore();
  }

  // ── Transform ────────────────────────────────────────────

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.activeCtx.setTransform(a, b, c, d, e, f);
  }

  getTransform(): DOMMatrix {
    return this.activeCtx.getTransform();
  }

  // ── Style ────────────────────────────────────────────────

  setFillColor(color: string): void {
    this.activeCtx.fillStyle = color;
  }

  setAlpha(alpha: number): void {
    this.activeCtx.globalAlpha = alpha;
  }

  setBlendMode(mode: BackendBlendMode): void {
    this.activeCtx.globalCompositeOperation = BLEND_MODE_MAP[mode];
  }

  // ── Geometry fill ────────────────────────────────────────

  fillPath(vertices: Float32Array): void {
    const path = verticesToPath2D(vertices);
    if (path) {
      this.activeCtx.fill(path);
    }
  }

  fillTriangles(vertices: Float32Array): void {
    const path = trianglesToPath2D(vertices);
    if (path) {
      this.activeCtx.fill(path);
    }
  }

  // ── Stamps ───────────────────────────────────────────────

  drawStampDiscs(color: string, data: Float32Array): void {
    const ctx = this.activeCtx;
    const TWO_PI = Math.PI * 2;
    ctx.fillStyle = color;
    for (let i = 0; i < data.length; i += 4) {
      const x = data[i]!;
      const y = data[i + 1]!;
      const size = data[i + 2]!;
      const opacity = data[i + 3]!;
      if (opacity < 0.05) continue;
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.5, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawStamps(texture: TextureRef, data: Float32Array): void {
    const tex = texture as Canvas2DTextureRef;
    const ctx = this.activeCtx;
    for (let i = 0; i < data.length; i += 4) {
      const x = data[i]!;
      const y = data[i + 1]!;
      const size = data[i + 2]!;
      const opacity = data[i + 3]!;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = opacity;
      const half = size * 0.5;
      ctx.drawImage(tex.source, x - half, y - half, size, size);
      ctx.globalAlpha = prevAlpha;
    }
  }

  // ── Grain texture ────────────────────────────────────────

  applyGrain(
    texture: TextureRef,
    offsetX: number,
    offsetY: number,
    strength: number,
  ): void {
    const tex = texture as Canvas2DTextureRef;
    const ctx = this.activeCtx;

    if (!tex.pattern) {
      tex.pattern = ctx.createPattern(tex.source, "repeat");
    }
    if (!tex.pattern) return;

    ctx.save();
    ctx.globalAlpha = strength;
    ctx.globalCompositeOperation = "destination-out";
    ctx.setTransform(1, 0, 0, 1, offsetX, offsetY);
    ctx.fillStyle = tex.pattern;
    ctx.fillRect(-offsetX, -offsetY, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  // ── Masking ──────────────────────────────────────────────

  maskToPath(vertices: Float32Array): void {
    const path = verticesToPath2D(vertices);
    if (!path) return;
    const ctx = this.activeCtx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.globalAlpha = 1;
    ctx.fill(path);
    ctx.restore();
  }

  maskToTriangles(vertices: Float32Array): void {
    const path = trianglesToPath2D(vertices);
    if (!path) return;
    const ctx = this.activeCtx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.globalAlpha = 1;
    ctx.fill(path);
    ctx.restore();
  }

  // ── Clipping ─────────────────────────────────────────────

  clipPath(vertices: Float32Array): void {
    const path = verticesToPath2D(vertices);
    if (path) {
      this.activeCtx.clip(path);
    }
  }

  clipRect(x: number, y: number, w: number, h: number): void {
    const path = new Path2D();
    path.rect(x, y, w, h);
    this.activeCtx.clip(path);
  }

  // ── Offscreen rendering ──────────────────────────────────

  getOffscreen(id: string, width: number, height: number): OffscreenRef {
    let target = this.offscreens.get(id);
    if (target) {
      if (target.width !== width || target.height !== height) {
        target = createOffscreen(width, height);
        this.offscreens.set(id, target);
      }
      return target;
    }
    target = createOffscreen(width, height);
    this.offscreens.set(id, target);
    return target;
  }

  beginOffscreen(target: OffscreenRef): void {
    const t = target as Canvas2DOffscreenRef;
    this.contextStack.push(t.ctx);
  }

  endOffscreen(): void {
    this.contextStack.pop();
  }

  drawOffscreen(
    target: OffscreenRef,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    const t = target as Canvas2DOffscreenRef;
    this.activeCtx.drawImage(t.canvas as CanvasImageSource, dx, dy, dw, dh);
  }

  clear(): void {
    const ctx = this.activeCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  // ── Image drawing ────────────────────────────────────────

  fillRect(x: number, y: number, w: number, h: number): void {
    this.activeCtx.fillRect(x, y, w, h);
  }

  // ── Texture creation (Canvas2D-specific) ─────────────────

  /**
   * Create a TextureRef from a canvas image source.
   * Canvas2D textures are just references to the source image.
   */
  static createTexture(source: CanvasImageSource, width: number, height: number): TextureRef {
    const handle: Canvas2DTextureRef = { width, height, source };
    return handle;
  }
}

// ─── Path Conversion Helpers ────────────────────────────────
// Same algorithms as Canvas2DEngine.ts verticesToPath2D / trianglesToPath2D.

/**
 * Convert Float32Array vertex pairs [x0, y0, x1, y1, ...] to a Path2D
 * using midpoint quadratic Bézier curves.
 */
function verticesToPath2D(vertices: Float32Array): Path2D | null {
  const n = vertices.length / 2;
  if (n < 2) return null;

  const path = new Path2D();

  if (n < 3) {
    path.moveTo(vertices[0]!, vertices[1]!);
    for (let i = 1; i < n; i++) {
      path.lineTo(vertices[i * 2]!, vertices[i * 2 + 1]!);
    }
    path.closePath();
    return path;
  }

  const mx0 = (vertices[0]! + vertices[2]!) * 0.5;
  const my0 = (vertices[1]! + vertices[3]!) * 0.5;
  path.moveTo(mx0, my0);

  for (let i = 1; i < n; i++) {
    const nextIdx = ((i + 1) % n) * 2;
    const mx = (vertices[i * 2]! + vertices[nextIdx]!) * 0.5;
    const my = (vertices[i * 2 + 1]! + vertices[nextIdx + 1]!) * 0.5;
    path.quadraticCurveTo(vertices[i * 2]!, vertices[i * 2 + 1]!, mx, my);
  }

  path.quadraticCurveTo(vertices[0]!, vertices[1]!, mx0, my0);
  path.closePath();
  return path;
}

/**
 * Convert Float32Array triangle vertices to a Path2D.
 * Every 3 vertices (6 floats) = 1 triangle, with normalized winding.
 */
function trianglesToPath2D(vertices: Float32Array): Path2D | null {
  const vertCount = vertices.length / 2;
  if (vertCount < 3) return null;

  const path = new Path2D();
  for (let i = 0; i < vertCount; i += 3) {
    const ax = vertices[i * 2]!, ay = vertices[i * 2 + 1]!;
    const bx = vertices[(i + 1) * 2]!, by = vertices[(i + 1) * 2 + 1]!;
    const cx = vertices[(i + 2) * 2]!, cy = vertices[(i + 2) * 2 + 1]!;

    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

    if (cross >= 0) {
      path.moveTo(ax, ay);
      path.lineTo(bx, by);
      path.lineTo(cx, cy);
    } else {
      path.moveTo(ax, ay);
      path.lineTo(cx, cy);
      path.lineTo(bx, by);
    }
    path.closePath();
  }
  return path;
}

// ─── Offscreen creation helper ──────────────────────────────

function createOffscreen(width: number, height: number): Canvas2DOffscreenRef {
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create offscreen 2D context");
  return { width, height, canvas, ctx };
}
