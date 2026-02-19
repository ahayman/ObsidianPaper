/**
 * Core type definitions for ObsidianPaper
 */

// --- Pen Types ---

export type PenType =
  | "ballpoint"
  | "brush"
  | "felt-tip"
  | "pencil"
  | "fountain"
  | "highlighter";

export interface PenStyle {
  pen: PenType;
  color: string; // Semantic color ID or hex
  colorDark?: string; // Dark mode pair
  width: number; // Base width in world units
  opacity: number; // 0-1
  smoothing: number; // 0-1 (streamline factor)
  pressureCurve: number; // Gamma exponent
  tiltSensitivity: number;
}

// --- Stroke Data ---

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number; // Apple Pencil Pro barrel rotation
  timestamp: number;
}

export interface Stroke {
  id: string;
  style: string; // Reference to styles map
  styleOverrides?: Partial<PenStyle>; // Per-stroke overrides
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  pointCount: number;
  pts: string; // Delta-encoded integer string
  transform?: number[]; // Affine transform [a,b,c,d,tx,ty]
}

// --- Document ---

export type PaperType = "blank" | "lined" | "grid" | "dot-grid";

export interface CanvasConfig {
  width: number;
  height: number;
  backgroundColor: string;
  paperType: PaperType;
  lineSpacing: number;
  gridSize: number;
}

export interface DocumentMeta {
  created: number; // Unix timestamp ms
  modified: number;
  appVersion: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PaperDocument {
  version: number;
  meta: DocumentMeta;
  canvas: CanvasConfig;
  viewport: Viewport;
  channels: string[];
  styles: Record<string, PenStyle>;
  strokes: Stroke[];
}

// --- Camera ---

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

// --- Serialized Format (compact keys) ---

export interface SerializedDocument {
  v: number;
  meta: { created: number; app: string };
  canvas: { w: number; h: number; bg: string; paper: string; ls?: number; gs?: number };
  viewport: { x: number; y: number; zoom: number };
  channels: string[];
  styles: Record<string, SerializedPenStyle>;
  strokes: SerializedStroke[];
}

export interface SerializedPenStyle {
  pen: string;
  color: string;
  colorDark?: string;
  width: number;
  opacity: number;
  smoothing: number;
  pressureCurve: number;
  tiltSensitivity: number;
}

export interface SerializedStroke {
  id: string;
  st: string; // style reference
  so?: Partial<SerializedPenStyle>; // style overrides
  bb: [number, number, number, number];
  n: number;
  pts: string;
  tf?: number[]; // transform
}
