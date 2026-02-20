import type { Stroke, PenStyle, StrokePoint, PaperDocument } from "../types";
import type { SpatialIndex } from "../spatial/SpatialIndex";
import type { PageRect } from "../document/PageLayout";
import { Camera } from "./Camera";
import { setupHighDPICanvas, resizeHighDPICanvas, getEffectiveDPR } from "./HighDPI";
import { decodePoints } from "../document/PointEncoder";
import {
  generateStrokePath,
  StrokePathCache,
} from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import type { PenType } from "../types";
import { GrainTextureGenerator } from "./GrainTextureGenerator";
import { selectLodLevel, lodCacheKey, simplifyPoints } from "../stroke/StrokeSimplifier";
import type { LodLevel } from "../stroke/StrokeSimplifier";
import { detectInkPools, renderInkPools } from "../stroke/InkPooling";
import { BackgroundRenderer } from "./BackgroundRenderer";
import type { BackgroundConfig } from "./BackgroundRenderer";
import { resolvePageBackground } from "../color/ColorUtils";

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
  private grainPatternCache = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
  private grainStrengthOverrides = new Map<PenType, number>();
  private grainOffscreen: HTMLCanvasElement | null = null;
  private grainOffscreenCtx: CanvasRenderingContext2D | null = null;
  private bgConfig: BackgroundConfig = {
    isDarkMode: false,
  };

  // RAF batching
  private rafId: number | null = null;
  private pendingActiveRender: (() => void) | null = null;
  private pendingBakes: { stroke: Stroke; styles: Record<string, PenStyle>; pageRect?: PageRect; useDarkColors?: boolean }[] = [];
  private pendingFinalizations: (() => void)[] = [];

  constructor(container: HTMLElement, camera: Camera, isMobile: boolean) {
    this.container = container;
    this.camera = camera;
    this.isMobile = isMobile;

    // Create four stacked canvases (background, static, active, prediction)
    this.backgroundCanvas = this.createCanvasLayer("paper-background-canvas");
    this.staticCanvas = this.createCanvasLayer("paper-static-canvas");
    this.activeCanvas = this.createCanvasLayer("paper-active-canvas");
    this.predictionCanvas = this.createCanvasLayer("paper-prediction-canvas");

    this.backgroundRenderer = new BackgroundRenderer(this.backgroundCanvas, camera);
    this.staticCtx = this.getContext(this.staticCanvas);
    this.activeCtx = this.getContext(this.activeCanvas);
    this.predictionCtx = this.getContext(this.predictionCanvas);
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

  renderStaticLayer(
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex?: SpatialIndex,
    afterBackground?: (ctx: CanvasRenderingContext2D, visibleRect: [number, number, number, number]) => void,
  ): void {
    this.flushFinalizations();
    this.pendingBakes = [];

    // Recalculate overscan to cover nearby pages (may resize canvases)
    this.recalculateOverscan(pageLayout);

    // Match container background to desk color so edges during CSS zoom look seamless
    this.container.style.backgroundColor = this.isDarkMode ? "#111111" : "#e8e8e8";

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
  bakeStroke(stroke: Stroke, styles: Record<string, PenStyle>, pageRect?: PageRect, useDarkColors?: boolean): void {
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

    const path = generateStrokePath(points, style);
    if (path) {
      const color = resolveColor(style.color, this.isDarkMode);
      const penConfig = getPenConfig(style.pen);

      // Grain-enabled strokes rendered in isolation
      if (penConfig.grain?.enabled && points.length > 0) {
        const strength = this.grainStrengthOverrides.get(style.pen) ?? penConfig.grain.strength;
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
          this.renderStrokeWithGrain(ctx, path, color, style.opacity, strength, points[0].x, points[0].y, ptsBbox);
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

      const path = generateStrokePath(points, style);
      if (path) {
        const dark = useDarkColors ?? this.isDarkMode;
        const color = resolveColor(style.color, dark);
        const penConfig = getPenConfig(style.pen);

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
        if (penConfig.grain?.enabled && points.length > 0) {
          const strength = this.grainStrengthOverrides.get(style.pen) ?? penConfig.grain.strength;
          if (strength > 0) {
            this.applyGrainToStroke(this.activeCtx, path, strength, points[0].x, points[0].y);
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

    const path = generateStrokePath(combined, style);
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
  }

  /**
   * Invalidate the path cache (e.g., when styles change).
   */
  invalidateCache(strokeId?: string): void {
    if (strokeId) {
      this.pathCache.delete(strokeId);
    } else {
      this.pathCache.clear();
    }
  }

  /**
   * Initialize the grain texture generator.
   */
  initGrain(): void {
    this.grainGenerator = new GrainTextureGenerator();
    this.grainGenerator.initialize();
  }

  /**
   * Set a per-pen-type grain strength override from user settings.
   */
  setGrainStrength(penType: PenType, strength: number): void {
    this.grainStrengthOverrides.set(penType, strength);
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingBakes = [];
    this.pendingFinalizations = [];
    this.pathCache.clear();
    this.grainGenerator?.destroy();
    this.grainGenerator = null;
    this.grainOffscreen = null;
    this.grainOffscreenCtx = null;
    this.backgroundCanvas.remove();
    this.staticCanvas.remove();
    this.activeCanvas.remove();
    this.predictionCanvas.remove();
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
   * This is O(1) — just a CSS property update — avoiding full re-renders during pan/zoom.
   */
  setGestureTransform(tx: number, ty: number, scale: number): void {
    // Overscan canvases: adjust translation for canvas offset + scale interaction.
    // With transform-origin: 0 0, scaling from the corner means the CSS offset
    // position shifts by offset * (scale - 1). Compensate so the viewport-center
    // portion of the overscan canvas stays aligned.
    const oxAdj = tx + this.overscanOffsetX * (scale - 1);
    const oyAdj = ty + this.overscanOffsetY * (scale - 1);
    const overscanValue = `translate(${oxAdj}px, ${oyAdj}px) scale(${scale})`;
    this.backgroundCanvas.style.transform = overscanValue;
    this.staticCanvas.style.transform = overscanValue;

    // Active/prediction canvases: no offset adjustment needed (viewport-sized)
    const viewportValue = `translate(${tx}px, ${ty}px) scale(${scale})`;
    this.activeCanvas.style.transform = viewportValue;
    this.predictionCanvas.style.transform = viewportValue;
  }

  /**
   * Clear CSS gesture transforms on all canvas layers.
   * Call this at gesture end, followed by a real render.
   */
  clearGestureTransform(): void {
    this.backgroundCanvas.style.transform = "";
    this.staticCanvas.style.transform = "";
    this.activeCanvas.style.transform = "";
    this.predictionCanvas.style.transform = "";
  }

  private renderStrokeToContext(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    styles: Record<string, PenStyle>,
    lod: LodLevel = 0,
    useDarkColors?: boolean,
  ): void {
    // Get or generate Path2D (LOD-aware cache key)
    const cacheKey = lodCacheKey(stroke.id, lod);
    let path = this.pathCache.get(cacheKey);
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
        this.pathCache.set(cacheKey, path);
      }
    }

    if (!path) return;

    const style = resolveStyle(stroke, styles);
    const dark = useDarkColors ?? this.isDarkMode;
    const color = resolveColor(style.color, dark);
    const penConfig = getPenConfig(style.pen);

    // Grain-enabled strokes are rendered in isolation on an offscreen canvas
    // so destination-out only affects this stroke, allowing overlapping strokes
    // to show through grain holes correctly.
    if (lod === 0 && penConfig.grain?.enabled) {
      const strength = this.grainStrengthOverrides.get(style.pen) ?? penConfig.grain.strength;
      if (strength > 0) {
        this.renderStrokeWithGrain(ctx, path, color, style.opacity, strength, stroke.bbox[0], stroke.bbox[1], stroke.bbox);
        return;
      }
    }

    if (penConfig.highlighterMode) {
      // Highlighter: render at full opacity, then composite at reduced alpha
      // This prevents intra-stroke opacity stacking artifacts
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

    // Fountain pen ink pooling (skip at high LOD and for italic nib strokes)
    if (style.pen === "fountain" && lod === 0 && style.nibAngle == null) {
      const points = decodedPoints ?? decodePoints(stroke.pts);
      const pools = detectInkPools(points, style.width);
      if (pools.length > 0) {
        renderInkPools(ctx, pools, color);
      }
    }
  }

  private getGrainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const cached = this.grainPatternCache.get(ctx);
    if (cached) return cached;

    if (!this.grainGenerator) return null;
    const pattern = this.grainGenerator.getPattern(ctx);
    if (pattern) {
      this.grainPatternCache.set(ctx, pattern);
    }
    return pattern;
  }

  private applyGrainToStroke(
    ctx: CanvasRenderingContext2D,
    path: Path2D,
    grainStrength: number,
    anchorX: number,
    anchorY: number,
  ): void {
    const pattern = this.getGrainPattern(ctx);
    if (!pattern) return;

    ctx.save();
    ctx.clip(path);
    // Anchor the grain pattern to the stroke's starting point so each stroke
    // gets a unique grain alignment. Two strokes crossing the same area will
    // have different grain because they start at different positions.
    // Scale of 0.3 = each tile pixel maps to 0.3 world units, producing grain
    // features of ~1.2 world units (~3-6 screen pixels at typical iPad zoom).
    pattern.setTransform(
      new DOMMatrix().translateSelf(anchorX, anchorY).scaleSelf(0.3, 0.3)
    );
    // destination-out: the pattern's alpha punches transparency holes in the
    // stroke, simulating paper texture gaps where graphite didn't deposit.
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = grainStrength;
    ctx.fillStyle = pattern;
    ctx.fill(path);
    ctx.restore();
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

  /**
   * Render a single stroke with grain in isolation on an offscreen canvas,
   * then composite back to the target. This ensures destination-out grain
   * only affects this stroke, so overlapping strokes show through grain holes.
   *
   * When a world-space bbox is provided, the offscreen canvas is scoped to
   * just the stroke's screen-pixel region instead of the full canvas, reducing
   * per-stroke pixel work by 10-20× for typical strokes.
   */
  private renderStrokeWithGrain(
    targetCtx: CanvasRenderingContext2D,
    path: Path2D,
    color: string,
    opacity: number,
    grainStrength: number,
    anchorX: number,
    anchorY: number,
    bbox?: [number, number, number, number],
  ): void {
    const m = targetCtx.getTransform();

    // If bbox provided, scope the offscreen to just the stroke's screen region
    const region = bbox
      ? computeScreenBBox(bbox, m, this.staticCanvas.width, this.staticCanvas.height)
      : null;

    if (bbox && !region) return; // Fully off-screen, skip

    const offW = region ? region.sw : this.staticCanvas.width;
    const offH = region ? region.sh : this.staticCanvas.height;

    const offCtx = this.ensureGrainOffscreen(offW, offH);
    if (!offCtx || !this.grainOffscreen) {
      // Fallback: draw directly without isolation
      targetCtx.fillStyle = color;
      targetCtx.globalAlpha = opacity;
      targetCtx.fill(path);
      targetCtx.globalAlpha = 1;
      return;
    }

    // Clear only the used region
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.clearRect(0, 0, offW, offH);

    if (region) {
      // Offset transform so the bbox's screen origin maps to offscreen (0,0)
      offCtx.setTransform(m.a, m.b, m.c, m.d, m.e - region.sx, m.f - region.sy);
    } else {
      // Copy the current transform (DPR + camera) from the target context
      offCtx.setTransform(m);
    }

    // Draw stroke fill on the isolated offscreen canvas
    offCtx.fillStyle = color;
    offCtx.globalAlpha = opacity;
    offCtx.fill(path);
    offCtx.globalAlpha = 1;

    // Apply grain — destination-out only affects this one stroke
    this.applyGrainToStroke(offCtx, path, grainStrength, anchorX, anchorY);

    // Composite the grain-textured stroke back to the main canvas.
    // Identity transform so offscreen pixels map 1:1 to target pixels.
    // Any active clip region (e.g., page rect) from the target is preserved.
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    if (region) {
      targetCtx.drawImage(
        this.grainOffscreen,
        0, 0, region.sw, region.sh,
        region.sx, region.sy, region.sw, region.sh,
      );
    } else {
      targetCtx.drawImage(this.grainOffscreen, 0, 0);
    }
    targetCtx.restore();
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

/**
 * Resolve the effective PenStyle for a stroke, merging base style with overrides.
 */
function resolveStyle(
  stroke: Stroke,
  styles: Record<string, PenStyle>
): PenStyle {
  const base = styles[stroke.style];
  if (!base) {
    // Fallback to a default style
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

function bboxOverlaps(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];
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

  // Transform all four corners of the world-space bbox to screen pixels
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

  // Add 2px anti-aliasing margin, then clip to canvas bounds
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
