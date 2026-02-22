/**
 * Ink stamp computation for fountain pen velocity-based shading.
 *
 * Stamps are used as a MODULATION LAYER on top of the solid italic outline fill,
 * not as the primary stroke renderer. The solid fill (from ItalicOutlineGenerator)
 * defines the stroke shape. Stamps are applied with destination-out compositing to
 * selectively lighten the fill based on velocity:
 *   - Slow strokes → low stamp opacity → minimal erasure → dark ink
 *   - Fast strokes → higher stamp opacity → more erasure → lighter ink
 *
 * Natural edge darkening emerges because fewer stamps overlap at stroke edges
 * than at the centerline.
 */

import type { StrokePoint, PenStyle } from "../types";
import type { PenConfig } from "../stroke/PenConfigs";
import type { InkPresetConfig } from "./InkPresets";
import type { InkStampConfig } from "../stroke/PenConfigs";
import { hashFloat, interpolatePoint } from "./StampRenderer";

// Erasure tuning. With stamp spacing 0.04 and size fraction 1.1, ~25 stamps
// overlap at the centerline and ~5 at edges. The differential creates edge darkening.
//
// BASE_MIN: always-present erasure for texture/edge-darkening even at slow speed.
//   25 stamps @ 0.02 → center erases ~40%, edges ~10% → 30% differential
// SPEED_RANGE: additional erasure at max velocity for shading.
//   25 stamps @ 0.06 → center erases ~78%, edges ~26% → dramatic lightening
const BASE_MIN_ERASURE = 0.03;
const SPEED_ERASURE = 0.09;

/**
 * Parameters for a single ink shading stamp.
 */
export interface InkStampParams {
  x: number;
  y: number;
  /** Stamp diameter in world units */
  size: number;
  /** Erasure amount 0-1 (used as globalAlpha with destination-out) */
  opacity: number;
  /** Unused (stamps are circular) */
  rotation: number;
  /** Unused (stamps are circular) */
  scaleX: number;
  /** Unused (stamps are circular) */
  scaleY: number;
}

/**
 * Accumulator for incremental ink stamp computation during active stroke.
 */
export interface InkStampAccumulator {
  lastPointIndex: number;
  remainder: number;
  stampCount: number;
}

export function createInkStampAccumulator(): InkStampAccumulator {
  return { lastPointIndex: 0, remainder: 0, stampCount: 0 };
}

// Reference velocity for speed factor normalization (px/ms)
const REF_VELOCITY = 1.5;

/**
 * Compute ink shading stamps for a range of points (incremental).
 */
export function computeInkStamps(
  points: readonly StrokePoint[],
  fromIndex: number,
  toIndex: number,
  remainder: number,
  style: PenStyle,
  penConfig: PenConfig,
  inkStampConfig: InkStampConfig,
  presetConfig: InkPresetConfig,
  startStampCount: number,
): { stamps: InkStampParams[]; newRemainder: number; newStampCount: number } {
  const stamps: InkStampParams[] = [];
  let stampCount = startStampCount;

  const nibAngle = style.nibAngle ?? penConfig.nibAngle ?? Math.PI / 6;
  const nibThickness = style.nibThickness ?? penConfig.nibThickness ?? 0.25;
  const nibPressure = style.nibPressure ?? 0.5;
  const [minW, maxW] = penConfig.pressureWidthRange;
  const pCurve = style.pressureCurve ?? penConfig.pressureCurve;

  if (fromIndex === toIndex || points.length <= 1) {
    return { stamps, newRemainder: 0, newStampCount: stampCount };
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

    // Stroke direction for nib projection
    const sx = dx / segLen;
    const sy = dy / segLen;

    // Projected width for stamp sizing (generous: 2x for modulation coverage)
    const projWidth = computeProjectedWidth(
      p0, nibAngle, nibThickness, nibPressure, style, minW, maxW, pCurve, sx, sy,
    );
    const stampSize = projWidth * inkStampConfig.stampSizeFraction;

    // Spacing for modulation stamps (fraction of stamp diameter)
    const effectiveSpacing = inkStampConfig.spacing * stampSize;
    const step = Math.max(stampSize * 0.05, effectiveSpacing);

    // Erasure amount: base level for texture + velocity-dependent for shading
    const erasure = (BASE_MIN_ERASURE + speedFactor * SPEED_ERASURE) * presetConfig.shading;

    let walked = -remainder;

    while (walked + step <= segLen) {
      walked += step;
      const t = walked / segLen;
      const interpPt = interpolatePoint(p0, p1, t);

      // Subtle position jitter for texture
      let jx = interpPt.x;
      let jy = interpPt.y;
      if (presetConfig.feathering > 0) {
        jx += (hashFloat(stampCount, 0x9E3779B9) - 0.5) * 2 * presetConfig.feathering * stampSize;
        jy += (hashFloat(stampCount, 0x517CC1B7) - 0.5) * 2 * presetConfig.feathering * stampSize;
      }

      stamps.push({
        x: jx,
        y: jy,
        size: stampSize,
        opacity: erasure,
        rotation: 0,
        scaleX: 1.0,
        scaleY: 1.0,
      });
      stampCount++;
    }

    remainder = segLen - walked;
  }

  return { stamps, newRemainder: remainder, newStampCount: stampCount };
}

