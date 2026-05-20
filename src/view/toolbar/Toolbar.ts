import type {
  PenPreset,
  ToolbarPosition,
  ToolbarState,
  ToolbarCallbacks,
  ToolbarQueries,
  ActiveTool,
} from "./ToolbarTypes";
import { ToolbarButton } from "./ToolbarButton";
import { PresetStrip } from "./PresetStrip";
import { PresetManager } from "./PresetManager";
import { CustomizePopover } from "./CustomizePopover";
import { CurrentPenButton } from "./CurrentPenButton";
import { AutoMinimizer } from "./AutoMinimizer";
import { RecentColorStrip } from "./RecentColorStrip";
import { ColorStripManager } from "./ColorStripManager";
import { ColorWheelPopover } from "./ColorWheelPopover";
import { setIcon, Menu } from "obsidian";
import { DEFAULT_GRAIN_VALUE } from "../../stamp/GrainMapping";

/**
 * Main toolbar orchestrator. Replaces ToolPalette.
 */
export class Toolbar {
  private el: HTMLElement;
  private container: HTMLElement;
  private callbacks: ToolbarCallbacks;
  private queries: ToolbarQueries;
  private state: ToolbarState;
  private position: ToolbarPosition;
  private isDark: boolean;

  private presetManager: PresetManager;
  private presetStrip: PresetStrip | null = null;
  private popover: CustomizePopover | null = null;
  private autoMinimizer: AutoMinimizer;

  // Color strip
  private colorStripManager: ColorStripManager;
  private recentColorStrip: RecentColorStrip | null = null;
  private colorWheelPopover: ColorWheelPopover | null = null;
  private recentColorsCollapsed: boolean;
  private recentColorsToggleBtn: HTMLButtonElement | null = null;

  // When non-null, the popover is editing this preset without changing the active pen
  private editingPresetId: string | null = null;
  private editingState: ToolbarState | null = null;

  // Deferred MRU promotion: tracks the colorId when a popover opens
  private colorIdBeforePopover: string | null = null;

  // Buttons
  private undoBtn: ToolbarButton | null = null;
  private redoBtn: ToolbarButton | null = null;
  private eraserBtn: ToolbarButton | null = null;
  private lassoBtn: ToolbarButton | null = null;
  private pasteBtn: ToolbarButton | null = null;
  private addPageBtn: ToolbarButton | null = null;
  private docSettingsBtn: ToolbarButton | null = null;
  private processBtn: ToolbarButton | null = null;
  private processBtnBusy = false;
  private currentPenBtn: CurrentPenButton | null = null;

  constructor(
    container: HTMLElement,
    callbacks: ToolbarCallbacks,
    queries: ToolbarQueries,
    initialState: ToolbarState,
    presets: PenPreset[],
    position: ToolbarPosition,
    isDarkMode: boolean,
    savedColors: string[] = [],
    recentColors: string[] = [],
    recentColorsCollapsed = false
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.queries = queries;
    this.state = { ...initialState };
    this.position = position;
    this.isDark = isDarkMode;
    this.presetManager = new PresetManager(presets);
    this.colorStripManager = new ColorStripManager(savedColors, recentColors);
    this.recentColorsCollapsed = recentColorsCollapsed;

    this.el = container.createEl("div", {
      cls: "paper-toolbar",
      attr: { "data-position": position },
    });

    this.autoMinimizer = new AutoMinimizer((minimized) => {
      this.el.toggleClass("is-minimized", minimized);
      this.recentColorStrip?.setMinimized(minimized);
    });

    this.build();
    this.buildRecentColorStrip(container);
  }

  setAutoHide(enabled: boolean): void {
    this.autoMinimizer.setEnabled(enabled);
  }

