import { findNearestStroke } from "./StrokeHitTester";
import { SpatialIndex } from "../spatial/SpatialIndex";
import { encodePoints } from "../document/PointEncoder";
import type { Stroke, StrokePoint } from "../types";

function makePoint(x: number, y: number): StrokePoint {
  return { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, timestamp: 0 };
}

function makeStroke(id: string, points: StrokePoint[], pageIndex = 0): Stroke {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    id,
    pageIndex,
    style: "_default",
    bbox: [Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) + 5, Math.max(...ys) + 5],
    pointCount: points.length,
    pts: encodePoints(points),
  };
}

describe("findNearestStroke", () => {
  let index: SpatialIndex;

  beforeEach(() => {
    index = new SpatialIndex();
  });

  it("should find the nearest stroke", () => {
    const s1 = makeStroke("s1", [makePoint(10, 10), makePoint(20, 10)]);
    const s2 = makeStroke("s2", [makePoint(50, 50), makePoint(60, 50)]);
    const strokes = [s1, s2];
    index.buildFromStrokes(strokes);

    expect(findNearestStroke(12, 11, 20, strokes, index)).toBe("s1");
    expect(findNearestStroke(55, 51, 20, strokes, index)).toBe("s2");
  });

  it("should return null when no stroke is within radius", () => {
    const s1 = makeStroke("s1", [makePoint(100, 100), makePoint(110, 100)]);
    const strokes = [s1];
    index.buildFromStrokes(strokes);

    expect(findNearestStroke(0, 0, 10, strokes, index)).toBeNull();
  });

  it("should prefer the closer stroke when multiple are in range", () => {
    const s1 = makeStroke("s1", [makePoint(10, 10), makePoint(20, 10)]);
    const s2 = makeStroke("s2", [makePoint(10, 15), makePoint(20, 15)]);
    const strokes = [s1, s2];
    index.buildFromStrokes(strokes);

    // Point at (15, 11) — closer to s1 (y=10) than s2 (y=15)
    expect(findNearestStroke(15, 11, 20, strokes, index)).toBe("s1");
    // Point at (15, 14) — closer to s2
    expect(findNearestStroke(15, 14, 20, strokes, index)).toBe("s2");
  });

  it("should filter by page index", () => {
    const s1 = makeStroke("s1", [makePoint(10, 10), makePoint(20, 10)], 0);
    const s2 = makeStroke("s2", [makePoint(10, 10), makePoint(20, 10)], 1);
    const strokes = [s1, s2];
    index.buildFromStrokes(strokes);

    expect(findNearestStroke(15, 10, 20, strokes, index, 0)).toBe("s1");
    expect(findNearestStroke(15, 10, 20, strokes, index, 1)).toBe("s2");
  });

  it("should handle single-point strokes", () => {
    const s1 = makeStroke("s1", [makePoint(10, 10)]);
    const strokes = [s1];
    index.buildFromStrokes(strokes);

    expect(findNearestStroke(12, 12, 20, strokes, index)).toBe("s1");
  });
});
