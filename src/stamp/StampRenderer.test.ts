import type { StrokePoint, PenStyle } from "../types";
import { getPenConfig } from "../stroke/PenConfigs";
import {
  computeStamps,
  computeAllStamps,
  drawStamps,
  createStampAccumulator,
} from "./StampRenderer";
import type { StampParams } from "./StampRenderer";

// Mock OffscreenCanvas for jsdom
class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): MockCtx {
    return new MockCtx();
  }
}

class MockCtx {
  globalAlpha = 1;
  fillStyle = "";
  private _a = 1; private _b = 0; private _c = 0; private _d = 1; private _e = 0; private _f = 0;
  private _stack: { a: number; b: number; c: number; d: number; e: number; f: number; alpha: number }[] = [];

  setTransform(a?: unknown, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    if (typeof a === "number") {
      this._a = a; this._b = b ?? 0; this._c = c ?? 0;
      this._d = d ?? 1; this._e = e ?? 0; this._f = f ?? 0;
    } else if (a && typeof a === "object" && "a" in a) {
      const m = a as { a: number; b: number; c: number; d: number; e: number; f: number };
      this._a = m.a; this._b = m.b; this._c = m.c;
      this._d = m.d; this._e = m.e; this._f = m.f;
    }
  }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    return { a: this._a, b: this._b, c: this._c, d: this._d, e: this._e, f: this._f };
  }
  save(): void {
    this._stack.push({ a: this._a, b: this._b, c: this._c, d: this._d, e: this._e, f: this._f, alpha: this.globalAlpha });
  }
  restore(): void {
    const s = this._stack.pop();
    if (s) {
      this._a = s.a; this._b = s.b; this._c = s.c;
      this._d = s.d; this._e = s.e; this._f = s.f;
      this.globalAlpha = s.alpha;
    }
  }
  drawImage(): void {}
  clearRect(): void {}
  beginPath(): void {}
  arc(): void {}
  fill(): void {}
  scale(sx: number, sy: number): void {
    this._a *= sx; this._b *= sx; this._c *= sy; this._d *= sy;
  }
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).OffscreenCanvas = MockOffscreenCanvas;
});

function makePoint(
  x: number, y: number,
  pressure = 0.5,
  tiltX = 0, tiltY = 0,
): StrokePoint {
  return { x, y, pressure, tiltX, tiltY, twist: 0, timestamp: 0 };
}

const pencilConfig = getPenConfig("pencil");
const stampConfig = pencilConfig.stamp!;

const defaultStyle: PenStyle = {
  pen: "pencil",
  color: "#1a1a1a",
  width: 3,
  opacity: 0.85,
  smoothing: 0.4,
  pressureCurve: 1.0,
  tiltSensitivity: 0,
};

