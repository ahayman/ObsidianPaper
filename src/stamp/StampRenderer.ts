import type { StrokePoint, PenStyle } from "../types";
import type { PenConfig, PenTiltConfig } from "../stroke/PenConfigs";
import type { PenStampConfig } from "../stroke/PenConfigs";
import { DEFAULT_GRAIN_VALUE } from "./GrainMapping";

// ─── Tilt ─────────────────────────────────────────────────────

interface TiltInfo {
  /** Tilt magnitude in degrees (0 = perpendicular, ~70 = max practical) */
  magnitude: number;
  /** Tilt direction angle in radians */
  angle: number;
  /** Blend factor 0-1: 0 = skew mode, 1 = full shading mode */
  shadingBlend: number;
}

/** Dead zone below which tilt is ignored (noise floor). */
const TILT_DEAD_ZONE = 2;

function computeTiltInfo(tiltX: number, tiltY: number, config: PenTiltConfig): TiltInfo | null {
  const magnitude = Math.sqrt(tiltX * tiltX + tiltY * tiltY);
  if (magnitude < TILT_DEAD_ZONE) return null;
  const angle = Math.atan2(tiltY, tiltX);
  const shadingBlend = Math.max(0, Math.min(1,
    (magnitude - config.tolerance) / config.transitionRange,
  ));
  return { magnitude, angle, shadingBlend };
}

/**
 * Parameters for a single stamp placement.
 */
export interface StampParams {
  x: number;
  y: number;
  /** Particle diameter in world units (small — independent of stroke width) */
  size: number;
  /** Per-particle alpha 0-1 for texture variation */
  opacity: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  tiltAngle: number;
}

/**
 * Accumulator for incremental stamp rendering during active stroke.
 */
export interface StampAccumulator {
  /** Index of the last point that was fully processed */
  lastPointIndex: number;
  /** Distance remainder from last stamp to end of last segment */
  remainder: number;
  /** Total stamp count so far (used for deterministic jitter) */
  stampCount: number;
}

export function createStampAccumulator(): StampAccumulator {
  return { lastPointIndex: 0, remainder: 0, stampCount: 0 };
}

/**
 * Compute particle size for a given stroke width.
 * Particles are small and grow slowly — wider strokes get MORE particles, not bigger ones.
 */
function particleSizeForWidth(width: number): number {
  return Math.max(0.6, width * 0.08);
}

/**
 * Compute stamps for a range of points (incremental — for active stroke).
 *
 * Uses a particle scatter model: at each step along the path, many tiny particles
 * are randomly scattered within the stroke disk. Wider strokes get more particles.
 */
export function computeStamps(
  points: readonly StrokePoint[],
  fromIndex: number,
  toIndex: number,
  remainder: number,
  style: PenStyle,
  penConfig: PenConfig,
  stampConfig: PenStampConfig,
  startStampCount: number,
): { stamps: StampParams[]; newRemainder: number; newStampCount: number } {
  const stamps: StampParams[] = [];
  const spacing = stampConfig.spacing;
  let stampCount = startStampCount;
  const grainValue = style.grain ?? DEFAULT_GRAIN_VALUE;
  const particleSize = particleSizeForWidth(style.width);
  const tc = penConfig.tiltConfig;

  // Handle single-point case (tap)
  if (fromIndex === toIndex || points.length <= 1) {
    if (points.length >= 1 && fromIndex < points.length) {
      const pt = points[fromIndex];
      const diameter = computeDiameter(pt.pressure, style, penConfig);
      const ti = tc ? computeTiltInfo(pt.tiltX, pt.tiltY, tc) : null;
      stampCount = emitScatter(
        stamps, pt.x, pt.y, diameter, particleSize,
        stampCount, grainValue, pt.pressure, penConfig, style,
        ti, tc,
      );
    }
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

    // Step size based on particle size (not stroke diameter)
    const step = spacing * particleSize;
    const segAngle = Math.atan2(dy, dx);

    let walked = -remainder;

    // First scatter at start of stroke
    if (stampCount === 0 && stamps.length === 0 && i === clampedFrom) {
      const diameter = computeDiameter(p0.pressure, style, penConfig);
      const ti = tc ? computeTiltInfo(p0.tiltX, p0.tiltY, tc) : null;
      stampCount = emitScatter(
        stamps, p0.x, p0.y, diameter, particleSize,
        stampCount, grainValue, p0.pressure, penConfig, style,
        ti, tc, segAngle,
      );
    }

    while (walked + step <= segLen) {
      walked += step;
      const t = walked / segLen;
      const interpPt = interpolatePoint(p0, p1, t);
      const diameter = computeDiameter(interpPt.pressure, style, penConfig);
      const ti = tc ? computeTiltInfo(interpPt.tiltX, interpPt.tiltY, tc) : null;

      stampCount = emitScatter(
        stamps, interpPt.x, interpPt.y, diameter, particleSize,
        stampCount, grainValue, interpPt.pressure, penConfig, style,
        ti, tc, segAngle,
      );
    }

    remainder = segLen - walked;
  }

  return { stamps, newRemainder: remainder, newStampCount: stampCount };
}

