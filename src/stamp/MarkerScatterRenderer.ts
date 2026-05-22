/**
 * Marker scatter computation for the felt-tip pen.
 *
 * The felt pen is a FLOW brush: it deposits many semi-transparent particles
 * along the stroke path, composited source-over with NO isolation, so overlap
 * accumulates — a stroke that crosses itself builds up and darkens, exactly
 * like layering separate strokes.
 *
 * Unlike the pencil (which scatters round disc particles — correct for granular
 * graphite), the felt pen deposits oriented STREAK particles: curved capsules
 * (thick circular arcs) elongated along the direction of travel. A footprint is
 * a comb of such fibres laid across the nib width; stepped densely, successive
 * footprints overlap into a continuous ink ribbon.
 *
 * Fibre ORIENTATION is averaged over a centered arc-length window in
 * DOUBLED-ANGLE space (θ → (cos 2θ, sin 2θ)): this kills per-sample noise and
 * makes a 180° reversal a non-event (no criss-cross at back-and-forth turns).
 * Fibre CURVATURE is the signed turn rate of that orientation over the fibre's
 * own span, so each fibre is a circular arc that FOLLOWS the stroke instead of
 * chording it — curved strokes don't facet.
 *
 * The felt-tip "texture" comes from a world-anchored grain function sampled per
 * fibre: because it is a pure function of world position, overlapping fibres
 * reinforce it, it survives build-up, and the active (Canvas2D) and baked
 * (WebGL) paths — which both call this — draw exactly the same thing.
 *
 * Output is `StreakParams[]`, packed by `packStreaksToFloat32` and rendered
 * through the shared `drawStampStreaks` curved-capsule path.
 */

import type { StrokePoint, PenStyle } from "../types";
import type { PenConfig, MarkerScatterConfig } from "../stroke/PenConfigs";
import type { StreakParams } from "./StreakRenderer";
import { hashFloat, interpolatePoint, smoothNoise2D } from "./StampRenderer";

/** Independent hash seeds for per-fibre jitter. */
const SEED_POS = 0x9e3779b9;
const SEED_LEN = 0x2545f491;

/** Cross-stroke fraction beyond which a fibre's alpha fades (feathered edge). */
const EDGE_START = 0.86;

/** Fibres below this alpha are dropped (matches packStreaksToFloat32's cull). */
const MIN_ALPHA = 0.012;

/** World-space scale of the fibre-angle wobble noise — large, so it varies
 *  slowly enough that neighbouring fibres stay near-parallel. */
const WOBBLE_SCALE = 24;

/** Resultant magnitude (0-1) below which a windowed orientation average is
 *  treated as straddling a sharp corner rather than smoothing tremor. */
const MIN_COHERENCE = 0.35;

/** Aesthetic max arc half-aperture (rad): above this a fibre is SHORTENED
 *  rather than left as a long, hook-like arc that bands at sharp corners. */
const APERTURE_SOFT = 0.5;

/** Hard max arc half-aperture (rad) — final safety, keeps the arc SDF well-behaved. */
const APERTURE_HARD = 1.4;

/** Max thickening factor for a fibre shortened on a sharp bend — fatter fibres
 *  overlap enough to keep a sharp turn reading as solid ink, not banded combs. */
const CORNER_THICKEN_MAX = 2.0;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Wrap an orientation difference into (-π/2, π/2] — orientation is mod π. */
function wrapToHalfPi(a: number): number {
  return a - Math.PI * Math.round(a / Math.PI);
}

/** Wrap a travel-direction difference into (-π, π] — direction is mod 2π. */
function wrapToPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/**
 * World-anchored marker grain — the felt-tip texture.
 *
 * Isotropic value noise with a contrast curve: most fibres saturate toward
 * fully inked (→ 1) while fibres landing in noise "gaps" dip toward the floor
 * `1 - grainStrength`, reading as dry-marker streaks. The fibre look itself is
 * carried by the particle SHAPE; the grain only modulates fibre darkness.
 *
 * A pure function of world position: overlapping fibres sample the same value,
 * so the texture survives build-up and is identical active vs. baked.
 */
