import { setIcon } from "obsidian";
import { parseColorId } from "../../color/ColorUtils";
import type { ToolbarPosition } from "./ToolbarTypes";

const LONG_PRESS_MS = 500;

export interface RecentColorStripCallbacks {
  onColorSelect: (colorId: string) => void;
  onColorRemove: (colorId: string) => void;
  onOpenColorPicker: (anchor: HTMLElement) => void;
}

/**
 * Single-row strip displaying recently-used colors.
 * Sits adjacent to the main toolbar, anchored to the current pen button.
 * Collapse state is controlled externally by the Toolbar via setCollapsed().
 */
export class RecentColorStrip {
  readonly el: HTMLElement;
  private swatchContainer: HTMLElement;
  private wheelBtn: HTMLButtonElement;

  private callbacks: RecentColorStripCallbacks;
  private activeColorId: string;
  private colorIds: string[] = [];

  // Long-press tracking per swatch
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private didLongPress = false;

  constructor(
    container: HTMLElement,
    recentColors: string[],
    activeColorId: string,
    collapsed: boolean,
    position: ToolbarPosition,
    callbacks: RecentColorStripCallbacks
  ) {
    this.callbacks = callbacks;
    this.activeColorId = activeColorId;

    this.el = container.createEl("div", {
      cls: "paper-recent-colors",
      attr: { "data-position": position },
    });

    // Swatch container
    this.swatchContainer = this.el.createEl("div", { cls: "paper-recent-colors__swatches" });

    // Color wheel button
    this.wheelBtn = this.el.createEl("button", {
      cls: "paper-recent-colors__wheel",
      attr: { "aria-label": "Pick a color" },
    });
    setIcon(this.wheelBtn, "palette");
    this.wheelBtn.addEventListener("click", () => {
      this.callbacks.onOpenColorPicker(this.wheelBtn);
    });

    this.buildSwatches(recentColors);

    // Apply initial collapsed state
    this.el.toggleClass("is-collapsed", collapsed);
  }

  // ─── Swatch Building ──────────────────────────────────────

  private buildSwatches(colors: string[]): void {
    this.swatchContainer.empty();
    this.colorIds = [...colors];

    for (const colorId of colors) {
      this.createSwatchEl(colorId);
    }
  }

  private createSwatchEl(colorId: string): HTMLButtonElement {
    const { light, dark } = parseColorId(colorId);
    const swatch = this.swatchContainer.createEl("button", {
      cls: "paper-recent-colors__swatch",
      attr: { "aria-label": `Recent color` },
    });

    // Diagonal split color layer
    const colorLayer = swatch.createEl("span", { cls: "paper-recent-colors__swatch-color" });
    colorLayer.setCssProps({
      "--swatch-color-dark": dark,
      "--swatch-color-light": light,
    });

    if (colorId === this.activeColorId) {
      swatch.addClass("is-active");
    }

    // Long-press to remove, tap to select
    const startLongPress = (e: Event) => {
      e.preventDefault();
      this.didLongPress = false;
      this.longPressTimer = setTimeout(() => {
        this.didLongPress = true;
        this.callbacks.onColorRemove(colorId);
      }, LONG_PRESS_MS);
    };

    const cancelLongPress = () => {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    };

    const endLongPress = () => {
      cancelLongPress();
      if (!this.didLongPress) {
        this.callbacks.onColorSelect(colorId);
      }
      this.didLongPress = false;
    };

    swatch.addEventListener("pointerdown", startLongPress);
    swatch.addEventListener("pointerup", endLongPress);
    swatch.addEventListener("pointercancel", cancelLongPress);
    swatch.addEventListener("pointerleave", cancelLongPress);

    // Right-click also removes
    swatch.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      cancelLongPress();
      this.callbacks.onColorRemove(colorId);
    });

    return swatch;
  }

  // ─── Public API ───────────────────────────────────────────

  updateColors(colors: string[], activeColorId: string): void {
    this.activeColorId = activeColorId;
    this.buildSwatches(colors);

    // Hide the whole strip when there are no recent colors
    this.el.toggleClass("is-empty", colors.length === 0);
  }

  setActiveColor(colorId: string): void {
    this.activeColorId = colorId;
    const swatches = this.swatchContainer.querySelectorAll(".paper-recent-colors__swatch");
    swatches.forEach((el, i) => {
      (el as HTMLElement).toggleClass("is-active", this.colorIds[i] === colorId);
    });
  }

  setPosition(position: ToolbarPosition): void {
    this.el.dataset.position = position;
  }

  setMinimized(minimized: boolean): void {
    this.el.toggleClass("is-minimized", minimized);
  }

  setCollapsed(collapsed: boolean): void {
    this.el.toggleClass("is-collapsed", collapsed);
  }

  getWheelButton(): HTMLElement {
    return this.wheelBtn;
  }

  destroy(): void {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.el.remove();
  }
}
