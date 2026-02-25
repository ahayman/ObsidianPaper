import type { Stroke, PenStyle, StrokePoint, PaperDocument, RenderPipeline, RenderEngineType } from "../types";
import type { SpatialIndex } from "../spatial/SpatialIndex";
import type { PageRect } from "../document/PageLayout";
import { Camera } from "./Camera";
import { setupHighDPICanvas, resizeHighDPICanvas, getEffectiveDPR } from "./HighDPI";
import {
  generateStrokePath,
  generateStrokeVertices,
  StrokePathCache,
} from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import type { PenType } from "../types";
import { GrainTextureGenerator } from "./GrainTextureGenerator";
import { selectLodLevel } from "../stroke/StrokeSimplifier";
import { BackgroundRenderer, DESK_COLORS } from "./BackgroundRenderer";
import type { BackgroundConfig } from "./BackgroundRenderer";
import { resolvePageBackground } from "../color/ColorUtils";
import {
  renderStrokeToContext,
  applyGrainToStroke,
  computeScreenBBox,
} from "./StrokeRenderCore";
import type { GrainRenderContext, StampRenderContext } from "./StrokeRenderCore";
import { StampTextureManager } from "../stamp/StampTextureManager";
import { InkStampTextureManager } from "../stamp/InkStampTextureManager";
import { DEFAULT_GRAIN_VALUE, grainToTextureStrength } from "../stamp/GrainMapping";
import {
  computeAllStamps,
  drawStamps,
} from "../stamp/StampRenderer";
import { computeAllInkStamps, drawInkShadingStamps } from "../stamp/InkStampRenderer";
import { getInkPreset } from "../stamp/InkPresets";
import { quantizePoints } from "../document/PointEncoder";
import { TileGrid } from "./tiles/TileGrid";
import { TileCache } from "./tiles/TileCache";
import { TileRenderer } from "./tiles/TileRenderer";
import { TileCompositor } from "./tiles/TileCompositor";
import { TileRenderScheduler } from "./tiles/TileRenderScheduler";
import { WorkerTileScheduler } from "./tiles/WorkerTileScheduler";
import {
  zoomToZoomBand, tileKeyString,
  DEFAULT_TILE_CONFIG,
} from "./tiles/TileTypes";
import type { TileGridConfig, TileKey } from "./tiles/TileTypes";
import type { RenderEngine } from "./engine/RenderEngine";
import { createRenderEngine } from "./engine/EngineFactory";
import { WebGLTileEngine } from "./tiles/WebGLTileEngine";
import { WebGLTileCache } from "./tiles/WebGLTileCache";
import { WebGLTileCompositor } from "./tiles/WebGLTileCompositor";

/**
 * Multi-layer canvas renderer managing:
 * - Static layer: all completed strokes (cached bitmap)
 * - Active layer: stroke currently being drawn
 * - Prediction layer: predicted stroke extension
 *
 * Uses requestAnimationFrame batching to avoid rendering on every pointermove.
 */
export class Renderer {
  private container: HTMLElement;
  private backgroundCanvas: HTMLCanvasElement;
  private staticCanvas: HTMLCanvasElement;
  private activeCanvas: HTMLCanvasElement;
  private predictionCanvas: HTMLCanvasElement;
  private staticCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;
  private predictionCtx: CanvasRenderingContext2D;
  private camera: Camera;
  private backgroundRenderer: BackgroundRenderer;
  private pathCache = new StrokePathCache();
  private isMobile: boolean;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  isDarkMode = false;

  // Engine-based rendering (Phase 8)
  private engineType: RenderEngineType;
  private activeEngine: RenderEngine | null = null;
  private engineOverlay: HTMLElement | null = null;

  // WebGL tile compositing canvases (when engineType === "webgl")
  private webglStaticCanvas: HTMLCanvasElement | null = null;
  private webglGL: WebGL2RenderingContext | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  // Overscan: background + static canvases are rendered larger than viewport.
  // Sized dynamically to cover the current page(s) so CSS zoom-out reveals
  // pre-rendered content rather than blank space.
  private static readonly BASELINE_OVERSCAN_FACTOR = 1.5; // Used before page info is known
  private static readonly MAX_OVERSCAN_PIXELS = 5120; // Per axis, at DPR resolution
  private overscanCssWidth = 0;
  private overscanCssHeight = 0;
  private overscanOffsetX = 0;  // Negative CSS offset (e.g., -512)
  private overscanOffsetY = 0;  // Negative CSS offset (e.g., -384)
  private grainGenerator: GrainTextureGenerator | null = null;
  private grainStrengthOverrides = new Map<PenType, number>();
  private grainOffscreen: HTMLCanvasElement | null = null;
  private grainOffscreenCtx: CanvasRenderingContext2D | null = null;
  private bgConfig: BackgroundConfig = {
    isDarkMode: false,
  };

  // Rendering pipeline
  private pipeline: RenderPipeline = "basic";

  // Stamp-based rendering
  private stampManager: StampTextureManager | null = null;
  private inkStampManager: InkStampTextureManager | null = null;
  /** Number of stamps already drawn on the active canvas (for incremental draw) */
  private activeStampCount: number = 0;
  /** Current ink preset for fountain pen (tracked for active stroke rendering) */
  private currentInkPreset: string = "standard";

  // Active stroke vertex caching (Phase 9)
  /** Cached Float32Array vertices for the active stroke. Regenerated when point count changes. */
  private activeVertices: Float32Array | null = null;
  /** Number of points when activeVertices was last generated. */
  private activeVerticesPointCount = 0;

  // Tile-based rendering (when enabled, replaces overscan static canvas)
  private tiledLayer: TiledStaticLayer | null = null;

  // RAF batching
  private gestureRafId: number | null = null;
  private rafId: number | null = null;
  private pendingActiveRender: (() => void) | null = null;
  private pendingBakes: { stroke: Stroke; styles: Record<string, PenStyle>; pageRect?: PageRect; useDarkColors?: boolean }[] = [];
  private pendingFinalizations: (() => void)[] = [];

  constructor(container: HTMLElement, camera: Camera, isMobile: boolean, engineType: RenderEngineType = "canvas2d") {
    this.container = container;
    this.camera = camera;
    this.isMobile = isMobile;
    this.engineType = engineType;

    // Create four stacked canvases (background, static, active, prediction)
    this.backgroundCanvas = this.createCanvasLayer("paper-background-canvas");
    this.staticCanvas = this.createCanvasLayer("paper-static-canvas");
    this.activeCanvas = this.createCanvasLayer("paper-active-canvas");
    this.predictionCanvas = this.createCanvasLayer("paper-prediction-canvas");

    this.backgroundRenderer = new BackgroundRenderer(this.backgroundCanvas, camera);
    this.staticCtx = this.getContext(this.staticCanvas);
    this.activeCtx = this.getContext(this.activeCanvas);
    this.predictionCtx = this.getContext(this.predictionCanvas);

    // Create engine for active canvas (used for engine-based rendering path)
    if (engineType === "webgl") {
      try {
        this.activeEngine = createRenderEngine(engineType, this.activeCanvas);
      } catch {
        // Fall back silently — Canvas 2D path will be used
        this.activeEngine = null;
      }
    }

    // Engine indicator overlay
    this.engineOverlay = container.createEl("div", { cls: "paper-engine-overlay" });
    const actualEngine = this.activeEngine ? "WebGL 2" : "Canvas 2D";
    this.engineOverlay.setText(actualEngine);
  }

  private createCanvasLayer(className: string): HTMLCanvasElement {
    const canvas = this.container.createEl("canvas", { cls: `paper-canvas ${className}` });
    return canvas;
  }

