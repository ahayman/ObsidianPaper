import type { Stroke, PenStyle, StrokePoint, PenType, RenderPipeline } from "../types";
import { decodePoints } from "../document/PointEncoder";
import {
  generateOutline,
  generateStrokePath,
  StrokePathCache,
} from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import type { RenderEngine, TextureHandle } from "./engine/RenderEngine";
import { packStampsToFloat32, packInkStampsToFloat32 } from "../stamp/StampPacking";
import type { GrainTextureGenerator } from "./GrainTextureGenerator";
import { lodCacheKey, simplifyPoints } from "../stroke/StrokeSimplifier";
import type { LodLevel } from "../stroke/StrokeSimplifier";
import { detectInkPools, renderInkPools } from "../stroke/InkPooling";
import type { StampCache } from "../stamp/StampCache";
import { computeAllStamps, drawStamps } from "../stamp/StampRenderer";
import { computeAllInkStamps, drawInkShadingStamps } from "../stamp/InkStampRenderer";
import { getInkPreset } from "../stamp/InkPresets";
import type { InkPresetConfig } from "../stamp/InkPresets";
import type { PenConfig } from "../stroke/PenConfigs";
import { DEFAULT_GRAIN_VALUE, grainToTextureStrength } from "../stamp/GrainMapping";

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

/**
 * Context for stamp-based rendering. Null when stamps are not initialized.
 */
