import type { PenPreset } from "./ToolbarTypes";
import { parseColorId } from "../../color/ColorUtils";
import { createPresetNibIcon } from "./PenIcons";

const LONG_PRESS_MS = 500;

/**
 * Circular button representing a pen preset.
 * Shows a nib shape visualization (size, shape, angle) with an optional
 * linked-color ring around the border.
 */
export class PresetButton {
  readonly el: HTMLButtonElement;
  private preset: PenPreset;
  private isDark: boolean;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private didLongPress = false;

  constructor(
    parent: HTMLElement,
    preset: PenPreset,
    isDarkMode: boolean,
    onClick: (presetId: string) => void,
    onLongPress: (presetId: string) => void,
    onContextMenu: (presetId: string) => void
  ) {
    this.preset = preset;
    this.isDark = isDarkMode;

    this.el = parent.createEl("button", {
      cls: "paper-toolbar__preset-btn",
      attr: {
        "aria-label": preset.name,
        "data-preset-id": preset.id,
      },
    });

    this.renderSwatch();

    // Long-press detection
    const startLongPress = (e: Event) => {
      e.preventDefault();
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
      }
      this.didLongPress = false;
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.didLongPress = true;
        onLongPress(preset.id);
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
        onClick(preset.id);
      }
      this.didLongPress = false;
    };

    this.el.addEventListener("pointerdown", startLongPress);
    this.el.addEventListener("pointerup", endLongPress);
    this.el.addEventListener("pointercancel", cancelLongPress);
    this.el.addEventListener("pointerleave", cancelLongPress);

    // Right-click opens settings without selecting the preset
    this.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      cancelLongPress();
      onContextMenu(preset.id);
    });
  }

  private renderSwatch(): void {
    this.el.empty();

    const svg = createPresetNibIcon(this.preset);

    // Add diagonal two-tone color ring if preset has a linked color
    if (this.preset.linkedColorId) {
      const { light, dark } = parseColorId(this.preset.linkedColorId);
      this.addColorRing(svg, dark, light);
      this.el.addClass("has-linked-color");
    } else {
      this.el.removeClass("has-linked-color");
    }

    const iconLayer = this.el.createEl("span", { cls: "paper-toolbar__preset-icon" });
    iconLayer.appendChild(svg);
  }

  private addColorRing(svg: SVGSVGElement, dark: string, light: string): void {
    const NS = "http://www.w3.org/2000/svg";
    const gradId = `ring-${this.preset.id}`;

    // Define a 135° diagonal gradient matching the swatch style
    const defs = document.createElementNS(NS, "defs");
    const grad = document.createElementNS(NS, "linearGradient");
    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "1");
    grad.setAttribute("y2", "1");

    const stop1 = document.createElementNS(NS, "stop");
    stop1.setAttribute("offset", "50%");
    stop1.setAttribute("stop-color", dark);
    const stop2 = document.createElementNS(NS, "stop");
    stop2.setAttribute("offset", "50%");
    stop2.setAttribute("stop-color", light);
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.insertBefore(defs, svg.firstChild);

    // Ring circle at the edge of the background
    const ring = document.createElementNS(NS, "circle");
    ring.setAttribute("cx", "12");
    ring.setAttribute("cy", "12");
    ring.setAttribute("r", "12");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", `url(#${gradId})`);
    ring.setAttribute("stroke-width", "2.5");
    svg.appendChild(ring);
  }

  setDarkMode(isDark: boolean): void {
    this.isDark = isDark;
    this.renderSwatch();
  }

  update(preset: PenPreset): void {
    this.preset = preset;
    this.el.setAttribute("aria-label", preset.name);
    this.renderSwatch();
  }

  destroy(): void {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.el.remove();
  }
}
