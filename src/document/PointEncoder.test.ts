import type { StrokePoint } from "../types";
import { encodePoints, decodePoints, computeBBox } from "./PointEncoder";

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

describe("PointEncoder", () => {
  describe("encodePoints / decodePoints round-trip", () => {
    it("should handle empty array", () => {
      const encoded = encodePoints([]);
      expect(encoded).toBe("");
      const decoded = decodePoints(encoded);
      expect(decoded).toEqual([]);
    });

    it("should round-trip a single point", () => {
      const points = [makePoint()];
      const encoded = encodePoints(points);
      const decoded = decodePoints(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0].x).toBeCloseTo(100, 1);
      expect(decoded[0].y).toBeCloseTo(200, 1);
      expect(decoded[0].pressure).toBeCloseTo(0.5, 1);
    });

    it("should round-trip multiple points with varying values", () => {
      const points: StrokePoint[] = [
        makePoint({ x: 100, y: 200, pressure: 0.3, tiltX: -45, tiltY: 30 }),
        makePoint({ x: 118, y: 225, pressure: 0.6, tiltX: -40, tiltY: 28 }),
        makePoint({ x: 113, y: 255, pressure: 0.8, tiltX: -42, tiltY: 29 }),
      ];
      const encoded = encodePoints(points);
      const decoded = decodePoints(encoded);

      expect(decoded).toHaveLength(3);

      for (let i = 0; i < points.length; i++) {
        expect(decoded[i].x).toBeCloseTo(points[i].x, 1);
        expect(decoded[i].y).toBeCloseTo(points[i].y, 1);
        // Pressure is quantized to 0-255, so tolerance is wider
        expect(decoded[i].pressure).toBeCloseTo(points[i].pressure, 1);
      }
    });

    it("should preserve coordinate precision to 0.1px", () => {
      const points = [makePoint({ x: 123.4, y: 567.8 })];
      const encoded = encodePoints(points);
      const decoded = decodePoints(encoded);

      expect(decoded[0].x).toBeCloseTo(123.4, 1);
      expect(decoded[0].y).toBeCloseTo(567.8, 1);
    });

    it("should handle points with twist (barrel rotation)", () => {
      const points = [
        makePoint({ twist: 0 }),
        makePoint({ twist: 180 }),
        makePoint({ twist: 359 }),
      ];
      const encoded = encodePoints(points);
      const decoded = decodePoints(encoded);

      expect(decoded[0].twist).toBe(0);
      expect(decoded[1].twist).toBe(180);
      expect(decoded[2].twist).toBe(359);
    });

    it("should produce delta encoding (second point values are relative)", () => {
      const points = [
        makePoint({ x: 100, y: 200, timestamp: 1000 }),
        makePoint({ x: 110, y: 210, timestamp: 1016 }),
      ];
      const encoded = encodePoints(points);
      const segments = encoded.split(";");

      expect(segments).toHaveLength(2);

      // Second segment should contain deltas, not absolute values
      const secondValues = segments[1].split(",").map(Number);
      // x delta: (110*10) - (100*10) = 100
      expect(secondValues[0]).toBe(100);
      // y delta: (210*10) - (200*10) = 100
      expect(secondValues[1]).toBe(100);
    });
  });

  describe("computeBBox", () => {
    it("should return zero bbox for empty array", () => {
      expect(computeBBox([])).toEqual([0, 0, 0, 0]);
    });

    it("should compute bbox for single point", () => {
      const bbox = computeBBox([makePoint({ x: 50, y: 75 })]);
      expect(bbox).toEqual([50, 75, 50, 75]);
    });

    it("should compute bbox for multiple points", () => {
      const points = [
        makePoint({ x: 10, y: 20 }),
        makePoint({ x: 50, y: 10 }),
        makePoint({ x: 30, y: 60 }),
      ];
      const bbox = computeBBox(points);
      expect(bbox).toEqual([10, 10, 50, 60]);
    });
  });
});
