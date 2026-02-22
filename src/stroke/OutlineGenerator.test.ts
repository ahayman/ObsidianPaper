// Polyfill Path2D for jsdom
if (typeof globalThis.Path2D === "undefined") {
  class Path2DPolyfill {
    private commands: string[] = [];
    moveTo(x: number, y: number): void {
      this.commands.push(`M${x},${y}`);
    }
    lineTo(x: number, y: number): void {
      this.commands.push(`L${x},${y}`);
    }
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
      this.commands.push(`Q${cpx},${cpy},${x},${y}`);
    }
    closePath(): void {
      this.commands.push("Z");
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Path2D = Path2DPolyfill;
}

import type { StrokePoint, PenStyle } from "../types";
import {
  penStyleToOutlineOptions,
  generateOutline,
  outlineToPath2D,
  generateStrokePath,
  StrokePathCache,
} from "./OutlineGenerator";

function makeStyle(overrides: Partial<PenStyle> = {}): PenStyle {
  return {
    pen: "ballpoint",
    color: "#1a1a1a",
    width: 2,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 1,
    tiltSensitivity: 0,
    ...overrides,
  };
}

function makePoints(count: number): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: 100 + i * 10,
      y: 200 + i * 5,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      timestamp: i * 8,
    });
  }
  return points;
}

describe("OutlineGenerator", () => {
  describe("penStyleToOutlineOptions", () => {
    it("should map ballpoint style correctly", () => {
      const options = penStyleToOutlineOptions(makeStyle({ pen: "ballpoint", width: 2 }));
      expect(options.size).toBe(2);
      expect(options.thinning).toBe(0.15);
      expect(options.simulatePressure).toBe(false);
    });

    it("should map highlighter style correctly", () => {
      const options = penStyleToOutlineOptions(makeStyle({ pen: "highlighter", width: 24 }));
      expect(options.size).toBe(24);
      expect(options.thinning).toBe(0);
    });

    it("should always set simulatePressure to false", () => {
      const penTypes = [
        "ballpoint",
        "felt-tip",
        "pencil",
        "fountain",
        "highlighter",
      ] as const;

      for (const pen of penTypes) {
        const options = penStyleToOutlineOptions(makeStyle({ pen }));
        expect(options.simulatePressure).toBe(false);
      }
    });
  });

  describe("generateOutline", () => {
    it("should return empty array for no points", () => {
      const outline = generateOutline([], makeStyle());
      expect(outline).toEqual([]);
    });

    it("should generate outline points for a stroke", () => {
      const points = makePoints(10);
      const outline = generateOutline(points, makeStyle());

      expect(outline.length).toBeGreaterThan(0);
      // Each outline point should be [x, y]
      for (const p of outline) {
        expect(p).toHaveLength(2);
        expect(isFinite(p[0])).toBe(true);
        expect(isFinite(p[1])).toBe(true);
      }
    });

    it("should generate larger outline for wider pen", () => {
      const points = makePoints(10);
      const narrowOutline = generateOutline(points, makeStyle({ width: 1 }));
      const wideOutline = generateOutline(points, makeStyle({ width: 10 }));

      // Wide pen should produce outline points further from the center
      // We can check by comparing the bounding area
      const narrowArea = outlineBoundingArea(narrowOutline);
      const wideArea = outlineBoundingArea(wideOutline);

      expect(wideArea).toBeGreaterThan(narrowArea);
    });
  });

  describe("outlineToPath2D", () => {
    it("should return null for insufficient points", () => {
      expect(outlineToPath2D([])).toBeNull();
      expect(outlineToPath2D([[0, 0]])).toBeNull();
    });

    it("should create a Path2D for valid outline", () => {
      const outline = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ];
      const path = outlineToPath2D(outline);
      expect(path).toBeInstanceOf(Path2D);
    });
  });

  describe("generateStrokePath", () => {
    it("should generate Path2D from points and style", () => {
      const points = makePoints(10);
      const path = generateStrokePath(points, makeStyle());
      expect(path).toBeInstanceOf(Path2D);
    });

    it("should return null for empty points", () => {
      const path = generateStrokePath([], makeStyle());
      expect(path).toBeNull();
    });
  });

  describe("StrokePathCache", () => {
    it("should store and retrieve paths", () => {
      const cache = new StrokePathCache();
      const path = new Path2D();

      cache.set("s1", path);
      expect(cache.has("s1")).toBe(true);
      expect(cache.get("s1")).toBe(path);
    });

    it("should delete paths", () => {
      const cache = new StrokePathCache();
      cache.set("s1", new Path2D());
      cache.delete("s1");
      expect(cache.has("s1")).toBe(false);
    });

    it("should clear all paths", () => {
      const cache = new StrokePathCache();
      cache.set("s1", new Path2D());
      cache.set("s2", new Path2D());
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it("should track size", () => {
      const cache = new StrokePathCache();
      expect(cache.size).toBe(0);
      cache.set("s1", new Path2D());
      expect(cache.size).toBe(1);
      cache.set("s2", new Path2D());
      expect(cache.size).toBe(2);
    });
  });
});

function outlineBoundingArea(outline: number[][]): number {
  if (outline.length === 0) return 0;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of outline) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return (maxX - minX) * (maxY - minY);
}
