import type { Page } from "../types";
import type { Camera } from "./Camera";
import type { PageRect } from "../document/PageLayout";

export interface BackgroundConfig {
  isDarkMode: boolean;
}

// Light/dark paper fill colors
const PAPER_COLORS = {
  light: "#fffff8",
  dark: "#1e1e1e",
};

// Desk color (outside pages)
const DESK_COLORS = {
  light: "#e8e8e8",
  dark: "#111111",
};

// Line/grid stroke colors (subtle)
const LINE_COLORS = {
  light: "#c8d0d8",
  dark: "#3a3f47",
};

// Dot colors
const DOT_COLORS = {
  light: "#b0b8c0",
  dark: "#4a4f57",
};

// Page shadow settings
const SHADOW_OFFSET_X = 0;
const SHADOW_OFFSET_Y = 2;
const SHADOW_BLUR = 8;
const SHADOW_COLOR = "rgba(0, 0, 0, 0.20)";

/**
 * Renders page-based backgrounds with desk color, page shadows,
 * and paper patterns clipped to page boundaries.
 */
export class BackgroundRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.camera = camera;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context for background canvas");
    this.ctx = ctx;
  }

  setSize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
  }

  render(config: BackgroundConfig, pageLayout: PageRect[], pages: Page[]): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);

    // 1. Fill entire canvas with desk color
    ctx.fillStyle = config.isDarkMode ? DESK_COLORS.dark : DESK_COLORS.light;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    // 2. Apply camera transform
    this.camera.applyToContext(ctx);

    // Get visible world rect for culling
    const visibleRect = this.camera.getVisibleRect(this.cssWidth, this.cssHeight);
    const [visMinX, visMinY, visMaxX, visMaxY] = visibleRect;

    const paperColor = config.isDarkMode ? PAPER_COLORS.dark : PAPER_COLORS.light;

    // 3. For each page, render shadow + background + patterns
    for (const pageRect of pageLayout) {
      // Cull pages that aren't visible
      if (
        pageRect.x + pageRect.width < visMinX ||
        pageRect.x > visMaxX ||
        pageRect.y + pageRect.height < visMinY ||
        pageRect.y > visMaxY
      ) {
        continue;
      }

      const page = pages[pageRect.pageIndex];
      if (!page) continue;

      // a. Draw drop shadow
      ctx.save();
      ctx.shadowOffsetX = SHADOW_OFFSET_X / this.camera.zoom;
      ctx.shadowOffsetY = SHADOW_OFFSET_Y / this.camera.zoom;
      ctx.shadowBlur = SHADOW_BLUR / this.camera.zoom;
      ctx.shadowColor = SHADOW_COLOR;
      ctx.fillStyle = paperColor;
      ctx.fillRect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
      ctx.restore();

      // b. Fill page rect with paper color (without shadow this time for clean base)
      ctx.fillStyle = paperColor;
      ctx.fillRect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);

      // c. Clip and render patterns
      if (page.paperType !== "blank") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
        ctx.clip();

        this.renderPatternForPage(ctx, config, page, pageRect);

        ctx.restore();
      }
    }

    // 4. Reset camera transform
    this.camera.resetContext(ctx);
  }

  private renderPatternForPage(
    ctx: CanvasRenderingContext2D,
    config: BackgroundConfig,
    page: Page,
    rect: PageRect
  ): void {
    // Apply margins to constrain where patterns are drawn
    const margins = page.margins;
    const minX = rect.x + margins.left;
    const minY = rect.y + margins.top;
    const maxX = rect.x + rect.width - margins.right;
    const maxY = rect.y + rect.height - margins.bottom;

    // Don't render if margins consume the entire page
    if (minX >= maxX || minY >= maxY) return;

    switch (page.paperType) {
      case "lined":
        this.renderLines(ctx, config, page.lineSpacing, minX, minY, maxX, maxY);
        break;
      case "grid":
        this.renderGrid(ctx, config, page.gridSize, minX, minY, maxX, maxY);
        break;
      case "dot-grid":
        this.renderDotGrid(ctx, config, page.gridSize, minX, minY, maxX, maxY);
        break;
    }
  }

  private renderLines(
    ctx: CanvasRenderingContext2D,
    config: BackgroundConfig,
    lineSpacing: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const color = config.isDarkMode ? LINE_COLORS.dark : LINE_COLORS.light;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / this.camera.zoom;

    const startY = Math.ceil(minY / lineSpacing) * lineSpacing;

    ctx.beginPath();
    for (let y = startY; y <= maxY; y += lineSpacing) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
  }

  private renderGrid(
    ctx: CanvasRenderingContext2D,
    config: BackgroundConfig,
    gridSize: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const color = config.isDarkMode ? LINE_COLORS.dark : LINE_COLORS.light;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / this.camera.zoom;

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

  private renderDotGrid(
    ctx: CanvasRenderingContext2D,
    config: BackgroundConfig,
    gridSize: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const color = config.isDarkMode ? DOT_COLORS.dark : DOT_COLORS.light;
    const dotRadius = 1.5 / this.camera.zoom;

    ctx.fillStyle = color;

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

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
}
