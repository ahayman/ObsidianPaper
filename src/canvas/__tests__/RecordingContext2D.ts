/**
 * A mock CanvasRenderingContext2D that records all method calls and state changes
 * for golden master testing of the Canvas2D rendering path.
 *
 * Records state property assignments (fillStyle, globalAlpha, globalCompositeOperation)
 * as calls via Object.defineProperty setters.
 *
 * Maintains real transform stack state because renderStrokeToContext calls
 * ctx.getTransform() for computeScreenBBox().
 */

export interface RecordedCall {
  method: string;
  args: unknown[];
}

interface RecordingContext2DOptions {
  width: number;
  height: number;
}

interface RecordingOffscreen {
  canvas: RecordingOffscreenCanvas;
  ctx: RecordingContext2D;
}

class RecordingOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

export class RecordingContext2D {
  readonly calls: RecordedCall[] = [];

  private _fillStyle: string | CanvasPattern = "";
  private _globalAlpha = 1;
  private _globalCompositeOperation = "source-over";
  private transformStack: DOMMatrix[] = [];
  private stateStack: Array<{
    fillStyle: string | CanvasPattern;
    globalAlpha: number;
    globalCompositeOperation: string;
  }> = [];
  private currentTransform = new DOMMatrix();

  /** Mock canvas with width/height (some code reads ctx.canvas.width). */
  canvas: { width: number; height: number };

  constructor(options: RecordingContext2DOptions) {
    this.canvas = { width: options.width, height: options.height };
  }

  // --- State properties (recorded via getters/setters) ---

  get fillStyle(): string | CanvasPattern {
    return this._fillStyle;
  }

  set fillStyle(value: string | CanvasPattern) {
    this._fillStyle = value;
    // Record the value; for CanvasPattern record as "pattern"
    const recorded = typeof value === "string" ? value : "CanvasPattern";
    this.calls.push({ method: "set:fillStyle", args: [recorded] });
  }

  get globalAlpha(): number {
    return this._globalAlpha;
  }

  set globalAlpha(value: number) {
    this._globalAlpha = value;
    this.calls.push({ method: "set:globalAlpha", args: [value] });
  }

  get globalCompositeOperation(): string {
    return this._globalCompositeOperation;
  }

  set globalCompositeOperation(value: string) {
    this._globalCompositeOperation = value;
    this.calls.push({ method: "set:globalCompositeOperation", args: [value] });
  }

  // --- Transform stack ---

  save(): void {
    this.transformStack.push(DOMMatrix.fromMatrix(this.currentTransform));
    this.stateStack.push({
      fillStyle: this._fillStyle,
      globalAlpha: this._globalAlpha,
      globalCompositeOperation: this._globalCompositeOperation,
    });
    this.calls.push({ method: "save", args: [] });
  }

  restore(): void {
    const prevTransform = this.transformStack.pop();
    if (prevTransform) {
      this.currentTransform = prevTransform;
    }
    const prevState = this.stateStack.pop();
    if (prevState) {
      this._fillStyle = prevState.fillStyle;
      this._globalAlpha = prevState.globalAlpha;
      this._globalCompositeOperation = prevState.globalCompositeOperation;
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

  getTransform(): DOMMatrix {
    return DOMMatrix.fromMatrix(this.currentTransform);
  }

  // --- Drawing ---

  fill(pathOrRule?: unknown): void {
    if (pathOrRule && typeof pathOrRule === "object") {
      this.calls.push({ method: "fill", args: ["Path2D"] });
    } else {
      this.calls.push({
        method: "fill",
        args: pathOrRule != null ? [pathOrRule] : [],
      });
    }
  }

  clip(pathOrRule?: unknown): void {
    if (pathOrRule && typeof pathOrRule === "object") {
      this.calls.push({ method: "clip", args: ["Path2D"] });
    } else {
      this.calls.push({
        method: "clip",
        args: pathOrRule != null ? [pathOrRule] : [],
      });
    }
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: "clearRect", args: [x, y, w, h] });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: "fillRect", args: [x, y, w, h] });
  }

  drawImage(...args: unknown[]): void {
    // Normalize: replace source canvas/image with "source" identifier
    this.calls.push({
      method: "drawImage",
      args: ["source", ...(args.slice(1) as unknown[])],
    });
  }

  // --- Paths ---

  beginPath(): void {
    this.calls.push({ method: "beginPath", args: [] });
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.calls.push({
      method: "arc",
      args: [x, y, radius, startAngle, endAngle, counterclockwise ?? false],
    });
  }

  moveTo(x: number, y: number): void {
    this.calls.push({ method: "moveTo", args: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.calls.push({ method: "lineTo", args: [x, y] });
  }

  closePath(): void {
    this.calls.push({ method: "closePath", args: [] });
  }

  // --- Pattern (for grain texture) ---

  createPattern(
    _image: unknown,
    _repetition: string | null,
  ): CanvasPattern | null {
    // Return a mock pattern object
    return {
      setTransform: () => {},
    } as unknown as CanvasPattern;
  }

  // --- Utility ---

  reset(): void {
    this.calls.length = 0;
    this.transformStack.length = 0;
    this.stateStack.length = 0;
    this.currentTransform = new DOMMatrix();
    this._fillStyle = "";
    this._globalAlpha = 1;
    this._globalCompositeOperation = "source-over";
  }

  snapshot(): RecordedCall[] {
    return JSON.parse(JSON.stringify(this.calls));
  }

  /**
   * Create an offscreen context pair (canvas + recording ctx).
   * Used for GrainRenderContext.getOffscreen().
   */
  static createOffscreen(
    width: number,
    height: number,
  ): RecordingOffscreen {
    const canvas = new RecordingOffscreenCanvas(width, height);
    const ctx = new RecordingContext2D({ width, height });
    return { canvas: canvas as unknown as RecordingOffscreenCanvas, ctx };
  }
}
