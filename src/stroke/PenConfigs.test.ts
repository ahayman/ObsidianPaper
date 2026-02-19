import { PEN_CONFIGS, getPenConfig } from "./PenConfigs";
import type { PenConfig } from "./PenConfigs";

describe("PenConfigs", () => {
  const penTypes = Object.keys(PEN_CONFIGS) as (keyof typeof PEN_CONFIGS)[];

  it("should have configs for all 6 pen types", () => {
    expect(penTypes).toHaveLength(6);
    expect(penTypes).toContain("ballpoint");
    expect(penTypes).toContain("brush");
    expect(penTypes).toContain("felt-tip");
    expect(penTypes).toContain("pencil");
    expect(penTypes).toContain("fountain");
    expect(penTypes).toContain("highlighter");
  });

  for (const penType of penTypes) {
    describe(penType, () => {
      let config: PenConfig;

      beforeEach(() => {
        config = getPenConfig(penType);
      });

      it("should have type matching key", () => {
        expect(config.type).toBe(penType);
      });

      it("should have positive base width", () => {
        expect(config.baseWidth).toBeGreaterThan(0);
      });

      it("should have valid pressure width range", () => {
        expect(config.pressureWidthRange).toHaveLength(2);
        expect(config.pressureWidthRange[0]).toBeLessThanOrEqual(
          config.pressureWidthRange[1]
        );
        expect(config.pressureWidthRange[0]).toBeGreaterThan(0);
      });

      it("should have valid opacity", () => {
        expect(config.baseOpacity).toBeGreaterThan(0);
        expect(config.baseOpacity).toBeLessThanOrEqual(1);
      });

      it("should have valid smoothing/streamline/thinning", () => {
        expect(config.smoothing).toBeGreaterThanOrEqual(0);
        expect(config.smoothing).toBeLessThanOrEqual(1);
        expect(config.streamline).toBeGreaterThanOrEqual(0);
        expect(config.streamline).toBeLessThanOrEqual(1);
        expect(config.thinning).toBeGreaterThanOrEqual(0);
        expect(config.thinning).toBeLessThanOrEqual(1);
      });

      it("should have non-negative taper values", () => {
        expect(config.taperStart).toBeGreaterThanOrEqual(0);
        expect(config.taperEnd).toBeGreaterThanOrEqual(0);
      });
    });
  }

  describe("specific pen characteristics", () => {
    it("ballpoint should have narrow width range", () => {
      const config = getPenConfig("ballpoint");
      const range = config.pressureWidthRange[1] - config.pressureWidthRange[0];
      expect(range).toBeLessThan(0.5);
    });

    it("brush should have wide width range", () => {
      const config = getPenConfig("brush");
      const range = config.pressureWidthRange[1] - config.pressureWidthRange[0];
      expect(range).toBeGreaterThan(0.5);
    });

    it("highlighter should use highlighter mode", () => {
      const config = getPenConfig("highlighter");
      expect(config.highlighterMode).toBe(true);
    });

    it("non-highlighter pens should not use highlighter mode", () => {
      for (const type of ["ballpoint", "brush", "felt-tip", "pencil", "fountain"] as const) {
        expect(getPenConfig(type).highlighterMode).toBe(false);
      }
    });

    it("fountain pen should have nib parameters", () => {
      const config = getPenConfig("fountain");
      expect(config.nibAngle).not.toBeNull();
      expect(config.nibThickness).not.toBeNull();
    });

    it("pencil should have tilt sensitivity", () => {
      const config = getPenConfig("pencil");
      expect(config.tiltSensitivity).toBeGreaterThan(0);
    });

    it("pencil should have pressure-opacity mapping", () => {
      const config = getPenConfig("pencil");
      expect(config.pressureOpacityRange).not.toBeNull();
    });
  });
});
