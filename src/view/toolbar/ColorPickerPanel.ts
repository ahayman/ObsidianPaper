/**
 * Color picker panel with two modes:
 *   - Simple: grid of predefined colors from the extended palette
 *   - Spectrum: two HSL pickers (one for light theme, one for dark theme)
 *
 * All colors are represented as light/dark pairs. Selecting a color emits
 * a colorId string (semantic ID for palette colors, dual-hex for custom).
 */

import { EXTENDED_PALETTE, EXTENDED_PALETTE_CONTRAST } from "../../color/ExtendedPalette";
import type { PaletteMode } from "../../color/ExtendedPalette";
import { parseColorId, encodeDualHex, isDualHex, hexToHsl, hslToHex } from "../../color/ColorUtils";

type PickerMode = "simple" | "spectrum";

export interface ColorPickerCallbacks {
  onColorSelect: (colorId: string) => void;
}

/**
 * Standalone color picker panel, intended to be mounted inside the
 * CustomizePopover's color section.
 */
export class ColorPickerPanel {
  readonly el: HTMLElement;
  private mode: PickerMode = "simple";
  private selectedColorId: string;
  private callbacks: ColorPickerCallbacks;

  // Tab elements
  private simpleTab!: HTMLElement;
  private spectrumTab!: HTMLElement;

  // Mode containers
  private simpleContainer!: HTMLElement;
  private spectrumContainer!: HTMLElement;

  // Simple mode state
  private paletteMode: PaletteMode = "contrast";
  private swatchEls: Map<string, HTMLElement> = new Map();

  // Spectrum mode state
  private lightHue = 0;
  private lightSat = 1;
  private lightLit = 0.5;
  private darkHue = 0;
  private darkSat = 1;
  private darkLit = 0.5;
  private lightChosen = false;
  private darkChosen = false;

  // Spectrum canvases
  private lightSlCanvas: HTMLCanvasElement | null = null;
  private lightHueCanvas: HTMLCanvasElement | null = null;
  private darkSlCanvas: HTMLCanvasElement | null = null;
  private darkHueCanvas: HTMLCanvasElement | null = null;
  private previewSwatch: HTMLElement | null = null;
  private selectBtn: HTMLButtonElement | null = null;
  private lightHexInput: HTMLInputElement | null = null;
  private darkHexInput: HTMLInputElement | null = null;

  constructor(
    parent: HTMLElement,
    currentColorId: string,
    callbacks: ColorPickerCallbacks
  ) {
    this.selectedColorId = currentColorId;
    this.callbacks = callbacks;

    this.el = parent.createEl("div", { cls: "paper-color-picker" });
    this.buildTabs();
    this.buildSimpleMode();
    this.buildSpectrumMode();
    this.showMode(this.mode);
  }

  // ─── Tabs ───────────────────────────────────────────────────

  private buildTabs(): void {
    const tabs = this.el.createEl("div", { cls: "paper-color-picker__tabs" });

    this.simpleTab = tabs.createEl("button", {
      cls: "paper-color-picker__tab is-active",
      text: "Simple",
    });
    this.spectrumTab = tabs.createEl("button", {
      cls: "paper-color-picker__tab",
      text: "Spectrum",
    });

    this.simpleTab.addEventListener("click", () => this.showMode("simple"));
    this.spectrumTab.addEventListener("click", () => this.showMode("spectrum"));
  }

  private showMode(mode: PickerMode): void {
    this.mode = mode;
    this.simpleTab.toggleClass("is-active", mode === "simple");
    this.spectrumTab.toggleClass("is-active", mode === "spectrum");
    this.simpleContainer.toggleClass("is-hidden", mode !== "simple");
    this.spectrumContainer.toggleClass("is-hidden", mode !== "spectrum");

    if (mode === "spectrum") {
      // Render canvases after becoming visible
      requestAnimationFrame(() => this.renderAllSpectrumCanvases());
    }
  }

  // ─── Simple Mode ────────────────────────────────────────────

  private buildSimpleMode(): void {
    this.simpleContainer = this.el.createEl("div", { cls: "paper-color-picker__simple" });

    // Palette mode toggle
    const toggle = this.simpleContainer.createEl("div", { cls: "paper-color-picker__mode-toggle" });
    const contrastBtn = toggle.createEl("button", {
      cls: "paper-color-picker__mode-btn is-active",
      text: "Contrast",
      attr: { "aria-label": "Contrast-matched colors" },
    });
    const brightnessBtn = toggle.createEl("button", {
      cls: "paper-color-picker__mode-btn",
      text: "Brightness",
      attr: { "aria-label": "Brightness-matched colors" },
    });

    contrastBtn.addEventListener("click", () => {
      if (this.paletteMode === "contrast") return;
      this.paletteMode = "contrast";
      contrastBtn.addClass("is-active");
      brightnessBtn.removeClass("is-active");
      this.rebuildSwatchGrid();
    });
    brightnessBtn.addEventListener("click", () => {
      if (this.paletteMode === "brightness") return;
      this.paletteMode = "brightness";
      brightnessBtn.addClass("is-active");
      contrastBtn.removeClass("is-active");
      this.rebuildSwatchGrid();
    });

    // Swatch grid
    this.simpleContainer.createEl("div", { cls: "paper-color-picker__grid" });
    this.rebuildSwatchGrid();
  }

