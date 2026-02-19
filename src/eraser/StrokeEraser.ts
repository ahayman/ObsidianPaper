import type { Stroke, StrokePoint } from "../types";
import { decodePoints } from "../document/PointEncoder";
import type { SpatialIndex } from "../spatial/SpatialIndex";

/**
 * Whole-stroke eraser. Tests whether a point (eraser position) contacts a stroke.
 * Uses bounding box quick reject + point-to-segment distance testing.
 */

/**
 * Find all strokes that intersect an eraser circle at the given world position.
 *
 * @param worldX - Eraser position in world coordinates
 * @param worldY - Eraser position in world coordinates
 * @param radius - Eraser radius in world units
 * @param strokes - Array of strokes to test against
 * @returns Indices of hit strokes
 */
export function findHitStrokes(
  worldX: number,
  worldY: number,
  radius: number,
  strokes: readonly Stroke[],
  spatialIndex?: SpatialIndex
): number[] {
  const hits: number[] = [];

  if (spatialIndex) {
    // Use R-tree for O(log n) candidate filtering
    const candidateIds = new Set(spatialIndex.queryPoint(worldX, worldY, radius));
    if (candidateIds.size === 0) return [];

    for (let i = 0; i < strokes.length; i++) {
      const stroke = strokes[i];
      if (!candidateIds.has(stroke.id)) continue;

      const points = decodePoints(stroke.pts);
      if (isPointNearStroke(worldX, worldY, radius, points)) {
        hits.push(i);
      }
    }
  } else {
    // Linear scan fallback
    for (let i = 0; i < strokes.length; i++) {
      const stroke = strokes[i];

      // Quick reject: bbox test with eraser radius margin
      if (!bboxContainsPoint(stroke.bbox, worldX, worldY, radius)) {
        continue;
      }

      // Detailed test: point-to-stroke distance
      const points = decodePoints(stroke.pts);
      if (isPointNearStroke(worldX, worldY, radius, points)) {
        hits.push(i);
      }
    }
  }

  return hits;
}

/**
 * Test if a point is within radius of the stroke's bounding box (expanded by radius).
 */
function bboxContainsPoint(
  bbox: [number, number, number, number],
  x: number,
  y: number,
  radius: number
): boolean {
  return (
    x >= bbox[0] - radius &&
    x <= bbox[2] + radius &&
    y >= bbox[1] - radius &&
    y <= bbox[3] + radius
  );
}

/**
 * Test if a point is within radius of any segment of the stroke polyline.
 */
function isPointNearStroke(
  px: number,
  py: number,
  radius: number,
  points: StrokePoint[]
): boolean {
  if (points.length === 0) return false;

  // Single-point stroke: just distance to that point
  if (points.length === 1) {
    return pointDistance(px, py, points[0].x, points[0].y) <= radius;
  }

  const radiusSq = radius * radius;

  for (let i = 0; i < points.length - 1; i++) {
    const dist = pointToSegmentDistanceSq(
      px,
      py,
      points[i].x,
      points[i].y,
      points[i + 1].x,
      points[i + 1].y
    );
    if (dist <= radiusSq) {
      return true;
    }
  }

  return false;
}

/**
 * Squared distance from a point to a line segment.
 */
export function pointToSegmentDistanceSq(
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
    // Degenerate segment: a == b
    const dpx = px - ax;
    const dpy = py - ay;
    return dpx * dpx + dpy * dpy;
  }

  // Parameter t of the projection of P onto the line through A→B, clamped to [0,1]
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  // Closest point on segment
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  const distX = px - closestX;
  const distY = py - closestY;
  return distX * distX + distY * distY;
}

function pointDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}
