/**
 * Ink Shading Generator
 *
 * Wraps computeAllInkStamps() and computeInkStamps() from InkStampRenderer.ts
 * into the StampGenerator interface. Packs output into Float32Array.
 */

import type { StrokePoint, PenStyle } from "../../types";
import type { PenConfig } from "../../stroke/PenConfigs";
import type { InkPresetConfig } from "../../stamp/InkPresets";
import { getInkPreset } from "../../stamp/InkPresets";
import { computeAllInkStamps, computeInkStamps } from "../../stamp/InkStampRenderer";
import { packStamps } from "./StampPacking";
import type { StampGenerator, StampResult, StampAccumulatorState } from "./StampTypes";
import { registerStampGenerator } from "./StampTypes";

export const INK_SHADING_ID = "ink-shading";

const inkShadingGenerator: StampGenerator = {
  computeAll(
    points: readonly StrokePoint[],
    style: PenStyle,
    penConfig: PenConfig,
    presetConfig?: InkPresetConfig,
  ): StampResult {
    if (!penConfig.inkStamp) {
      return { data: new Float32Array(0), count: 0 };
    }
    const preset = presetConfig ?? getInkPreset(style.inkPreset);
    const stamps = computeAllInkStamps(points, style, penConfig, penConfig.inkStamp, preset);
    // Ink stamps don't filter by opacity threshold (all stamps are deposited)
    return packStamps(stamps);
  },

  computeIncremental(
    points: readonly StrokePoint[],
    fromIndex: number,
    toIndex: number,
    accumulator: StampAccumulatorState,
    style: PenStyle,
    penConfig: PenConfig,
    presetConfig?: InkPresetConfig,
  ): StampResult {
    if (!penConfig.inkStamp) {
      return { data: new Float32Array(0), count: 0 };
    }
    const preset = presetConfig ?? getInkPreset(style.inkPreset);
    const { stamps, newRemainder, newStampCount } = computeInkStamps(
      points, fromIndex, toIndex, accumulator.remainder,
      style, penConfig, penConfig.inkStamp, preset, accumulator.stampCount,
    );

    // Update accumulator state
    accumulator.lastPointIndex = toIndex;
    accumulator.remainder = newRemainder;
    accumulator.stampCount = newStampCount;

    // No opacity filter for ink stamps
    return packStamps(stamps);
  },
};

// Self-register on import
registerStampGenerator(INK_SHADING_ID, inkShadingGenerator);

export { inkShadingGenerator };