  private getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D rendering context");
    return ctx;
  }

  /**
   * Setup or resize all canvas layers to match the container.
   */
  resize(width: number, height: number): void {
    this.cssWidth = width;
    this.cssHeight = height;

    // Baseline overscan (refined by recalculateOverscan when page layout is known)
    const dpr = getEffectiveDPR(this.isMobile);
    const maxCss = Renderer.MAX_OVERSCAN_PIXELS / dpr;
    const baselineW = Math.min(Math.ceil(width * Renderer.BASELINE_OVERSCAN_FACTOR), Math.max(width, maxCss));
    const baselineH = Math.min(Math.ceil(height * Renderer.BASELINE_OVERSCAN_FACTOR), Math.max(height, maxCss));
    this.resizeOverscanCanvases(baselineW, baselineH);

    // Center for baseline (will be refined by recalculateOverscan on next render)
    this.overscanOffsetX = -Math.round((this.overscanCssWidth - width) / 2);
    this.overscanOffsetY = -Math.round((this.overscanCssHeight - height) / 2);
    this.applyOverscanPosition();

    // Active + prediction stay viewport-sized (no overscan)
    this.activeCanvas.style.left = "0px";
    this.activeCanvas.style.top = "0px";
    resizeHighDPICanvas(this.activeCanvas, this.activeCtx, width, height, this.isMobile);
    resizeHighDPICanvas(this.predictionCanvas, this.predictionCtx, width, height, this.isMobile);

    // Resize WebGL canvases if present
    if (this.webglStaticCanvas) {
      const dpr = getEffectiveDPR(this.isMobile);
      this.webglStaticCanvas.width = Math.round(width * dpr);
      this.webglStaticCanvas.height = Math.round(height * dpr);
      this.webglStaticCanvas.style.width = `${width}px`;
      this.webglStaticCanvas.style.height = `${height}px`;
    }
    if (this.overlayCanvas && this.overlayCtx) {
      const dpr = getEffectiveDPR(this.isMobile);
      this.overlayCanvas.width = Math.round(width * dpr);
      this.overlayCanvas.height = Math.round(height * dpr);
      this.overlayCanvas.style.width = `${width}px`;
      this.overlayCanvas.style.height = `${height}px`;
    }
  }

  /**
   * Resize overscan canvas backing stores to new CSS dimensions.
   * Does NOT set offset or CSS position — caller handles that.
   */
  private resizeOverscanCanvases(w: number, h: number): void {
    this.overscanCssWidth = w;
    this.overscanCssHeight = h;

    const bgCtx = this.backgroundCanvas.getContext("2d");
    if (bgCtx) {
      resizeHighDPICanvas(this.backgroundCanvas, bgCtx, w, h, this.isMobile);
    }
    this.dpr = setupHighDPICanvas(
      this.staticCanvas, this.staticCtx, w, h, this.isMobile,
    );
    this.backgroundRenderer.setSize(w, h, this.dpr);
  }

  /**
   * Apply current overscan offset to canvas CSS positions.
   */
  private applyOverscanPosition(): void {
    this.backgroundCanvas.style.left = `${this.overscanOffsetX}px`;
    this.backgroundCanvas.style.top = `${this.overscanOffsetY}px`;
    this.staticCanvas.style.left = `${this.overscanOffsetX}px`;
    this.staticCanvas.style.top = `${this.overscanOffsetY}px`;
  }

  /**
   * Recalculate overscan dimensions and offset to cover nearby pages.
   *
   * The key insight: the overscan offset must be ASYMMETRIC. When the user
   * is zoomed in looking at the bottom of a page, the page top is far above
   * the viewport. A centered overscan can't reach it. Instead, we compute
   * the union of the viewport and the page's screen-space rect, then position
   * the overscan to cover that union.
   */
  private recalculateOverscan(pageLayout: PageRect[]): void {
    const zoom = this.camera.zoom;
    const dpr = getEffectiveDPR(this.isMobile);
    const maxCss = Renderer.MAX_OVERSCAN_PIXELS / dpr;

    // Find pages that overlap the viewport or are within one viewport of it
    const viewRect = this.camera.getVisibleRect(this.cssWidth, this.cssHeight);
    const searchMargin = Math.max(this.cssWidth, this.cssHeight) / zoom;

    let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
    for (const page of pageLayout) {
      if (
        page.x + page.width < viewRect[0] - searchMargin ||
        page.x > viewRect[2] + searchMargin ||
        page.y + page.height < viewRect[1] - searchMargin ||
        page.y > viewRect[3] + searchMargin
      ) {
        continue;
      }
      if (page.x < pMinX) pMinX = page.x;
      if (page.y < pMinY) pMinY = page.y;
      if (page.x + page.width > pMaxX) pMaxX = page.x + page.width;
      if (page.y + page.height > pMaxY) pMaxY = page.y + page.height;
    }

    let requiredW: number, requiredH: number;
    let offsetX: number, offsetY: number;

    if (pMinX < pMaxX) {
      // Page bounds in screen-space (relative to viewport origin at 0,0)
      const psMinX = (pMinX - this.camera.x) * zoom;
      const psMinY = (pMinY - this.camera.y) * zoom;
      const psMaxX = (pMaxX - this.camera.x) * zoom;
      const psMaxY = (pMaxY - this.camera.y) * zoom;

      // Union of viewport [0, 0, cssW, cssH] and page screen rect
      const uMinX = Math.min(0, psMinX);
      const uMinY = Math.min(0, psMinY);
      const uMaxX = Math.max(this.cssWidth, psMaxX);
      const uMaxY = Math.max(this.cssHeight, psMaxY);

      // Required: union extent + small padding for pan headroom
      const padding = Math.min(this.cssWidth, this.cssHeight) * 0.25;
      requiredW = Math.max(this.cssWidth * Renderer.BASELINE_OVERSCAN_FACTOR, uMaxX - uMinX + padding);
      requiredH = Math.max(this.cssHeight * Renderer.BASELINE_OVERSCAN_FACTOR, uMaxY - uMinY + padding);

      // Apply memory cap
      const cappedW = Math.min(Math.ceil(requiredW), Math.max(this.cssWidth, maxCss));
      const cappedH = Math.min(Math.ceil(requiredH), Math.max(this.cssHeight, maxCss));
      requiredW = cappedW;
      requiredH = cappedH;

      // Position: center overscan on the union rect, distributing any excess evenly
      const excessW = cappedW - (uMaxX - uMinX);
      const excessH = cappedH - (uMaxY - uMinY);
      offsetX = Math.floor(uMinX - Math.max(0, excessW) / 2);
      offsetY = Math.floor(uMinY - Math.max(0, excessH) / 2);

      // Clamp: overscan must cover the full viewport [0, cssW] x [0, cssH]
      if (offsetX > 0) offsetX = 0;
      if (offsetY > 0) offsetY = 0;
      if (offsetX + cappedW < this.cssWidth) offsetX = this.cssWidth - cappedW;
      if (offsetY + cappedH < this.cssHeight) offsetY = this.cssHeight - cappedH;
    } else {
      // No nearby pages — use baseline, centered
      requiredW = Math.min(
        Math.ceil(this.cssWidth * Renderer.BASELINE_OVERSCAN_FACTOR),
        Math.max(this.cssWidth, maxCss),
      );
      requiredH = Math.min(
        Math.ceil(this.cssHeight * Renderer.BASELINE_OVERSCAN_FACTOR),
        Math.max(this.cssHeight, maxCss),
      );
      offsetX = -Math.round((requiredW - this.cssWidth) / 2);
      offsetY = -Math.round((requiredH - this.cssHeight) / 2);
    }

    // Resize canvas backing stores if dimensions changed significantly (>10%)
    const wDiff = Math.abs(requiredW - this.overscanCssWidth);
    const hDiff = Math.abs(requiredH - this.overscanCssHeight);
    if (wDiff >= this.overscanCssWidth * 0.1 || hDiff >= this.overscanCssHeight * 0.1) {
      this.resizeOverscanCanvases(requiredW, requiredH);
    }

    // Always update offset (depends on camera position, not just dimensions)
    this.overscanOffsetX = offsetX;
    this.overscanOffsetY = offsetY;
    this.applyOverscanPosition();
  }

  /**
   * Full re-render of all completed strokes onto the static canvas.
   * Called on zoom/pan, document load, or undo/redo.
   */
  setBackgroundConfig(config: Partial<BackgroundConfig>): void {
    this.bgConfig = { ...this.bgConfig, ...config };
  }

  setPipeline(pipeline: RenderPipeline): void {
    this.pipeline = pipeline;
    this.tiledLayer?.setPipeline(pipeline);
  }

  renderStaticLayer(
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex?: SpatialIndex,
    afterBackground?: (ctx: CanvasRenderingContext2D, visibleRect: [number, number, number, number]) => void,
  ): void {
    this.flushFinalizations();
    this.pendingBakes = [];

    // Match container background to desk color so edges during CSS zoom look seamless
    this.container.style.backgroundColor = this.isDarkMode ? DESK_COLORS.dark : DESK_COLORS.light;

    if (this.tiledLayer && spatialIndex) {
      // ─── Tile-based path ─────────────────────────────────
      // Background is rendered into tiles — hide the background canvas
      this.backgroundCanvas.style.display = "none";

      if (this.tiledLayer.useWebGLTiles && this.webglStaticCanvas) {
        // WebGL path: compositor draws directly to webglStaticCanvas.
        // CSS layer promotion (will-change: contents, translateZ(0)) ensures
        // Chromium gives the canvas its own compositor layer and re-reads
        // the drawing buffer after each draw.
        this.staticCanvas.style.display = "none";
        this.tiledLayer.setOverlay(afterBackground ?? null);
        this.tiledLayer.renderVisible(
          this.staticCtx, this.staticCanvas,
          this.cssWidth, this.cssHeight,
          doc, pageLayout, spatialIndex, this.isDarkMode,
        );
        // Flush GL commands to ensure the GPU finishes before the
        // compositor reads the drawing buffer for presentation.
        this.webglGL?.flush();
      } else {
        // Canvas2D path: compositing goes to staticCanvas
        this.staticCanvas.style.display = "";
        this.staticCanvas.style.left = "0px";
        this.staticCanvas.style.top = "0px";
        const dpr = getEffectiveDPR(this.isMobile);
        if (this.staticCanvas.width !== Math.round(this.cssWidth * dpr) ||
            this.staticCanvas.height !== Math.round(this.cssHeight * dpr)) {
          this.dpr = setupHighDPICanvas(
            this.staticCanvas, this.staticCtx,
            this.cssWidth, this.cssHeight, this.isMobile,
          );
        }
        this.tiledLayer.setOverlay(afterBackground ?? null);
        this.tiledLayer.renderVisible(
          this.staticCtx, this.staticCanvas,
          this.cssWidth, this.cssHeight,
          doc, pageLayout, spatialIndex, this.isDarkMode,
        );
      }
      return;
    }

    // ─── Legacy overscan path ──────────────────────────────
    this.recalculateOverscan(pageLayout);

    const ctx = this.staticCtx;
    this.clearOverscanCanvas(ctx);

    // Render background on dedicated layer (with overscan offsets)
    this.bgConfig.isDarkMode = this.isDarkMode;
    this.backgroundRenderer.render(
      this.bgConfig, pageLayout, doc.pages, afterBackground,
      this.overscanOffsetX, this.overscanOffsetY,
    );

    // Apply camera with overscan offset compensation
    this.applyOverscanCameraTransform(ctx);

    // Select LOD based on current zoom level
    const lod = selectLodLevel(this.camera.zoom);

    // Use overscan visible rect for culling (covers larger area than viewport)
    const visibleRect = this.camera.getOverscanVisibleRect(
      this.overscanCssWidth, this.overscanCssHeight,
      this.overscanOffsetX, this.overscanOffsetY,
    );

    // Determine visible stroke IDs
    let visibleIds: Set<string> | null = null;
    if (spatialIndex) {
      visibleIds = new Set(spatialIndex.queryRect(
        visibleRect[0], visibleRect[1], visibleRect[2], visibleRect[3]
      ));
    }

    // Render strokes grouped by page, with per-page clipping
    for (const pageRect of pageLayout) {
      // Cull pages not in viewport
      if (
        pageRect.x + pageRect.width < visibleRect[0] ||
        pageRect.x > visibleRect[2] ||
        pageRect.y + pageRect.height < visibleRect[1] ||
        pageRect.y > visibleRect[3]
      ) {
        continue;
      }

      // Determine per-page stroke color mode (dark backgrounds → dark-mode colors)
      const page = doc.pages[pageRect.pageIndex];
      let pageDark = this.isDarkMode;
      if (page) {
        const { patternTheme } = resolvePageBackground(
          page.backgroundColor,
          page.backgroundColorTheme,
          this.isDarkMode,
        );
        pageDark = patternTheme === "dark";
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      ctx.clip();

      for (const stroke of doc.strokes) {
        if (stroke.pageIndex !== pageRect.pageIndex) continue;

        if (visibleIds) {
          if (visibleIds.has(stroke.id)) {
            this.renderStrokeToContext(ctx, stroke, doc.styles, lod, pageDark);
          }
        } else {
          if (bboxOverlaps(stroke.bbox, visibleRect)) {
            this.renderStrokeToContext(ctx, stroke, doc.styles, lod, pageDark);
          }
        }
      }

      ctx.restore();
    }

    this.camera.resetContext(ctx);
  }

  /**
   * Incrementally bake a single new stroke onto the static canvas.
   * O(1) — doesn't re-render all strokes.
   * Clips to the page rect if provided.
   */
  bakeStroke(
    stroke: Stroke,
    styles: Record<string, PenStyle>,
    pageRect?: PageRect,
    useDarkColors?: boolean,
    doc?: PaperDocument,
    pageLayout?: PageRect[],
    spatialIndex?: SpatialIndex,
  ): void {
    if (this.tiledLayer && doc && pageLayout && spatialIndex) {
      this.tiledLayer.bakeStroke(
        stroke, this.staticCtx, this.staticCanvas,
        this.cssWidth, this.cssHeight,
        doc, pageLayout, spatialIndex, this.isDarkMode,
      );
      if (this.tiledLayer.useWebGLTiles) {
        this.webglGL?.flush();
      }
      return;
    }

    const ctx = this.staticCtx;

    // Apply DPR + camera transform with overscan offset
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);
    this.applyOverscanCameraTransform(ctx);

    if (pageRect) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      ctx.clip();
    }

    this.renderStrokeToContext(ctx, stroke, styles, 0, useDarkColors);

    if (pageRect) {
      ctx.restore();
    }

    this.camera.resetContext(ctx);
  }

  /**
   * Render raw points directly to the static canvas.
   * Bypasses encode/decode and path caching — used for diagnostic/minimal path.
   */
  renderPointsToStatic(
    points: readonly StrokePoint[],
    style: PenStyle
  ): void {
    const ctx = this.staticCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);
    this.applyOverscanCameraTransform(ctx);

    const penConfig = getPenConfig(style.pen);

    // Stamp-based rendering for pencil
    if (this.stampManager && this.pipeline === "advanced" && penConfig.stamp && points.length > 0) {
      const color = resolveColor(style.color, this.isDarkMode);
      const qPoints = quantizePoints(points);
      const stamps = computeAllStamps(qPoints, style, penConfig, penConfig.stamp);
      drawStamps(ctx, stamps, color, ctx.getTransform(), style.opacity);
      this.camera.resetContext(ctx);
      return;
    }

    const path = generateStrokePath(points, style);
    if (path) {
      const color = resolveColor(style.color, this.isDarkMode);

      // Grain-enabled strokes rendered in isolation
      if (this.pipeline !== "basic" && penConfig.grain?.enabled && points.length > 0) {
        const baseStrength = this.grainStrengthOverrides.get(style.pen) ?? penConfig.grain.strength;
        const grainValue = style.grain ?? DEFAULT_GRAIN_VALUE;
        const strength = grainToTextureStrength(baseStrength, grainValue);
        if (strength > 0) {
          let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
          for (const pt of points) {
            if (pt.x < bMinX) bMinX = pt.x;
            if (pt.y < bMinY) bMinY = pt.y;
            if (pt.x > bMaxX) bMaxX = pt.x;
            if (pt.y > bMaxY) bMaxY = pt.y;
          }
          const m = style.width * 2;
          const ptsBbox: [number, number, number, number] = [bMinX - m, bMinY - m, bMaxX + m, bMaxY + m];
          const grainCtx = this.getGrainRenderContext(this.staticCanvas.width, this.staticCanvas.height);
          const offscreen = grainCtx.getOffscreen(256, 256);
          if (offscreen) {
            // Use shared grain rendering via StrokeRenderCore
            const m = ctx.getTransform();
            const region = computeScreenBBox(ptsBbox, m, grainCtx.canvasWidth, grainCtx.canvasHeight);
            if (region) {
              const offCtx = offscreen.ctx;
              offCtx.setTransform(1, 0, 0, 1, 0, 0);
              offCtx.clearRect(0, 0, region.sw, region.sh);
              offCtx.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);
              offCtx.fillStyle = color;
              offCtx.globalAlpha = style.opacity;
              offCtx.fill(path);
              offCtx.globalAlpha = 1;
              applyGrainToStroke(offCtx, path, strength, points[0].x, points[0].y, grainCtx);
              ctx.save();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.drawImage(offscreen.canvas, 0, 0, region.sw, region.sh, region.sx, region.sy, region.sw, region.sh);
              ctx.restore();
            }
          }
          this.camera.resetContext(ctx);
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
    }

    this.camera.resetContext(ctx);
  }

  /**
   * Schedule a stroke bake for the next RAF frame.
   * Non-blocking — returns immediately so the event loop stays free for the next pointerdown.
   */
  scheduleBake(stroke: Stroke, styles: Record<string, PenStyle>, pageRect?: PageRect, useDarkColors?: boolean): void {
    this.pendingBakes.push({ stroke, styles, pageRect, useDarkColors });
    this.scheduleFrame();
  }

  /**
   * Schedule a finalization callback for the next RAF frame.
   * Runs before bakes and active renders, so finalized strokes are baked in the same frame.
   */
  scheduleFinalization(callback: () => void): void {
    this.pendingFinalizations.push(callback);
    this.scheduleFrame();
  }

  /**
   * Immediately run all pending finalizations.
   * Called before undo/redo, getViewData, or renderStaticLayer to ensure consistency.
   */
  flushFinalizations(): void {
    if (this.pendingFinalizations.length === 0) return;
    const fns = this.pendingFinalizations;
    this.pendingFinalizations = [];
    for (const fn of fns) {
      fn();
    }
  }

  /**
   * Clear only the prediction layer (not active).
   * Used when deferring bake — the active layer keeps showing the stroke
   * until the bake paints it to static or the next stroke clears active.
   */
  clearPredictionLayer(): void {
    this.clearCanvas(this.predictionCtx);
    this.pendingActiveRender = null;
  }

  /**
   * Render the active stroke (currently being drawn).
   * Batched via requestAnimationFrame.
   * Clips to page rect if provided.
   */
  renderActiveStroke(
    points: readonly StrokePoint[],
    style: PenStyle,
    pageRect?: PageRect,
    useDarkColors?: boolean,
  ): void {
    const penConfig = getPenConfig(style.pen);

    // Ink-shaded active stroke for fountain pen: full redraw each frame
    // with clip + source-over deposit on an offscreen canvas.
    if (this.pipeline === "advanced" && penConfig.inkStamp && points.length > 1) {
      this.pendingActiveRender = () => {
        if (!penConfig.inkStamp) return;
        if (!this.inkStampManager) this.initInkStamps();

        this.clearCanvas(this.activeCtx);
        this.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.activeCtx.scale(this.dpr, this.dpr);
        this.camera.applyToContext(this.activeCtx);

        if (pageRect) {
          this.activeCtx.save();
          this.activeCtx.beginPath();
          this.activeCtx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
          this.activeCtx.clip();
        }

        const path = generateStrokePath(points, style, false);
        if (path) {
          const dark = useDarkColors ?? this.isDarkMode;
          const color = resolveColor(style.color, dark);
          const presetConfig = getInkPreset(style.inkPreset ?? this.currentInkPreset);
          const qPoints = quantizePoints(points);

          // Compute bbox from points
          let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
          for (const pt of qPoints) {
            if (pt.x < bMinX) bMinX = pt.x;
            if (pt.y < bMinY) bMinY = pt.y;
            if (pt.x > bMaxX) bMaxX = pt.x;
            if (pt.y > bMaxY) bMaxY = pt.y;
          }
          const m = style.width * 2;
          const bbox: [number, number, number, number] = [bMinX - m, bMinY - m, bMaxX + m, bMaxY + m];

          const transform = this.activeCtx.getTransform();
          const region = computeScreenBBox(bbox, transform, this.activeCanvas.width, this.activeCanvas.height);

          if (region && presetConfig.shading > 0) {
            const offCtx = this.ensureGrainOffscreen(region.sw, region.sh);
            if (offCtx && this.grainOffscreen) {
              offCtx.setTransform(1, 0, 0, 1, 0, 0);
              offCtx.clearRect(0, 0, region.sw, region.sh);
              offCtx.setTransform(
                transform.a, transform.b, transform.c, transform.d,
                transform.e - region.sx, transform.f - region.sy,
              );

              // 1. Deposit colored stamps via source-over on offscreen
              const stamps = computeAllInkStamps(qPoints, style, penConfig, penConfig.inkStamp, presetConfig);
              const inkCache = this.inkStampManager!.getCache(style.inkPreset ?? this.currentInkPreset);
              const stampTexture = inkCache.getColored(color);
              drawInkShadingStamps(offCtx, stamps, stampTexture, offCtx.getTransform(), style.opacity);

              // 2. Mask to the stroke outline path
              offCtx.globalCompositeOperation = "destination-in";
              offCtx.globalAlpha = 1;
              offCtx.fill(path);
              offCtx.globalCompositeOperation = "source-over";

              // 3. Composite back
              this.activeCtx.save();
              this.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
              this.activeCtx.drawImage(
                this.grainOffscreen,
                0, 0, region.sw, region.sh,
                region.sx, region.sy, region.sw, region.sh,
              );
              this.activeCtx.restore();
            } else {
              // Fallback: plain fill
              this.activeCtx.fillStyle = color;
              this.activeCtx.globalAlpha = style.opacity;
              this.activeCtx.fill(path);
              this.activeCtx.globalAlpha = 1;
            }
          } else {
            // No shading or off-screen: plain fill
            this.activeCtx.fillStyle = color;
            this.activeCtx.globalAlpha = style.opacity;
            this.activeCtx.fill(path);
            this.activeCtx.globalAlpha = 1;
          }
        }

        if (pageRect) {
          this.activeCtx.restore();
        }

        this.camera.resetContext(this.activeCtx);
      };

      this.scheduleFrame();
      return;
    }

    // Stamp-based incremental rendering for pencil
    if (this.stampManager && this.pipeline === "advanced" && penConfig.stamp && points.length > 0) {
      this.pendingActiveRender = () => {
        if (!this.stampManager || !penConfig.stamp) return;

        // Clear canvas on first frame of new stroke
        if (this.activeStampCount === 0) {
          this.clearCanvas(this.activeCtx);
        }

        const dark = useDarkColors ?? this.isDarkMode;
        const color = resolveColor(style.color, dark);

        // Setup transform
        this.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.activeCtx.scale(this.dpr, this.dpr);
        this.camera.applyToContext(this.activeCtx);

        if (pageRect) {
          this.activeCtx.save();
          this.activeCtx.beginPath();
          this.activeCtx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
          this.activeCtx.clip();
        }

        const baseTransform = this.activeCtx.getTransform();

        // Quantize points to match encode→decode precision used by final render.
        // Compute ALL stamps from scratch — only draw new ones.
        const qPoints = quantizePoints(points);
        const allStamps = computeAllStamps(qPoints, style, penConfig, penConfig.stamp);

        if (allStamps.length > this.activeStampCount) {
          const newStamps = allStamps.slice(this.activeStampCount);
          drawStamps(this.activeCtx, newStamps, color, baseTransform, style.opacity);
          this.activeStampCount = allStamps.length;
        }

        if (pageRect) {
          this.activeCtx.restore();
        }

        this.camera.resetContext(this.activeCtx);
      };

      this.scheduleFrame();
      return;
    }

    this.pendingActiveRender = () => {
      this.clearCanvas(this.activeCtx);
      this.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.activeCtx.scale(this.dpr, this.dpr);
      this.camera.applyToContext(this.activeCtx);

      if (pageRect) {
        this.activeCtx.save();
        this.activeCtx.beginPath();
        this.activeCtx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
        this.activeCtx.clip();
      }

      const path = generateStrokePath(points, style, false);
      if (path) {
        const dark = useDarkColors ?? this.isDarkMode;
        const color = resolveColor(style.color, dark);

        if (penConfig.highlighterMode) {
          this.activeCtx.save();
          this.activeCtx.globalAlpha = penConfig.baseOpacity;
          this.activeCtx.globalCompositeOperation = "multiply";
          this.activeCtx.fillStyle = color;
          this.activeCtx.fill(path);
          this.activeCtx.restore();
        } else {
          this.activeCtx.fillStyle = color;
          this.activeCtx.globalAlpha = style.opacity;
          this.activeCtx.fill(path);
          this.activeCtx.globalAlpha = 1;
        }

        // Grain overlay for active stroke
        if (this.pipeline !== "basic" && penConfig.grain?.enabled && points.length > 0) {
          const baseStrength = this.grainStrengthOverrides.get(style.pen) ?? penConfig.grain.strength;
          const grainValue = style.grain ?? DEFAULT_GRAIN_VALUE;
          const strength = grainToTextureStrength(baseStrength, grainValue);
          if (strength > 0) {
            this.applyGrainToStrokeLocal(this.activeCtx, path, strength, points[0].x, points[0].y);
          }
        }
      }

      if (pageRect) {
        this.activeCtx.restore();
      }

      this.camera.resetContext(this.activeCtx);
    };

    this.scheduleFrame();
  }

  /**
   * Render predicted stroke extension.
   * Clips to page rect if provided.
   */
  renderPrediction(
    allPoints: readonly StrokePoint[],
    predictedPoints: readonly StrokePoint[],
    style: PenStyle,
    pageRect?: PageRect,
    useDarkColors?: boolean,
  ): void {
    this.clearCanvas(this.predictionCtx);

    if (predictedPoints.length === 0) return;

    // Combine last few real points with predicted for continuity
    const tailCount = Math.min(3, allPoints.length);
    const combined = [
      ...allPoints.slice(-tailCount),
      ...predictedPoints,
    ];

    this.predictionCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.predictionCtx.scale(this.dpr, this.dpr);
    this.camera.applyToContext(this.predictionCtx);

    if (pageRect) {
      this.predictionCtx.save();
      this.predictionCtx.beginPath();
      this.predictionCtx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      this.predictionCtx.clip();
    }

    const path = generateStrokePath(combined, style, false);
    if (path) {
      const dark = useDarkColors ?? this.isDarkMode;
      const color = resolveColor(style.color, dark);
      this.predictionCtx.fillStyle = color;
      this.predictionCtx.globalAlpha = style.opacity * 0.5; // Predictions are semi-transparent
      this.predictionCtx.fill(path);
      this.predictionCtx.globalAlpha = 1;
    }

    if (pageRect) {
      this.predictionCtx.restore();
    }

    this.camera.resetContext(this.predictionCtx);
  }

  /**
   * Clear the active and prediction layers (called on stroke finalization).
   */
  clearActiveLayer(): void {
    this.clearCanvas(this.activeCtx);
    this.clearCanvas(this.predictionCtx);
    this.pendingActiveRender = null;
    this.activeStampCount = 0;
    this.activeVertices = null;
    this.activeVerticesPointCount = 0;
  }

  /**
   * Get cached or generate Float32Array vertices for the active stroke.
   * Only regenerates when point count changes (vertices grow monotonically
   * as points are added during a stroke).
   */
  private getActiveVertices(
    points: readonly StrokePoint[],
    style: PenStyle,
  ): Float32Array | null {
    if (points.length === this.activeVerticesPointCount && this.activeVertices) {
      return this.activeVertices;
    }
    const vertices = generateStrokeVertices(points, style, false);
    this.activeVertices = vertices;
    this.activeVerticesPointCount = points.length;
    return vertices;
  }

  /**
   * Invalidate the path cache (e.g., when styles change).
   */
  invalidateCache(strokeId?: string): void {
    if (strokeId) {
      this.pathCache.delete(strokeId);
      this.tiledLayer?.invalidateStroke(strokeId);
    } else {
      this.pathCache.clear();
      this.tiledLayer?.invalidateAll();
    }
  }

  /**
   * Initialize the grain texture generator.
   */
  initGrain(): void {
    this.grainGenerator = new GrainTextureGenerator();
    this.grainGenerator.initialize();
    if (this.tiledLayer) {
      this.tiledLayer.tileRenderer.setGrainGenerator(this.grainGenerator);
      this.tiledLayer.setWebGLGrainGenerator(this.grainGenerator);
      this.tiledLayer.initWorkerGrain(this.grainGenerator);
    }
  }

  /**
   * Initialize the stamp texture manager for stamp-based pencil rendering.
   */
  initStamps(): void {
    this.stampManager = new StampTextureManager();
    // Pre-generate the default grain cache
    this.stampManager.getCache(DEFAULT_GRAIN_VALUE);
    if (this.tiledLayer) {
      this.tiledLayer.tileRenderer.setStampManager(this.stampManager);
      this.tiledLayer.setWebGLStampManager(this.stampManager);
      this.tiledLayer.initWorkerStamps();
    }
  }

  /**
   * Initialize the ink stamp texture manager for fountain pen stamp rendering.
   */
  initInkStamps(): void {
    this.inkStampManager = new InkStampTextureManager();
    // Pre-generate the standard preset cache
    this.inkStampManager.getCache("standard");
    if (this.tiledLayer) {
      this.tiledLayer.tileRenderer.setInkStampManager(this.inkStampManager);
      this.tiledLayer.setWebGLInkStampManager(this.inkStampManager);
      this.tiledLayer.initWorkerInkStamps();
    }
  }

  /**
   * Set the current ink preset (called from PaperView on pen settings change).
   */
  setCurrentInkPreset(presetId: string): void {
    this.currentInkPreset = presetId;
  }

  /**
   * Set a per-pen-type grain strength override from user settings.
   */
  setGrainStrength(penType: PenType, strength: number): void {
    this.grainStrengthOverrides.set(penType, strength);
    this.tiledLayer?.tileRenderer.setGrainStrength(penType, strength);
    this.tiledLayer?.setWebGLGrainStrength(penType, strength);
    this.tiledLayer?.updateWorkerGrain(this.grainGenerator, this.grainStrengthOverrides);
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.tiledLayer?.destroy();
    this.tiledLayer = null;
    this.pendingBakes = [];
    this.pendingFinalizations = [];
    this.pathCache.clear();
    this.grainGenerator?.destroy();
    this.grainGenerator = null;
    this.grainOffscreen = null;
    this.grainOffscreenCtx = null;
    this.stampManager?.clear();
    this.stampManager = null;
    this.inkStampManager?.clear();
    this.inkStampManager = null;
    this.activeStampCount = 0;
    this.activeEngine?.destroy();
    this.activeEngine = null;
    this.engineOverlay?.remove();
    this.engineOverlay = null;
    this.backgroundCanvas.remove();
    this.staticCanvas.remove();
    this.activeCanvas.remove();
    this.predictionCanvas.remove();
    this.webglStaticCanvas?.remove();
    this.webglStaticCanvas = null;
    this.webglGL = null;
    this.overlayCanvas?.remove();
    this.overlayCanvas = null;
    this.overlayCtx = null;
  }

  getStaticCanvas(): HTMLCanvasElement {
    return this.staticCanvas;
  }

  getOverscanOffset(): { x: number; y: number } {
    return { x: this.overscanOffsetX, y: this.overscanOffsetY };
  }

  getOverscanCssSize(): { width: number; height: number } {
    return { width: this.overscanCssWidth, height: this.overscanCssHeight };
  }

  /**
   * Apply a CSS transform to all canvas layers for gesture preview.
   *
   * When tiling is enabled, the static canvas is NOT CSS-transformed.
   * Instead, tiles are re-composited at the current camera position.
   * This avoids blank edges since cached tiles already cover beyond the viewport.
   */
  setGestureTransform(tx: number, ty: number, scale: number): void {
    if (this.tiledLayer) {
      // Tiled: defer the WebGL composite to the next animation frame.
      // Trackpad pinch events fire much faster than the display refresh
      // rate; compositing on every event wastes GPU work and stalls the
      // main thread. RAF coalesces to one composite per display frame.
      if (this.gestureRafId === null) {
        this.gestureRafId = requestAnimationFrame(() => {
          this.gestureRafId = null;
          this.tiledLayer?.gestureUpdate(
            this.staticCtx, this.staticCanvas,
            this.cssWidth, this.cssHeight,
          );
        });
      }
    } else {
      // Legacy: CSS-transform the overscan background + static canvases
      const oxAdj = tx + this.overscanOffsetX * (scale - 1);
      const oyAdj = ty + this.overscanOffsetY * (scale - 1);
      const overscanValue = `translate(${oxAdj}px, ${oyAdj}px) scale(${scale})`;
      this.backgroundCanvas.style.transform = overscanValue;
      this.staticCanvas.style.transform = overscanValue;
    }

    // Active/prediction canvases: viewport-sized, simple CSS transform
    const viewportValue = `translate(${tx}px, ${ty}px) scale(${scale})`;
    this.activeCanvas.style.transform = viewportValue;
    this.predictionCanvas.style.transform = viewportValue;
    // In WebGL tiled mode, the overlay is re-drawn at the current camera position
    // by gestureUpdate() → drawOverlay(), so no CSS transform needed.
    // In non-WebGL mode there's no overlay canvas.
    // (Applying CSS transform here would cause double-movement.)
  }

  /**
   * Clear CSS gesture transforms on all canvas layers.
   * Call this at gesture end, followed by a real render.
   */
  clearGestureTransform(): void {
    // Cancel any pending gesture RAF so it doesn't fire after gesture end
    if (this.gestureRafId !== null) {
      cancelAnimationFrame(this.gestureRafId);
      this.gestureRafId = null;
    }
    if (this.tiledLayer) {
      this.tiledLayer.endGesture();
    } else {
      this.backgroundCanvas.style.transform = "";
      this.staticCanvas.style.transform = "";
    }
    this.activeCanvas.style.transform = "";
    this.predictionCanvas.style.transform = "";
    // Overlay canvas: no CSS gesture transform is applied in WebGL tiled mode
    // (drawOverlay handles positioning), so nothing to clear.
  }

  // ─── Tile-Based Rendering ──────────────────────────────────────

  get isTilingEnabled(): boolean {
    return this.tiledLayer !== null;
  }

  enableTiling(config?: Partial<TileGridConfig>): void {
    if (this.tiledLayer) return;

    const dpr = getEffectiveDPR(this.isMobile);
    const useWebGL = this.engineType !== "canvas2d";
    const tileConfig: TileGridConfig = {
      ...DEFAULT_TILE_CONFIG,
      dpr,
      ...config,
    };

    // Create WebGL static canvas + overlay canvas when in WebGL mode
    let webglCanvas: HTMLCanvasElement | undefined;
    if (useWebGL) {
      this.webglStaticCanvas = this.createCanvasLayer("paper-webgl-static-canvas");
      // Size to viewport
      this.webglStaticCanvas.width = Math.round(this.cssWidth * dpr);
      this.webglStaticCanvas.height = Math.round(this.cssHeight * dpr);
      this.webglStaticCanvas.style.width = `${this.cssWidth}px`;
      this.webglStaticCanvas.style.height = `${this.cssHeight}px`;

      this.overlayCanvas = this.createCanvasLayer("paper-overlay-canvas");
      this.overlayCanvas.width = Math.round(this.cssWidth * dpr);
      this.overlayCanvas.height = Math.round(this.cssHeight * dpr);
      this.overlayCanvas.style.width = `${this.cssWidth}px`;
      this.overlayCanvas.style.height = `${this.cssHeight}px`;
      this.overlayCtx = this.overlayCanvas.getContext("2d");

      webglCanvas = this.webglStaticCanvas;
    }

    this.tiledLayer = new TiledStaticLayer(
      this.camera,
      tileConfig,
      this.pathCache,
      useWebGL,
      webglCanvas,
    );

    // Share overlay canvas with tiled layer for WebGL mode
    if (useWebGL && this.overlayCanvas && this.overlayCtx) {
      this.tiledLayer.setOverlayCanvas(this.overlayCanvas, this.overlayCtx);
    }

    // Cache GL context and wire up post-composite flush for async tile arrivals
    if (useWebGL && this.webglStaticCanvas) {
      this.webglGL = this.webglStaticCanvas.getContext("webgl2");
      this.tiledLayer.setAfterCompositeCallback(() => this.webglGL?.flush());
    }

    // Share grain resources with tile renderers
    if (this.grainGenerator) {
      this.tiledLayer.tileRenderer.setGrainGenerator(this.grainGenerator);
      this.tiledLayer.setWebGLGrainGenerator(this.grainGenerator);
      this.tiledLayer.initWorkerGrain(this.grainGenerator);
    }
    for (const [penType, strength] of this.grainStrengthOverrides) {
      this.tiledLayer.tileRenderer.setGrainStrength(penType, strength);
      this.tiledLayer.setWebGLGrainStrength(penType, strength);
    }
    if (this.grainStrengthOverrides.size > 0) {
      this.tiledLayer.updateWorkerGrain(this.grainGenerator, this.grainStrengthOverrides);
    }

    // Share stamp resources
    if (this.stampManager) {
      this.tiledLayer.tileRenderer.setStampManager(this.stampManager);
      this.tiledLayer.setWebGLStampManager(this.stampManager);
      this.tiledLayer.initWorkerStamps();
    }
    if (this.inkStampManager) {
      this.tiledLayer.tileRenderer.setInkStampManager(this.inkStampManager);
      this.tiledLayer.setWebGLInkStampManager(this.inkStampManager);
      this.tiledLayer.initWorkerInkStamps();
    }

    // Share pipeline
    this.tiledLayer.setPipeline(this.pipeline);
  }

  disableTiling(): void {
    this.tiledLayer?.destroy();
    this.tiledLayer = null;
    this.backgroundCanvas.style.display = "";
    this.staticCanvas.style.display = "";
    this.webglStaticCanvas?.remove();
    this.webglStaticCanvas = null;
    this.overlayCanvas?.remove();
    this.overlayCanvas = null;
    this.overlayCtx = null;
  }

  /**
   * Get a GrainRenderContext that wraps this Renderer's grain resources.
   */
  private getGrainRenderContext(canvasWidth: number, canvasHeight: number): GrainRenderContext {
    return {
      generator: this.grainGenerator,
      strengthOverrides: this.grainStrengthOverrides,
      pipeline: this.pipeline,
      getOffscreen: (minW: number, minH: number) => {
        const ctx = this.ensureGrainOffscreen(minW, minH);
        if (!ctx || !this.grainOffscreen) return null;
        return { canvas: this.grainOffscreen, ctx };
      },
      canvasWidth,
      canvasHeight,
    };
  }

  private getStampRenderContext(): StampRenderContext | null {
    if (!this.stampManager) return null;
    return {
      getCache: (gv) => this.stampManager!.getCache(gv),
      getInkCache: (presetId) => {
        if (!this.inkStampManager) {
          this.initInkStamps();
        }
        return this.inkStampManager!.getCache(presetId);
      },
    };
  }

  private renderStrokeToContext(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    styles: Record<string, PenStyle>,
    lod: 0 | 1 | 2 | 3 = 0,
    useDarkColors?: boolean,
  ): void {
    const dark = useDarkColors ?? this.isDarkMode;
    const grainCtx = this.getGrainRenderContext(
      this.staticCanvas.width,
      this.staticCanvas.height,
    );
    const stampCtx = this.getStampRenderContext();
    renderStrokeToContext(ctx, stroke, styles, lod, dark, this.pathCache, grainCtx, stampCtx);
  }

  private applyGrainToStrokeLocal(
    ctx: CanvasRenderingContext2D,
    path: Path2D,
    grainStrength: number,
    anchorX: number,
    anchorY: number,
  ): void {
    const grainCtx = this.getGrainRenderContext(
      this.activeCanvas.width,
      this.activeCanvas.height,
    );
    applyGrainToStroke(ctx, path, grainStrength, anchorX, anchorY, grainCtx);
  }

  /**
   * Ensure the reusable offscreen canvas for grain-isolated rendering
   * is at least the requested size. Only grows, never shrinks, to avoid
   * churn from many small strokes. Minimum 256px floor.
   */
  private ensureGrainOffscreen(minW: number, minH: number): CanvasRenderingContext2D | null {
    minW = Math.max(256, Math.ceil(minW));
    minH = Math.max(256, Math.ceil(minH));

    if (!this.grainOffscreen) {
      this.grainOffscreen = document.createElement("canvas");
      this.grainOffscreen.width = minW;
      this.grainOffscreen.height = minH;
      this.grainOffscreenCtx = this.grainOffscreen.getContext("2d");
    } else if (this.grainOffscreen.width < minW || this.grainOffscreen.height < minH) {
      this.grainOffscreen.width = Math.max(this.grainOffscreen.width, minW);
      this.grainOffscreen.height = Math.max(this.grainOffscreen.height, minH);
      this.grainOffscreenCtx = this.grainOffscreen.getContext("2d");
    }

    return this.grainOffscreenCtx;
  }


  private clearCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
  }

  private clearOverscanCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.overscanCssWidth, this.overscanCssHeight);
  }

  /**
   * Apply camera transform with overscan offset compensation.
   * The overscan canvas origin is shifted from the viewport origin by overscanOffset,
   * so the camera translation must compensate.
   */
  private applyOverscanCameraTransform(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.transform(
      this.camera.zoom, 0, 0, this.camera.zoom,
      -this.camera.x * this.camera.zoom - this.overscanOffsetX,
      -this.camera.y * this.camera.zoom - this.overscanOffsetY,
    );
  }

  private scheduleFrame(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      // 1. Finalizations first (add strokes to document, then bake inline)
      if (this.pendingFinalizations.length > 0) {
        const fns = this.pendingFinalizations;
        this.pendingFinalizations = [];
        for (const fn of fns) {
          fn();
        }
      }
      // 2. Standalone bakes (from scheduleBake calls)
      if (this.pendingBakes.length > 0) {
        for (const { stroke, styles, pageRect, useDarkColors } of this.pendingBakes) {
          this.bakeStroke(stroke, styles, pageRect, useDarkColors);
        }
        this.pendingBakes = [];
      }
      // 3. Active stroke render
      if (this.pendingActiveRender) {
        this.pendingActiveRender();
        this.pendingActiveRender = null;
      }
    });
  }
}

