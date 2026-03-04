/**
 * Stroke Material Types + Resolver
 *
 * A StrokeMaterial is a declarative description of how to render a stroke:
 * what body drawing operation, what compositing mode, whether offscreen
 * isolation is needed, and what post-body effects to apply.
 *
 * resolveMaterial() is a pure function mapping (penConfig, style, pipeline, lod)
 * to the correct material. It mirrors the if/else dispatch chains in
 * StrokeRenderCore.ts but produces a data structure instead of executing code.
 */

import type { PenStyle, RenderPipeline } from "../types";
import type { PenConfig } from "../stroke/PenConfigs";
import type { LodLevel } from "../stroke/StrokeSimplifier";
import { getInkPreset } from "../stamp/InkPresets";

// ─── Body Types ─────────────────────────────────────────────

export interface FillBody {
  readonly type: "fill";
}

export interface StampDiscsBody {
  readonly type: "stampDiscs";
}

export interface InkShadingBody {
  readonly type: "inkShading";
}

export interface MarkerStampsBody {
  readonly type: "markerStamps";
}

export type StrokeBody = FillBody | StampDiscsBody | InkShadingBody | MarkerStampsBody;

// ─── Effect Types ───────────────────────────────────────────

export interface GrainEffect {
  readonly type: "grain";
}

export interface OutlineMaskEffect {
  readonly type: "outlineMask";
}

export interface InkPoolingEffect {
  readonly type: "inkPooling";
}

export interface FiberOverlayEffect {
  readonly type: "fiberOverlay";
  /** Fiber erasure strength (0-1). Computed from penConfig.markerStamp.fiberDensity. */
  readonly strength: number;
}

export type MaterialEffect = GrainEffect | OutlineMaskEffect | InkPoolingEffect | FiberOverlayEffect;

// ─── Material ───────────────────────────────────────────────

export interface StrokeMaterial {
  /** What drawing operation produces the stroke body. */
  readonly body: StrokeBody;
  /** Compositing blend mode. */
  readonly blending: "source-over" | "multiply";
  /** Alpha for the body rendering. */
  readonly bodyOpacity: number;
  /** Whether the body + effects need offscreen isolation. */
  readonly isolation: boolean;
  /** Post-body effects applied in order. */
  readonly effects: readonly MaterialEffect[];
}

// ─── Resolver ───────────────────────────────────────────────

/**
 * Resolve the rendering material for a stroke based on its pen config,
 * style overrides, pipeline, and LOD level.
 *
 * This mirrors the dispatch logic in StrokeRenderCore's renderStrokeToEngine()
 * and renderStrokeToContext(), producing an equivalent declarative description.
 */
export function resolveMaterial(
  penConfig: PenConfig,
  style: PenStyle,
  pipeline: RenderPipeline,
  lod: LodLevel,
): StrokeMaterial {
  // Highlighter always uses multiply compositing regardless of pipeline/LOD
  if (penConfig.highlighterMode) {
    return {
      body: { type: "fill" },
      blending: "multiply",
      bodyOpacity: penConfig.baseOpacity,
      isolation: false,
      effects: [],
    };
  }

  const isAdvancedLod0 = pipeline === "advanced" && lod === 0;

  // Ink-shaded fountain pen: offscreen stamps + outline mask
  // Matches: stampCtx && pipeline === "advanced" && penConfig.inkStamp && lod === 0
  if (isAdvancedLod0 && penConfig.inkStamp) {
    const presetConfig = getInkPreset(style.inkPreset);

    if (presetConfig.shading > 0) {
      return {
        body: { type: "inkShading" },
        blending: "source-over",
        bodyOpacity: style.opacity,
        isolation: true,
        effects: [{ type: "outlineMask" }],
      };
    }

    // No ink shading — fall through to fill.
    // Non-italic fountain pen (style.nibAngle not set) gets ink pooling.
    // Matches: style.nibAngle == null in StrokeRenderCore
    if (style.nibAngle == null) {
      return {
        body: { type: "fill" },
        blending: "source-over",
        bodyOpacity: style.opacity,
        isolation: false,
        effects: [{ type: "inkPooling" }],
      };
    }

    // Italic fountain pen without shading — plain fill
    return {
      body: { type: "fill" },
      blending: "source-over",
      bodyOpacity: style.opacity,
      isolation: false,
      effects: [],
    };
  }

  // Marker stamp rendering (felt-tip chisel stamps with outline mask)
  // Same approach as fountain pen ink shading: stamps provide texture,
  // outline mask clips to the stroke path to hide individual stamp edges.
  // Fiber overlay is applied BEFORE the mask to add visible felt-tip streaks.
  if (isAdvancedLod0 && penConfig.markerStamp) {
    const effects: MaterialEffect[] = [];
    if (penConfig.markerStamp.fiberDensity > 0) {
      effects.push({ type: "fiberOverlay", strength: 0.7 * penConfig.markerStamp.fiberDensity });
    }
    effects.push({ type: "outlineMask" });
    return {
      body: { type: "markerStamps" },
      blending: "source-over",
      bodyOpacity: style.opacity,
      isolation: true,
      effects,
    };
  }

  // Stamp-based pencil rendering
  // Matches: stampCtx && pipeline === "advanced" && penConfig.stamp && lod === 0
  if (isAdvancedLod0 && penConfig.stamp) {
    return {
      body: { type: "stampDiscs" },
      blending: "source-over",
      bodyOpacity: style.opacity,
      isolation: false,
      effects: [],
    };
  }

  // Grain-enabled fill in offscreen isolation
  // Matches: pipeline !== "basic" && lod === 0 && penConfig.grain?.enabled
  // Only reached if stamps didn't take priority above
  if (isAdvancedLod0 && penConfig.grain?.enabled) {
    return {
      body: { type: "fill" },
      blending: "source-over",
      bodyOpacity: style.opacity,
      isolation: true,
      effects: [{ type: "grain" }],
    };
  }

  // Default: simple fill
  return {
    body: { type: "fill" },
    blending: "source-over",
    bodyOpacity: style.opacity,
    isolation: false,
    effects: [],
  };
}
