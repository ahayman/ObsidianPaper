/**
 * Pack stamp parameter arrays into Float32Array for RenderEngine.drawStamps().
 * Layout: [x, y, size, opacity] per stamp (4 floats per stamp).
 */

import type { StampParams } from "./StampRenderer";
import type { InkStampParams } from "./InkStampRenderer";

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