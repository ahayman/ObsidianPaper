import type { PaperType } from "../types";
import type { Camera } from "./Camera";

export interface BackgroundConfig {
  paperType: PaperType;
  isDarkMode: boolean;
  lineSpacing: number;
  gridSize: number;
}

// Light/dark background fill colors
const BG_COLORS = {
  light: "#fffff8",
  dark: "#1e1e1e",
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

/**
 * Renders paper background patterns (blank, lined, grid, dot-grid)
 * on a dedicated canvas layer beneath the static stroke layer.
 * Background follows camera transform so lines zoom/pan with content.
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

  render(config: BackgroundConfig): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);

    // Fill background
    ctx.fillStyle = config.isDarkMode ? BG_COLORS.dark : BG_COLORS.light;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    if (config.paperType === "blank") return;

    // Apply camera transform for pattern rendering
    this.camera.applyToContext(ctx);

    // Determine visible world rect to only draw visible lines
    const visibleRect = this.camera.getVisibleRect(this.cssWidth, this.cssHeight);
    const [minX, minY, maxX, maxY] = visibleRect;

    switch (config.paperType) {
      case "lined":
        this.renderLines(ctx, config, minX, minY, maxX, maxY);
        break;
      case "grid":
        this.renderGrid(ctx, config, minX, minY, maxX, maxY);
        break;
      case "dot-grid":
        this.renderDotGrid(ctx, config, minX, minY, maxX, maxY);
        break;
    }

    this.camera.resetContext(ctx);
  }

  private renderLines(
    ctx: CanvasRenderingContext2D,
    config: BackgroundConfig,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const spacing = config.lineSpacing;
    const color = config.isDarkMode ? LINE_COLORS.dark : LINE_COLORS.light;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / this.camera.zoom; // Constant screen-space thickness

    const startY = Math.floor(minY / spacing) * spacing;
    const endY = Math.ceil(maxY / spacing) * spacing;

    ctx.beginPath();
    for (let y = startY; y <= endY; y += spacing) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
  }

  private renderGrid(
    ctx: CanvasRenderingContext2D,
    config: BackgroundConfig,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const size = config.gridSize;
    const color = config.isDarkMode ? LINE_COLORS.dark : LINE_COLORS.light;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / this.camera.zoom;

    const startX = Math.floor(minX / size) * size;
    const endX = Math.ceil(maxX / size) * size;
    const startY = Math.floor(minY / size) * size;
    const endY = Math.ceil(maxY / size) * size;

    ctx.beginPath();
    // Vertical lines
    for (let x = startX; x <= endX; x += size) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    // Horizontal lines
    for (let y = startY; y <= endY; y += size) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
  }

  private renderDotGrid(
    ctx: CanvasRenderingContext2D,
    config: BackgroundConfig,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const size = config.gridSize;
    const color = config.isDarkMode ? DOT_COLORS.dark : DOT_COLORS.light;
    const dotRadius = 1.5 / this.camera.zoom; // Constant screen-space size

    ctx.fillStyle = color;

    const startX = Math.floor(minX / size) * size;
    const endX = Math.ceil(maxX / size) * size;
    const startY = Math.floor(minY / size) * size;
    const endY = Math.ceil(maxY / size) * size;

    for (let x = startX; x <= endX; x += size) {
      for (let y = startY; y <= endY; y += size) {
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
