import { cloneStroke, translateStroke, scaleStroke } from "./SelectionTransform";
import { encodePoints, decodePoints } from "../document/PointEncoder";
import type { Stroke, StrokePoint } from "../types";

function makePoint(x: number, y: number): StrokePoint {
  return { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, timestamp: 0 };
}

function makeStroke(points: StrokePoint[], overrides?: Partial<Stroke>): Stroke {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    id: "test",
    pageIndex: 0,
    style: "_default",
    bbox: [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2],
    pointCount: points.length,
    pts: encodePoints(points),
    grainAnchor: [points[0].x, points[0].y],
    ...overrides,
  };
}

describe("cloneStroke", () => {
  it("should create a deep copy", () => {
    const original = makeStroke([makePoint(10, 20), makePoint(30, 40)]);
    const clone = cloneStroke(original);

    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.bbox).not.toBe(original.bbox);
  });

  it("should clone styleOverrides independently", () => {
    const original = makeStroke(
      [makePoint(10, 20)],
      { styleOverrides: { width: 5, color: "#ff0000" } }
    );
    const clone = cloneStroke(original);

    clone.styleOverrides!.width = 10;
    expect(original.styleOverrides!.width).toBe(5);
  });
});

describe("translateStroke", () => {
  it("should translate all points by the given delta", () => {
    const stroke = makeStroke([makePoint(10, 20), makePoint(30, 40)]);
    const result = translateStroke(stroke, 5, -3);

    const points = decodePoints(result.pts);
    expect(points[0].x).toBeCloseTo(15, 0);
    expect(points[0].y).toBeCloseTo(17, 0);
    expect(points[1].x).toBeCloseTo(35, 0);
    expect(points[1].y).toBeCloseTo(37, 0);
  });

  it("should translate the bounding box", () => {
    const stroke = makeStroke([makePoint(10, 20), makePoint(30, 40)]);
    const result = translateStroke(stroke, 100, 200);

    expect(result.bbox[0]).toBe(stroke.bbox[0] + 100);
    expect(result.bbox[1]).toBe(stroke.bbox[1] + 200);
    expect(result.bbox[2]).toBe(stroke.bbox[2] + 100);
    expect(result.bbox[3]).toBe(stroke.bbox[3] + 200);
  });

  it("should translate the grainAnchor", () => {
    const stroke = makeStroke([makePoint(10, 20), makePoint(30, 40)]);
    const result = translateStroke(stroke, 5, 10);

    expect(result.grainAnchor).toEqual([15, 30]);
  });

  it("should not modify the original stroke", () => {
    const stroke = makeStroke([makePoint(10, 20), makePoint(30, 40)]);
    const originalPts = stroke.pts;
    const originalBBox = [...stroke.bbox];

    translateStroke(stroke, 100, 200);

    expect(stroke.pts).toBe(originalPts);
    expect(stroke.bbox).toEqual(originalBBox);
  });
});

