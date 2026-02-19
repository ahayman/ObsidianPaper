import type { Stroke } from "../types";
import { findHitStrokes, pointToSegmentDistanceSq } from "./StrokeEraser";
import { encodePoints } from "../document/PointEncoder";
import type { StrokePoint } from "../types";

function makeStrokePoint(x: number, y: number): StrokePoint {
  return { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, timestamp: 0 };
}

function makeStroke(
  id: string,
  points: StrokePoint[],
  bbox?: [number, number, number, number]
): Stroke {
  const computedBbox = bbox ?? computeBBox(points);
  return {
    id,
    pageIndex: 0,
    style: "_default",
    bbox: computedBbox,
    pointCount: points.length,
    pts: encodePoints(points),
  };
}

function computeBBox(points: StrokePoint[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX, minY, maxX, maxY];
}

describe("StrokeEraser", () => {
  describe("pointToSegmentDistanceSq", () => {
    it("should return 0 for point on segment", () => {
      expect(pointToSegmentDistanceSq(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
    });

    it("should return distance to nearest endpoint for perpendicular projection outside segment", () => {
      // Point is at (15, 0), segment is (0,0)→(10,0). Nearest = (10,0), dist = 5
      expect(pointToSegmentDistanceSq(15, 0, 0, 0, 10, 0)).toBeCloseTo(25);
    });

    it("should return perpendicular distance for projection inside segment", () => {
      // Point is at (5, 3), segment is (0,0)→(10,0). Perpendicular dist = 3
      expect(pointToSegmentDistanceSq(5, 3, 0, 0, 10, 0)).toBeCloseTo(9);
    });

    it("should handle degenerate segment (zero length)", () => {
      // Point at (3, 4), segment at (0, 0)→(0, 0). Dist = 5
      expect(pointToSegmentDistanceSq(3, 4, 0, 0, 0, 0)).toBeCloseTo(25);
    });
  });

  describe("findHitStrokes", () => {
    it("should return empty for no strokes", () => {
      expect(findHitStrokes(100, 100, 5, [])).toEqual([]);
    });

    it("should hit a stroke when eraser is on it", () => {
      const stroke = makeStroke("s1", [
        makeStrokePoint(100, 100),
        makeStrokePoint(200, 100),
      ]);

      const hits = findHitStrokes(150, 100, 5, [stroke]);
      expect(hits).toEqual([0]);
    });

    it("should miss a stroke when eraser is far away", () => {
      const stroke = makeStroke("s1", [
        makeStrokePoint(100, 100),
        makeStrokePoint(200, 100),
      ]);

      const hits = findHitStrokes(150, 200, 5, [stroke]);
      expect(hits).toEqual([]);
    });

    it("should hit stroke within eraser radius", () => {
      const stroke = makeStroke("s1", [
        makeStrokePoint(100, 100),
        makeStrokePoint(200, 100),
      ]);

      // Eraser at 150,103 with radius 5 — distance to segment is 3 < 5
      const hits = findHitStrokes(150, 103, 5, [stroke]);
      expect(hits).toEqual([0]);
    });

    it("should reject via bbox quick reject", () => {
      const stroke = makeStroke("s1", [
        makeStrokePoint(100, 100),
        makeStrokePoint(200, 100),
      ]);

      // Eraser very far away — bbox reject should skip detailed test
      const hits = findHitStrokes(500, 500, 5, [stroke]);
      expect(hits).toEqual([]);
    });

    it("should hit multiple strokes", () => {
      const strokes = [
        makeStroke("s1", [
          makeStrokePoint(100, 100),
          makeStrokePoint(200, 100),
        ]),
        makeStroke("s2", [
          makeStrokePoint(100, 100),
          makeStrokePoint(100, 200),
        ]),
        makeStroke("s3", [
          makeStrokePoint(300, 300),
          makeStrokePoint(400, 300),
        ]),
      ];

      // Point near the intersection of s1 and s2
      const hits = findHitStrokes(100, 100, 5, strokes);
      expect(hits).toContain(0);
      expect(hits).toContain(1);
      expect(hits).not.toContain(2);
    });

    it("should handle single-point strokes", () => {
      const stroke = makeStroke("s1", [makeStrokePoint(100, 100)]);

      const hit = findHitStrokes(102, 100, 5, [stroke]);
      expect(hit).toEqual([0]);

      const miss = findHitStrokes(110, 100, 5, [stroke]);
      expect(miss).toEqual([]);
    });
  });
});
