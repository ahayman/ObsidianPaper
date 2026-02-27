import { prepareStrokeData } from "./StrokeDataPreparer";
import { resolveMaterial } from "./StrokeMaterial";
import { PEN_CONFIGS } from "../stroke/PenConfigs";
import { StrokePathCache } from "../stroke/OutlineGenerator";
import type { Stroke, PenStyle } from "../types";
import { encodePoints } from "../document/PointEncoder";
import type { StrokePoint } from "../types";

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

function makeStroke(points: StrokePoint[], styleId: string): Stroke {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    id: `test-stroke-${styleId}`,
    pageIndex: 0,
    style: styleId,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    pointCount: points.length,
    pts: encodePoints(points),
  };
}

const ballpointStyle: PenStyle = {
  pen: "ballpoint", color: "#1a1a1a", width: 2, opacity: 1,
  smoothing: 0.5, pressureCurve: 1, tiltSensitivity: 0,
};

const pencilStyle: PenStyle = {
  pen: "pencil", color: "#2d2d2d", width: 3, opacity: 0.85,
  smoothing: 0.4, pressureCurve: 1, tiltSensitivity: 0, grain: 0.5,
};

const fountainStyle: PenStyle = {
  pen: "fountain", color: "#000000", width: 6, opacity: 1,
  smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0,
  nibAngle: Math.PI / 6, nibThickness: 0.25, inkPreset: "standard",
};

// ─── Tests ──────────────────────────────────────────────────

describe("prepareStrokeData", () => {
  const points = makePoints();

  describe("ballpoint / basic fill", () => {
    const config = PEN_CONFIGS.ballpoint;
    const material = resolveMaterial(config, ballpointStyle, "basic", 0);
    const stroke = makeStroke(points, "bp");
    const cache = new StrokePathCache();

    it("produces vertices and color", () => {
      const data = prepareStrokeData(stroke, ballpointStyle, config, material, cache, 0, false);
      expect(data.vertices).toBeInstanceOf(Float32Array);
      expect(data.vertices!.length).toBeGreaterThan(0);
      expect(data.italic).toBe(false);
      expect(data.color).toBe("#1a1a1a");
    });

    it("does not compute stamp data for fill body", () => {
      const data = prepareStrokeData(stroke, ballpointStyle, config, material, cache, 0, false);
      expect(data.stampData).toBeUndefined();
    });

    it("caches vertices in pathCache", () => {
      const freshCache = new StrokePathCache();
      prepareStrokeData(stroke, ballpointStyle, config, material, freshCache, 0, false);
      expect(freshCache.size).toBe(1);
    });

    it("uses cached vertices on second call", () => {
      const freshCache = new StrokePathCache();
      const data1 = prepareStrokeData(stroke, ballpointStyle, config, material, freshCache, 0, false);
      const data2 = prepareStrokeData(stroke, ballpointStyle, config, material, freshCache, 0, false);
      // Same Float32Array from cache
      expect(data1.vertices).toBe(data2.vertices);
    });
  });

  describe("pencil / advanced LOD 0 (stampDiscs)", () => {
    const config = PEN_CONFIGS.pencil;
    const material = resolveMaterial(config, pencilStyle, "advanced", 0);
    const stroke = makeStroke(points, "pencil");

    it("produces stamp data", () => {
      const cache = new StrokePathCache();
      const data = prepareStrokeData(stroke, pencilStyle, config, material, cache, 0, false);
      expect(data.stampData).toBeInstanceOf(Float32Array);
      expect(data.stampData!.length).toBeGreaterThan(0);
      // Stamp data has [x, y, size, opacity] tuples
      expect(data.stampData!.length % 4).toBe(0);
    });

    it("does not produce vertices (stampDiscs body)", () => {
      const cache = new StrokePathCache();
      const data = prepareStrokeData(stroke, pencilStyle, config, material, cache, 0, false);
      expect(data.vertices).toBeNull();
    });
  });

  describe("fountain / advanced LOD 0 (inkShading)", () => {
    const config = PEN_CONFIGS.fountain;
    const material = resolveMaterial(config, fountainStyle, "advanced", 0);
    const stroke = makeStroke(points, "fountain");

    it("produces both vertices (for mask) and stamp data", () => {
      const cache = new StrokePathCache();
      const data = prepareStrokeData(stroke, fountainStyle, config, material, cache, 0, false);
      expect(data.vertices).toBeInstanceOf(Float32Array);
      expect(data.vertices!.length).toBeGreaterThan(0);
      expect(data.stampData).toBeInstanceOf(Float32Array);
      expect(data.stampData!.length).toBeGreaterThan(0);
    });

    it("produces italic vertices for fountain pen", () => {
      const cache = new StrokePathCache();
      const data = prepareStrokeData(stroke, fountainStyle, config, material, cache, 0, false);
      expect(data.italic).toBe(true);
    });
  });

  describe("LOD simplification", () => {
    const config = PEN_CONFIGS.ballpoint;
    const material = resolveMaterial(config, ballpointStyle, "basic", 2);
    const stroke = makeStroke(points, "bp-lod");

    it("produces different cache keys for different LOD levels", () => {
      const cache = new StrokePathCache();
      prepareStrokeData(stroke, ballpointStyle, config, material, cache, 0, false);
      prepareStrokeData(stroke, ballpointStyle, config, material, cache, 2, false);
      // Two different LOD entries cached
      expect(cache.size).toBe(2);
    });
  });

  describe("bbox and stroke width", () => {
    const config = PEN_CONFIGS.ballpoint;
    const material = resolveMaterial(config, ballpointStyle, "basic", 0);
    const stroke = makeStroke(points, "bp-bbox");

    it("passes through bbox and strokeWidth", () => {
      const cache = new StrokePathCache();
      const data = prepareStrokeData(stroke, ballpointStyle, config, material, cache, 0, false);
      expect(data.bbox).toEqual(stroke.bbox);
      expect(data.strokeWidth).toBe(2);
    });
  });
});