  private rebuildSwatchGrid(): void {
    const grid = this.simpleContainer.querySelector(".paper-color-picker__grid");
    if (!grid) return;
    grid.empty();
    this.swatchEls.clear();

    const palette =
      this.paletteMode === "contrast"
        ? EXTENDED_PALETTE_CONTRAST
        : EXTENDED_PALETTE;

    for (const color of palette) {
      const dualHex = encodeDualHex(color.light, color.dark);
      const swatch = (grid as HTMLElement).createEl("button", {
        cls: "paper-popover__color-swatch",
        attr: { "aria-label": color.name },
      });
      swatch.setCssProps({
        "--swatch-color-dark": color.dark,
        "--swatch-color-light": color.light,
      });
      if (dualHex === this.selectedColorId) swatch.addClass("is-active");
      this.swatchEls.set(dualHex, swatch);

      swatch.addEventListener("click", () => {
        this.selectSimpleColor(dualHex);
      });
    }
  }

  private selectSimpleColor(colorId: string): void {
    for (const [, el] of this.swatchEls) el.removeClass("is-active");
    const swatch = this.swatchEls.get(colorId);
    if (swatch) swatch.addClass("is-active");
    this.selectedColorId = colorId;
    this.callbacks.onColorSelect(colorId);
  }

  // ─── Spectrum Mode ──────────────────────────────────────────

  private buildSpectrumMode(): void {
    this.spectrumContainer = this.el.createEl("div", { cls: "paper-color-picker__spectrum is-hidden" });

    // Two-column pickers
    const pickers = this.spectrumContainer.createEl("div", { cls: "paper-color-picker__pickers" });

    // Light theme picker
    const lightCol = pickers.createEl("div", { cls: "paper-color-picker__picker-col" });
    lightCol.createEl("div", { cls: "paper-color-picker__picker-label", text: "Light theme" });
    this.lightSlCanvas = lightCol.createEl("canvas", { cls: "paper-color-picker__sl-canvas" });
    this.lightHueCanvas = lightCol.createEl("canvas", { cls: "paper-color-picker__hue-canvas" });
    const lightHexRow = lightCol.createEl("div", { cls: "paper-color-picker__hex-row" });
    lightHexRow.createEl("span", { cls: "paper-color-picker__hex-prefix", text: "#" });
    this.lightHexInput = lightHexRow.createEl("input", {
      cls: "paper-color-picker__hex-input",
      type: "text",
      attr: { placeholder: "Hex", maxlength: "7" },
    });

    // Dark theme picker
    const darkCol = pickers.createEl("div", { cls: "paper-color-picker__picker-col" });
    darkCol.createEl("div", { cls: "paper-color-picker__picker-label", text: "Dark theme" });
    this.darkSlCanvas = darkCol.createEl("canvas", { cls: "paper-color-picker__sl-canvas" });
    this.darkHueCanvas = darkCol.createEl("canvas", { cls: "paper-color-picker__hue-canvas" });
    const darkHexRow = darkCol.createEl("div", { cls: "paper-color-picker__hex-row" });
    darkHexRow.createEl("span", { cls: "paper-color-picker__hex-prefix", text: "#" });
    this.darkHexInput = darkHexRow.createEl("input", {
      cls: "paper-color-picker__hex-input",
      type: "text",
      attr: { placeholder: "Hex", maxlength: "7" },
    });

    // Preview + Select
    const previewRow = this.spectrumContainer.createEl("div", { cls: "paper-color-picker__preview-row" });
    this.previewSwatch = previewRow.createEl("div", { cls: "paper-color-picker__preview-swatch" });
    this.selectBtn = previewRow.createEl("button", {
      cls: "paper-color-picker__select-btn",
      text: "Select",
      attr: { disabled: "true" },
    });

    // Wire events
    this.wireCanvasEvents(this.lightSlCanvas, this.lightHueCanvas, "light");
    this.wireCanvasEvents(this.darkSlCanvas, this.darkHueCanvas, "dark");
    this.wireHexInput(this.lightHexInput, "light");
    this.wireHexInput(this.darkHexInput, "dark");
    this.selectBtn.addEventListener("click", () => this.confirmSpectrum());

    // If current color is already a dual or semantic color, pre-fill the pickers
    this.initSpectrumFromCurrent();
  }

