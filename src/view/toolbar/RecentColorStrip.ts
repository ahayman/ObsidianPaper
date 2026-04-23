import { setIcon } from "obsidian";
import { parseColorId } from "../../color/ColorUtils";
import type { ToolbarPosition } from "./ToolbarTypes";

const LONG_PRESS_MS = 500;

export interface RecentColorStripCallbacks {
  onColorSelect: (colorId: string) => void;
  onPinColor: (colorId: string) => void;
  onUnpinColor: (colorId: string) => void;
  onColorRemove: (colorId: string) => void;
  onOpenColorPicker: (anchor: HTMLElement) => void;
}

/**
 * Single-row strip displaying saved (pinned) + recent colors.
 * Saved colors appear first, separated by a divider from history colors.
 */
export class RecentColorStrip {
  readonly el: HTMLElement;
  private swatchContainer: HTMLElement;
  private wheelBtn: HTMLButtonElement;

  private callbacks: RecentColorStripCallbacks;
  private savedIds: string[] = [];
  private recentIds: string[] = [];

  // Long-press tracking
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private didLongPress = false;

  constructor(
    container: HTMLElement,
    savedColors: string[],
    recentColors: string[],
    collapsed: boolean,
    position: ToolbarPosition,
    callbacks: RecentColorStripCallbacks
  ) {
    this.callbacks = callbacks;

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

    this.buildSwatches(savedColors, recentColors);
    this.el.toggleClass("is-collapsed", collapsed);
  }

  // ─── Swatch Building ──────────────────────────────────────

  private buildSwatches(saved: string[], recent: string[]): void {
    this.swatchContainer.empty();
    this.savedIds = [...saved];
    this.recentIds = [...recent];

    // Saved colors
    for (const colorId of saved) {
      this.createSwatchEl(colorId, true);
    }

    // Divider (only if both sections have colors)
    if (saved.length > 0 && recent.length > 0) {
      this.swatchContainer.createEl("div", { cls: "paper-recent-colors__divider" });
    }

    // History colors
    for (const colorId of recent) {
      this.createSwatchEl(colorId, false);
    }
  }

  private createSwatchEl(colorId: string, isSaved: boolean): HTMLButtonElement {
    const { light, dark } = parseColorId(colorId);
    const swatch = this.swatchContainer.createEl("button", {
      cls: "paper-recent-colors__swatch",
      attr: { "aria-label": isSaved ? "Saved color" : "Recent color" },
    });

    if (isSaved) swatch.addClass("is-saved");

    // Diagonal split color layer
    const colorLayer = swatch.createEl("span", { cls: "paper-recent-colors__swatch-color" });
    colorLayer.setCssProps({
      "--swatch-color-dark": dark,
      "--swatch-color-light": light,
    });

    // Pin indicator for saved colors
    if (isSaved) {
      const pin = swatch.createEl("span", { cls: "paper-recent-colors__pin" });
      setIcon(pin, "pin");
    }

    // Long-press for context action, tap to select
    const startLongPress = (e: Event) => {
      e.preventDefault();
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
      }
      this.didLongPress = false;
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.didLongPress = true;
        this.handleLongPress(colorId, isSaved);
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

    // Right-click also triggers context action
    swatch.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!swatch.isConnected) return;
      cancelLongPress();
      this.handleLongPress(colorId, isSaved);
    });

    return swatch;
  }

  private handleLongPress(colorId: string, isSaved: boolean): void {
    if (isSaved) {
      // Unpin saved color → moves to history
      this.callbacks.onUnpinColor(colorId);
    } else {
      // Pin history color → saves it
      this.callbacks.onPinColor(colorId);
    }
  }

  // ─── Public API ───────────────────────────────────────────

  updateColors(saved: string[], recent: string[]): void {
    this.buildSwatches(saved, recent);
    this.el.toggleClass("is-empty", saved.length === 0 && recent.length === 0);
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
