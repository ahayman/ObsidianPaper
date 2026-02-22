/**
 * Ink stamp texture for fountain pen rendering.
 *
 * Nearly solid circle with a thin anti-aliased edge. When overlapping stamps
 * build up via source-over compositing, the result approximates a solid stroke
 * with subtle texture from grain modulation and opacity variation.
 *
 * Edge darkening is applied as a very gentle brightness ramp (outer pixels
 * slightly darker) rather than a visible donut/ring, so pooling areas don't
 * show halos.
 */

import { createNoise4D } from "simplex-noise";

export interface InkStampTextureConfig {
  /** Size of the stamp texture in pixels (default 64) */
  size: number;
  /** Subtle edge darkening 0-1 (very gentle center lightening) */
  edgeDarkening: number;
  /** Paper grain modulation 0-1 (from InkPresetConfig.grainInfluence) */
  grainInfluence: number;
}

export const DEFAULT_INK_STAMP_CONFIG: InkStampTextureConfig = {
  size: 64,
  edgeDarkening: 0.4,
  grainInfluence: 0.25,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Generate an ink stamp texture as ImageData.
 * Nearly solid circle with thin AA edge and subtle grain modulation.
 */
export function generateInkStampImageData(
  config?: Partial<InkStampTextureConfig>,
): ImageData {
  const cfg: InkStampTextureConfig = { ...DEFAULT_INK_STAMP_CONFIG, ...config };
  const { size, edgeDarkening, grainInfluence } = cfg;

  const imageData = new ImageData(size, size);
  const data = imageData.data;
  const noise4D = createNoise4D();

  const center = size / 2;
  const radius = size / 2;
  // Gaussian sigma as fraction of radius — controls how soft the stamp edges are.
  // 0.45 gives: center=1.0, mid(r=0.5)≈0.72, edge(r=0.8)≈0.30, boundary(r=1.0)≈0.08
  const SIGMA = 0.45;
  const twoSigmaSq = 2 * SIGMA * SIGMA;
  const TWO_PI = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= radius) {
        const idx = (y * size + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 0;
        continue;
      }

      // Gaussian falloff: smooth fade from center (1.0) to edge (~0.08).
      // Overlapping stamps merge gradually instead of stacking hard edges.
      const r = dist / radius;
      let alpha = Math.exp(-r * r / twoSigmaSq);

      // Grain modulation via 4D simplex noise (torus-mapped for seamless tiling)
      if (grainInfluence > 0) {
        const angleX = (x / size) * TWO_PI;
        const angleY = (y / size) * TWO_PI;
        const frequency = 4.0;
        const nx = Math.cos(angleX) * frequency;
        const ny = Math.sin(angleX) * frequency;
        const nz = Math.cos(angleY) * frequency;
        const nw = Math.sin(angleY) * frequency;
        const grain = (noise4D(nx, ny, nz, nw) + 1) * 0.5; // 0-1
        alpha *= 1.0 - grainInfluence + grainInfluence * grain;
      }

      const alphaInt = Math.round(Math.max(0, Math.min(255, alpha * 255)));
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = alphaInt;
    }
  }

  return imageData;
}

/**
 * Generate an ink stamp texture as an OffscreenCanvas.
 */
export function generateInkStampTexture(
  config?: Partial<InkStampTextureConfig>,
): OffscreenCanvas {
  const imageData = generateInkStampImageData(config);
  return inkStampFromImageData(imageData);
}

/**
 * Reconstruct an OffscreenCanvas from ImageData (worker-side).
 */
export function inkStampFromImageData(imageData: ImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context for ink stamp texture");
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
