/**
 * Web Worker entry point for tile rendering.
 *
 * Bundled as a self-contained IIFE by esbuild (no externals).
 * Receives document data from main thread, renders tiles on
 * OffscreenCanvas, and returns ImageBitmaps (zero-copy transfer).
 */

// Worker global scope — use `workerSelf` to get proper postMessage typing.
// The file is bundled as IIFE for a Web Worker but compiled with the main tsconfig (DOM lib).
const workerSelf = self as unknown as {
  postMessage(message: unknown, options?: { transfer?: Transferable[] }): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
};

import type {
  MainToWorkerMessage,
  WorkerRenderTileMessage,
} from "./TileWorkerProtocol";
import type { Stroke, PenStyle, PenType, Page, StrokePoint } from "../../../types";
import type { PageRect } from "../../../document/PageLayout";
import type { LodLevel } from "../../../stroke/StrokeSimplifier";

// Pure function imports (bundled into worker by esbuild)
import { decodePoints } from "../../../document/PointEncoder";
import {
  generateStrokePath,
  StrokePathCache,
} from "../../../stroke/OutlineGenerator";
import { selectLodLevel, simplifyPoints, lodCacheKey } from "../../../stroke/StrokeSimplifier";
import { resolveColor } from "../../../color/ColorPalette";
import { getPenConfig } from "../../../stroke/PenConfigs";
import type { PenConfig } from "../../../stroke/PenConfigs";
import type { InkPresetConfig } from "../../../stamp/InkPresets";
import { resolvePageBackground } from "../../../color/ColorUtils";
import { detectInkPools } from "../../../stroke/InkPooling";
import { zoomBandBaseZoom } from "../TileTypes";
import { generateStampTexture } from "../../../stamp/StampTexture";
import { computeAllStamps, drawStamps } from "../../../stamp/StampRenderer";
import { computeAllInkStamps, drawInkShadingStamps } from "../../../stamp/InkStampRenderer";
import { getInkPreset } from "../../../stamp/InkPresets";
import { generateInkStampTexture } from "../../../stamp/InkStampTexture";
import { grainSliderToConfig, grainConfigKey, DEFAULT_GRAIN_VALUE, grainToTextureStrength } from "../../../stamp/GrainMapping";

// ─── Worker State ────────────────────────────────────────────

let strokes: Stroke[] = [];
let styles: Record<string, PenStyle> = {};
let pages: Page[] = [];
let pageLayout: PageRect[] = [];
let renderPipeline = "textures";

const pathCache = new StrokePathCache();

// Grain texture state
let grainCanvas: OffscreenCanvas | null = null;
let grainCtx: OffscreenCanvasRenderingContext2D | null = null;
let grainStrengthOverrides = new Map<PenType, number>();

// Reusable offscreen canvas for grain-isolated stroke rendering
let grainOffscreen: OffscreenCanvas | null = null;
let grainOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

// Stamp texture state (multi-grain: each grain config key → alpha template)
let stampEnabled = false;
let stampTextureCache = new Map<string, OffscreenCanvas>(); // configKey → alpha template
let stampColorCaches = new Map<string, Map<string, OffscreenCanvas>>(); // configKey → (color → colored)

// Ink stamp texture state (keyed by preset ID)
let inkStampEnabled = false;
let inkStampTextureCache = new Map<string, OffscreenCanvas>(); // presetId → alpha template
let inkStampColorCaches = new Map<string, Map<string, OffscreenCanvas>>(); // presetId → (color → colored)

// ─── Grain Helpers ───────────────────────────────────────────

function initGrainFromImageData(imageData: ImageData | null): void {
  if (!imageData) {
    grainCanvas = null;
    grainCtx = null;
    return;
  }
  grainCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  grainCtx = grainCanvas.getContext("2d");
  if (grainCtx) {
    grainCtx.putImageData(imageData, 0, 0);
  }
}

function getGrainPattern(
  ctx: OffscreenCanvasRenderingContext2D,
): CanvasPattern | null {
  if (!grainCanvas) return null;
  return ctx.createPattern(grainCanvas, "repeat");
}

