import type { Page, PaperType, PageSizePreset, PageOrientation, PageUnit, PageSize, PageBackgroundColor, PageBackgroundTheme, PageMargins } from "../types";
import { PAGE_SIZE_PRESETS, PPI, CM_PER_INCH } from "../types";
import { resolvePageBackground } from "../color/ColorUtils";
import { displayToWorldUnits, worldUnitsToDisplay } from "../settings/PaperSettings";
import type { SpacingUnit } from "../types";

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

export interface PageMenuPopoverCallbacks {
  onDeletePage: (pageIndex: number) => void;
  onUpdateStyle: (pageIndex: number, changes: { paperType?: PaperType; lineSpacing?: number; gridSize?: number; margins?: Partial<PageMargins> }) => void;
  onUpdateBackground: (pageIndex: number, backgroundColor: PageBackgroundColor, backgroundColorTheme?: PageBackgroundTheme) => void;
  onUpdateSize: (pageIndex: number, size: PageSize, orientation: PageOrientation, scaleStrokes: boolean) => void;
  onDismiss: () => void;
}

export interface PageMenuPopoverContext {
  page: Page;
  pageIndex: number;
  totalPages: number;
  hasStrokes: boolean;
  isDarkMode: boolean;
  spacingUnit: SpacingUnit;
}

/**
 * Popover for per-page settings: delete, page size, grid/lines, background color.
 */
export class PageMenuPopover {
  private backdrop: HTMLElement;
  private el: HTMLElement;
  private callbacks: PageMenuPopoverCallbacks;
  private context: PageMenuPopoverContext;

  // Track current page state (local copy for live editing)
  private currentPageSize: PageSizePreset = "us-letter";
  private currentOrientation: PageOrientation = "portrait";
  private currentCustomUnit: PageUnit = "in";
  private currentCustomWidth = 8.5;
  private currentCustomHeight = 11;
  private currentPaperType: PaperType = "blank";
  private currentLineSpacing: number;
  private currentGridSize: number;
  private currentMarginTop: number;
  private currentMarginBottom: number;
  private currentMarginLeft: number;
  private currentMarginRight: number;
  private currentBgColor: string;  // "auto" | "light" | "dark" | hex
  private currentBgTheme: PageBackgroundTheme;

  // Element refs
  private customSizeSection: HTMLElement | null = null;
  private pageSizeBtns: Map<string, HTMLElement> = new Map();
  private orientationBtns: Map<string, HTMLElement> = new Map();
  private paperTypeBtns: Map<string, HTMLElement> = new Map();
  private bgColorBtns: Map<string, HTMLElement> = new Map();
  private customColorSection: HTMLElement | null = null;
  private customColorInput: HTMLInputElement | null = null;
  private patternThemeSection: HTMLElement | null = null;
  private patternThemeBtns: Map<string, HTMLElement> = new Map();

  constructor(
    context: PageMenuPopoverContext,
    anchor: HTMLElement,
    callbacks: PageMenuPopoverCallbacks,
  ) {
    this.context = context;
    this.callbacks = callbacks;

    // Initialize local state from page
    const page = context.page;
    this.currentPageSize = this.detectPageSizePreset(page);
    this.currentOrientation = page.orientation;
    this.currentPaperType = page.paperType;
    this.currentLineSpacing = page.lineSpacing;
    this.currentGridSize = page.gridSize;
    this.currentMarginTop = page.margins.top;
    this.currentMarginBottom = page.margins.bottom;
    this.currentMarginLeft = page.margins.left;
    this.currentMarginRight = page.margins.right;
    this.currentBgColor = page.backgroundColor ?? "auto";
    this.currentBgTheme = page.backgroundColorTheme ?? "auto";

    // For custom size, compute display values
    if (this.currentPageSize === "custom") {
      this.currentCustomWidth = page.size.width / PPI;
      this.currentCustomHeight = page.size.height / PPI;
    }

    // Backdrop
    this.backdrop = document.body.createEl("div", { cls: "paper-popover__backdrop" });
    this.backdrop.addEventListener("click", () => callbacks.onDismiss());

    // Panel
    this.el = document.body.createEl("div", { cls: "paper-popover paper-page-menu-popover" });

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

    // 1. Delete
    this.buildDeleteSection(content);

    // 2. Page Size
    this.buildPageSizeSection(content);

    // 3. Grid & Lines
    this.buildGridLinesSection(content);

    // 4. Margins
    this.buildMarginsSection(content);

    // 5. Background Color
    this.buildBackgroundSection(content);
  }

