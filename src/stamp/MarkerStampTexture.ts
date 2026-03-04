/**
 * Marker stamp texture for felt-tip pen rendering.
 *
 * Generates a rounded rectangle stamp with:
 * - SDF-based chisel/rectangular shape
 * - Anisotropic fiber texture (subtle streaks along the major axis)
 * - Noise-displaced edges for organic/fibrous look
 *
 * The texture is square (textureSize × textureSize). The rounded rectangle
 * is centered and fills the texture with the configured aspect ratio.
 * Corners outside the shape are transparent.
 *
 * Output uses white RGB + alpha channel (same format as InkStampTexture).
 * Color is applied at draw time by the rendering backend.
 */

import { createNoise4D } from "simplex-noise";

export interface MarkerStampTextureConfig {
  /** Size of the stamp texture in pixels (default 64) */
  size: number;
  /** Aspect ratio: width/height of the rounded rectangle (default 3.0) */
  aspectRatio: number;
  /** Corner radius as fraction of minor axis (0-1, default 0.3) */
  cornerRadius: number;
  /** Fiber texture density (0-1, default 0.5) */
  fiberDensity: number;
  /** Edge fuzziness amount (0-1, default 0.3) */
  edgeFuzziness: number;
}

export const DEFAULT_MARKER_STAMP_CONFIG: MarkerStampTextureConfig = {
  size: 128,
  aspectRatio: 3.0,
  cornerRadius: 0.3,
  fiberDensity: 0.5,
  edgeFuzziness: 0.3,
};

/**
 * Signed distance function for a rounded rectangle.
 * @param px - X coordinate relative to center
 * @param py - Y coordinate relative to center
 * @param halfW - Half-width of the rectangle
 * @param halfH - Half-height of the rectangle
 * @param r - Corner radius
 * @returns Signed distance (negative = inside, positive = outside)
 */
function sdRoundedBox(px: number, py: number, halfW: number, halfH: number, r: number): number {
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  const outerDist = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2);
  const innerDist = Math.min(Math.max(qx, qy), 0);
  return outerDist + innerDist - r;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Generate a marker stamp texture as ImageData.
 *
 * The rounded rectangle is oriented horizontally (major axis = X).
 * When rendered, each stamp instance is rotated to follow stroke direction.
 */
