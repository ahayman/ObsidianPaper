/**
 * Shared Stamp Types + Generator Interface
 *
 * Unifies the two stamp systems (pencil scatter, ink shading) behind
 * a common StampGenerator interface. Each generator wraps the existing
 * computation functions, and the registry maps string IDs to generators.
 *
 * This enables the MaterialExecutor / StrokeDataPreparer to request
 * stamp data via a registry key rather than knowing which renderer to call.
 */

import type { StrokePoint, PenStyle } from "../../types";
import type { PenConfig } from "../../stroke/PenConfigs";
import type { InkPresetConfig } from "../../stamp/InkPresets";

// ─── Common Stamp Output ────────────────────────────────────

/**
 * Unified stamp output: Float32Array of [x, y, size, opacity] tuples.
 * This is the format consumed by DrawingBackend.drawStampDiscs() and drawStamps().
 */
export interface StampResult {
  /** Packed stamp data: [x, y, size, opacity] per stamp. */
  data: Float32Array;
  /** Number of stamps (data.length / 4). */
  count: number;
}

// ─── Accumulator (incremental stamp computation) ────────────

/**
 * State for incremental stamp computation during active stroke drawing.
 * Shared between pencil scatter and ink shading.
 */
export interface StampAccumulatorState {
  /** Index of the last point that was fully processed. */
  lastPointIndex: number;
  /** Distance remainder from last stamp to end of last segment. */
  remainder: number;
  /** Total stamp count so far (used for deterministic jitter). */
  stampCount: number;
}

export function createAccumulatorState(): StampAccumulatorState {
  return { lastPointIndex: 0, remainder: 0, stampCount: 0 };
}

// ─── Generator Interface ────────────────────────────────────

/**
 * A stamp generator computes stamp placements for a pen type.
 *
 * Two methods:
 * - computeAll(): For complete strokes (tile rendering, static layer).
 * - computeIncremental(): For active stroke (appends stamps as points arrive).
 */
export interface StampGenerator {
  /**
   * Compute all stamps for a complete set of stroke points.
   * Returns packed Float32Array of [x, y, size, opacity] tuples.
   */
  computeAll(
    points: readonly StrokePoint[],
    style: PenStyle,
    penConfig: PenConfig,
    presetConfig?: InkPresetConfig,
  ): StampResult;

  /**
   * Compute stamps incrementally for a range of points.
   * Used during active stroke rendering to avoid recomputing the full stroke.
   */
  computeIncremental(
    points: readonly StrokePoint[],
    fromIndex: number,
    toIndex: number,
    accumulator: StampAccumulatorState,
    style: PenStyle,
    penConfig: PenConfig,
    presetConfig?: InkPresetConfig,
  ): StampResult;
}

// ─── Registry ───────────────────────────────────────────────

const STAMP_GENERATORS = new Map<string, StampGenerator>();

/**
 * Register a stamp generator by ID.
 */
export function registerStampGenerator(id: string, generator: StampGenerator): void {
  STAMP_GENERATORS.set(id, generator);
}

/**
 * Get a stamp generator by ID. Returns undefined if not registered.
 */
export function getStampGenerator(id: string): StampGenerator | undefined {
  return STAMP_GENERATORS.get(id);
}

/**
 * Get all registered generator IDs.
 */
export function getRegisteredGeneratorIds(): string[] {
  return Array.from(STAMP_GENERATORS.keys());
}

/**
 * Clear all registered generators (for testing).
 */
export function clearStampGenerators(): void {
  STAMP_GENERATORS.clear();
}
