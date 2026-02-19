import type { Stroke, PenStyle, StrokePoint, PaperDocument } from "../types";
import type { SpatialIndex } from "../spatial/SpatialIndex";
import type { PageRect } from "../document/PageLayout";
import { Camera } from "./Camera";
import { setupHighDPICanvas, resizeHighDPICanvas } from "./HighDPI";
import { decodePoints } from "../document/PointEncoder";
import {
  generateStrokePath,
  StrokePathCache,
} from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import { selectLodLevel, lodCacheKey, simplifyPoints } from "../stroke/StrokeSimplifier";
import type { LodLevel } from "../stroke/StrokeSimplifier";
import { detectInkPools, renderInkPools } from "../stroke/InkPooling";
import { BackgroundRenderer } from "./BackgroundRenderer";
import type { BackgroundConfig } from "./BackgroundRenderer";

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
  private bgConfig: BackgroundConfig = {
    isDarkMode: false,
  };

  // RAF batching
  private rafId: number | null = null;
  private pendingActiveRender: (() => void) | null = null;
  private pendingBakes: { stroke: Stroke; styles: Record<string, PenStyle>; pageRect?: PageRect }[] = [];
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

    // Background canvas
    const bgCtx = this.backgroundCanvas.getContext("2d");
    if (bgCtx) {
      resizeHighDPICanvas(this.backgroundCanvas, bgCtx, width, height, this.isMobile);
    }

    this.dpr = setupHighDPICanvas(
      this.staticCanvas,
      this.staticCtx,
      width,
      height,
      this.isMobile
    );
    resizeHighDPICanvas(
      this.activeCanvas,
      this.activeCtx,
      width,
      height,
      this.isMobile
    );
    resizeHighDPICanvas(
      this.predictionCanvas,
      this.predictionCtx,
      width,
      height,
      this.isMobile
    );

    this.backgroundRenderer.setSize(width, height, this.dpr);
  }

  /**
   * Full re-render of all completed strokes onto the static canvas.
   * Called on zoom/pan, document load, or undo/redo.
   */
  setBackgroundConfig(config: Partial<BackgroundConfig>): void {
    this.bgConfig = { ...this.bgConfig, ...config };
  }

  renderStaticLayer(doc: PaperDocument, pageLayout: PageRect[], spatialIndex?: SpatialIndex): void {
    this.flushFinalizations();
    this.pendingBakes = [];
    const ctx = this.staticCtx;
    this.clearCanvas(ctx);

    // Render background on dedicated layer
    this.bgConfig.isDarkMode = this.isDarkMode;
    this.backgroundRenderer.render(this.bgConfig, pageLayout, doc.pages);

    // Apply camera
    this.camera.applyToContext(ctx);

    // Select LOD based on current zoom level
    const lod = selectLodLevel(this.camera.zoom);

    // Render visible strokes with viewport culling
    const visibleRect = this.camera.getVisibleRect(this.cssWidth, this.cssHeight);

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

      ctx.save();
      ctx.beginPath();
      ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      ctx.clip();

      for (const stroke of doc.strokes) {
        if (stroke.pageIndex !== pageRect.pageIndex) continue;

        if (visibleIds) {
          if (visibleIds.has(stroke.id)) {
            this.renderStrokeToContext(ctx, stroke, doc.styles, lod);
          }
        } else {
          if (bboxOverlaps(stroke.bbox, visibleRect)) {
            this.renderStrokeToContext(ctx, stroke, doc.styles, lod);
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
  bakeStroke(stroke: Stroke, styles: Record<string, PenStyle>, pageRect?: PageRect): void {
    const ctx = this.staticCtx;

    // Apply DPR + camera transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);
    this.camera.applyToContext(ctx);

    if (pageRect) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      ctx.clip();
    }

    this.renderStrokeToContext(ctx, stroke, styles);

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
    this.camera.applyToContext(ctx);

    const path = generateStrokePath(points, style);
    if (path) {
      const color = resolveColor(style.color, this.isDarkMode);
      const penConfig = getPenConfig(style.pen);

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
  scheduleBake(stroke: Stroke, styles: Record<string, PenStyle>, pageRect?: PageRect): void {
    this.pendingBakes.push({ stroke, styles, pageRect });
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
    pageRect?: PageRect
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
        const color = resolveColor(style.color, this.isDarkMode);
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
    pageRect?: PageRect
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
      const color = resolveColor(style.color, this.isDarkMode);
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
    this.backgroundCanvas.remove();
    this.staticCanvas.remove();
    this.activeCanvas.remove();
    this.predictionCanvas.remove();
  }

  getStaticCanvas(): HTMLCanvasElement {
    return this.staticCanvas;
  }

  private renderStrokeToContext(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    styles: Record<string, PenStyle>,
    lod: LodLevel = 0
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
    const color = resolveColor(style.color, this.isDarkMode);
    const penConfig = getPenConfig(style.pen);

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

    // Fountain pen ink pooling (skip at high LOD for performance)
    if (style.pen === "fountain" && lod === 0) {
      const points = decodedPoints ?? decodePoints(stroke.pts);
      const pools = detectInkPools(points, style.width);
      if (pools.length > 0) {
        renderInkPools(ctx, pools, color);
      }
    }
  }

  private clearCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
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
        for (const { stroke, styles, pageRect } of this.pendingBakes) {
          this.bakeStroke(stroke, styles, pageRect);
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