function applyGrainToStroke(
  ctx: OffscreenCanvasRenderingContext2D,
  path: Path2D,
  grainStrength: number,
  anchorX: number,
  anchorY: number,
): void {
  const pattern = getGrainPattern(ctx);
  if (!pattern) return;

  ctx.save();
  ctx.clip(path);
  pattern.setTransform(
    new DOMMatrix().translateSelf(anchorX, anchorY).scaleSelf(0.3, 0.3),
  );
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = grainStrength;
  ctx.fillStyle = pattern;
  ctx.fill(path);
  ctx.restore();
}

function ensureGrainOffscreen(
  minW: number,
  minH: number,
): OffscreenCanvasRenderingContext2D | null {
  minW = Math.max(256, Math.ceil(minW));
  minH = Math.max(256, Math.ceil(minH));

  if (!grainOffscreen) {
    grainOffscreen = new OffscreenCanvas(minW, minH);
    grainOffscreenCtx = grainOffscreen.getContext("2d");
  } else if (grainOffscreen.width < minW || grainOffscreen.height < minH) {
    grainOffscreen = new OffscreenCanvas(
      Math.max(grainOffscreen.width, minW),
      Math.max(grainOffscreen.height, minH),
    );
    grainOffscreenCtx = grainOffscreen.getContext("2d");
  }

  return grainOffscreenCtx;
}

// ─── Stamp Helpers ────────────────────────────────────────────

function getStampAlpha(configKey: string, grainValue: number): OffscreenCanvas {
  const cached = stampTextureCache.get(configKey);
  if (cached) return cached;

  const config = grainSliderToConfig(grainValue);
  const canvas = generateStampTexture(config);
  stampTextureCache.set(configKey, canvas);
  return canvas;
}

