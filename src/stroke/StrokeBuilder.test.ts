import type { StrokePoint } from "../types";
import { StrokeBuilder } from "./StrokeBuilder";
import { decodePoints } from "../document/PointEncoder";

function makePoint(overrides: Partial<StrokePoint> = {}): StrokePoint {
  return {
    x: 100,
    y: 200,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    timestamp: 1000,
    ...overrides,
  };
}

describe("StrokeBuilder", () => {
  describe("point accumulation", () => {
    it("should start empty", () => {
      const builder = new StrokeBuilder("_default", 0);
      expect(builder.pointCount).toBe(0);
      expect(builder.hasPoints).toBe(false);
    });

    it("should accumulate points", () => {
      const builder = new StrokeBuilder("_default", 0);
      builder.addPoint(makePoint({ timestamp: 0 }));
      builder.addPoint(makePoint({ x: 110, timestamp: 8 }));
      builder.addPoint(makePoint({ x: 120, timestamp: 16 }));

      expect(builder.pointCount).toBe(3);
      expect(builder.hasPoints).toBe(true);
    });

    it("should return smoothed points", () => {
      const builder = new StrokeBuilder("_default", 0, { smoothing: 0.5 });

      // Add some jittery points
      const smoothed1 = builder.addPoint(makePoint({ x: 100, y: 200, timestamp: 0 }));
      const smoothed2 = builder.addPoint(makePoint({ x: 105, y: 200, timestamp: 8 }));
      const smoothed3 = builder.addPoint(makePoint({ x: 95, y: 200, timestamp: 16 }));

      // First point should be unfiltered
      expect(smoothed1.x).toBeCloseTo(100, 0);

      // Subsequent points should be smoothed (exact values depend on filter params)
      expect(typeof smoothed2.x).toBe("number");
      expect(typeof smoothed3.x).toBe("number");
      expect(isFinite(smoothed2.x)).toBe(true);
      expect(isFinite(smoothed3.x)).toBe(true);
    });

    it("should provide access to accumulated points", () => {
      const builder = new StrokeBuilder("_default", 0);
      builder.addPoint(makePoint({ timestamp: 0 }));
      builder.addPoint(makePoint({ x: 110, timestamp: 8 }));

      const points = builder.getPoints();
      expect(points).toHaveLength(2);
      expect(points[0].x).toBeCloseTo(100, 0);
    });
  });

  describe("finalize", () => {
    it("should produce a valid Stroke object", () => {
      const builder = new StrokeBuilder("_default", 0);
      builder.addPoint(makePoint({ x: 100, y: 200, timestamp: 0 }));
      builder.addPoint(makePoint({ x: 150, y: 250, timestamp: 8 }));
      builder.addPoint(makePoint({ x: 200, y: 300, timestamp: 16 }));

      const stroke = builder.finalize();

      expect(stroke.id).toMatch(/^s[a-z0-9]{5}$/);
      expect(stroke.style).toBe("_default");
      expect(stroke.pointCount).toBe(3);
      expect(stroke.pts).toBeTruthy();
      expect(stroke.bbox).toHaveLength(4);

      // Bbox should encompass the smoothed points (which may not reach raw extremes)
      const [minX, minY, maxX, maxY] = stroke.bbox;
      expect(minX).toBeLessThan(maxX);
      expect(minY).toBeLessThan(maxY);
      // The bbox should at least partially overlap the raw input range
      expect(maxX).toBeGreaterThan(100);
      expect(maxY).toBeGreaterThan(200);
    });

    it("should produce decodable pts string", () => {
      const builder = new StrokeBuilder("_default", 0);
      builder.addPoint(makePoint({ x: 100, y: 200, timestamp: 0 }));
      builder.addPoint(makePoint({ x: 150, y: 250, timestamp: 8 }));

      const stroke = builder.finalize();
      const decoded = decodePoints(stroke.pts);

      expect(decoded).toHaveLength(2);
      expect(decoded[0].x).toBeCloseTo(100, 0);
      expect(decoded[0].y).toBeCloseTo(200, 0);
    });

    it("should include style overrides when provided", () => {
      const builder = new StrokeBuilder("_default", 0, {}, { width: 5.0 });
      builder.addPoint(makePoint({ timestamp: 0 }));

      const stroke = builder.finalize();
      expect(stroke.styleOverrides).toEqual({ width: 5.0 });
    });

    it("should not include styleOverrides when none provided", () => {
      const builder = new StrokeBuilder("_default", 0);
      builder.addPoint(makePoint({ timestamp: 0 }));

      const stroke = builder.finalize();
      expect(stroke.styleOverrides).toBeUndefined();
    });
  });

  describe("discard", () => {
    it("should clear all accumulated data", () => {
      const builder = new StrokeBuilder("_default", 0);
      builder.addPoint(makePoint({ timestamp: 0 }));
      builder.addPoint(makePoint({ x: 110, timestamp: 8 }));

      builder.discard();

      expect(builder.pointCount).toBe(0);
      expect(builder.hasPoints).toBe(false);
    });
  });
});