  private build(): void {
    // Undo
    this.undoBtn = new ToolbarButton(this.el, "Undo", "paper-toolbar__btn--undo", () => {
      this.callbacks.onUndo();
      this.refreshUndoRedo();
    }, "undo-2");

    // Redo
    this.redoBtn = new ToolbarButton(this.el, "Redo", "paper-toolbar__btn--redo", () => {
      this.callbacks.onRedo();
      this.refreshUndoRedo();
    }, "redo-2");

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Current pen button
    this.currentPenBtn = new CurrentPenButton(
      this.el,
      this.state.colorId,
      this.state.penType,
      () => this.togglePopover()
    );

    // Recent colors collapse toggle (thin button between pen and presets)
    this.recentColorsToggleBtn = this.el.createEl("button", {
      cls: "paper-toolbar__recent-toggle",
      attr: { "aria-label": this.recentColorsCollapsed ? "Show recent colors" : "Hide recent colors" },
    });
    this.updateRecentToggleIcon();
    this.recentColorsToggleBtn.addEventListener("click", () => {
      this.recentColorsCollapsed = !this.recentColorsCollapsed;
      this.recentColorStrip?.setCollapsed(this.recentColorsCollapsed);
      this.updateRecentToggleIcon();
      this.persistRecentColors();
    });

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Preset strip
    this.presetStrip = new PresetStrip(
      this.el,
      this.presetManager.getPresets(),
      this.state.activePresetId,
      this.isDark,
      (presetId) => this.handlePresetClick(presetId),
      (presetId) => this.handlePresetLongPress(presetId),
      (presetId) => this.handlePresetContextMenu(presetId)
    );

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Eraser toggle
    this.eraserBtn = new ToolbarButton(this.el, "Eraser", "paper-toolbar__btn--eraser", () => {
      const newTool: ActiveTool = this.state.activeTool === "eraser" ? "pen" : "eraser";
      this.state.activeTool = newTool;
      this.eraserBtn?.setActive(newTool === "eraser");
      this.lassoBtn?.setActive(false);
      this.callbacks.onToolChange(newTool);
    }, "eraser");
    this.eraserBtn.setActive(this.state.activeTool === "eraser");

    // Lasso toggle
    this.lassoBtn = new ToolbarButton(this.el, "Lasso select", "paper-toolbar__btn--lasso", () => {
      const newTool: ActiveTool = this.state.activeTool === "lasso" ? "pen" : "lasso";
      this.state.activeTool = newTool;
      this.lassoBtn?.setActive(newTool === "lasso");
      this.eraserBtn?.setActive(false);
      this.callbacks.onToolChange(newTool);
    }, "lasso");
    this.lassoBtn.setActive(this.state.activeTool === "lasso");

    // Paste (hidden until clipboard has content)
    this.pasteBtn = new ToolbarButton(this.el, "Paste", "paper-toolbar__btn--paste", () => {
      this.callbacks.onPaste();
    }, "clipboard-paste");
    this.pasteBtn.el.style.display = "none";

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Add page
    this.addPageBtn = new ToolbarButton(this.el, "Add page", "paper-toolbar__btn--add-page", () => {
      this.callbacks.onAddPage();
    }, "file-plus");

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Process: re-OCR + regenerate thumbnail in one shot. Auto-regen was
    // dropped to avoid stealing main-thread time mid-stroke, so this is
    // the primary way to refresh derived artifacts for the current file.
    // Right-click / long-press opens a menu to run just one of the two.
    this.processBtn = new ToolbarButton(
      this.el,
      "Update transcript & thumbnail (long-press for options)",
      "paper-toolbar__btn--process",
      () => void this.runProcess("both"),
      "sparkles",
    );
    this.attachProcessContextMenu(this.processBtn.el);

    // Document settings (gear)
    this.docSettingsBtn = new ToolbarButton(this.el, "Document settings", "paper-toolbar__btn--doc-settings", () => {
      this.callbacks.onOpenDocumentSettings();
    }, "settings");

    // Minimized handle (hidden when not minimized)
    const handle = this.el.createEl("button", {
      cls: "paper-toolbar__handle",
      attr: { "aria-label": "Show toolbar" },
    });
    handle.textContent = "---";
    handle.addEventListener("click", () => {
      this.autoMinimizer.forceExpand();
    });

    this.refreshUndoRedo();
  }

  // ─── Process Button ─────────────────────────────────────────