/**
 * Compute all ink shading stamps for a complete stroke.
 */
export function computeAllInkStamps(
  points: readonly StrokePoint[],
  style: PenStyle,
  penConfig: PenConfig,
  inkStampConfig: InkStampConfig,
  presetConfig: InkPresetConfig,
): InkStampParams[] {
  if (points.length === 0) return [];
  const { stamps } = computeInkStamps(
    points, 0, points.length - 1, 0, style, penConfig, inkStampConfig, presetConfig, 0,
  );
  return stamps;
}

/**
 * Draw ink shading stamps with per-stamp alpha (for destination-out compositing).
 * Each stamp's opacity controls how much ink is erased at that position.
 */
export function drawInkShadingStamps(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  stamps: readonly InkStampParams[],
  stampTexture: OffscreenCanvas,
  baseTransform: DOMMatrix,
): void {
  if (stamps.length === 0) return;

  const { a: ba, b: bb } = baseTransform;
  const zoom = Math.sqrt(ba * ba + bb * bb);

  for (const s of stamps) {
    if (s.opacity < 0.001) continue;

    const pixelR = s.size * zoom * 0.5;
    if (pixelR < 0.2) continue;

    const screenX = baseTransform.a * s.x + baseTransform.c * s.y + baseTransform.e;
    const screenY = baseTransform.b * s.x + baseTransform.d * s.y + baseTransform.f;

    // Per-stamp alpha for velocity-dependent erasure
    ctx.globalAlpha = s.opacity;

    ctx.setTransform(
      pixelR, 0,
      0, pixelR,
      screenX, screenY,
    );

    ctx.drawImage(stampTexture, -1, -1, 2, 2);
  }

  ctx.setTransform(baseTransform);
  ctx.globalAlpha = 1;
}

// ─── Internal Helpers ────────────────────────────────────────

function computeProjectedWidth(
  pt: StrokePoint,
  nibAngle: number,
  nibThickness: number,
  nibPressure: number,
  style: PenStyle,
  minW: number,
  maxW: number,
  pCurve: number,
  sx: number,
  sy: number,
): number {
  const effectiveNibAngle = pt.twist !== 0
    ? pt.twist * Math.PI / 180
    : nibAngle;

  const nibW = style.width;
  const nibH = style.width * nibThickness;

  const nx = Math.cos(effectiveNibAngle);
  const ny = Math.sin(effectiveNibAngle);
  const crossMag = Math.abs(nx * sy - ny * sx);

  let rawWidth = nibW * crossMag + nibH * (1 - crossMag);

  const pT = Math.pow(Math.max(0, Math.min(1, pt.pressure)), pCurve);
  const pressureRange = minW + (maxW - minW) * pT;
  const widthMul = 1.0 * (1 - nibPressure) + pressureRange * nibPressure;
  rawWidth *= widthMul;

  return Math.max(nibH * 0.5, rawWidth);
}
