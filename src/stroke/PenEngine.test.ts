import type { StrokePoint } from "../types";
import { computePointAttributes } from "./PenEngine";
import { PEN_CONFIGS, getPenConfig } from "./PenConfigs";
import type { PenConfig } from "./PenConfigs";

function makePoint(overrides: Partial<StrokePoint> = {}): StrokePoint {
  return {
    x: 100,
    y: 200,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    timestamp: 1000,
    ...overrides,
  };
}

describe("PenEngine", () => {
  describe("pressure → width", () => {
    it("should produce wider stroke at higher pressure (ballpoint)", () => {
      const config = getPenConfig("ballpoint");
      const lowP = computePointAttributes(makePoint({ pressure: 0.2 }), config);
      const highP = computePointAttributes(makePoint({ pressure: 0.9 }), config);

      expect(highP.width).toBeGreaterThan(lowP.width);
    });

    it("should produce wider stroke at higher pressure (brush)", () => {
      const config = getPenConfig("brush");
      const lowP = computePointAttributes(makePoint({ pressure: 0.1 }), config);
      const highP = computePointAttributes(makePoint({ pressure: 0.9 }), config);

      expect(highP.width).toBeGreaterThan(lowP.width);
    });

    it("should clamp pressure to 0-1", () => {
      const config = getPenConfig("ballpoint");
      const neg = computePointAttributes(makePoint({ pressure: -0.5 }), config);
      const over = computePointAttributes(makePoint({ pressure: 1.5 }), config);

      expect(neg.width).toBeGreaterThan(0);
      expect(over.width).toBeGreaterThan(0);
      expect(isFinite(neg.width)).toBe(true);
      expect(isFinite(over.width)).toBe(true);
    });
  });

  describe("pressure curve", () => {
    it("should affect width through gamma exponent", () => {
      const linearConfig = { ...getPenConfig("ballpoint"), pressureCurve: 1.0 };
      const softConfig = { ...getPenConfig("ballpoint"), pressureCurve: 0.5 };

      const point = makePoint({ pressure: 0.5 });
      const linear = computePointAttributes(point, linearConfig);
      const soft = computePointAttributes(point, softConfig);

      // pressureCurve < 1 makes low pressure feel heavier → wider at 0.5
      expect(soft.width).toBeGreaterThan(linear.width);
    });
  });

  describe("pencil tilt", () => {
    it("should widen stroke when tilted", () => {
      const config = getPenConfig("pencil");
      const upright = computePointAttributes(
        makePoint({ tiltX: 0, tiltY: 0 }),
        config
      );
      const tilted = computePointAttributes(
        makePoint({ tiltX: 50, tiltY: 0 }),
        config
      );

      expect(tilted.width).toBeGreaterThan(upright.width);
    });

    it("should reduce opacity when tilted", () => {
      const config = getPenConfig("pencil");
      const upright = computePointAttributes(
        makePoint({ tiltX: 0, tiltY: 0 }),
        config
      );
      const tilted = computePointAttributes(
        makePoint({ tiltX: 50, tiltY: 0 }),
        config
      );

      expect(tilted.opacity).toBeLessThan(upright.opacity);
    });

    it("should not affect non-pencil pens", () => {
      const config = getPenConfig("ballpoint");
      const upright = computePointAttributes(
        makePoint({ tiltX: 0, tiltY: 0 }),
        config
      );
      const tilted = computePointAttributes(
        makePoint({ tiltX: 50, tiltY: 0 }),
        config
      );

      expect(tilted.width).toBeCloseTo(upright.width, 5);
    });
  });

  describe("fountain pen angle-dependent width", () => {
    it("should vary width based on stroke direction", () => {
      const config = getPenConfig("fountain");
      const prevPoint = makePoint({ x: 100, y: 200, timestamp: 0 });

      // Stroke going right (0°)
      const horizontal = computePointAttributes(
        makePoint({ x: 110, y: 200, timestamp: 8 }),
        config,
        prevPoint
      );
      // Stroke going down (90°)
      const vertical = computePointAttributes(
        makePoint({ x: 100, y: 210, timestamp: 8 }),
        config,
        prevPoint
      );

      // Different directions should produce different widths
      expect(horizontal.width).not.toBeCloseTo(vertical.width, 0);
    });
  });

  describe("barrel rotation (twist)", () => {
    it("should use twist as nib angle for fountain pen when non-zero", () => {
      const config = getPenConfig("fountain");
      const prevPoint = makePoint({ x: 100, y: 200, timestamp: 0 });
      const nextPoint = makePoint({ x: 110, y: 200, timestamp: 8 });

      // Without twist (uses fixed nibAngle)
      const noTwist = computePointAttributes(
        { ...nextPoint, twist: 0 },
        config,
        prevPoint
      );

      // With twist = 90 degrees (different nib angle)
      const withTwist = computePointAttributes(
        { ...nextPoint, twist: 90 },
        config,
        prevPoint
      );

      // Different nib angles should produce different widths
      expect(noTwist.width).not.toBeCloseTo(withTwist.width, 1);
    });

    it("should not use twist for non-fountain pens", () => {
      const config = getPenConfig("ballpoint");
      const prevPoint = makePoint({ x: 100, y: 200, timestamp: 0 });

      const noTwist = computePointAttributes(
        makePoint({ x: 110, y: 200, timestamp: 8, twist: 0 }),
        config,
        prevPoint
      );
      const withTwist = computePointAttributes(
        makePoint({ x: 110, y: 200, timestamp: 8, twist: 90 }),
        config,
        prevPoint
      );

      // Ballpoint doesn't have nib angle, so twist should have no effect
      expect(noTwist.width).toBeCloseTo(withTwist.width, 5);
    });

    it("should fall back to fixed nibAngle when twist is 0", () => {
      const config = getPenConfig("fountain");
      const prevPoint = makePoint({ x: 100, y: 200, timestamp: 0 });

      // twist = 0 should use config.nibAngle
      const result = computePointAttributes(
        makePoint({ x: 110, y: 200, timestamp: 8, twist: 0 }),
        config,
        prevPoint
      );

      expect(result.width).toBeGreaterThan(0);
      expect(isFinite(result.width)).toBe(true);
    });

    it("should handle various twist angles", () => {
      const config = getPenConfig("fountain");
      const prevPoint = makePoint({ x: 100, y: 200, timestamp: 0 });

      for (const twist of [45, 90, 135, 180, 270, 359]) {
        const result = computePointAttributes(
          makePoint({ x: 110, y: 200, timestamp: 8, twist }),
          config,
          prevPoint
        );
        expect(result.width).toBeGreaterThan(0);
        expect(isFinite(result.width)).toBe(true);
      }
    });
  });

  describe("velocity thinning", () => {
    it("should thin strokes at high velocity", () => {
      const config = getPenConfig("brush");
      const prev = makePoint({ x: 100, y: 200, timestamp: 0 });

      // Slow movement
      const slow = computePointAttributes(
        makePoint({ x: 101, y: 200, timestamp: 100 }),
        config,
        prev
      );
      // Fast movement
      const fast = computePointAttributes(
        makePoint({ x: 200, y: 200, timestamp: 8 }),
        config,
        prev
      );

      expect(fast.width).toBeLessThan(slow.width);
    });
  });

  describe("highlighter", () => {
    it("should have low base opacity", () => {
      const config = getPenConfig("highlighter");
      const attrs = computePointAttributes(makePoint(), config);
      expect(attrs.opacity).toBeCloseTo(0.3, 1);
    });

    it("should have minimal pressure variation", () => {
      const config = getPenConfig("highlighter");
      const lowP = computePointAttributes(makePoint({ pressure: 0.2 }), config);
      const highP = computePointAttributes(makePoint({ pressure: 0.8 }), config);

      // Width ratio should be close to 1 (minimal variation)
      const ratio = highP.width / lowP.width;
      expect(ratio).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThan(1.5);
    });
  });

  describe("all pen types produce valid output", () => {
    const penTypes = Object.keys(PEN_CONFIGS) as (keyof typeof PEN_CONFIGS)[];

    for (const penType of penTypes) {
      it(`${penType}: should produce positive width and valid opacity`, () => {
        const config = PEN_CONFIGS[penType];
        const attrs = computePointAttributes(makePoint(), config);

        expect(attrs.width).toBeGreaterThan(0);
        expect(attrs.opacity).toBeGreaterThanOrEqual(0);
        expect(attrs.opacity).toBeLessThanOrEqual(1);
        expect(isFinite(attrs.width)).toBe(true);
        expect(isFinite(attrs.opacity)).toBe(true);
      });
    }
  });
});
