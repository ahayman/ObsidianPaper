import type { PenType } from "../types";
import { COLOR_PALETTE } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";

export type ActiveTool = "pen" | "eraser";

export interface ToolPaletteState {
  activeTool: ActiveTool;
  penType: PenType;
  colorId: string;
  width: number;
  nibAngle: number;
  nibThickness: number;
  nibPressure: number;
}

export interface ToolPaletteCallbacks {
  onToolChange: (tool: ActiveTool) => void;
  onPenTypeChange: (penType: PenType) => void;
  onColorChange: (colorId: string) => void;
  onWidthChange: (width: number) => void;
  onNibAngleChange: (angle: number) => void;
  onNibThicknessChange: (thickness: number) => void;
  onNibPressureChange: (pressure: number) => void;
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
  private nibRow: HTMLElement | null = null;
  private nibAngleSlider: HTMLInputElement | null = null;
  private nibAngleValue: HTMLElement | null = null;
  private nibThicknessSlider: HTMLInputElement | null = null;
  private nibThicknessValue: HTMLElement | null = null;
  private nibPressureSlider: HTMLInputElement | null = null;
  private nibPressureValue: HTMLElement | null = null;
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
      nibAngle: initialState?.nibAngle ?? Math.PI / 6,
      nibThickness: initialState?.nibThickness ?? 0.25,
      nibPressure: initialState?.nibPressure ?? 0.5,
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

    // Nib settings row (fountain pen only)
    this.nibRow = this.el.createEl("div", { cls: "paper-tool-row paper-nib-row" });

    this.nibRow.createEl("span", { cls: "paper-nib-label", text: "Angle" });
    this.nibAngleSlider = this.nibRow.createEl("input", {
      cls: "paper-nib-slider",
      type: "range",
      attr: { min: "0", max: "180", step: "1", value: String(Math.round(this.state.nibAngle * 180 / Math.PI)) },
    });
    this.nibAngleValue = this.nibRow.createEl("span", {
      cls: "paper-nib-value",
      text: `${Math.round(this.state.nibAngle * 180 / Math.PI)}°`,
    });
    this.nibAngleSlider.addEventListener("input", () => {
      const degrees = parseFloat(this.nibAngleSlider!.value);
      const radians = degrees * Math.PI / 180;
      this.state.nibAngle = radians;
      this.nibAngleValue!.textContent = `${Math.round(degrees)}°`;
      this.callbacks.onNibAngleChange(radians);
    });

    this.nibRow.createEl("span", { cls: "paper-nib-label", text: "Aspect" });
    this.nibThicknessSlider = this.nibRow.createEl("input", {
      cls: "paper-nib-slider",
      type: "range",
      attr: { min: "0.05", max: "1.0", step: "0.05", value: String(this.state.nibThickness) },
    });
    this.nibThicknessValue = this.nibRow.createEl("span", {
      cls: "paper-nib-value",
      text: this.state.nibThickness.toFixed(2),
    });
    this.nibThicknessSlider.addEventListener("input", () => {
      const thickness = parseFloat(this.nibThicknessSlider!.value);
      this.state.nibThickness = thickness;
      this.nibThicknessValue!.textContent = thickness.toFixed(2);
      this.callbacks.onNibThicknessChange(thickness);
    });

    this.nibRow.createEl("span", { cls: "paper-nib-label", text: "Pressure" });
    this.nibPressureSlider = this.nibRow.createEl("input", {
      cls: "paper-nib-slider",
      type: "range",
      attr: { min: "0", max: "1.0", step: "0.05", value: String(this.state.nibPressure) },
    });
    this.nibPressureValue = this.nibRow.createEl("span", {
      cls: "paper-nib-value",
      text: this.state.nibPressure.toFixed(2),
    });
    this.nibPressureSlider.addEventListener("input", () => {
      const pressure = parseFloat(this.nibPressureSlider!.value);
      this.state.nibPressure = pressure;
      this.nibPressureValue!.textContent = pressure.toFixed(2);
      this.callbacks.onNibPressureChange(pressure);
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

    // Show nib controls only for pens with nib properties
    const penConfig = getPenConfig(this.state.penType);
    const hasNib = penConfig.nibAngle !== null;
    this.nibRow?.toggleVisibility(isPen && hasNib);
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
    this.updateToolButtonState();
  }

  setNibAngle(angle: number): void {
    this.state.nibAngle = angle;
    if (this.nibAngleSlider) this.nibAngleSlider.value = String(Math.round(angle * 180 / Math.PI));
    if (this.nibAngleValue) this.nibAngleValue.textContent = `${Math.round(angle * 180 / Math.PI)}°`;
  }

  setNibThickness(thickness: number): void {
    this.state.nibThickness = thickness;
    if (this.nibThicknessSlider) this.nibThicknessSlider.value = String(thickness);
    if (this.nibThicknessValue) this.nibThicknessValue.textContent = thickness.toFixed(2);
  }

  setNibPressure(pressure: number): void {
    this.state.nibPressure = pressure;
    if (this.nibPressureSlider) this.nibPressureSlider.value = String(pressure);
    if (this.nibPressureValue) this.nibPressureValue.textContent = pressure.toFixed(2);
  }

  destroy(): void {
    this.el.remove();
  }
}
