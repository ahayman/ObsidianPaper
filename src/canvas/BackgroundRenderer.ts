import type { Page } from "../types";
import type { Camera } from "./Camera";
import type { PageRect } from "../document/PageLayout";
import { resolvePageBackground } from "../color/ColorUtils";

export interface BackgroundConfig {
  isDarkMode: boolean;
}

// Desk color (outside pages)
export const DESK_COLORS = {
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

// ─── Standalone helpers for tile-based background rendering ──────────

/**
 * Fill a region with the desk color.
 * The context should already have a world→pixel transform applied.
 */
export function renderDeskFill(
  ctx: OffscreenCanvasRenderingContext2D,
  worldBounds: [number, number, number, number],
  isDarkMode: boolean,
): void {
  ctx.fillStyle = isDarkMode ? DESK_COLORS.dark : DESK_COLORS.light;
  ctx.fillRect(
    worldBounds[0], worldBounds[1],
    worldBounds[2] - worldBounds[0], worldBounds[3] - worldBounds[1],
  );
}

/**
 * Render a page's shadow, fill, and pattern within a tile's world bounds.
 * The context should already have a world→pixel transform applied.
 *
 * @param lineScale - reciprocal of the effective zoom for 1-pixel-wide lines,
 *                    i.e. `tileWorldSize / tilePhysical`
 */
export function renderPageBackground(
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

  /**
   * Render pages and return the context (still in camera space) and visible rect
   * so callers can draw additional overlays before the camera transform is reset.
   */
  render(
    config: BackgroundConfig,
    pageLayout: PageRect[],
    pages: Page[],
    afterPages?: (ctx: CanvasRenderingContext2D, visibleRect: [number, number, number, number]) => void,
    overscanOffsetX = 0,
    overscanOffsetY = 0,
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);

    // 1. Fill entire canvas with desk color
    ctx.fillStyle = config.isDarkMode ? DESK_COLORS.dark : DESK_COLORS.light;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    // 2. Apply camera transform with overscan offset compensation
    ctx.save();
    ctx.transform(
      this.camera.zoom, 0, 0, this.camera.zoom,
      -this.camera.x * this.camera.zoom - overscanOffsetX,
      -this.camera.y * this.camera.zoom - overscanOffsetY,
    );

    // Get visible world rect for culling (overscan area)
    const visibleRect = this.camera.getOverscanVisibleRect(
      this.cssWidth, this.cssHeight, overscanOffsetX, overscanOffsetY,
    );
    const [visMinX, visMinY, visMaxX, visMaxY] = visibleRect;

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

      // Resolve per-page background color and pattern theme
      const { paperColor, patternTheme } = resolvePageBackground(
        page.backgroundColor,
        page.backgroundColorTheme,
        config.isDarkMode,
      );

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

        this.renderPatternForPage(ctx, patternTheme, page, pageRect);

        ctx.restore();
      }
    }

    // 4. Render any additional overlays (e.g. page menu icons) in camera space
    if (afterPages) {
      afterPages(ctx, visibleRect);
    }

    // 5. Reset camera transform
    this.camera.resetContext(ctx);
  }

  private renderPatternForPage(
    ctx: CanvasRenderingContext2D,
    patternTheme: "light" | "dark",
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
        this.renderLines(ctx, patternTheme, page.lineSpacing, minX, minY, maxX, maxY);
        break;
      case "grid":
        this.renderGrid(ctx, patternTheme, page.gridSize, minX, minY, maxX, maxY);
        break;
      case "dot-grid":
        this.renderDotGrid(ctx, patternTheme, page.gridSize, minX, minY, maxX, maxY);
        break;
    }
  }

  private renderLines(
    ctx: CanvasRenderingContext2D,
    patternTheme: "light" | "dark",
    lineSpacing: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    ctx.strokeStyle = LINE_COLORS[patternTheme];
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
    patternTheme: "light" | "dark",
    gridSize: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    ctx.strokeStyle = LINE_COLORS[patternTheme];
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
    patternTheme: "light" | "dark",
    gridSize: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    ctx.fillStyle = DOT_COLORS[patternTheme];
    const dotRadius = 1.5 / this.camera.zoom;

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
