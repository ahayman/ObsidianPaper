import type {
  PenType,
  PaperType,
  PageSizePreset,
  PageOrientation,
  LayoutDirection,
  PageUnit,
  PageSize,
  SpacingUnit,
  PageMargins,
} from "../types";
import { PAGE_SIZE_PRESETS, PPI, CM_PER_INCH } from "../types";
import type { PenPreset } from "../view/toolbar/ToolbarTypes";

export type PaperFormat = "paper" | "paper.md";
export type NewNoteLocation = "specified" | "current" | "subfolder";

export interface PaperSettings {
  // Pen defaults
  defaultPenType: PenType;
  defaultColorId: string;
  defaultWidth: number;
  pressureSensitivity: number; // 0-1 multiplier applied to pressure curve

  // Canvas
  defaultPaperType: PaperType;
  defaultBackgroundColor: string;
  showGrid: boolean;
  gridSize: number;      // Stored in world units
  lineSpacing: number;   // Stored in world units
  spacingUnit: SpacingUnit; // Display unit for grid/line spacing

  // Margins (stored in world units)
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;

  // Page
  defaultPageSize: PageSizePreset;
  defaultOrientation: PageOrientation;
  defaultLayoutDirection: LayoutDirection;

  // Custom page size
  customPageUnit: PageUnit;
  customPageWidth: number;   // In chosen unit (e.g., 8.5 inches)
  customPageHeight: number;  // In chosen unit (e.g., 11 inches)

  // Smoothing
  defaultSmoothing: number; // 0-1

  // Grain texture
  pencilGrainStrength: number;   // 0-1, default 0.45

  // Fountain pen
  defaultNibAngle: number;       // Radians (default: Math.PI / 6 ≈ 30°)
  defaultNibThickness: number;   // Ratio 0-1 (default: 0.25)
  defaultNibPressure: number;    // Pressure sensitivity 0-1 (default: 0.5)
  useBarrelRotation: boolean;    // Use Apple Pencil Pro twist for nib angle

  // File
  newNoteLocation: NewNoteLocation;
  defaultFolder: string;
  newNoteSubfolder: string;
  fileNameTemplate: string;
  defaultFormat: PaperFormat;

  // Toolbar
  penPresets: PenPreset[];
  activePresetId: string | null;

  // Embeds
  embedMaxWidth: number;   // Max width in px for embedded previews (0 = fill container)
  embedMaxHeight: number;  // Max height in px for embedded previews (0 = no limit)
}

export const DEFAULT_PRESETS: PenPreset[] = [
  {
    id: "preset-ballpoint-black",
    name: "Ballpoint (Black)",
    penType: "ballpoint",
    colorId: "#1a1a1a|#e8e8e8",
    width: 2,
    smoothing: 0.3,
  },
  {
    id: "preset-ballpoint-blue",
    name: "Ballpoint (Blue)",
    penType: "ballpoint",
    colorId: "#2563eb|#60a5fa",
    width: 2,
    smoothing: 0.3,
  },
  {
    id: "preset-felt-red",
    name: "Felt tip (Red)",
    penType: "felt-tip",
    colorId: "#dc2626|#f87171",
    width: 3,
    smoothing: 0.5,
  },
  {
    id: "preset-pencil",
    name: "Pencil (Gray)",
    penType: "pencil",
    colorId: "#6b7280|#9ca3af",
    width: 3,
    smoothing: 0.4,
    grain: 0.35,
  },
  {
    id: "preset-highlighter-yellow",
    name: "Highlighter (#FFE066)",
    penType: "highlighter",
    colorId: "#FFE066",
    width: 24,
    smoothing: 0.8,
  },
];

export const DEFAULT_SETTINGS: PaperSettings = {
  defaultPenType: "ballpoint",
  defaultColorId: "#1a1a1a|#e8e8e8",
  defaultWidth: 2,
  pressureSensitivity: 1.0,

  defaultPaperType: "blank",
  defaultBackgroundColor: "#fffff8",
  showGrid: false,
  gridSize: 40,
  lineSpacing: 32,
  spacingUnit: "in",

  marginTop: 72,     // 1 inch
  marginBottom: 36,   // 0.5 inch
  marginLeft: 36,     // 0.5 inch
  marginRight: 36,    // 0.5 inch

  defaultPageSize: "us-letter",
  defaultOrientation: "portrait",
  defaultLayoutDirection: "vertical",
  customPageUnit: "in",
  customPageWidth: 8.5,
  customPageHeight: 11,

  defaultSmoothing: 0.5,

  pencilGrainStrength: 0.5,

  defaultNibAngle: Math.PI / 6,    // 30 degrees
  defaultNibThickness: 0.25,       // 4:1 aspect ratio
  defaultNibPressure: 0.5,         // Moderate pressure sensitivity
  useBarrelRotation: true,

  newNoteLocation: "specified",
  defaultFolder: "",
  newNoteSubfolder: "",
  fileNameTemplate: "Untitled Paper",
  defaultFormat: "paper",

  penPresets: DEFAULT_PRESETS,
  activePresetId: "preset-ballpoint-black",

  embedMaxWidth: 0,
  embedMaxHeight: 400,
};

/**
 * Resolve the effective page size from settings.
 */
export function resolvePageSize(settings: PaperSettings): PageSize {
  if (settings.defaultPageSize === "custom") {
    const factor = settings.customPageUnit === "in" ? PPI : PPI / CM_PER_INCH;
    return {
      width: Math.round(settings.customPageWidth * factor),
      height: Math.round(settings.customPageHeight * factor),
    };
  }
  return PAGE_SIZE_PRESETS[settings.defaultPageSize];
}

/**
 * Convert world units to a display value in the given spacing unit.
 */
export function worldUnitsToDisplay(wu: number, unit: SpacingUnit): number {
  switch (unit) {
    case "in": return wu / PPI;
    case "cm": return (wu / PPI) * CM_PER_INCH;
    case "wu": return wu;
  }
}

/**
 * Convert a display value in the given spacing unit to world units.
 */
export function displayToWorldUnits(value: number, unit: SpacingUnit): number {
  switch (unit) {
    case "in": return value * PPI;
    case "cm": return value * (PPI / CM_PER_INCH);
    case "wu": return value;
  }
}

/**
 * Get default margins from settings.
 */
export function resolveMargins(settings: PaperSettings): PageMargins {
  return {
    top: settings.marginTop,
    bottom: settings.marginBottom,
    left: settings.marginLeft,
    right: settings.marginRight,
  };
}

/**
 * Format a spacing value for display in settings UI.
 */
export function formatSpacingDisplay(wu: number, unit: SpacingUnit): string {
  const val = worldUnitsToDisplay(wu, unit);
  if (unit === "wu") return String(Math.round(val));
  // Round to 3 decimal places, strip trailing zeros
  return parseFloat(val.toFixed(3)).toString();
}

/**
 * Merge loaded data with defaults, ensuring all fields exist.
 */
export function mergeSettings(loaded: Partial<PaperSettings> | null): PaperSettings {
  if (!loaded) return { ...DEFAULT_SETTINGS };
  // Strip legacy device-specific fields (now stored in localStorage)
  const {
    defaultRenderPipeline: _rp, defaultRenderEngine: _re,
    palmRejection: _pr, fingerAction: _fa, toolbarPosition: _tp,
    ...rest
  } = loaded as Record<string, unknown>;
  const merged = { ...DEFAULT_SETTINGS, ...rest } as PaperSettings;
  return merged;
}
