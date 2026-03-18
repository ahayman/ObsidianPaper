/**
 * Ray-casting point-in-polygon algorithm.
 * Casts a horizontal ray from the test point to +infinity and counts
 * edge crossings. Odd count = inside, even = outside.
 * Works for convex, concave, and self-intersecting polygons.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Test if a point is inside a polygon using the ray-casting algorithm.
 * The polygon is defined by an array of vertices (auto-closed: last→first edge is implicit).
 */
export function isPointInPolygon(
  px: number,
  py: number,
  polygon: readonly Point2D[]
): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    // Check if the horizontal ray from (px, py) crosses edge (i, j)
    if ((yi > py) !== (yj > py)) {
      // Compute x-coordinate of intersection with the edge
      const intersectX = xj + ((py - yj) / (yi - yj)) * (xi - xj);
      if (px < intersectX) {
        inside = !inside;
      }
    }
  }

  return inside;
}

/**
 * Compute the axis-aligned bounding box of a polygon.
 * Returns [minX, minY, maxX, maxY].
 */
export function polygonBBox(
  polygon: readonly Point2D[]
): [number, number, number, number] {
  if (polygon.length === 0) return [0, 0, 0, 0];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return [minX, minY, maxX, maxY];
}
