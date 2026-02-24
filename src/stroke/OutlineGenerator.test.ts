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
  outlineToFloat32Array,
  generateStrokeVertices,
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

  describe("outlineToFloat32Array", () => {
    it("should return null for fewer than 2 points", () => {
      expect(outlineToFloat32Array([])).toBeNull();
      expect(outlineToFloat32Array([[0, 0]])).toBeNull();
    });

    it("should convert outline to Float32Array with Bézier subdivision", () => {
      const outline = [[10, 20], [30, 40], [50, 60]];
      const result = outlineToFloat32Array(outline);
      expect(result).toBeInstanceOf(Float32Array);
      // 3 points × 4 subdivisions × 2 (x,y) = 24 floats
      expect(result!.length).toBe(24);
      // First vertex should be midpoint(outline[0], outline[1]) = (20, 30)
      expect(result![0]).toBeCloseTo(20, 5);
      expect(result![1]).toBeCloseTo(30, 5);
      // All values should be finite
      for (let i = 0; i < result!.length; i++) {
        expect(isFinite(result![i])).toBe(true);
      }
    });

    it("should preserve floating point precision", () => {
      const outline = [[1.234, 5.678], [9.012, 3.456]];
      const result = outlineToFloat32Array(outline);
      expect(result).not.toBeNull();
      expect(result![0]).toBeCloseTo(1.234, 2);
      expect(result![1]).toBeCloseTo(5.678, 2);
    });
  });

  describe("generateStrokeVertices", () => {
    it("should return null for empty points", () => {
      const result = generateStrokeVertices([], makeStyle());
      expect(result).toBeNull();
    });

    it("should generate Float32Array from stroke points", () => {
      const points = makePoints(10);
      const result = generateStrokeVertices(points, makeStyle());
      expect(result).toBeInstanceOf(Float32Array);
      expect(result!.length).toBeGreaterThan(0);
      // All values should be finite
      for (let i = 0; i < result!.length; i++) {
        expect(isFinite(result![i])).toBe(true);
      }
    });

    it("should produce same vertex data as outline → float32 pipeline", () => {
      const points = makePoints(10);
      const style = makeStyle();
      const outline = generateOutline(points, style);
      const fromOutline = outlineToFloat32Array(outline);
      const direct = generateStrokeVertices(points, style);
      expect(direct).toEqual(fromOutline);
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

    describe("dual cache (outline → Path2D / Float32Array)", () => {
      it("setOutline stores outline and allows getPath/getVertices", () => {
        const cache = new StrokePathCache();
        const outline = [[0, 0], [10, 0], [10, 10], [0, 10]];
        cache.setOutline("s1", outline);
        expect(cache.has("s1")).toBe(true);

        const path = cache.getPath("s1");
        expect(path).toBeInstanceOf(Path2D);

        const verts = cache.getVertices("s1");
        expect(verts).toBeInstanceOf(Float32Array);
        // 4 points × 4 subdivisions × 2 (x,y) = 32 floats
        expect(verts!.length).toBe(32);
      });

      it("getPath returns undefined for unknown key", () => {
        const cache = new StrokePathCache();
        expect(cache.getPath("nope")).toBeUndefined();
      });

      it("getVertices returns undefined for unknown key", () => {
        const cache = new StrokePathCache();
        expect(cache.getVertices("nope")).toBeUndefined();
      });

      it("setOutline invalidates previously cached path and vertices", () => {
        const cache = new StrokePathCache();
        const outline1 = [[0, 0], [10, 0], [10, 10]];
        cache.setOutline("s1", outline1);
        const v1 = cache.getVertices("s1");

        // Replace outline
        const outline2 = [[0, 0], [20, 0], [20, 20], [0, 20]];
        cache.setOutline("s1", outline2);
        const v2 = cache.getVertices("s1");
        expect(v2!.length).toBe(32); // 4 points × 4 subdivisions × 2
        expect(v1!.length).toBe(24); // 3 points × 4 subdivisions × 2
      });

      it("delete removes outline, path, and vertices", () => {
        const cache = new StrokePathCache();
        cache.setOutline("s1", [[0, 0], [10, 0], [10, 10]]);
        cache.getPath("s1");
        cache.getVertices("s1");
        cache.delete("s1");
        expect(cache.has("s1")).toBe(false);
        expect(cache.getPath("s1")).toBeUndefined();
        expect(cache.getVertices("s1")).toBeUndefined();
      });

      it("clear removes everything", () => {
        const cache = new StrokePathCache();
        cache.setOutline("s1", [[0, 0], [10, 0], [10, 10]]);
        cache.set("s2", new Path2D());
        cache.clear();
        expect(cache.size).toBe(0);
      });

      it("size counts unique keys across all caches", () => {
        const cache = new StrokePathCache();
        cache.set("s1", new Path2D());
        cache.setOutline("s2", [[0, 0], [10, 0], [10, 10]]);
        expect(cache.size).toBe(2);
        // Setting outline for s1 should not change count
        cache.setOutline("s1", [[0, 0], [10, 0], [10, 10]]);
        expect(cache.size).toBe(2);
      });

      it("get() still works for paths set via set()", () => {
        const cache = new StrokePathCache();
        const path = new Path2D();
        cache.set("s1", path);
        expect(cache.get("s1")).toBe(path);
        // getPath should also work for directly-set paths
        expect(cache.getPath("s1")).toBe(path);
      });
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
