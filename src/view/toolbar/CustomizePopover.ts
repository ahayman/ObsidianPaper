import type { PenType } from "../../types";
import type { PenPreset, ToolbarPosition, ToolbarState } from "./ToolbarTypes";
import { getPenConfig } from "../../stroke/PenConfigs";
import { ColorPickerPanel } from "./ColorPickerPanel";
import { DEFAULT_GRAIN_VALUE } from "../../stamp/GrainMapping";

const PEN_TYPES: { type: PenType; label: string }[] = [
  { type: "ballpoint", label: "Ballpoint" },
  { type: "felt-tip", label: "Felt tip" },
  { type: "pencil", label: "Pencil" },
  { type: "fountain", label: "Fountain" },
  { type: "highlighter", label: "Highlighter" },
];

const POSITIONS: { value: ToolbarPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

export interface CustomizePopoverCallbacks {
  onStateChange: (partial: Partial<ToolbarState>) => void;
  onSaveAsNew: () => void;
  onUpdatePreset: () => void;
  onDeletePreset: () => void;
  onPositionChange: (position: ToolbarPosition) => void;
  onDismiss: () => void;
}

/**
 * Floating customization panel for pen settings and presets.
 */
export class CustomizePopover {
  private backdrop: HTMLElement;
  private el: HTMLElement;
  private state: ToolbarState;
  private position: ToolbarPosition;
  private isDark: boolean;
  private activePreset: PenPreset | null;
  private callbacks: CustomizePopoverCallbacks;

  // Element refs for updates
  private grainSection: HTMLElement | null = null;
  private grainSlider: HTMLInputElement | null = null;
  private grainValue: HTMLElement | null = null;
  private nibSection: HTMLElement | null = null;
  private presetActionsSection: HTMLElement | null = null;
  private widthSlider: HTMLInputElement | null = null;
  private widthValue: HTMLElement | null = null;
  private smoothingSlider: HTMLInputElement | null = null;
  private smoothingValue: HTMLElement | null = null;
  private nibAngleSlider: HTMLInputElement | null = null;
  private nibAngleValue: HTMLElement | null = null;
  private nibThicknessSlider: HTMLInputElement | null = null;
  private nibThicknessValue: HTMLElement | null = null;
  private nibPressureSlider: HTMLInputElement | null = null;
  private nibPressureValue: HTMLElement | null = null;
  private colorPicker: ColorPickerPanel | null = null;
  private penTypeBtns: Map<PenType, HTMLElement> = new Map();
  private positionBtns: Map<ToolbarPosition, HTMLElement> = new Map();

  constructor(
    state: ToolbarState,
    position: ToolbarPosition,
    isDarkMode: boolean,
    activePreset: PenPreset | null,
    anchor: HTMLElement,
    callbacks: CustomizePopoverCallbacks
  ) {
    this.state = { ...state };
    this.position = position;
    this.isDark = isDarkMode;
    this.activePreset = activePreset;
    this.callbacks = callbacks;

    // Backdrop
    this.backdrop = document.body.createEl("div", { cls: "paper-popover__backdrop" });
    this.backdrop.addEventListener("click", () => callbacks.onDismiss());

    // Popover panel
    this.el = document.body.createEl("div", {
      cls: "paper-popover",
      attr: { "data-position": position },
    });

    this.build();
    this.positionRelativeTo(anchor);

    // Escape key
    document.addEventListener("keydown", this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.callbacks.onDismiss();
    }
  };

  private build(): void {
    const content = this.el.createEl("div", { cls: "paper-popover__content" });

    // 1. Pen Type
    this.buildPenTypeSection(content);

    // 2. Colors
    this.buildColorSection(content);

    // 3. Width
    this.buildSliderSection(content, "Width", 0.5, 30, 0.5, this.state.width, (v) => {
      this.state.width = v;
      this.widthValue!.textContent = v.toFixed(1);
      this.callbacks.onStateChange({ width: v });
    }, (el, valEl) => { this.widthSlider = el; this.widthValue = valEl; },
    this.state.width.toFixed(1));

    // 4. Smoothing
    this.buildSliderSection(content, "Smoothing", 0, 1, 0.05, this.state.smoothing, (v) => {
      this.state.smoothing = v;
      this.smoothingValue!.textContent = v.toFixed(2);
      this.callbacks.onStateChange({ smoothing: v });
    }, (el, valEl) => { this.smoothingSlider = el; this.smoothingValue = valEl; },
    this.state.smoothing.toFixed(2));

    // 5. Grain (pencil only)
    this.grainSection = content.createEl("div", { cls: "paper-popover__section paper-popover__grain" });
    const grainRow = this.grainSection.createEl("div", { cls: "paper-popover__slider-row" });
    grainRow.createEl("span", { cls: "paper-popover__slider-label", text: "Grain" });
    const grainSlider = grainRow.createEl("input", {
      cls: "paper-popover__slider",
      type: "range",
      attr: { min: "0", max: "1", step: "0.05", value: String(this.state.grain) },
    });
    this.grainSlider = grainSlider;
    const grainHints = grainRow.createEl("span", { cls: "paper-popover__slider-value" });
    grainHints.textContent = this.state.grain.toFixed(2);
    this.grainValue = grainHints;

    grainSlider.addEventListener("input", () => {
      const v = parseFloat(grainSlider.value);
      this.state.grain = v;
      this.grainValue!.textContent = v.toFixed(2);
      this.callbacks.onStateChange({ grain: v });
    });

    this.updateGrainVisibility();

    // 6. Nib Settings (fountain only)
    this.nibSection = content.createEl("div", { cls: "paper-popover__section paper-popover__nib" });
    this.nibSection.createEl("div", { cls: "paper-popover__section-title", text: "Nib settings" });

    this.buildNibSlider(this.nibSection, "Angle", 0, 180, 1,
      Math.round(this.state.nibAngle * 180 / Math.PI), (v) => {
        const rad = v * Math.PI / 180;
        this.state.nibAngle = rad;
        this.nibAngleValue!.textContent = `${Math.round(v)}°`;
        this.callbacks.onStateChange({ nibAngle: rad });
      }, (el, valEl) => { this.nibAngleSlider = el; this.nibAngleValue = valEl; },
      `${Math.round(this.state.nibAngle * 180 / Math.PI)}°`);

    this.buildNibSlider(this.nibSection, "Aspect", 0.05, 1.0, 0.05,
      this.state.nibThickness, (v) => {
        this.state.nibThickness = v;
        this.nibThicknessValue!.textContent = v.toFixed(2);
        this.callbacks.onStateChange({ nibThickness: v });
      }, (el, valEl) => { this.nibThicknessSlider = el; this.nibThicknessValue = valEl; },
      this.state.nibThickness.toFixed(2));

    this.buildNibSlider(this.nibSection, "Pressure", 0, 1.0, 0.05,
      this.state.nibPressure, (v) => {
        this.state.nibPressure = v;
        this.nibPressureValue!.textContent = v.toFixed(2);
        this.callbacks.onStateChange({ nibPressure: v });
      }, (el, valEl) => { this.nibPressureSlider = el; this.nibPressureValue = valEl; },
      this.state.nibPressure.toFixed(2));

    this.updateNibVisibility();

    // 7. Preset Actions
    this.presetActionsSection = content.createEl("div", { cls: "paper-popover__section paper-popover__preset-actions" });
    this.buildPresetActions();

    // 8. Toolbar Position
    this.buildPositionSection(content);
  }

  // ─── Pen Type Section ──────────────────────────────────────

  private buildPenTypeSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    section.createEl("div", { cls: "paper-popover__section-title", text: "Pen type" });
    const row = section.createEl("div", { cls: "paper-popover__pen-types" });

    for (const pt of PEN_TYPES) {
      const btn = row.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: pt.label,
      });
      if (pt.type === this.state.penType) btn.addClass("is-active");
      this.penTypeBtns.set(pt.type, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.penTypeBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.state.penType = pt.type;
        this.updateGrainVisibility();
        this.updateNibVisibility();
        this.callbacks.onStateChange({ penType: pt.type });
      });
    }
  }

  // ─── Color Section ─────────────────────────────────────────

  private buildColorSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    section.createEl("div", { cls: "paper-popover__section-title", text: "Color" });

    this.colorPicker = new ColorPickerPanel(section, this.state.colorId, {
      onColorSelect: (colorId) => {
        this.state.colorId = colorId;
        this.callbacks.onStateChange({ colorId });
      },
    });
  }

  // ─── Slider Helpers ────────────────────────────────────────

  private buildSliderSection(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (v: number) => void,
    refSetter: (slider: HTMLInputElement, valEl: HTMLElement) => void,
    displayValue: string
  ): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    const row = section.createEl("div", { cls: "paper-popover__slider-row" });
    row.createEl("span", { cls: "paper-popover__slider-label", text: label });
    const slider = row.createEl("input", {
      cls: "paper-popover__slider",
      type: "range",
      attr: { min: String(min), max: String(max), step: String(step), value: String(value) },
    });
    const valEl = row.createEl("span", { cls: "paper-popover__slider-value", text: displayValue });
    refSetter(slider, valEl);

    slider.addEventListener("input", () => {
      onChange(parseFloat(slider.value));
    });
  }

  private buildNibSlider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (v: number) => void,
    refSetter: (slider: HTMLInputElement, valEl: HTMLElement) => void,
    displayValue: string
  ): void {
    const row = parent.createEl("div", { cls: "paper-popover__slider-row" });
    row.createEl("span", { cls: "paper-popover__slider-label", text: label });
    const slider = row.createEl("input", {
      cls: "paper-popover__slider",
      type: "range",
      attr: { min: String(min), max: String(max), step: String(step), value: String(value) },
    });
    const valEl = row.createEl("span", { cls: "paper-popover__slider-value", text: displayValue });
    refSetter(slider, valEl);

    slider.addEventListener("input", () => {
      onChange(parseFloat(slider.value));
    });
  }

  // ─── Grain Visibility ──────────────────────────────────────

  private updateGrainVisibility(): void {
    if (!this.grainSection) return;
    const penConfig = getPenConfig(this.state.penType);
    const hasStamp = penConfig.stamp !== null;
    this.grainSection.toggleClass("is-hidden", !hasStamp);
  }

  // ─── Nib Visibility ────────────────────────────────────────

  private updateNibVisibility(): void {
    if (!this.nibSection) return;
    const penConfig = getPenConfig(this.state.penType);
    const hasNib = penConfig.nibAngle !== null;
    this.nibSection.toggleClass("is-hidden", !hasNib);
  }

  // ─── Preset Actions ────────────────────────────────────────

  private buildPresetActions(): void {
    if (!this.presetActionsSection) return;
    this.presetActionsSection.empty();

    if (this.activePreset) {
      // Update existing preset
      const updateBtn = this.presetActionsSection.createEl("button", {
        cls: "paper-popover__action-btn",
        text: "Update preset",
      });
      updateBtn.addEventListener("click", () => this.callbacks.onUpdatePreset());

      // Save as copy
      const copyBtn = this.presetActionsSection.createEl("button", {
        cls: "paper-popover__action-btn",
        text: "Save as new preset",
      });
      copyBtn.addEventListener("click", () => this.callbacks.onSaveAsNew());

      // Delete
      const deleteBtn = this.presetActionsSection.createEl("button", {
        cls: "paper-popover__action-btn paper-popover__action-btn--danger",
        text: "Delete",
      });
      deleteBtn.addEventListener("click", () => this.callbacks.onDeletePreset());
    } else {
      // Save as new
      const saveBtn = this.presetActionsSection.createEl("button", {
        cls: "paper-popover__action-btn",
        text: "Save as new preset",
      });
      saveBtn.addEventListener("click", () => this.callbacks.onSaveAsNew());
    }
  }

  // ─── Position Section ──────────────────────────────────────

  private buildPositionSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    section.createEl("div", { cls: "paper-popover__section-title", text: "Toolbar position" });
    const row = section.createEl("div", { cls: "paper-popover__positions" });

    for (const pos of POSITIONS) {
      const btn = row.createEl("button", {
        cls: "paper-popover__position-btn",
        text: pos.label,
      });
      if (pos.value === this.position) btn.addClass("is-active");
      this.positionBtns.set(pos.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.positionBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.position = pos.value;
        this.callbacks.onPositionChange(pos.value);
      });
    }
  }

  // ─── Positioning ───────────────────────────────────────────

  private positionRelativeTo(anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();

    // Position popover adjacent to toolbar using CSS custom properties
    switch (this.position) {
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

  // ─── Public API ────────────────────────────────────────────

  setActivePreset(preset: PenPreset | null): void {
    this.activePreset = preset;
    this.buildPresetActions();
  }

  setDarkMode(isDark: boolean): void {
    this.isDark = isDark;
    // Color picker always shows both light/dark variants — no update needed
  }

  setPosition(position: ToolbarPosition): void {
    this.position = position;
    this.el.dataset.position = position;
    for (const [val, btn] of this.positionBtns) {
      btn.toggleClass("is-active", val === position);
    }
  }

  destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    this.colorPicker?.destroy();
    this.backdrop.remove();
    this.el.remove();
  }
}