  private async runProcess(
    mode: "both" | "ocr" | "thumbnail",
    options?: { forceOcr?: boolean; forceThumbnail?: boolean },
  ): Promise<void> {
    if (this.processBtnBusy) return;
    this.processBtnBusy = true;
    this.processBtn?.setDisabled(true);
    try {
      await this.callbacks.onProcessFile(mode, options);
    } finally {
      this.processBtnBusy = false;
      this.processBtn?.setDisabled(false);
    }
  }

  /** Show the per-action menu at the button anchor.
   *
   * Top half: incremental variants (only re-OCR / re-render dirty pages).
   * Bottom half: forced variants that bypass the per-page fp dirty check —
   * useful when a prior run wrote a bad transcript or to refresh against
   * a backend that's improved since the last run. */
  private showProcessMenu(x: number, y: number): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("Update transcript & thumbnail")
        .setIcon("sparkles")
        .onClick(() => void this.runProcess("both"));
    });
    menu.addItem((item) => {
      item.setTitle("Update transcript only (OCR)")
        .setIcon("text")
        .onClick(() => void this.runProcess("ocr"));
    });
    menu.addItem((item) => {
      item.setTitle("Update thumbnail only")
        .setIcon("image")
        .onClick(() => void this.runProcess("thumbnail"));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("Force re-run all OCR")
        .setIcon("refresh-ccw")
        .onClick(() => void this.runProcess("ocr", { forceOcr: true }));
    });
    menu.addItem((item) => {
      item.setTitle("Force regenerate thumbnail")
        .setIcon("refresh-ccw")
        .onClick(() => void this.runProcess("thumbnail", { forceThumbnail: true }));
    });
    menu.addItem((item) => {
      item.setTitle("Force re-run everything")
        .setIcon("refresh-ccw")
        .onClick(() => void this.runProcess("both", { forceOcr: true, forceThumbnail: true }));
    });
    menu.showAtPosition({ x, y });
  }

  /** Wire right-click + long-press triggers for the process menu. */
  private attachProcessContextMenu(el: HTMLElement): void {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showProcessMenu(e.clientX, e.clientY);
    });

    // Long-press for touch: hold 500ms without moving to trigger the menu.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let suppressTap = false;
    const cancel = (): void => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const { clientX: x, clientY: y } = t;
      suppressTap = false;
      timer = setTimeout(() => {
        suppressTap = true;
        this.showProcessMenu(x, y);
      }, 500);
    }, { passive: true });
    el.addEventListener("touchmove", cancel, { passive: true });
    el.addEventListener("touchcancel", cancel, { passive: true });
    el.addEventListener("touchend", (e) => {
      cancel();
      if (suppressTap) {
        // The long-press already fired; swallow the synthetic click.
        e.preventDefault();
        suppressTap = false;
      }
    });
  }

  /**
   * Toggle the "something needs updating" indicator on the process button.
   * The plugin calls this on vault modify / file open.
   */
  setProcessDirty(dirty: boolean): void {
    this.processBtn?.el.toggleClass("is-dirty", dirty);
  }

  // ─── Preset Interaction ─────────────────────────────────────

  private handlePresetClick(presetId: string): void {
    const preset = this.presetManager.getPreset(presetId);
    if (!preset) return;

    // If tapping the already-active preset, open its settings panel
    if (this.state.activePresetId === presetId && this.state.activeTool === "pen") {
      this.handlePresetContextMenu(presetId);
      return;
    }

    this.applyPreset(preset);
    this.state.activePresetId = presetId;

    this.currentPenBtn?.update(this.state.colorId, this.state.penType);
    this.callbacks.onPenSettingsChange({ ...this.state });

    // Promote linked color if preset has one
    if (preset.linkedColorId) {
      this.promoteAndPersist(preset.linkedColorId);
    }
  }

  private handlePresetLongPress(presetId: string): void {
    // Same as right-click: open settings without selecting the preset
    this.handlePresetContextMenu(presetId);
  }

  private handlePresetContextMenu(presetId: string): void {
    const preset = this.presetManager.getPreset(presetId);
    if (!preset) return;

    // Build an editing state from the preset without touching the active pen
    this.editingPresetId = presetId;
    this.editingState = {
      activeTool: "pen",
      activePresetId: presetId,
      penType: preset.penType,
      colorId: preset.linkedColorId ?? this.state.colorId,
      width: preset.width,
      smoothing: preset.smoothing,
      grain: preset.grain ?? DEFAULT_GRAIN_VALUE,
      inkPreset: preset.inkPreset ?? "standard",
      inkDepletion: preset.inkDepletion ?? 0,
      nibAngle: preset.nibAngle ?? this.state.nibAngle,
      nibThickness: preset.nibThickness ?? this.state.nibThickness,
      nibPressure: preset.nibPressure ?? this.state.nibPressure,
      useBarrelRotation: preset.useBarrelRotation ?? false,
      strokeScaling: preset.strokeScaling ?? "paper",
    };

    const anchor = this.presetStrip?.getButtonElement(presetId);
    this.openPopover(anchor ?? undefined);
  }

  private applyPreset(preset: PenPreset): void {
    this.state.penType = preset.penType;
    this.state.width = preset.width;
    this.state.smoothing = preset.smoothing;
    this.state.grain = preset.grain ?? DEFAULT_GRAIN_VALUE;
    this.state.inkPreset = preset.inkPreset ?? "standard";
    this.state.useBarrelRotation = preset.useBarrelRotation ?? false;
    this.state.strokeScaling = preset.strokeScaling ?? "paper";
    if (preset.nibAngle !== undefined) this.state.nibAngle = preset.nibAngle;
    if (preset.nibThickness !== undefined) this.state.nibThickness = preset.nibThickness;
    if (preset.nibPressure !== undefined) this.state.nibPressure = preset.nibPressure;

    // Only apply color if the preset has a linked color
    if (preset.linkedColorId) {
      this.state.colorId = preset.linkedColorId;
    }

    // Switch to pen tool when selecting a preset
    if (this.state.activeTool !== "pen") {
      this.state.activeTool = "pen";
      this.eraserBtn?.setActive(false);
      this.lassoBtn?.setActive(false);
      this.callbacks.onToolChange("pen");
    }
  }

  // ─── Popover ────────────────────────────────────────────────

  private togglePopover(): void {
    if (this.popover) {
      this.closePopover();
    } else {
      this.openPopover();
    }
  }

  private openPopover(anchor?: HTMLElement): void {
    if (this.popover) return;

    const isEditing = this.editingPresetId !== null;
    const popoverState = this.editingState ?? this.state;
    const popoverPresetId = this.editingPresetId ?? this.state.activePresetId;

    // Record color before opening for deferred MRU promotion
    this.colorIdBeforePopover = this.state.colorId;

    this.autoMinimizer.suspend();
    this.popover = new CustomizePopover(
      popoverState,
      this.position,
      this.isDark,
      popoverPresetId ? this.presetManager.getPreset(popoverPresetId) ?? null : null,
      anchor ?? this.currentPenBtn?.el ?? this.el,
      {
        onStateChange: (partial) => {
          if (isEditing && this.editingState && this.editingPresetId) {
            // Editing a preset without changing the active pen
            Object.assign(this.editingState, partial);
            const linkedColorId = this.popover?.getLinkedColorId() ?? undefined;
            const data = this.presetManager.createFromState(this.editingState, linkedColorId);
            this.presetManager.updatePreset(this.editingPresetId, data);
            const updated = this.presetManager.getPreset(this.editingPresetId);
            if (updated) this.presetStrip?.updateSinglePreset(updated);
            this.callbacks.onPresetSave(this.presetManager.toArray(), this.state.activePresetId);
            // If the edited preset is also the active pen, sync changes
            if (this.editingPresetId === this.state.activePresetId) {
              Object.assign(this.state, partial);
              this.currentPenBtn?.update(this.state.colorId, this.state.penType);
              this.callbacks.onPenSettingsChange({ ...this.state });
            }
          } else {
            Object.assign(this.state, partial);
            // Check if state matches any preset (including the currently active one)
            const match = this.presetManager.findMatchingPreset(this.state);
            if (match !== this.state.activePresetId) {
              this.state.activePresetId = match;
          
              const matchedPreset = match ? this.presetManager.getPreset(match) ?? null : null;
              this.popover?.setActivePreset(matchedPreset);
            }
            this.currentPenBtn?.update(this.state.colorId, this.state.penType);
            this.callbacks.onPenSettingsChange({ ...this.state });
          }
        },
        onLinkedColorChange: (linkedColorId) => {
          if (isEditing && this.editingPresetId) {
            this.presetManager.updatePreset(this.editingPresetId, { linkedColorId: linkedColorId ?? undefined });
            const updated = this.presetManager.getPreset(this.editingPresetId);
            if (updated) this.presetStrip?.updateSinglePreset(updated);
            this.callbacks.onPresetSave(this.presetManager.toArray(), this.state.activePresetId);
          }
        },
        onSaveAsNew: () => {
          const sourceState = this.editingState ?? this.state;
          const linkedColorId = this.popover?.getLinkedColorId() ?? undefined;
          const data = this.presetManager.createFromState(sourceState, linkedColorId);
          const added = this.presetManager.addPreset(data);
          if (added) {
            this.state.activePresetId = added.id;
            this.presetStrip?.updatePresets(this.presetManager.getPresets());
            this.callbacks.onPresetSave(this.presetManager.toArray(), added.id);
            this.popover?.setActivePreset(added);
          }
        },
        onDeletePreset: () => {
          const targetId = this.editingPresetId ?? this.state.activePresetId;
          if (!targetId) return;
          this.presetManager.deletePreset(targetId);
          if (targetId === this.state.activePresetId) {
            this.state.activePresetId = null;
          }
          this.presetStrip?.updatePresets(this.presetManager.getPresets());
          this.callbacks.onPresetSave(this.presetManager.toArray(), this.state.activePresetId);
          this.popover?.setActivePreset(null);
        },
        onPositionChange: (pos) => {
          this.setPosition(pos);
          this.callbacks.onPositionChange(pos);
        },
        onDismiss: () => {
          this.closePopover();
        },
      },
      isEditing
    );
  }

  private closePopover(): void {
    if (!this.popover) return;
    this.popover.destroy();
    this.popover = null;

    // Deferred MRU promotion: promote the final color if it changed
    if (this.colorIdBeforePopover !== null) {
      const isEditingNonActive = this.editingPresetId !== null
        && this.editingPresetId !== this.state.activePresetId;
      if (!isEditingNonActive && this.state.colorId !== this.colorIdBeforePopover) {
        this.promoteAndPersist(this.state.colorId);
      }
      this.colorIdBeforePopover = null;
    }

    this.editingPresetId = null;
    this.editingState = null;
    this.autoMinimizer.resume();
  }

  // ─── Recent Color Strip ────────────────────────────────────

  private buildRecentColorStrip(container: HTMLElement): void {
    this.recentColorStrip = new RecentColorStrip(
      container,
      this.colorStripManager.getSavedColors() as string[],
      this.colorStripManager.getRecentColors() as string[],
      this.recentColorsCollapsed,
      this.position,
      {
        onColorSelect: (colorId) => {
          this.state.colorId = colorId;
          // Check if the new color matches a preset
          const match = this.presetManager.findMatchingPreset(this.state);
          if (match !== this.state.activePresetId) {
            this.state.activePresetId = match;
        
          }
          this.currentPenBtn?.update(this.state.colorId, this.state.penType);
          this.callbacks.onPenSettingsChange({ ...this.state });
          // Immediate promotion — this is a deliberate choice
          this.promoteAndPersist(colorId);

          // Switch to pen tool if not already
          if (this.state.activeTool !== "pen") {
            this.state.activeTool = "pen";
            this.eraserBtn?.setActive(false);
            this.lassoBtn?.setActive(false);
            this.callbacks.onToolChange("pen");
          }
        },
        onPinColor: (colorId) => {
          this.colorStripManager.pinColor(colorId);
          this.refreshRecentStrip();
          this.persistRecentColors();
        },
        onUnpinColor: (colorId) => {
          this.colorStripManager.unpinColor(colorId);
          this.refreshRecentStrip();
          this.persistRecentColors();
        },
        onColorRemove: (colorId) => {
          this.colorStripManager.remove(colorId);
          this.refreshRecentStrip();
          this.persistRecentColors();
        },
        onOpenColorPicker: (anchor) => {
          this.openColorWheelPopover(anchor);
        },
      }
    );

    // Position the strip after it's been added to the DOM
    requestAnimationFrame(() => this.positionRecentStrip());
  }

  private updateRecentToggleIcon(): void {
    if (!this.recentColorsToggleBtn) return;
    this.recentColorsToggleBtn.empty();
    const isVertical = this.position === "left" || this.position === "right";
    if (isVertical) {
      setIcon(this.recentColorsToggleBtn, this.recentColorsCollapsed ? "chevron-right" : "chevron-left");
    } else {
      setIcon(this.recentColorsToggleBtn, this.recentColorsCollapsed ? "chevron-down" : "chevron-up");
    }
    this.recentColorsToggleBtn.setAttribute(
      "aria-label",
      this.recentColorsCollapsed ? "Show recent colors" : "Hide recent colors"
    );
  }

  /**
   * Position the recent color strip so its parallel-to-toolbar edge sits
   * just outside the toolbar and the perpendicular edge aligns with the
   * current pen button. Both axes are written every call so previous-position
   * values never leak across a `setPosition` change.
   */
  private positionRecentStrip(): void {
    if (!this.recentColorStrip || !this.currentPenBtn) return;
    const stripEl = this.recentColorStrip.el;
    const containerRect = this.container.getBoundingClientRect();
    const toolbarRect = this.el.getBoundingClientRect();
    const penRect = this.currentPenBtn.el.getBoundingClientRect();
    const gap = 8;

    stripEl.style.top = "";
    stripEl.style.bottom = "";
    stripEl.style.left = "";
    stripEl.style.right = "";

    switch (this.position) {
      case "left":
        stripEl.style.left = `${toolbarRect.right - containerRect.left + gap}px`;
        stripEl.style.top = `${penRect.top - containerRect.top}px`;
        break;
      case "right":
        stripEl.style.right = `${containerRect.right - toolbarRect.left + gap}px`;
        stripEl.style.top = `${penRect.top - containerRect.top}px`;
        break;
      case "top":
        stripEl.style.top = `${toolbarRect.bottom - containerRect.top + gap}px`;
        stripEl.style.left = `${penRect.left - containerRect.left}px`;
        break;
      case "bottom":
        stripEl.style.bottom = `${containerRect.bottom - toolbarRect.top + gap}px`;
        stripEl.style.left = `${penRect.left - containerRect.left}px`;
        break;
    }
  }

  private openColorWheelPopover(anchor: HTMLElement): void {
    if (this.colorWheelPopover) return;
    this.autoMinimizer.suspend();
    // Record color before opening for deferred promotion
    this.colorIdBeforePopover = this.state.colorId;

    this.colorWheelPopover = new ColorWheelPopover(
      this.state.colorId,
      this.position,
      anchor,
      {
        onColorChange: (colorId) => {
          // Live preview — update the pen but don't promote yet
          this.state.colorId = colorId;
          const match = this.presetManager.findMatchingPreset(this.state);
          if (match !== this.state.activePresetId) {
            this.state.activePresetId = match;
        
          }
          this.currentPenBtn?.update(this.state.colorId, this.state.penType);
          this.callbacks.onPenSettingsChange({ ...this.state });
        },
        onPinColor: (colorId) => {
          this.colorStripManager.pinColor(colorId);
          this.refreshRecentStrip();
          this.persistRecentColors();
        },
        onUnpinColor: (colorId) => {
          this.colorStripManager.unpinColor(colorId);
          this.refreshRecentStrip();
          this.persistRecentColors();
        },
        onDismiss: () => {
          this.closeColorWheelPopover();
        },
      },
      (colorId) => this.colorStripManager.isSaved(colorId)
    );
  }

  private closeColorWheelPopover(): void {
    if (!this.colorWheelPopover) return;
    this.colorWheelPopover.destroy();
    this.colorWheelPopover = null;

    // Deferred MRU promotion
    if (this.colorIdBeforePopover !== null && this.state.colorId !== this.colorIdBeforePopover) {
      this.promoteAndPersist(this.state.colorId);
    }
    this.colorIdBeforePopover = null;
    this.autoMinimizer.resume();
  }

  // ─── MRU Helpers ───────────────────────────────────────────

  private promoteAndPersist(colorId: string): void {
    if (this.colorStripManager.promote(colorId)) {
      this.refreshRecentStrip();
      this.persistRecentColors();
    }
  }

  private refreshRecentStrip(): void {
    this.recentColorStrip?.updateColors(
      this.colorStripManager.getSavedColors() as string[],
      this.colorStripManager.getRecentColors() as string[]
    );
  }

  private persistRecentColors(): void {
    this.callbacks.onRecentColorsChange(
      this.colorStripManager.toSavedArray(),
      this.colorStripManager.toRecentArray(),
      this.recentColorsCollapsed
    );
  }

  // ─── Public API ─────────────────────────────────────────────

  setState(partial: Partial<ToolbarState>): void {
    Object.assign(this.state, partial);

    if (partial.activeTool !== undefined) {
      this.eraserBtn?.setActive(this.state.activeTool === "eraser");
      this.lassoBtn?.setActive(this.state.activeTool === "lasso");
    }

    if (partial.activePresetId !== undefined) {

    } else {
      // Check if manual changes now match a preset
      const match = this.presetManager.findMatchingPreset(this.state);
      if (match !== this.state.activePresetId) {
        this.state.activePresetId = match;
    
      }
    }

    if (partial.colorId !== undefined || partial.penType !== undefined) {
      this.currentPenBtn?.update(this.state.colorId, this.state.penType);
    }

  }

  setDarkMode(isDark: boolean): void {
    if (this.isDark === isDark) return;
    this.isDark = isDark;
    this.presetStrip?.setDarkMode(isDark);
    this.popover?.setDarkMode(isDark);
  }

  setPosition(position: ToolbarPosition): void {
    this.position = position;
    this.el.dataset.position = position;
    this.popover?.setPosition(position);
    this.recentColorStrip?.setPosition(position);
    this.updateRecentToggleIcon();
    requestAnimationFrame(() => this.positionRecentStrip());
  }

  showPasteButton(visible: boolean, count = 0): void {
    if (!this.pasteBtn) return;
    this.pasteBtn.el.style.display = visible ? "" : "none";

    // Update or create badge
    let badge = this.pasteBtn.el.querySelector(".paper-toolbar__badge") as HTMLElement | null;
    if (visible && count > 0) {
      if (!badge) {
        badge = this.pasteBtn.el.createEl("span", { cls: "paper-toolbar__badge" });
      }
      badge.textContent = String(count);
    } else if (badge) {
      badge.remove();
    }
  }

  refreshUndoRedo(): void {
    this.undoBtn?.setDisabled(!this.queries.canUndo());
    this.redoBtn?.setDisabled(!this.queries.canRedo());
  }

  notifyStrokeStart(): void {
    this.autoMinimizer.notifyStrokeStart();
  }

  notifyStrokeEnd(): void {
    this.autoMinimizer.notifyStrokeEnd();
  }

  updatePresets(presets: PenPreset[], activePresetId: string | null): void {
    this.presetManager = new PresetManager(presets);
    this.state.activePresetId = activePresetId;
    this.presetStrip?.updatePresets(presets);
  }

  getDocSettingsAnchor(): HTMLElement {
    return this.docSettingsBtn!.el;
  }

  destroy(): void {
    this.closePopover();
    this.closeColorWheelPopover();
    this.autoMinimizer.destroy();
    this.presetStrip?.destroy();
    this.recentColorStrip?.destroy();
    this.undoBtn?.destroy();
    this.redoBtn?.destroy();
    this.eraserBtn?.destroy();
    this.lassoBtn?.destroy();
    this.pasteBtn?.destroy();
    this.addPageBtn?.destroy();
    this.docSettingsBtn?.destroy();
    this.currentPenBtn?.destroy();
    this.recentColorsToggleBtn?.remove();
    this.el.remove();
  }
}