function bboxOverlaps(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];
}

/**
 * Orchestrates tile-based static stroke rendering.
 * Manages TileGrid, TileCache, TileRenderer, TileCompositor, and TileRenderScheduler.
 *
 * Uses WorkerTileScheduler for concurrent off-thread rendering when available,
 * falling back to main-thread TileRenderScheduler if Worker creation fails.
 *
 * Tiles have a fixed world size. The grid never changes with zoom — only the
 * rendering resolution (canvas pixel size) varies per zoom band. Each grid
 * position has one cache slot.
 */
class TiledStaticLayer {
  private camera: Camera;
  private config: TileGridConfig;
  private grid: TileGrid;
  private cache: TileCache;
  readonly tileRenderer: TileRenderer;
  private compositor: TileCompositor;
  /** Main-thread fallback scheduler. Used only when workers are unavailable. */
  private mainThreadScheduler: TileRenderScheduler;
  /** Worker-based scheduler for concurrent tile rendering. */
  private workerScheduler: WorkerTileScheduler;
  /** True if worker scheduler failed init → all async work goes through main thread. */
  private useMainThreadFallback = false;
  private gestureActive = false;
  /** Monotonic counter incremented on doc mutation. Workers sync only when stale. */
  private docVersion = 0;
  /** Last docVersion sent to workers. */
  private workerDocVersion = -1;
  /** Current rendering pipeline. */
  private pipeline: RenderPipeline = "basic";

