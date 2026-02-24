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
import { DEFAULT_GRAIN_VALUE } from "../../stamp/GrainMapping";

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

  // When non-null, the popover is editing this preset without changing the active pen
  private editingPresetId: string | null = null;
  private editingState: ToolbarState | null = null;

  // Buttons
  private undoBtn: ToolbarButton | null = null;
  private redoBtn: ToolbarButton | null = null;
  private eraserBtn: ToolbarButton | null = null;
  private addPageBtn: ToolbarButton | null = null;
  private docSettingsBtn: ToolbarButton | null = null;
  private currentPenBtn: CurrentPenButton | null = null;

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
    // Current pen button
    this.currentPenBtn = new CurrentPenButton(
      this.el,
      this.state.colorId,
      this.state.penType,
      () => this.togglePopover()
    );

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

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
      this.callbacks.onToolChange(newTool);
    });
    this.eraserBtn.setActive(this.state.activeTool === "eraser");

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Add page
    this.addPageBtn = new ToolbarButton(this.el, "+ Page", "paper-toolbar__btn--add-page", () => {
      this.callbacks.onAddPage();
    });

    // Separator
    this.el.createEl("div", { cls: "paper-toolbar__separator" });

    // Document settings (gear)
    this.docSettingsBtn = new ToolbarButton(this.el, "\u2699", "paper-toolbar__btn--doc-settings", () => {
      this.callbacks.onOpenDocumentSettings();
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
      const anchor = this.presetStrip?.getButtonElement(presetId);
      this.openPopover(anchor ?? undefined);
      return;
    }

    this.applyPreset(preset);
    this.state.activePresetId = presetId;
    this.presetStrip?.setActivePreset(presetId);
    this.currentPenBtn?.update(this.state.colorId, this.state.penType);
    this.callbacks.onPenSettingsChange({ ...this.state });
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
      colorId: preset.colorId,
      width: preset.width,
      smoothing: preset.smoothing,
      grain: preset.grain ?? DEFAULT_GRAIN_VALUE,
      inkPreset: preset.inkPreset ?? "standard",
      nibAngle: preset.nibAngle ?? this.state.nibAngle,
      nibThickness: preset.nibThickness ?? this.state.nibThickness,
      nibPressure: preset.nibPressure ?? this.state.nibPressure,
    };

    const anchor = this.presetStrip?.getButtonElement(presetId);
    this.openPopover(anchor ?? undefined);
  }

  private applyPreset(preset: PenPreset): void {
    this.state.penType = preset.penType;
    this.state.colorId = preset.colorId;
    this.state.width = preset.width;
    this.state.smoothing = preset.smoothing;
    this.state.grain = preset.grain ?? DEFAULT_GRAIN_VALUE;
    this.state.inkPreset = preset.inkPreset ?? "standard";
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

  private openPopover(anchor?: HTMLElement): void {
    if (this.popover) return;

    const isEditing = this.editingPresetId !== null;
    const popoverState = this.editingState ?? this.state;
    const popoverPresetId = this.editingPresetId ?? this.state.activePresetId;

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
            const data = this.presetManager.createFromState(this.editingState);
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
            if (this.state.activePresetId) {
              // Auto-save changes back to the active preset
              const data = this.presetManager.createFromState(this.state);
              this.presetManager.updatePreset(this.state.activePresetId, data);
              const updated = this.presetManager.getPreset(this.state.activePresetId);
              if (updated) this.presetStrip?.updateSinglePreset(updated);
              this.callbacks.onPresetSave(this.presetManager.toArray(), this.state.activePresetId);
            } else {
              // No active preset — check if state now matches one
              const match = this.presetManager.findMatchingPreset(this.state);
              if (match !== this.state.activePresetId) {
                this.state.activePresetId = match;
                this.presetStrip?.setActivePreset(match);
              }
            }
            this.currentPenBtn?.update(this.state.colorId, this.state.penType);
            this.callbacks.onPenSettingsChange({ ...this.state });
          }
        },
        onSaveAsNew: () => {
          const sourceState = this.editingState ?? this.state;
          const data = this.presetManager.createFromState(sourceState);
          const added = this.presetManager.addPreset(data);
          if (added) {
            this.state.activePresetId = added.id;
            this.presetStrip?.updatePresets(this.presetManager.getPresets(), added.id);
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
          this.presetStrip?.updatePresets(this.presetManager.getPresets(), this.state.activePresetId);
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
      }
    );
  }

  private closePopover(): void {
    if (!this.popover) return;
    this.popover.destroy();
    this.popover = null;
    this.editingPresetId = null;
    this.editingState = null;
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

  getDocSettingsAnchor(): HTMLElement {
    return this.docSettingsBtn!.el;
  }

  destroy(): void {
    this.closePopover();
    this.autoMinimizer.destroy();
    this.presetStrip?.destroy();
    this.undoBtn?.destroy();
    this.redoBtn?.destroy();
    this.eraserBtn?.destroy();
    this.addPageBtn?.destroy();
    this.docSettingsBtn?.destroy();
    this.currentPenBtn?.destroy();
    this.el.remove();
  }
}