export function computeMarkerGrain(
  x: number,
  y: number,
  config: MarkerScatterConfig,
): number {
  const n1 = smoothNoise2D(x, y, config.grainScale);
  const n2 = smoothNoise2D(x * 1.9 + 33.3, y * 1.9 + 11.1, config.grainScale * 0.5);
  const n = n1 * 0.7 + n2 * 0.3; // [0, 1]

  // Contrast curve: most fibres saturate to fully inked; fibres in low-noise
  // "gaps" dip toward the floor — what makes overlap read as ink with dry
  // streaks rather than soft, uniform grain.
  const streak = smoothstep(0.3, 0.62, n);
  const floor = 1 - config.grainStrength;
  return floor + (1 - floor) * streak;
}

/**
 * World-anchored fibre-angle wobble. Because it is a smooth function of world
 * position, neighbouring fibres get near-identical offsets — they stay roughly
 * parallel (no criss-cross) while the overall fibre flow meanders gently.
 */
function angleWobble(x: number, y: number, config: MarkerScatterConfig): number {
  const n = smoothNoise2D(x + 71.7, y + 19.3, WOBBLE_SCALE); // [0, 1]
  return (n - 0.5) * 2 * config.streakAngleJitter;
}

/**
 * Smoothed fibre orientation at footprint `k` — the doubled-angle average of
 * segment directions over a centered window that shrinks adaptively.
 *
 * A fixed window spans a fixed arc length; on a tight curve that arc covers a
 * large rotation, and once the DOUBLED angle sweeps past ~180° the resultant
 * cancels then flips — the orientation freezes or points 90° off (the "comb
 * teeth" artifact). Shrinking the window until the doubled-angle resultant is
 * coherent keeps full tremor smoothing on straight runs while still tracking
 * the local orientation around tight loops. A 180° reversal stays coherent at
 * the full window (both legs share one orientation), so it is unaffected.
 */
function windowedOrientation(
  segC: Float64Array,
  segS: Float64Array,
  segCount: number,
  k: number,
  maxW: number,
): number {
  for (let ww = maxW; ww >= 1; ww = Math.floor(ww / 2)) {
    const lo = Math.max(0, k - ww);
    const hi = Math.min(segCount - 1, k + ww - 1);
    let sumC = 0;
    let sumS = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      sumC += segC[j];
      sumS += segS[j];
      n++;
    }
    if (n > 0 && Math.sqrt(sumC * sumC + sumS * sumS) / n > MIN_COHERENCE) {
      return 0.5 * Math.atan2(sumS, sumC);
    }
  }
  // Even the narrowest window is incoherent — a genuine sub-fibre sharp
  // feature. Use a single segment direction (no averaging → cannot flip).
  const j = Math.min(Math.max(k, 0), segCount - 1);
  return j >= 0 ? 0.5 * Math.atan2(segS[j], segC[j]) : 0;
}

interface ScatterParams {
  minW: number;
  maxW: number;
  pCurve: number;
  strokeWidth: number;
  /** Fibre cross-thickness, world units (already width-scaled). */
  streakWidth: number;
  /** Fibre length along travel, world units (already width-scaled). */
  streakLength: number;
  /** Arc-length between footprints, world units. */
  step: number;
  depletionRate: number;
  strokeOpacity: number;
}

/**
 * Emit one footprint — a comb of fibres laid across the nib width, each
 * elongated along `orientation` and curved by `curvature`.
 *
 * `count` is the running fibre index (drives deterministic jitter); the
 * returned value is the next index.
 */
