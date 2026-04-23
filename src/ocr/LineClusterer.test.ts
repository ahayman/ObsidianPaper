import type { Stroke } from "../types";
import { clusterStrokesIntoLines, clusterDocumentByPage } from "./LineClusterer";

function mkStroke(id: string, minY: number, maxY: number, pageIndex = 0): Stroke {
  return {
    id,
    pageIndex,
    style: "_default",
    bbox: [0, minY, 500, maxY],
    pointCount: 1,
    pts: "",
  };
}

describe("clusterStrokesIntoLines", () => {
  it("returns [] for empty input", () => {
    expect(clusterStrokesIntoLines([])).toEqual([]);
  });

  it("groups strokes within the same vertical band", () => {
    // Three strokes on the same line (y ~100-120) and two on a later line (y ~200-220)
    const strokes = [
      mkStroke("a", 100, 120),
      mkStroke("b", 105, 122),
      mkStroke("c", 110, 125),
      mkStroke("d", 200, 220),
      mkStroke("e", 205, 222),
    ];
    const clusters = clusterStrokesIntoLines(strokes);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].strokeIds.sort()).toEqual(["a", "b", "c"]);
    expect(clusters[1].strokeIds.sort()).toEqual(["d", "e"]);
  });

  it("returns clusters top-to-bottom", () => {
    const strokes = [
      mkStroke("low", 300, 320),
      mkStroke("mid", 150, 170),
      mkStroke("high", 50, 70),
    ];
    const clusters = clusterStrokesIntoLines(strokes);
    expect(clusters.map((c) => c.strokeIds[0])).toEqual(["high", "mid", "low"]);
  });

  it("merges overlapping vertical ranges", () => {
    // Single descender extends below the baseline — should still be one line.
    const strokes = [
      mkStroke("baseline", 100, 130),
      mkStroke("descender", 120, 150), // overlaps baseline
    ];
    const clusters = clusterStrokesIntoLines(strokes);
    expect(clusters).toHaveLength(1);
  });

  it("computes union bbox", () => {
    const strokes = [
      { ...mkStroke("a", 100, 120), bbox: [50, 100, 150, 120] as [number, number, number, number] },
      { ...mkStroke("b", 110, 130), bbox: [200, 110, 300, 130] as [number, number, number, number] },
    ];
    const clusters = clusterStrokesIntoLines(strokes);
    expect(clusters[0].bbox).toEqual([50, 100, 300, 130]);
  });

  it("respects threshold — widely separated strokes become separate lines", () => {
    const strokes = [
      mkStroke("top", 0, 20),
      mkStroke("bottom", 500, 520),
    ];
    const clusters = clusterStrokesIntoLines(strokes);
    expect(clusters).toHaveLength(2);
  });
});

describe("clusterDocumentByPage", () => {
  it("partitions strokes by pageIndex before clustering", () => {
    const strokes = [
      mkStroke("p0-a", 100, 120, 0),
      mkStroke("p0-b", 200, 220, 0),
      mkStroke("p1-a", 100, 120, 1),
      mkStroke("p1-b", 105, 125, 1),
    ];
    const result = clusterDocumentByPage(strokes);
    expect(result.get(0)).toHaveLength(2);
    expect(result.get(1)).toHaveLength(1);
    expect(result.get(1)?.[0].strokeIds.sort()).toEqual(["p1-a", "p1-b"]);
  });

  it("omits pages with no strokes", () => {
    const result = clusterDocumentByPage([mkStroke("x", 0, 10, 5)]);
    expect(result.size).toBe(1);
    expect(result.has(5)).toBe(true);
  });
});
