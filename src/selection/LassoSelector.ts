/**
 * Lasso stroke selection algorithm.
 * Uses percentage-based point-in-polygon testing with spatial index pre-filtering.
 */

import type { Stroke } from "../types";
import { decodePoints } from "../document/PointEncoder";
import type { SpatialIndex } from "../spatial/SpatialIndex";
import { isPointInPolygon, polygonBBox } from "./PointInPolygon";
import type { Point2D } from "./PointInPolygon";

/** Default: 75% of a stroke's points must be inside the lasso */
const DEFAULT_THRESHOLD = 0.75;

/**
 * Find all strokes that are enclosed by the lasso polygon.
 *
 * @param lassoPoints - World-space polygon vertices (auto-closed)
 * @param strokes - All strokes in the document
 * @param spatialIndex - R-tree spatial index for pre-filtering
 * @param threshold - Fraction of stroke points that must be inside (0-1)
 * @param pageIndex - Only consider strokes on this page (-1 for all pages)
 * @returns Array of stroke IDs that meet the containment threshold
 */
export function selectStrokesInLasso(
  lassoPoints: readonly Point2D[],
  strokes: readonly Stroke[],
  spatialIndex: SpatialIndex,
  threshold: number = DEFAULT_THRESHOLD,
  pageIndex: number = -1
): string[] {
  if (lassoPoints.length < 3) return [];

  const lassoBBox = polygonBBox(lassoPoints);

  // Pre-filter: query spatial index for strokes whose bbox intersects the lasso bbox
  const candidateIds = new Set(
    spatialIndex.queryRect(lassoBBox[0], lassoBBox[1], lassoBBox[2], lassoBBox[3])
  );

  if (candidateIds.size === 0) return [];

  const selected: string[] = [];

  for (const stroke of strokes) {
    if (!candidateIds.has(stroke.id)) continue;
    if (pageIndex >= 0 && stroke.pageIndex !== pageIndex) continue;

    // Quick reject: if the stroke bbox doesn't intersect the lasso bbox at all
    if (!bboxIntersects(stroke.bbox, lassoBBox)) continue;

    // Decode points and test containment
    const points = decodePoints(stroke.pts);
    if (points.length === 0) continue;

    const fraction = computeContainmentFraction(points, lassoPoints);
    if (fraction >= threshold) {
      selected.push(stroke.id);
    }
  }

  return selected;
}

/**
 * Compute the fraction of stroke points that are inside the lasso polygon.
 */
function computeContainmentFraction(
  strokePoints: readonly { x: number; y: number }[],
  polygon: readonly Point2D[]
): number {
  if (strokePoints.length === 0) return 0;

  let inside = 0;
  for (const pt of strokePoints) {
    if (isPointInPolygon(pt.x, pt.y, polygon)) {
      inside++;
    }
  }

  return inside / strokePoints.length;
}

/**
 * Fast preview of which strokes would be selected by the current lasso polygon.
 * Uses point sampling (every 3rd point) for speed. Returns stroke bboxes for highlight rendering.
 *
 * @returns Array of bounding boxes for strokes that would be selected
 */
export function previewLassoSelection(
  lassoPoints: readonly Point2D[],
  strokes: readonly Stroke[],
  spatialIndex: SpatialIndex,
  threshold: number = DEFAULT_THRESHOLD,
  pageIndex: number = -1,
): [number, number, number, number][] {
  if (lassoPoints.length < 3) return [];

  const lassoBBox = polygonBBox(lassoPoints);
  const candidateIds = new Set(
    spatialIndex.queryRect(lassoBBox[0], lassoBBox[1], lassoBBox[2], lassoBBox[3])
  );

  if (candidateIds.size === 0) return [];

  const result: [number, number, number, number][] = [];

  for (const stroke of strokes) {
    if (!candidateIds.has(stroke.id)) continue;
    if (pageIndex >= 0 && stroke.pageIndex !== pageIndex) continue;
    if (!bboxIntersects(stroke.bbox, lassoBBox)) continue;

    const points = decodePoints(stroke.pts);
    if (points.length === 0) continue;

    // Sample every 3rd point for speed (still accurate enough for preview)
    const step = points.length > 30 ? 3 : 1;
    let inside = 0;
    let tested = 0;
    for (let i = 0; i < points.length; i += step) {
      if (isPointInPolygon(points[i].x, points[i].y, lassoPoints)) {
        inside++;
      }
      tested++;
    }

    if (tested > 0 && inside / tested >= threshold) {
      result.push(stroke.bbox);
    }
  }

  return result;
}

/**
 * Test if two axis-aligned bounding boxes intersect.
 */
function bboxIntersects(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
