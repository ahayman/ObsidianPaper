import type { Stroke } from "../types";

export interface LineCluster {
  strokeIds: string[];
  /** Union bbox of all strokes in the cluster: [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
}

export interface ClusterOptions {
  /** Threshold multiplier applied to the median stroke height to decide
   *  whether two Y-ranges overlap enough to be the same line. Higher =
   *  fewer, larger clusters. Default 1.5. */
  thresholdMultiplier?: number;
}

/**
 * Cluster strokes into lines using a 1D Y-band union-find pass.
 * Returns clusters ordered top-to-bottom.
 *
 * Algorithm: sort strokes by top Y, then sweep. Each stroke either extends
 * the current active line (if its top is within `threshold` of the active
 * line's bottom) or starts a new line.
 */
export function clusterStrokesIntoLines(
  strokes: readonly Stroke[],
  options: ClusterOptions = {},
): LineCluster[] {
  if (strokes.length === 0) return [];

  const threshold = options.thresholdMultiplier ?? 1.5;

  // Median stroke height as a scale reference.
  const heights = strokes.map((s) => Math.max(1, s.bbox[3] - s.bbox[1]));
  heights.sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 20;
  const tolerance = medianHeight * threshold;

  // Sort by top Y ascending.
  const sorted = [...strokes].sort((a, b) => a.bbox[1] - b.bbox[1]);

  const clusters: LineCluster[] = [];
  let active: LineCluster | null = null;

  for (const stroke of sorted) {
    const [minX, minY, maxX, maxY] = stroke.bbox;
    if (!active) {
      active = { strokeIds: [stroke.id], bbox: [minX, minY, maxX, maxY] };
      clusters.push(active);
      continue;
    }

    const activeBottom = active.bbox[3];
    if (minY <= activeBottom + tolerance) {
      active.strokeIds.push(stroke.id);
      active.bbox = [
        Math.min(active.bbox[0], minX),
        Math.min(active.bbox[1], minY),
        Math.max(active.bbox[2], maxX),
        Math.max(active.bbox[3], maxY),
      ];
    } else {
      active = { strokeIds: [stroke.id], bbox: [minX, minY, maxX, maxY] };
      clusters.push(active);
    }
  }

  return clusters;
}

/**
 * Group all strokes by page index, then cluster each page's strokes into lines.
 * Returns a map page → clusters (empty pages are omitted).
 */
export function clusterDocumentByPage(
  strokes: readonly Stroke[],
  options: ClusterOptions = {},
): Map<number, LineCluster[]> {
  const byPage = new Map<number, Stroke[]>();
  for (const s of strokes) {
    const arr = byPage.get(s.pageIndex);
    if (arr) arr.push(s);
    else byPage.set(s.pageIndex, [s]);
  }

  const result = new Map<number, LineCluster[]>();
  for (const [pageIndex, pageStrokes] of byPage) {
    result.set(pageIndex, clusterStrokesIntoLines(pageStrokes, options));
  }
  return result;
}
