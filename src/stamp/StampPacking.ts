/**
 * Pack stamp parameter arrays into Float32Array for RenderEngine.drawStamps().
 * Layout: [x, y, size, opacity] per stamp (4 floats per stamp).
 */

import type { StampParams } from "./StampRenderer";
import type { InkStampParams } from "./InkStampRenderer";
import type { StreakParams } from "./StreakRenderer";

/**
 * Pack pencil stamps into a Float32Array for engine consumption.
 */
export function packStampsToFloat32(stamps: readonly StampParams[]): Float32Array {
  // First pass: count stamps that pass the opacity threshold
  // (matches the `opacity < 0.05` skip in Canvas2D drawStamps)
  let count = 0;
  for (let i = 0; i < stamps.length; i++) {
    if (stamps[i].opacity >= 0.05) count++;
  }

  const data = new Float32Array(count * 4);
  let j = 0;
  for (let i = 0; i < stamps.length; i++) {
    if (stamps[i].opacity < 0.05) continue;
    data[j] = stamps[i].x;
    data[j + 1] = stamps[i].y;
    data[j + 2] = stamps[i].size;
    data[j + 3] = stamps[i].opacity;
    j += 4;
  }
  return data;
}

/**
 * Pack ink shading stamps into a Float32Array for engine consumption.
 */
export function packInkStampsToFloat32(stamps: readonly InkStampParams[]): Float32Array {
  const data = new Float32Array(stamps.length * 4);
  for (let i = 0; i < stamps.length; i++) {
    data[i * 4] = stamps[i].x;
    data[i * 4 + 1] = stamps[i].y;
    data[i * 4 + 2] = stamps[i].size;
    data[i * 4 + 3] = stamps[i].opacity;
  }
  return data;
}

/** Streaks below this alpha are dropped. */
const STREAK_MIN_ALPHA = 0.012;

/**
 * Pack felt-tip streak particles into a Float32Array for engine consumption.
 * Layout: [cx, cy, halfLen, radius, cos, sin, opacity, curvature] per streak
 * (8 floats).
 *
 * Uses a low alpha cull — NOT the disc path's 0.05 — because the felt flow
 * brush deliberately deposits many sub-0.05 fibres that build up on overlap.
 */
export function packStreaksToFloat32(streaks: readonly StreakParams[]): Float32Array {
  let count = 0;
  for (let i = 0; i < streaks.length; i++) {
    if (streaks[i].opacity >= STREAK_MIN_ALPHA) count++;
  }

  const data = new Float32Array(count * 8);
  let j = 0;
  for (let i = 0; i < streaks.length; i++) {
    const s = streaks[i];
    if (s.opacity < STREAK_MIN_ALPHA) continue;
    data[j] = s.x;
    data[j + 1] = s.y;
    data[j + 2] = s.halfLength;
    data[j + 3] = s.radius;
    data[j + 4] = Math.cos(s.rotation);
    data[j + 5] = Math.sin(s.rotation);
    data[j + 6] = s.opacity;
    data[j + 7] = s.curvature;
    j += 8;
  }
  return data;
}