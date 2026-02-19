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

  constructor(
    parent: HTMLElement,
    presets: readonly PenPreset[],
    activeId: string | null,
    isDarkMode: boolean,
    onClick: (presetId: string) => void,
    onLongPress: (presetId: string) => void
  ) {
    this.isDark = isDarkMode;
    this.onClick = onClick;
    this.onLongPress = onLongPress;

    this.el = parent.createEl("div", { cls: "paper-toolbar__presets" });
    this.buildButtons(presets, activeId);
  }

  private buildButtons(presets: readonly PenPreset[], activeId: string | null): void {
    for (const [, btn] of this.buttons) btn.destroy();
    this.buttons.clear();

    for (const preset of presets) {
      const btn = new PresetButton(
        this.el,
        preset,
        this.isDark,
        this.onClick,
        this.onLongPress
      );
      if (preset.id === activeId) btn.setActive(true);
      this.buttons.set(preset.id, btn);
    }
  }

  setActivePreset(id: string | null): void {
    for (const [pid, btn] of this.buttons) {
      btn.setActive(pid === id);
    }
  }

  updatePresets(presets: readonly PenPreset[], activeId: string | null): void {
    // Rebuild all buttons
    this.el.empty();
    this.buildButtons(presets, activeId);
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
