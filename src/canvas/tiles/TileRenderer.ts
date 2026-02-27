import type { PaperDocument } from "../../types";
import type { SpatialIndex } from "../../spatial/SpatialIndex";
import type { PageRect } from "../../document/PageLayout";
import type { TileEntry } from "./TileTypes";
import { zoomBandBaseZoom } from "./TileTypes";
import type { TileGrid } from "./TileGrid";
import type { TileGridConfig } from "./TileTypes";
import { StrokePathCache } from "../../stroke/OutlineGenerator";
import { selectLodLevel } from "../../stroke/StrokeSimplifier";
import { resolvePageBackground } from "../../color/ColorUtils";
import { renderStrokeToContext } from "../StrokeRenderCore";
import { renderStrokeToEngine } from "../StrokeRenderCore";
import type { GrainRenderContext, StampRenderContext, EngineGrainContext, EngineStampContext } from "../StrokeRenderCore";
import { InkStampTextureManager } from "../../stamp/InkStampTextureManager";
import { renderDeskFill, renderPageBackground, renderDeskFillEngine, renderPageBackgroundEngine } from "../BackgroundRenderer";
import type { RenderEngine, TextureHandle } from "../engine/RenderEngine";
import { Canvas2DEngine } from "../engine/Canvas2DEngine";
import type { RenderResources } from "../../rendering/RenderResources";

function bboxOverlaps(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];
}

/**
 * Renders strokes onto individual tile OffscreenCanvases.
 * Each tile has a transform mapping its world-space region to pixel coords.
 */
export class TileRenderer {
  private grid: TileGrid;
  private config: TileGridConfig;
  private pathCache: StrokePathCache;
  private grainOffscreen: OffscreenCanvas | null = null;
  private grainOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

  /** Shared rendering resources (grain, stamps, pipeline). */
  private resources: RenderResources;

  /** When true, tile rendering uses the RenderEngine abstraction. */
  private useEngine: boolean;
  private engine: RenderEngine | null = null;
  /** Grain texture handle for engine-based rendering. */
  private engineGrainTexture: TextureHandle | null = null;

  constructor(grid: TileGrid, config: TileGridConfig, pathCache: StrokePathCache, useEngine = false) {
    this.grid = grid;
    this.config = config;
    this.pathCache = pathCache;
    this.useEngine = useEngine;
    this.resources = {
      grainGenerator: null,
      grainStrengthOverrides: new Map(),
      stampManager: null,
      inkStampManager: null,
      pipeline: "basic",
    };
  }

  /**
   * Set the shared render resources. The TileRenderer reads from this
   * reference directly — no per-field setters needed.
   */
  setResources(resources: RenderResources): void {
    this.resources = resources;
  }

  /**
   * Render background and all strokes intersecting a tile's world bounds
   * onto its OffscreenCanvas.
   */
  renderTile(
    tile: TileEntry,
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
  ): void {
    if (this.useEngine) {
      this.renderTileEngine(tile, doc, pageLayout, spatialIndex, isDarkMode);
      return;
    }

    const ctx = tile.ctx;
    const tilePhysical = tile.canvas.width;
    const baseZoom = zoomBandBaseZoom(tile.renderedAtBand);
    const lod = selectLodLevel(baseZoom);

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tilePhysical, tilePhysical);

    // Transform: world coords -> tile pixel coords
    // scale = tilePhysical / tileWorldSize
    const scale = tilePhysical / this.config.tileWorldSize;
    const tx = -tile.worldBounds[0] * scale;
    const ty = -tile.worldBounds[1] * scale;
    ctx.setTransform(scale, 0, 0, scale, tx, ty);

    // lineScale: world units per pixel (for 1-pixel-wide lines/dots)
    const lineScale = this.config.tileWorldSize / tilePhysical;

    // ── Phase 1: Background ──
    renderDeskFill(ctx, tile.worldBounds, isDarkMode);

    for (const pageRect of pageLayout) {
      const pageBbox: [number, number, number, number] = [
        pageRect.x, pageRect.y,
        pageRect.x + pageRect.width, pageRect.y + pageRect.height,
      ];
      if (!bboxOverlaps(pageBbox, tile.worldBounds)) continue;

      const page = doc.pages[pageRect.pageIndex];
      if (!page) continue;

      renderPageBackground(ctx, page, pageRect, isDarkMode, lineScale);
    }

