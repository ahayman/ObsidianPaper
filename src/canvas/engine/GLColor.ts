/**
 * Hex color string → premultiplied RGBA Float32Array.
 * WebGL works with premultiplied alpha throughout the pipeline.
 */

// Cached parsed colors to avoid repeated parsing
const colorCache = new Map<string, Float32Array>();

/**
 * Parse a hex color string to premultiplied RGBA Float32Array.
 * Supports #RGB, #RRGGBB, #RRGGBBAA formats.
 */
export function parseColor(hex: string, alpha: number = 1): Float32Array {
  const key = `${hex}:${alpha}`;
  const cached = colorCache.get(key);
  if (cached) return cached;

  const raw = parseHexRaw(hex);
  // Premultiply: RGB channels multiplied by alpha
  const a = raw[3] * alpha;
  const result = new Float32Array([raw[0] * a, raw[1] * a, raw[2] * a, a]);
  colorCache.set(key, result);
  return result;
}

/**
 * Parse hex color to straight (non-premultiplied) RGBA [0-1].
 */
function parseHexRaw(hex: string): [number, number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16) / 255;
    const g = parseInt(h[1] + h[1], 16) / 255;
    const b = parseInt(h[2] + h[2], 16) / 255;
    return [r, g, b, 1];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return [r, g, b, 1];
  }
  if (h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = parseInt(h.slice(6, 8), 16) / 255;
    return [r, g, b, a];
  }
  // Fallback: opaque black
  return [0, 0, 0, 1];
}

/**
 * Clear the color cache (for testing or when memory is tight).
 */
export function clearColorCache(): void {
  colorCache.clear();
}