describe("scaleStroke", () => {
  it("should scale points around anchor", () => {
    const stroke = makeStroke([makePoint(10, 10), makePoint(20, 20)]);
    const result = scaleStroke(stroke, 0, 0, 2);

    const points = decodePoints(result.pts);
    expect(points[0].x).toBeCloseTo(20, 0);
    expect(points[0].y).toBeCloseTo(20, 0);
    expect(points[1].x).toBeCloseTo(40, 0);
    expect(points[1].y).toBeCloseTo(40, 0);
  });

  it("should scale bbox around anchor", () => {
    const stroke = makeStroke([makePoint(10, 10), makePoint(20, 20)]);
    const result = scaleStroke(stroke, 0, 0, 2);

    expect(result.bbox[0]).toBeCloseTo((10 - 2) * 2, 0); // minX scaled
    expect(result.bbox[2]).toBeCloseTo((20 + 2) * 2, 0); // maxX scaled
  });

  it("should scale stroke width when scaleWidth is true", () => {
    const stroke = makeStroke(
      [makePoint(10, 10), makePoint(20, 20)],
      { styleOverrides: { width: 3 } }
    );
    const result = scaleStroke(stroke, 0, 0, 2, true);

    expect(result.styleOverrides?.width).toBe(6);
  });

  it("should not scale stroke width when scaleWidth is false", () => {
    const stroke = makeStroke(
      [makePoint(10, 10), makePoint(20, 20)],
      { styleOverrides: { width: 3 } }
    );
    const result = scaleStroke(stroke, 0, 0, 2, false);

    // Width should not be present in overrides (or unchanged)
    expect(result.styleOverrides?.width).toBe(3);
  });

  it("should handle scale from non-origin anchor", () => {
    const stroke = makeStroke([makePoint(10, 10), makePoint(20, 10)]);
    // Scale 2x from anchor (10, 10) — first point stays, second moves to (30, 10)
    const result = scaleStroke(stroke, 10, 10, 2);

    const points = decodePoints(result.pts);
    expect(points[0].x).toBeCloseTo(10, 0);
    expect(points[0].y).toBeCloseTo(10, 0);
    expect(points[1].x).toBeCloseTo(30, 0);
    expect(points[1].y).toBeCloseTo(10, 0);
  });

  it("should handle scale down (shrink)", () => {
    const stroke = makeStroke([makePoint(0, 0), makePoint(100, 100)]);
    const result = scaleStroke(stroke, 0, 0, 0.5);

    const points = decodePoints(result.pts);
    expect(points[0].x).toBeCloseTo(0, 0);
    expect(points[1].x).toBeCloseTo(50, 0);
    expect(points[1].y).toBeCloseTo(50, 0);
  });
});

describe("serialization round-trip after transform", () => {
  const { serializeDocument, deserializeDocument, precompressStroke, clearCompressedCache } = require("../document/Serializer");

  function makeDoc(strokes: Stroke[]) {
    return {
      version: 3,
      meta: { created: 0, modified: 0, appVersion: "1.0" },
      pages: [{ id: "p1", size: { width: 612, height: 792 }, orientation: "portrait" as const, paperType: "blank" as const, lineSpacing: 24, gridSize: 24, margins: { top: 0, bottom: 0, left: 0, right: 0 } }],
      layoutDirection: "vertical" as const,
      viewport: { x: 0, y: 0, zoom: 1 },
      channels: ["x", "y", "p", "tx", "ty", "tw", "t"],
      styles: { _default: { pen: "ballpoint" as const, color: "#000", width: 2, opacity: 1, smoothing: 0.5, pressureCurve: 1, tiltSensitivity: 0 } },
      strokes,
    };
  }

  it("should preserve scaled points through serialize/deserialize", () => {
    const points = [makePoint(200, 100), makePoint(250, 150), makePoint(300, 100)];
    const stroke = makeStroke(points, { id: "s1" });
    const doc = makeDoc([stroke]);

    const scaled = scaleStroke(stroke, 0, 0, 0.5, true);
    Object.assign(stroke, scaled);

    const json = serializeDocument(doc);
    const restored = deserializeDocument(json);

    const restoredPoints = decodePoints(restored.strokes[0].pts);
    expect(restoredPoints[0].x).toBeCloseTo(100, 0);
    expect(restoredPoints[0].y).toBeCloseTo(50, 0);
    expect(restoredPoints[2].x).toBeCloseTo(150, 0);
  });

  it("should preserve translated points through serialize/deserialize", () => {
    const points = [makePoint(10, 20), makePoint(30, 40)];
    const stroke = makeStroke(points, { id: "s1" });
    const doc = makeDoc([stroke]);

    const moved = translateStroke(stroke, 100, 200);
    Object.assign(stroke, moved);

    const json = serializeDocument(doc);
    const restored = deserializeDocument(json);

    const restoredPoints = decodePoints(restored.strokes[0].pts);
    expect(restoredPoints[0].x).toBeCloseTo(110, 0);
    expect(restoredPoints[0].y).toBeCloseTo(220, 0);
  });

  it("regression: clearCompressedCache must be called after in-place mutation", () => {
    // This test verifies the fix for the stale compressed cache bug.
    // Without clearCompressedCache, the serializer would write old compressed pts.
    const points = [makePoint(200, 100), makePoint(300, 200)];
    const stroke = makeStroke(points, { id: "s1" });

    // Precompress (happens on app load)
    precompressStroke(stroke);

    // Mutate in-place (like commitSelectionDrag does)
    const scaled = scaleStroke(stroke, 0, 0, 0.5, true);
    Object.assign(stroke, scaled);
    clearCompressedCache(stroke); // THE FIX

    // Verify the stroke's pts now contains scaled data
    const currentPoints = decodePoints(stroke.pts);
    expect(currentPoints[0].x).toBeCloseTo(100, 0);
    expect(currentPoints[0].y).toBeCloseTo(50, 0);

    // Verify serialization uses the new pts (no doc needed — just check the cache was cleared)
    // Re-precompress should compress the NEW data
    precompressStroke(stroke);
    const doc = makeDoc([stroke]);
    const json = serializeDocument(doc);
    const restored = deserializeDocument(json);

    const restoredPoints = decodePoints(restored.strokes[0].pts);
    expect(restoredPoints[0].x).toBeCloseTo(100, 0);
    expect(restoredPoints[0].y).toBeCloseTo(50, 0);
  });
});