export function generateMarkerStampImageData(
  config?: Partial<MarkerStampTextureConfig>,
): ImageData {
  const cfg: MarkerStampTextureConfig = { ...DEFAULT_MARKER_STAMP_CONFIG, ...config };
  const { size, aspectRatio, cornerRadius, fiberDensity, edgeFuzziness } = cfg;

  const imageData = new ImageData(size, size);
  const data = imageData.data;

  // Use two independent noise generators: one for fiber, one for edge
  const noiseEdge = createNoise4D();
  const noiseFiber = createNoise4D();

  const center = size / 2;

  // The rectangle fits within the square texture.
  // Major axis (width) fills most of the texture width.
  // Minor axis (height) = major / aspectRatio.
  const margin = 2; // Pixel margin for AA
  const halfW = (size / 2 - margin) * 0.95; // Major axis half-width
  const halfH = halfW / aspectRatio;         // Minor axis half-height
  const cornerR = cornerRadius * halfH;       // Absolute corner radius

  const TWO_PI = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x - center + 0.5;
      const py = y - center + 0.5;

      // Base SDF distance
      let dist = sdRoundedBox(px, py, halfW, halfH, cornerR);

      // Edge noise displacement — makes edges fibrous/organic
      if (edgeFuzziness > 0) {
        // 4D torus-mapped noise for seamless tiling
        const angleX = (x / size) * TWO_PI;
        const angleY = (y / size) * TWO_PI;
        const freq = 8.0;
        const nx = Math.cos(angleX) * freq;
        const ny = Math.sin(angleX) * freq;
        const nz = Math.cos(angleY) * freq;
        const nw = Math.sin(angleY) * freq;
        const edgeNoise = noiseEdge(nx, ny, nz, nw);
        // Fixed pixel displacement (~1-2px) independent of shape size
        dist += edgeNoise * edgeFuzziness * 1.5;
      }

      // Very wide smooth alpha from SDF — stamps must blend seamlessly since the
      // outline mask (not the stamp edge) defines the visible stroke boundary.
      // The transition spans ~65% of the minor axis half-height so adjacent stamps
      // have wide overlap zones that composite to uniform coverage.
      const edgeAlpha = 1.0 - smoothstep(-halfH * 0.5, halfH * 0.15, dist);
      if (edgeAlpha < 0.001) {
        const idx = (y * size + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 0;
        continue;
      }

      // Fiber texture — anisotropic noise stretched along the major axis
      let fiberMod = 1.0;
      if (fiberDensity > 0) {
        // Stretch noise along X (major axis) by using different frequencies
        const fiberAngleX = (x / size) * TWO_PI;
        const fiberAngleY = (y / size) * TWO_PI;
        // Low frequency along X, high frequency along Y → horizontal streaks
        const fiberFreqX = 3.0;
        const fiberFreqY = 12.0 + fiberDensity * 8.0;
        const fnx = Math.cos(fiberAngleX) * fiberFreqX;
        const fny = Math.sin(fiberAngleX) * fiberFreqX;
        const fnz = Math.cos(fiberAngleY) * fiberFreqY;
        const fnw = Math.sin(fiberAngleY) * fiberFreqY;
        const fiberNoise = (noiseFiber(fnx, fny, fnz, fnw) + 1) * 0.5; // 0-1

        // Subtle modulation: 85-100% opacity range
        const modStrength = 0.15 * fiberDensity;
        fiberMod = 1.0 - modStrength + modStrength * fiberNoise;
      }

      // Slight pressure falloff from center (marker deposits more ink at center)
      const normDx = px / halfW;
      const normDy = py / halfH;
      const centerDist = Math.sqrt(normDx * normDx + normDy * normDy);
      const pressureFalloff = 1.0 - 0.08 * centerDist * centerDist;

      const alpha = edgeAlpha * fiberMod * pressureFalloff;
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
 * Generate a marker stamp texture as an OffscreenCanvas.
 */
export function generateMarkerStampTexture(
  config?: Partial<MarkerStampTextureConfig>,
): OffscreenCanvas {
  const imageData = generateMarkerStampImageData(config);
  return markerStampFromImageData(imageData);
}

/**
 * Reconstruct an OffscreenCanvas from ImageData.
 */
export function markerStampFromImageData(imageData: ImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context for marker stamp texture");
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Generate a tileable fiber overlay texture.
 *
 * This is a standalone noise pattern (no SDF shape) that can be tiled as a
 * repeating pattern and applied via destination-out to add visible fiber
 * streaks to the accumulated stamp coverage.
 *
 * The texture uses extremely anisotropic noise (very low X frequency, high Y
 * frequency) to produce clear horizontal streaks. Multi-octave noise adds
 * fine detail and a contrast curve sharpens the streaks so they appear as
 * distinct fiber lines rather than smooth gradients.
 *
 * Applied as a post-processing step AFTER stamp accumulation (which washes
 * out per-stamp fiber detail) and BEFORE the outline mask.
 */
export function generateFiberOverlayCanvas(
  size: number = 128,
  fiberDensity: number = 0.5,
): OffscreenCanvas {
  const imageData = new ImageData(size, size);
  const data = imageData.data;
  const noise1 = createNoise4D();
  const noise2 = createNoise4D();
  const TWO_PI = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Torus-mapped 4D noise for seamless tiling
      const ax = (x / size) * TWO_PI;
      const ay = (y / size) * TWO_PI;
      const cx = Math.cos(ax);
      const sx = Math.sin(ax);
      const cy = Math.cos(ay);
      const sy = Math.sin(ay);

      // Octave 1: extremely anisotropic — very broad X, fine Y → wide horizontal streaks
      const fxFreq1 = 1.0;
      const fyFreq1 = 16.0 + fiberDensity * 12.0;
      const v1 = (noise1(cx * fxFreq1, sx * fxFreq1, cy * fyFreq1, sy * fyFreq1) + 1) * 0.5;

      // Octave 2: higher frequency adds variation within streaks
      const fxFreq2 = 2.5;
      const fyFreq2 = 28.0 + fiberDensity * 16.0;
      const v2 = (noise2(cx * fxFreq2, sx * fxFreq2, cy * fyFreq2, sy * fyFreq2) + 1) * 0.5;

      // Blend octaves: primary determines streak structure, secondary adds fine detail
      let val = v1 * 0.7 + v2 * 0.3;

      // Sharpen: contrast curve pushes values toward 0 or 1 for distinct streaks
      // Apply smoothstep twice for S-curve sharpening
      val = val * val * (3 - 2 * val); // smoothstep 0→1
      val = val * val * (3 - 2 * val); // double smoothstep for sharper transition

      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(val * 255);
    }
  }

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context for fiber overlay");
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
