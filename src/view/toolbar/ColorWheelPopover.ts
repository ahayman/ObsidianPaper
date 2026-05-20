import { setIcon } from "obsidian";
import type { ToolbarPosition } from "./ToolbarTypes";
import { ColorPickerPanel } from "./ColorPickerPanel";
import { positionPopoverNextToToolbar } from "./PopoverPositioning";

export interface ColorWheelPopoverCallbacks {
  onColorChange: (colorId: string) => void;
  onPinColor: (colorId: string) => void;
  onUnpinColor: (colorId: string) => void;
  onDismiss: () => void;
}

/**
 * Minimal popover wrapping a ColorPickerPanel.
 * Used by the recent color strip's color wheel button.
 * Includes a pin toggle to save/unsave the selected color.
 */
export class ColorWheelPopover {
  private backdrop: HTMLElement;
  private el: HTMLElement;
  private colorPicker: ColorPickerPanel;
  private callbacks: ColorWheelPopoverCallbacks;
  private isColorPinned: (colorId: string) => boolean;
  private currentColorId: string;
  private pinBtn: HTMLButtonElement;

  constructor(
    currentColorId: string,
    position: ToolbarPosition,
    anchor: HTMLElement,
    callbacks: ColorWheelPopoverCallbacks,
    isColorPinned: (colorId: string) => boolean
  ) {
    this.callbacks = callbacks;
    this.isColorPinned = isColorPinned;
    this.currentColorId = currentColorId;

    // Backdrop — click outside to dismiss
    this.backdrop = document.body.createEl("div", { cls: "paper-popover__backdrop" });
    this.backdrop.addEventListener("click", () => callbacks.onDismiss());

    // Popover panel
    this.el = document.body.createEl("div", {
      cls: "paper-popover paper-color-wheel-popover",
    });

    const content = this.el.createEl("div", { cls: "paper-popover__content" });

    // Mount color picker
    this.colorPicker = new ColorPickerPanel(content, currentColorId, {
      onColorSelect: (colorId) => {
        this.currentColorId = colorId;
        this.updatePinButton();
        callbacks.onColorChange(colorId);
      },
    });

    // Pin button row
    const pinRow = content.createEl("div", { cls: "paper-popover__pin-row" });
    this.pinBtn = pinRow.createEl("button", {
      cls: "paper-popover__pin-btn",
      attr: { "aria-label": "Pin color to strip" },
    });
    this.updatePinButton();
    this.pinBtn.addEventListener("click", () => {
      if (this.isColorPinned(this.currentColorId)) {
        this.callbacks.onUnpinColor(this.currentColorId);
      } else {
        this.callbacks.onPinColor(this.currentColorId);
      }
      this.updatePinButton();
    });

    positionPopoverNextToToolbar(this.el, anchor, position);

    // Escape key
    document.addEventListener("keydown", this.handleKeyDown);
  }

  private updatePinButton(): void {
    const pinned = this.isColorPinned(this.currentColorId);
    this.pinBtn.empty();
    setIcon(this.pinBtn, pinned ? "pin-off" : "pin");
    this.pinBtn.toggleClass("is-pinned", pinned);
    this.pinBtn.createEl("span", {
      cls: "paper-popover__pin-label",
      text: pinned ? "Unpin from strip" : "Pin to strip",
    });
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.callbacks.onDismiss();
    }
  };

  setSelectedColor(colorId: string): void {
    this.currentColorId = colorId;
    this.colorPicker.setSelectedColor(colorId);
    this.updatePinButton();
  }

  destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    this.colorPicker.destroy();
    this.el.remove();
    this.backdrop.remove();
  }
}