    // ── Phase 2: Strokes ──
    const strokeIds = spatialIndex.queryRect(
      tile.worldBounds[0], tile.worldBounds[1],
      tile.worldBounds[2], tile.worldBounds[3],
    );

    tile.strokeIds.clear();

    const strokeIdSet = new Set(strokeIds);
    const grainCtx = this.getGrainRenderContext(tilePhysical, tilePhysical);
    const stampCtx: StampRenderContext | null = this.resources.stampManager
      ? {
          getCache: (gv) => this.resources.stampManager!.getCache(gv),
          getInkCache: (presetId) => {
            if (!this.resources.inkStampManager) {
              this.resources.inkStampManager = new InkStampTextureManager();
            }
            return this.resources.inkStampManager.getCache(presetId);
          },
        }
      : null;

    for (const pageRect of pageLayout) {
      const pageBbox: [number, number, number, number] = [
        pageRect.x, pageRect.y,
        pageRect.x + pageRect.width, pageRect.y + pageRect.height,
      ];
      if (!bboxOverlaps(pageBbox, tile.worldBounds)) continue;

      const page = doc.pages[pageRect.pageIndex];
      let pageDark = isDarkMode;
      if (page) {
        const { patternTheme } = resolvePageBackground(
          page.backgroundColor, page.backgroundColorTheme, isDarkMode,
        );
        pageDark = patternTheme === "dark";
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      ctx.clip();

      for (const stroke of doc.strokes) {
        if (stroke.pageIndex !== pageRect.pageIndex) continue;
        if (!strokeIdSet.has(stroke.id)) continue;

        renderStrokeToContext(
          ctx, stroke, doc.styles, lod, pageDark,
          this.pathCache, grainCtx, stampCtx,
        );
        tile.strokeIds.add(stroke.id);
      }

      ctx.restore();
    }
  }

