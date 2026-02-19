import type { PenType, PaperType } from "../types";

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
  gridSize: number;
  lineSpacing: number;

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

  palmRejection: true,
  fingerAction: "pan",

  defaultSmoothing: 0.5,

  defaultFolder: "",
  fileNameTemplate: "Untitled Paper",
  defaultFormat: "paper",
};

/**
 * Merge loaded data with defaults, ensuring all fields exist.
 */
export function mergeSettings(loaded: Partial<PaperSettings> | null): PaperSettings {
  if (!loaded) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...loaded };
}
