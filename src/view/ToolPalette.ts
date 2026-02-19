import type { PenType } from "../types";
import { COLOR_PALETTE } from "../color/ColorPalette";

export type ActiveTool = "pen" | "eraser";

export interface ToolPaletteState {
  activeTool: ActiveTool;
  penType: PenType;
  colorId: string;
  width: number;
}

export interface ToolPaletteCallbacks {
  onToolChange: (tool: ActiveTool) => void;
  onPenTypeChange: (penType: PenType) => void;
  onColorChange: (colorId: string) => void;
  onWidthChange: (width: number) => void;
}

const PEN_TYPES: { type: PenType; label: string }[] = [
  { type: "ballpoint", label: "Ballpoint" },
  { type: "brush", label: "Brush" },
  { type: "felt-tip", label: "Felt tip" },
  { type: "pencil", label: "Pencil" },
  { type: "fountain", label: "Fountain" },
  { type: "highlighter", label: "Highlighter" },
];

const MIN_WIDTH = 0.5;
const MAX_WIDTH = 30;

/**
 * Floating tool palette UI (DOM overlay, not canvas).
 * Provides tool selection, pen type, color swatches, and width slider.
 */
export class ToolPalette {
  private container: HTMLElement;
  private el: HTMLElement;
  private callbacks: ToolPaletteCallbacks;
  private state: ToolPaletteState;

  // Element refs for updates
  private penBtn: HTMLElement | null = null;
  private eraserBtn: HTMLElement | null = null;
  private penTypeSelect: HTMLSelectElement | null = null;
  private widthSlider: HTMLInputElement | null = null;
  private widthLabel: HTMLElement | null = null;
  private colorSwatches: HTMLElement | null = null;
  private activeSwatchEl: HTMLElement | null = null;
  private isDarkMode = false;

  constructor(
    container: HTMLElement,
    callbacks: ToolPaletteCallbacks,
    initialState?: Partial<ToolPaletteState>
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.state = {
      activeTool: initialState?.activeTool ?? "pen",
      penType: initialState?.penType ?? "ballpoint",
      colorId: initialState?.colorId ?? "ink-black",
      width: initialState?.width ?? 2,
    };

    this.el = this.container.createEl("div", { cls: "paper-tool-palette" });
    this.build();
  }

  private build(): void {
    // Tool buttons row
    const toolRow = this.el.createEl("div", { cls: "paper-tool-row" });
    this.penBtn = this.createToolButton(toolRow, "Pen", "pen");
    this.eraserBtn = this.createToolButton(toolRow, "Eraser", "eraser");

    // Pen type selector
    const penTypeRow = this.el.createEl("div", { cls: "paper-tool-row" });
    this.penTypeSelect = penTypeRow.createEl("select", {
      cls: "paper-pen-type-select",
    });
    for (const pt of PEN_TYPES) {
      const option = this.penTypeSelect.createEl("option", {
        text: pt.label,
      });
      option.value = pt.type;
      if (pt.type === this.state.penType) {
        option.selected = true;
      }
    }
    this.penTypeSelect.addEventListener("change", () => {
      const penType = this.penTypeSelect!.value as PenType;
      this.state.penType = penType;
      this.callbacks.onPenTypeChange(penType);
    });

    // Color swatches
    this.colorSwatches = this.el.createEl("div", {
      cls: "paper-color-swatches",
    });
    this.buildColorSwatches();

    // Width slider
    const widthRow = this.el.createEl("div", { cls: "paper-tool-row paper-width-row" });
    this.widthLabel = widthRow.createEl("span", {
      cls: "paper-width-label",
      text: `${this.state.width.toFixed(1)}`,
    });
    this.widthSlider = widthRow.createEl("input", {
      cls: "paper-width-slider",
      type: "range",
      attr: {
        min: String(MIN_WIDTH),
        max: String(MAX_WIDTH),
        step: "0.5",
        value: String(this.state.width),
      },
    });
    this.widthSlider.addEventListener("input", () => {
      const width = parseFloat(this.widthSlider!.value);
      this.state.width = width;
      this.widthLabel!.textContent = width.toFixed(1);
      this.callbacks.onWidthChange(width);
    });

    this.updateToolButtonState();
  }

  private createToolButton(
    parent: HTMLElement,
    label: string,
    tool: ActiveTool
  ): HTMLElement {
    const btn = parent.createEl("button", {
      cls: "paper-tool-btn",
      text: label,
      attr: { "data-tool": tool },
    });
    btn.addEventListener("click", () => {
      this.state.activeTool = tool;
      this.updateToolButtonState();
      this.callbacks.onToolChange(tool);
    });
    return btn;
  }

  private buildColorSwatches(): void {
    if (!this.colorSwatches) return;
    this.colorSwatches.empty();

    for (const color of COLOR_PALETTE) {
      const swatch = this.colorSwatches.createEl("button", {
        cls: "paper-color-swatch",
        attr: {
          "data-color-id": color.id,
          "aria-label": color.name,
        },
      });

      swatch.style.backgroundColor = this.isDarkMode ? color.dark : color.light;

      if (color.id === this.state.colorId) {
        swatch.addClass("is-active");
        this.activeSwatchEl = swatch;
      }

      swatch.addEventListener("click", () => {
        this.activeSwatchEl?.removeClass("is-active");
        swatch.addClass("is-active");
        this.activeSwatchEl = swatch;
        this.state.colorId = color.id;
        this.callbacks.onColorChange(color.id);
      });
    }
  }

  private updateToolButtonState(): void {
    this.penBtn?.toggleClass("is-active", this.state.activeTool === "pen");
    this.eraserBtn?.toggleClass("is-active", this.state.activeTool === "eraser");

    // Show/hide pen-specific controls
    const isPen = this.state.activeTool === "pen";
    this.penTypeSelect?.toggleVisibility(isPen);
    this.colorSwatches?.toggleVisibility(isPen);
  }

  getState(): ToolPaletteState {
    return { ...this.state };
  }

  setWidth(width: number): void {
    this.state.width = width;
    if (this.widthSlider) this.widthSlider.value = String(width);
    if (this.widthLabel) this.widthLabel.textContent = width.toFixed(1);
  }

  setDarkMode(isDarkMode: boolean): void {
    if (this.isDarkMode === isDarkMode) return;
    this.isDarkMode = isDarkMode;
    this.buildColorSwatches();
  }

  setPenType(penType: PenType): void {
    this.state.penType = penType;
    if (this.penTypeSelect) this.penTypeSelect.value = penType;
  }

  destroy(): void {
    this.el.remove();
  }
}
