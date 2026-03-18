import {
  computeSelectionBBox,
  hitTestSelection,
  getHandlePositions,
} from "./SelectionState";
import type { Stroke } from "../types";
import type { SelectionBBox } from "./SelectionState";

function makeStroke(id: string, bbox: [number, number, number, number]): Stroke {
  return {
    id,
    pageIndex: 0,
    style: "_default",
    bbox,
    pointCount: 2,
    pts: "0,0,128,0,0,0,0;10,0,128,0,0,0,0",
  };
}

describe("computeSelectionBBox", () => {
  it("should compute the union bbox of selected strokes with padding", () => {
    const strokes = [
      makeStroke("s1", [10, 20, 30, 40]),
      makeStroke("s2", [50, 60, 70, 80]),
      makeStroke("s3", [100, 100, 200, 200]), // not selected
    ];

    const selected = new Set(["s1", "s2"]);
    const bbox = computeSelectionBBox(selected, strokes);

    // Union of s1 and s2: [10, 20, 70, 80], with 4px padding
    expect(bbox.x).toBe(6);   // 10 - 4
    expect(bbox.y).toBe(16);  // 20 - 4
    expect(bbox.width).toBe(68);  // (70 - 10) + 8
    expect(bbox.height).toBe(68); // (80 - 20) + 8
  });

  it("should return zero bbox for empty selection", () => {
    const strokes = [makeStroke("s1", [10, 20, 30, 40])];
    const bbox = computeSelectionBBox(new Set(), strokes);
    expect(bbox.width).toBe(0);
    expect(bbox.height).toBe(0);
  });

  it("should handle single stroke", () => {
    const strokes = [makeStroke("s1", [100, 200, 150, 250])];
    const bbox = computeSelectionBBox(new Set(["s1"]), strokes);
    expect(bbox.x).toBe(96);
    expect(bbox.y).toBe(196);
    expect(bbox.width).toBe(58);
    expect(bbox.height).toBe(58);
  });
});

describe("getHandlePositions", () => {
  it("should return corners of the bounding box", () => {
    const bbox: SelectionBBox = { x: 10, y: 20, width: 100, height: 50 };
    const handles = getHandlePositions(bbox);

    expect(handles["top-left"]).toEqual({ x: 10, y: 20 });
    expect(handles["top-right"]).toEqual({ x: 110, y: 20 });
    expect(handles["bottom-left"]).toEqual({ x: 10, y: 70 });
    expect(handles["bottom-right"]).toEqual({ x: 110, y: 70 });
  });
});

describe("hitTestSelection", () => {
  const bbox: SelectionBBox = { x: 100, y: 100, width: 200, height: 100 };

  // Mock camera: identity transform (world = screen, zoom = 1)
  const camera = {
    worldToScreen: (wx: number, wy: number) => ({ x: wx, y: wy }),
    zoom: 1,
  };

  it("should detect handle hit", () => {
    // Top-left handle at (100, 100), tap right on it
    const result = hitTestSelection(100, 100, bbox, camera);
    expect(result.type).toBe("handle");
    if (result.type === "handle") {
      expect(result.corner).toBe("top-left");
    }
  });

  it("should detect inside hit", () => {
    const result = hitTestSelection(200, 150, bbox, camera);
    expect(result.type).toBe("inside");
  });

  it("should detect outside hit", () => {
    const result = hitTestSelection(50, 50, bbox, camera);
    expect(result.type).toBe("outside");
  });

  it("should prioritize handle over inside", () => {
    // Bottom-right handle at (300, 200), tap near it
    const result = hitTestSelection(300, 200, bbox, camera);
    expect(result.type).toBe("handle");
    if (result.type === "handle") {
      expect(result.corner).toBe("bottom-right");
    }
  });

  it("should detect handle within radius", () => {
    // Top-right handle at (300, 100), tap 15px away (within 22px default radius)
    const result = hitTestSelection(315, 100, bbox, camera);
    expect(result.type).toBe("handle");
    if (result.type === "handle") {
      expect(result.corner).toBe("top-right");
    }
  });

  it("should not detect handle beyond radius", () => {
    // Top-right handle at (300, 100), tap 30px away (beyond 22px default radius)
    const result = hitTestSelection(330, 100, bbox, camera);
    expect(result.type).toBe("outside");
  });
});