function emitFootprint(
  streaks: StreakParams[],
  pt: StrokePoint,
  orientation: number,
  curvature: number,
  dirCurvature: number,
  cumulativeDistance: number,
  p: ScatterParams,
  config: MarkerScatterConfig,
  count: number,
): number {
  const pressure = clamp01(pt.pressure);
  const widthMul = p.minW + (p.maxW - p.minW) * Math.pow(pressure, p.pCurve);
  const nibWidth = p.strokeWidth * widthMul * config.footprintScale;
  if (nibWidth < 0.05) return count;

  const radius = p.streakWidth * 0.5;
  const halfLength = p.streakLength * 0.5;
  // Fibre CENTRES span (nibWidth - streakWidth) so fibre EDGES reach +/-nibWidth/2.
  const span = Math.max(0, nibWidth - p.streakWidth);

  // Dry-marker ink depletion: exponential falloff over cumulative distance.
  const depletion =
    p.depletionRate > 0
      ? Math.max(0.2, Math.exp(-cumulativeDistance * p.depletionRate))
      : 1;

  // One fibre per stratified cell across the nib.
  const fibreCount = Math.max(
    1,
    Math.round((config.density * nibWidth) / p.streakWidth),
  );

  // Unit perpendicular to the fibre orientation — the comb spreads along this.
  const perpX = -Math.sin(orientation);
  const perpY = Math.cos(orientation);

  for (let k = 0; k < fibreCount; k++) {
    const jPos = hashFloat(count, SEED_POS);
    const jLen = hashFloat(count, SEED_LEN);
    count++;

    // Jittered stratified cell centre → cross-stroke offset.
    const cell = fibreCount > 1 ? (k + jPos) / fibreCount : 0.5;
    const offset = (cell - 0.5) * span;

    const cx = pt.x + perpX * offset;
    const cy = pt.y + perpY * offset;

    // Feathered edge: outer fibres fade out.
    const edge = span > 0.001 ? Math.abs(offset) / (span * 0.5) : 0;
    const edgeFalloff = 1 - smoothstep(EDGE_START, 1, edge);
    if (edgeFalloff <= 0.001) continue;

    const grain = computeMarkerGrain(cx, cy, config);
    const alpha = config.flow * grain * depletion * edgeFalloff * p.strokeOpacity;
    if (alpha < MIN_ALPHA) continue;

    // Shorten the fibre on sharp bends so its arc stays short — long arcs hook
    // and a comb of hooks bands at a corner. ORIENTATION curvature shapes the
    // arc; the bend RATE that drives shortening is the LARGER of orientation
    // and DIRECTION curvature — a sharp corner barely rotates orientation but
    // turns direction a lot. Floor the length at 0.6·step so fibres overlap.
    const baseFibreHalf = halfLength * (0.78 + 0.44 * jLen);
    let fibreHalf = baseFibreHalf;
    let curv = curvature;
    const bendRate = Math.max(Math.abs(curv), Math.abs(dirCurvature));
    if (bendRate > 1e-6) {
      fibreHalf = Math.max(
        p.step * 0.6,
        Math.min(baseFibreHalf, APERTURE_SOFT / bendRate),
      );
    }
    // Final safety: guarantee the arc SDF's aperture stays well-behaved.
    const ac = Math.abs(curv);
    if (ac > 1e-6 && fibreHalf * ac > APERTURE_HARD) {
      curv = (curv > 0 ? 1 : -1) * (APERTURE_HARD / fibreHalf);
    }

    // Thicken a fibre in proportion to how much it was shortened, so the
    // shorter corner fibres still overlap enough to read as solid ink.
    const fibreRadius =
      radius * Math.min(CORNER_THICKEN_MAX, baseFibreHalf / fibreHalf);

    streaks.push({
      x: cx,
      y: cy,
      halfLength: fibreHalf,
      radius: fibreRadius,
      rotation: orientation + angleWobble(cx, cy, config),
      curvature: curv,
      opacity: alpha > 1 ? 1 : alpha,
    });
  }

  return count;
}

interface FootprintSample {
  pt: StrokePoint;
  /** Cumulative arc length at this footprint. */
  dist: number;
}

/**
 * Compute all marker streak particles for a complete stroke.
 */
