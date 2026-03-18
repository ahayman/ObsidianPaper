/**
 * Apply spatial transforms (move, proportional resize) to stroke data.
 */

import type { Stroke, PenStyle } from "../types";
import { decodePoints, encodePoints, computeBBox } from "../document/PointEncoder";
import { getPenConfig } from "../stroke/PenConfigs";

/**
 * Deep clone a stroke (including its pts string and styleOverrides).
 */
export function cloneStroke(stroke: Stroke): Stroke {
  return {
    ...stroke,
    bbox: [...stroke.bbox] as [number, number, number, number],
    styleOverrides: stroke.styleOverrides ? { ...stroke.styleOverrides } : undefined,
    grainAnchor: stroke.grainAnchor ? [...stroke.grainAnchor] as [number, number] : undefined,
    transform: stroke.transform ? [...stroke.transform] : undefined,
  };
}

/**
 * Translate all points in a stroke by (dx, dy) in world units.
 * Returns a new stroke with updated pts, bbox, and grainAnchor.
 */
export function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  const points = decodePoints(stroke.pts);
  for (const pt of points) {
    pt.x += dx;
    pt.y += dy;
  }

  return {
    ...stroke,
    pts: encodePoints(points),
    bbox: [
      stroke.bbox[0] + dx,
      stroke.bbox[1] + dy,
      stroke.bbox[2] + dx,
      stroke.bbox[3] + dy,
    ],
    grainAnchor: stroke.grainAnchor
      ? [stroke.grainAnchor[0] + dx, stroke.grainAnchor[1] + dy]
      : undefined,
  };
}

/**
 * Proportionally scale all points in a stroke around an anchor point.
 * Also scales stroke width if scaleWidth is true.
 *
 * The bbox is recomputed from the transformed points with proper
 * rendering margins (not just scaled from the old bbox), ensuring
 * the spatial index covers the full rendered extent.
 */
export function scaleStroke(
  stroke: Stroke,
  anchorX: number,
  anchorY: number,
  scale: number,
  scaleWidth = true,
  styles?: Record<string, PenStyle>
): Stroke {
  const points = decodePoints(stroke.pts);
  for (const pt of points) {
    pt.x = anchorX + (pt.x - anchorX) * scale;
    pt.y = anchorY + (pt.y - anchorY) * scale;
  }

  const result: Stroke = {
    ...stroke,
    pts: encodePoints(points),
    grainAnchor: stroke.grainAnchor
      ? [
          anchorX + (stroke.grainAnchor[0] - anchorX) * scale,
          anchorY + (stroke.grainAnchor[1] - anchorY) * scale,
        ]
      : undefined,
  };

  if (scaleWidth && stroke.styleOverrides?.width !== undefined) {
    result.styleOverrides = {
      ...result.styleOverrides,
      width: stroke.styleOverrides.width * Math.abs(scale),
    };
  }

  // Recompute bbox from actual transformed points with proper rendering margins
  result.bbox = computeStrokeBBox(points, result, styles);

  return result;
}

/**
 * Compute a bbox from points with appropriate rendering margins.
 * Mirrors the margin logic in PaperView's stroke finalization.
 */
export function computeStrokeBBox(
  points: { x: number; y: number }[],
  stroke: Stroke,
  styles?: Record<string, PenStyle>
): [number, number, number, number] {
  const raw = computeBBox(points as import("../types").StrokePoint[]);

  // Resolve the effective width: styleOverrides > base style > default
  const baseStyle = styles?.[stroke.style];
  const effectiveWidth = stroke.styleOverrides?.width ?? baseStyle?.width ?? 2;
  const effectivePen = stroke.styleOverrides?.pen ?? baseStyle?.pen ?? "ballpoint";

  const penConfig = getPenConfig(effectivePen);
  let margin = effectiveWidth * 2;
  if (penConfig.stamp && penConfig.tiltConfig) {
    const tc = penConfig.tiltConfig;
    margin = effectiveWidth * (tc.crossAxisMultiplier + tc.maxSkewOffset);
  }

  return [
    raw[0] - margin,
    raw[1] - margin,
    raw[2] + margin,
    raw[3] + margin,
  ];
}
