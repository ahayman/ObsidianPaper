import { resolveColor } from "../color/ColorPalette";

export interface HoverCursorConfig {
  colorId: string;
  width: number;
  isDarkMode: boolean;
  isEraser: boolean;
  zoom: number;
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
    const size = config.isEraser
      ? 20 // Fixed eraser cursor size (screen px)
      : Math.max(2, config.width * config.zoom);

    if (config.isEraser) {
      this.el.addClass("paper-hover-cursor--eraser");
      this.el.removeClass("paper-hover-cursor--pen");
      this.el.setCssProps({
        "--cursor-color": "transparent",
        "--cursor-border": config.isDarkMode ? "#aaa" : "#666",
      });
    } else {
      const color = resolveColor(config.colorId, config.isDarkMode);
      this.el.addClass("paper-hover-cursor--pen");
      this.el.removeClass("paper-hover-cursor--eraser");
      this.el.setCssProps({
        "--cursor-color": color,
        "--cursor-border": color,
      });
    }

    this.el.setCssProps({
      "--cursor-size": `${size}px`,
      "--cursor-x": `${x - size / 2}px`,
      "--cursor-y": `${y - size / 2}px`,
    });

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