  // WebGL tile rendering components (null when Canvas2D mode)
  private webglTileEngine: WebGLTileEngine | null = null;
  private glCache: WebGLTileCache | null = null;
  private glCompositor: WebGLTileCompositor | null = null;
  /** True when WebGL tile path is active. Switches to false on context loss. */
  useWebGLTiles = false;
  private webglOverlayCtx: CanvasRenderingContext2D | null = null;
  private webglOverlayCanvas: HTMLCanvasElement | null = null;
  /** Reference to the webgl canvas for context loss event handling. */
  private webglCanvas: HTMLCanvasElement | null = null;
  /** Tracked config state for context restore re-initialization. */
  private currentGrainGenerator: GrainTextureGenerator | null = null;
  private currentStampManager: StampTextureManager | null = null;
  private currentInkStampManager: InkStampTextureManager | null = null;

  // Cached state for scheduler callbacks
  private currentDoc: PaperDocument | null = null;
  private currentPageLayout: PageRect[] = [];
  private currentSpatialIndex: SpatialIndex | null = null;
  private currentIsDarkMode = false;
  private currentCtx: CanvasRenderingContext2D | null = null;
  private currentCanvas: HTMLCanvasElement | null = null;
  private currentScreenWidth = 0;
  private currentScreenHeight = 0;
  /** Optional callback to draw overlays (e.g. page icons) after compositing. */
  private overlayCallback: ((ctx: CanvasRenderingContext2D, visibleRect: [number, number, number, number]) => void) | null = null;
  /** Callback invoked after WebGL compositing (e.g. to flush GL or blit). */
  private afterCompositeCallback: (() => void) | null = null;

