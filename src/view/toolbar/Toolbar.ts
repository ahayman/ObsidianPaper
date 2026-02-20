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
import { AutoMinimizer } from "./AutoMinimizer";

/**
 * Main toolbar orchestrator. Replaces ToolPalette.
 */
export class Toolbar {
  private el: HTMLElement;
  private callbacks: ToolbarCallbacks;
  private queries: ToolbarQueries;
  private state: ToolbarState;
  private position: ToolbarPosition;
  private isDark: boolean;

  private presetManager: PresetManager;
  private presetStrip: PresetStrip | null = null;
  private popover: CustomizePopover | null = null;
  private autoMinimizer: AutoMinimizer;

  // Buttons
  private undoBtn: ToolbarButton | null = null;
  private redoBtn: ToolbarButton | null = null;
  private eraserBtn: ToolbarButton | null = null;
  private addPageBtn: ToolbarButton | null = null;
  private moreBtn: ToolbarButton | null = null;

  constructor(
    container: HTMLElement,
    callbacks: ToolbarCallbacks,
    queries: ToolbarQueries,
    initialState: ToolbarState,
    presets: PenPreset[],
    position: ToolbarPosition,
    isDarkMode: boolean
  ) {
    this.callbacks = callbacks;
    this.queries = queries;
    this.state = { ...initialState };
    this.position = position;
    this.isDark = isDarkMode;
    this.presetManager = new PresetManager(presets);

    this.el = container.createEl("div", {
      cls: "paper-toolbar",
      attr: { "data-position": position },
    });

    this.autoMinimizer = new AutoMinimizer((minimized) => {
      this.el.toggleClass("is-minimized", minimized);
    });

    this.build();
  }

