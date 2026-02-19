import { SpatialIndex } from "./SpatialIndex";
import type { Stroke } from "../types";

function makeStroke(
  id: string,
  bbox: [number, number, number, number]
): Stroke {
  return {
    id,
    pageIndex: 0,
    style: "_default",
    bbox,
    pointCount: 2,
    pts: "0,0,128,0,0,0,0;10,0,128,0,0,0,0",
  };
}

describe("SpatialIndex", () => {
  let index: SpatialIndex;

  beforeEach(() => {
    index = new SpatialIndex();
  });

  it("should create empty index", () => {
    expect(index.size).toBe(0);
  });

  it("should build from strokes", () => {
    const strokes = [
      makeStroke("s1", [0, 0, 100, 100]),
      makeStroke("s2", [200, 200, 300, 300]),
      makeStroke("s3", [50, 50, 150, 150]),
    ];
    index.buildFromStrokes(strokes);
    expect(index.size).toBe(3);
  });

  it("should query rect returning overlapping strokes", () => {
    const strokes = [
      makeStroke("s1", [0, 0, 100, 100]),
      makeStroke("s2", [200, 200, 300, 300]),
      makeStroke("s3", [50, 50, 150, 150]),
    ];
    index.buildFromStrokes(strokes);

    // Query that overlaps s1 and s3 but not s2
    const hits = index.queryRect(0, 0, 120, 120);
    expect(hits).toContain("s1");
    expect(hits).toContain("s3");
    expect(hits).not.toContain("s2");
  });

  it("should query rect returning empty for non-overlapping area", () => {
    const strokes = [
      makeStroke("s1", [0, 0, 100, 100]),
      makeStroke("s2", [200, 200, 300, 300]),
    ];
    index.buildFromStrokes(strokes);

    const hits = index.queryRect(500, 500, 600, 600);
    expect(hits).toEqual([]);
  });

  it("should query point with radius", () => {
    const strokes = [
      makeStroke("s1", [100, 100, 200, 200]),
      makeStroke("s2", [500, 500, 600, 600]),
    ];
    index.buildFromStrokes(strokes);

    // Point near s1
    const hits = index.queryPoint(150, 150, 10);
    expect(hits).toContain("s1");
    expect(hits).not.toContain("s2");
  });

  it("should insert a new stroke", () => {
    index.buildFromStrokes([makeStroke("s1", [0, 0, 100, 100])]);
    expect(index.size).toBe(1);

    index.insert(makeStroke("s2", [200, 200, 300, 300]), 1);
    expect(index.size).toBe(2);

    const hits = index.queryRect(200, 200, 300, 300);
    expect(hits).toContain("s2");
  });

  it("should remove a stroke", () => {
    const strokes = [
      makeStroke("s1", [0, 0, 100, 100]),
      makeStroke("s2", [200, 200, 300, 300]),
    ];
    index.buildFromStrokes(strokes);

    index.remove("s1");
    expect(index.size).toBe(1);

    const hits = index.queryRect(0, 0, 100, 100);
    expect(hits).not.toContain("s1");
  });

  it("should handle removing non-existent stroke", () => {
    index.buildFromStrokes([makeStroke("s1", [0, 0, 100, 100])]);
    expect(() => index.remove("nonexistent")).not.toThrow();
    expect(index.size).toBe(1);
  });

  it("should clear the index", () => {
    index.buildFromStrokes([
      makeStroke("s1", [0, 0, 100, 100]),
      makeStroke("s2", [200, 200, 300, 300]),
    ]);
    index.clear();
    expect(index.size).toBe(0);
    expect(index.queryRect(0, 0, 1000, 1000)).toEqual([]);
  });

  it("should handle rebuild replacing existing index", () => {
    index.buildFromStrokes([makeStroke("s1", [0, 0, 100, 100])]);
    index.buildFromStrokes([makeStroke("s2", [200, 200, 300, 300])]);

    expect(index.size).toBe(1);
    expect(index.queryRect(0, 0, 100, 100)).not.toContain("s1");
    expect(index.queryRect(200, 200, 300, 300)).toContain("s2");
  });

  it("should handle large number of strokes", () => {
    const strokes: Stroke[] = [];
    for (let i = 0; i < 1000; i++) {
      const x = (i % 50) * 20;
      const y = Math.floor(i / 50) * 20;
      strokes.push(makeStroke(`s${i}`, [x, y, x + 15, y + 15]));
    }
    index.buildFromStrokes(strokes);
    expect(index.size).toBe(1000);

    // Query a small region
    const hits = index.queryRect(0, 0, 30, 30);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(1000);
  });

  it("should handle empty strokes array", () => {
    index.buildFromStrokes([]);
    expect(index.size).toBe(0);
    expect(index.queryRect(0, 0, 1000, 1000)).toEqual([]);
  });
});