export interface StampRenderContext {
  getCache(grainValue: number): StampCache;
  getInkCache(presetId?: string): StampCache;
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
  stampCtx?: StampRenderContext | null,
): void {
  const style = resolveStyle(stroke, styles);
  const penConfig = getPenConfig(style.pen);

  // Ink-shaded fountain pen rendering at LOD 0:
  // Clip to the italic outline path and deposit colored stamps via source-over
  // on an offscreen canvas, then composite back.
  if (stampCtx && grainCtx.pipeline === "stamps" && penConfig.inkStamp && lod === 0) {
    // Generate outline path (same as basic rendering)
    const cacheKey = lodCacheKey(stroke.id, lod);
    let path = pathCache.get(cacheKey);
    let decodedPts: StrokePoint[] | undefined;
    if (!path) {
      decodedPts = decodePoints(stroke.pts);
      path = generateStrokePath(decodedPts, style) ?? undefined;
      if (path) pathCache.set(cacheKey, path);
    }
    if (!path) return;

    const color = resolveColor(style.color, useDarkColors);
    const presetConfig = getInkPreset(style.inkPreset);

    // If no shading, just fill directly
    if (presetConfig.shading <= 0) {
      ctx.fillStyle = color;
      ctx.globalAlpha = style.opacity;
      ctx.fill(path);
      ctx.globalAlpha = 1;
      return;
    }

    const points = decodedPts ?? decodePoints(stroke.pts);

    renderInkShadedStroke(
      ctx, path, color, style, penConfig, points, presetConfig,
      stampCtx, grainCtx, stroke.bbox,
    );
    return;
  }

  // Stamp-based rendering for pencil at LOD 0
  if (stampCtx && grainCtx.pipeline === "stamps" && penConfig.stamp && lod === 0) {
    const color = resolveColor(style.color, useDarkColors);
    const points = decodePoints(stroke.pts);
    const stamps = computeAllStamps(points, style, penConfig, penConfig.stamp);
    drawStamps(ctx, stamps, color, ctx.getTransform(), style.opacity);
    return;
  }

  // Get or generate Path2D (LOD-aware cache key)
  const cacheKey = lodCacheKey(stroke.id, lod);
  let path = pathCache.get(cacheKey);
  let decodedPoints: StrokePoint[] | undefined;
  if (!path) {
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

  const color = resolveColor(style.color, useDarkColors);

  // Grain-enabled strokes are rendered in isolation on an offscreen canvas
  // so destination-out only affects this stroke
  if (grainCtx.pipeline !== "basic" && lod === 0 && penConfig.grain?.enabled) {
    const baseStrength = grainCtx.strengthOverrides.get(style.pen) ?? penConfig.grain.strength;
    const grainValue = style.grain ?? DEFAULT_GRAIN_VALUE;
    const strength = grainToTextureStrength(baseStrength, grainValue);
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
 * Render an ink-shaded fountain pen stroke:
 * 1. Draw colored stamps with source-over on an offscreen canvas
 *    (slow areas → high deposit → dark; fast → low deposit → light)
 * 2. Mask to the italic outline path via destination-in compositing
 * 3. Composite result back to the main canvas
 *
 * The stroke SHAPE comes from the italic outline generator (destination-in mask).
 * The stamps DEPOSIT color — self-overlap builds saturation correctly.
 */
function renderInkShadedStroke(
  targetCtx: Ctx2D,
  path: Path2D,
  color: string,
  style: PenStyle,
  penConfig: PenConfig,
  points: readonly StrokePoint[],
  presetConfig: InkPresetConfig,
  stampCtx: StampRenderContext,
  grainCtx: GrainRenderContext,
  bbox: [number, number, number, number],
): void {
  // Expand bbox by stroke width — the raw bbox is just centerline min/max
  // and doesn't account for the italic nib projection width.
  const wm = style.width * 1.5;
  const expandedBbox: [number, number, number, number] = [
    bbox[0] - wm, bbox[1] - wm, bbox[2] + wm, bbox[3] + wm,
  ];
  const m = targetCtx.getTransform();
  const region = computeScreenBBox(expandedBbox, m, grainCtx.canvasWidth, grainCtx.canvasHeight);
  if (!region) return;

  const offscreen = grainCtx.getOffscreen(region.sw, region.sh);
  if (!offscreen) {
    // Fallback: just fill without shading
    targetCtx.fillStyle = color;
    targetCtx.globalAlpha = style.opacity;
    targetCtx.fill(path);
    targetCtx.globalAlpha = 1;
    return;
  }

  const offCtx = offscreen.ctx;
  offCtx.setTransform(1, 0, 0, 1, 0, 0);
  offCtx.clearRect(0, 0, region.sw, region.sh);
  offCtx.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);

  // 1. Deposit colored stamps via source-over.
  //    Stamps deposit ink in inverse proportion to velocity: slow = more deposit = darker.
  //    Center gets ~7 overlapping stamps, edges ~2 → center is darker (physically accurate).
  //    Self-overlapping strokes build up saturation instead of cancelling.
  const stamps = computeAllInkStamps(points, style, penConfig, penConfig.inkStamp!, presetConfig);
  const inkCache = stampCtx.getInkCache(style.inkPreset);
  const stampTexture = inkCache.getColored(color);
  drawInkShadingStamps(offCtx, stamps, stampTexture, offCtx.getTransform(), style.opacity);

  // 2. Mask to the stroke outline path: keep deposited stamp pixels only within the path.
  //    destination-in keeps existing pixels (stamps) only where the source (path fill) has alpha.
  offCtx.globalCompositeOperation = "destination-in";
  offCtx.globalAlpha = 1;
  offCtx.fill(path);
  offCtx.globalCompositeOperation = "source-over";

  // 3. Composite the shaded stroke back to the main canvas
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.drawImage(
    offscreen.canvas,
    0, 0, region.sw, region.sh,
    region.sx, region.sy, region.sw, region.sh,
  );
  targetCtx.restore();
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

// ══════════════════════════════════════════════════════════════
// RenderEngine-based stroke rendering
// ══════════════════════════════════════════════════════════════

/**
 * Grain rendering context for RenderEngine path.
 * Similar to GrainRenderContext but uses TextureHandle instead of pattern.
 */
export interface EngineGrainContext {
  grainTexture: TextureHandle | null;
  strengthOverrides: Map<PenType, number>;
  pipeline: RenderPipeline;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Stamp rendering context for RenderEngine path.
 */
export interface EngineStampContext {
  getStampTexture(grainValue: number, color: string): TextureHandle;
  getInkStampTexture(presetId: string | undefined, color: string): TextureHandle;
}

/**
 * Render a single stroke using the RenderEngine abstraction.
 * Parallel function to renderStrokeToContext() — same logic but uses
 * engine.fillPath(vertices), engine.drawStamps(), etc.
 *
 * The old renderStrokeToContext() remains for workers (raw Canvas 2D).
 */
export function renderStrokeToEngine(
  engine: RenderEngine,
  stroke: Stroke,
  styles: Record<string, PenStyle>,
  lod: LodLevel,
  useDarkColors: boolean,
  pathCache: StrokePathCache,
  grainCtx: EngineGrainContext,
  stampCtx?: EngineStampContext | null,
): void {
  const style = resolveStyle(stroke, styles);
  const penConfig = getPenConfig(style.pen);

  // Ink-shaded fountain pen rendering at LOD 0
  if (stampCtx && grainCtx.pipeline === "stamps" && penConfig.inkStamp && lod === 0) {
    const cacheKey = lodCacheKey(stroke.id, lod);
    let vertices = pathCache.getVertices(cacheKey);
    let decodedPts: StrokePoint[] | undefined;
    if (!vertices) {
      decodedPts = decodePoints(stroke.pts);
      const outline = generateOutline(decodedPts, style);
      if (outline.length >= 2) {
        pathCache.setOutline(cacheKey, outline);
        vertices = pathCache.getVertices(cacheKey);
      }
    }
    if (!vertices) return;

    const color = resolveColor(style.color, useDarkColors);
    const presetConfig = getInkPreset(style.inkPreset);

    if (presetConfig.shading <= 0) {
      engine.setFillColor(color);
      engine.setAlpha(style.opacity);
      engine.fillPath(vertices);
      engine.setAlpha(1);
      return;
    }

    const points = decodedPts ?? decodePoints(stroke.pts);
    renderInkShadedStrokeEngine(
      engine, vertices, color, style, penConfig, points, presetConfig,
      stampCtx, grainCtx, stroke.bbox,
    );
    return;
  }

  // Stamp-based rendering for pencil at LOD 0
  if (stampCtx && grainCtx.pipeline === "stamps" && penConfig.stamp && lod === 0) {
    const color = resolveColor(style.color, useDarkColors);
    const points = decodePoints(stroke.pts);
    const stamps = computeAllStamps(points, style, penConfig, penConfig.stamp);
    const texture = stampCtx.getStampTexture(style.grain ?? DEFAULT_GRAIN_VALUE, color);
    engine.drawStamps(texture, packStampsToFloat32(stamps));
    return;
  }

  // Get or generate vertices (LOD-aware cache key)
  const cacheKey = lodCacheKey(stroke.id, lod);
  let vertices = pathCache.getVertices(cacheKey);
  let decodedPoints: StrokePoint[] | undefined;
  if (!vertices) {
    decodedPoints = decodePoints(stroke.pts);
    let points = decodedPoints;
    if (lod > 0) {
      points = simplifyPoints(points, lod);
    }
    const outline = generateOutline(points, style);
    if (outline.length >= 2) {
      pathCache.setOutline(cacheKey, outline);
      vertices = pathCache.getVertices(cacheKey);
    }
  }

  if (!vertices) return;

  const color = resolveColor(style.color, useDarkColors);

  // Grain-enabled strokes rendered in isolation on offscreen target
  if (grainCtx.pipeline !== "basic" && lod === 0 && penConfig.grain?.enabled) {
    const baseStrength = grainCtx.strengthOverrides.get(style.pen) ?? penConfig.grain.strength;
    const grainValue = style.grain ?? DEFAULT_GRAIN_VALUE;
    const strength = grainToTextureStrength(baseStrength, grainValue);
    if (strength > 0 && grainCtx.grainTexture) {
      const anchorX = stroke.grainAnchor?.[0] ?? stroke.bbox[0];
      const anchorY = stroke.grainAnchor?.[1] ?? stroke.bbox[1];
      renderStrokeWithGrainEngine(
        engine, vertices, color, style.opacity, strength,
        anchorX, anchorY, stroke.bbox,
        grainCtx,
      );
      return;
    }
  }

  if (penConfig.highlighterMode) {
    engine.save();
    engine.setAlpha(penConfig.baseOpacity);
    engine.setBlendMode("multiply");
    engine.setFillColor(color);
    engine.fillPath(vertices);
    engine.restore();
  } else {
    engine.setFillColor(color);
    engine.setAlpha(style.opacity);
    engine.fillPath(vertices);
    engine.setAlpha(1);
  }

  // Fountain pen ink pooling (skip at high LOD, italic nib strokes, and basic pipeline)
  if (grainCtx.pipeline !== "basic" && style.pen === "fountain" && lod === 0 && style.nibAngle == null) {
    const points = decodedPoints ?? decodePoints(stroke.pts);
    const pools = detectInkPools(points, style.width);
    if (pools.length > 0) {
      // Ink pooling uses raw Canvas 2D — skip in engine path for now.
      // TODO: Implement engine-based ink pooling if needed.
    }
  }
}

/**
 * Render an ink-shaded fountain pen stroke using RenderEngine offscreen targets.
 */
function renderInkShadedStrokeEngine(
  engine: RenderEngine,
  vertices: Float32Array,
  color: string,
  style: PenStyle,
  penConfig: PenConfig,
  points: readonly StrokePoint[],
  presetConfig: InkPresetConfig,
  stampCtx: EngineStampContext,
  grainCtx: EngineGrainContext,
  bbox: [number, number, number, number],
): void {
  const wm = style.width * 1.5;
  const expandedBbox: [number, number, number, number] = [
    bbox[0] - wm, bbox[1] - wm, bbox[2] + wm, bbox[3] + wm,
  ];
  const m = engine.getTransform();
  const region = computeScreenBBox(expandedBbox, m, grainCtx.canvasWidth, grainCtx.canvasHeight);
  if (!region) return;

  const offscreen = engine.getOffscreen("inkShading", region.sw, region.sh);
  engine.beginOffscreen(offscreen);
  engine.clear();
  engine.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);

  // 1. Deposit colored stamps via source-over
  const stamps = computeAllInkStamps(points, style, penConfig, penConfig.inkStamp!, presetConfig);
  const texture = stampCtx.getInkStampTexture(style.inkPreset, color);
  engine.setAlpha(style.opacity);
  engine.drawStamps(texture, packInkStampsToFloat32(stamps));

  // 2. Mask to outline via destination-in
  engine.setBlendMode("destination-in");
  engine.setAlpha(1);
  engine.setFillColor("#ffffff");
  engine.fillPath(vertices);
  engine.setBlendMode("source-over");

  engine.endOffscreen();

  // 3. Composite back
  engine.save();
  engine.setTransform(1, 0, 0, 1, 0, 0);
  engine.drawOffscreen(offscreen, region.sx, region.sy, region.sw, region.sh);
  engine.restore();
}

/**
 * Render a stroke with grain in isolation on an offscreen target via RenderEngine.
 */
function renderStrokeWithGrainEngine(
  engine: RenderEngine,
  vertices: Float32Array,
  color: string,
  opacity: number,
  grainStrength: number,
  anchorX: number,
  anchorY: number,
  bbox: [number, number, number, number],
  grainCtx: EngineGrainContext,
): void {
  const m = engine.getTransform();
  const region = computeScreenBBox(bbox, m, grainCtx.canvasWidth, grainCtx.canvasHeight);
  if (!region) return;

  const offscreen = engine.getOffscreen("grainIsolation", region.sw, region.sh);
  engine.beginOffscreen(offscreen);
  engine.clear();
  engine.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);

  // Draw stroke fill
  engine.setFillColor(color);
  engine.setAlpha(opacity);
  engine.fillPath(vertices);
  engine.setAlpha(1);

  // Apply grain — destination-out eraser
  if (grainCtx.grainTexture) {
    engine.save();
    engine.clipPath(vertices);
    engine.applyGrain(grainCtx.grainTexture, anchorX, anchorY, grainStrength);
    engine.restore();
  }

  engine.endOffscreen();

  // Composite back
  engine.save();
  engine.setTransform(1, 0, 0, 1, 0, 0);
  engine.drawOffscreen(offscreen, region.sx, region.sy, region.sw, region.sh);
  engine.restore();
}