/**
 * Compute all stamps for a complete stroke.
 */
export function computeAllStamps(
  points: readonly StrokePoint[],
  style: PenStyle,
  penConfig: PenConfig,
  stampConfig: PenStampConfig,
): StampParams[] {
  if (points.length === 0) return [];
  const { stamps } = computeStamps(
    points, 0, points.length - 1, 0, style, penConfig, stampConfig, 0,
  );
  return stamps;
}

/**
 * Draw stamp particles onto a canvas context.
 *
 * Particles are tiny circles with per-particle alpha variation for texture.
 * Since particles are very small (0.6-2px), alpha stacking is negligible
 * and creates natural density variation.
 */
export function drawStamps(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  stamps: readonly StampParams[],
  color: string,
  baseTransform: DOMMatrix,
  strokeOpacity: number = 1,
): void {
  if (stamps.length === 0) return;

  const { a: ba, b: bb, c: bc, d: bd, e: be, f: bf } = baseTransform;
  const TWO_PI = Math.PI * 2;
  const zoom = Math.sqrt(ba * ba + bb * bb);

  ctx.fillStyle = color;

  for (const s of stamps) {
    // Skip nearly invisible particles
    if (s.opacity < 0.05) continue;

    // Transform world position to screen via base transform
    const screenX = ba * s.x + bc * s.y + be;
    const screenY = bb * s.x + bd * s.y + bf;

    // Compute particle radius in screen pixels
    const pixelRadius = (s.size * zoom) / 2;

    // Skip sub-pixel particles
    if (pixelRadius < 0.2) continue;

    // Per-particle alpha for texture variation
    ctx.globalAlpha = s.opacity * strokeOpacity;

    ctx.setTransform(
      pixelRadius, 0,
      0, pixelRadius,
      screenX, screenY,
    );

    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TWO_PI);
    ctx.fill();
  }

  // Restore base transform and alpha
  ctx.setTransform(baseTransform);
  ctx.globalAlpha = 1;
}

// ─── Hash Function ───────────────────────────────────────────

/**
 * High-quality integer hash (murmurhash3 finalizer).
 * Produces well-distributed values with no visible patterns.
 */
export function hash32(v: number): number {
  v = Math.imul(v ^ (v >>> 16), 0x85ebca6b) >>> 0;
  v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35) >>> 0;
  return (v ^ (v >>> 16)) >>> 0;
}

/** Hash to float in [0, 1). Uses two different seeds for independent channels. */
export function hashFloat(index: number, seed: number): number {
  return hash32(index ^ seed) / 4294967296;
}

// ─── Scatter ─────────────────────────────────────────────────

/**
 * Emit particles randomly scattered within the stroke disk.
 * Center-biased distribution: more particles near center, fewer at edges.
 * Edge alpha falloff for soft stroke edges.
 *
 * Returns updated stampCount.
 */