function getColoredStampForGrain(grainValue: number, color: string): OffscreenCanvas | null {
  if (!stampEnabled) return null;

  const config = grainSliderToConfig(grainValue);
  const configKey = grainConfigKey(config);

  // Get or create color cache for this grain config
  let colorCache = stampColorCaches.get(configKey);
  if (!colorCache) {
    colorCache = new Map();
    stampColorCaches.set(configKey, colorCache);
  }

  const cached = colorCache.get(color);
  if (cached) return cached;

  // Generate alpha template and color it
  const alpha = getStampAlpha(configKey, grainValue);
  const size = alpha.width;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(alpha, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  colorCache.set(color, canvas);
  return canvas;
}

// ─── Ink Stamp Helpers ─────────────────────────────────────────

function getInkStampAlpha(presetId: string): OffscreenCanvas {
  const cached = inkStampTextureCache.get(presetId);
  if (cached) return cached;

  const preset = getInkPreset(presetId);
  const canvas = generateInkStampTexture({
    edgeDarkening: preset.edgeDarkening,
    grainInfluence: preset.grainInfluence,
  });
  inkStampTextureCache.set(presetId, canvas);
  return canvas;
}

function getColoredInkStamp(presetId: string, color: string): OffscreenCanvas | null {
  if (!inkStampEnabled) return null;

  let colorCache = inkStampColorCaches.get(presetId);
  if (!colorCache) {
    colorCache = new Map();
    inkStampColorCaches.set(presetId, colorCache);
  }

  const cached = colorCache.get(color);
  if (cached) return cached;

  const alpha = getInkStampAlpha(presetId);
  const size = alpha.width;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(alpha, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  colorCache.set(color, canvas);
  return canvas;
}

// ─── Background Rendering ────────────────────────────────────

const DESK_COLORS = {
  light: "#e8e8e8",
  dark: "#111111",
};

const LINE_COLORS = {
  light: "#c8d0d8",
  dark: "#3a3f47",
};

const DOT_COLORS = {
  light: "#b0b8c0",
  dark: "#4a4f57",
};

const SHADOW_OFFSET_X = 0;
const SHADOW_OFFSET_Y = 2;
const SHADOW_BLUR = 8;
const SHADOW_COLOR = "rgba(0, 0, 0, 0.20)";

function renderDeskFill(
  ctx: OffscreenCanvasRenderingContext2D,
  worldBounds: [number, number, number, number],
  isDarkMode: boolean,
): void {
  ctx.fillStyle = isDarkMode ? DESK_COLORS.dark : DESK_COLORS.light;
  ctx.fillRect(
    worldBounds[0],
    worldBounds[1],
    worldBounds[2] - worldBounds[0],
    worldBounds[3] - worldBounds[1],
  );
}

function renderPageBackground(
  ctx: OffscreenCanvasRenderingContext2D,
  page: Page,
  pageRect: PageRect,
  isDarkMode: boolean,
  lineScale: number,
): void {
  const { paperColor, patternTheme } = resolvePageBackground(
    page.backgroundColor,
    page.backgroundColorTheme,
    isDarkMode,
  );

  // Shadow
  ctx.save();
  ctx.shadowOffsetX = SHADOW_OFFSET_X * lineScale;
  ctx.shadowOffsetY = SHADOW_OFFSET_Y * lineScale;
  ctx.shadowBlur = SHADOW_BLUR * lineScale;
  ctx.shadowColor = SHADOW_COLOR;
  ctx.fillStyle = paperColor;
  ctx.fillRect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
  ctx.restore();

  // Clean fill (no shadow)
  ctx.fillStyle = paperColor;
  ctx.fillRect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);

  // Patterns
  if (page.paperType !== "blank") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
    ctx.clip();

    const margins = page.margins;
    const minX = pageRect.x + margins.left;
    const minY = pageRect.y + margins.top;
    const maxX = pageRect.x + pageRect.width - margins.right;
    const maxY = pageRect.y + pageRect.height - margins.bottom;

    if (minX < maxX && minY < maxY) {
      switch (page.paperType) {
        case "lined":
          renderLines(ctx, patternTheme, page.lineSpacing, lineScale, minX, minY, maxX, maxY);
          break;
        case "grid":
          renderGrid(ctx, patternTheme, page.gridSize, lineScale, minX, minY, maxX, maxY);
          break;
        case "dot-grid":
          renderDotGrid(ctx, patternTheme, page.gridSize, lineScale, minX, minY, maxX, maxY);
          break;
      }
    }

    ctx.restore();
  }
}

function renderLines(
  ctx: OffscreenCanvasRenderingContext2D,
  patternTheme: "light" | "dark",
  lineSpacing: number,
  lineScale: number,
  minX: number, minY: number, maxX: number, maxY: number,
): void {
  ctx.strokeStyle = LINE_COLORS[patternTheme];
  ctx.lineWidth = lineScale;
  const startY = Math.ceil(minY / lineSpacing) * lineSpacing;
  ctx.beginPath();
  for (let y = startY; y <= maxY; y += lineSpacing) {
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
  }
  ctx.stroke();
}

function renderGrid(
  ctx: OffscreenCanvasRenderingContext2D,
  patternTheme: "light" | "dark",
  gridSize: number,
  lineScale: number,
  minX: number, minY: number, maxX: number, maxY: number,
): void {
  ctx.strokeStyle = LINE_COLORS[patternTheme];
  ctx.lineWidth = lineScale;
  const startX = Math.ceil(minX / gridSize) * gridSize;
  const startY = Math.ceil(minY / gridSize) * gridSize;
  ctx.beginPath();
  for (let x = startX; x <= maxX; x += gridSize) {
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
  }
  for (let y = startY; y <= maxY; y += gridSize) {
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
  }
  ctx.stroke();
}

