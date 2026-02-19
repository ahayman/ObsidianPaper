/**
 * 1-Euro Filter implementation for jitter reduction.
 *
 * Adaptive low-pass filter that adjusts cutoff frequency based on speed:
 * - Slow movement → lower cutoff → more smoothing (reduces jitter)
 * - Fast movement → higher cutoff → less lag (preserves responsiveness)
 *
 * Reference: Casiez et al., "1€ Filter: A Simple Speed-based Low-pass Filter
 * for Noisy Input in Interactive Systems", CHI 2012.
 */

export interface OneEuroFilterConfig {
  /** Minimum cutoff frequency in Hz. Lower = more smoothing at low speeds. Default: 1.0 */
  minCutoff: number;
  /** Speed coefficient. Higher = less smoothing at high speeds. Default: 0.007 */
  beta: number;
  /** Cutoff frequency for derivative computation in Hz. Default: 1.0 */
  dCutoff: number;
}

const DEFAULT_CONFIG: OneEuroFilterConfig = {
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
};

/**
 * Low-pass filter using exponential smoothing.
 */
class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.s === null) {
      this.s = value;
    } else {
      this.s = alpha * value + (1 - alpha) * this.s;
    }
    this.y = value;
    return this.s;
  }

  lastValue(): number | null {
    return this.y;
  }

  lastSmoothed(): number | null {
    return this.s;
  }

  reset(): void {
    this.y = null;
    this.s = null;
  }
}

/**
 * Compute the smoothing factor alpha from the cutoff frequency and sample rate.
 */
function smoothingFactor(rate: number, cutoff: number): number {
  const tau = 1.0 / (2 * Math.PI * cutoff);
  const te = 1.0 / rate;
  return 1.0 / (1.0 + tau / te);
}

/**
 * 1-Euro filter for a single axis (x or y).
 */
export class OneEuroFilter {
  private config: OneEuroFilterConfig;
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTimestamp: number | null = null;

  constructor(config?: Partial<OneEuroFilterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Filter a value at the given timestamp (in milliseconds).
   */
  filter(value: number, timestamp: number): number {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
      // First sample: just initialize
      this.dxFilter.filter(0, smoothingFactor(120, this.config.dCutoff));
      return this.xFilter.filter(value, 1.0);
    }

    const dt = (timestamp - this.lastTimestamp) / 1000; // Convert to seconds
    this.lastTimestamp = timestamp;

    if (dt <= 0) {
      // Same timestamp: return last filtered value
      return this.xFilter.lastSmoothed() ?? value;
    }

    const rate = 1.0 / dt;

    // Estimate derivative (speed)
    const prevFiltered = this.xFilter.lastSmoothed() ?? value;
    const dx = (value - prevFiltered) / dt;
    const edx = this.dxFilter.filter(
      dx,
      smoothingFactor(rate, this.config.dCutoff)
    );

    // Adaptive cutoff based on speed
    const cutoff = this.config.minCutoff + this.config.beta * Math.abs(edx);
    const alpha = smoothingFactor(rate, cutoff);

    return this.xFilter.filter(value, alpha);
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTimestamp = null;
  }
}

/**
 * Simple Exponential Moving Average filter for pressure/tilt channels.
 */
export class EMAFilter {
  private alpha: number;
  private lastValue: number | null = null;

  constructor(alpha = 0.3) {
    this.alpha = alpha;
  }

  filter(value: number): number {
    if (this.lastValue === null) {
      this.lastValue = value;
      return value;
    }
    this.lastValue = this.alpha * value + (1 - this.alpha) * this.lastValue;
    return this.lastValue;
  }

  reset(): void {
    this.lastValue = null;
  }
}
