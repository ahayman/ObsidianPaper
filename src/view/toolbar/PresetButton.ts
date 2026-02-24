import type { PenPreset } from "./ToolbarTypes";
import { parseColorId } from "../../color/ColorUtils";
import { getPenConfig } from "../../stroke/PenConfigs";
import { createPenIconElement } from "./PenIcons";

const LONG_PRESS_MS = 500;

/**
 * Circular color swatch button representing a pen preset.
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
      this.didLongPress = false;
      this.longPressTimer = setTimeout(() => {
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
    const { light, dark } = parseColorId(this.preset.colorId);

    // Highlighter presets render with reduced opacity
    const config = getPenConfig(this.preset.penType);
    this.el.toggleClass("is-highlighter", config.highlighterMode);

    // Build layers: color background + SVG icon on top
    this.el.empty();

    // Color layer — diagonal split showing dark (top-left) and light (bottom-right)
    const colorLayer = this.el.createEl("span", { cls: "paper-toolbar__preset-color" });
    colorLayer.setCssProps({
      "--preset-color-dark": dark,
      "--preset-color-light": light,
    });

    // SVG icon layer
    const iconLayer = this.el.createEl("span", { cls: "paper-toolbar__preset-icon" });
    iconLayer.appendChild(createPenIconElement(this.preset.penType));
  }

  setActive(active: boolean): void {
    this.el.toggleClass("is-active", active);
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
