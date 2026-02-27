import { inkShadingGenerator, INK_SHADING_ID } from "./InkShadingGenerator";
import { getStampGenerator } from "./StampTypes";
import type { StampAccumulatorState } from "./StampTypes";
import { computeAllInkStamps } from "../../stamp/InkStampRenderer";
import { packInkStampsToFloat32 } from "../../stamp/StampPacking";
import { getInkPreset } from "../../stamp/InkPresets";
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

const fountainStyle: PenStyle = {
  pen: "fountain", color: "#000000", width: 6, opacity: 1,
  smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0,
  nibAngle: Math.PI / 6, nibThickness: 0.25, inkPreset: "standard",
};

const fountainConfig = PEN_CONFIGS.fountain;

// ─── Tests ──────────────────────────────────────────────────

describe("InkShadingGenerator", () => {
  it("self-registers with ID 'ink-shading'", () => {
    expect(getStampGenerator(INK_SHADING_ID)).toBe(inkShadingGenerator);
  });

  it("computeAll returns non-empty data for valid points", () => {
    const points = makePoints();
    const result = inkShadingGenerator.computeAll(points, fountainStyle, fountainConfig);
    expect(result.count).toBeGreaterThan(0);
    expect(result.data.length).toBe(result.count * 4);
  });

  it("computeAll returns empty for empty points", () => {
    const result = inkShadingGenerator.computeAll([], fountainStyle, fountainConfig);
    expect(result.count).toBe(0);
  });

  it("computeAll returns empty when penConfig has no inkStamp config", () => {
    const noInkConfig = { ...fountainConfig, inkStamp: null };
    const result = inkShadingGenerator.computeAll(makePoints(), fountainStyle, noInkConfig);
    expect(result.count).toBe(0);
  });

  it("computeAll matches existing computeAllInkStamps + packInkStampsToFloat32", () => {
    const points = makePoints();
    const preset = getInkPreset(fountainStyle.inkPreset);
    const stamps = computeAllInkStamps(
      points, fountainStyle, fountainConfig, fountainConfig.inkStamp!, preset,
    );
    const oldPacked = packInkStampsToFloat32(stamps);

    const newResult = inkShadingGenerator.computeAll(points, fountainStyle, fountainConfig, preset);
    expect(newResult.data).toEqual(oldPacked);
  });

  it("uses default preset when presetConfig not provided", () => {
    const points = makePoints();
    const withPreset = inkShadingGenerator.computeAll(
      points, fountainStyle, fountainConfig, getInkPreset("standard"),
    );
    const withoutPreset = inkShadingGenerator.computeAll(
      points, fountainStyle, fountainConfig,
    );
    expect(withoutPreset.data).toEqual(withPreset.data);
  });

  it("data has [x, y, size, opacity] tuples", () => {
    const points = makePoints();
    const result = inkShadingGenerator.computeAll(points, fountainStyle, fountainConfig);
    expect(result.data.length % 4).toBe(0);
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i + 2]).toBeGreaterThan(0); // size > 0
      expect(result.data[i + 3]).toBeGreaterThan(0); // opacity > 0
      expect(result.data[i + 3]).toBeLessThanOrEqual(1);
    }
  });

  it("includes low-opacity stamps (no filtering like pencil)", () => {
    const points = makePoints(60);
    // Use fast timestamps to produce low-opacity stamps
    const fastPoints = points.map((p, i) => ({ ...p, timestamp: i * 2 }));
    const result = inkShadingGenerator.computeAll(fastPoints, fountainStyle, fountainConfig);
    // All stamps should be present, even low-opacity ones
    const preset = getInkPreset(fountainStyle.inkPreset);
    const stamps = computeAllInkStamps(
      fastPoints, fountainStyle, fountainConfig, fountainConfig.inkStamp!, preset,
    );
    expect(result.count).toBe(stamps.length);
  });

  describe("incremental computation", () => {
    it("computes stamps for a point range", () => {
      const points = makePoints();
      const acc: StampAccumulatorState = { lastPointIndex: 0, remainder: 0, stampCount: 0 };
      const result = inkShadingGenerator.computeIncremental(
        points, 0, 15, acc, fountainStyle, fountainConfig,
      );
      expect(result.count).toBeGreaterThan(0);
      expect(acc.stampCount).toBeGreaterThan(0);
      expect(acc.lastPointIndex).toBe(15);
    });

    it("accumulator state carries over between calls", () => {
      const points = makePoints();
      const acc: StampAccumulatorState = { lastPointIndex: 0, remainder: 0, stampCount: 0 };

      inkShadingGenerator.computeIncremental(
        points, 0, 15, acc, fountainStyle, fountainConfig,
      );
      const countAfterFirst = acc.stampCount;

      inkShadingGenerator.computeIncremental(
        points, 15, 29, acc, fountainStyle, fountainConfig,
      );
      expect(acc.stampCount).toBeGreaterThan(countAfterFirst);
    });

    it("returns empty when penConfig has no inkStamp config", () => {
      const noInkConfig = { ...fountainConfig, inkStamp: null };
      const acc: StampAccumulatorState = { lastPointIndex: 0, remainder: 0, stampCount: 0 };
      const result = inkShadingGenerator.computeIncremental(
        makePoints(), 0, 15, acc, fountainStyle, noInkConfig,
      );
      expect(result.count).toBe(0);
    });
  });
});
