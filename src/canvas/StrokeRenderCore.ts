import type { Stroke, PenStyle, StrokePoint, PenType, RenderPipeline } from "../types";
import { decodePoints } from "../document/PointEncoder";
import {
  generateStrokePath,
  StrokePathCache,
} from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import type { GrainTextureGenerator } from "./GrainTextureGenerator";
import { lodCacheKey, simplifyPoints } from "../stroke/StrokeSimplifier";
import type { LodLevel } from "../stroke/StrokeSimplifier";
import { detectInkPools, renderInkPools } from "../stroke/InkPooling";

/**
 * Abstraction over grain rendering resources that works with both
 * HTMLCanvasElement (Renderer) and OffscreenCanvas (TileRenderer).
 */
export interface GrainRenderContext {
  generator: GrainTextureGenerator | null;
  strengthOverrides: Map<PenType, number>;
  /** Active rendering pipeline. "basic" skips grain and ink pooling. */
  pipeline: RenderPipeline;
  /**
   * Get or ensure an offscreen canvas of at least the given dimensions.
   * Returns null if grain rendering is unavailable.
   */
  getOffscreen(minW: number, minH: number): {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  } | null;
  /** Current canvas width in physical pixels (for screen-bbox computation). */
  canvasWidth: number;
  /** Current canvas height in physical pixels (for screen-bbox computation). */
  canvasHeight: number;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Resolve the effective PenStyle for a stroke, merging base style with overrides.
 */
export function resolveStyle(
  stroke: Stroke,
  styles: Record<string, PenStyle>
): PenStyle {
  const base = styles[stroke.style];
  if (!base) {
    return {
      pen: "ballpoint",
      color: "#1a1a1a",
      width: 2,
      opacity: 1,
      smoothing: 0.5,
      pressureCurve: 1,
      tiltSensitivity: 0,
    };
  }

  if (!stroke.styleOverrides) return base;
  return { ...base, ...stroke.styleOverrides };
}

/**
 * Render a single stroke onto a 2D context.
 * Extracted from Renderer.renderStrokeToContext() — shared between
 * the single-canvas Renderer and the tile-based TileRenderer.
 */
export function renderStrokeToContext(
  ctx: Ctx2D,
  stroke: Stroke,
  styles: Record<string, PenStyle>,
  lod: LodLevel,
  useDarkColors: boolean,
  pathCache: StrokePathCache,
  grainCtx: GrainRenderContext,
): void {
  // Get or generate Path2D (LOD-aware cache key)
  const cacheKey = lodCacheKey(stroke.id, lod);
  let path = pathCache.get(cacheKey);
  let decodedPoints: StrokePoint[] | undefined;
  if (!path) {
    const style = resolveStyle(stroke, styles);
    decodedPoints = decodePoints(stroke.pts);
    let points = decodedPoints;
    if (lod > 0) {
      points = simplifyPoints(points, lod);
    }
    path = generateStrokePath(points, style) ?? undefined;
    if (path) {
      pathCache.set(cacheKey, path);
    }
  }

  if (!path) return;

  const style = resolveStyle(stroke, styles);
  const color = resolveColor(style.color, useDarkColors);
  const penConfig = getPenConfig(style.pen);

  // Grain-enabled strokes are rendered in isolation on an offscreen canvas
  // so destination-out only affects this stroke
  if (grainCtx.pipeline !== "basic" && lod === 0 && penConfig.grain?.enabled) {
    const strength = grainCtx.strengthOverrides.get(style.pen) ?? penConfig.grain.strength;
    if (strength > 0) {
      const anchorX = stroke.grainAnchor?.[0] ?? stroke.bbox[0];
      const anchorY = stroke.grainAnchor?.[1] ?? stroke.bbox[1];
      renderStrokeWithGrain(
        ctx, path, color, style.opacity, strength,
        anchorX, anchorY, stroke.bbox,
        grainCtx,
      );
      return;
    }
  }

  if (penConfig.highlighterMode) {
    ctx.save();
    ctx.globalAlpha = penConfig.baseOpacity;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = color;
    ctx.fill(path);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.globalAlpha = style.opacity;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }

  // Fountain pen ink pooling (skip at high LOD, italic nib strokes, and basic pipeline)
  if (grainCtx.pipeline !== "basic" && style.pen === "fountain" && lod === 0 && style.nibAngle == null) {
    const points = decodedPoints ?? decodePoints(stroke.pts);
    const pools = detectInkPools(points, style.width);
    if (pools.length > 0) {
      renderInkPools(
        ctx as CanvasRenderingContext2D,
        pools,
        color,
      );
    }
  }
}

/**
 * Get a grain pattern from the generator, suitable for the given context.
 * Works with both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
 */
function getGrainPattern(
  ctx: Ctx2D,
  grainCtx: GrainRenderContext,
  patternCache: WeakMap<object, CanvasPattern>,
): CanvasPattern | null {
  const cached = patternCache.get(ctx);
  if (cached) return cached;

  if (!grainCtx.generator) return null;
  // GrainTextureGenerator.getPattern expects CanvasRenderingContext2D;
  // for OffscreenCanvasRenderingContext2D we cast since the canvas API
  // supports createPattern on both.
  const pattern = grainCtx.generator.getPattern(ctx as CanvasRenderingContext2D);
  if (pattern) {
    patternCache.set(ctx, pattern);
  }
  return pattern;
}

// Shared pattern cache across calls (keyed by context object)
const sharedPatternCache = new WeakMap<object, CanvasPattern>();

/**
 * Apply grain texture to a stroke path via destination-out compositing.
 */
export function applyGrainToStroke(
  ctx: Ctx2D,
  path: Path2D,
  grainStrength: number,
  anchorX: number,
  anchorY: number,
  grainCtx: GrainRenderContext,
): void {
  const pattern = getGrainPattern(ctx, grainCtx, sharedPatternCache);
  if (!pattern) return;

  ctx.save();
  ctx.clip(path);
  pattern.setTransform(
    new DOMMatrix().translateSelf(anchorX, anchorY).scaleSelf(0.3, 0.3)
  );
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = grainStrength;
  ctx.fillStyle = pattern;
  ctx.fill(path);
  ctx.restore();
}

/**
 * Transform a world-space bounding box to screen-pixel coordinates,
 * add a 2px anti-aliasing margin, and clip to canvas bounds.
 * Returns null if the bbox is fully off-screen.
 */
export function computeScreenBBox(
  bbox: [number, number, number, number],
  transform: DOMMatrix,
  canvasWidth: number,
  canvasHeight: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const { a, b, c, d, e, f } = transform;

  const corners: [number, number][] = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ];

