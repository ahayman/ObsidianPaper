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
 * Non-proportionally scale (stretch) a stroke along one or both axes.
 * The bbox is recomputed from the stretched points.
 */
export function stretchStroke(
  stroke: Stroke,
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
  styles?: Record<string, PenStyle>
): Stroke {
  const points = decodePoints(stroke.pts);
  for (const pt of points) {
    pt.x = anchorX + (pt.x - anchorX) * scaleX;
    pt.y = anchorY + (pt.y - anchorY) * scaleY;
  }

  const result: Stroke = {
    ...stroke,
    pts: encodePoints(points),
    grainAnchor: stroke.grainAnchor
      ? [
          anchorX + (stroke.grainAnchor[0] - anchorX) * scaleX,
          anchorY + (stroke.grainAnchor[1] - anchorY) * scaleY,
        ]
      : undefined,
  };

  // Scale width by geometric mean of the two axes
  if (stroke.styleOverrides?.width !== undefined) {
    result.styleOverrides = {
      ...result.styleOverrides,
      width: stroke.styleOverrides.width * Math.sqrt(Math.abs(scaleX * scaleY)),
    };
  }

  result.bbox = computeStrokeBBox(points, result, styles);
  return result;
}

/**
 * Rotate all points in a stroke around a center point.
 * The bbox is recomputed from the rotated points.
 */
export function rotateStroke(
  stroke: Stroke,
  centerX: number,
  centerY: number,
  angle: number,
  styles?: Record<string, PenStyle>
): Stroke {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points = decodePoints(stroke.pts);

  for (const pt of points) {
    const dx = pt.x - centerX;
    const dy = pt.y - centerY;
    pt.x = centerX + dx * cos - dy * sin;
    pt.y = centerY + dx * sin + dy * cos;
  }

  const result: Stroke = {
    ...stroke,
    pts: encodePoints(points),
    grainAnchor: stroke.grainAnchor
      ? [
          centerX + (stroke.grainAnchor[0] - centerX) * cos - (stroke.grainAnchor[1] - centerY) * sin,
          centerY + (stroke.grainAnchor[0] - centerX) * sin + (stroke.grainAnchor[1] - centerY) * cos,
        ]
      : undefined,
  };

  result.bbox = computeStrokeBBox(points, result, styles);
  return result;
}

/** Snap angles: every 45 degrees */
const SNAP_ANGLES = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI,
  -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
const SNAP_TOLERANCE = 5 * Math.PI / 180; // 5 degrees

/**
 * Snap an angle to the nearest 45-degree increment if within tolerance.
 */
export function snapAngle(angle: number): number {
  // Normalize to [-PI, PI]
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  for (const snap of SNAP_ANGLES) {
    if (Math.abs(angle - snap) < SNAP_TOLERANCE) return snap;
  }
  return angle;
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
