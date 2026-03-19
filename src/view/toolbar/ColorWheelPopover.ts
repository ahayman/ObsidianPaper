import type { ToolbarPosition } from "./ToolbarTypes";
import { ColorPickerPanel } from "./ColorPickerPanel";

export interface ColorWheelPopoverCallbacks {
  onColorChange: (colorId: string) => void;
  onDismiss: () => void;
}

/**
 * Minimal popover wrapping a ColorPickerPanel.
 * Used by the recent color strip's color wheel button.
 */
export class ColorWheelPopover {
  private backdrop: HTMLElement;
  private el: HTMLElement;
  private colorPicker: ColorPickerPanel;
  private callbacks: ColorWheelPopoverCallbacks;

  constructor(
    currentColorId: string,
    position: ToolbarPosition,
    anchor: HTMLElement,
    callbacks: ColorWheelPopoverCallbacks
  ) {
    this.callbacks = callbacks;

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
        callbacks.onColorChange(colorId);
      },
    });

    this.positionRelativeTo(anchor, position);

    // Escape key
    document.addEventListener("keydown", this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.callbacks.onDismiss();
    }
  };

  private positionRelativeTo(anchor: HTMLElement, position: ToolbarPosition): void {
    const anchorRect = anchor.getBoundingClientRect();

    switch (position) {
      case "top":
        this.el.setCssProps({
          "--popover-top": `${anchorRect.bottom + 8}px`,
          "--popover-left": `${anchorRect.left + anchorRect.width / 2}px`,
        });
        this.el.dataset.anchor = "top";
        break;
      case "bottom":
        this.el.setCssProps({
          "--popover-bottom": `${window.innerHeight - anchorRect.top + 8}px`,
          "--popover-left": `${anchorRect.left + anchorRect.width / 2}px`,
        });
        this.el.dataset.anchor = "bottom";
        break;
      case "left":
        this.el.setCssProps({
          "--popover-left": `${anchorRect.right + 8}px`,
          "--popover-top": `${anchorRect.top + anchorRect.height / 2}px`,
        });
        this.el.dataset.anchor = "left";
        break;
      case "right":
        this.el.setCssProps({
          "--popover-right": `${window.innerWidth - anchorRect.left + 8}px`,
          "--popover-top": `${anchorRect.top + anchorRect.height / 2}px`,
        });
        this.el.dataset.anchor = "right";
        break;
    }
  }

  setSelectedColor(colorId: string): void {
    this.colorPicker.setSelectedColor(colorId);
  }

  destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    this.colorPicker.destroy();
    this.el.remove();
    this.backdrop.remove();
  }
}