  /**
   * Engine-based tile rendering path.
   * Uses Canvas2DEngine via setCanvas() to reuse one engine across tiles.
   */
  private renderTileEngine(
    tile: TileEntry,
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
  ): void {
    // Lazily create the engine on first use
    if (!this.engine) {
      this.engine = new Canvas2DEngine(tile.canvas);
    } else {
      this.engine.setCanvas(tile.canvas);
    }

    const engine = this.engine;
    const tilePhysical = tile.canvas.width;
    const baseZoom = zoomBandBaseZoom(tile.renderedAtBand);
    const lod = selectLodLevel(baseZoom);

    // Clear
    engine.setTransform(1, 0, 0, 1, 0, 0);
    engine.clear();

    // Transform: world coords -> tile pixel coords
    const scale = tilePhysical / this.config.tileWorldSize;
    const tx = -tile.worldBounds[0] * scale;
    const ty = -tile.worldBounds[1] * scale;
    engine.setTransform(scale, 0, 0, scale, tx, ty);

    // lineScale: world units per pixel (for 1-pixel-wide lines/dots)
    const lineScale = this.config.tileWorldSize / tilePhysical;

    // ── Phase 1: Background ──
    renderDeskFillEngine(engine, tile.worldBounds, isDarkMode);

    for (const pageRect of pageLayout) {
      const pageBbox: [number, number, number, number] = [
        pageRect.x, pageRect.y,
        pageRect.x + pageRect.width, pageRect.y + pageRect.height,
      ];
      if (!bboxOverlaps(pageBbox, tile.worldBounds)) continue;

      const page = doc.pages[pageRect.pageIndex];
      if (!page) continue;

      renderPageBackgroundEngine(engine, page, pageRect, isDarkMode, lineScale);
    }

    // ── Phase 2: Strokes ──
    const strokeIds = spatialIndex.queryRect(
      tile.worldBounds[0], tile.worldBounds[1],
      tile.worldBounds[2], tile.worldBounds[3],
    );

    tile.strokeIds.clear();

    const strokeIdSet = new Set(strokeIds);
    const engineGrainCtx = this.getEngineGrainContext(tilePhysical, tilePhysical);
    const engineStampCtx = this.getEngineStampContext();

    for (const pageRect of pageLayout) {
      const pageBbox: [number, number, number, number] = [
        pageRect.x, pageRect.y,
        pageRect.x + pageRect.width, pageRect.y + pageRect.height,
      ];
      if (!bboxOverlaps(pageBbox, tile.worldBounds)) continue;

      const page = doc.pages[pageRect.pageIndex];
      let pageDark = isDarkMode;
      if (page) {
        const { patternTheme } = resolvePageBackground(
          page.backgroundColor, page.backgroundColorTheme, isDarkMode,
        );
        pageDark = patternTheme === "dark";
      }

      engine.save();
      engine.clipRect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);

      for (const stroke of doc.strokes) {
        if (stroke.pageIndex !== pageRect.pageIndex) continue;
        if (!strokeIdSet.has(stroke.id)) continue;

        renderStrokeToEngine(
          engine, stroke, doc.styles, lod, pageDark,
          this.pathCache, engineGrainCtx, engineStampCtx,
        );
        tile.strokeIds.add(stroke.id);
      }

      engine.restore();
    }
  }

  private getGrainRenderContext(canvasWidth: number, canvasHeight: number): GrainRenderContext {
    return {
      generator: this.resources.grainGenerator,
      strengthOverrides: this.resources.grainStrengthOverrides,
      pipeline: this.resources.pipeline,
      getOffscreen: (minW: number, minH: number) => {
        const ctx = this.ensureGrainOffscreen(minW, minH);
        if (!ctx || !this.grainOffscreen) return null;
        return { canvas: this.grainOffscreen, ctx };
      },
      canvasWidth,
      canvasHeight,
    };
  }

  private getEngineGrainContext(canvasWidth: number, canvasHeight: number): EngineGrainContext {
    return {
      grainTexture: this.engineGrainTexture,
      strengthOverrides: this.resources.grainStrengthOverrides,
      pipeline: this.resources.pipeline,
      canvasWidth,
      canvasHeight,
    };
  }

  private getEngineStampContext(): EngineStampContext | null {
    if (!this.resources.stampManager || !this.engine) return null;
    const engine = this.engine;
    const stampManager = this.resources.stampManager;
    // Cache of engine textures created from stamp image sources
    const textureCache = new Map<string, TextureHandle>();
    return {
      getStampTexture: (grainValue: number, color: string): TextureHandle => {
        const key = `stamp-${grainValue}-${color}`;
        let tex = textureCache.get(key);
        if (!tex) {
          const cache = stampManager.getCache(grainValue);
          const colored = cache.getColored(color);
          tex = engine.createTexture(colored);
          textureCache.set(key, tex);
        }
        return tex;
      },
      getInkStampTexture: (presetId: string | undefined, color: string): TextureHandle => {
        if (!this.resources.inkStampManager) {
          this.resources.inkStampManager = new InkStampTextureManager();
        }
        const key = `ink-${presetId ?? "default"}-${color}`;
        let tex = textureCache.get(key);
        if (!tex) {
          const cache = this.resources.inkStampManager.getCache(presetId);
          const colored = cache.getColored(color);
          tex = engine.createTexture(colored);
          textureCache.set(key, tex);
        }
        return tex;
      },
    };
  }

  private ensureGrainOffscreen(minW: number, minH: number): OffscreenCanvasRenderingContext2D | null {
    minW = Math.max(256, Math.ceil(minW));
    minH = Math.max(256, Math.ceil(minH));

    if (!this.grainOffscreen) {
      this.grainOffscreen = new OffscreenCanvas(minW, minH);
      this.grainOffscreenCtx = this.grainOffscreen.getContext("2d");
    } else if (this.grainOffscreen.width < minW || this.grainOffscreen.height < minH) {
      this.grainOffscreen = new OffscreenCanvas(
        Math.max(this.grainOffscreen.width, minW),
        Math.max(this.grainOffscreen.height, minH),
      );
      this.grainOffscreenCtx = this.grainOffscreen.getContext("2d");
    }

    return this.grainOffscreenCtx;
  }

  destroy(): void {
    // Note: grainGenerator is NOT owned by TileRenderer — don't destroy it.
    this.grainOffscreen = null;
    this.grainOffscreenCtx = null;
    if (this.engineGrainTexture && this.engine) {
      this.engine.deleteTexture(this.engineGrainTexture);
      this.engineGrainTexture = null;
    }
    this.engine?.destroy();
    this.engine = null;
  }
}