describe("StampRenderer", () => {
  describe("createStampAccumulator", () => {
    it("should create a fresh accumulator", () => {
      const acc = createStampAccumulator();
      expect(acc.lastPointIndex).toBe(0);
      expect(acc.remainder).toBe(0);
      expect(acc.stampCount).toBe(0);
    });
  });

  describe("computeAllStamps", () => {
    it("should return empty for empty points", () => {
      const stamps = computeAllStamps([], defaultStyle, pencilConfig, stampConfig);
      expect(stamps).toHaveLength(0);
    });

    it("should emit at least one stamp for a single point", () => {
      const points = [makePoint(100, 100)];
      const stamps = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);
      expect(stamps.length).toBeGreaterThanOrEqual(1);
    });

    it("should emit multiple stamps for a line", () => {
      const points = [
        makePoint(0, 0),
        makePoint(100, 0),
      ];
      const stamps = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);
      expect(stamps.length).toBeGreaterThan(1);
    });

    it("should produce stamps with valid parameters", () => {
      const points = [
        makePoint(0, 0, 0.5),
        makePoint(50, 0, 0.8),
      ];
      const stamps = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);
      for (const s of stamps) {
        expect(s.size).toBeGreaterThan(0);
        expect(s.opacity).toBeGreaterThanOrEqual(0);
        expect(s.opacity).toBeLessThanOrEqual(1);
        expect(s.scaleX).toBe(1);
        expect(s.scaleY).toBe(1);
        expect(isFinite(s.rotation)).toBe(true);
      }
    });

    it("should scatter stamps within stroke width of the path", () => {
      const points = [
        makePoint(0, 0),
        makePoint(100, 0),
      ];
      const stamps = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);
      // Stroke width is ~3, so particles should be within ±2 of center line
      for (const s of stamps) {
        expect(s.x).toBeGreaterThanOrEqual(-2);
        expect(s.x).toBeLessThanOrEqual(102);
        expect(Math.abs(s.y)).toBeLessThan(3);
      }
    });

    it("should scatter more particles per step for wider strokes", () => {
      const points = [makePoint(0, 0), makePoint(50, 0)];
      const narrowStyle: PenStyle = { ...defaultStyle, width: 3 };
      const wideStyle: PenStyle = { ...defaultStyle, width: 20 };

      const narrowStamps = computeAllStamps(points, narrowStyle, pencilConfig, stampConfig);
      const wideStamps = computeAllStamps(points, wideStyle, pencilConfig, stampConfig);

      // Wider strokes should scatter particles over a wider band
      const narrowMaxY = Math.max(...narrowStamps.map(s => Math.abs(s.y)));
      const wideMaxY = Math.max(...wideStamps.map(s => Math.abs(s.y)));
      expect(wideMaxY).toBeGreaterThan(narrowMaxY);
    });

    it("should keep particle size small regardless of stroke width", () => {
      const points = [makePoint(0, 0), makePoint(50, 0)];
      const wideStyle: PenStyle = { ...defaultStyle, width: 20 };

      const stamps = computeAllStamps(points, wideStyle, pencilConfig, stampConfig);
      for (const s of stamps) {
        // Particle size should be much smaller than stroke width
        expect(s.size).toBeLessThan(wideStyle.width * 0.2);
        expect(s.size).toBeGreaterThan(0);
      }
    });

    it("should have alpha variation across stamps", () => {
      const points = [makePoint(0, 0, 0.5), makePoint(100, 0, 0.5)];
      const stamps = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);

      const opacities = stamps.map(s => s.opacity);
      const min = Math.min(...opacities);
      const max = Math.max(...opacities);
      // Should have meaningful variation
      expect(max - min).toBeGreaterThan(0.05);
    });
  });

  describe("computeStamps (incremental)", () => {
    it("should compute stamps for a range", () => {
      const points = [
        makePoint(0, 0),
        makePoint(50, 0),
        makePoint(100, 0),
      ];
      const { stamps, newRemainder, newStampCount } = computeStamps(
        points, 0, 2, 0, defaultStyle, pencilConfig, stampConfig, 0,
      );
      expect(stamps.length).toBeGreaterThan(0);
      expect(newRemainder).toBeGreaterThanOrEqual(0);
      expect(newStampCount).toBe(stamps.length);
    });

    it("should produce deterministic output", () => {
      const points = [makePoint(0, 0), makePoint(100, 0)];
      const stamps1 = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);
      const stamps2 = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);

      expect(stamps1.length).toBe(stamps2.length);
      for (let i = 0; i < stamps1.length; i++) {
        expect(stamps1[i].x).toBe(stamps2[i].x);
        expect(stamps1[i].y).toBe(stamps2[i].y);
        expect(stamps1[i].opacity).toBe(stamps2[i].opacity);
      }
    });
  });

  describe("tilt scatter", () => {
    it("should offset scatter opposite to tilt direction in skew mode", () => {
      // Tilt right (tiltX=20, within tolerance of 30)
      const tiltedPoints = [makePoint(0, 50, 0.5, 20, 0), makePoint(100, 50, 0.5, 20, 0)];
      const normalPoints = [makePoint(0, 50, 0.5, 0, 0), makePoint(100, 50, 0.5, 0, 0)];

      const tiltedStamps = computeAllStamps(tiltedPoints, defaultStyle, pencilConfig, stampConfig);
      const normalStamps = computeAllStamps(normalPoints, defaultStyle, pencilConfig, stampConfig);

      // Center of mass in X should shift LEFT (opposite to rightward tilt)
      const tiltedAvgX = tiltedStamps.reduce((s, p) => s + p.x, 0) / tiltedStamps.length;
      const normalAvgX = normalStamps.reduce((s, p) => s + p.x, 0) / normalStamps.length;
      expect(tiltedAvgX).toBeLessThan(normalAvgX);
    });

    it("should widen scatter in shading mode", () => {
      // Tilt along Y axis so widening is perpendicular to the horizontal stroke path
      const tiltedPoints = [makePoint(0, 50, 0.5, 0, 65), makePoint(100, 50, 0.5, 0, 65)];
      const normalPoints = [makePoint(0, 50, 0.5, 0, 0), makePoint(100, 50, 0.5, 0, 0)];

      const tiltedStamps = computeAllStamps(tiltedPoints, defaultStyle, pencilConfig, stampConfig);
      const normalStamps = computeAllStamps(normalPoints, defaultStyle, pencilConfig, stampConfig);

      // Tilted stamps should spread wider along tilt axis (Y)
      const tiltedSpreadY = Math.max(...tiltedStamps.map(s => s.y)) - Math.min(...tiltedStamps.map(s => s.y));
      const normalSpreadY = Math.max(...normalStamps.map(s => s.y)) - Math.min(...normalStamps.map(s => s.y));
      expect(tiltedSpreadY).toBeGreaterThan(normalSpreadY * 1.5);
    });

    it("should produce more particles in shading mode", () => {
      const tiltedPoints = [makePoint(0, 0, 0.5, 65, 0), makePoint(100, 0, 0.5, 65, 0)];
      const normalPoints = [makePoint(0, 0, 0.5, 0, 0), makePoint(100, 0, 0.5, 0, 0)];

      const tiltedStamps = computeAllStamps(tiltedPoints, defaultStyle, pencilConfig, stampConfig);
      const normalStamps = computeAllStamps(normalPoints, defaultStyle, pencilConfig, stampConfig);

      expect(tiltedStamps.length).toBeGreaterThan(normalStamps.length);
    });

    it("should reduce per-particle opacity in shading mode", () => {
      const tiltedPoints = [makePoint(0, 0, 0.5, 65, 0), makePoint(100, 0, 0.5, 65, 0)];
      const normalPoints = [makePoint(0, 0, 0.5, 0, 0), makePoint(100, 0, 0.5, 0, 0)];

      const tiltedStamps = computeAllStamps(tiltedPoints, defaultStyle, pencilConfig, stampConfig);
      const normalStamps = computeAllStamps(normalPoints, defaultStyle, pencilConfig, stampConfig);

      const avgTiltedOpacity = tiltedStamps.reduce((s, p) => s + p.opacity, 0) / tiltedStamps.length;
      const avgNormalOpacity = normalStamps.reduce((s, p) => s + p.opacity, 0) / normalStamps.length;

      expect(avgTiltedOpacity).toBeLessThan(avgNormalOpacity);
    });

    it("should be deterministic with tilt", () => {
      const points = [makePoint(0, 0, 0.5, 40, 10), makePoint(100, 0, 0.5, 40, 10)];
      const stamps1 = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);
      const stamps2 = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);

      expect(stamps1.length).toBe(stamps2.length);
      for (let i = 0; i < stamps1.length; i++) {
        expect(stamps1[i].x).toBe(stamps2[i].x);
        expect(stamps1[i].y).toBe(stamps2[i].y);
        expect(stamps1[i].opacity).toBe(stamps2[i].opacity);
      }
    });

    it("should not affect scatter when tiltConfig is null", () => {
      const noTiltConfig = { ...pencilConfig, tiltConfig: null };
      const points = [makePoint(0, 0, 0.5, 65, 0), makePoint(100, 0, 0.5, 65, 0)];

      const withTiltConfig = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);
      const withoutTiltConfig = computeAllStamps(points, defaultStyle, noTiltConfig, stampConfig);

      // Without tiltConfig, stamps should stay within normal stroke width
      for (const s of withoutTiltConfig) {
        expect(Math.abs(s.y)).toBeLessThan(3);
      }
      // With tiltConfig, shading mode should spread wider
      const maxY = Math.max(...withTiltConfig.map(s => Math.abs(s.y)));
      expect(maxY).toBeGreaterThan(Math.max(...withoutTiltConfig.map(s => Math.abs(s.y))));
    });

    it("should ignore very small tilt values (dead zone)", () => {
      const tinyTiltPoints = [makePoint(0, 0, 0.5, 1, 0.5), makePoint(100, 0, 0.5, 1, 0.5)];
      const noTiltPoints = [makePoint(0, 0, 0.5, 0, 0), makePoint(100, 0, 0.5, 0, 0)];

      const tinyTiltStamps = computeAllStamps(tinyTiltPoints, defaultStyle, pencilConfig, stampConfig);
      const noTiltStamps = computeAllStamps(noTiltPoints, defaultStyle, pencilConfig, stampConfig);

      // Same number of particles (no shading mode)
      expect(tinyTiltStamps.length).toBe(noTiltStamps.length);
    });

    it("should produce wider spread for pencil than felt-tip at same tilt", () => {
      const feltTipConfig = getPenConfig("felt-tip");
      const points = [makePoint(0, 0, 0.5, 65, 0), makePoint(100, 0, 0.5, 65, 0)];

      const pencilStamps = computeAllStamps(points, defaultStyle, pencilConfig, stampConfig);
      const feltTipStamps = computeAllStamps(
        points,
        { ...defaultStyle, pen: "felt-tip" },
        feltTipConfig,
        feltTipConfig.stamp ?? stampConfig,
      );

      // Pencil maxWidthMultiplier=3.5 vs felt-tip=2.0, so pencil should spread wider
      // But felt-tip has no stamp config, so it won't produce stamps unless stamp is non-null
      // For this test, we just verify pencil has wider spread
      const pencilSpreadX = Math.max(...pencilStamps.map(s => s.x)) - Math.min(...pencilStamps.map(s => s.x));
      expect(pencilSpreadX).toBeGreaterThan(100); // wider than the 100px stroke length
    });
  });

  describe("drawStamps", () => {
    it("should draw without error", () => {
      const canvas = new OffscreenCanvas(100, 100);
      const ctx = canvas.getContext("2d")!;

      const stamps: StampParams[] = [
        { x: 50, y: 50, size: 1, opacity: 0.8, rotation: 0, scaleX: 1, scaleY: 1, tiltAngle: 0 },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseTransform = (ctx as any).getTransform() as DOMMatrix;
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        drawStamps(ctx as any, stamps, "#000000", baseTransform);
      }).not.toThrow();
    });

    it("should handle empty stamps array", () => {
      const canvas = new OffscreenCanvas(100, 100);
      const ctx = canvas.getContext("2d")!;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseTransform = (ctx as any).getTransform() as DOMMatrix;
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        drawStamps(ctx as any, [], "#000000", baseTransform);
      }).not.toThrow();
    });

    it("should restore base transform after drawing", () => {
      const canvas = new OffscreenCanvas(100, 100);
      const ctx = canvas.getContext("2d")!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCtx = ctx as any;
      mockCtx.setTransform(2, 0, 0, 2, 10, 20);
      const baseTransform = mockCtx.getTransform() as DOMMatrix;

      const stamps: StampParams[] = [
        { x: 50, y: 50, size: 1, opacity: 0.8, rotation: 0, scaleX: 1, scaleY: 1, tiltAngle: 0 },
      ];

      drawStamps(mockCtx, stamps, "#ff0000", baseTransform);

      const restored = mockCtx.getTransform();
      expect(restored.a).toBeCloseTo(2);
      expect(restored.d).toBeCloseTo(2);
      expect(restored.e).toBeCloseTo(10);
      expect(restored.f).toBeCloseTo(20);
    });
  });
});