export function computeAllMarkerScatter(
  points: readonly StrokePoint[],
  style: PenStyle,
  penConfig: PenConfig,
  config: MarkerScatterConfig,
): StreakParams[] {
  if (points.length === 0) return [];

  const [minW, maxW] = penConfig.pressureWidthRange;
  const inkDepletion = style.inkDepletion ?? 0;
  // Texture geometry scales with pen width so it reads consistently at any size.
  const widthScale =
    penConfig.baseWidth > 0 ? style.width / penConfig.baseWidth : 1;

  const streakLengthScaled = config.streakLength * widthScale;
  // Footprints overlap heavily (step < fibre length) so the ribbon is continuous.
  const step = Math.max(0.5, config.spacing * streakLengthScaled);

  const p: ScatterParams = {
    minW,
    maxW,
    pCurve: style.pressureCurve ?? penConfig.pressureCurve,
    strokeWidth: style.width,
    streakWidth: config.streakWidth * widthScale,
    streakLength: streakLengthScaled,
    step,
    depletionRate: config.inkDepletionRate * inkDepletion,
    strokeOpacity: style.opacity,
  };

  const streaks: StreakParams[] = [];

  // Single-point tap → one footprint.
  if (points.length === 1) {
    emitFootprint(streaks, points[0], 0, 0, 0, 0, p, config, 0);
    return streaks;
  }

  // ── Pass 1: sample footprint points at fixed arc-length intervals. ──
  const samples: FootprintSample[] = [];
  let cumulativeDistance = 0;
  let remainder = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 0.001) continue;

    let walked = -remainder;
    while (walked + step <= segLen) {
      walked += step;
      cumulativeDistance += step;
      samples.push({
        pt: interpolatePoint(p0, p1, walked / segLen),
        dist: cumulativeDistance,
      });
    }
    remainder = segLen - walked;
  }

  const first = points[0];
  const last = points[points.length - 1];

  // Stroke shorter than one step — emit a single footprint so it stays visible.
  if (samples.length === 0) {
    const o = Math.atan2(last.y - first.y, last.x - first.x);
    emitFootprint(streaks, last, o, 0, 0, 0, p, config, 0);
    return streaks;
  }

  // ── Pass 2a: smoothed fibre orientation per footprint. ──
  // Direction is averaged in DOUBLED-ANGLE space (θ → (cos 2θ, sin 2θ)) over an
  // adaptively-shrinking centered window — see windowedOrientation. This smooths
  // tremor on straight runs, treats 180° reversals as non-events, and still
  // tracks the local orientation around tight loops.
  const segCount = samples.length - 1;
  const segC = new Float64Array(Math.max(0, segCount));
  const segS = new Float64Array(Math.max(0, segCount));
  const segDir = new Float64Array(Math.max(0, segCount));
  for (let j = 0; j < segCount; j++) {
    const a = samples[j].pt;
    const b = samples[j + 1].pt;
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    segDir[j] = dir;
    segC[j] = Math.cos(2 * dir);
    segS[j] = Math.sin(2 * dir);
  }

  const windowMax = Math.max(1, Math.round(config.tangentSmoothing / step));
  const orientations = new Float64Array(samples.length);
  for (let k = 0; k < samples.length; k++) {
    orientations[k] = windowedOrientation(segC, segS, segCount, k, windowMax);
  }

  // ── Pass 2b: per-step orientation and direction deltas (each tiny → no wrap). ──
  const stepDelta = new Float64Array(Math.max(0, samples.length - 1));
  for (let k = 0; k < stepDelta.length; k++) {
    stepDelta[k] = wrapToHalfPi(orientations[k + 1] - orientations[k]);
  }
  const dirDelta = new Float64Array(Math.max(0, segCount - 1));
  for (let j = 0; j < dirDelta.length; j++) {
    dirDelta[j] = wrapToPi(segDir[j + 1] - segDir[j]);
  }

  // ── Pass 2c: emit each footprint. ──
  // The fibre arc follows the ORIENTATION turn rate over the fibre's span; a
  // separate DIRECTION turn rate flags sharp corners (which barely rotate
  // orientation, mod π) so emitFootprint can shorten the fibre there.
  const halfLength = p.streakLength * 0.5;
  const m = Math.max(1, Math.round(halfLength / step));
  let count = 0;
  for (let k = 0; k < samples.length; k++) {
    const lo = Math.max(0, k - m);
    const hi = Math.min(samples.length - 1, k + m);
    let turn = 0;
    for (let j = lo; j < hi; j++) turn += stepDelta[j];
    const arc = (hi - lo) * step;
    const curvature = arc > 1e-6 ? turn / arc : 0;

    const dLo = Math.max(0, k - m);
    const dHi = Math.min(segCount - 1, k + m);
    let dirTurn = 0;
    for (let j = dLo; j < dHi; j++) dirTurn += dirDelta[j];
    const dirArc = (dHi - dLo) * step;
    const dirCurv = dirArc > 1e-6 ? dirTurn / dirArc : 0;

    count = emitFootprint(
      streaks, samples[k].pt, orientations[k], curvature, dirCurv,
      samples[k].dist, p, config, count,
    );
  }

  return streaks;
}
