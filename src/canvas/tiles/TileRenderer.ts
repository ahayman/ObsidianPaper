import type { PaperDocument } from "../../types";
import type { PenType } from "../../types";
import type { SpatialIndex } from "../../spatial/SpatialIndex";
import type { PageRect } from "../../document/PageLayout";
import type { TileEntry } from "./TileTypes";
import { zoomBandBaseZoom } from "./TileTypes";
import type { TileGrid } from "./TileGrid";
import type { TileGridConfig } from "./TileTypes";
import { StrokePathCache } from "../../stroke/OutlineGenerator";
import { GrainTextureGenerator } from "../GrainTextureGenerator";
import { selectLodLevel } from "../../stroke/StrokeSimplifier";
import { resolvePageBackground } from "../../color/ColorUtils";
import { renderStrokeToContext } from "../StrokeRenderCore";
import type { GrainRenderContext } from "../StrokeRenderCore";

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
  private grainGenerator: GrainTextureGenerator | null = null;
  private grainStrengthOverrides = new Map<PenType, number>();
  private grainOffscreen: OffscreenCanvas | null = null;
  private grainOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(grid: TileGrid, config: TileGridConfig, pathCache: StrokePathCache) {
    this.grid = grid;
    this.config = config;
    this.pathCache = pathCache;
  }

  initGrain(): void {
    this.grainGenerator = new GrainTextureGenerator();
    this.grainGenerator.initialize();
  }

  setGrainGenerator(generator: GrainTextureGenerator | null): void {
    this.grainGenerator = generator;
  }

  setGrainStrength(penType: PenType, strength: number): void {
    this.grainStrengthOverrides.set(penType, strength);
  }

  /**
   * Render all strokes intersecting a tile's world bounds onto its OffscreenCanvas.
   */
  renderTile(
    tile: TileEntry,
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
  ): void {
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

    // Find intersecting strokes via spatial index
    const strokeIds = spatialIndex.queryRect(
      tile.worldBounds[0], tile.worldBounds[1],
      tile.worldBounds[2], tile.worldBounds[3],
    );

    tile.strokeIds.clear();

    const strokeIdSet = new Set(strokeIds);
    const grainCtx = this.getGrainRenderContext(tilePhysical, tilePhysical);

    // Render strokes grouped by page with per-page clipping
    for (const pageRect of pageLayout) {
      const pageBbox: [number, number, number, number] = [
        pageRect.x, pageRect.y,
        pageRect.x + pageRect.width, pageRect.y + pageRect.height,
      ];
      if (!bboxOverlaps(pageBbox, tile.worldBounds)) continue;

      // Determine page dark mode
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
          this.pathCache, grainCtx,
        );
        tile.strokeIds.add(stroke.id);
      }

      ctx.restore();
    }
  }

  private getGrainRenderContext(canvasWidth: number, canvasHeight: number): GrainRenderContext {
    return {
      generator: this.grainGenerator,
      strengthOverrides: this.grainStrengthOverrides,
      getOffscreen: (minW: number, minH: number) => {
        const ctx = this.ensureGrainOffscreen(minW, minH);
        if (!ctx || !this.grainOffscreen) return null;
        return { canvas: this.grainOffscreen, ctx };
      },
      canvasWidth,
      canvasHeight,
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
    this.grainGenerator?.destroy();
    this.grainGenerator = null;
    this.grainOffscreen = null;
    this.grainOffscreenCtx = null;
  }
}