  private build(): void {
    // Undo
    this.undoBtn = new ToolbarButton(this.el, "Undo", "paper-toolbar__btn--undo", () => {
      this.callbacks.onUndo();
      this.refreshUndoRedo();
    });

    // Redo
    this.redoBtn = new ToolbarButton(this.el, "Redo", "paper-toolbar__btn--redo", () => {
      this.callbacks.onRedo();
      this.refreshUndoRedo();
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
      (presetId) => this.handlePresetLongPress(presetId)
    );

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Eraser toggle
    this.eraserBtn = new ToolbarButton(this.el, "Eraser", "paper-toolbar__btn--eraser", () => {
      const newTool: ActiveTool = this.state.activeTool === "eraser" ? "pen" : "eraser";
      this.state.activeTool = newTool;
      this.eraserBtn?.setActive(newTool === "eraser");
      this.callbacks.onToolChange(newTool);
    });
    this.eraserBtn.setActive(this.state.activeTool === "eraser");

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Add page
    this.addPageBtn = new ToolbarButton(this.el, "+ Page", "paper-toolbar__btn--add-page", () => {
      this.callbacks.onAddPage();
    });

    // More / Customize
    this.moreBtn = new ToolbarButton(this.el, "More", "paper-toolbar__btn--more", () => {
      this.togglePopover();
    });

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

  // ─── Preset Interaction ─────────────────────────────────────

  private handlePresetClick(presetId: string): void {
    const preset = this.presetManager.getPreset(presetId);
    if (!preset) return;

    // If tapping the already-active preset, open its settings panel
    if (this.state.activePresetId === presetId && this.state.activeTool === "pen") {
      this.openPopover();
      return;
    }

    this.applyPreset(preset);
    this.state.activePresetId = presetId;
    this.presetStrip?.setActivePreset(presetId);
    this.callbacks.onPenSettingsChange({ ...this.state });
  }

  private handlePresetLongPress(presetId: string): void {
    const preset = this.presetManager.getPreset(presetId);
    if (!preset) return;

    // Apply the preset first
    this.applyPreset(preset);
    this.state.activePresetId = presetId;
    this.presetStrip?.setActivePreset(presetId);
    this.callbacks.onPenSettingsChange({ ...this.state });

    // Open popover anchored to that preset
    this.openPopover();
  }

  private applyPreset(preset: PenPreset): void {
    this.state.penType = preset.penType;
    this.state.colorId = preset.colorId;
    this.state.width = preset.width;
    this.state.smoothing = preset.smoothing;
    if (preset.nibAngle !== undefined) this.state.nibAngle = preset.nibAngle;
    if (preset.nibThickness !== undefined) this.state.nibThickness = preset.nibThickness;
    if (preset.nibPressure !== undefined) this.state.nibPressure = preset.nibPressure;

    // Switch to pen tool when selecting a preset
    if (this.state.activeTool !== "pen") {
      this.state.activeTool = "pen";
      this.eraserBtn?.setActive(false);
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

  private openPopover(): void {
    if (this.popover) return;

    this.autoMinimizer.suspend();
    this.popover = new CustomizePopover(
      this.state,
      this.position,
      this.isDark,
      this.state.activePresetId ? this.presetManager.getPreset(this.state.activePresetId) ?? null : null,
      this.el,
      {
        onStateChange: (partial) => {
          Object.assign(this.state, partial);
          // Check if current state still matches active preset
          const match = this.presetManager.findMatchingPreset(this.state);
          if (match !== this.state.activePresetId) {
            this.state.activePresetId = match;
            this.presetStrip?.setActivePreset(match);
          }
          this.callbacks.onPenSettingsChange({ ...this.state });
        },
        onSaveAsNew: () => {
          const data = this.presetManager.createFromState(this.state);
          const added = this.presetManager.addPreset(data);
          if (added) {
            this.state.activePresetId = added.id;
            this.presetStrip?.updatePresets(this.presetManager.getPresets(), added.id);
            this.callbacks.onPresetSave(this.presetManager.toArray(), added.id);
            this.popover?.setActivePreset(added);
          }
        },
        onUpdatePreset: () => {
          if (!this.state.activePresetId) return;
          const data = this.presetManager.createFromState(this.state);
          this.presetManager.updatePreset(this.state.activePresetId, data);
          this.presetStrip?.updatePresets(this.presetManager.getPresets(), this.state.activePresetId);
          this.callbacks.onPresetSave(this.presetManager.toArray(), this.state.activePresetId);
        },
        onDeletePreset: () => {
          if (!this.state.activePresetId) return;
          this.presetManager.deletePreset(this.state.activePresetId);
          this.state.activePresetId = null;
          this.presetStrip?.updatePresets(this.presetManager.getPresets(), null);
          this.callbacks.onPresetSave(this.presetManager.toArray(), null);
          this.popover?.setActivePreset(null);
        },
        onPositionChange: (pos) => {
          this.setPosition(pos);
          this.callbacks.onPositionChange(pos);
        },
        onDismiss: () => {
          this.closePopover();
        },
      }
    );
  }

  private closePopover(): void {
    if (!this.popover) return;
    this.popover.destroy();
    this.popover = null;
    this.autoMinimizer.resume();
  }

  // ─── Public API ─────────────────────────────────────────────

  setState(partial: Partial<ToolbarState>): void {
    Object.assign(this.state, partial);

    if (partial.activeTool !== undefined) {
      this.eraserBtn?.setActive(this.state.activeTool === "eraser");
    }

    if (partial.activePresetId !== undefined) {
      this.presetStrip?.setActivePreset(this.state.activePresetId);
    } else {
      // Check if manual changes now match a preset
      const match = this.presetManager.findMatchingPreset(this.state);
      if (match !== this.state.activePresetId) {
        this.state.activePresetId = match;
        this.presetStrip?.setActivePreset(match);
      }
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
    this.presetStrip?.updatePresets(presets, activePresetId);
  }

  destroy(): void {
    this.closePopover();
    this.autoMinimizer.destroy();
    this.presetStrip?.destroy();
    this.undoBtn?.destroy();
    this.redoBtn?.destroy();
    this.eraserBtn?.destroy();
    this.addPageBtn?.destroy();
    this.moreBtn?.destroy();
    this.el.remove();
  }
}
