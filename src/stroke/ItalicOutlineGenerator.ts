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

  // De-jitter: RDP simplification removes points that deviate less than
  // epsilon from the line between their neighbors, eliminating hand tremor
  // micro-jitter while preserving intentional direction changes.
  // Only applied to baked strokes — during active drawing, RDP decisions
  // shift as new points arrive, causing the outline to wiggle.
  const dejittered = (dejitter && points.length > 2)
    ? rdpSimplify(points, 0.0375)
    : points;

  // Precompute nib unit vector (static angle case)
  const staticNx = Math.cos(config.nibAngle);
  const staticNy = Math.sin(config.nibAngle);

  // Compute cumulative arc length for taper
  const arcLengths = computeArcLengths(dejittered);
  const totalLength = arcLengths[arcLengths.length - 1];

  const leftSide: number[][] = [];
  const rightSide: number[][] = [];

  let prevWidth = 0;
  const [minW, maxW] = config.pressureWidthRange;

  for (let i = 0; i < dejittered.length; i++) {
    const p = dejittered[i];

    // Stroke direction vector
    let dx: number, dy: number;
    if (i === 0) {
      dx = dejittered[1].x - p.x;
      dy = dejittered[1].y - p.y;
    } else {
      dx = p.x - dejittered[i - 1].x;
      dy = p.y - dejittered[i - 1].y;
    }

    const len = Math.hypot(dx, dy);

    // Skip near-zero segments (carry forward previous values)
    if (len < 0.001 && i > 0 && i < points.length - 1) {
      // Use the same offsets as the previous point
      if (leftSide.length > 0) {
        leftSide.push([...leftSide[leftSide.length - 1]]);
        rightSide.push([...rightSide[rightSide.length - 1]]);
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

    // Perpendicular normal to stroke direction
    const perpX = -sy;
    const perpY = sx;
    const halfW = smoothedWidth / 2;

    leftSide.push([p.x + perpX * halfW, p.y + perpY * halfW]);
    rightSide.push([p.x - perpX * halfW, p.y - perpY * halfW]);
  }

  // Combine into closed polygon: left forward, right reversed
  return [...leftSide, ...rightSide.reverse()];
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
