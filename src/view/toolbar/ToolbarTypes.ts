import type { PenType, StrokeScaling } from "../../types";

export interface PenPreset {
  id: string;
  name: string;
  penType: PenType;
  colorId: string;         // Dual-hex ("#light|#dark") or single "#hex"
  width: number;
  smoothing: number;       // 0-1
  nibAngle?: number;       // Radians, fountain only
  nibThickness?: number;   // 0-1, fountain only
  nibPressure?: number;    // 0-1, fountain only
  useBarrelRotation?: boolean; // Use barrel rotation, fountain only
  grain?: number;          // 0-1, pencil only (grain slider value)
  inkPreset?: string;      // Ink preset ID, fountain only
  inkDepletion?: number;   // 0-1, felt-tip only (ink depletion rate)
  strokeScaling?: StrokeScaling; // "fixed" (default) or "scaled" (width scales with zoom)
}

export type ToolbarPosition = "top" | "bottom" | "left" | "right";
export type ActiveTool = "pen" | "eraser" | "lasso";

export interface ToolbarState {
  activeTool: ActiveTool;
  activePresetId: string | null;
  penType: PenType;
  colorId: string;
  width: number;
  smoothing: number;
  nibAngle: number;
  nibThickness: number;
  nibPressure: number;
  useBarrelRotation: boolean;
  grain: number;
  inkPreset: string;
  inkDepletion: number;
  strokeScaling: StrokeScaling;
}

export interface ToolbarCallbacks {
  onToolChange: (tool: ActiveTool) => void;
  onPenSettingsChange: (state: ToolbarState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPaste: () => void;
  onAddPage: () => void;
  onOpenDocumentSettings: () => void;
  onPresetSave: (presets: PenPreset[], activePresetId: string | null) => void;
  onPositionChange: (position: ToolbarPosition) => void;
  onRecentColorsChange: (colors: string[], collapsed: boolean) => void;
}

export interface ToolbarQueries {
  canUndo: () => boolean;
  canRedo: () => boolean;
  pageCount: () => number;
}
