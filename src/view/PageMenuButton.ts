import type { Camera } from "../canvas/Camera";
import type { PageRect } from "../document/PageLayout";
import type { Page } from "../types";
import { resolvePageBackground } from "../color/ColorUtils";

export interface PageMenuButtonCallbacks {
  onPageMenuTap: (pageIndex: number, anchorEl: HTMLElement) => void;
}

// Button appearance constants
const ICON_RADIUS_WORLD = 16;   // Radius in world units
const ICON_OFFSET_WORLD = 24;   // Offset from page edge in world units
const MIN_SCREEN_SIZE = 24;     // Minimum screen-space diameter (px)
const MAX_SCREEN_SIZE = 44;     // Maximum screen-space diameter (px)
const DOT_COUNT = 3;
const DOT_SPACING_FACTOR = 0.35; // Fraction of radius between dot centers

/**
 * Manages per-page menu buttons rendered on the background canvas,
 * with invisible DOM hit areas for tap detection.
 */
export class PageMenuButton {
  private container: HTMLElement;
  private camera: Camera;
  private callbacks: PageMenuButtonCallbacks;
  private hitAreas: Map<number, HTMLElement> = new Map(); // pageIndex → DOM element
  private drawingActive = false;

  constructor(
    container: HTMLElement,
    camera: Camera,
    callbacks: PageMenuButtonCallbacks,
  ) {
    this.container = container;
    this.camera = camera;
    this.callbacks = callbacks;
  }

  /**
   * Render the menu button icons on the given canvas context.
   * Called after the background renderer draws each visible page.
   * The context should already have the camera transform applied.
   */
  renderIcons(
    ctx: CanvasRenderingContext2D,
    pageLayout: PageRect[],
    pages: Page[],
    visibleRect: [number, number, number, number],
    isDarkMode: boolean,
  ): void {
    const [visMinX, visMinY, visMaxX, visMaxY] = visibleRect;

    for (const pageRect of pageLayout) {
      // Cull pages not visible
      if (
        pageRect.x + pageRect.width < visMinX ||
        pageRect.x > visMaxX ||
        pageRect.y + pageRect.height < visMinY ||
        pageRect.y > visMaxY
      ) {
        continue;
      }

      // Use per-page background theme for icon contrast
      const page = pages[pageRect.pageIndex];
      let iconDark = isDarkMode;
      if (page) {
        const { patternTheme } = resolvePageBackground(
          page.backgroundColor,
          page.backgroundColorTheme,
          isDarkMode,
        );
        iconDark = patternTheme === "dark";
      }

      this.renderIcon(ctx, pageRect, iconDark);
    }
  }

  /**
   * Update DOM hit areas to match current page positions on screen.
   * Call after every render (pan/zoom/layout change).
   */
  updateHitAreas(pageLayout: PageRect[]): void {
    const usedIndices = new Set<number>();

    for (const pageRect of pageLayout) {
      usedIndices.add(pageRect.pageIndex);

      const { screenX, screenY, screenRadius } = this.getScreenPosition(pageRect);

      // Skip if off-screen
      const containerRect = this.container.getBoundingClientRect();
      if (
        screenX + screenRadius < 0 ||
        screenX - screenRadius > containerRect.width ||
        screenY + screenRadius < 0 ||
        screenY - screenRadius > containerRect.height
      ) {
        // Remove hit area if it exists but page is off-screen
        const existing = this.hitAreas.get(pageRect.pageIndex);
        if (existing) {
          existing.remove();
          this.hitAreas.delete(pageRect.pageIndex);
        }
        continue;
      }

      let el = this.hitAreas.get(pageRect.pageIndex);
      if (!el) {
        el = this.container.createEl("div", {
          cls: "paper-page-menu-hit",
          attr: { "data-page-index": String(pageRect.pageIndex) },
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = parseInt(el!.getAttribute("data-page-index") ?? "0", 10);
          this.callbacks.onPageMenuTap(idx, el!);
        });
        this.hitAreas.set(pageRect.pageIndex, el);
      }

      // Minimum touch target
      const hitSize = Math.max(screenRadius * 2, 44);
      el.style.width = `${hitSize}px`;
      el.style.height = `${hitSize}px`;
      el.style.left = `${screenX - hitSize / 2}px`;
      el.style.top = `${screenY - hitSize / 2}px`;
    }

    // Remove hit areas for pages that no longer exist
    for (const [idx, el] of this.hitAreas) {
      if (!usedIndices.has(idx)) {
        el.remove();
        this.hitAreas.delete(idx);
      }
    }
  }

  /**
   * Disable hit areas during active drawing.
   */
  setDrawingActive(active: boolean): void {
    this.drawingActive = active;
    for (const [, el] of this.hitAreas) {
      el.style.pointerEvents = active ? "none" : "auto";
    }
  }

  destroy(): void {
    for (const [, el] of this.hitAreas) {
      el.remove();
    }
    this.hitAreas.clear();
  }

  // ─── Private ───────────────────────────────────────────────

  private renderIcon(
    ctx: CanvasRenderingContext2D,
    pageRect: PageRect,
    isDarkMode: boolean,
  ): void {
    // Icon center in world coordinates (top-right of page, inset)
    const cx = pageRect.x + pageRect.width - ICON_OFFSET_WORLD;
    const cy = pageRect.y + ICON_OFFSET_WORLD;

    // Compute clamped radius: world radius scaled by zoom, clamped to screen limits
    const screenDiameter = ICON_RADIUS_WORLD * 2 * this.camera.zoom;
    const clampedDiameter = Math.min(MAX_SCREEN_SIZE, Math.max(MIN_SCREEN_SIZE, screenDiameter));
    const worldRadius = clampedDiameter / (2 * this.camera.zoom);

    // Circle fill
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, worldRadius, 0, Math.PI * 2);
    ctx.fillStyle = isDarkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
    ctx.fill();

    // Three dots (ellipsis)
    const dotRadius = worldRadius * 0.12;
    const dotSpacing = worldRadius * DOT_SPACING_FACTOR;
    ctx.fillStyle = isDarkMode ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.45)";

    for (let i = 0; i < DOT_COUNT; i++) {
      const dx = (i - 1) * dotSpacing;
      ctx.beginPath();
      ctx.arc(cx + dx, cy, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private getScreenPosition(pageRect: PageRect): {
    screenX: number;
    screenY: number;
    screenRadius: number;
  } {
    const cx = pageRect.x + pageRect.width - ICON_OFFSET_WORLD;
    const cy = pageRect.y + ICON_OFFSET_WORLD;
    const screen = this.camera.worldToScreen(cx, cy);

    const screenDiameter = ICON_RADIUS_WORLD * 2 * this.camera.zoom;
    const clampedDiameter = Math.min(MAX_SCREEN_SIZE, Math.max(MIN_SCREEN_SIZE, screenDiameter));

    return {
      screenX: screen.x,
      screenY: screen.y,
      screenRadius: clampedDiameter / 2,
    };
  }
}
