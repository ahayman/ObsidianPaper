import type { StrokePoint } from "../types";
import { rdpSimplify } from "./StrokeSimplifier";

export interface ItalicNibConfig {
  nibWidth: number;        // Major axis (base stroke width)
  nibHeight: number;       // Minor axis (nibWidth * nibThickness)
  nibAngle: number;        // Radians, from PenStyle or barrel rotation
  useBarrelRotation: boolean;
  pressureCurve: number;   // Gamma exponent
  pressureWidthRange: [number, number];
  widthSmoothing: number;  // 0-1, controls EMA blend for width transitions
  taperStart: number;      // Taper distance at stroke start (world units)
  taperEnd: number;        // Taper distance at stroke end (world units)
}

export interface ItalicOutlineSides {
  leftSide: number[][];
  rightSide: number[][];
}

/**
 * Generate left/right side arrays for an italic nib stroke.
 * Returns the two sides separately so callers can build quad-per-segment
 * geometry (which avoids self-intersection artifacts in the nonzero winding fill).
 */
export function generateItalicOutlineSides(
  points: readonly StrokePoint[],
  config: ItalicNibConfig,
  dejitter: boolean = true,
): ItalicOutlineSides | null {
  if (points.length === 0) return null;

  // Single point → no sides (use generateItalicOutline for dot)
  if (points.length === 1) return null;

  // Light RDP de-jitter: removes only the most egregious hand tremor
  // while preserving subtle edge variation that mimics paper texture.
  const dejittered = (dejitter && points.length > 2)
    ? rdpSimplify(points, 0.00125)
    : points;

  // Precompute nib unit vector (static angle case)
  const staticNx = Math.cos(config.nibAngle);
  const staticNy = Math.sin(config.nibAngle);

  // Compute cumulative arc length for taper
  const arcLengths = computeArcLengths(dejittered);
  const totalLength = arcLengths[arcLengths.length - 1];

  // First pass: compute perpendicular directions and widths per point.
  const centers: { x: number; y: number }[] = [];
  const perps: { x: number; y: number }[] = [];
  const halfWidths: number[] = [];

  let prevWidth = 0;
  const [minW, maxW] = config.pressureWidthRange;

  for (let i = 0; i < dejittered.length; i++) {
    const p = dejittered[i];

    // Stroke direction via symmetric central difference over ±2 points.
    let dx: number, dy: number;
    const back = Math.max(0, i - 2);
    const fwd = Math.min(dejittered.length - 1, i + 2);
    dx = dejittered[fwd].x - dejittered[back].x;
    dy = dejittered[fwd].y - dejittered[back].y;

    const len = Math.hypot(dx, dy);

    // Skip near-zero segments (carry forward previous values)
    if (len < 0.001 && i > 0 && i < dejittered.length - 1) {
      if (centers.length > 0) {
        centers.push({ x: p.x, y: p.y });
        perps.push({ ...perps[perps.length - 1] });
        halfWidths.push(halfWidths[halfWidths.length - 1]);
      }
      continue;
    }

    const sx = len > 0.001 ? dx / len : 0;
    const sy = len > 0.001 ? dy / len : 1;

    // Nib unit vector — per-point if barrel rotation is active
    let nx = staticNx;
    let ny = staticNy;
    if (config.useBarrelRotation && p.twist !== 0) {
      const dynamicAngle = (p.twist * Math.PI) / 180;
      nx = Math.cos(dynamicAngle);
      ny = Math.sin(dynamicAngle);
    }

    // Cross-product projection: |sin(nibAngle - strokeAngle)|
    const crossMag = Math.abs(nx * sy - ny * sx);

    // Raw projected width
    let rawWidth = config.nibWidth * crossMag + config.nibHeight * (1 - crossMag);

    // Apply pressure
    const pressure = Math.pow(Math.max(0, Math.min(1, p.pressure)), config.pressureCurve);
    rawWidth *= lerp(minW, maxW, pressure);

    // Width smoothing (EMA)
    let smoothedWidth: number;
    if (i === 0) {
      smoothedWidth = rawWidth;
    } else {
      const alpha = config.widthSmoothing;
      smoothedWidth = prevWidth * (1 - alpha) + rawWidth * alpha;
    }

    // Minimum floor: never go below half the nib thickness
    smoothedWidth = Math.max(config.nibHeight * 0.5, smoothedWidth);

    // Taper at start/end
    if (config.taperStart > 0) {
      const startFactor = Math.min(1, arcLengths[i] / config.taperStart);
      smoothedWidth *= startFactor;
    }
    if (config.taperEnd > 0) {
      const remaining = totalLength - arcLengths[i];
      const endFactor = Math.min(1, remaining / config.taperEnd);
      smoothedWidth *= endFactor;
    }

    prevWidth = smoothedWidth;

    centers.push({ x: p.x, y: p.y });
    perps.push({ x: -sy, y: sx });
    halfWidths.push(smoothedWidth / 2);
  }

  if (centers.length < 2) return null;

  // Second pass: eliminate width dips at corners.
  if (halfWidths.length >= 3) {
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let i = 1; i < halfWidths.length - 1; i++) {
        const neighborAvg = (halfWidths[i - 1] + halfWidths[i + 1]) / 2;
        if (halfWidths[i] < neighborAvg) {
          halfWidths[i] = neighborAvg;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // Third pass: enforce perpendicular consistency.
  // Compare each perpendicular to its predecessor (sliding reference).
  // This allows smooth rotation for curved strokes (O-shapes) while
  // preventing abrupt single-point flips from direction noise.
  // A fixed reference breaks when the stroke curves >90° from the start
  // direction because the dot product crosses zero unpredictably.
  if (perps.length >= 2) {
    for (let i = 1; i < perps.length; i++) {
      const dot = perps[i].x * perps[i - 1].x + perps[i].y * perps[i - 1].y;
      if (dot < 0) {
        perps[i].x = -perps[i].x;
        perps[i].y = -perps[i].y;
      }
    }
  }

  // Fourth pass: smooth the perpendicular direction vectors.
  if (perps.length >= 3) {
    smoothPerpendiculars(perps);
  }

  // Generate outline positions from smoothed perpendiculars.
  const leftSide: number[][] = [];
  const rightSide: number[][] = [];

  for (let i = 0; i < centers.length; i++) {
    const hw = halfWidths[i];
    leftSide.push([centers[i].x + perps[i].x * hw, centers[i].y + perps[i].y * hw]);
    rightSide.push([centers[i].x - perps[i].x * hw, centers[i].y - perps[i].y * hw]);
  }

  // Safety net: expand any pinched outline pairs to a minimum gap.
  expandPinchedPairs(leftSide, rightSide, config.nibHeight);

  return { leftSide, rightSide };
}

/**
 * Generate an outline polygon for an italic nib stroke.
 * Produces the same number[][] format as perfect-freehand so it
 * drops directly into the existing outlineToPath2D → fill pipeline.
 */
export function generateItalicOutline(
  points: readonly StrokePoint[],
  config: ItalicNibConfig,
  dejitter: boolean = true,
): number[][] {
  if (points.length === 0) return [];

  // Single point → small filled shape
  if (points.length === 1) {
    return generateDot(points[0], config);
  }

  const sides = generateItalicOutlineSides(points, config, dejitter);
  if (!sides) return [];

  // Combine into closed polygon: left forward, right reversed
  return [...sides.leftSide, ...sides.rightSide.reverse()];
}

/**
 * Expand any pinched outline pairs to a minimum gap.
 */
function expandPinchedPairs(leftSide: number[][], rightSide: number[][], nibHeight: number): void {
  const minGap = nibHeight * 0.3;
  const minGapSq = minGap * minGap;

  for (let i = 0; i < leftSide.length; i++) {
    const dxLR = leftSide[i][0] - rightSide[i][0];
    const dyLR = leftSide[i][1] - rightSide[i][1];
    const distSq = dxLR * dxLR + dyLR * dyLR;
    if (distSq < minGapSq) {
      let expandDx = dxLR;
      let expandDy = dyLR;
      let expandLen = Math.sqrt(distSq);

      if (expandLen < 0.0001) {
        for (let d = 1; d < leftSide.length; d++) {
          const checkBefore = i - d;
          const checkAfter = i + d;
          if (checkBefore >= 0) {
            const ndx = leftSide[checkBefore][0] - rightSide[checkBefore][0];
            const ndy = leftSide[checkBefore][1] - rightSide[checkBefore][1];
            const nlen = Math.hypot(ndx, ndy);
            if (nlen > 0.0001) {
              expandDx = ndx; expandDy = ndy; expandLen = nlen;
              break;
            }
          }
          if (checkAfter < leftSide.length) {
            const ndx = leftSide[checkAfter][0] - rightSide[checkAfter][0];
            const ndy = leftSide[checkAfter][1] - rightSide[checkAfter][1];
            const nlen = Math.hypot(ndx, ndy);
            if (nlen > 0.0001) {
              expandDx = ndx; expandDy = ndy; expandLen = nlen;
              break;
            }
          }
        }
      }

      if (expandLen > 0.0001) {
        const ux = expandDx / expandLen;
        const uy = expandDy / expandLen;
        const halfGap = minGap / 2;
        const cx = (leftSide[i][0] + rightSide[i][0]) / 2;
        const cy = (leftSide[i][1] + rightSide[i][1]) / 2;
        leftSide[i][0] = cx + ux * halfGap;
        leftSide[i][1] = cy + uy * halfGap;
        rightSide[i][0] = cx - ux * halfGap;
        rightSide[i][1] = cy - uy * halfGap;
      }
    }
  }
}

/**
 * Smooth perpendicular direction vectors with a ±3 Gaussian-weighted kernel.
 * Renormalizes after averaging to maintain unit length.
 * This spreads direction transitions over ~7 points, preventing the sharp
 * perpendicular jumps at corners that cause outline notches.
 */
function smoothPerpendiculars(perps: { x: number; y: number }[]): void {
  const n = perps.length;
  // Modest Gaussian kernel (±3) for mild perpendicular smoothing.
  // The main notch fix is the fast-open width EMA; this just softens
  // any remaining perpendicular direction jitter.
  const radius = 3;
  const sigma = radius / 2.5;
  const weights: number[] = [];
  for (let k = -radius; k <= radius; k++) {
    weights.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  }

  const origX = perps.map(p => p.x);
  const origY = perps.map(p => p.y);

  for (let i = 0; i < n; i++) {
    let sumX = 0;
    let sumY = 0;
    let sumW = 0;

    for (let k = -radius; k <= radius; k++) {
      const j = Math.max(0, Math.min(n - 1, i + k));
      const w = weights[k + radius];
      sumX += origX[j] * w;
      sumY += origY[j] * w;
      sumW += w;
    }

    const avgX = sumX / sumW;
    const avgY = sumY / sumW;
    const len = Math.hypot(avgX, avgY);

    if (len > 0.0001) {
      perps[i].x = avgX / len;
      perps[i].y = avgY / len;
    }
  }
}

/**
 * Generate a small polygon for a single-point stroke (dot).
 */
function generateDot(point: StrokePoint, config: ItalicNibConfig): number[][] {
  const pressure = Math.pow(Math.max(0, Math.min(1, point.pressure)), config.pressureCurve);
  const [minW, maxW] = config.pressureWidthRange;
  const radius = (config.nibHeight * lerp(minW, maxW, pressure)) / 2;
  const r = Math.max(0.5, radius);

  // 8-point circle approximation
  const polygon: number[][] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    polygon.push([
      point.x + Math.cos(angle) * r,
      point.y + Math.sin(angle) * r,
    ]);
  }
  return polygon;
}

/**
 * Compute cumulative arc lengths for a series of points.
 */
function computeArcLengths(points: readonly StrokePoint[]): number[] {
  const lengths = new Array<number>(points.length);
  lengths[0] = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    lengths[i] = lengths[i - 1] + Math.hypot(dx, dy);
  }
  return lengths;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
