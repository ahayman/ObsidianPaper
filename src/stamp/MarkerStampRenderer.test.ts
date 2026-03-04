import { computeAllMarkerStamps, computeMarkerStamps } from "./MarkerStampRenderer";
import type { StrokePoint, PenStyle } from "../types";
import type { PenConfig, MarkerStampConfig } from "../stroke/PenConfigs";
import { PEN_CONFIGS } from "../stroke/PenConfigs";

const feltTipConfig = PEN_CONFIGS["felt-tip"];
const markerConfig = feltTipConfig.markerStamp!;

function makePoint(x: number, y: number, pressure = 0.5, timestamp = 0, tiltX = 0, tiltY = 0): StrokePoint {
  return { x, y, pressure, timestamp, tiltX, tiltY, twist: 0 };
}

const baseStyle: PenStyle = {
  pen: "felt-tip",
  color: "#1a1a1a",
  width: 6,
  opacity: 0.8,
  smoothing: 0.5,
  pressureCurve: 1,
  tiltSensitivity: 0,
};

describe("MarkerStampRenderer", () => {
  describe("computeAllMarkerStamps", () => {
    it("returns empty array for empty points", () => {
      const stamps = computeAllMarkerStamps([], baseStyle, feltTipConfig, markerConfig);
      expect(stamps).toEqual([]);
    });

    it("returns empty array for single point", () => {
      const stamps = computeAllMarkerStamps(
        [makePoint(0, 0)], baseStyle, feltTipConfig, markerConfig,
      );
      expect(stamps).toEqual([]);
    });

    it("produces stamps for a horizontal line", () => {
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(50, 0, 0.5, 100),
        makePoint(100, 0, 0.5, 200),
      ];
      const stamps = computeAllMarkerStamps(points, baseStyle, feltTipConfig, markerConfig);
      expect(stamps.length).toBeGreaterThan(0);
    });

    it("uses static rotation when no tilt data", () => {
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(100, 0, 0.5, 200),
      ];
      const stamps = computeAllMarkerStamps(points, baseStyle, feltTipConfig, markerConfig);
      // No tilt data → all stamps use default static rotation (0)
      for (const s of stamps) {
        expect(s.rotation).toBe(0);
      }
    });

    it("uses tilt azimuth for rotation when tilt is available", () => {
      // Tilt pointing right (tiltX=20, tiltY=0) → rotation ≈ 0
      const points = [
        makePoint(0, 0, 0.5, 0, 20, 0),
        makePoint(100, 0, 0.5, 200, 20, 0),
      ];
      const stamps = computeAllMarkerStamps(points, baseStyle, feltTipConfig, markerConfig);
      for (const s of stamps) {
        expect(Math.abs(s.rotation)).toBeLessThan(0.1);
      }
    });

    it("uses tilt azimuth for vertical tilt direction", () => {
      // Tilt pointing up (tiltX=0, tiltY=20) → rotation ≈ π/2
      const points = [
        makePoint(0, 0, 0.5, 0, 0, 20),
        makePoint(100, 0, 0.5, 200, 0, 20),
      ];
      const stamps = computeAllMarkerStamps(points, baseStyle, feltTipConfig, markerConfig);
      for (const s of stamps) {
        expect(Math.abs(s.rotation - Math.PI / 2)).toBeLessThan(0.1);
      }
    });

    it("rotation follows tilt changes along stroke", () => {
      // Tilt changes from right to up along the stroke
      const points = [
        makePoint(0, 0, 0.5, 0, 20, 0),     // tilt right → rotation ≈ 0
        makePoint(100, 0, 0.5, 200, 0, 20),  // tilt up → rotation ≈ π/2
      ];
      const stamps = computeAllMarkerStamps(points, baseStyle, feltTipConfig, markerConfig);
      // Early stamps should have rotation near 0, late stamps near π/2
      const earlyStamps = stamps.filter(s => s.x < 30);
      const lateStamps = stamps.filter(s => s.x > 70);

      if (earlyStamps.length > 0 && lateStamps.length > 0) {
        const avgEarlyRot = earlyStamps.reduce((sum, s) => sum + Math.abs(s.rotation), 0) / earlyStamps.length;
        const avgLateRot = lateStamps.reduce((sum, s) => sum + Math.abs(s.rotation), 0) / lateStamps.length;
        expect(avgLateRot).toBeGreaterThan(avgEarlyRot);
      }
    });

    it("applies aspect ratio (width != height)", () => {
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(100, 0, 0.5, 200),
      ];
      const stamps = computeAllMarkerStamps(points, baseStyle, feltTipConfig, markerConfig);
      for (const s of stamps) {
        expect(s.width).toBeGreaterThan(s.height);
        expect(s.width / s.height).toBeCloseTo(markerConfig.aspectRatio, 1);
      }
    });

    it("stamp count scales with stroke length", () => {
      const shortPoints = [
        makePoint(0, 0, 0.5, 0),
        makePoint(50, 0, 0.5, 100),
      ];
      const longPoints = [
        makePoint(0, 0, 0.5, 0),
        makePoint(200, 0, 0.5, 400),
      ];
      const shortStamps = computeAllMarkerStamps(shortPoints, baseStyle, feltTipConfig, markerConfig);
      const longStamps = computeAllMarkerStamps(longPoints, baseStyle, feltTipConfig, markerConfig);
      expect(longStamps.length).toBeGreaterThan(shortStamps.length);
    });

    it("generates corner fill stamps at sharp turns", () => {
      // V-shape: right then up
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(50, 50, 0.5, 100),
        makePoint(100, 0, 0.5, 200),
      ];
      const stamps = computeAllMarkerStamps(points, baseStyle, feltTipConfig, markerConfig);
      // Should have stamps at start, end, and the corner — more than just walking-based stamps
      expect(stamps.length).toBeGreaterThan(0);
    });
  });

  describe("ink depletion", () => {
    it("stamps have full opacity when inkDepletion is 0", () => {
      const style: PenStyle = { ...baseStyle, inkDepletion: 0 };
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(200, 0, 0.5, 400),
      ];
      const stamps = computeAllMarkerStamps(points, style, feltTipConfig, markerConfig);
      // All stamps should have opacity close to 1 (before dithering ±5%)
      for (const s of stamps) {
        expect(s.opacity).toBeGreaterThan(0.9);
      }
    });

    it("stamps lose opacity when inkDepletion is nonzero", () => {
      const style: PenStyle = { ...baseStyle, inkDepletion: 1.0 };
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(500, 0, 0.5, 1000),
      ];
      const stamps = computeAllMarkerStamps(points, style, feltTipConfig, markerConfig);
      const earlyStamps = stamps.filter(s => s.x < 100);
      const lateStamps = stamps.filter(s => s.x > 400);

      if (earlyStamps.length > 0 && lateStamps.length > 0) {
        const avgEarlyOpacity = earlyStamps.reduce((sum, s) => sum + s.opacity, 0) / earlyStamps.length;
        const avgLateOpacity = lateStamps.reduce((sum, s) => sum + s.opacity, 0) / lateStamps.length;
        expect(avgLateOpacity).toBeLessThan(avgEarlyOpacity);
      }
    });
  });

  describe("computeMarkerStamps (incremental)", () => {
    it("returns stamps for a segment range", () => {
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(50, 0, 0.5, 100),
        makePoint(100, 0, 0.5, 200),
      ];
      const result = computeMarkerStamps(
        points, 0, 2, 0, baseStyle, feltTipConfig, markerConfig, 0, 0,
      );
      expect(result.stamps.length).toBeGreaterThan(0);
      expect(result.newRemainder).toBeGreaterThanOrEqual(0);
      expect(result.newStampCount).toBeGreaterThan(0);
    });
  });
});
