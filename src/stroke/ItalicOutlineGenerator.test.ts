import { generateItalicOutline, type ItalicNibConfig } from "./ItalicOutlineGenerator";
import type { StrokePoint } from "../types";

function makePoint(x: number, y: number, pressure = 0.5, twist = 0): StrokePoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, twist, timestamp: Date.now() };
}

function makeConfig(overrides?: Partial<ItalicNibConfig>): ItalicNibConfig {
  return {
    nibWidth: 6,
    nibHeight: 1.5,    // 0.25 aspect ratio
    nibAngle: Math.PI / 6, // 30 degrees
    useBarrelRotation: false,
    pressureCurve: 1.0,
    pressureWidthRange: [0.5, 1.0],
    widthSmoothing: 0.4,
    taperStart: 0,
    taperEnd: 0,
    ...overrides,
  };
}

describe("ItalicOutlineGenerator", () => {
  describe("basic output format", () => {
    it("should return empty array for no points", () => {
      const result = generateItalicOutline([], makeConfig());
      expect(result).toEqual([]);
    });

    it("should return a polygon for a single point", () => {
      const result = generateItalicOutline([makePoint(100, 100)], makeConfig());
      expect(result.length).toBeGreaterThanOrEqual(3);
      // Each entry should be [x, y]
      for (const pt of result) {
        expect(pt).toHaveLength(2);
        expect(typeof pt[0]).toBe("number");
        expect(typeof pt[1]).toBe("number");
      }
    });

    it("should return a closed polygon for two points", () => {
      const points = [makePoint(100, 100), makePoint(200, 100)];
      const result = generateItalicOutline(points, makeConfig());
      expect(result.length).toBeGreaterThanOrEqual(4); // At least a quad
      for (const pt of result) {
        expect(pt).toHaveLength(2);
      }
    });

    it("should return array of [x,y] pairs for multiple points", () => {
      const points = [
        makePoint(100, 100),
        makePoint(120, 110),
        makePoint(140, 105),
        makePoint(160, 115),
        makePoint(180, 100),
      ];
      const result = generateItalicOutline(points, makeConfig());
      expect(result.length).toBeGreaterThan(0);
      for (const pt of result) {
        expect(pt).toHaveLength(2);
        expect(Number.isFinite(pt[0])).toBe(true);
        expect(Number.isFinite(pt[1])).toBe(true);
      }
    });
  });

  describe("width projection", () => {
    it("should produce wider stroke perpendicular to nib edge", () => {
      // Nib at 0 degrees (horizontal). Stroke going up (perpendicular).
      const config = makeConfig({ nibAngle: 0, nibWidth: 10, nibHeight: 2.5, widthSmoothing: 1.0 });
      const perpPoints = [makePoint(100, 100, 0.5), makePoint(100, 50, 0.5)];
      const perpOutline = generateItalicOutline(perpPoints, config);

      // Same config, stroke going right (parallel).
      const paraPoints = [makePoint(100, 100, 0.5), makePoint(150, 100, 0.5)];
      const paraOutline = generateItalicOutline(paraPoints, config);

      // Measure width of each outline at the second point (index 1 and N-2)
      const perpWidth = getOutlineWidth(perpOutline);
      const paraWidth = getOutlineWidth(paraOutline);

      expect(perpWidth).toBeGreaterThan(paraWidth);
    });

    it("should produce minimum width when stroke is parallel to nib edge", () => {
      // Nib at 0 degrees (horizontal). Stroke going right (parallel).
      const config = makeConfig({ nibAngle: 0, nibWidth: 10, nibHeight: 2, widthSmoothing: 1.0 });
      const points = [makePoint(100, 100, 0.5), makePoint(200, 100, 0.5)];
      const outline = generateItalicOutline(points, config);
      const width = getOutlineWidth(outline);

      // Width should be close to nibHeight * pressure range
      // nibHeight=2, pressure=0.5, pressureWidthRange=[0.5,1.0] => factor=0.75 => ~1.5
      expect(width).toBeLessThan(config.nibWidth);
    });
  });

  describe("pressure scaling", () => {
    it("should produce wider stroke with higher pressure", () => {
      const config = makeConfig({ widthSmoothing: 1.0, taperStart: 0, taperEnd: 0 });
      const lowPressure = [makePoint(100, 100, 0.2), makePoint(200, 150, 0.2)];
      const highPressure = [makePoint(100, 100, 0.9), makePoint(200, 150, 0.9)];

      const lowOutline = generateItalicOutline(lowPressure, config);
      const highOutline = generateItalicOutline(highPressure, config);

      const lowWidth = getOutlineWidth(lowOutline);
      const highWidth = getOutlineWidth(highOutline);

      expect(highWidth).toBeGreaterThan(lowWidth);
    });
  });

  describe("barrel rotation", () => {
    it("should use twist as nib angle when barrel rotation is enabled", () => {
      const config = makeConfig({
        useBarrelRotation: true,
        nibAngle: 0, // static angle = 0
        nibWidth: 10,
        nibHeight: 2.5,
        widthSmoothing: 1.0,
      });

      // Stroke going up with twist=0 (nib horizontal → perpendicular → max width)
      const noTwist = [makePoint(100, 100, 0.5, 0), makePoint(100, 50, 0.5, 0)];
      const noTwistOutline = generateItalicOutline(noTwist, config);

      // Same stroke but twist=90 (nib vertical → parallel → min width)
      const withTwist = [makePoint(100, 100, 0.5, 90), makePoint(100, 50, 0.5, 90)];
      const withTwistOutline = generateItalicOutline(withTwist, config);

      const noTwistWidth = getOutlineWidth(noTwistOutline);
      const withTwistWidth = getOutlineWidth(withTwistOutline);

      expect(noTwistWidth).toBeGreaterThan(withTwistWidth);
    });

    it("should ignore twist when barrel rotation is disabled", () => {
      const config = makeConfig({
        useBarrelRotation: false,
        nibAngle: 0,
        nibWidth: 10,
        nibHeight: 2.5,
        widthSmoothing: 1.0,
      });

      const noTwist = [makePoint(100, 100, 0.5, 0), makePoint(100, 50, 0.5, 0)];
      const withTwist = [makePoint(100, 100, 0.5, 90), makePoint(100, 50, 0.5, 90)];

      const noTwistOutline = generateItalicOutline(noTwist, config);
      const withTwistOutline = generateItalicOutline(withTwist, config);

      const noTwistWidth = getOutlineWidth(noTwistOutline);
      const withTwistWidth = getOutlineWidth(withTwistOutline);

      // Should be equal since twist is ignored
      expect(Math.abs(noTwistWidth - withTwistWidth)).toBeLessThan(0.01);
    });
  });

  describe("taper", () => {
    it("should taper width at start of stroke", () => {
      const config = makeConfig({ taperStart: 50, taperEnd: 0, widthSmoothing: 1.0 });
      // Slight curve so RDP de-jitter preserves interior points
      const points = Array.from({ length: 10 }, (_, i) =>
        makePoint(100 + i * 10, 100 + Math.sin(i * 0.3) * 5, 0.5)
      );
      const outline = generateItalicOutline(points, config);
      const n = outline.length / 2;

      // The outline at the start should be narrower than the middle
      const startWidth = getWidthAtIndex(outline, 0, n);
      const midWidth = getWidthAtIndex(outline, Math.floor(n / 2), n);

      expect(startWidth).toBeLessThan(midWidth);
    });

    it("should taper width at end of stroke", () => {
      const config = makeConfig({ taperStart: 0, taperEnd: 50, widthSmoothing: 1.0 });
      // Slight curve so RDP de-jitter preserves interior points
      const points = Array.from({ length: 10 }, (_, i) =>
        makePoint(100 + i * 10, 100 + Math.sin(i * 0.3) * 5, 0.5)
      );
      const outline = generateItalicOutline(points, config);
      const n = outline.length / 2;

      const endWidth = getWidthAtIndex(outline, n - 1, n);
      const midWidth = getWidthAtIndex(outline, Math.floor(n / 2), n);

      expect(endWidth).toBeLessThan(midWidth);
    });
  });

  describe("minimum width floor", () => {
    it("should never produce zero-width geometry", () => {
      // Even with zero pressure, the floor should prevent zero width
      const config = makeConfig({ nibHeight: 2 });
      const points = [makePoint(100, 100, 0), makePoint(200, 100, 0)];
      const outline = generateItalicOutline(points, config);

      const width = getOutlineWidth(outline);
      expect(width).toBeGreaterThan(0);
    });
  });
});

/**
 * Measure the approximate width of an outline polygon at its midpoint.
 * The outline format is [...leftSide, ...rightSide.reverse()],
 * so left[i] pairs with right[N-1-i].
 */
function getOutlineWidth(outline: number[][]): number {
  if (outline.length < 4) return 0;
  const n = outline.length / 2;
  const midLeft = Math.floor(n / 2);
  const midRight = outline.length - 1 - midLeft;
  const dx = outline[midLeft][0] - outline[midRight][0];
  const dy = outline[midLeft][1] - outline[midRight][1];
  return Math.hypot(dx, dy);
}

function getWidthAtIndex(outline: number[][], idx: number, pointCount: number): number {
  if (outline.length < 4 || idx >= pointCount) return 0;
  const rightIdx = outline.length - 1 - idx;
  if (rightIdx < 0 || rightIdx >= outline.length) return 0;
  const dx = outline[idx][0] - outline[rightIdx][0];
  const dy = outline[idx][1] - outline[rightIdx][1];
  return Math.hypot(dx, dy);
}