  constructor(camera: Camera, config: TileGridConfig, pathCache: StrokePathCache, useEngine = false, webglCanvas?: HTMLCanvasElement) {
    this.camera = camera;
    this.config = config;
    this.grid = new TileGrid(config);
    this.cache = new TileCache(config);
    this.tileRenderer = new TileRenderer(this.grid, config, pathCache, useEngine);
    this.compositor = new TileCompositor(this.grid, config);

    // Try to initialize WebGL tile path
    if (webglCanvas) {
      try {
        const webglEngine = new WebGLTileEngine(webglCanvas, config, pathCache);
        const gl = webglEngine.getGL();
        this.webglTileEngine = webglEngine;
        this.glCache = new WebGLTileCache(gl, config);
        this.glCompositor = new WebGLTileCompositor(gl, this.grid, config);
        this.useWebGLTiles = true;
      } catch (e) {
        console.warn("[TiledStaticLayer] WebGL tile init failed, falling back to Canvas2D:", e);
        this.useWebGLTiles = false;
      }
    }

    // Main-thread fallback scheduler (used if workers fail)
    this.mainThreadScheduler = new TileRenderScheduler(
      (key) => this.renderOneTile(key),
      () => this.onSchedulerBatchComplete(),
    );

    // Worker-based scheduler (with optional WebGL tile result callback)
    const onTileResult = this.useWebGLTiles
      ? (tileKey: string, bitmap: ImageBitmap, strokeIds: string[], dispatchBand: number | undefined) => {
          this.handleWebGLTileResult(tileKey, bitmap, strokeIds, dispatchBand);
        }
      : undefined;

    this.workerScheduler = new WorkerTileScheduler(
      config,
      this.cache,
      this.grid,
      () => this.onSchedulerBatchComplete(),
      onTileResult,
    );

    this.useMainThreadFallback = this.workerScheduler.fallbackToMainThread;

    // Context loss handling for WebGL tile path
    if (webglCanvas && this.useWebGLTiles) {
      this.webglCanvas = webglCanvas;
      webglCanvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        console.warn("[TiledStaticLayer] WebGL context lost, falling back to Canvas2D");
        this.useWebGLTiles = false;
        // GPU resources are auto-destroyed on context loss — just clear refs
        this.glCache?.clear();
      });

