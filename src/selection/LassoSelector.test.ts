import { selectStrokesInLasso } from "./LassoSelector";
import { SpatialIndex } from "../spatial/SpatialIndex";
import { encodePoints } from "../document/PointEncoder";
import type { Stroke, StrokePoint } from "../types";
import type { Point2D } from "./PointInPolygon";

function makePoint(x: number, y: number): StrokePoint {
  return { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, timestamp: 0 };
}

function makeStroke(
  id: string,
  points: StrokePoint[],
  pageIndex = 0
): Stroke {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    id,
    pageIndex,
    style: "_default",
    bbox: [minX, minY, maxX, maxY],
    pointCount: points.length,
    pts: encodePoints(points),
  };
}

describe("selectStrokesInLasso", () => {
  let index: SpatialIndex;

  beforeEach(() => {
    index = new SpatialIndex();
  });

  it("should select a stroke fully inside the lasso", () => {
    // Stroke at (5,5) → (6,6) → (7,7)
    const stroke = makeStroke("s1", [
      makePoint(5, 5),
      makePoint(6, 6),
      makePoint(7, 7),
    ]);

    const strokes = [stroke];
    index.buildFromStrokes(strokes);

    // Large lasso surrounding the stroke
    const lasso: Point2D[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];

    const result = selectStrokesInLasso(lasso, strokes, index);
    expect(result).toEqual(["s1"]);
  });

  it("should not select a stroke fully outside the lasso", () => {
    const stroke = makeStroke("s1", [
      makePoint(50, 50),
      makePoint(51, 51),
      makePoint(52, 52),
    ]);

    const strokes = [stroke];
    index.buildFromStrokes(strokes);

    const lasso: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    const result = selectStrokesInLasso(lasso, strokes, index);
    expect(result).toEqual([]);
  });

  it("should select a stroke when enough points are inside (above threshold)", () => {
    // 10 points: 8 inside, 2 outside → 80% ≥ 75% threshold
    const points: StrokePoint[] = [];
    for (let i = 0; i < 8; i++) {
      points.push(makePoint(5, 1 + i)); // inside [0,0]-[10,10]
    }
    points.push(makePoint(15, 5)); // outside
    points.push(makePoint(15, 6)); // outside

    const stroke = makeStroke("s1", points);
    const strokes = [stroke];
    index.buildFromStrokes(strokes);

    const lasso: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    const result = selectStrokesInLasso(lasso, strokes, index, 0.75);
    expect(result).toEqual(["s1"]);
  });

  it("should not select a stroke when too few points are inside (below threshold)", () => {
    // 10 points: 5 inside, 5 outside → 50% < 75% threshold
    const points: StrokePoint[] = [];
    for (let i = 0; i < 5; i++) {
      points.push(makePoint(5, 1 + i)); // inside
    }
    for (let i = 0; i < 5; i++) {
      points.push(makePoint(15, 1 + i)); // outside
    }

    const stroke = makeStroke("s1", points);
    const strokes = [stroke];
    index.buildFromStrokes(strokes);

    const lasso: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    const result = selectStrokesInLasso(lasso, strokes, index, 0.75);
    expect(result).toEqual([]);
  });

  it("should select multiple strokes", () => {
    const s1 = makeStroke("s1", [makePoint(2, 2), makePoint(3, 3)]);
    const s2 = makeStroke("s2", [makePoint(7, 7), makePoint(8, 8)]);
    const s3 = makeStroke("s3", [makePoint(50, 50), makePoint(51, 51)]);

    const strokes = [s1, s2, s3];
    index.buildFromStrokes(strokes);

    const lasso: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    const result = selectStrokesInLasso(lasso, strokes, index);
    expect(result).toContain("s1");
    expect(result).toContain("s2");
    expect(result).not.toContain("s3");
  });

  it("should filter by page index", () => {
    const s1 = makeStroke("s1", [makePoint(5, 5), makePoint(6, 6)], 0);
    const s2 = makeStroke("s2", [makePoint(5, 5), makePoint(6, 6)], 1);

    const strokes = [s1, s2];
    index.buildFromStrokes(strokes);

    const lasso: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    const result = selectStrokesInLasso(lasso, strokes, index, 0.75, 0);
    expect(result).toEqual(["s1"]);
  });

  it("should return empty for a lasso with fewer than 3 points", () => {
    const stroke = makeStroke("s1", [makePoint(5, 5), makePoint(6, 6)]);
    const strokes = [stroke];
    index.buildFromStrokes(strokes);

    expect(selectStrokesInLasso([], strokes, index)).toEqual([]);
    expect(selectStrokesInLasso([{ x: 0, y: 0 }], strokes, index)).toEqual([]);
    expect(selectStrokesInLasso([{ x: 0, y: 0 }, { x: 1, y: 1 }], strokes, index)).toEqual([]);
  });

  it("should handle empty strokes array", () => {
    index.buildFromStrokes([]);

    const lasso: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    expect(selectStrokesInLasso(lasso, [], index)).toEqual([]);
  });

  it("should respect a custom threshold", () => {
    // 4 points: 2 inside, 2 outside → 50%
    const points = [
      makePoint(5, 5),   // inside
      makePoint(5, 6),   // inside
      makePoint(15, 5),  // outside
      makePoint(15, 6),  // outside
    ];

    const stroke = makeStroke("s1", points);
    const strokes = [stroke];
    index.buildFromStrokes(strokes);

    const lasso: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    // 50% threshold → should select
    expect(selectStrokesInLasso(lasso, strokes, index, 0.5)).toEqual(["s1"]);
    // 75% threshold → should not select
    expect(selectStrokesInLasso(lasso, strokes, index, 0.75)).toEqual([]);
  });
});