  private initSpectrumFromCurrent(): void {
    const { light, dark } = parseColorId(this.selectedColorId);
    const [lh, ls, ll] = hexToHsl(light);
    const [dh, ds, dl] = hexToHsl(dark);

    this.lightHue = lh;
    this.lightSat = ls;
    this.lightLit = ll;
    this.lightChosen = true;
    if (this.lightHexInput) this.lightHexInput.value = light.replace("#", "");

    this.darkHue = dh;
    this.darkSat = ds;
    this.darkLit = dl;
    this.darkChosen = true;
    if (this.darkHexInput) this.darkHexInput.value = dark.replace("#", "");

    this.updatePreview();
  }

  // ─── Canvas Rendering ──────────────────────────────────────

  private renderAllSpectrumCanvases(): void {
    if (this.lightSlCanvas) this.renderSlCanvas(this.lightSlCanvas, this.lightHue, this.lightSat, this.lightLit, this.lightChosen);
    if (this.lightHueCanvas) this.renderHueCanvas(this.lightHueCanvas, this.lightHue);
    if (this.darkSlCanvas) this.renderSlCanvas(this.darkSlCanvas, this.darkHue, this.darkSat, this.darkLit, this.darkChosen);
    if (this.darkHueCanvas) this.renderHueCanvas(this.darkHueCanvas, this.darkHue);
  }