      webglCanvas.addEventListener("webglcontextrestored", () => {
        console.info("[TiledStaticLayer] WebGL context restored, rebuilding resources");
        try {
          // Re-create the tile engine, cache, and compositor on the restored context
          const newEngine = new WebGLTileEngine(webglCanvas, config, pathCache);
          const gl = newEngine.getGL();
          this.webglTileEngine?.destroy();
          this.webglTileEngine = newEngine;
          this.glCache = new WebGLTileCache(gl, config);
          this.glCompositor?.destroy();
          this.glCompositor = new WebGLTileCompositor(gl, this.grid, config);

          // Re-apply config state
          if (this.currentGrainGenerator) {
            this.webglTileEngine.setGrainGenerator(this.currentGrainGenerator);
          }
          if (this.currentStampManager) {
            this.webglTileEngine.setStampManager(this.currentStampManager);
          }
          if (this.currentInkStampManager) {
            this.webglTileEngine.setInkStampManager(this.currentInkStampManager);
          }
          this.webglTileEngine.setPipeline(this.pipeline);

          this.useWebGLTiles = true;
          this.glCache.invalidateAll();
        } catch (err) {
          console.warn("[TiledStaticLayer] WebGL context restore failed:", err);
          this.useWebGLTiles = false;
        }
      });
    }
  }

  /** Set a callback invoked after async WebGL compositing to blit to Canvas2D. */
  setAfterCompositeCallback(cb: (() => void) | null): void {
    this.afterCompositeCallback = cb;
  }

  /** Set the overlay canvas for WebGL mode (page icons drawn here). */
  setOverlayCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    this.webglOverlayCanvas = canvas;
    this.webglOverlayCtx = ctx;
  }

  /** Handle worker tile results in WebGL mode: upload bitmap as GPU texture. */
  private handleWebGLTileResult(
    tileKey: string,
    bitmap: ImageBitmap,
    strokeIds: string[],
    dispatchBand: number | undefined,
  ): void {
    if (!this.glCache) {
      bitmap.close();
      return;
    }

    // Discard results from cancelled jobs (cancel() clears inFlight → dispatchBand undefined)
    if (dispatchBand === undefined) {
      bitmap.close();
      return;
    }

    // Parse "col,row" back to TileKey
    const parts = tileKey.split(",");
    if (parts.length !== 2) { bitmap.close(); return; }
    const col = parseInt(parts[0], 10);
    const row = parseInt(parts[1], 10);
    if (isNaN(col) || isNaN(row)) { bitmap.close(); return; }

    const key = { col, row };
    const existing = this.glCache.getStale(key);

    // Never overwrite an FBO tile with a worker bitmap. FBO tiles can be
    // re-rendered synchronously by WebGLTileEngine.renderTile() at any time,
    // while uploadFromBitmap() would destroy the FBO — making the tile
    // permanently unable to be FBO-rendered (renderTile bails on fbo===null).
    // If the tile is dirty, renderVisible() will FBO-render it on the next frame.
    if (existing?.fbo) {
      bitmap.close();
      return;
    }

    const worldBounds = this.grid.tileBounds(col, row);

    this.glCache.uploadFromBitmap(key, bitmap, worldBounds, dispatchBand, new Set(strokeIds));
    bitmap.close();

    // Schedule a batched composite
    this.scheduleWebGLComposite();
  }

  private webglCompositeRafId: number | null = null;
  private scheduleWebGLComposite(): void {
    if (this.webglCompositeRafId !== null) return;
    this.webglCompositeRafId = requestAnimationFrame(() => {
      this.webglCompositeRafId = null;
      this.onSchedulerBatchComplete();
    });
  }

  // ─── Worker Grain / Document Sync ────────────────────────────

  /** Send grain texture to all workers. */
  initWorkerGrain(grainGenerator: GrainTextureGenerator | null): void {
    if (this.useMainThreadFallback) return;
    this.workerScheduler.initGrain(grainGenerator);
  }

  /** Send grain update (new texture + strength overrides) to all workers. */
  updateWorkerGrain(
    grainGenerator: GrainTextureGenerator | null,
    strengthOverrides: Map<PenType, number>,
  ): void {
    if (this.useMainThreadFallback) return;
    this.workerScheduler.updateGrain(grainGenerator, strengthOverrides);
  }

  /** Signal workers to enable stamp rendering (workers generate textures locally). */
  initWorkerStamps(): void {
    if (this.useMainThreadFallback) return;
    this.workerScheduler.initStamps();
  }

  /** Signal workers to enable ink stamp rendering. */
  initWorkerInkStamps(): void {
    if (this.useMainThreadFallback) return;
    this.workerScheduler.initInkStamps();
  }

  /** Update the rendering pipeline for the tile renderer and workers. */
  setPipeline(pipeline: RenderPipeline): void {
    this.pipeline = pipeline;
    this.tileRenderer.setPipeline(pipeline);
    this.webglTileEngine?.setPipeline(pipeline);
    // Force doc resync so workers pick up the new pipeline
    this.bumpDocVersion();
  }

  // ─── WebGL Tile Engine Config Forwarding ───────────────────

  setWebGLGrainGenerator(generator: GrainTextureGenerator | null): void {
    this.currentGrainGenerator = generator;
    this.webglTileEngine?.setGrainGenerator(generator);
  }

  setWebGLGrainStrength(penType: PenType, strength: number): void {
    this.webglTileEngine?.setGrainStrength(penType, strength);
  }

  setWebGLStampManager(manager: StampTextureManager | null): void {
    this.currentStampManager = manager;
    this.webglTileEngine?.setStampManager(manager);
  }

  setWebGLInkStampManager(manager: InkStampTextureManager | null): void {
    this.currentInkStampManager = manager;
    this.webglTileEngine?.setInkStampManager(manager);
  }

  /** Send document state to workers only if it changed since last sync. */
  syncDocumentToWorkers(): void {
    if (this.useMainThreadFallback) return;
    if (!this.currentDoc) return;
    if (this.workerDocVersion === this.docVersion) return;
    this.workerDocVersion = this.docVersion;
    this.workerScheduler.updateDocument(this.currentDoc, this.currentPageLayout, this.pipeline);
  }

  /** Mark document as changed so next syncDocumentToWorkers() sends an update. */
  private bumpDocVersion(): void {
    this.docVersion++;
  }

  // ─── Scheduling Helper ───────────────────────────────────────

  /** Schedule tiles using workers or main-thread fallback. */
  private scheduleAsync(
    tiles: TileKey[],
    visibleKeySet: Set<string>,
  ): void {
    if (this.useMainThreadFallback) {
      this.mainThreadScheduler.schedule(tiles, visibleKeySet);
    } else {
      if (!this.currentSpatialIndex) return;
      const zoomBand = zoomToZoomBand(this.camera.zoom);
      // Ensure workers have current document state
      this.syncDocumentToWorkers();
      this.workerScheduler.schedule(
        tiles, visibleKeySet, this.currentSpatialIndex,
        this.currentIsDarkMode, zoomBand,
      );
    }
  }

  private cancelAsync(): void {
    this.mainThreadScheduler.cancel();
    this.workerScheduler.cancel();
  }

  // ─── Render Visible ──────────────────────────────────────────

  /**
   * Render visible tiles and composite them onto the static canvas.
   * Called from Renderer.renderStaticLayer() — typically at gesture end
   * or on document load/undo/redo.
   *
   * Re-renders tiles that are dirty or at the wrong zoom band resolution.
   */
  renderVisible(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    screenWidth: number,
    screenHeight: number,
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
  ): void {
    // renderVisible is called on load/undo/redo — doc may have changed
    this.bumpDocVersion();

    this.currentDoc = doc;
    this.currentPageLayout = pageLayout;
    this.currentSpatialIndex = spatialIndex;
    this.currentIsDarkMode = isDarkMode;
    this.currentCtx = ctx;
    this.currentCanvas = canvas;
    this.currentScreenWidth = screenWidth;
    this.currentScreenHeight = screenHeight;

    this.cancelAsync();

    const currentZoomBand = zoomToZoomBand(this.camera.zoom);
    const visibleTiles = this.grid.getVisibleTiles(this.camera, screenWidth, screenHeight);
    const visibleKeySet = new Set(visibleTiles.map(tileKeyString));

    if (this.useWebGLTiles && this.glCache && this.glCompositor && this.webglTileEngine) {
      // ─── WebGL path ───────────────────────────────────────
      this.glCache.protect(visibleKeySet);
      this.glCompositor.setDarkMode(isDarkMode);

      // Sync-render visible tiles via WebGLTileEngine into FBO textures.
      // Renders both blank tiles (not in cache) and dirty/wrong-band tiles.
      // This is the key advantage of the WebGL path: FBO rendering is fast enough
      // to do synchronously for all visible tiles on every renderVisible() call.
      let renderedCount = 0;
      for (const key of visibleTiles) {
        const existing = this.glCache.getStale(key);
        if (!existing || existing.dirty || existing.renderedAtBand !== currentZoomBand) {
          renderedCount++;
          const worldBounds = this.grid.tileBounds(key.col, key.row);
          const entry = this.glCache.allocate(key, worldBounds, currentZoomBand);
          this.webglTileEngine.renderTile(entry, doc, pageLayout, spatialIndex, isDarkMode);
          this.glCache.markClean(key);
        }
      }

      // Schedule async re-renders for off-screen dirty tiles (background prefetch)
      const toSchedule: TileKey[] = [];
      const dirtyGLTiles = this.glCache.getDirtyTiles(visibleKeySet);
      for (const entry of dirtyGLTiles) {
        if (!visibleKeySet.has(tileKeyString(entry.key))) {
          toSchedule.push(entry.key);
        }
      }
      if (toSchedule.length > 0) {
        this.scheduleAsync(toSchedule, visibleKeySet);
      }

      // Composite tile textures onto webglStaticCanvas
      this.glCompositor.composite(this.camera, screenWidth, screenHeight, this.glCache);
      this.webglTileEngine?.resetState();
      this.drawOverlay();

      return;
    }

    // ─── Canvas2D path (unchanged) ──────────────────────────
    this.cache.protect(visibleKeySet);

    for (const key of visibleTiles) {
      if (!this.cache.getStale(key)) {
        const worldBounds = this.grid.tileBounds(key.col, key.row);
        const newEntry = this.cache.allocate(key, worldBounds, currentZoomBand);
        this.tileRenderer.renderTile(newEntry, doc, pageLayout, spatialIndex, isDarkMode);
        this.cache.markClean(key);
      }
    }

    const toSchedule: TileKey[] = [];
    for (const key of visibleTiles) {
      const entry = this.cache.getStale(key);
      if (entry && (entry.dirty || entry.renderedAtBand !== currentZoomBand)) {
        toSchedule.push(key);
      }
    }
    const dirtyTiles = this.cache.getDirtyTiles(visibleKeySet);
    for (const entry of dirtyTiles) {
      if (!visibleKeySet.has(tileKeyString(entry.key))) {
        toSchedule.push(entry.key);
      }
    }
    if (toSchedule.length > 0) {
      this.scheduleAsync(toSchedule, visibleKeySet);
    }

    this.compositor.composite(ctx, canvas, this.camera, screenWidth, screenHeight, this.cache);
    this.drawOverlay();
  }

  /**
   * Incrementally add a stroke to affected tiles and re-composite.
   * Renders synchronously on main thread for immediate feedback,
   * then syncs doc state to workers for future async renders.
   */
  bakeStroke(
    stroke: Stroke,
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    screenWidth: number,
    screenHeight: number,
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
  ): void {
    // bakeStroke adds a new stroke — doc has changed
    this.bumpDocVersion();

    this.currentDoc = doc;
    this.currentPageLayout = pageLayout;
    this.currentSpatialIndex = spatialIndex;
    this.currentIsDarkMode = isDarkMode;
    this.currentCtx = ctx;
    this.currentCanvas = canvas;
    this.currentScreenWidth = screenWidth;
    this.currentScreenHeight = screenHeight;

    const currentZoomBand = zoomToZoomBand(this.camera.zoom);
    const affectedTiles = this.grid.getTilesForWorldBBox(stroke.bbox);

    if (this.useWebGLTiles && this.glCache && this.glCompositor && this.webglTileEngine) {
      // ─── WebGL path ───────────────────────────────────────
      const visibleTiles = this.grid.getVisibleTiles(this.camera, screenWidth, screenHeight);
      this.glCache.protect(new Set(visibleTiles.map(tileKeyString)));
      this.glCompositor.setDarkMode(isDarkMode);

      for (const key of affectedTiles) {
        const worldBounds = this.grid.tileBounds(key.col, key.row);
        let entry = this.glCache.getStale(key);
        if (!entry || entry.renderedAtBand !== currentZoomBand) {
          entry = this.glCache.allocate(key, worldBounds, currentZoomBand);
        }
        this.webglTileEngine.renderTile(entry, doc, pageLayout, spatialIndex, isDarkMode);
        this.glCache.markClean(key);
      }

      this.glCache.unprotect();
      this.syncDocumentToWorkers();
      this.glCompositor.composite(this.camera, screenWidth, screenHeight, this.glCache);
      this.webglTileEngine?.resetState();
      this.drawOverlay();
      return;
    }

    // ─── Canvas2D path (unchanged) ──────────────────────────
    const visibleTiles = this.grid.getVisibleTiles(this.camera, screenWidth, screenHeight);
    this.cache.protect(new Set(visibleTiles.map(tileKeyString)));

    for (const key of affectedTiles) {
      const worldBounds = this.grid.tileBounds(key.col, key.row);
      let entry = this.cache.getStale(key);
      if (!entry || entry.renderedAtBand !== currentZoomBand) {
        entry = this.cache.allocate(key, worldBounds, currentZoomBand);
      }
      this.tileRenderer.renderTile(entry, doc, pageLayout, spatialIndex, isDarkMode);
      this.cache.markClean(key);
    }

    this.cache.unprotect();
    this.syncDocumentToWorkers();
    this.compositor.composite(ctx, canvas, this.camera, screenWidth, screenHeight, this.cache);
    this.drawOverlay();
  }

  /**
   * Update during a gesture: composite cached tiles and schedule async
   * rendering for any missing tiles (newly visible from pan/zoom-out).
   *
   * - Zoom in: no new tiles needed (viewport shrinks). Existing tiles
   *   are scaled — slightly blurry but acceptable.
   * - Zoom out: new grid positions are scheduled for rendering at the
   *   current zoom band. Once rendered, they are not re-rendered until
   *   gesture end.
   */
  gestureUpdate(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    screenWidth: number,
    screenHeight: number,
  ): void {
    this.gestureActive = true;
    this.currentCtx = ctx;
    this.currentCanvas = canvas;
    this.currentScreenWidth = screenWidth;
    this.currentScreenHeight = screenHeight;

    const visibleTiles = this.grid.getVisibleTiles(this.camera, screenWidth, screenHeight);
    const visibleKeySet = new Set(visibleTiles.map(tileKeyString));

    if (this.useWebGLTiles && this.glCache && this.glCompositor && this.webglTileEngine) {
      // ─── WebGL path ───────────────────────────────────────
      this.glCache.protect(visibleKeySet);

      // Composite already-cached tiles (no synchronous FBO rendering).
      this.glCompositor.composite(this.camera, screenWidth, screenHeight, this.glCache);
      this.drawOverlay();

      // Schedule async worker rendering for missing/dirty tiles so they
      // appear during the gesture (the next gestureUpdate RAF will
      // composite them once ready).
      const missing: TileKey[] = [];
      for (const key of visibleTiles) {
        if (!this.glCache.getStale(key)) {
          missing.push(key);
        }
      }
      if (missing.length > 0) {
        this.scheduleAsync(missing, visibleKeySet);
      }
      return;
    }

    // ─── Canvas2D path (unchanged) ──────────────────────────
    this.compositor.composite(
      ctx, canvas, this.camera, screenWidth, screenHeight, this.cache,
    );
    this.drawOverlay();

    const missing: TileKey[] = [];
    for (const key of visibleTiles) {
      if (!this.cache.getStale(key)) {
        missing.push(key);
      }
    }
    this.cache.protect(visibleKeySet);
    if (missing.length > 0) {
      this.scheduleAsync(missing, visibleKeySet);
    }
  }

  /**
   * End gesture mode. Cancels the scheduler to prevent stale composites
   * between now and the next renderVisible() call.
   */
  endGesture(): void {
    this.gestureActive = false;
    this.cancelAsync();
    this.cache.unprotect();
    this.glCache?.unprotect();
  }

  /** Set a callback to draw overlays (page icons) after every composite. */
  setOverlay(cb: ((ctx: CanvasRenderingContext2D, visibleRect: [number, number, number, number]) => void) | null): void {
    this.overlayCallback = cb;
  }

  /** Draw the overlay in camera space on top of the current composite. */
  private drawOverlay(): void {
    if (!this.overlayCallback) return;

    if (this.useWebGLTiles && this.webglOverlayCtx && this.webglOverlayCanvas) {
      // WebGL mode: draw overlay on the dedicated overlay canvas
      const ctx = this.webglOverlayCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.webglOverlayCanvas.width, this.webglOverlayCanvas.height);
      ctx.save();
      ctx.setTransform(this.config.dpr, 0, 0, this.config.dpr, 0, 0);
      ctx.transform(
        this.camera.zoom, 0, 0, this.camera.zoom,
        -this.camera.x * this.camera.zoom,
        -this.camera.y * this.camera.zoom,
      );
      const visibleRect = this.camera.getVisibleRect(this.currentScreenWidth, this.currentScreenHeight);
      this.overlayCallback(ctx, visibleRect);
      ctx.restore();
      return;
    }

    // Canvas2D mode: draw overlay on the static canvas context
    if (!this.currentCtx) return;
    const ctx = this.currentCtx;
    ctx.save();
    ctx.setTransform(this.config.dpr, 0, 0, this.config.dpr, 0, 0);
    ctx.transform(
      this.camera.zoom, 0, 0, this.camera.zoom,
      -this.camera.x * this.camera.zoom,
      -this.camera.y * this.camera.zoom,
    );
    const visibleRect = this.camera.getVisibleRect(this.currentScreenWidth, this.currentScreenHeight);
    this.overlayCallback(ctx, visibleRect);
    ctx.restore();
  }

  invalidateStroke(strokeId: string): void {
    this.cache.invalidateStroke(strokeId);
    this.glCache?.invalidateStroke(strokeId);
  }

  invalidateAll(): void {
    this.cache.invalidateAll();
    this.glCache?.invalidateAll();
  }

  /**
   * Render a single tile. Called by the main-thread fallback scheduler
   * during async processing. Renders at the current zoom band.
   *
   * Skips tiles that are already clean at the correct zoom band.
   */
  private renderOneTile(key: TileKey): void {
    if (!this.currentDoc || !this.currentSpatialIndex) return;

    const zoomBand = zoomToZoomBand(this.camera.zoom);
    const entry = this.cache.getStale(key);

    // Already clean at the correct resolution — skip
    if (entry && !entry.dirty && entry.renderedAtBand === zoomBand) return;

    const worldBounds = this.grid.tileBounds(key.col, key.row);
    const allocated = this.cache.allocate(key, worldBounds, zoomBand);
    this.tileRenderer.renderTile(
      allocated, this.currentDoc, this.currentPageLayout,
      this.currentSpatialIndex, this.currentIsDarkMode,
    );
    this.cache.markClean(key);
  }

  /**
   * Called by the scheduler (worker or main-thread) after tiles finish.
   * Re-composites so newly rendered tiles become visible.
   *
   * During a gesture, skip — the next gestureUpdate() (every ~16ms) will
   * composite at the correct camera position. Compositing here with a
   * stale camera snapshot causes edge tiles to flicker.
   */
  private onSchedulerBatchComplete(): void {
    if (this.gestureActive) return;

    if (this.useWebGLTiles && this.glCompositor && this.glCache) {
      this.glCompositor.composite(
        this.camera, this.currentScreenWidth, this.currentScreenHeight,
        this.glCache,
      );
      this.webglTileEngine?.resetState();
      this.drawOverlay();
      this.afterCompositeCallback?.();
      return;
    }

    if (!this.currentCtx || !this.currentCanvas) return;
    this.compositor.composite(
      this.currentCtx, this.currentCanvas,
      this.camera, this.currentScreenWidth, this.currentScreenHeight,
      this.cache,
    );
    this.drawOverlay();
  }

  destroy(): void {
    this.mainThreadScheduler.destroy();
    this.workerScheduler.destroy();
    this.cache.clear();
    this.glCache?.clear();
    this.glCompositor?.destroy();
    this.webglTileEngine?.destroy();
    this.glCache = null;
    this.glCompositor = null;
    this.webglTileEngine = null;
    if (this.webglCompositeRafId !== null) {
      cancelAnimationFrame(this.webglCompositeRafId);
      this.webglCompositeRafId = null;
    }
    this.overlayCallback = null;
    this.afterCompositeCallback = null;
    this.currentDoc = null;
    this.currentSpatialIndex = null;
    this.currentCtx = null;
    this.currentCanvas = null;
    this.webglOverlayCtx = null;
    this.webglOverlayCanvas = null;
  }
}

// Re-export computeScreenBBox from StrokeRenderCore for backwards compatibility
export { computeScreenBBox } from "./StrokeRenderCore";
