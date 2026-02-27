/**
 * A RenderEngine implementation that records all method calls for golden master testing.
 *
 * Records the exact sequence of drawing operations so we can snapshot-test
 * that the new material-based architecture produces identical rendering calls.
 *
 * Maintains real transform stack state because renderStrokeToEngine calls
 * engine.getTransform() and uses the result for computeScreenBBox().
 */

import type {
  RenderEngine,
  TextureHandle,
  OffscreenTarget,
  BlendMode,
  ImageSource,
} from "../engine/RenderEngine";

export interface RecordedCall {
  method: string;
  args: unknown[];
}

interface RecordingEngineOptions {
  width: number;
  height: number;
}

class RecordingOffscreenTarget implements OffscreenTarget {
  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {}
}

export class RecordingEngine implements RenderEngine {
  readonly calls: RecordedCall[] = [];

  private _width: number;
  private _height: number;
  private transformStack: DOMMatrix[] = [];
  private currentTransform = new DOMMatrix();
  private offscreens = new Map<string, RecordingOffscreenTarget>();
  private nextTextureId = 1;

  constructor(options: RecordingEngineOptions) {
    this._width = options.width;
    this._height = options.height;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  // --- Utility ---

  reset(): void {
    this.calls.length = 0;
    this.transformStack.length = 0;
    this.currentTransform = new DOMMatrix();
  }

  snapshot(): RecordedCall[] {
    return JSON.parse(JSON.stringify(this.calls));
  }

  // --- Lifecycle ---

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this.calls.push({ method: "resize", args: [width, height] });
  }

  destroy(): void {
    this.calls.push({ method: "destroy", args: [] });
  }

  setCanvas(_canvas: HTMLCanvasElement | OffscreenCanvas): void {
    this.calls.push({ method: "setCanvas", args: [] });
  }

  // --- Transform stack ---

  save(): void {
    this.transformStack.push(DOMMatrix.fromMatrix(this.currentTransform));
    this.calls.push({ method: "save", args: [] });
  }

  restore(): void {
    const prev = this.transformStack.pop();
    if (prev) {
      this.currentTransform = prev;
    }
    this.calls.push({ method: "restore", args: [] });
  }

  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.currentTransform = new DOMMatrix([a, b, c, d, e, f]);
    this.calls.push({ method: "setTransform", args: [a, b, c, d, e, f] });
  }

  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    const m = new DOMMatrix([a, b, c, d, e, f]);
    this.currentTransform = this.currentTransform.multiply(m);
    this.calls.push({ method: "transform", args: [a, b, c, d, e, f] });
  }

  translate(x: number, y: number): void {
    this.currentTransform = this.currentTransform.translate(x, y);
    this.calls.push({ method: "translate", args: [x, y] });
  }

  scale(sx: number, sy: number): void {
    this.currentTransform = this.currentTransform.scale(sx, sy);
    this.calls.push({ method: "scale", args: [sx, sy] });
  }

  getTransform(): DOMMatrix {
    return DOMMatrix.fromMatrix(this.currentTransform);
  }

  // --- Style ---

  setFillColor(color: string): void {
    this.calls.push({ method: "setFillColor", args: [color] });
  }

  setStrokeColor(color: string): void {
    this.calls.push({ method: "setStrokeColor", args: [color] });
  }

  setLineWidth(width: number): void {
    this.calls.push({ method: "setLineWidth", args: [width] });
  }

  setAlpha(alpha: number): void {
    this.calls.push({ method: "setAlpha", args: [alpha] });
  }

  setBlendMode(mode: BlendMode): void {
    this.calls.push({ method: "setBlendMode", args: [mode] });
  }

  // --- Drawing ---

  clear(): void {
    this.calls.push({ method: "clear", args: [] });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: "fillRect", args: [x, y, w, h] });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: "strokeRect", args: [x, y, w, h] });
  }

  fillPath(vertices: Float32Array): void {
    this.calls.push({ method: "fillPath", args: [Array.from(vertices)] });
  }

  drawImage(
    source: ImageSource | OffscreenTarget,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.calls.push({ method: "drawImage", args: [{ source: "image" }, dx, dy, dw, dh] });
  }

  // --- Clipping ---

  clipRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: "clipRect", args: [x, y, w, h] });
  }

  clipPath(vertices: Float32Array): void {
    this.calls.push({ method: "clipPath", args: [Array.from(vertices)] });
  }

  // --- Offscreen rendering ---

  getOffscreen(id: string, width: number, height: number): OffscreenTarget {
    let target = this.offscreens.get(id);
    if (!target || target.width < width || target.height < height) {
      target = new RecordingOffscreenTarget(width, height);
      this.offscreens.set(id, target);
    }
    return target;
  }

  beginOffscreen(target: OffscreenTarget): void {
    this.calls.push({
      method: "beginOffscreen",
      args: [{ w: target.width, h: target.height }],
    });
  }

  endOffscreen(): void {
    this.calls.push({ method: "endOffscreen", args: [] });
  }

  drawOffscreen(
    target: OffscreenTarget,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.calls.push({
      method: "drawOffscreen",
      args: [{ w: target.width, h: target.height }, dx, dy, dw, dh],
    });
  }

  // --- Masking ---

  maskToPath(vertices: Float32Array): void {
    this.calls.push({ method: "maskToPath", args: [Array.from(vertices)] });
  }

  fillTriangles(vertices: Float32Array): void {
    this.calls.push({
      method: "fillTriangles",
      args: [Array.from(vertices)],
    });
  }

  maskToTriangles(vertices: Float32Array): void {
    this.calls.push({
      method: "maskToTriangles",
      args: [Array.from(vertices)],
    });
  }

  // --- Stamp rendering ---

  drawStamps(texture: TextureHandle, data: Float32Array): void {
    this.calls.push({
      method: "drawStamps",
      args: [{ w: texture.width, h: texture.height }, Array.from(data)],
    });
  }

  drawStampDiscs(color: string, data: Float32Array): void {
    this.calls.push({
      method: "drawStampDiscs",
      args: [color, Array.from(data)],
    });
  }

  // --- Grain texture ---

  applyGrain(
    texture: TextureHandle,
    offsetX: number,
    offsetY: number,
    strength: number,
  ): void {
    this.calls.push({
      method: "applyGrain",
      args: [{ w: texture.width, h: texture.height }, offsetX, offsetY, strength],
    });
  }

  // --- Texture management ---

  createTexture(_source: ImageSource): TextureHandle {
    const id = this.nextTextureId++;
    const handle: TextureHandle = { width: 256, height: 256 };
    this.calls.push({ method: "createTexture", args: [{ id }] });
    return handle;
  }

  deleteTexture(_handle: TextureHandle): void {
    this.calls.push({ method: "deleteTexture", args: [] });
  }

  // --- Background drawing ---

  drawLines(lines: Float32Array, color: string, lineWidth: number): void {
    this.calls.push({
      method: "drawLines",
      args: [Array.from(lines), color, lineWidth],
    });
  }

  drawCircles(circles: Float32Array, color: string): void {
    this.calls.push({
      method: "drawCircles",
      args: [Array.from(circles), color],
    });
  }

  // --- Shadow ---

  setShadow(
    color: string,
    blur: number,
    offsetX: number,
    offsetY: number,
  ): void {
    this.calls.push({
      method: "setShadow",
      args: [color, blur, offsetX, offsetY],
    });
  }

  clearShadow(): void {
    this.calls.push({ method: "clearShadow", args: [] });
  }
}
