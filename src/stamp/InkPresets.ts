/**
 * Ink preset configuration for fountain pen stamp-based rendering.
 *
 * Each preset controls how ink behaves: shading sensitivity, edge darkening
 * (coffee ring effect), paper grain interaction, edge feathering, and base opacity.
 */

export interface InkPresetConfig {
  label: string;
  /** 0-1, velocity-dependent darkness sensitivity. Higher = more shading variation. */
  shading: number;
  /** 0-1, donut profile center-hollow depth. Creates the "coffee ring" edge darkening. */
  edgeDarkening: number;
  /** 0-1, paper grain modulation on stamp opacity. */
  grainInfluence: number;
  /** 0-0.15, position jitter for edge irregularity. */
  feathering: number;
  /** Per-stamp opacity (builds via overlap). */
  baseOpacity: number;
}

export type InkPresetId = "standard" | "shading" | "iron-gall" | "flat-black";

const INK_PRESETS: Record<InkPresetId, InkPresetConfig> = {
  standard: {
    label: "Standard",
    shading: 0.6,
    edgeDarkening: 0.3,
    grainInfluence: 0.08,
    feathering: 0.03,
    baseOpacity: 0.22,
  },
  shading: {
    label: "Shading",
    shading: 1.0,
    edgeDarkening: 0.4,
    grainInfluence: 0.06,
    feathering: 0.03,
    baseOpacity: 0.18,
  },
  "iron-gall": {
    label: "Iron Gall",
    shading: 0.65,
    edgeDarkening: 0.15,
    grainInfluence: 0.04,
    feathering: 0.015,
    baseOpacity: 0.25,
  },
  "flat-black": {
    label: "Flat Black",
    shading: 0.2,
    edgeDarkening: 0.15,
    grainInfluence: 0.1,
    feathering: 0.01,
    baseOpacity: 0.35,
  },
};

const ALL_PRESET_IDS: InkPresetId[] = ["standard", "shading", "iron-gall", "flat-black"];

/**
 * Get an ink preset config by ID. Falls back to "standard" for unknown IDs.
 */
export function getInkPreset(id?: string): InkPresetConfig {
  if (id && id in INK_PRESETS) {
    return INK_PRESETS[id as InkPresetId];
  }
  return INK_PRESETS.standard;
}

/**
 * Get all preset IDs in display order.
 */
export function getInkPresetIds(): InkPresetId[] {
  return ALL_PRESET_IDS;
}
