/**
 * Marker stamp computation for felt-tip pen rendering.
 *
 * Places rounded-rectangle stamps along the stroke path. Each stamp:
 * - Is sized based on pressure-dependent stroke width and configured aspect ratio
 * - Rotation determined by Apple Pencil tilt azimuth (pen lean direction),
 *   or a static default angle when no tilt data is available
 * - Has opacity affected by optional ink depletion over distance
 *
 * The stamp data format is 6 floats per stamp: [x, y, width, height, rotation, opacity]
 * to support non-square shapes and per-stamp rotation.
 */

import type { StrokePoint, PenStyle } from "../types";
import type { PenConfig, MarkerStampConfig } from "../stroke/PenConfigs";
import { hashFloat, interpolatePoint } from "./StampRenderer";

// ─── Stamp Params ────────────────────────────────────────────

export interface MarkerStampParams {
  x: number;
  y: number;
  /** Major axis size (world units) */
  width: number;
  /** Minor axis size (world units) */
  height: number;
  /** Rotation in radians — stroke direction angle */
  rotation: number;
  /** Per-stamp opacity (0-1), includes ink depletion */
  opacity: number;
}

// ─── Accumulator ─────────────────────────────────────────────

export interface MarkerStampAccumulator {
  lastPointIndex: number;
  remainder: number;
  stampCount: number;
  cumulativeDistance: number;
}

export function createMarkerStampAccumulator(): MarkerStampAccumulator {
  return { lastPointIndex: 0, remainder: 0, stampCount: 0, cumulativeDistance: 0 };
}

// Reference velocity for speed factor normalization (px/ms)
const REF_VELOCITY = 1.5;

/** Dead zone below which tilt is treated as absent (same as StampRenderer). */
const TILT_DEAD_ZONE = 2;

/** Default static rotation when no tilt data is available (horizontal). */
const DEFAULT_STATIC_ROTATION = 0;

/**
 * Compute stamp rotation from tilt data.
 * When tilt is available, the pen's azimuth determines the chisel orientation.
 * When tilt is absent, returns a static default angle.
 */
function computeStampRotation(pt: StrokePoint): number {
  const tiltMag = Math.sqrt(pt.tiltX * pt.tiltX + pt.tiltY * pt.tiltY);
  if (tiltMag > TILT_DEAD_ZONE) {
    return Math.atan2(pt.tiltY, pt.tiltX);
  }
  return DEFAULT_STATIC_ROTATION;
}

// ─── Computation ─────────────────────────────────────────────

/**
 * Compute marker stamps for a range of points (incremental).
 */
export function computeMarkerStamps(
  points: readonly StrokePoint[],
  fromIndex: number,
  toIndex: number,
  remainder: number,
  style: PenStyle,
  penConfig: PenConfig,
  markerConfig: MarkerStampConfig,
  startStampCount: number,
  startCumulativeDistance: number = 0,
): { stamps: MarkerStampParams[]; newRemainder: number; newStampCount: number; newCumulativeDistance: number } {
  const stamps: MarkerStampParams[] = [];
  let stampCount = startStampCount;
  let cumulativeDistance = startCumulativeDistance;

  const [minW, maxW] = penConfig.pressureWidthRange;
  const pCurve = style.pressureCurve ?? penConfig.pressureCurve;

  // Ink depletion: style.inkDepletion (0-1) scales the base rate
  const inkDepletion = style.inkDepletion ?? 0;
  const depletionRate = markerConfig.inkDepletionRate * inkDepletion;

  if (fromIndex === toIndex || points.length <= 1) {
    return { stamps, newRemainder: 0, newStampCount: stampCount, newCumulativeDistance: cumulativeDistance };
  }

  const clampedFrom = Math.max(0, fromIndex);
  const clampedTo = Math.min(points.length - 1, toIndex);

  for (let i = clampedFrom; i < clampedTo; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];

    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 0.001) continue;

    const dt = Math.max(1, p1.timestamp - p0.timestamp);
    const velocity = segLen / dt;
    const speedFactor = Math.min(1, velocity / REF_VELOCITY);

    // Pressure-dependent width at segment start
    const pressure = Math.max(0, Math.min(1, p0.pressure));
    const effectivePressure = Math.pow(pressure, pCurve);
    const widthMul = minW + (maxW - minW) * effectivePressure;
    const baseWidth = style.width * widthMul;
    // Scale stamps by sizeFraction so they extend beyond the outline mask
    const stampWidth = baseWidth * markerConfig.stampSizeFraction;
    const stampHeight = stampWidth / markerConfig.aspectRatio;

    // Spacing based on minor axis (stamp height) for consistent coverage
    const effectiveSpacing = markerConfig.spacing * stampHeight;
    const step = Math.max(stampHeight * 0.05, effectiveSpacing);

    let walked = -remainder;

    while (walked + step <= segLen) {
      walked += step;
      const t = walked / segLen;
      const interpPt = interpolatePoint(p0, p1, t);

      // Track cumulative distance for ink depletion
      cumulativeDistance += step;

      // Interpolated pressure at this position
      const ptPressure = Math.max(0, Math.min(1, interpPt.pressure));
      const ptEffPressure = Math.pow(ptPressure, pCurve);
      const ptWidthMul = minW + (maxW - minW) * ptEffPressure;
      const ptBaseWidth = style.width * ptWidthMul;
      const ptStampWidth = ptBaseWidth * markerConfig.stampSizeFraction;
      const ptStampHeight = ptStampWidth / markerConfig.aspectRatio;

      // Base opacity: 1.0 (isolation handles overall stroke opacity)
      let opacity = 1.0;

      // Ink depletion: exponential decay based on cumulative distance and speed
      if (depletionRate > 0) {
        const depletionSpeedFactor = 1 + speedFactor * 0.5;
        opacity *= Math.max(0.1, Math.exp(-cumulativeDistance * depletionRate * depletionSpeedFactor));
      }

      // Subtle alpha dithering: ±5% variation to break up banding
      const dither = 1.0 + (hashFloat(stampCount, 0x6A09E667) - 0.5) * 0.1;
      opacity = Math.max(0.01, opacity * dither);

      // Stamp rotation from tilt data (or static default)
      const rotation = computeStampRotation(interpPt);

      // Subtle position jitter for organic feel
      const jx = interpPt.x + (hashFloat(stampCount, 0x9E3779B9) - 0.5) * stampHeight * 0.05;
      const jy = interpPt.y + (hashFloat(stampCount, 0x517CC1B7) - 0.5) * stampHeight * 0.05;

      stamps.push({
        x: jx,
        y: jy,
        width: ptStampWidth,
        height: ptStampHeight,
        rotation,
        opacity,
      });
      stampCount++;
    }

    remainder = segLen - walked;
  }

  return { stamps, newRemainder: remainder, newStampCount: stampCount, newCumulativeDistance: cumulativeDistance };
}

