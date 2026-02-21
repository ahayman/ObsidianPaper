import type { StampTextureConfig } from "./StampTexture";

/**
 * Default grain slider value — approximates the current hardcoded behavior.
 */
export const DEFAULT_GRAIN_VALUE = 0.35;

/**
 * Linearly interpolate between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Map a 0-1 grain slider value to full StampTextureConfig parameters.
 *
 * t=0 (Coarsest): Large noise blobs, high contrast, lots of paper showing through.
 *                 Low grainFloor means alpha can drop to 0 within the stamp.
 *                 Low falloff exponent = softer falloff = visible individual stamps.
 * t=1 (Finest):   Small smooth noise, low contrast, dense fill.
 *                 High grainFloor ensures minimum alpha stays high (dense coverage).
 *                 High falloff exponent = sharp-edged dense dots.
 */
export function grainSliderToConfig(t: number): StampTextureConfig {
  const clamped = Math.max(0, Math.min(1, t));

  // grainOctaves: stepped at 0.33 and 0.66
  let grainOctaves: number;
  if (clamped < 0.33) {
    grainOctaves = 2;
  } else if (clamped < 0.66) {
    grainOctaves = 3;
  } else {
    grainOctaves = 4;
  }

  return {
    size: 48,
    grainScale: lerp(1.0, 10, clamped),
    grainOctaves,
    // Hard edges across the entire range — stamps should look like crisp dots
    // High exponent = nearly flat center that drops sharply at the edge
    falloffExponent: lerp(5, 8, clamped),
    // Minimal edge softness for crisp boundaries
    edgeSoftness: lerp(0.06, 0.03, clamped),
    // grainFloor controls internal texture: 0 = rough edges, 0.55 = solid fill
    grainFloor: lerp(0.0, 0.55, clamped),
  };
}

/**
 * Map a grain slider value to a strength multiplier for the "textures" pipeline.
 *
 * grain=0 (coarse) → heavy texture overlay (strength × 1.6)
 * grain=DEFAULT (0.35) → approximately 1.0 (unchanged)
 * grain=1 (fine) → very light texture (strength × 0.2)
 *
 * This lets the grain slider affect pencil rendering in the textures pipeline
 * by modulating how much paper grain shows through.
 */
export function grainToTextureStrength(baseStrength: number, grainValue: number): number {
  const clamped = Math.max(0, Math.min(1, grainValue));
  // Multiplier: 1.6 at grain=0 → 1.0 at grain≈0.35 → 0.2 at grain=1
  const multiplier = lerp(1.6, 0.2, clamped);
  return Math.max(0, Math.min(1, baseStrength * multiplier));
}

/**
 * Deterministic cache key for a StampTextureConfig.
 * Two configs with the same key produce identical textures.
 */
export function grainConfigKey(config: StampTextureConfig): string {
  return `${config.size}:${config.grainScale.toFixed(3)}:${config.grainOctaves}:${config.falloffExponent.toFixed(3)}:${config.edgeSoftness.toFixed(3)}:${config.grainFloor.toFixed(3)}`;
}
