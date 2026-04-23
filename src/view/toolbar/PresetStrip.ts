import type { PenPreset } from "./ToolbarTypes";
import { PresetButton } from "./PresetButton";

/**
 * Scrollable container of preset buttons.
 */
export class PresetStrip {
  private el: HTMLElement;
  private buttons: Map<string, PresetButton> = new Map();
  private isDark: boolean;
  private onClick: (presetId: string) => void;
  private onLongPress: (presetId: string) => void;
  private onContextMenu: (presetId: string) => void;

  constructor(
    parent: HTMLElement,
    presets: readonly PenPreset[],
    activeId: string | null,
    isDarkMode: boolean,
    onClick: (presetId: string) => void,
    onLongPress: (presetId: string) => void,
    onContextMenu: (presetId: string) => void
  ) {
    this.isDark = isDarkMode;
    this.onClick = onClick;
    this.onLongPress = onLongPress;
    this.onContextMenu = onContextMenu;

    this.el = parent.createEl("div", { cls: "paper-toolbar__presets" });
    this.buildButtons(presets);
  }

  private buildButtons(presets: readonly PenPreset[]): void {
    for (const [, btn] of this.buttons) btn.destroy();
    this.buttons.clear();

    for (const preset of presets) {
      const btn = new PresetButton(
        this.el,
        preset,
        this.isDark,
        this.onClick,
        this.onLongPress,
        this.onContextMenu
      );
      this.buttons.set(preset.id, btn);
    }
  }

  updatePresets(presets: readonly PenPreset[]): void {
    this.el.empty();
    this.buildButtons(presets);
  }

  updateSinglePreset(preset: PenPreset): void {
    const btn = this.buttons.get(preset.id);
    if (btn) btn.update(preset);
  }

  getButtonElement(presetId: string): HTMLElement | null {
    return this.buttons.get(presetId)?.el ?? null;
  }

  setDarkMode(isDark: boolean): void {
    this.isDark = isDark;
    for (const [, btn] of this.buttons) {
      btn.setDarkMode(isDark);
    }
  }

  destroy(): void {
    for (const [, btn] of this.buttons) btn.destroy();
    this.buttons.clear();
    this.el.remove();
  }
}