  let minSx = Infinity, minSy = Infinity;
  let maxSx = -Infinity, maxSy = -Infinity;

  for (const [wx, wy] of corners) {
    const px = a * wx + c * wy + e;
    const py = b * wx + d * wy + f;
    if (px < minSx) minSx = px;
    if (py < minSy) minSy = py;
    if (px > maxSx) maxSx = px;
    if (py > maxSy) maxSy = py;
  }

  let sx = Math.floor(minSx) - 2;
  let sy = Math.floor(minSy) - 2;
  let sx2 = Math.ceil(maxSx) + 2;
  let sy2 = Math.ceil(maxSy) + 2;

  sx = Math.max(0, sx);
  sy = Math.max(0, sy);
  sx2 = Math.min(canvasWidth, sx2);
  sy2 = Math.min(canvasHeight, sy2);

  const sw = sx2 - sx;
  const sh = sy2 - sy;

  if (sw <= 0 || sh <= 0) return null;

  return { sx, sy, sw, sh };
}

/**
 * Render a single stroke with grain in isolation on an offscreen canvas,
 * then composite back to the target.
 */
function renderStrokeWithGrain(
  targetCtx: Ctx2D,
  path: Path2D,
  color: string,
  opacity: number,
  grainStrength: number,
  anchorX: number,
  anchorY: number,
  bbox: [number, number, number, number],
  grainCtx: GrainRenderContext,
): void {
  const m = targetCtx.getTransform();

  const region = computeScreenBBox(bbox, m, grainCtx.canvasWidth, grainCtx.canvasHeight);
  if (!region) return; // Fully off-screen

  const offW = region.sw;
  const offH = region.sh;

  const offscreen = grainCtx.getOffscreen(offW, offH);
  if (!offscreen) {
    // Fallback: draw directly without isolation
    targetCtx.fillStyle = color;
    targetCtx.globalAlpha = opacity;
    targetCtx.fill(path);
    targetCtx.globalAlpha = 1;
    return;
  }

  const offCtx = offscreen.ctx;

  // Clear only the used region
  offCtx.setTransform(1, 0, 0, 1, 0, 0);
  offCtx.clearRect(0, 0, offW, offH);

  // Offset transform so the bbox's screen origin maps to offscreen (0,0)
  offCtx.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);

  // Draw stroke fill on the isolated offscreen canvas
  offCtx.fillStyle = color;
  offCtx.globalAlpha = opacity;
  offCtx.fill(path);
  offCtx.globalAlpha = 1;

  // Apply grain — destination-out only affects this one stroke
  applyGrainToStroke(offCtx, path, grainStrength, anchorX, anchorY, grainCtx);

  // Composite the grain-textured stroke back to the main canvas.
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.drawImage(
    offscreen.canvas,
    0, 0, region.sw, region.sh,
    region.sx, region.sy, region.sw, region.sh,
  );
  targetCtx.restore();
}