function emitScatter(
  stamps: StampParams[],
  cx: number, cy: number,
  diameter: number,
  particleSize: number,
  startCount: number,
  grainValue: number,
  pressure: number,
  penConfig: PenConfig,
  style: PenStyle,
  tiltInfo?: TiltInfo | null,
  tiltConfig?: PenTiltConfig | null,
  strokeAngle?: number,
): number {
  const radius = diameter / 2;
  let stampCount = startCount;

  const pCurve = style.pressureCurve ?? penConfig.pressureCurve;
  const pT = Math.pow(Math.max(0, Math.min(1, pressure)), pCurve);

  // Tilt-derived parameters
  const hasTilt = tiltInfo != null && tiltConfig != null;
  const t = hasTilt ? tiltInfo.shadingBlend : 0;

  // Compute effective width multiplier based on stroke direction vs tilt direction.
  // Cross-axis (perpendicular to tilt): full shading width — the lead's side contacts paper.
  // Along-axis (parallel to tilt): reduced width — only the tip edge contacts paper.
  let effectiveMultiplier = hasTilt ? tiltConfig.crossAxisMultiplier : 1;
  if (hasTilt && strokeAngle != null) {
    const angleDiff = Math.abs(Math.sin(strokeAngle - tiltInfo.angle));
    // angleDiff: 0 = parallel to tilt (along-axis), 1 = perpendicular (cross-axis)
    effectiveMultiplier = tiltConfig.alongAxisMultiplier +
      (tiltConfig.crossAxisMultiplier - tiltConfig.alongAxisMultiplier) * angleDiff;
  }

  // Ellipse axes: shading mode widens along tilt direction
  const majorRadius = hasTilt ? radius * (1 + (effectiveMultiplier - 1) * t) : radius;
  const minorRadius = hasTilt ? radius * (1 + 0.3 * t) : radius;

  // Skew offset: shift center opposite to tilt, fades as shading kicks in
  let offsetX = 0;
  let offsetY = 0;
  if (hasTilt) {
    const skewStrength = Math.min(1, tiltInfo.magnitude / tiltConfig.tolerance) * (1 - t * 0.5);
    offsetX = -Math.cos(tiltInfo.angle) * radius * tiltConfig.maxSkewOffset * skewStrength;
    offsetY = -Math.sin(tiltInfo.angle) * radius * tiltConfig.maxSkewOffset * skewStrength;
  }

  // More particles in shading mode to fill wider area
  const baseParticles = Math.max(1, Math.round(1.5 * diameter / particleSize));
  const numParticles = Math.round(baseParticles * (1 + 2 * t));

  // Opacity reduction in shading mode
  const tiltOpacityScale = hasTilt ? 1 - tiltConfig.opacityReduction * t : 1;

  // Distribution bias: center-heavy (0.8) → more uniform (0.5) in shading mode
  const centerBias = 0.8 - 0.3 * t;

  // Precompute rotation for ellipse alignment to tilt direction
  const cosA = hasTilt ? Math.cos(tiltInfo.angle) : 1;
  const sinA = hasTilt ? Math.sin(tiltInfo.angle) : 0;

  for (let j = 0; j < numParticles; j++) {
    // Two independent high-quality hashes for polar coordinates
    const h1 = hashFloat(stampCount, 0x9E3779B9);
    const h2 = hashFloat(stampCount, 0x517CC1B7);

    const rNorm = Math.pow(h1, centerBias);
    const theta = h2 * Math.PI * 2;

    let px: number, py: number;
    let edgeT: number;

    if (hasTilt && t > 0) {
      // Elliptical distribution aligned to tilt axis
      const ex = rNorm * majorRadius * Math.cos(theta);
      const ey = rNorm * minorRadius * Math.sin(theta);

      // Rotate ellipse to align major axis with tilt direction
      px = cx + ex * cosA - ey * sinA + offsetX;
      py = cy + ex * sinA + ey * cosA + offsetY;

      // Edge falloff using elliptical distance
      const exNorm = majorRadius > 0 ? ex / majorRadius : 0;
      const eyNorm = minorRadius > 0 ? ey / minorRadius : 0;
      edgeT = Math.sqrt(exNorm * exNorm + eyNorm * eyNorm);
    } else {
      // Standard circular distribution (with optional skew offset)
      const r = radius * rNorm;
      px = cx + r * Math.cos(theta) + offsetX;
      py = cy + r * Math.sin(theta) + offsetY;
      edgeT = r / radius;
    }

    const edgeFalloff = 1 - edgeT * edgeT;

    // Grain noise (scaled to stroke diameter for proportional texture)
    let alpha = computeGrainOpacity(px, py, grainValue, diameter);

    // Pressure modulates alpha
    if (penConfig.pressureOpacityRange) {
      const [minO, maxO] = penConfig.pressureOpacityRange;
      alpha *= minO + (maxO - minO) * pT;
    }

    // Apply edge falloff and tilt opacity
    alpha *= edgeFalloff * tiltOpacityScale;

    stamps.push({
      x: px, y: py,
      size: particleSize,
      opacity: Math.max(0, Math.min(1, alpha)),
      rotation: 0, scaleX: 1, scaleY: 1, tiltAngle: 0,
    });
    stampCount++;
  }

  return stampCount;
}

