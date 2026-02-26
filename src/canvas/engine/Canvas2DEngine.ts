import type {
  RenderEngine,
  TextureHandle,
  OffscreenTarget,
  BlendMode,
  ImageSource,
} from "./RenderEngine";

// --- Internal types ---

interface Canvas2DTextureHandle extends TextureHandle {
  readonly source: ImageSource;
  pattern?: CanvasPattern | null;
}

class Canvas2DOffscreenTarget implements OffscreenTarget {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    if (typeof OffscreenCanvas !== "undefined") {
      this.canvas = new OffscreenCanvas(width, height);
    } else {
      this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create offscreen 2D context");
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }
}

// --- Blend mode mapping ---

const BLEND_MODE_MAP: Record<BlendMode, GlobalCompositeOperation> = {
  "source-over": "source-over",
  "destination-in": "destination-in",
  "destination-out": "destination-out",
  "multiply": "multiply",
};

// --- Canvas2DEngine ---

export class Canvas2DEngine implements RenderEngine {
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private mainCanvas: HTMLCanvasElement | OffscreenCanvas;
  private offscreens = new Map<string, Canvas2DOffscreenTarget>();
  private contextStack: (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D)[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.mainCanvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context");
    this.ctx = ctx;
  }

  /** The currently active context (main or offscreen). */
  private get activeCtx(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    if (this.contextStack.length > 0) {
      return this.contextStack[this.contextStack.length - 1];
    }
    return this.ctx;
  }

  // --- Lifecycle ---

  get width(): number {
    return this.mainCanvas.width;
  }

  get height(): number {
    return this.mainCanvas.height;
  }

  resize(width: number, height: number): void {
    this.mainCanvas.width = width;
    this.mainCanvas.height = height;
  }

  setCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
    this.mainCanvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context");
    this.ctx = ctx;
    this.contextStack.length = 0;
  }

  destroy(): void {
    this.offscreens.clear();
    this.contextStack.length = 0;
  }

  // --- Transform stack ---

  save(): void {
    this.activeCtx.save();
  }

  restore(): void {
    this.activeCtx.restore();
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.activeCtx.setTransform(a, b, c, d, e, f);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.activeCtx.transform(a, b, c, d, e, f);
  }

  translate(x: number, y: number): void {
    this.activeCtx.translate(x, y);
  }

  scale(sx: number, sy: number): void {
    this.activeCtx.scale(sx, sy);
  }

  getTransform(): DOMMatrix {
    return this.activeCtx.getTransform();
  }

  // --- Style ---

  setFillColor(color: string): void {
    this.activeCtx.fillStyle = color;
  }

  setStrokeColor(color: string): void {
    this.activeCtx.strokeStyle = color;
  }

  setLineWidth(width: number): void {
    this.activeCtx.lineWidth = width;
  }

  setAlpha(alpha: number): void {
    this.activeCtx.globalAlpha = alpha;
  }

  setBlendMode(mode: BlendMode): void {
    this.activeCtx.globalCompositeOperation = BLEND_MODE_MAP[mode];
  }

  // --- Drawing ---

  clear(): void {
    const ctx = this.activeCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.activeCtx.fillRect(x, y, w, h);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.activeCtx.strokeRect(x, y, w, h);
  }

  fillPath(vertices: Float32Array): void {
    const path = verticesToPath2D(vertices);
    if (path) {
      this.activeCtx.fill(path);
    }
  }

  drawImage(
    source: ImageSource | OffscreenTarget,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    const img = isOffscreenTarget(source) ? source.canvas : source;
    this.activeCtx.drawImage(img as CanvasImageSource, dx, dy, dw, dh);
  }

  // --- Clipping ---

  clipRect(x: number, y: number, w: number, h: number): void {
    const ctx = this.activeCtx;
    const path = new Path2D();
    path.rect(x, y, w, h);
    ctx.clip(path);
  }

  clipPath(vertices: Float32Array): void {
    const path = verticesToPath2D(vertices);
    if (path) {
      this.activeCtx.clip(path);
    }
  }

  // --- Offscreen rendering ---

  getOffscreen(id: string, width: number, height: number): OffscreenTarget {
    let target = this.offscreens.get(id);
    if (target) {
      if (target.width !== width || target.height !== height) {
        target.resize(width, height);
      }
      return target;
    }
    target = new Canvas2DOffscreenTarget(width, height);
    this.offscreens.set(id, target);
    return target;
  }

  beginOffscreen(target: OffscreenTarget): void {
    const t = target as Canvas2DOffscreenTarget;
    this.contextStack.push(t.ctx);
  }

  endOffscreen(): void {
    this.contextStack.pop();
  }

  drawOffscreen(
    target: OffscreenTarget,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    const t = target as Canvas2DOffscreenTarget;
    this.activeCtx.drawImage(t.canvas as CanvasImageSource, dx, dy, dw, dh);
  }

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

  fillTriangles(vertices: Float32Array): void {
    const path = trianglesToPath2D(vertices);
    if (path) {
      this.activeCtx.fill(path);
    }
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

  // --- Stamp rendering ---

  drawStamps(texture: TextureHandle, data: Float32Array): void {
    const tex = texture as Canvas2DTextureHandle;
    const ctx = this.activeCtx;
    // data layout: [x, y, size, opacity] per stamp
    for (let i = 0; i < data.length; i += 4) {
      const x = data[i];
      const y = data[i + 1];
      const size = data[i + 2];
      const opacity = data[i + 3];
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = opacity;
      const half = size * 0.5;
      ctx.drawImage(tex.source as CanvasImageSource, x - half, y - half, size, size);
      ctx.globalAlpha = prevAlpha;
    }
  }

  drawStampDiscs(color: string, data: Float32Array): void {
    const ctx = this.activeCtx;
    const TWO_PI = Math.PI * 2;
    ctx.fillStyle = color;
    for (let i = 0; i < data.length; i += 4) {
      const x = data[i];
      const y = data[i + 1];
      const size = data[i + 2];
      const opacity = data[i + 3];
      if (opacity < 0.05) continue;
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.5, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- Grain texture ---

  applyGrain(
    texture: TextureHandle,
    offsetX: number,
    offsetY: number,
    strength: number,
  ): void {
    const tex = texture as Canvas2DTextureHandle;
    const ctx = this.activeCtx;

    if (!tex.pattern) {
      tex.pattern = ctx.createPattern(tex.source as CanvasImageSource, "repeat");
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

  // --- Texture management ---

  createTexture(source: ImageSource): TextureHandle {
    const handle: Canvas2DTextureHandle = {
      width: getSourceWidth(source),
      height: getSourceHeight(source),
      source,
    };
    return handle;
  }

  deleteTexture(_handle: TextureHandle): void {
    // Canvas2D textures don't need explicit cleanup
  }

  // --- Background drawing ---

  drawLines(lines: Float32Array, color: string, lineWidth: number): void {
    const ctx = this.activeCtx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    // data layout: [x1, y1, x2, y2] per line
    for (let i = 0; i < lines.length; i += 4) {
      ctx.moveTo(lines[i], lines[i + 1]);
      ctx.lineTo(lines[i + 2], lines[i + 3]);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawCircles(circles: Float32Array, color: string): void {
    const ctx = this.activeCtx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    // data layout: [cx, cy, radius] per circle
    for (let i = 0; i < circles.length; i += 3) {
      ctx.moveTo(circles[i] + circles[i + 2], circles[i + 1]);
      ctx.arc(circles[i], circles[i + 1], circles[i + 2], 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  // --- Shadow ---

  setShadow(color: string, blur: number, offsetX: number, offsetY: number): void {
    const ctx = this.activeCtx;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = offsetX;
    ctx.shadowOffsetY = offsetY;
  }

  clearShadow(): void {
    const ctx = this.activeCtx;
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}

// --- Helpers ---

function isOffscreenTarget(obj: unknown): obj is Canvas2DOffscreenTarget {
  return obj instanceof Canvas2DOffscreenTarget;
}

function getSourceWidth(source: ImageSource): number {
  if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
    return source.width;
  }
  if (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) {
    return source.width;
  }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return source.width;
  }
  return 0;
}

function getSourceHeight(source: ImageSource): number {
  if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
    return source.height;
  }
  if (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) {
    return source.height;
  }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return source.height;
  }
  return 0;
}

/**
 * Convert a Float32Array of triangle vertices [x0, y0, x1, y1, x2, y2, ...]
 * into a Path2D with one closed sub-path per triangle.
 * Every 3 vertices (6 floats) = 1 triangle.
 *
 * All triangles are normalized to the same winding direction so the nonzero
 * fill rule never cancels overlapping triangles from adjacent stroke segments.
 */
function trianglesToPath2D(vertices: Float32Array): Path2D | null {
  const vertCount = vertices.length / 2;
  if (vertCount < 3) return null;

  const path = new Path2D();
  for (let i = 0; i < vertCount; i += 3) {
    const ax = vertices[i * 2], ay = vertices[i * 2 + 1];
    const bx = vertices[(i + 1) * 2], by = vertices[(i + 1) * 2 + 1];
    const cx = vertices[(i + 2) * 2], cy = vertices[(i + 2) * 2 + 1];

    // Cross product sign determines winding direction.
    // Normalize all triangles to the same sign.
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

    if (cross >= 0) {
      path.moveTo(ax, ay);
      path.lineTo(bx, by);
      path.lineTo(cx, cy);
    } else {
      // Reverse B and C to flip winding
      path.moveTo(ax, ay);
      path.lineTo(cx, cy);
      path.lineTo(bx, by);
    }
    path.closePath();
  }
  return path;
}

/**
 * Convert a Float32Array of vertex pairs [x0, y0, x1, y1, ...]
 * into a Path2D using midpoint quadratic Bézier curves.
 * Same technique as outlineToPath2D() in OutlineGenerator.ts.
 */
function verticesToPath2D(vertices: Float32Array): Path2D | null {
  const n = vertices.length / 2;
  if (n < 2) return null;

  const path = new Path2D();

  if (n < 3) {
    path.moveTo(vertices[0], vertices[1]);
    for (let i = 1; i < n; i++) {
      path.lineTo(vertices[i * 2], vertices[i * 2 + 1]);
    }
    path.closePath();
    return path;
  }

  // Start at midpoint between first and second point
  const mx0 = (vertices[0] + vertices[2]) * 0.5;
  const my0 = (vertices[1] + vertices[3]) * 0.5;
  path.moveTo(mx0, my0);

  for (let i = 1; i < n; i++) {
    const nextIdx = ((i + 1) % n) * 2;
    const mx = (vertices[i * 2] + vertices[nextIdx]) * 0.5;
    const my = (vertices[i * 2 + 1] + vertices[nextIdx + 1]) * 0.5;
    path.quadraticCurveTo(vertices[i * 2], vertices[i * 2 + 1], mx, my);
  }

  // Final curve through P0 back to start
  path.quadraticCurveTo(vertices[0], vertices[1], mx0, my0);
  path.closePath();
  return path;
}
