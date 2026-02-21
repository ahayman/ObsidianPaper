import type { PenType } from "../../types";

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
  grain?: number;          // 0-1, pencil only (grain slider value)
}

export type ToolbarPosition = "top" | "bottom" | "left" | "right";
export type ActiveTool = "pen" | "eraser";

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
  grain: number;
}

export interface ToolbarCallbacks {
  onToolChange: (tool: ActiveTool) => void;
  onPenSettingsChange: (state: ToolbarState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddPage: () => void;
  onOpenDocumentSettings: () => void;
  onPresetSave: (presets: PenPreset[], activePresetId: string | null) => void;
  onPositionChange: (position: ToolbarPosition) => void;
}

export interface ToolbarQueries {
  canUndo: () => boolean;
  canRedo: () => boolean;
  pageCount: () => number;
}
