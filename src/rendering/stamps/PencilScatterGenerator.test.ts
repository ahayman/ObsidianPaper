import { pencilScatterGenerator, PENCIL_SCATTER_ID } from "./PencilScatterGenerator";
import { getStampGenerator, clearStampGenerators } from "./StampTypes";
import type { StampAccumulatorState } from "./StampTypes";
import { computeAllStamps } from "../../stamp/StampRenderer";
import { packStampsToFloat32 } from "../../stamp/StampPacking";
import { PEN_CONFIGS } from "../../stroke/PenConfigs";
import type { PenStyle, StrokePoint } from "../../types";

// ─── Fixtures ───────────────────────────────────────────────

function makePoints(n = 30): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i < n; i++) {
    points.push({
      x: 100 + i * 3,
      y: 200 + Math.sin(i * 0.2) * 2,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      timestamp: i * 16,
    });
  }
  return points;
}

const pencilStyle: PenStyle = {
  pen: "pencil", color: "#2d2d2d", width: 3, opacity: 0.85,
  smoothing: 0.4, pressureCurve: 1, tiltSensitivity: 0, grain: 0.5,
};

const pencilConfig = PEN_CONFIGS.pencil;

// ─── Tests ──────────────────────────────────────────────────

describe("PencilScatterGenerator", () => {
  it("self-registers with ID 'pencil-scatter'", () => {
    expect(getStampGenerator(PENCIL_SCATTER_ID)).toBe(pencilScatterGenerator);
  });

  it("computeAll returns non-empty data for valid points", () => {
    const points = makePoints();
    const result = pencilScatterGenerator.computeAll(points, pencilStyle, pencilConfig);
    expect(result.count).toBeGreaterThan(0);
    expect(result.data.length).toBe(result.count * 4);
  });

  it("computeAll returns empty for empty points", () => {
    const result = pencilScatterGenerator.computeAll([], pencilStyle, pencilConfig);
    expect(result.count).toBe(0);
    expect(result.data.length).toBe(0);
  });

  it("computeAll returns empty when penConfig has no stamp config", () => {
    const noStampConfig = { ...pencilConfig, stamp: null };
    const result = pencilScatterGenerator.computeAll(makePoints(), pencilStyle, noStampConfig);
    expect(result.count).toBe(0);
  });

  it("computeAll matches existing computeAllStamps + packStampsToFloat32", () => {
    const points = makePoints();
    const stamps = computeAllStamps(points, pencilStyle, pencilConfig, pencilConfig.stamp!);
    const oldPacked = packStampsToFloat32(stamps);

    const newResult = pencilScatterGenerator.computeAll(points, pencilStyle, pencilConfig);
    expect(newResult.data).toEqual(oldPacked);
  });

  it("data has [x, y, size, opacity] tuples", () => {
    const points = makePoints();
    const result = pencilScatterGenerator.computeAll(points, pencilStyle, pencilConfig);
    expect(result.data.length % 4).toBe(0);
    // Size should be small (particle size, not stroke width)
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i + 2]).toBeGreaterThan(0); // size > 0
      expect(result.data[i + 3]).toBeGreaterThanOrEqual(0.05); // opacity >= threshold
      expect(result.data[i + 3]).toBeLessThanOrEqual(1); // opacity <= 1
    }
  });

  describe("incremental computation", () => {
    it("computes stamps for a point range", () => {
      const points = makePoints();
      const acc: StampAccumulatorState = { lastPointIndex: 0, remainder: 0, stampCount: 0 };
      const result = pencilScatterGenerator.computeIncremental(
        points, 0, 15, acc, pencilStyle, pencilConfig,
      );
      expect(result.count).toBeGreaterThan(0);
      expect(acc.stampCount).toBeGreaterThan(0);
      expect(acc.lastPointIndex).toBe(15);
    });

    it("accumulator state carries over between calls", () => {
      const points = makePoints();
      const acc: StampAccumulatorState = { lastPointIndex: 0, remainder: 0, stampCount: 0 };

      pencilScatterGenerator.computeIncremental(
        points, 0, 15, acc, pencilStyle, pencilConfig,
      );
      const countAfterFirst = acc.stampCount;
      expect(countAfterFirst).toBeGreaterThan(0);

      pencilScatterGenerator.computeIncremental(
        points, 15, 29, acc, pencilStyle, pencilConfig,
      );
      expect(acc.stampCount).toBeGreaterThan(countAfterFirst);
      expect(acc.lastPointIndex).toBe(29);
    });

    it("returns empty when penConfig has no stamp config", () => {
      const noStampConfig = { ...pencilConfig, stamp: null };
      const acc: StampAccumulatorState = { lastPointIndex: 0, remainder: 0, stampCount: 0 };
      const result = pencilScatterGenerator.computeIncremental(
        makePoints(), 0, 15, acc, pencilStyle, noStampConfig,
      );
      expect(result.count).toBe(0);
    });
  });
});
