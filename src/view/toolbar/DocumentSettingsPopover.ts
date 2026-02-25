import type {
  PageDefaults,
  PaperType,
  PageSizePreset,
  PageOrientation,
  PageUnit,
  PageBackgroundColor,
  PageBackgroundTheme,
  RenderPipeline,
  SpacingUnit,
} from "../../types";
import { PAGE_SIZE_PRESETS, PPI, CM_PER_INCH } from "../../types";
import type { PaperSettings } from "../../settings/PaperSettings";
import { worldUnitsToDisplay, displayToWorldUnits } from "../../settings/PaperSettings";
import { resolvePageBackground } from "../../color/ColorUtils";

const PAGE_SIZE_OPTIONS: { value: PageSizePreset; label: string }[] = [
  { value: "us-letter", label: "US Letter" },
  { value: "us-legal", label: "US Legal" },
  { value: "a4", label: "A4" },
  { value: "a5", label: "A5" },
  { value: "a3", label: "A3" },
  { value: "custom", label: "Custom" },
];

const PAPER_TYPE_OPTIONS: { value: PaperType; label: string }[] = [
  { value: "blank", label: "Blank" },
  { value: "lined", label: "Lined" },
  { value: "grid", label: "Grid" },
  { value: "dot-grid", label: "Dot Grid" },
];

const BG_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "custom", label: "Custom" },
];

export interface DocSettingsContext {
  renderPipeline: RenderPipeline;
  pageDefaults: PageDefaults;
  globalSettings: PaperSettings;
  spacingUnit: SpacingUnit;
  isDarkMode: boolean;
}

export interface DocSettingsCallbacks {
  onRenderPipelineChange: (pipeline: RenderPipeline) => void;
  onPageDefaultsChange: (defaults: PageDefaults) => void;
  onDismiss: () => void;
}

/**
 * Popover for document-wide settings: rendering pipeline and per-document page defaults.
 */
export class DocumentSettingsPopover {
  private backdrop: HTMLElement;
  private el: HTMLElement;
  private callbacks: DocSettingsCallbacks;
  private context: DocSettingsContext;
  private defaults: PageDefaults;

  // Element refs
  private pipelineBtns: Map<string, HTMLElement> = new Map();
  private pageSizeBtns: Map<string, HTMLElement> = new Map();
  private orientationBtns: Map<string, HTMLElement> = new Map();
  private customSizeSection: HTMLElement | null = null;
  private paperTypeBtns: Map<string, HTMLElement> = new Map();
  private bgColorBtns: Map<string, HTMLElement> = new Map();
  private customColorSection: HTMLElement | null = null;
  private customColorInput: HTMLInputElement | null = null;
  private patternThemeSection: HTMLElement | null = null;
  private patternThemeBtns: Map<string, HTMLElement> = new Map();

  constructor(
    context: DocSettingsContext,
    anchor: HTMLElement,
    callbacks: DocSettingsCallbacks,
  ) {
    this.context = context;
    this.callbacks = callbacks;
    this.defaults = { ...context.pageDefaults };

    // Backdrop
    this.backdrop = document.body.createEl("div", { cls: "paper-popover__backdrop" });
    this.backdrop.addEventListener("click", () => callbacks.onDismiss());

    // Panel
    this.el = document.body.createEl("div", { cls: "paper-popover paper-doc-settings-popover" });

    this.build();
    this.positionRelativeTo(anchor);

    document.addEventListener("keydown", this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.callbacks.onDismiss();
    }
  };

  private build(): void {
    const content = this.el.createEl("div", { cls: "paper-popover__content" });

    // 1. Rendering Pipeline
    this.buildRenderingSection(content);

    // 2. Page Defaults header
    const headerSection = content.createEl("div", { cls: "paper-popover__section" });
    headerSection.createEl("div", { cls: "paper-popover__section-title", text: "New Page Defaults" });
    headerSection.createEl("div", { cls: "paper-doc-settings__subtitle", text: "Overrides for new pages in this document" });

    // 3. Page Size
    this.buildPageSizeSection(content);

    // 4. Paper Type
    this.buildPaperTypeSection(content);

    // 5. Grid & Lines
    this.buildGridLinesSection(content);

    // 6. Margins
    this.buildMarginsSection(content);

    // 7. Background
    this.buildBackgroundSection(content);
  }

