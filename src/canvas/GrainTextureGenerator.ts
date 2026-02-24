import { createNoise4D } from "simplex-noise";

export interface GrainConfig {
  /** Size of the tileable noise texture in pixels (default 256) */
  tileSize: number;
  /** Noise frequency scale — controls cluster size (default 10) */
  scale: number;
  /** Number of noise octaves for detail (default 3) */
  octaves: number;
  /** Threshold for dot formation: lower = denser dots, higher = sparser (default 0.55) */
  threshold: number;
  /** Softness of dot edges: lower = sharper dots, higher = softer (default 0.1) */
  softness: number;
}

const DEFAULT_GRAIN_CONFIG: GrainConfig = {
  tileSize: 256,
  scale: 10,
  octaves: 3,
  threshold: 0.55,
  softness: 0.1,
};

/**
 * Generates a tileable grain noise texture using simplex noise with 4D torus mapping.
 * The texture tiles seamlessly and can be used as a CanvasPattern for pencil/brush grain effects.
 */
export class GrainTextureGenerator {
  private config: GrainConfig;
  private tileCanvas: HTMLCanvasElement | null = null;
  private initialized = false;

  constructor(config?: Partial<GrainConfig>) {
    this.config = { ...DEFAULT_GRAIN_CONFIG, ...config };
  }

  /**
   * Generate the tileable noise texture on a hidden canvas.
   * Uses 4D torus mapping: maps (x, y) to a circle in 4D space so the
   * texture tiles seamlessly in both dimensions.
   */
  initialize(): void {
    const { tileSize, scale, octaves, threshold, softness } = this.config;

    const canvas = document.createElement("canvas");
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context for grain texture");

    const imageData = ctx.createImageData(tileSize, tileSize);
    const data = imageData.data;
    const noise4D = createNoise4D();

    const TWO_PI = Math.PI * 2;

    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        // Map (x, y) to angles around a torus in 4D space for seamless tiling
        const angleX = (x / tileSize) * TWO_PI;
        const angleY = (y / tileSize) * TWO_PI;

        let value = 0;
        let amplitude = 1;
        let frequency = scale;
        let totalAmplitude = 0;

        for (let o = 0; o < octaves; o++) {
          // 4D torus coordinates: two circles embedded in 4D
          const nx = Math.cos(angleX) * frequency;
          const ny = Math.sin(angleX) * frequency;
          const nz = Math.cos(angleY) * frequency;
          const nw = Math.sin(angleY) * frequency;

          value += noise4D(nx, ny, nz, nw) * amplitude;
          totalAmplitude += amplitude;
          amplitude *= 0.5;
          frequency *= 2;
        }

        // Normalize to 0-1 range
        value = ((value / totalAmplitude) + 1) * 0.5; // -1..1 -> 0..1

        // Create dot clusters via smoothstep threshold.
        // The multi-octave noise naturally forms spatial clusters (nearby
        // values are similar), so thresholding produces groups of dots
        // with clear gaps — like graphite particles clumping on paper fiber peaks.
        //
        // Below threshold → dot (graphite deposited) → low alpha (don't remove)
        // Above threshold → gap (paper showing)      → high alpha (remove stroke)
        const lo = threshold - softness;
        const hi = threshold + softness;
        const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
        // Smoothstep for soft dot edges (not pixel-sharp, not blurry)
        const alpha = Math.round(t * t * (3 - 2 * t) * 255);

        const idx = (y * tileSize + x) * 4;
        data[idx] = 0;         // R — black (color irrelevant for destination-out)
        data[idx + 1] = 0;     // G
        data[idx + 2] = 0;     // B
        data[idx + 3] = alpha; // A — 0 = graphite dot, 255 = paper gap
      }
    }

    ctx.putImageData(imageData, 0, 0);
    this.tileCanvas = canvas;
    this.initialized = true;
  }

  /**
   * Get a CanvasPattern from the generated tile for the given rendering context.
   * Returns null if not yet initialized.
   */
  getPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (!this.initialized || !this.tileCanvas) return null;

    const pattern = ctx.createPattern(this.tileCanvas, "repeat");
    return pattern;
  }

  /**
   * Get the raw pixel data of the grain texture tile.
   * Returns 256x256 RGBA ImageData (256KB) for transfer to Web Workers.
   * Returns null if not yet initialized.
   */
  getImageData(): ImageData | null {
    if (!this.initialized || !this.tileCanvas) return null;
    const ctx = this.tileCanvas.getContext("2d");
    if (!ctx) return null;
    return ctx.getImageData(0, 0, this.config.tileSize, this.config.tileSize);
  }

  /**
   * Get the grain texture as an HTMLCanvasElement for WebGL texture upload.
   * Returns null if not yet initialized.
   */
  getCanvas(): HTMLCanvasElement | null {
    if (!this.initialized || !this.tileCanvas) return null;
    return this.tileCanvas;
  }

  /**
   * Whether the generator has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Clean up the hidden canvas.
   */
  destroy(): void {
    this.tileCanvas = null;
    this.initialized = false;
  }
}
