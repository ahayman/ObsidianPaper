import { resolveColor } from "../color/ColorPalette";

export interface HoverCursorConfig {
  colorId: string;
  width: number;
  isDarkMode: boolean;
  isEraser: boolean;
  zoom: number;
  nibThickness: number | null;  // ratio (minor/major), null = circle cursor
  nibAngle: number | null;      // radians, null = no rotation
}

/**
 * DOM-based hover cursor that shows pen position before touching the surface.
 * Reflects current pen size and color. Shows eraser circle when eraser is active.
 */
export class HoverCursor {
  private el: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement) {
    this.el = container.createEl("div", { cls: "paper-hover-cursor" });
    this.el.addClass("paper-hover-cursor--hidden");
  }

  show(x: number, y: number, config: HoverCursorConfig): void {
    if (config.isEraser) {
      const size = 20; // Fixed eraser cursor size (screen px)
      this.el.addClass("paper-hover-cursor--eraser");
      this.el.removeClass("paper-hover-cursor--pen");
      this.el.removeClass("paper-hover-cursor--nib");
      this.el.setCssProps({
        "--cursor-color": "transparent",
        "--cursor-border": config.isDarkMode ? "#aaa" : "#666",
        "--cursor-size": `${size}px`,
        "--cursor-x": `${x - size / 2}px`,
        "--cursor-y": `${y - size / 2}px`,
      });
    } else if (config.nibThickness !== null && config.nibAngle !== null) {
      // Nib cursor: rotated rectangle
      const nibWidth = Math.max(2, config.width * config.zoom);
      const nibHeight = Math.max(1, nibWidth * config.nibThickness);
      const angleDeg = (config.nibAngle * 180) / Math.PI;
      const color = resolveColor(config.colorId, config.isDarkMode);

      this.el.addClass("paper-hover-cursor--nib");
      this.el.removeClass("paper-hover-cursor--pen");
      this.el.removeClass("paper-hover-cursor--eraser");
      this.el.setCssProps({
        "--cursor-width": `${nibWidth}px`,
        "--cursor-height": `${nibHeight}px`,
        "--cursor-x": `${x - nibWidth / 2}px`,
        "--cursor-y": `${y - nibHeight / 2}px`,
        "--cursor-rotation": `${angleDeg}deg`,
        "--cursor-color": color,
        "--cursor-border": color,
      });
    } else {
      const size = Math.max(2, config.width * config.zoom);
      const color = resolveColor(config.colorId, config.isDarkMode);
      this.el.addClass("paper-hover-cursor--pen");
      this.el.removeClass("paper-hover-cursor--eraser");
      this.el.removeClass("paper-hover-cursor--nib");
      this.el.setCssProps({
        "--cursor-color": color,
        "--cursor-border": color,
        "--cursor-size": `${size}px`,
        "--cursor-x": `${x - size / 2}px`,
        "--cursor-y": `${y - size / 2}px`,
      });
    }

    if (!this.visible) {
      this.el.removeClass("paper-hover-cursor--hidden");
      this.visible = true;
    }
  }

  hide(): void {
    if (this.visible) {
      this.el.addClass("paper-hover-cursor--hidden");
      this.visible = false;
    }
  }

  destroy(): void {
    this.el.remove();
  }
}
