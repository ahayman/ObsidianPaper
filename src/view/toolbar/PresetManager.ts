import type { PenPreset, ToolbarState } from "./ToolbarTypes";
import { getColorDisplayName } from "../../color/ColorUtils";
import { DEFAULT_GRAIN_VALUE } from "../../stamp/GrainMapping";
import { getPenConfig } from "../../stroke/PenConfigs";

const MAX_PRESETS = 20;

const PEN_TYPE_LABELS: Record<string, string> = {
  ballpoint: "Ballpoint",
  "felt-tip": "Felt tip",
  pencil: "Pencil",
  fountain: "Fountain",
  highlighter: "Highlighter",
};

/**
 * Generate a display name from pen type and color: "Type (Color)"
 */
export function generatePresetName(penType: string, colorId: string): string {
  const typeLabel = PEN_TYPE_LABELS[penType] ?? penType;
  const colorLabel = getColorDisplayName(colorId);
  return `${typeLabel} (${colorLabel})`;
}

function generateId(): string {
  return "preset-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/**
 * Pure-logic manager for pen presets. No DOM.
 */
export class PresetManager {
  private presets: PenPreset[];

  constructor(initialPresets: PenPreset[]) {
    this.presets = [...initialPresets];
  }

  getPresets(): readonly PenPreset[] {
    return this.presets;
  }

  getPreset(id: string): PenPreset | undefined {
    return this.presets.find((p) => p.id === id);
  }

  /**
   * Add a new preset. Returns the added preset, or null if at max limit.
   */
  addPreset(preset: Omit<PenPreset, "id">): PenPreset | null {
    if (this.presets.length >= MAX_PRESETS) return null;
    const full: PenPreset = { ...preset, id: generateId() };
    this.presets.push(full);
    return full;
  }

  /**
   * Update an existing preset with partial changes. Returns true if found.
   */
  updatePreset(id: string, changes: Partial<Omit<PenPreset, "id">>): boolean {
    const idx = this.presets.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.presets[idx] = { ...this.presets[idx], ...changes };
    return true;
  }

  /**
   * Delete a preset by ID. Returns true if found and removed.
   */
  deletePreset(id: string): boolean {
    const idx = this.presets.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.presets.splice(idx, 1);
    return true;
  }

  /**
   * Move a preset to a new index. Returns true if successful.
   */
  reorderPreset(id: string, newIndex: number): boolean {
    const idx = this.presets.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const clamped = Math.max(0, Math.min(newIndex, this.presets.length - 1));
    const [preset] = this.presets.splice(idx, 1);
    this.presets.splice(clamped, 0, preset);
    return true;
  }

  /**
   * Create a PenPreset from current toolbar state.
   * Name is auto-generated as "Type (Color)".
   */
  createFromState(state: ToolbarState): Omit<PenPreset, "id"> {
    const preset: Omit<PenPreset, "id"> = {
      name: generatePresetName(state.penType, state.colorId),
      penType: state.penType,
      colorId: state.colorId,
      width: state.width,
      smoothing: state.smoothing,
    };
    // Include grain for pencil presets
    const penConfig = getPenConfig(state.penType);
    if (penConfig.stamp) {
      preset.grain = state.grain;
    }
    // Include ink preset for fountain pen
    if (penConfig.inkStamp) {
      preset.inkPreset = state.inkPreset;
    }
    if (state.nibAngle !== undefined) preset.nibAngle = state.nibAngle;
    if (state.nibThickness !== undefined) preset.nibThickness = state.nibThickness;
    if (state.nibPressure !== undefined) preset.nibPressure = state.nibPressure;
    // Include barrel rotation for nib-based pens
    if (penConfig.nibAngle !== null) {
      preset.useBarrelRotation = state.useBarrelRotation;
    }
    return preset;
  }

  /**
   * Find a preset that exactly matches the given toolbar state.
   * Returns the preset ID, or null if no match.
   */
  findMatchingPreset(state: ToolbarState): string | null {
    for (const p of this.presets) {
      if (
        p.penType === state.penType &&
        p.colorId === state.colorId &&
        p.width === state.width &&
        p.smoothing === state.smoothing &&
        (p.nibAngle ?? state.nibAngle) === state.nibAngle &&
        (p.nibThickness ?? state.nibThickness) === state.nibThickness &&
        (p.nibPressure ?? state.nibPressure) === state.nibPressure &&
        (p.grain ?? DEFAULT_GRAIN_VALUE) === state.grain &&
        (p.inkPreset ?? "standard") === state.inkPreset &&
        (p.useBarrelRotation ?? false) === state.useBarrelRotation
      ) {
        return p.id;
      }
    }
    return null;
  }

  /**
   * Get a snapshot of the presets array (for persistence).
   */
  toArray(): PenPreset[] {
    return [...this.presets];
  }
}
