import {
  selectLodLevel,
  lodCacheKey,
  simplifyPoints,
} from "./StrokeSimplifier";
import type { StrokePoint } from "../types";

function makePoint(x: number, y: number): StrokePoint {
  return { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, timestamp: 0 };
}

describe("StrokeSimplifier", () => {
  describe("selectLodLevel", () => {
    it("should return 0 for zoom >= 0.5", () => {
      expect(selectLodLevel(1)).toBe(0);
      expect(selectLodLevel(0.5)).toBe(0);
      expect(selectLodLevel(2)).toBe(0);
    });

    it("should return 1 for zoom 0.25-0.5", () => {
      expect(selectLodLevel(0.49)).toBe(1);
      expect(selectLodLevel(0.3)).toBe(1);
      expect(selectLodLevel(0.25)).toBe(1);
    });

    it("should return 2 for zoom 0.1-0.25", () => {
      expect(selectLodLevel(0.24)).toBe(2);
      expect(selectLodLevel(0.15)).toBe(2);
      expect(selectLodLevel(0.1)).toBe(2);
    });

    it("should return 3 for zoom < 0.1", () => {
      expect(selectLodLevel(0.09)).toBe(3);
      expect(selectLodLevel(0.01)).toBe(3);
      expect(selectLodLevel(0.001)).toBe(3);
    });
  });

  describe("lodCacheKey", () => {
    it("should return stroke ID for LOD 0", () => {
      expect(lodCacheKey("stroke-1", 0)).toBe("stroke-1");
    });

    it("should append LOD suffix for levels > 0", () => {
      expect(lodCacheKey("stroke-1", 1)).toBe("stroke-1-lod1");
      expect(lodCacheKey("stroke-1", 2)).toBe("stroke-1-lod2");
      expect(lodCacheKey("stroke-1", 3)).toBe("stroke-1-lod3");
    });
  });

  describe("simplifyPoints", () => {
    it("should return all points at LOD 0", () => {
      const points = [
        makePoint(0, 0),
        makePoint(1, 1),
        makePoint(2, 0),
        makePoint(3, 1),
      ];
      const result = simplifyPoints(points, 0);
      expect(result).toHaveLength(4);
    });

    it("should return first and last points at LOD 3", () => {
      const points = [
        makePoint(0, 0),
        makePoint(5, 5),
        makePoint(10, 3),
        makePoint(15, 0),
      ];
      const result = simplifyPoints(points, 3);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(points[0]);
      expect(result[1]).toEqual(points[3]);
    });

    it("should handle 2 or fewer points at any LOD", () => {
      const two = [makePoint(0, 0), makePoint(10, 10)];
      expect(simplifyPoints(two, 1)).toHaveLength(2);
      expect(simplifyPoints(two, 2)).toHaveLength(2);

      const one = [makePoint(5, 5)];
      expect(simplifyPoints(one, 2)).toHaveLength(1);

      expect(simplifyPoints([], 1)).toHaveLength(0);
    });

    it("should simplify a straight line to two points", () => {
      // Points along a straight line should simplify to just endpoints
      const points = [
        makePoint(0, 0),
        makePoint(2, 2),
        makePoint(4, 4),
        makePoint(6, 6),
        makePoint(8, 8),
        makePoint(10, 10),
      ];
      const result = simplifyPoints(points, 1);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(points[0]);
      expect(result[1]).toEqual(points[5]);
    });

    it("should preserve sharp corners", () => {
      // V-shape: deviates significantly from start-to-end line
      const points = [
        makePoint(0, 0),
        makePoint(50, 100), // Sharp deviation
        makePoint(100, 0),
      ];
      const result = simplifyPoints(points, 1);
      expect(result).toHaveLength(3);
    });

    it("should reduce points for LOD 1 on a complex curve", () => {
      // Generate a sine-like curve with many points
      const points: StrokePoint[] = [];
      for (let i = 0; i <= 100; i++) {
        points.push(makePoint(i, Math.sin(i * 0.1) * 10));
      }
      const lod1 = simplifyPoints(points, 1);
      expect(lod1.length).toBeLessThan(points.length);
      expect(lod1.length).toBeGreaterThan(2);
    });

    it("should reduce more aggressively at LOD 2 than LOD 1", () => {
      const points: StrokePoint[] = [];
      for (let i = 0; i <= 100; i++) {
        points.push(makePoint(i, Math.sin(i * 0.1) * 10));
      }
      const lod1 = simplifyPoints(points, 1);
      const lod2 = simplifyPoints(points, 2);
      expect(lod2.length).toBeLessThanOrEqual(lod1.length);
    });

    it("should always include first and last points", () => {
      const points = [
        makePoint(0, 0),
        makePoint(5, 3),
        makePoint(10, 1),
        makePoint(15, 4),
        makePoint(20, 0),
      ];
      for (const lod of [1, 2, 3] as const) {
        const result = simplifyPoints(points, lod);
        expect(result[0]).toEqual(points[0]);
        expect(result[result.length - 1]).toEqual(points[points.length - 1]);
      }
    });
  });
});