  // ─── Delete ──────────────────────────────────────────────

  private buildDeleteSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });

    const btn = section.createEl("button", {
      cls: "paper-popover__action-btn paper-popover__action-btn--danger paper-page-menu__delete-btn",
      text: "Delete page",
    });

    if (this.context.totalPages <= 1) {
      btn.addClass("is-disabled");
      btn.setAttribute("disabled", "true");
      btn.setAttribute("title", "Cannot delete the only page");
    } else {
      btn.addEventListener("click", () => {
        if (this.context.hasStrokes) {
          // Show confirmation
          this.showDeleteConfirmation(btn);
        } else {
          this.callbacks.onDeletePage(this.context.pageIndex);
          this.callbacks.onDismiss();
        }
      });
    }
  }

  private showDeleteConfirmation(btn: HTMLElement): void {
    btn.textContent = "This page has strokes. Delete anyway?";
    btn.removeClass("paper-popover__action-btn--danger");
    btn.addClass("paper-page-menu__delete-confirm");

    // Replace with confirm/cancel
    const parent = btn.parentElement!;
    const confirmRow = parent.createEl("div", { cls: "paper-page-menu__confirm-row" });

    const confirmBtn = confirmRow.createEl("button", {
      cls: "paper-popover__action-btn paper-popover__action-btn--danger",
      text: "Delete",
    });
    confirmBtn.addEventListener("click", () => {
      this.callbacks.onDeletePage(this.context.pageIndex);
      this.callbacks.onDismiss();
    });

    const cancelBtn = confirmRow.createEl("button", {
      cls: "paper-popover__action-btn",
      text: "Cancel",
    });
    cancelBtn.addEventListener("click", () => {
      btn.textContent = "Delete page";
      btn.addClass("paper-popover__action-btn--danger");
      btn.removeClass("paper-page-menu__delete-confirm");
      btn.removeClass("is-hidden");
      confirmRow.remove();
    });

    btn.addClass("is-hidden");
  }

  // ─── Page Size ───────────────────────────────────────────

  private buildPageSizeSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    section.createEl("div", { cls: "paper-popover__section-title", text: "Page size" });

    // Size preset buttons
    const sizeRow = section.createEl("div", { cls: "paper-popover__pen-types" });
    for (const opt of PAGE_SIZE_OPTIONS) {
      const btn = sizeRow.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      if (opt.value === this.currentPageSize) btn.addClass("is-active");
      this.pageSizeBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.pageSizeBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.currentPageSize = opt.value;
        this.updateCustomSizeVisibility();
        this.applyPageSize();
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
      if (opt.value === this.currentOrientation) btn.addClass("is-active");
      this.orientationBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.orientationBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.currentOrientation = opt.value;
        this.applyPageSize();
      });
    }

    // Custom size inputs (hidden unless "custom" selected)
    this.customSizeSection = section.createEl("div", { cls: "paper-page-menu__custom-size" });

    // Unit selector
    const unitRow = this.customSizeSection.createEl("div", { cls: "paper-popover__slider-row" });
    unitRow.createEl("span", { cls: "paper-popover__slider-label", text: "Unit" });
    const unitSelect = unitRow.createEl("select", { cls: "paper-page-menu__select" });
    for (const u of [{ value: "in" as const, label: "Inches" }, { value: "cm" as const, label: "cm" }]) {
      const option = unitSelect.createEl("option", { text: u.label, attr: { value: u.value } });
      if (u.value === this.currentCustomUnit) option.selected = true;
    }
    unitSelect.addEventListener("change", () => {
      this.currentCustomUnit = unitSelect.value as PageUnit;
    });

    // Width
    const widthRow = this.customSizeSection.createEl("div", { cls: "paper-popover__slider-row" });
    widthRow.createEl("span", { cls: "paper-popover__slider-label", text: "Width" });
    const widthInput = widthRow.createEl("input", {
      cls: "paper-page-menu__input",
      type: "number",
      attr: { value: String(this.currentCustomWidth), min: "0.5", max: "100", step: "0.1" },
    });
    widthInput.addEventListener("change", () => {
      const num = parseFloat(widthInput.value);
      if (!isNaN(num) && num > 0 && num <= 100) {
        this.currentCustomWidth = num;
        this.applyPageSize();
      }
    });

    // Height
    const heightRow = this.customSizeSection.createEl("div", { cls: "paper-popover__slider-row" });
    heightRow.createEl("span", { cls: "paper-popover__slider-label", text: "Height" });
    const heightInput = heightRow.createEl("input", {
      cls: "paper-page-menu__input",
      type: "number",
      attr: { value: String(this.currentCustomHeight), min: "0.5", max: "100", step: "0.1" },
    });
    heightInput.addEventListener("change", () => {
      const num = parseFloat(heightInput.value);
      if (!isNaN(num) && num > 0 && num <= 100) {
        this.currentCustomHeight = num;
        this.applyPageSize();
      }
    });

    this.updateCustomSizeVisibility();
  }

  private updateCustomSizeVisibility(): void {
    if (!this.customSizeSection) return;
    this.customSizeSection.toggleClass("is-hidden", this.currentPageSize !== "custom");
  }

  private applyPageSize(): void {
    let size: PageSize;
    if (this.currentPageSize === "custom") {
      const factor = this.currentCustomUnit === "in" ? PPI : PPI / CM_PER_INCH;
      size = {
        width: Math.round(this.currentCustomWidth * factor),
        height: Math.round(this.currentCustomHeight * factor),
      };
    } else {
      size = PAGE_SIZE_PRESETS[this.currentPageSize];
    }

    // Check if page has strokes and size actually changed
    const page = this.context.page;
    const sizeChanged = size.width !== page.size.width || size.height !== page.size.height;
    const orientChanged = this.currentOrientation !== page.orientation;

    if (!sizeChanged && !orientChanged) return;

    if (this.context.hasStrokes && (sizeChanged || orientChanged)) {
      this.showStrokeResizeDialog(size, this.currentOrientation);
    } else {
      this.callbacks.onUpdateSize(this.context.pageIndex, size, this.currentOrientation, false);
    }
  }

  // ─── Slider + Input Helper ──────────────────────────────

  /**
   * Build a row with: [label] [range slider] [number input]
   * Slider and input stay synchronized. Values are in display units;
   * conversion to world units happens in onChange.
   */
  private buildSliderWithInput(
    parent: HTMLElement,
    label: string,
    opts: {
      initialWU: number;
      minWU: number;
      maxWU: number;
      onChange: (wu: number) => void;
    },
  ): { slider: HTMLInputElement; input: HTMLInputElement } {
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

    return { slider, input };
  }

  // ─── Grid & Lines ────────────────────────────────────────

  private buildGridLinesSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    section.createEl("div", { cls: "paper-popover__section-title", text: "Grid & lines" });

    // Paper type buttons
    const typeRow = section.createEl("div", { cls: "paper-popover__pen-types" });
    for (const opt of PAPER_TYPE_OPTIONS) {
      const btn = typeRow.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      if (opt.value === this.currentPaperType) btn.addClass("is-active");
      this.paperTypeBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.paperTypeBtns) b.removeClass("is-active");
        btn.addClass("is-active");
        this.currentPaperType = opt.value;
        this.callbacks.onUpdateStyle(this.context.pageIndex, { paperType: opt.value });
      });
    }

    // Line spacing slider+input
    this.buildSliderWithInput(section, "Line spacing", {
      initialWU: this.currentLineSpacing,
      minWU: 5,
      maxWU: 216,
      onChange: (wu) => {
        this.currentLineSpacing = wu;
        this.callbacks.onUpdateStyle(this.context.pageIndex, { lineSpacing: wu });
      },
    });

    // Grid size slider+input
    this.buildSliderWithInput(section, "Grid size", {
      initialWU: this.currentGridSize,
      minWU: 5,
      maxWU: 216,
      onChange: (wu) => {
        this.currentGridSize = wu;
        this.callbacks.onUpdateStyle(this.context.pageIndex, { gridSize: wu });
      },
    });
  }

  // ─── Margins ────────────────────────────────────────────

  private buildMarginsSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    section.createEl("div", { cls: "paper-popover__section-title", text: "Margins" });

    this.buildSliderWithInput(section, "Top", {
      initialWU: this.currentMarginTop,
      minWU: 0,
      maxWU: 216,
      onChange: (wu) => {
        this.currentMarginTop = wu;
        this.callbacks.onUpdateStyle(this.context.pageIndex, { margins: { top: wu } });
      },
    });

    this.buildSliderWithInput(section, "Bottom", {
      initialWU: this.currentMarginBottom,
      minWU: 0,
      maxWU: 216,
      onChange: (wu) => {
        this.currentMarginBottom = wu;
        this.callbacks.onUpdateStyle(this.context.pageIndex, { margins: { bottom: wu } });
      },
    });

    this.buildSliderWithInput(section, "Left", {
      initialWU: this.currentMarginLeft,
      minWU: 0,
      maxWU: 216,
      onChange: (wu) => {
        this.currentMarginLeft = wu;
        this.callbacks.onUpdateStyle(this.context.pageIndex, { margins: { left: wu } });
      },
    });

    this.buildSliderWithInput(section, "Right", {
      initialWU: this.currentMarginRight,
      minWU: 0,
      maxWU: 216,
      onChange: (wu) => {
        this.currentMarginRight = wu;
        this.callbacks.onUpdateStyle(this.context.pageIndex, { margins: { right: wu } });
      },
    });
  }

  // ─── Background Color ────────────────────────────────────

  private buildBackgroundSection(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "paper-popover__section" });
    section.createEl("div", { cls: "paper-popover__section-title", text: "Background" });

    // Mode buttons: Auto, Light, Dark, Custom
    const modeRow = section.createEl("div", { cls: "paper-popover__pen-types" });
    const activeBgMode = this.getBgMode();

    for (const opt of BG_COLOR_OPTIONS) {
      const btn = modeRow.createEl("button", {
        cls: "paper-popover__pen-type-btn",
        text: opt.label,
      });
      if (opt.value === activeBgMode) btn.addClass("is-active");
      this.bgColorBtns.set(opt.value, btn);

      btn.addEventListener("click", () => {
        for (const [, b] of this.bgColorBtns) b.removeClass("is-active");
        btn.addClass("is-active");

        if (opt.value === "custom") {
          this.currentBgColor = this.customColorInput?.value ?? "#ffffff";
          this.currentBgTheme = "auto";
        } else {
          this.currentBgColor = opt.value;
          this.currentBgTheme = "auto";
        }

        this.updateCustomColorVisibility();
        this.updatePatternThemeVisibility();
        this.callbacks.onUpdateBackground(this.context.pageIndex, this.currentBgColor, this.currentBgTheme);
      });
    }

    // Custom color picker section
    this.customColorSection = section.createEl("div", { cls: "paper-page-menu__custom-color" });

    const colorRow = this.customColorSection.createEl("div", { cls: "paper-popover__slider-row" });
    colorRow.createEl("span", { cls: "paper-popover__slider-label", text: "Color" });
    this.customColorInput = colorRow.createEl("input", {
      cls: "paper-page-menu__color-input",
      type: "color",
      attr: { value: this.isHexColor(this.currentBgColor) ? this.currentBgColor : "#ffffff" },
    });
    this.customColorInput.addEventListener("input", () => {
      const hex = this.customColorInput!.value;
      this.currentBgColor = hex;
      // Reset pattern theme to auto when color changes
      this.currentBgTheme = "auto";
      this.updatePatternThemeState();
      this.callbacks.onUpdateBackground(this.context.pageIndex, hex, this.currentBgTheme);
    });

    // Hex text input
    const hexInput = colorRow.createEl("input", {
      cls: "paper-page-menu__hex-input",
      type: "text",
      attr: { value: this.isHexColor(this.currentBgColor) ? this.currentBgColor : "#ffffff", maxlength: "7" },
    });
    hexInput.addEventListener("change", () => {
      let hex = hexInput.value.trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        this.customColorInput!.value = hex;
        this.currentBgColor = hex;
        this.currentBgTheme = "auto";
        this.updatePatternThemeState();
        this.callbacks.onUpdateBackground(this.context.pageIndex, hex, this.currentBgTheme);
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
        this.currentBgTheme = opt.value;
        this.callbacks.onUpdateBackground(this.context.pageIndex, this.currentBgColor, this.currentBgTheme);
      });
    }

    this.updatePatternThemeState();
    this.updateCustomColorVisibility();
    this.updatePatternThemeVisibility();
  }

  private getBgMode(): string {
    if (this.currentBgColor === "auto" || this.currentBgColor === "light" || this.currentBgColor === "dark") {
      return this.currentBgColor;
    }
    return "custom";
  }

  private isHexColor(color: string): boolean {
    return color.startsWith("#");
  }

  private updateCustomColorVisibility(): void {
    const isCustom = this.getBgMode() === "custom";
    this.customColorSection?.toggleClass("is-hidden", !isCustom);
  }

  private updatePatternThemeVisibility(): void {
    const isCustom = this.getBgMode() === "custom";
    this.patternThemeSection?.toggleClass("is-hidden", !isCustom);
  }

  private updatePatternThemeState(): void {
    // Determine which pattern theme is active
    let activeTheme: "light" | "dark";
    if (this.currentBgTheme === "light" || this.currentBgTheme === "dark") {
      activeTheme = this.currentBgTheme;
    } else {
      // Auto: infer from color
      const resolved = resolvePageBackground(this.currentBgColor, "auto", this.context.isDarkMode);
      activeTheme = resolved.patternTheme;
    }

    for (const [val, btn] of this.patternThemeBtns) {
      btn.toggleClass("is-active", val === activeTheme);
    }
  }

  // ─── Stroke Resize Dialog ────────────────────────────────

  private showStrokeResizeDialog(newSize: PageSize, newOrientation: PageOrientation): void {
    // Create an inline dialog within the popover
    const overlay = this.el.createEl("div", { cls: "paper-page-menu__resize-overlay" });
    const dialog = overlay.createEl("div", { cls: "paper-page-menu__resize-dialog" });

    dialog.createEl("div", { cls: "paper-page-menu__resize-title", text: "This page has strokes" });
    dialog.createEl("div", { cls: "paper-page-menu__resize-desc", text: "How should existing strokes be handled?" });

    const keepBtn = dialog.createEl("button", {
      cls: "paper-popover__action-btn",
      text: "Keep as-is (may clip)",
    });
    keepBtn.addEventListener("click", () => {
      overlay.remove();
      this.callbacks.onUpdateSize(this.context.pageIndex, newSize, newOrientation, false);
    });

    const scaleBtn = dialog.createEl("button", {
      cls: "paper-popover__action-btn",
      text: "Scale strokes to fit",
    });
    scaleBtn.addEventListener("click", () => {
      overlay.remove();
      this.callbacks.onUpdateSize(this.context.pageIndex, newSize, newOrientation, true);
    });

    const cancelBtn = dialog.createEl("button", {
      cls: "paper-popover__action-btn",
      text: "Cancel",
    });
    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      // Revert button states
      const oldPreset = this.detectPageSizePreset(this.context.page);
      for (const [val, b] of this.pageSizeBtns) {
        b.toggleClass("is-active", val === oldPreset);
      }
      for (const [val, b] of this.orientationBtns) {
        b.toggleClass("is-active", val === this.context.page.orientation);
      }
      this.currentPageSize = oldPreset;
      this.currentOrientation = this.context.page.orientation;
      this.updateCustomSizeVisibility();
    });
  }

  // ─── Helpers ─────────────────────────────────────────────

  private detectPageSizePreset(page: Page): PageSizePreset {
    for (const [key, size] of Object.entries(PAGE_SIZE_PRESETS)) {
      if (page.size.width === size.width && page.size.height === size.height) {
        return key as PageSizePreset;
      }
    }
    return "custom";
  }

  private positionRelativeTo(anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const gap = 8;

    // Measure the popover's actual size (it's already in the DOM)
    const popoverRect = this.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical: prefer below the anchor, flip above if not enough room
    const spaceBelow = vh - anchorRect.bottom - gap;
    const spaceAbove = anchorRect.top - gap;
    let top: number;
    if (spaceBelow >= popoverRect.height || spaceBelow >= spaceAbove) {
      // Place below, but clamp so bottom edge stays on screen
      top = Math.min(anchorRect.bottom + gap, vh - popoverRect.height - gap);
    } else {
      // Place above, but clamp so top edge stays on screen
      top = Math.max(gap, anchorRect.top - gap - popoverRect.height);
    }

    // Horizontal: center on anchor, but clamp to viewport
    const centerX = anchorRect.left + anchorRect.width / 2;
    let left = centerX - popoverRect.width / 2;
    left = Math.max(gap, Math.min(left, vw - popoverRect.width - gap));

    // Position via CSS custom properties
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
