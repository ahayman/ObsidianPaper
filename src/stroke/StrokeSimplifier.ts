import type { StrokePoint } from "../types";

/**
 * LOD levels for stroke simplification.
 * Higher levels use more aggressive simplification.
 */
export type LodLevel = 0 | 1 | 2 | 3;

/**
 * RDP epsilon values for each LOD level.
 * Level 0: full detail (no simplification)
 * Level 1: light simplification (zoom 0.25-0.5x)
 * Level 2: heavy simplification (zoom 0.1-0.25x)
 * Level 3: minimal rendering (zoom < 0.1x)
 */
const LOD_EPSILON: Record<LodLevel, number> = {
  0: 0,
  1: 2,
  2: 5,
  3: Infinity, // Level 3 uses start-to-end line only
};

/**
 * Select the appropriate LOD level based on camera zoom.
 */
export function selectLodLevel(zoom: number): LodLevel {
  if (zoom >= 0.5) return 0;
  if (zoom >= 0.25) return 1;
  if (zoom >= 0.1) return 2;
  return 3;
}

/**
 * Generate a cache key for a stroke at a given LOD level.
 */
export function lodCacheKey(strokeId: string, lod: LodLevel): string {
  if (lod === 0) return strokeId;
  return `${strokeId}-lod${lod}`;
}

/**
 * Simplify stroke points using the Ramer-Douglas-Peucker algorithm.
 * Returns a subset of the original points that approximates the curve
 * within the given epsilon tolerance.
 *
 * For LOD level 3, returns only the first and last points.
 */
export function simplifyPoints(
  points: readonly StrokePoint[],
  lod: LodLevel
): StrokePoint[] {
  if (points.length <= 2) return [...points];

  if (lod === 0) return [...points];

  if (lod === 3) {
    // Minimal: just start and end points
    return [points[0], points[points.length - 1]];
  }

  const epsilon = LOD_EPSILON[lod];
  return rdpSimplify(points, epsilon);
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 * Iterative implementation to avoid stack overflow on large stroke arrays.
 */
export function rdpSimplify(
  points: readonly StrokePoint[],
  epsilon: number
): StrokePoint[] {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative stack-based RDP
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;

    let maxDist = 0;
    let maxIndex = start;

    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistance(
        points[i].x,
        points[i].y,
        points[start].x,
        points[start].y,
        points[end].x,
        points[end].y
      );
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > epsilon) {
      keep[maxIndex] = 1;
      if (maxIndex - start > 1) stack.push([start, maxIndex]);
      if (end - maxIndex > 1) stack.push([maxIndex, end]);
    }
  }

  const result: StrokePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Perpendicular distance from point (px, py) to line segment (ax, ay)-(bx, by).
 */
function perpendicularDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment
    const dpx = px - ax;
    const dpy = py - ay;
    return Math.sqrt(dpx * dpx + dpy * dpy);
  }

  const area = Math.abs(dy * px - dx * py + bx * ay - by * ax);
  return area / Math.sqrt(lenSq);
}
