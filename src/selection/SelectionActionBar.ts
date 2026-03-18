/**
 * Floating action bar shown when strokes are selected.
 * Provides buttons for: Color, Pen Type, Thickness, Delete.
 * Sub-panels appear inline when a button is tapped.
 */

import { setIcon } from "obsidian";
import type { PenType } from "../types";
import { EXTENDED_PALETTE_CONTRAST } from "../color/ExtendedPalette";
import { resolveColor } from "../color/ColorPalette";

const PEN_TYPES: { type: PenType; label: string; icon: string }[] = [
  { type: "ballpoint", label: "Ballpoint", icon: "pen-line" },
  { type: "felt-tip", label: "Felt tip", icon: "pen" },
  { type: "pencil", label: "Pencil", icon: "pencil" },
  { type: "fountain", label: "Fountain", icon: "feather" },
  { type: "highlighter", label: "Highlighter", icon: "highlighter" },
];

const WIDTH_PRESETS = [1, 2, 3, 5, 8, 12];

export interface SelectionActionCallbacks {
  onColorChange: (colorId: string) => void;
  onPenTypeChange: (penType: PenType) => void;
  onWidthChange: (width: number) => void;
  onDelete: () => void;
}

export class SelectionActionBar {
  private el: HTMLElement;
  private subPanel: HTMLElement | null = null;
  private callbacks: SelectionActionCallbacks;
  private isDark: boolean;

  constructor(
    container: HTMLElement,
    callbacks: SelectionActionCallbacks,
    isDark: boolean
  ) {
    this.callbacks = callbacks;
    this.isDark = isDark;

    this.el = container.createEl("div", { cls: "paper-selection-bar" });
    this.build();
  }

  private build(): void {
    this.addButton("palette", "Color", () => this.toggleSubPanel("color"));
    this.addButton("pen-line", "Pen type", () => this.toggleSubPanel("pen"));
    this.addButton("move-horizontal", "Thickness", () => this.toggleSubPanel("width"));

    this.el.createEl("div", { cls: "paper-selection-bar__separator" });

    this.addButton("trash-2", "Delete", () => {
      this.callbacks.onDelete();
    });
  }

  private addButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = this.el.createEl("button", {
      cls: "paper-selection-bar__btn",
      attr: { "aria-label": label },
    });
    setIcon(btn, icon);
    btn.addEventListener("click", onClick);
    return btn;
  }

  private toggleSubPanel(type: "color" | "pen" | "width"): void {
    if (this.subPanel) {
      const currentType = this.subPanel.dataset.panelType;
      this.closeSubPanel();
      if (currentType === type) return; // Toggle off
    }
    this.openSubPanel(type);
  }

  private openSubPanel(type: "color" | "pen" | "width"): void {
    this.subPanel = this.el.createEl("div", {
      cls: "paper-selection-bar__sub-panel",
      attr: { "data-panel-type": type },
    });

    switch (type) {
      case "color":
        this.buildColorPanel(this.subPanel);
        break;
      case "pen":
        this.buildPenPanel(this.subPanel);
        break;
      case "width":
        this.buildWidthPanel(this.subPanel);
        break;
    }
  }

  private closeSubPanel(): void {
    this.subPanel?.remove();
    this.subPanel = null;
  }

  private buildColorPanel(container: HTMLElement): void {
    const grid = container.createEl("div", { cls: "paper-selection-bar__color-grid" });

    for (const entry of EXTENDED_PALETTE_CONTRAST) {
      const swatch = grid.createEl("button", {
        cls: "paper-selection-bar__color-swatch",
        attr: { "aria-label": entry.id },
      });
      const resolved = resolveColor(entry.id, this.isDark);
      swatch.style.backgroundColor = resolved;
      swatch.addEventListener("click", () => {
        this.callbacks.onColorChange(entry.id);
        this.closeSubPanel();
      });
    }
  }

  private buildPenPanel(container: HTMLElement): void {
    const list = container.createEl("div", { cls: "paper-selection-bar__pen-list" });

    for (const pen of PEN_TYPES) {
      const btn = list.createEl("button", {
        cls: "paper-selection-bar__pen-btn",
        attr: { "aria-label": pen.label },
      });
      setIcon(btn, pen.icon);
      btn.createEl("span", { text: pen.label });
      btn.addEventListener("click", () => {
        this.callbacks.onPenTypeChange(pen.type);
        this.closeSubPanel();
      });
    }
  }

  private buildWidthPanel(container: HTMLElement): void {
    const list = container.createEl("div", { cls: "paper-selection-bar__width-list" });

    for (const w of WIDTH_PRESETS) {
      const btn = list.createEl("button", {
        cls: "paper-selection-bar__width-btn",
        attr: { "aria-label": `${w}pt` },
      });
      // Visual indicator: a line of the given width
      const line = btn.createEl("span", { cls: "paper-selection-bar__width-line" });
      line.style.height = `${Math.max(1, w)}px`;
      btn.createEl("span", { text: `${w}` });
      btn.addEventListener("click", () => {
        this.callbacks.onWidthChange(w);
        this.closeSubPanel();
      });
    }
  }

  setDarkMode(isDark: boolean): void {
    this.isDark = isDark;
  }

  show(): void {
    this.el.style.display = "";
  }

  hide(): void {
    this.closeSubPanel();
    this.el.style.display = "none";
  }

  destroy(): void {
    this.closeSubPanel();
    this.el.remove();
  }
}
