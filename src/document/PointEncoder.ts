import type { StrokePoint } from "../types";

/**
 * Default channels stored per point.
 * x, y: world coordinates (multiplied by 10 for 0.1px precision)
 * p: pressure (mapped to 0-255)
 * tx, ty: tilt (mapped to 0-255 from -90..90 range)
 * tw: twist (mapped to 0-359)
 * t: timestamp delta in ms
 */
export const DEFAULT_CHANNELS = ["x", "y", "p", "tx", "ty", "tw", "t"];

const COORD_SCALE = 10; // 0.1px precision
const PRESSURE_SCALE = 255;
const TILT_OFFSET = 90; // tiltX/tiltY range: -90 to 90
const TILT_SCALE = 255 / 180; // map -90..90 to 0..255

/**
 * Encode an array of StrokePoints to a delta-encoded integer string.
 *
 * Format: points separated by ";", channels separated by ","
 * First point is absolute, subsequent points are deltas from previous.
 */
export function encodePoints(points: StrokePoint[]): string {
  if (points.length === 0) return "";

  const parts: string[] = [];
  let prevValues: number[] | null = null;

  for (const point of points) {
    const values = pointToIntegers(point);

    if (prevValues === null) {
      // First point: absolute values
      parts.push(values.join(","));
    } else {
      // Subsequent points: delta from previous
      const deltas = values.map((v, i) => v - prevValues![i]);
      parts.push(deltas.join(","));
    }

    prevValues = values;
  }

  return parts.join(";");
}

/**
 * Decode a delta-encoded integer string back to StrokePoints.
 */
export function decodePoints(encoded: string): StrokePoint[] {
  if (encoded === "") return [];

  const points: StrokePoint[] = [];
  const segments = encoded.split(";");
  let prevValues: number[] | null = null;

  for (const segment of segments) {
    const rawValues = segment.split(",").map(Number);

    let values: number[];
    if (prevValues === null) {
      // First point: absolute
      values = rawValues;
    } else {
      // Subsequent points: accumulate deltas
      values = rawValues.map((d, i) => d + prevValues![i]);
    }

    points.push(integersToPoint(values));
    prevValues = values;
  }

  return points;
}

/**
 * Convert a StrokePoint to integer values for encoding.
 */
function pointToIntegers(point: StrokePoint): number[] {
  return [
    Math.round(point.x * COORD_SCALE),
    Math.round(point.y * COORD_SCALE),
    Math.round(point.pressure * PRESSURE_SCALE),
    Math.round((point.tiltX + TILT_OFFSET) * TILT_SCALE),
    Math.round((point.tiltY + TILT_OFFSET) * TILT_SCALE),
    Math.round(point.twist),
    Math.round(point.timestamp),
  ];
}

/**
 * Convert integer values back to a StrokePoint.
 */
function integersToPoint(values: number[]): StrokePoint {
  return {
    x: values[0] / COORD_SCALE,
    y: values[1] / COORD_SCALE,
    pressure: values[2] / PRESSURE_SCALE,
    tiltX: values[3] / TILT_SCALE - TILT_OFFSET,
    tiltY: values[4] / TILT_SCALE - TILT_OFFSET,
    twist: values[5],
    timestamp: values[6],
  };
}

/**
 * Compute the bounding box from an array of StrokePoints.
 * Returns [minX, minY, maxX, maxY].
 */
export function computeBBox(
  points: StrokePoint[]
): [number, number, number, number] {
  if (points.length === 0) return [0, 0, 0, 0];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return [minX, minY, maxX, maxY];
}
