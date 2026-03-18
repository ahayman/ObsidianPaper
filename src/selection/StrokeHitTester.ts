/**
 * Find the nearest stroke to a world-space point.
 * Used for tap-to-select in lasso mode.
 */

import type { Stroke } from "../types";
import { decodePoints } from "../document/PointEncoder";
import { pointToSegmentDistanceSq } from "../eraser/StrokeEraser";
import type { SpatialIndex } from "../spatial/SpatialIndex";

/**
 * Find the nearest stroke to a point within a given radius.
 * Returns the stroke ID or null if no stroke is within range.
 *
 * @param worldX - World-space X
 * @param worldY - World-space Y
 * @param radius - Search radius in world units
 * @param strokes - All strokes
 * @param spatialIndex - Spatial index for pre-filtering
 * @param pageIndex - Only consider strokes on this page (-1 for all)
 */
export function findNearestStroke(
  worldX: number,
  worldY: number,
  radius: number,
  strokes: readonly Stroke[],
  spatialIndex: SpatialIndex,
  pageIndex = -1
): string | null {
  const candidateIds = new Set(spatialIndex.queryPoint(worldX, worldY, radius));
  if (candidateIds.size === 0) return null;

  let nearestId: string | null = null;
  let nearestDistSq = radius * radius;

  for (const stroke of strokes) {
    if (!candidateIds.has(stroke.id)) continue;
    if (pageIndex >= 0 && stroke.pageIndex !== pageIndex) continue;

    const points = decodePoints(stroke.pts);
    if (points.length === 0) continue;

    // Single-point stroke
    if (points.length === 1) {
      const dx = worldX - points[0].x;
      const dy = worldY - points[0].y;
      const distSq = dx * dx + dy * dy;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestId = stroke.id;
      }
      continue;
    }

    // Multi-point stroke: find min distance to any segment
    for (let i = 0; i < points.length - 1; i++) {
      const distSq = pointToSegmentDistanceSq(
        worldX, worldY,
        points[i].x, points[i].y,
        points[i + 1].x, points[i + 1].y
      );
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestId = stroke.id;
      }
    }
  }

  return nearestId;
}
