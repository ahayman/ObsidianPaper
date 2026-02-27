/**
 * Pencil Scatter Generator
 *
 * Wraps computeAllStamps() and computeStamps() from StampRenderer.ts
 * into the StampGenerator interface. Packs output into Float32Array.
 */

import type { StrokePoint, PenStyle } from "../../types";
import type { PenConfig } from "../../stroke/PenConfigs";
import { computeAllStamps, computeStamps } from "../../stamp/StampRenderer";
import { packStamps } from "./StampPacking";
import type { StampGenerator, StampResult, StampAccumulatorState } from "./StampTypes";
import { registerStampGenerator } from "./StampTypes";

export const PENCIL_SCATTER_ID = "pencil-scatter";

const pencilScatterGenerator: StampGenerator = {
  computeAll(
    points: readonly StrokePoint[],
    style: PenStyle,
    penConfig: PenConfig,
  ): StampResult {
    if (!penConfig.stamp) {
      return { data: new Float32Array(0), count: 0 };
    }
    const stamps = computeAllStamps(points, style, penConfig, penConfig.stamp);
    return packStamps(stamps, 0.05);
  },

  computeIncremental(
    points: readonly StrokePoint[],
    fromIndex: number,
    toIndex: number,
    accumulator: StampAccumulatorState,
    style: PenStyle,
    penConfig: PenConfig,
  ): StampResult {
    if (!penConfig.stamp) {
      return { data: new Float32Array(0), count: 0 };
    }
    const { stamps, newRemainder, newStampCount } = computeStamps(
      points, fromIndex, toIndex, accumulator.remainder,
      style, penConfig, penConfig.stamp, accumulator.stampCount,
    );

    // Update accumulator state
    accumulator.lastPointIndex = toIndex;
    accumulator.remainder = newRemainder;
    accumulator.stampCount = newStampCount;

    return packStamps(stamps, 0.05);
  },
};

// Self-register on import
registerStampGenerator(PENCIL_SCATTER_ID, pencilScatterGenerator);

export { pencilScatterGenerator };
