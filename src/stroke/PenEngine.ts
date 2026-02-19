import type { StrokePoint } from "../types";
import type { PenConfig } from "./PenConfigs";

export interface PointAttributes {
  width: number;
  opacity: number;
}

/**
 * Compute the width and opacity for a stroke point given a pen configuration.
 * This is the unified engine that handles all pen types through parameter variation.
 */
export function computePointAttributes(
  point: StrokePoint,
  config: PenConfig,
  prevPoint?: StrokePoint
): PointAttributes {
  // 1. Apply pressure curve (gamma)
  const effectivePressure = Math.pow(
    Math.max(0, Math.min(1, point.pressure)),
    config.pressureCurve
  );

  // 2. Compute base width from pressure
  const [minW, maxW] = config.pressureWidthRange;
  let width = config.baseWidth * lerp(minW, maxW, effectivePressure);

  // 3. Compute base opacity
  let opacity = config.baseOpacity;

  // 4. Pressure-based opacity (pencil)
  if (config.pressureOpacityRange) {
    const [minO, maxO] = config.pressureOpacityRange;
    opacity *= lerp(minO, maxO, effectivePressure);
  }

  // 5. Tilt-based adjustments (pencil)
  if (config.tiltSensitivity > 0) {
    const tiltFactor = computeTiltFactor(point.tiltX, point.tiltY);
    const tiltInfluence = tiltFactor * config.tiltSensitivity;

    // Tilt widens the stroke (pencil on its side)
    width *= 1 + tiltInfluence * 3;
    // Tilt reduces opacity (lighter strokes when tilted)
    opacity *= 1 - tiltInfluence * 0.6;
  }

  // 6. Fountain pen: angle-dependent width (flat nib cross-product)
  if (config.nibAngle !== null && config.nibThickness !== null) {
    const dx = prevPoint ? point.x - prevPoint.x : 0;
    const dy = prevPoint ? point.y - prevPoint.y : 0;

    // Use barrel rotation (twist) as dynamic nib angle when available
    const effectiveNibAngle =
      config.useBarrelRotation && point.twist !== 0
        ? (point.twist * Math.PI) / 180 // Convert degrees to radians
        : config.nibAngle;

    width = computeFountainWidth(
      config.baseWidth,
      config.nibThickness,
      effectiveNibAngle,
      dx, dy,
      effectivePressure
    );
  }

  // 7. Velocity-based thinning
  if (prevPoint && config.thinning > 0) {
    const velocity = computeVelocity(point, prevPoint);
    const thinFactor = velocityThinning(velocity, config.thinning);
    width *= thinFactor;
  }

  return {
    width: Math.max(0.1, width),
    opacity: Math.max(0, Math.min(1, opacity)),
  };
}

/**
 * Compute a tilt factor 0-1 from tiltX/tiltY.
 * 0 = perpendicular (no tilt), 1 = fully tilted (parallel to surface).
 */
function computeTiltFactor(tiltX: number, tiltY: number): number {
  // tiltX/tiltY are in degrees, range roughly -90 to 90
  // Magnitude of tilt vector, normalized to 0-1
  const tiltMagnitude = Math.sqrt(tiltX * tiltX + tiltY * tiltY);
  return Math.min(1, tiltMagnitude / 70); // 70 degrees ≈ max practical tilt
}

/**
 * Compute fountain pen width using flat nib (cross-product) projection.
 * For a rectangular italic nib, the projected width depends on the angle
 * between the stroke direction and the nib edge.
 *
 * Uses 2D cross product to avoid atan2+sin per point:
 *   |sin(Δ)| = |nx*sy - ny*sx|   (nib × stroke unit vectors)
 *   width = W * |sin(Δ)| + H * (1 - |sin(Δ)|)
 */
function computeFountainWidth(
  baseWidth: number,
  nibThickness: number,
  nibAngle: number,
  strokeDx: number,
  strokeDy: number,
  pressure: number
): number {
  const len = Math.hypot(strokeDx, strokeDy);
  if (len < 0.001) return baseWidth * nibThickness * lerp(0.5, 1.0, pressure);

  const sx = strokeDx / len;
  const sy = strokeDy / len;

  // Nib unit vector
  const nx = Math.cos(nibAngle);
  const ny = Math.sin(nibAngle);

  // |sin(nibAngle - strokeAngle)| via 2D cross product
  const crossMag = Math.abs(nx * sy - ny * sx);

  const W = baseWidth;                    // major axis (nib edge width)
  const H = baseWidth * nibThickness;     // minor axis (nib thickness)

  // Flat nib projection
  const projectedWidth = W * crossMag + H * (1 - crossMag);

  return projectedWidth * lerp(0.5, 1.0, pressure);
}

/**
 * Compute velocity between two consecutive points in px/ms.
 */
function computeVelocity(current: StrokePoint, prev: StrokePoint): number {
  const dx = current.x - prev.x;
  const dy = current.y - prev.y;
  const dt = current.timestamp - prev.timestamp;
  if (dt <= 0) return 0;
  return Math.sqrt(dx * dx + dy * dy) / dt;
}

/**
 * Compute a thinning factor based on velocity.
 * Fast movement → thinner strokes.
 * Returns a multiplier 0.5-1.0.
 */
function velocityThinning(velocity: number, thinning: number): number {
  // velocity is in px/ms. Typical pen velocity: 0.1-5 px/ms
  const normalizedSpeed = Math.min(1, velocity / 3);
  return 1 - normalizedSpeed * thinning * 0.5;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
