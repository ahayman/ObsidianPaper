import { createNoise4D } from "simplex-noise";

/**
 * Configuration for stamp texture generation.
 */
export interface StampTextureConfig {
  /** Size of the stamp texture in pixels (default 48) */
  size: number;
  /** Noise frequency scale for grain modulation (default 6) */
  grainScale: number;
  /** Number of noise octaves (default 2) */
  grainOctaves: number;
  /** Radial falloff exponent — higher = sharper edges (default 2.2) */
  falloffExponent: number;
  /** Edge softness — width of the soft border (default 0.15) */
  edgeSoftness: number;
  /** Grain floor — minimum grain modulation value (default 0.15) */
  grainFloor: number;
}

export const DEFAULT_STAMP_CONFIG: StampTextureConfig = {
  size: 48,
  grainScale: 4.5,
  grainOctaves: 3,
  falloffExponent: 6,
  edgeSoftness: 0.05,
  grainFloor: 0.15,
};

/**
 * Generate a stamp texture as an OffscreenCanvas.
 * The stamp is a white circle with alpha encoding density:
 * - Radial falloff from center to edge
 * - Grain modulation via 4D simplex noise (torus-mapped for seamless tiling)
 *
 * RGBA = (255, 255, 255, computed_alpha)
 */
export function generateStampTexture(
  config?: Partial<StampTextureConfig>,
): OffscreenCanvas {
  const imageData = generateStampImageData(config);
  return stampFromImageData(imageData);
}

/**
 * Generate stamp texture as ImageData for transferring to workers.
 */
export function generateStampImageData(
  config?: Partial<StampTextureConfig>,
): ImageData {
  const cfg: StampTextureConfig = { ...DEFAULT_STAMP_CONFIG, ...config };
  const { size, grainScale, grainOctaves, falloffExponent, edgeSoftness, grainFloor } = cfg;

  const imageData = new ImageData(size, size);
  const data = imageData.data;
  const noise4D = createNoise4D();

  const center = size / 2;
  const radius = size / 2;
  const TWO_PI = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Distance from center, normalized to 0-1
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = dist / radius;

      // Radial falloff with soft edge
      let falloff: number;
      if (r >= 1) {
        falloff = 0;
      } else {
        // Core falloff
        falloff = 1 - Math.pow(r, falloffExponent);
        // Soft edge near boundary
        if (r > 1 - edgeSoftness) {
          const edgeT = (r - (1 - edgeSoftness)) / edgeSoftness;
          // Smoothstep fade
          const fade = 1 - edgeT * edgeT * (3 - 2 * edgeT);
          falloff *= fade;
        }
      }

      // Grain modulation via simplex noise (torus-mapped)
      const angleX = (x / size) * TWO_PI;
      const angleY = (y / size) * TWO_PI;

      let noiseVal = 0;
      let amplitude = 1;
      let frequency = grainScale;
      let totalAmplitude = 0;

      for (let o = 0; o < grainOctaves; o++) {
        const nx = Math.cos(angleX) * frequency;
        const ny = Math.sin(angleX) * frequency;
        const nz = Math.cos(angleY) * frequency;
        const nw = Math.sin(angleY) * frequency;

        noiseVal += noise4D(nx, ny, nz, nw) * amplitude;
        totalAmplitude += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }

      // Normalize to 0-1
      const grain = ((noiseVal / totalAmplitude) + 1) * 0.5;

      // Combine: modulate falloff by grain (grainFloor to 1.0 range for visible texture)
      const grainMod = grainFloor + grain * (1 - grainFloor);
      const alpha = Math.round(falloff * grainMod * 255);

      const idx = (y * size + x) * 4;
      data[idx] = 255;     // R — white
      data[idx + 1] = 255; // G
      data[idx + 2] = 255; // B
      data[idx + 3] = Math.max(0, Math.min(255, alpha)); // A
    }
  }

  return imageData;
}

/**
 * Reconstruct an OffscreenCanvas stamp from ImageData (worker-side).
 */
export function stampFromImageData(imageData: ImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context for stamp texture");
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