  private renderSlCanvas(
    canvas: HTMLCanvasElement,
    hue: number,
    sat: number,
    lit: number,
    chosen: boolean
  ): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * window.devicePixelRatio);
    const h = Math.round(rect.height * window.devicePixelRatio);
    if (w === 0 || h === 0) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw SL plane: X = saturation (0→1), Y = lightness (1→0, top=light)
    const imgData = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const l = 1 - y / (h - 1); // top = light
      for (let x = 0; x < w; x++) {
        const s = x / (w - 1);
        const hex = hslToHex(hue, s, l);
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const i = (y * w + x) * 4;
        imgData.data[i] = r;
        imgData.data[i + 1] = g;
        imgData.data[i + 2] = b;
        imgData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw crosshair if chosen
    if (chosen) {
      const cx = sat * (w - 1);
      const cy = (1 - lit) * (h - 1);
      ctx.strokeStyle = lit > 0.5 ? "#000" : "#fff";
      ctx.lineWidth = 2 * window.devicePixelRatio;
      ctx.beginPath();
      ctx.arc(cx, cy, 5 * window.devicePixelRatio, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private renderHueCanvas(canvas: HTMLCanvasElement, currentHue: number): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * window.devicePixelRatio);
    const h = Math.round(rect.height * window.devicePixelRatio);
    if (w === 0 || h === 0) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Horizontal hue gradient
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) {
      grad.addColorStop(i / 6, hslToHex((i / 6) * 360, 1, 0.5));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Indicator line
    const cx = (currentHue / 360) * (w - 1);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1 * window.devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
  }

  // ─── Canvas Events ─────────────────────────────────────────

  private wireCanvasEvents(
    slCanvas: HTMLCanvasElement,
    hueCanvas: HTMLCanvasElement,
    side: "light" | "dark"
  ): void {
    // SL plane interaction
    const handleSl = (e: PointerEvent) => {
      const rect = slCanvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const s = x;
      const l = 1 - y;

      if (side === "light") {
        this.lightSat = s;
        this.lightLit = l;
        this.lightChosen = true;
        this.renderSlCanvas(slCanvas, this.lightHue, s, l, true);
        if (this.lightHexInput) this.lightHexInput.value = hslToHex(this.lightHue, s, l).replace("#", "");
      } else {
        this.darkSat = s;
        this.darkLit = l;
        this.darkChosen = true;
        this.renderSlCanvas(slCanvas, this.darkHue, s, l, true);
        if (this.darkHexInput) this.darkHexInput.value = hslToHex(this.darkHue, s, l).replace("#", "");
      }
      this.updatePreview();
    };

    let slDragging = false;
    slCanvas.addEventListener("pointerdown", (e) => {
      slDragging = true;
      slCanvas.setPointerCapture(e.pointerId);
      handleSl(e);
    });
    slCanvas.addEventListener("pointermove", (e) => {
      if (slDragging) handleSl(e);
    });
    slCanvas.addEventListener("pointerup", () => { slDragging = false; });
    slCanvas.addEventListener("pointercancel", () => { slDragging = false; });

    // Hue strip interaction
    const handleHue = (e: PointerEvent) => {
      const rect = hueCanvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const hue = x * 360;

      if (side === "light") {
        this.lightHue = hue;
        this.renderSlCanvas(slCanvas, hue, this.lightSat, this.lightLit, this.lightChosen);
        this.renderHueCanvas(hueCanvas, hue);
        if (this.lightChosen && this.lightHexInput) {
          this.lightHexInput.value = hslToHex(hue, this.lightSat, this.lightLit).replace("#", "");
        }
      } else {
        this.darkHue = hue;
        this.renderSlCanvas(slCanvas, hue, this.darkSat, this.darkLit, this.darkChosen);
        this.renderHueCanvas(hueCanvas, hue);
        if (this.darkChosen && this.darkHexInput) {
          this.darkHexInput.value = hslToHex(hue, this.darkSat, this.darkLit).replace("#", "");
        }
      }
      this.updatePreview();
    };

    let hueDragging = false;
    hueCanvas.addEventListener("pointerdown", (e) => {
      hueDragging = true;
      hueCanvas.setPointerCapture(e.pointerId);
      handleHue(e);
    });
    hueCanvas.addEventListener("pointermove", (e) => {
      if (hueDragging) handleHue(e);
    });
    hueCanvas.addEventListener("pointerup", () => { hueDragging = false; });
    hueCanvas.addEventListener("pointercancel", () => { hueDragging = false; });
  }

  // ─── Hex Input Events ──────────────────────────────────────

  private wireHexInput(input: HTMLInputElement, side: "light" | "dark"): void {
    input.addEventListener("change", () => {
      let hex = input.value.trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (!/^#[0-9A-Fa-f]{3,6}$/.test(hex)) return;

      // Normalize shorthand
      if (hex.length === 4) {
        hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      }

      const [h, s, l] = hexToHsl(hex);
      if (side === "light") {
        this.lightHue = h;
        this.lightSat = s;
        this.lightLit = l;
        this.lightChosen = true;
        if (this.lightSlCanvas) this.renderSlCanvas(this.lightSlCanvas, h, s, l, true);
        if (this.lightHueCanvas) this.renderHueCanvas(this.lightHueCanvas, h);
      } else {
        this.darkHue = h;
        this.darkSat = s;
        this.darkLit = l;
        this.darkChosen = true;
        if (this.darkSlCanvas) this.renderSlCanvas(this.darkSlCanvas, h, s, l, true);
        if (this.darkHueCanvas) this.renderHueCanvas(this.darkHueCanvas, h);
      }
      this.updatePreview();
    });
  }

  // ─── Preview & Confirm ─────────────────────────────────────

  private updatePreview(): void {
    if (!this.previewSwatch || !this.selectBtn) return;

    const lightHex = this.lightChosen
      ? hslToHex(this.lightHue, this.lightSat, this.lightLit)
      : "#888888";
    const darkHex = this.darkChosen
      ? hslToHex(this.darkHue, this.darkSat, this.darkLit)
      : "#888888";

    this.previewSwatch.setCssProps({
      "--preview-light": lightHex,
      "--preview-dark": darkHex,
    });

    const ready = this.lightChosen && this.darkChosen;
    if (ready) {
      this.selectBtn.removeAttribute("disabled");
    } else {
      this.selectBtn.setAttribute("disabled", "true");
    }
  }

  private confirmSpectrum(): void {
    if (!this.lightChosen || !this.darkChosen) return;

    const lightHex = hslToHex(this.lightHue, this.lightSat, this.lightLit);
    const darkHex = hslToHex(this.darkHue, this.darkSat, this.darkLit);
    const colorId = encodeDualHex(lightHex, darkHex);

    // Deselect simple swatches
    for (const [, el] of this.swatchEls) el.removeClass("is-active");

    this.selectedColorId = colorId;
    this.callbacks.onColorSelect(colorId);
  }

  // ─── Public API ─────────────────────────────────────────────

  setSelectedColor(colorId: string): void {
    // Update simple mode selection — swatches are keyed by dual-hex
    for (const [, el] of this.swatchEls) el.removeClass("is-active");

    // If it's a dual-hex, look up directly; otherwise try encoding it
    let lookupKey = colorId;
    if (!isDualHex(colorId)) {
      // Single hex — won't match a palette swatch, but still set it
      lookupKey = colorId;
    }
    const swatch = this.swatchEls.get(lookupKey);
    if (swatch) swatch.addClass("is-active");
    this.selectedColorId = colorId;

    // Update spectrum pickers from the new color
    this.initSpectrumFromCurrent();
  }

  destroy(): void {
    this.el.remove();
  }
}
