/**
 * Stroke Data Preparer
 *
 * Computes all numerical data needed by the MaterialExecutor from a stroke,
 * style, pen config, and material. Decodes points, generates outlines using
 * the OutlineStrategy registry, computes stamps, detects ink pools, and
 * resolves colors.
 *
 * Integrates with StrokePathCache for caching outline data across frames.
 */

import type { Stroke, PenStyle, StrokePoint } from "../types";
import type { PenConfig } from "../stroke/PenConfigs";
import type { StrokeMaterial } from "./StrokeMaterial";
import type { StrokeRenderData } from "./MaterialExecutor";
import type { LodLevel } from "../stroke/StrokeSimplifier";
import { decodePoints, quantizePoints } from "../document/PointEncoder";
import { simplifyPoints, lodCacheKey } from "../stroke/StrokeSimplifier";
import { getOutlineStrategy } from "../stroke/OutlineStrategy";
import {
  StrokePathCache,
  isItalicStyle,
  buildItalicConfig,
} from "../stroke/OutlineGenerator";
import { generateItalicOutlineSides } from "../stroke/ItalicOutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { computeAllStamps } from "../stamp/StampRenderer";
import { computeAllInkStamps } from "../stamp/InkStampRenderer";
import { packStampsToFloat32, packInkStampsToFloat32 } from "../stamp/StampPacking";
import { getInkPreset } from "../stamp/InkPresets";
import { DEFAULT_GRAIN_VALUE, grainToTextureStrength } from "../stamp/GrainMapping";
import { detectInkPools } from "../stroke/InkPooling";

// ─── Public API ─────────────────────────────────────────────

/**
 * Prepare all rendering data for a stroke given its material.
 *
 * This mirrors the data preparation scattered across renderStrokeToEngine()
 * and renderStrokeToContext() in StrokeRenderCore.ts, but produces a single
 * StrokeRenderData structure that the MaterialExecutor consumes.
 */
export function prepareStrokeData(
  stroke: Stroke,
  style: PenStyle,
  penConfig: PenConfig,
  material: StrokeMaterial,
  pathCache: StrokePathCache,
  lod: LodLevel,
  useDarkColors: boolean,
  grainStrengthOverride?: number,
): StrokeRenderData {
  const color = resolveColor(style.color, useDarkColors);
  const cacheKey = lodCacheKey(stroke.id, lod);
  const needsVertices = materialNeedsVertices(material);
  const needsStamps = material.body.type === "stampDiscs" || material.body.type === "inkShading";

  // Decode points (lazy — only if we need to generate outline or stamps)
  let decodedPoints: StrokePoint[] | undefined;
  function getPoints(): StrokePoint[] {
    if (!decodedPoints) {
      decodedPoints = decodePoints(stroke.pts);
    }
    return decodedPoints;
  }

  // ── Vertices (outline) ────────────────────────────────
  let vertices: Float32Array | null = null;
  let italic = false;

  if (needsVertices) {
    // Try cache first
    vertices = pathCache.getVertices(cacheKey) ?? null;
    italic = pathCache.isItalic(cacheKey);

    if (!vertices) {
      let points = getPoints();
      if (lod > 0) {
        points = simplifyPoints(points, lod);
      }

      // Use the outline strategy from the pen config
      const strategy = getOutlineStrategy(penConfig.outlineStrategy);
      const result = strategy.generateOutline(points, style);

      if (result) {
        italic = result.italic;
        if (result.italic && result.italicSides) {
          pathCache.setItalicSides(cacheKey, result.italicSides);
        } else if (result.outline && result.outline.length >= 2) {
          pathCache.setOutline(cacheKey, result.outline);
        }
        vertices = pathCache.getVertices(cacheKey) ?? null;
      }
    }
  }

  // ── Stamp data ────────────────────────────────────────
  let stampData: Float32Array | undefined;

  if (needsStamps) {
    const points = getPoints();

    if (material.body.type === "stampDiscs" && penConfig.stamp) {
      const stamps = computeAllStamps(points, style, penConfig, penConfig.stamp);
      stampData = packStampsToFloat32(stamps);
    } else if (material.body.type === "inkShading" && penConfig.inkStamp) {
      const presetConfig = getInkPreset(style.inkPreset);
      const stamps = computeAllInkStamps(points, style, penConfig, penConfig.inkStamp, presetConfig);
      stampData = packInkStampsToFloat32(stamps);
    }
  }

  // ── Grain data ────────────────────────────────────────
  let grainAnchor: [number, number] | undefined;
  let grainStrength: number | undefined;

  if (hasEffect(material, "grain") && penConfig.grain?.enabled) {
    const baseStrength = grainStrengthOverride ?? penConfig.grain.strength;
    const grainValue = style.grain ?? DEFAULT_GRAIN_VALUE;
    grainStrength = grainToTextureStrength(baseStrength, grainValue);
    grainAnchor = [
      stroke.grainAnchor?.[0] ?? stroke.bbox[0],
      stroke.grainAnchor?.[1] ?? stroke.bbox[1],
    ];
  }

  return {
    vertices,
    italic,
    color,
    bbox: stroke.bbox,
    stampData,
    grainAnchor,
    grainStrength,
    strokeWidth: style.width,
  };
}