// ─── Grain Spatial Noise ─────────────────────────────────────

/**
 * Fast deterministic 2D hash for grain modulation.
 */
export function spatialHash2D(x: number, y: number): number {
  let ix = Math.floor(x) | 0;
  let iy = Math.floor(y) | 0;
  ix = Math.imul(ix, 0x85ebca6b) >>> 0;
  iy = Math.imul(iy, 0xc2b2ae35) >>> 0;
  const h = (ix ^ iy) >>> 0;
  return hash32(h) / 4294967296;
}

/**
 * Smooth 2D value noise using bilinear interpolation of hashed grid values.
 */
export function smoothNoise2D(x: number, y: number, scale: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v00 = spatialHash2D(ix, iy);
  const v10 = spatialHash2D(ix + 1, iy);
  const v01 = spatialHash2D(ix, iy + 1);
  const v11 = spatialHash2D(ix + 1, iy + 1);
  const top = v00 + (v10 - v00) * ux;
  const bot = v01 + (v11 - v01) * ux;
  return top + (bot - top) * uy;
}

/**
 * Compute per-particle grain alpha based on world position.
 *
 * grain=0 (coarse): high contrast, paper shows through
 * grain=1 (fine):   smooth dense fill
 *
 * `diameter` is the stroke width (not particle size) for proportional noise scale.
 */
function computeGrainOpacity(x: number, y: number, grainValue: number, diameter: number): number {
  const coarseScale = diameter * 3.0;
  const fineScale = diameter * 1.2;

  const n1 = smoothNoise2D(x, y, coarseScale);
  const n2 = smoothNoise2D(x + 137.5, y + 259.3, fineScale);
  const noise = n1 * 0.7 + n2 * 0.3;

  // grain=0 → base ~0.5, wide swing (lots of variation)
  // grain=1 → base ~1.0, minimal swing (uniform)
  const baseProbability = 0.5 + 0.5 * grainValue;
  const swing = 0.3 * (1 - grainValue);
  return baseProbability + (noise - 0.5) * swing * 2;
}

// ─── Internal Helpers ────────────────────────────────────────

function computeDiameter(
  pressure: number,
  style: PenStyle,
  penConfig: PenConfig,
): number {
  const [minW, maxW] = penConfig.pressureWidthRange;
  const pCurve = style.pressureCurve ?? penConfig.pressureCurve;
  const t = Math.pow(Math.max(0, Math.min(1, pressure)), pCurve);
  const widthMul = minW + (maxW - minW) * t;
  return style.width * widthMul;
}

export function interpolatePoint(
  p0: StrokePoint,
  p1: StrokePoint,
  t: number,
): StrokePoint {
  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    pressure: p0.pressure + (p1.pressure - p0.pressure) * t,
    tiltX: p0.tiltX + (p1.tiltX - p0.tiltX) * t,
    tiltY: p0.tiltY + (p1.tiltY - p0.tiltY) * t,
    twist: p0.twist + (p1.twist - p0.twist) * t,
    timestamp: p0.timestamp + (p1.timestamp - p0.timestamp) * t,
  };
}