describe("scaleStroke bbox regression", () => {
  const styles = {
    _default: {
      pen: "pencil" as const,  // stamp-based pen with tiltConfig
      color: "#000",
      width: 4,
      opacity: 1,
      smoothing: 0.5,
      pressureCurve: 1,
      tiltSensitivity: 0,
    },
  };

  it("bbox should contain all transformed points with margin", () => {
    const points = [makePoint(100, 100), makePoint(200, 200), makePoint(300, 100)];
    const stroke = makeStroke(points, { style: "_default" });

    const result = scaleStroke(stroke, 0, 0, 0.5, true, styles);

    // Scaled points: (50,50), (100,100), (150,50)
    const scaledPoints = decodePoints(result.pts);
    for (const pt of scaledPoints) {
      expect(pt.x).toBeGreaterThanOrEqual(result.bbox[0]);
      expect(pt.y).toBeGreaterThanOrEqual(result.bbox[1]);
      expect(pt.x).toBeLessThanOrEqual(result.bbox[2]);
      expect(pt.y).toBeLessThanOrEqual(result.bbox[3]);
    }
  });

  it("bbox margin should be based on effective pen width, not scaled from old bbox", () => {
    const points = [makePoint(100, 100), makePoint(200, 100)];
    const stroke = makeStroke(points, { style: "_default" });

    // Scale down 0.5x — points compress but base style width stays at 4
    const result = scaleStroke(stroke, 0, 0, 0.5, true, styles);

    const scaledPoints = decodePoints(result.pts);
    const minX = Math.min(...scaledPoints.map(p => p.x));
    const maxX = Math.max(...scaledPoints.map(p => p.x));

    // Margin must be at least width*2 = 8 for a stamp pen (actually larger with tiltConfig)
    const leftMargin = minX - result.bbox[0];
    const rightMargin = result.bbox[2] - maxX;
    expect(leftMargin).toBeGreaterThanOrEqual(8);
    expect(rightMargin).toBeGreaterThanOrEqual(8);
  });

  it("regression: scaling down should NOT shrink bbox margin below rendering needs", () => {
    const points = [makePoint(400, 400), makePoint(500, 500), makePoint(600, 400)];
    const stroke = makeStroke(points, { style: "_default" });

    // Aggressive scale down — old bug would proportionally shrink the margin
    const result = scaleStroke(stroke, 0, 0, 0.1, true, styles);

    const scaledPoints = decodePoints(result.pts);
    const minX = Math.min(...scaledPoints.map(p => p.x));
    const maxX = Math.max(...scaledPoints.map(p => p.x));
    const minY = Math.min(...scaledPoints.map(p => p.y));
    const maxY = Math.max(...scaledPoints.map(p => p.y));

    // Even at 0.1x scale, the margin must still be based on the rendering width (4*2=8 minimum)
    // Not 0.1x the original margin
    expect(minX - result.bbox[0]).toBeGreaterThanOrEqual(8);
    expect(result.bbox[2] - maxX).toBeGreaterThanOrEqual(8);
    expect(minY - result.bbox[1]).toBeGreaterThanOrEqual(8);
    expect(result.bbox[3] - maxY).toBeGreaterThanOrEqual(8);
  });
});
