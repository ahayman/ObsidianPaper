/**
 * Outline Strategy Registry
 *
 * Abstracts outline generation behind a strategy pattern with two implementations:
 * - "standard": Uses perfect-freehand for smooth closed outlines (ballpoint, felt-tip, pencil, highlighter)
 * - "italic": Uses ItalicOutlineGenerator for nib-projected outlines (fountain pen with nibAngle)
 *
 * The italic strategy falls back to standard when the style lacks nibAngle/nibThickness,
 * handling fountain pens that can operate in both modes.
 */

import type { PenStyle, StrokePoint } from "../types";
import type { ItalicOutlineSides } from "./ItalicOutlineGenerator";
import { generateItalicOutlineSides } from "./ItalicOutlineGenerator";
import {
  generateOutline,
  isItalicStyle,
  buildItalicConfig,
} from "./OutlineGenerator";

// ─── Types ──────────────────────────────────────────────────

export type OutlineStrategyId = "standard" | "italic";

/**
 * Result of outline generation. Contains either a standard polygon outline
 * or italic left/right sides (never both).
 */
export interface OutlineResult {
  /** True if the result contains italic sides (triangle-based rendering). */
  italic: boolean;
  /** Standard outline polygon: array of [x, y] pairs (closed). Null for italic results. */
  outline: number[][] | null;
  /** Italic outline sides. Null for standard results. */
  italicSides: ItalicOutlineSides | null;
}

/**
 * Strategy for generating stroke outlines from decoded points and style.
 */
export interface OutlineStrategy {
  generateOutline(
    points: readonly StrokePoint[],
    style: PenStyle,
    dejitter?: boolean,
  ): OutlineResult | null;
}

// ─── Standard Strategy ──────────────────────────────────────

class StandardOutlineStrategy implements OutlineStrategy {
  generateOutline(
    points: readonly StrokePoint[],
    style: PenStyle,
    dejitter?: boolean,
  ): OutlineResult | null {
    const outline = generateOutline(points, style, dejitter);
    if (outline.length < 2) return null;
    return { italic: false, outline, italicSides: null };
  }
}

// ─── Italic Strategy ────────────────────────────────────────

class ItalicOutlineStrategy implements OutlineStrategy {
  generateOutline(
    points: readonly StrokePoint[],
    style: PenStyle,
    dejitter?: boolean,
  ): OutlineResult | null {
    // Fall back to standard when style doesn't have italic nib properties.
    // This handles fountain pens that can toggle between italic and non-italic modes.
    if (!isItalicStyle(style)) {
      const outline = generateOutline(points, style, dejitter);
      if (outline.length < 2) return null;
      return { italic: false, outline, italicSides: null };
    }

    const config = buildItalicConfig(style);
    const sides = generateItalicOutlineSides(points, config, dejitter);
    if (!sides) return null;
    return { italic: true, outline: null, italicSides: sides };
  }
}

// ─── Registry ───────────────────────────────────────────────

const standardStrategy = new StandardOutlineStrategy();
const italicStrategy = new ItalicOutlineStrategy();

export const OUTLINE_STRATEGIES: Record<OutlineStrategyId, OutlineStrategy> = {
  standard: standardStrategy,
  italic: italicStrategy,
};

/**
 * Get the outline strategy for a given strategy ID.
 */
export function getOutlineStrategy(id: OutlineStrategyId): OutlineStrategy {
  return OUTLINE_STRATEGIES[id];
}
