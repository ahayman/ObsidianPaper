import type { PenType } from "../../types";
import { parseColorId } from "../../color/ColorUtils";
import { getPenConfig } from "../../stroke/PenConfigs";
import { createPenIconElement } from "./PenIcons";

/**
 * Circular swatch button showing the current pen state.
 * Always reflects live colorId + penType. Tapping opens the customize popover.
 */
export class CurrentPenButton {
  readonly el: HTMLButtonElement;
  private colorId: string;
  private penType: PenType;

  constructor(
    parent: HTMLElement,
    colorId: string,
    penType: PenType,
    onClick: () => void
  ) {
    this.colorId = colorId;
    this.penType = penType;

    this.el = parent.createEl("button", {
      cls: "paper-toolbar__current-pen",
      attr: { "aria-label": "Current pen" },
    });

    this.renderSwatch();
    this.el.addEventListener("click", onClick);
  }

  private renderSwatch(): void {
    const { light, dark } = parseColorId(this.colorId);
    const config = getPenConfig(this.penType);

    this.el.empty();
    this.el.toggleClass("is-highlighter", config.highlighterMode);

    // Color layer — diagonal split
    const colorLayer = this.el.createEl("span", { cls: "paper-toolbar__preset-color" });
    colorLayer.setCssProps({
      "--preset-color-dark": dark,
      "--preset-color-light": light,
    });

    // SVG icon layer
    const iconLayer = this.el.createEl("span", { cls: "paper-toolbar__preset-icon" });
    iconLayer.appendChild(createPenIconElement(this.penType));
  }

  update(colorId: string, penType: PenType): void {
    if (colorId === this.colorId && penType === this.penType) return;
    this.colorId = colorId;
    this.penType = penType;
    this.renderSwatch();
  }

  destroy(): void {
    this.el.remove();
  }
}
