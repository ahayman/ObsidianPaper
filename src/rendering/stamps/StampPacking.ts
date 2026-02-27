/**
 * Unified Stamp Packing
 *
 * Packs stamp parameter arrays into Float32Array [x, y, size, opacity] tuples.
 * Replaces both packStampsToFloat32() and packInkStampsToFloat32() from
 * src/stamp/StampPacking.ts with a single function.
 *
 * When minOpacity is provided, stamps below that threshold are filtered out
 * (pencil scatter uses 0.05 to match the Canvas2D drawStamps skip threshold).
 * When omitted, all stamps are packed (ink shading deposits all stamps).
 */

import type { StampResult } from "./StampTypes";

/**
 * Common stamp shape: must have x, y, size, opacity.
 * Accepts both StampParams and InkStampParams.
 */
interface PackableStamp {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly opacity: number;
}

/**
 * Pack stamps into a Float32Array of [x, y, size, opacity] tuples.
 *
 * @param stamps - Array of stamp parameters to pack
 * @param minOpacity - If provided, stamps with opacity below this are skipped.
 *                     Pencil scatter uses 0.05, ink shading uses undefined (no filter).
 */
export function packStamps(
  stamps: readonly PackableStamp[],
  minOpacity?: number,
): StampResult {
  if (stamps.length === 0) {
    return { data: new Float32Array(0), count: 0 };
  }

  if (minOpacity != null && minOpacity > 0) {
    // Two-pass: count then pack (avoids over-allocation)
    let count = 0;
    for (let i = 0; i < stamps.length; i++) {
      if (stamps[i].opacity >= minOpacity) count++;
    }
    const data = new Float32Array(count * 4);
    let j = 0;
    for (let i = 0; i < stamps.length; i++) {
      if (stamps[i].opacity < minOpacity) continue;
      data[j] = stamps[i].x;
      data[j + 1] = stamps[i].y;
      data[j + 2] = stamps[i].size;
      data[j + 3] = stamps[i].opacity;
      j += 4;
    }
    return { data, count };
  }

  // No filtering — pack all stamps
  const data = new Float32Array(stamps.length * 4);
  for (let i = 0; i < stamps.length; i++) {
    const off = i * 4;
    data[off] = stamps[i].x;
    data[off + 1] = stamps[i].y;
    data[off + 2] = stamps[i].size;
    data[off + 3] = stamps[i].opacity;
  }
  return { data, count: stamps.length };
}