  // ─── Rendering Pipeline ──────────────────────────────────

  private buildRenderingSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    section.createEl("div", { cls: "paper-popover__section-title", text: "Rendering" });

    const PIPELINE_OPTIONS: { value: RenderPipeline; label: string }[] = [
      { value: "basic", label: "Basic" },
      { value: "advanced", label: "Advanced" },
    ];

    const row = section.createEl("div", { cls: "paper-popover__pen-types" });
    for (const opt of PIPELINE_OPTIONS) {
      const btn = row.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      if (opt.value === this.context.renderPipeline) btn.addClass("is-active");
      this.pipelineBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.pipelineBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.callbacks.onRenderPipelineChange(opt.value);
      });
    }
  }

  // ─── Page Size ───────────────────────────────────────────

  private buildPageSizeSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    const titleRow = section.createEl("div", { cls: "paper-doc-settings__title-row" });
    titleRow.createEl("span", { cls: "paper-popover__section-title", text: "Page size" });
    this.buildResetLink(titleRow, () => {
      delete this.defaults.pageSize;
      delete this.defaults.orientation;
      delete this.defaults.customPageUnit;
      delete this.defaults.customPageWidth;
      delete this.defaults.customPageHeight;
      this.emitDefaults();
      // Update button states
      for (const [, b] of this.pageSizeBtns) b.removeClass("is-active");
      for (const [, b] of this.orientationBtns) b.removeClass("is-active");
      this.updateCustomSizeVisibility();
    });

    const currentSize = this.defaults.pageSize ?? this.context.globalSettings.defaultPageSize;
    const currentOrientation = this.defaults.orientation ?? this.context.globalSettings.defaultOrientation;

    // Size preset buttons
    const sizeRow = section.createEl("div", { cls: "paper-popover__pen-types" });
    for (const opt of PAGE_SIZE_OPTIONS) {
      const btn = sizeRow.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      if (this.defaults.pageSize !== undefined && opt.value === currentSize) btn.addClass("is-active");
      this.pageSizeBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.pageSizeBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.defaults.pageSize = opt.value;
        this.updateCustomSizeVisibility();
        this.emitDefaults();
      });
    }

    // Orientation
    section.createEl("div", { cls: "paper-popover__section-title paper-page-menu__subtitle", text: "Orientation" });
    const orientRow = section.createEl("div", { cls: "paper-popover__pen-types" });
    for (const opt of [{ value: "portrait" as const, label: "Portrait" }, { value: "landscape" as const, label: "Landscape" }]) {
      const btn = orientRow.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      if (this.defaults.orientation !== undefined && opt.value === currentOrientation) btn.addClass("is-active");
      this.orientationBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.orientationBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.defaults.orientation = opt.value;
        this.emitDefaults();
      });
    }

    // Custom size inputs
    this.customSizeSection = section.createEl("div", { cls: "paper-page-menu__custom-size" });

    const customUnit = this.defaults.customPageUnit ?? this.context.globalSettings.customPageUnit;
    const customWidth = this.defaults.customPageWidth ?? this.context.globalSettings.customPageWidth;
    const customHeight = this.defaults.customPageHeight ?? this.context.globalSettings.customPageHeight;

    // Unit selector
    const unitRow = this.customSizeSection.createEl("div", { cls: "paper-popover__slider-row" });
    unitRow.createEl("span", { cls: "paper-popover__slider-label", text: "Unit" });
    const unitSelect = unitRow.createEl("select", { cls: "paper-page-menu__select" });
    for (const u of [{ value: "in" as const, label: "Inches" }, { value: "cm" as const, label: "cm" }]) {
      const option = unitSelect.createEl("option", { text: u.label, attr: { value: u.value } });
      if (u.value === customUnit) option.selected = true;
    }
    unitSelect.addEventListener("change", () => {
      this.defaults.customPageUnit = unitSelect.value as PageUnit;
      this.emitDefaults();
    });

    // Width
    const widthRow = this.customSizeSection.createEl("div", { cls: "paper-popover__slider-row" });
    widthRow.createEl("span", { cls: "paper-popover__slider-label", text: "Width" });
    const widthInput = widthRow.createEl("input", {
      cls: "paper-page-menu__input",
      type: "number",
      attr: { value: String(customWidth), min: "0.5", max: "100", step: "0.1", placeholder: String(this.context.globalSettings.customPageWidth) },
    });
    widthInput.addEventListener("change", () => {
      const num = parseFloat(widthInput.value);
      if (!isNaN(num) && num > 0 && num <= 100) {
        this.defaults.customPageWidth = num;
        this.emitDefaults();
      }
    });

    // Height
    const heightRow = this.customSizeSection.createEl("div", { cls: "paper-popover__slider-row" });
    heightRow.createEl("span", { cls: "paper-popover__slider-label", text: "Height" });
    const heightInput = heightRow.createEl("input", {
      cls: "paper-page-menu__input",
      type: "number",
      attr: { value: String(customHeight), min: "0.5", max: "100", step: "0.1", placeholder: String(this.context.globalSettings.customPageHeight) },
    });
    heightInput.addEventListener("change", () => {
      const num = parseFloat(heightInput.value);
      if (!isNaN(num) && num > 0 && num <= 100) {
        this.defaults.customPageHeight = num;
        this.emitDefaults();
      }
    });

    this.updateCustomSizeVisibility();
  }

  private updateCustomSizeVisibility(): void {
    if (!this.customSizeSection) return;
    const effectiveSize = this.defaults.pageSize ?? this.context.globalSettings.defaultPageSize;
    this.customSizeSection.toggleClass("is-hidden", effectiveSize !== "custom");
  }

  // ─── Paper Type ─────────────────────────────────────────

  private buildPaperTypeSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    const titleRow = section.createEl("div", { cls: "paper-doc-settings__title-row" });
    titleRow.createEl("span", { cls: "paper-popover__section-title", text: "Paper type" });
    this.buildResetLink(titleRow, () => {
      delete this.defaults.paperType;
      this.emitDefaults();
      for (const [, b] of this.paperTypeBtns) b.removeClass("is-active");
    });

    const currentPaperType = this.defaults.paperType ?? this.context.globalSettings.defaultPaperType;

    const typeRow = section.createEl("div", { cls: "paper-popover__pen-types" });
    for (const opt of PAPER_TYPE_OPTIONS) {
      const btn = typeRow.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      if (this.defaults.paperType !== undefined && opt.value === currentPaperType) btn.addClass("is-active");
      this.paperTypeBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.paperTypeBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.defaults.paperType = opt.value;
        this.emitDefaults();
      });
    }
  }

  // ─── Grid & Lines ──────────────────────────────────────

  private buildGridLinesSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    const titleRow = section.createEl("div", { cls: "paper-doc-settings__title-row" });
    titleRow.createEl("span", { cls: "paper-popover__section-title", text: "Grid & lines" });
    this.buildResetLink(titleRow, () => {
      delete this.defaults.lineSpacing;
      delete this.defaults.gridSize;
      this.emitDefaults();
    });

    this.buildSliderWithInput(section, "Line spacing", {
      initialWU: this.defaults.lineSpacing ?? this.context.globalSettings.lineSpacing,
      placeholderWU: this.context.globalSettings.lineSpacing,
      minWU: 5,
      maxWU: 216,
      isSet: this.defaults.lineSpacing !== undefined,
      onChange: (wu) => {
        this.defaults.lineSpacing = wu;
        this.emitDefaults();
      },
    });

    this.buildSliderWithInput(section, "Grid size", {
      initialWU: this.defaults.gridSize ?? this.context.globalSettings.gridSize,
      placeholderWU: this.context.globalSettings.gridSize,
      minWU: 5,
      maxWU: 216,
      isSet: this.defaults.gridSize !== undefined,
      onChange: (wu) => {
        this.defaults.gridSize = wu;
        this.emitDefaults();
      },
    });
  }

  // ─── Margins ───────────────────────────────────────────

  private buildMarginsSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    const titleRow = section.createEl("div", { cls: "paper-doc-settings__title-row" });
    titleRow.createEl("span", { cls: "paper-popover__section-title", text: "Margins" });
    this.buildResetLink(titleRow, () => {
      delete this.defaults.margins;
      this.emitDefaults();
    });

    const gs = this.context.globalSettings;

    this.buildSliderWithInput(section, "Top", {
      initialWU: this.defaults.margins?.top ?? gs.marginTop,
      placeholderWU: gs.marginTop,
      minWU: 0, maxWU: 216,
      isSet: this.defaults.margins?.top !== undefined,
      onChange: (wu) => {
        if (!this.defaults.margins) this.defaults.margins = {};
        this.defaults.margins.top = wu;
        this.emitDefaults();
      },
    });

    this.buildSliderWithInput(section, "Bottom", {
      initialWU: this.defaults.margins?.bottom ?? gs.marginBottom,
      placeholderWU: gs.marginBottom,
      minWU: 0, maxWU: 216,
      isSet: this.defaults.margins?.bottom !== undefined,
      onChange: (wu) => {
        if (!this.defaults.margins) this.defaults.margins = {};
        this.defaults.margins.bottom = wu;
        this.emitDefaults();
      },
    });

    this.buildSliderWithInput(section, "Left", {
      initialWU: this.defaults.margins?.left ?? gs.marginLeft,
      placeholderWU: gs.marginLeft,
      minWU: 0, maxWU: 216,
      isSet: this.defaults.margins?.left !== undefined,
      onChange: (wu) => {
        if (!this.defaults.margins) this.defaults.margins = {};
        this.defaults.margins.left = wu;
        this.emitDefaults();
      },
    });

    this.buildSliderWithInput(section, "Right", {
      initialWU: this.defaults.margins?.right ?? gs.marginRight,
      placeholderWU: gs.marginRight,
      minWU: 0, maxWU: 216,
      isSet: this.defaults.margins?.right !== undefined,
      onChange: (wu) => {
        if (!this.defaults.margins) this.defaults.margins = {};
        this.defaults.margins.right = wu;
        this.emitDefaults();
      },
    });
  }

  // ─── Background ────────────────────────────────────────

  private buildBackgroundSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    const titleRow = section.createEl("div", { cls: "paper-doc-settings__title-row" });
    titleRow.createEl("span", { cls: "paper-popover__section-title", text: "Background" });
    this.buildResetLink(titleRow, () => {
      delete this.defaults.backgroundColor;
      delete this.defaults.backgroundColorTheme;
      this.emitDefaults();
      for (const [, b] of this.bgColorBtns) b.removeClass("is-active");
      this.updateCustomColorVisibility();
      this.updatePatternThemeVisibility();
    });

    const currentBgColor = this.defaults.backgroundColor ?? "auto";

    // Mode buttons
    const modeRow = section.createEl("div", { cls: "paper-popover__pen-types" });
    const activeBgMode = this.getBgMode(currentBgColor);

    for (const opt of BG_COLOR_OPTIONS) {
      const btn = modeRow.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      if (this.defaults.backgroundColor !== undefined && opt.value === activeBgMode) btn.addClass("is-active");
      this.bgColorBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.bgColorBtns) b.removeClass("is-active");
        btn.addClass("is-active");

        if (opt.value === "custom") {
          this.defaults.backgroundColor = this.customColorInput?.value ?? "#ffffff";
          this.defaults.backgroundColorTheme = "auto";
        } else {
          this.defaults.backgroundColor = opt.value as PageBackgroundColor;
          this.defaults.backgroundColorTheme = "auto";
        }

        this.updateCustomColorVisibility();
        this.updatePatternThemeVisibility();
        this.emitDefaults();
      });
    }

    // Custom color picker
    this.customColorSection = section.createEl("div", { cls: "paper-page-menu__custom-color" });
    const colorRow = this.customColorSection.createEl("div", { cls: "paper-popover__slider-row" });
    colorRow.createEl("span", { cls: "paper-popover__slider-label", text: "Color" });

    const hexValue = this.isHexColor(currentBgColor) ? currentBgColor : "#ffffff";
    this.customColorInput = colorRow.createEl("input", {
      cls: "paper-page-menu__color-input",
      type: "color",
      attr: { value: hexValue },
    });
    this.customColorInput.addEventListener("input", () => {
      const hex = this.customColorInput!.value;
      this.defaults.backgroundColor = hex;
      this.defaults.backgroundColorTheme = "auto";
      this.updatePatternThemeState();
      this.emitDefaults();
    });

    const hexInput = colorRow.createEl("input", {
      cls: "paper-page-menu__hex-input",
      type: "text",
      attr: { value: hexValue, maxlength: "7" },
    });
    hexInput.addEventListener("change", () => {
      let hex = hexInput.value.trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        this.customColorInput!.value = hex;
        this.defaults.backgroundColor = hex;
        this.defaults.backgroundColorTheme = "auto";
        this.updatePatternThemeState();
        this.emitDefaults();
      }
    });

    // Pattern theme override
    this.patternThemeSection = section.createEl("div", { cls: "paper-page-menu__pattern-theme" });
    this.patternThemeSection.createEl("div", { cls: "paper-popover__section-title paper-page-menu__subtitle", text: "Pattern colors" });
    const themeRow = this.patternThemeSection.createEl("div", { cls: "paper-popover__pen-types" });

    for (const opt of [{ value: "light" as const, label: "Light" }, { value: "dark" as const, label: "Dark" }]) {
      const btn = themeRow.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      this.patternThemeBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.patternThemeBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.defaults.backgroundColorTheme = opt.value;
        this.emitDefaults();
      });
    }

    this.updatePatternThemeState();
    this.updateCustomColorVisibility();
    this.updatePatternThemeVisibility();
  }

  private getBgMode(color: string): string {
    if (color === "auto" || color === "light" || color === "dark") return color;
    return "custom";
  }

  private isHexColor(color: string): boolean {
    return color.startsWith("#");
  }

  private updateCustomColorVisibility(): void {
    const bgColor = this.defaults.backgroundColor ?? "auto";
    const isCustom = this.getBgMode(bgColor) === "custom";
    this.customColorSection?.toggleClass("is-hidden", !isCustom);
  }

  private updatePatternThemeVisibility(): void {
    const bgColor = this.defaults.backgroundColor ?? "auto";
    const isCustom = this.getBgMode(bgColor) === "custom";
    this.patternThemeSection?.toggleClass("is-hidden", !isCustom);
  }

  private updatePatternThemeState(): void {
    const bgColor = this.defaults.backgroundColor ?? "auto";
    const bgTheme = this.defaults.backgroundColorTheme ?? "auto";

    let activeTheme: "light" | "dark";
    if (bgTheme === "light" || bgTheme === "dark") {
      activeTheme = bgTheme;
    } else {
      const resolved = resolvePageBackground(bgColor, "auto", this.context.isDarkMode);
      activeTheme = resolved.patternTheme;
    }

    for (const [val, btn] of this.patternThemeBtns) {
      btn.toggleClass("is-active", val === activeTheme);
    }
  }

  // ─── Slider + Input Helper ──────────────────────────────

  private buildSliderWithInput(
    parent: HTMLElement,
    label: string,
    opts: {
      initialWU: number;
      placeholderWU: number;
      minWU: number;
      maxWU: number;
      isSet: boolean;
      onChange: (wu: number) => void;
    },
  ): void {
    const unit = this.context.spacingUnit;
    const step = unit === "wu" ? "1" : "0.01";
    const minDisplay = worldUnitsToDisplay(opts.minWU, unit);
    const maxDisplay = worldUnitsToDisplay(opts.maxWU, unit);
    const initialDisplay = worldUnitsToDisplay(opts.initialWU, unit);

    const formatVal = (v: number) => unit === "wu" ? String(Math.round(v)) : parseFloat(v.toFixed(3)).toString();

    const row = parent.createEl("div", { cls: "paper-popover__slider-row" });
    row.createEl("span", { cls: "paper-popover__slider-label", text: label });

    const slider = row.createEl("input", {
      cls: "paper-popover__slider",
      type: "range",
      attr: {
        min: formatVal(minDisplay),
        max: formatVal(maxDisplay),
        step,
        value: formatVal(initialDisplay),
      },
    });

    const input = row.createEl("input", {
      cls: "paper-page-menu__input paper-page-menu__slider-input",
      type: "number",
      attr: {
        min: formatVal(minDisplay),
        max: formatVal(maxDisplay),
        step,
        value: formatVal(initialDisplay),
        placeholder: formatVal(worldUnitsToDisplay(opts.placeholderWU, unit)),
      },
    });

    slider.addEventListener("input", () => {
      const displayVal = parseFloat(slider.value);
      if (isNaN(displayVal)) return;
      input.value = formatVal(displayVal);
      const wu = Math.round(displayToWorldUnits(displayVal, unit));
      if (wu >= opts.minWU && wu <= opts.maxWU) {
        opts.onChange(wu);
      }
    });

    input.addEventListener("change", () => {
      const displayVal = parseFloat(input.value);
      if (isNaN(displayVal)) return;
      const wu = Math.round(displayToWorldUnits(displayVal, unit));
      if (wu >= opts.minWU && wu <= opts.maxWU) {
        slider.value = formatVal(displayVal);
        opts.onChange(wu);
      }
    });
  }

  // ─── Reset Link Helper ─────────────────────────────────

  private buildResetLink(parent: HTMLElement, onReset: () => void): void {
    const link = parent.createEl("button", {
      cls: "paper-doc-settings__reset",
      text: "Reset",
    });
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      onReset();
    });
  }

  // ─── Emit Defaults ─────────────────────────────────────

  private emitDefaults(): void {
    this.callbacks.onPageDefaultsChange({ ...this.defaults });
  }

  // ─── Positioning ───────────────────────────────────────

  private positionRelativeTo(anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const gap = 8;

    const popoverRect = this.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical: prefer below the anchor
    const spaceBelow = vh - anchorRect.bottom - gap;
    const spaceAbove = anchorRect.top - gap;
    let top: number;
    if (spaceBelow >= popoverRect.height || spaceBelow >= spaceAbove) {
      top = Math.min(anchorRect.bottom + gap, vh - popoverRect.height - gap);
    } else {
      top = Math.max(gap, anchorRect.top - gap - popoverRect.height);
    }

    // Horizontal: center on anchor, clamp to viewport
    const centerX = anchorRect.left + anchorRect.width / 2;
    let left = centerX - popoverRect.width / 2;
    left = Math.max(gap, Math.min(left, vw - popoverRect.width - gap));

    this.el.setCssProps({
      "--popover-top": `${top}px`,
      "--popover-left": `${left}px`,
    });
    this.el.dataset.anchor = "fixed";
  }

  destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    this.backdrop.remove();
    this.el.remove();
  }
}
