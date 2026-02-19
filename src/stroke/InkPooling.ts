import type { StrokePoint } from "../types";

/**
 * Represents an ink pool location where ink would naturally accumulate.
 * Pools form at stroke start/end and at sharp direction changes
 * where the pen dwells (low velocity).
 */
export interface InkPool {
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

/** Velocity threshold (px/ms) below which pooling can occur. */
const VELOCITY_THRESHOLD = 0.3;

/** Curvature threshold (radians) above which a direction change is considered "sharp". */
const CURVATURE_THRESHOLD = 0.5;

/** Minimum pool radius in world units. */
const MIN_POOL_RADIUS = 0.5;

/** Maximum pool radius as fraction of stroke width. */
const MAX_POOL_RADIUS_FACTOR = 1.5;

/** Base opacity for ink pools. */
const POOL_BASE_OPACITY = 0.15;

/**
 * Detect ink pool locations along a stroke.
 * Pools form where the pen dwells — at stroke start/end and
 * at sharp direction changes with low velocity.
 *
 * @param points - Stroke points in world coordinates
 * @param strokeWidth - Base stroke width for scaling pool size
 * @returns Array of ink pool locations
 */
export function detectInkPools(
  points: readonly StrokePoint[],
  strokeWidth: number
): InkPool[] {
  if (points.length < 2) return [];

  const pools: InkPool[] = [];
  const maxRadius = strokeWidth * MAX_POOL_RADIUS_FACTOR;

  // Pool at stroke start (pen down — always pools slightly)
  const startPressure = points[0].pressure;
  pools.push({
    x: points[0].x,
    y: points[0].y,
    radius: Math.max(MIN_POOL_RADIUS, maxRadius * startPressure * 0.8),
    opacity: POOL_BASE_OPACITY * startPressure,
  });

  // Scan interior points for dwell + curvature
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const velocity = computeVelocity(prev, curr);
    if (velocity > VELOCITY_THRESHOLD) continue;

    const curvature = computeCurvature(prev, curr, next);
    if (curvature < CURVATURE_THRESHOLD) continue;

    // Pool size proportional to pressure and inversely proportional to velocity
    const dwellFactor = 1 - Math.min(1, velocity / VELOCITY_THRESHOLD);
    const radius = Math.max(
      MIN_POOL_RADIUS,
      maxRadius * curr.pressure * dwellFactor
    );

    pools.push({
      x: curr.x,
      y: curr.y,
      radius,
      opacity: POOL_BASE_OPACITY * curr.pressure * dwellFactor,
    });
  }

  // Pool at stroke end (pen lift — ink settles)
  const endPoint = points[points.length - 1];
  const endPressure = endPoint.pressure;
  pools.push({
    x: endPoint.x,
    y: endPoint.y,
    radius: Math.max(MIN_POOL_RADIUS, maxRadius * endPressure * 0.6),
    opacity: POOL_BASE_OPACITY * endPressure * 0.8,
  });

  return pools;
}

/**
 * Render ink pools onto a canvas context.
 * Each pool is a radial gradient from slightly darker center to transparent edge.
 */
export function renderInkPools(
  ctx: CanvasRenderingContext2D,
  pools: readonly InkPool[],
  color: string
): void {
  for (const pool of pools) {
    if (pool.radius < MIN_POOL_RADIUS || pool.opacity <= 0) continue;

    const gradient = ctx.createRadialGradient(
      pool.x,
      pool.y,
      0,
      pool.x,
      pool.y,
      pool.radius
    );

    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "transparent");

    ctx.save();
    ctx.globalAlpha = pool.opacity;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(pool.x, pool.y, pool.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function computeVelocity(a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dt = b.timestamp - a.timestamp;
  if (dt <= 0) return 0;
  return Math.sqrt(dx * dx + dy * dy) / dt;
}

/**
 * Compute the angle change (curvature) at point b given prev a and next c.
 * Returns absolute angle in radians (0 = straight line, PI = full reversal).
 */
function computeCurvature(
  a: StrokePoint,
  b: StrokePoint,
  c: StrokePoint
): number {
  const angle1 = Math.atan2(b.y - a.y, b.x - a.x);
  const angle2 = Math.atan2(c.y - b.y, c.x - b.x);
  let diff = angle2 - angle1;

  // Normalize to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  return Math.abs(diff);
}