/**
 * Compute all marker stamps for a complete stroke.
 */
export function computeAllMarkerStamps(
  points: readonly StrokePoint[],
  style: PenStyle,
  penConfig: PenConfig,
  markerConfig: MarkerStampConfig,
): MarkerStampParams[] {
  if (points.length === 0) return [];

  const { stamps, newStampCount, newCumulativeDistance } = computeMarkerStamps(
    points, 0, points.length - 1, 0, style, penConfig, markerConfig, 0, 0,
  );

  // Fill coverage gaps at sharp direction changes and stroke endpoints
  addCornerFillStamps(stamps, points, style, penConfig, markerConfig, newStampCount, newCumulativeDistance);

  return stamps;
}

// ─── Corner Fill ─────────────────────────────────────────────

/**
 * Deposit extra stamps at stroke start, end, and sharp direction changes
 * to fill coverage gaps where adjacent segments leave uncovered wedges.
 */
function addCornerFillStamps(
  stamps: MarkerStampParams[],
  points: readonly StrokePoint[],
  style: PenStyle,
  penConfig: PenConfig,
  markerConfig: MarkerStampConfig,
  startStampCount: number,
  totalDistance: number,
): void {
  if (points.length < 2) return;

  const [minW, maxW] = penConfig.pressureWidthRange;
  const pCurve = style.pressureCurve ?? penConfig.pressureCurve;
  const inkDepletion = style.inkDepletion ?? 0;
  const depletionRate = markerConfig.inkDepletionRate * inkDepletion;

  let stampCount = startStampCount;

  const depositAt = (pt: StrokePoint, distanceFraction: number) => {
    const pressure = Math.max(0, Math.min(1, pt.pressure));
    const effectivePressure = Math.pow(pressure, pCurve);
    const widthMul = minW + (maxW - minW) * effectivePressure;
    const stampWidth = style.width * widthMul * markerConfig.stampSizeFraction;
    const stampHeight = stampWidth / markerConfig.aspectRatio;
    const rotation = computeStampRotation(pt);

    let opacity = 1.0;
    if (depletionRate > 0) {
      opacity *= Math.max(0.1, Math.exp(-totalDistance * distanceFraction * depletionRate));
    }

    const dither = 1.0 + (hashFloat(stampCount, 0x6A09E667) - 0.5) * 0.1;
    opacity = Math.max(0.01, opacity * dither);

    stamps.push({ x: pt.x, y: pt.y, width: stampWidth, height: stampHeight, rotation, opacity });
    stampCount++;
  };

  // Deposit at stroke start
  depositAt(points[0], 0);

  // Deposit at sharp direction changes
  for (let i = 1; i < points.length - 1; i++) {
    const dxIn = points[i].x - points[i - 1].x;
    const dyIn = points[i].y - points[i - 1].y;
    const lenIn = Math.hypot(dxIn, dyIn);

    const dxOut = points[i + 1].x - points[i].x;
    const dyOut = points[i + 1].y - points[i].y;
    const lenOut = Math.hypot(dxOut, dyOut);

    if (lenIn < 0.001 || lenOut < 0.001) continue;

    const dot = (dxIn * dxOut + dyIn * dyOut) / (lenIn * lenOut);

    // Deposit at corners sharper than ~45°
    if (dot < 0.7) {
      depositAt(points[i], 0.5);
    }
  }

  // Deposit at stroke end
  depositAt(points[points.length - 1], 1);
}