function renderDotGrid(
  ctx: OffscreenCanvasRenderingContext2D,
  patternTheme: "light" | "dark",
  gridSize: number,
  lineScale: number,
  minX: number, minY: number, maxX: number, maxY: number,
): void {
  ctx.fillStyle = DOT_COLORS[patternTheme];
  const dotRadius = 1.5 * lineScale;
  const startX = Math.ceil(minX / gridSize) * gridSize;
  const startY = Math.ceil(minY / gridSize) * gridSize;
  for (let x = startX; x <= maxX; x += gridSize) {
    for (let y = startY; y <= maxY; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ─── Stroke Rendering ────────────────────────────────────────

function resolveStyle(
  stroke: Stroke,
  stylesMap: Record<string, PenStyle>,
): PenStyle {
  const base = stylesMap[stroke.style];
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

function computeScreenBBox(
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

function renderInkPools(
  ctx: OffscreenCanvasRenderingContext2D,
  pools: readonly { x: number; y: number; radius: number; opacity: number }[],
  color: string,
): void {
  for (const pool of pools) {
    const gradient = ctx.createRadialGradient(
      pool.x, pool.y, 0,
      pool.x, pool.y, pool.radius,
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "transparent");
    ctx.save();
    ctx.globalAlpha = pool.opacity;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(pool.x, pool.y, pool.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function renderStrokeWithGrain(
  targetCtx: OffscreenCanvasRenderingContext2D,
  path: Path2D,
  color: string,
  opacity: number,
  grainStrength: number,
  anchorX: number,
  anchorY: number,
  bbox: [number, number, number, number],
  canvasWidth: number,
  canvasHeight: number,
): void {
  const m = targetCtx.getTransform();

  const region = computeScreenBBox(bbox, m, canvasWidth, canvasHeight);
  if (!region) return;

  const offCtx = ensureGrainOffscreen(region.sw, region.sh);
  if (!offCtx || !grainOffscreen) {
    // Fallback: draw directly without isolation
    targetCtx.fillStyle = color;
    targetCtx.globalAlpha = opacity;
    targetCtx.fill(path);
    targetCtx.globalAlpha = 1;
    return;
  }

  offCtx.setTransform(1, 0, 0, 1, 0, 0);
  offCtx.clearRect(0, 0, region.sw, region.sh);
  offCtx.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);

  offCtx.fillStyle = color;
  offCtx.globalAlpha = opacity;
  offCtx.fill(path);
  offCtx.globalAlpha = 1;

  applyGrainToStroke(offCtx, path, grainStrength, anchorX, anchorY);

  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.drawImage(
    grainOffscreen,
    0, 0, region.sw, region.sh,
    region.sx, region.sy, region.sw, region.sh,
  );
  targetCtx.restore();
}

/**
 * Render an ink-shaded fountain pen stroke in the worker:
 * 1. Fill the italic outline path on an offscreen canvas (solid base)
 * 2. Apply velocity-based shading via destination-out stamp compositing
 * 3. Composite result back to the main canvas
 */
function renderInkShadedStrokeWorker(
  targetCtx: OffscreenCanvasRenderingContext2D,
  path: Path2D,
  color: string,
  style: PenStyle,
  penConfig: PenConfig,
  points: readonly StrokePoint[],
  presetConfig: InkPresetConfig,
  bbox: [number, number, number, number],
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Expand bbox by stroke width — raw bbox is centerline min/max only
  const wm = style.width * 1.5;
  const expandedBbox: [number, number, number, number] = [
    bbox[0] - wm, bbox[1] - wm, bbox[2] + wm, bbox[3] + wm,
  ];
  const m = targetCtx.getTransform();
  const region = computeScreenBBox(expandedBbox, m, canvasWidth, canvasHeight);
  if (!region) return;

  const offCtx = ensureGrainOffscreen(region.sw, region.sh);
  if (!offCtx || !grainOffscreen) {
    // Fallback: just fill without shading
    targetCtx.fillStyle = color;
    targetCtx.globalAlpha = style.opacity;
    targetCtx.fill(path);
    targetCtx.globalAlpha = 1;
    return;
  }

  offCtx.setTransform(1, 0, 0, 1, 0, 0);
  offCtx.clearRect(0, 0, region.sw, region.sh);
  offCtx.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);

  // 1. Solid fill on offscreen (the italic outline path defines the shape)
  offCtx.fillStyle = color;
  offCtx.globalAlpha = style.opacity;
  offCtx.fill(path);
  offCtx.globalAlpha = 1;

  // 2. Apply velocity-based shading via destination-out stamps
  offCtx.globalCompositeOperation = "destination-out";

  const stamps = computeAllInkStamps(points, style, penConfig, penConfig.inkStamp!, presetConfig);
  const presetId = style.inkPreset ?? "standard";
  const stampTexture = getColoredInkStamp(presetId, color); // color irrelevant for dest-out
  if (stampTexture) {
    drawInkShadingStamps(offCtx, stamps, stampTexture, offCtx.getTransform());
  }

  offCtx.globalCompositeOperation = "source-over";

  // 3. Composite the shaded stroke back to the main canvas
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.drawImage(
    grainOffscreen,
    0, 0, region.sw, region.sh,
    region.sx, region.sy, region.sw, region.sh,
  );
  targetCtx.restore();
}

function renderStroke(
  ctx: OffscreenCanvasRenderingContext2D,
  stroke: Stroke,
  lod: LodLevel,
  useDarkColors: boolean,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const style = resolveStyle(stroke, styles);
  const penConfig = getPenConfig(style.pen);

  // Ink-shaded fountain pen rendering at LOD 0:
  // Fill the italic outline path, then apply velocity-based shading
  // via destination-out stamp compositing on an offscreen canvas.
  if (inkStampEnabled && renderPipeline === "stamps" && penConfig.inkStamp && lod === 0) {
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

    renderInkShadedStrokeWorker(
      ctx, path, color, style, penConfig, points, presetConfig,
      stroke.bbox, canvasWidth, canvasHeight,
    );
    return;
  }

  // Stamp-based rendering for pencil at LOD 0
  if (stampEnabled && renderPipeline === "stamps" && penConfig.stamp && lod === 0) {
    const color = resolveColor(style.color, useDarkColors);
    const points = decodePoints(stroke.pts);
    const stamps = computeAllStamps(points, style, penConfig, penConfig.stamp);
    drawStamps(ctx, stamps, color, ctx.getTransform(), style.opacity);
    return;
  }

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

  // Grain-enabled strokes rendered in isolation
  if (renderPipeline !== "basic" && lod === 0 && penConfig.grain?.enabled) {
    const baseStrength = grainStrengthOverrides.get(style.pen) ?? penConfig.grain.strength;
    const grainValue = style.grain ?? DEFAULT_GRAIN_VALUE;
    const strength = grainToTextureStrength(baseStrength, grainValue);
    if (strength > 0) {
      const anchorX = stroke.grainAnchor?.[0] ?? stroke.bbox[0];
      const anchorY = stroke.grainAnchor?.[1] ?? stroke.bbox[1];
      renderStrokeWithGrain(
        ctx, path, color, style.opacity, strength,
        anchorX, anchorY, stroke.bbox,
        canvasWidth, canvasHeight,
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

  // Fountain pen ink pooling
  if (renderPipeline !== "basic" && style.pen === "fountain" && lod === 0 && style.nibAngle == null) {
    const points = decodedPoints ?? decodePoints(stroke.pts);
    const pools = detectInkPools(points, style.width);
    if (pools.length > 0) {
      renderInkPools(ctx, pools, color);
    }
  }
}

// ─── Tile Rendering ──────────────────────────────────────────

function bboxOverlaps(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];
}

function renderTile(msg: WorkerRenderTileMessage): void {
  const {
    tileKey,
    worldBounds,
    zoomBand,
    tilePhysical,
    tileWorldSize,
    strokeIds,
    isDarkMode,
  } = msg;

  const canvas = new OffscreenCanvas(tilePhysical, tilePhysical);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    workerSelf.postMessage({
      type: "tile-error",
      tileKey,
      error: "Failed to get 2D context",
    });
    return;
  }

  const baseZoom = zoomBandBaseZoom(zoomBand);
  const lod = selectLodLevel(baseZoom);

  // Transform: world coords -> tile pixel coords
  const scale = tilePhysical / tileWorldSize;
  const tx = -worldBounds[0] * scale;
  const ty = -worldBounds[1] * scale;
  ctx.setTransform(scale, 0, 0, scale, tx, ty);

  const lineScale = tileWorldSize / tilePhysical;

  // Phase 1: Background
  renderDeskFill(ctx, worldBounds, isDarkMode);

  for (const rect of pageLayout) {
    const pageBbox: [number, number, number, number] = [
      rect.x, rect.y,
      rect.x + rect.width, rect.y + rect.height,
    ];
    if (!bboxOverlaps(pageBbox, worldBounds)) continue;

    const page = pages[rect.pageIndex];
    if (!page) continue;

    renderPageBackground(ctx, page, rect, isDarkMode, lineScale);
  }

  // Phase 2: Strokes
  const strokeIdSet = new Set(strokeIds);
  const renderedStrokeIds: string[] = [];

  for (const rect of pageLayout) {
    const pageBbox: [number, number, number, number] = [
      rect.x, rect.y,
      rect.x + rect.width, rect.y + rect.height,
    ];
    if (!bboxOverlaps(pageBbox, worldBounds)) continue;

    const page = pages[rect.pageIndex];
    let pageDark = isDarkMode;
    if (page) {
      const { patternTheme } = resolvePageBackground(
        page.backgroundColor, page.backgroundColorTheme, isDarkMode,
      );
      pageDark = patternTheme === "dark";
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    for (const stroke of strokes) {
      if (stroke.pageIndex !== rect.pageIndex) continue;
      if (!strokeIdSet.has(stroke.id)) continue;

      renderStroke(ctx, stroke, lod, pageDark, tilePhysical, tilePhysical);
      renderedStrokeIds.push(stroke.id);
    }

    ctx.restore();
  }

  // Transfer result as ImageBitmap (zero-copy)
  const bitmap = canvas.transferToImageBitmap();
  workerSelf.postMessage(
    {
      type: "tile-result",
      tileKey,
      bitmap,
      strokeIds: renderedStrokeIds,
    },
    { transfer: [bitmap] },
  );
}

// ─── Message Handler ─────────────────────────────────────────

workerSelf.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init":
      initGrainFromImageData(msg.grainImageData);
      workerSelf.postMessage({ type: "ready" });
      break;

    case "doc-update":
      strokes = msg.strokes;
      styles = msg.styles;
      pages = msg.pages;
      pageLayout = msg.pageLayout;
      if (msg.renderPipeline) {
        renderPipeline = msg.renderPipeline;
      }
      // Clear path cache since strokes may have changed
      pathCache.clear();
      break;

    case "grain-update":
      initGrainFromImageData(msg.grainImageData);
      grainStrengthOverrides = new Map(
        msg.strengthOverrides.map(([k, v]) => [k as PenType, v]),
      );
      break;

    case "render-tile":
      try {
        renderTile(msg);
      } catch (err) {
        workerSelf.postMessage({
          type: "tile-error",
          tileKey: msg.tileKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;

    case "stamp-init":
      stampEnabled = msg.enabled;
      if (!stampEnabled) {
        stampTextureCache.clear();
        stampColorCaches.clear();
      }
      break;

    case "ink-stamp-init":
      inkStampEnabled = msg.enabled;
      if (!inkStampEnabled) {
        inkStampTextureCache.clear();
        inkStampColorCaches.clear();
      }
      break;

    case "cancel":
      // Currently tiles render synchronously in the worker,
      // so cancel is a no-op. Could be extended for async rendering.
      break;

    case "destroy":
      pathCache.clear();
      grainCanvas = null;
      grainCtx = null;
      grainOffscreen = null;
      grainOffscreenCtx = null;
      stampEnabled = false;
      stampTextureCache.clear();
      stampColorCaches.clear();
      inkStampEnabled = false;
      inkStampTextureCache.clear();
      inkStampColorCaches.clear();
      workerSelf.close();
      break;
  }
};
