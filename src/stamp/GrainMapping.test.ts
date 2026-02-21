import { grainSliderToConfig, grainConfigKey, grainToTextureStrength, DEFAULT_GRAIN_VALUE } from "./GrainMapping";

describe("grainSliderToConfig", () => {
  it("returns coarse config at t=0", () => {
    const cfg = grainSliderToConfig(0);
    expect(cfg.grainScale).toBeCloseTo(1.0);
    expect(cfg.grainOctaves).toBe(2);
    expect(cfg.falloffExponent).toBeCloseTo(5);
    expect(cfg.edgeSoftness).toBeCloseTo(0.06);
    expect(cfg.grainFloor).toBeCloseTo(0.0);
    expect(cfg.size).toBe(48);
  });

  it("returns fine config at t=1", () => {
    const cfg = grainSliderToConfig(1);
    expect(cfg.grainScale).toBeCloseTo(10);
    expect(cfg.grainOctaves).toBe(4);
    expect(cfg.falloffExponent).toBeCloseTo(8);
    expect(cfg.edgeSoftness).toBeCloseTo(0.03);
    expect(cfg.grainFloor).toBeCloseTo(0.55);
  });

  it("returns 3 octaves at midpoint", () => {
    const cfg = grainSliderToConfig(0.5);
    expect(cfg.grainOctaves).toBe(3);
  });

  it("steps octaves at 0.33 and 0.66 boundaries", () => {
    expect(grainSliderToConfig(0.32).grainOctaves).toBe(2);
    expect(grainSliderToConfig(0.34).grainOctaves).toBe(3);
    expect(grainSliderToConfig(0.65).grainOctaves).toBe(3);
    expect(grainSliderToConfig(0.67).grainOctaves).toBe(4);
  });

  it("clamps out-of-range values", () => {
    const below = grainSliderToConfig(-0.5);
    const zero = grainSliderToConfig(0);
    expect(below.grainScale).toBeCloseTo(zero.grainScale);

    const above = grainSliderToConfig(1.5);
    const one = grainSliderToConfig(1);
    expect(above.grainScale).toBeCloseTo(one.grainScale);
  });

  it("interpolates linearly between endpoints", () => {
    const cfg = grainSliderToConfig(0.5);
    expect(cfg.grainScale).toBeCloseTo(5.5);
    expect(cfg.falloffExponent).toBeCloseTo(6.5);
    expect(cfg.edgeSoftness).toBeCloseTo(0.045);
    expect(cfg.grainFloor).toBeCloseTo(0.275);
  });
});

describe("grainToTextureStrength", () => {
  it("amplifies strength for coarse grain (t=0)", () => {
    const result = grainToTextureStrength(0.5, 0);
    expect(result).toBeCloseTo(0.8);
  });

  it("reduces strength for fine grain (t=1)", () => {
    const result = grainToTextureStrength(0.5, 1);
    expect(result).toBeCloseTo(0.1);
  });

  it("clamps result to 0-1 range", () => {
    expect(grainToTextureStrength(1.0, 0)).toBeLessThanOrEqual(1);
    expect(grainToTextureStrength(0.0, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe("grainConfigKey", () => {
  it("produces deterministic keys", () => {
    const cfg = grainSliderToConfig(0.5);
    const key1 = grainConfigKey(cfg);
    const key2 = grainConfigKey(cfg);
    expect(key1).toBe(key2);
  });

  it("produces different keys for different configs", () => {
    const key0 = grainConfigKey(grainSliderToConfig(0));
    const key1 = grainConfigKey(grainSliderToConfig(1));
    expect(key0).not.toBe(key1);
  });
});

describe("DEFAULT_GRAIN_VALUE", () => {
  it("is between 0 and 1", () => {
    expect(DEFAULT_GRAIN_VALUE).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_GRAIN_VALUE).toBeLessThanOrEqual(1);
  });

  it("equals 0.35", () => {
    expect(DEFAULT_GRAIN_VALUE).toBe(0.35);
  });
});
