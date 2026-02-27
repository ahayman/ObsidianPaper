/**
 * Jest setup file — polyfills for APIs missing from jsdom.
 */

// DOMMatrix polyfill (jsdom doesn't provide it)
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixPolyfill {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;

    // 3D properties (read-only, identity-based)
    get m11() { return this.a; }
    get m12() { return this.b; }
    get m21() { return this.c; }
    get m22() { return this.d; }
    get m41() { return this.e; }
    get m42() { return this.f; }
    get m13() { return 0; }
    get m14() { return 0; }
    get m23() { return 0; }
    get m24() { return 0; }
    get m31() { return 0; }
    get m32() { return 0; }
    get m33() { return 1; }
    get m34() { return 0; }
    get m43() { return 0; }
    get m44() { return 1; }

    get is2D() { return true; }
    get isIdentity() {
      return this.a === 1 && this.b === 0 && this.c === 0 &&
             this.d === 1 && this.e === 0 && this.f === 0;
    }

    constructor(init?: number[] | Float32Array | Float64Array) {
      if (init && init.length >= 6) {
        this.a = init[0];
        this.b = init[1];
        this.c = init[2];
        this.d = init[3];
        this.e = init[4];
        this.f = init[5];
      } else {
        // Identity matrix
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    }

    static fromMatrix(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
      return new DOMMatrixPolyfill([other.a, other.b, other.c, other.d, other.e, other.f]);
    }

    multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
      // Standard 2D matrix multiplication
      return new DOMMatrixPolyfill([
        this.a * other.a + this.c * other.b,
        this.b * other.a + this.d * other.b,
        this.a * other.c + this.c * other.d,
        this.b * other.c + this.d * other.d,
        this.a * other.e + this.c * other.f + this.e,
        this.b * other.e + this.d * other.f + this.f,
      ]);
    }

    translate(tx: number, ty: number): DOMMatrixPolyfill {
      return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]));
    }

    scale(sx: number, sy?: number): DOMMatrixPolyfill {
      const _sy = sy ?? sx;
      return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, _sy, 0, 0]));
    }

    inverse(): DOMMatrixPolyfill {
      const det = this.a * this.d - this.b * this.c;
      if (det === 0) {
        return new DOMMatrixPolyfill([NaN, NaN, NaN, NaN, NaN, NaN]);
      }
      const invDet = 1 / det;
      return new DOMMatrixPolyfill([
        this.d * invDet,
        -this.b * invDet,
        -this.c * invDet,
        this.a * invDet,
        (this.c * this.f - this.d * this.e) * invDet,
        (this.b * this.e - this.a * this.f) * invDet,
      ]);
    }

    transformPoint(point?: { x?: number; y?: number }): { x: number; y: number; z: number; w: number } {
      const x = point?.x ?? 0;
      const y = point?.y ?? 0;
      return {
        x: this.a * x + this.c * y + this.e,
        y: this.b * x + this.d * y + this.f,
        z: 0,
        w: 1,
      };
    }

    toFloat32Array(): Float32Array {
      return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]);
    }

    toFloat64Array(): Float64Array {
      return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f]);
    }

    toString(): string {
      return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
    }
  }

  (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
}

// Path2D polyfill (jsdom doesn't provide it)
if (typeof globalThis.Path2D === "undefined") {
  class Path2DPolyfill {
    private commands: string[] = [];

    constructor(_path?: string | Path2DPolyfill) {
      // Minimal implementation — just needs to exist for recording tests
    }

    moveTo(_x: number, _y: number): void {
      this.commands.push(`M${_x},${_y}`);
    }

    lineTo(_x: number, _y: number): void {
      this.commands.push(`L${_x},${_y}`);
    }

    closePath(): void {
      this.commands.push("Z");
    }

    quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number): void {
      this.commands.push(`Q${_cpx},${_cpy},${_x},${_y}`);
    }

    bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number): void {
      this.commands.push(`C${_cp1x},${_cp1y},${_cp2x},${_cp2y},${_x},${_y}`);
    }

    arc(_x: number, _y: number, _r: number, _sa: number, _ea: number, _ccw?: boolean): void {
      this.commands.push(`A${_x},${_y},${_r}`);
    }

    ellipse(_x: number, _y: number, _rx: number, _ry: number, _rot: number, _sa: number, _ea: number, _ccw?: boolean): void {
      this.commands.push(`E${_x},${_y},${_rx},${_ry}`);
    }

    rect(_x: number, _y: number, _w: number, _h: number): void {
      this.commands.push(`R${_x},${_y},${_w},${_h}`);
    }

    addPath(_path: Path2DPolyfill): void {
      // no-op for recording tests
    }
  }

  (globalThis as any).Path2D = Path2DPolyfill;
}

// OffscreenCanvas polyfill (jsdom doesn't provide it)
if (typeof globalThis.OffscreenCanvas === "undefined") {
  class OffscreenCanvasPolyfill {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(_type: string): Record<string, any> | null {
      if (_type === "2d") {
        // Return a minimal mock 2D context with the methods Canvas2DOffscreenTarget needs
        const transformStack: any[] = [];
        let current = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        return {
          canvas: this,
          save() { transformStack.push({ ...current }); },
          restore() { const prev = transformStack.pop(); if (prev) current = prev; },
          setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { current = { a, b, c, d, e, f }; },
          getTransform() { return new (globalThis as any).DOMMatrix([current.a, current.b, current.c, current.d, current.e, current.f]); },
          transform() {},
          translate(x: number, y: number) { current.e += x; current.f += y; },
          scale(sx: number, sy: number) { current.a *= sx; current.d *= sy; },
          fillStyle: "",
          strokeStyle: "",
          lineWidth: 1,
          globalAlpha: 1,
          globalCompositeOperation: "source-over",
          shadowColor: "",
          shadowBlur: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
          fillRect() {},
          strokeRect() {},
          clearRect() {},
          fill() {},
          stroke() {},
          clip() {},
          drawImage() {},
          beginPath() {},
          moveTo() {},
          lineTo() {},
          arc() {},
          createPattern() { return {}; },
        };
      }
      return null;
    }
  }

  (globalThis as any).OffscreenCanvas = OffscreenCanvasPolyfill;
}
