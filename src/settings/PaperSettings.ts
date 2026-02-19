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

export type PaperFormat = "paper" | "paper.md";

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

  // Input
  palmRejection: boolean;
  fingerAction: "pan" | "draw";

  // Smoothing
  defaultSmoothing: number; // 0-1

  // File
  defaultFolder: string;
  fileNameTemplate: string;
  defaultFormat: PaperFormat;
}

export const DEFAULT_SETTINGS: PaperSettings = {
  defaultPenType: "ballpoint",
  defaultColorId: "ink-black",
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

  palmRejection: true,
  fingerAction: "pan",

  defaultSmoothing: 0.5,

  defaultFolder: "",
  fileNameTemplate: "Untitled Paper",
  defaultFormat: "paper",
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
  return { ...DEFAULT_SETTINGS, ...loaded };
}