/**
 * Prepare render data from live (decoded) points for active stroke rendering.
 * Does not use path cache or point decoding.
 */
export function prepareActiveStrokeData(
  points: readonly StrokePoint[],
  style: PenStyle,
  penConfig: PenConfig,
  material: StrokeMaterial,
  useDarkColors: boolean,
  bbox: [number, number, number, number],
  grainAnchor?: [number, number],
  grainStrengthOverride?: number,
): StrokeRenderData {
  const color = resolveColor(style.color, useDarkColors);
  const needsVertices = materialNeedsVertices(material);
  const needsStamps = material.body.type === "stampDiscs" || material.body.type === "inkShading";

  // ── Vertices ──────────────────────────────────────────
  let vertices: Float32Array | null = null;
  let italic = false;

  if (needsVertices) {
    const strategy = getOutlineStrategy(penConfig.outlineStrategy);
    const result = strategy.generateOutline(points, style);
    if (result) {
      italic = result.italic;
      // For active strokes, convert directly without cache
      if (result.italic && result.italicSides) {
        // Import lazily if needed — for now use the same cache mechanism
        const { italicSidesToFloat32Array } = require("../stroke/OutlineGenerator");
        vertices = italicSidesToFloat32Array(result.italicSides) ?? null;
      } else if (result.outline) {
        const { outlineToFloat32Array } = require("../stroke/OutlineGenerator");
        vertices = outlineToFloat32Array(result.outline) ?? null;
      }
    }
  }

  // ── Stamp data ────────────────────────────────────────
  let stampData: Float32Array | undefined;

  if (needsStamps) {
    // Quantize points to match encode→decode precision used by final render
    const qPoints = quantizePoints(points);
    if (material.body.type === "stampDiscs" && penConfig.stamp) {
      const stamps = computeAllStamps(qPoints, style, penConfig, penConfig.stamp);
      stampData = packStampsToFloat32(stamps);
    } else if (material.body.type === "inkShading" && penConfig.inkStamp) {
      const presetConfig = getInkPreset(style.inkPreset);
      const stamps = computeAllInkStamps(qPoints, style, penConfig, penConfig.inkStamp, presetConfig);
      stampData = packInkStampsToFloat32(stamps);
    }
  }

  // ── Grain data ────────────────────────────────────────
  let grainStrength: number | undefined;
  let resolvedGrainAnchor: [number, number] | undefined;

  if (hasEffect(material, "grain") && penConfig.grain?.enabled) {
    const baseStrength = grainStrengthOverride ?? penConfig.grain.strength;
    const grainValue = style.grain ?? DEFAULT_GRAIN_VALUE;
    grainStrength = grainToTextureStrength(baseStrength, grainValue);
    resolvedGrainAnchor = grainAnchor ?? [bbox[0], bbox[1]];
  }

  return {
    vertices,
    italic,
    color,
    bbox,
    stampData,
    grainAnchor: resolvedGrainAnchor,
    grainStrength,
    strokeWidth: style.width,
  };
}

// ─── Helpers ────────────────────────────────────────────────

/** Check whether the material needs outline vertices (for fill, mask, or grain clip). */
function materialNeedsVertices(material: StrokeMaterial): boolean {
  if (material.body.type === "fill") return true;
  // Ink shading needs vertices for the outline mask effect
  if (material.effects.some((e) => e.type === "outlineMask")) return true;
  // Grain needs vertices for clipping
  if (material.effects.some((e) => e.type === "grain")) return true;
  return false;
}

/** Check if a material has a specific effect type. */
function hasEffect(material: StrokeMaterial, type: string): boolean {
  return material.effects.some((e) => e.type === type);
}
