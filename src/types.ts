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
  nibAngle?: number; // Nib angle in radians (0 = horizontal). Fountain pen / directional pens.
  nibThickness?: number; // Minor/major axis ratio (0-1, e.g. 0.25 = 4:1 aspect)
  nibPressure?: number; // Pressure sensitivity 0-1 (0 = none, 1 = max)
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
  pageIndex: number; // Which page this stroke belongs to
  style: string; // Reference to styles map
  styleOverrides?: Partial<PenStyle>; // Per-stroke overrides
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  pointCount: number;
  pts: string; // Delta-encoded integer string
  transform?: number[]; // Affine transform [a,b,c,d,tx,ty]
}

// --- Document ---

export type PaperType = "blank" | "lined" | "grid" | "dot-grid";

export type PageSizePreset = "us-letter" | "us-legal" | "a4" | "a5" | "a3" | "custom";
export type PageOrientation = "portrait" | "landscape";
export type LayoutDirection = "vertical" | "horizontal";
export type PageUnit = "in" | "cm";
export type SpacingUnit = "in" | "cm" | "wu";

export interface PageSize {
  width: number;   // World units (portrait dimensions, width < height)
  height: number;  // World units
}

export const PAGE_SIZE_PRESETS: Record<Exclude<PageSizePreset, "custom">, PageSize> = {
  "us-letter": { width: 612, height: 792 },
  "us-legal": { width: 612, height: 1008 },
  "a4": { width: 595, height: 842 },
  "a5": { width: 420, height: 595 },
  "a3": { width: 842, height: 1191 },
};

export const PPI = 72;
export const CM_PER_INCH = 2.54;

export interface PageMargins {
  top: number;    // World units
  bottom: number; // World units
  left: number;   // World units
  right: number;  // World units
}

export type PageBackgroundColor = string; // "auto" | "light" | "dark" | hex color
export type PageBackgroundTheme = "auto" | "light" | "dark";

export interface Page {
  id: string;
  size: PageSize;
  orientation: PageOrientation;
  paperType: PaperType;
  lineSpacing: number;
  gridSize: number;
  margins: PageMargins;
  backgroundColor?: PageBackgroundColor;      // Default: "auto" (theme-adaptive)
  backgroundColorTheme?: PageBackgroundTheme;  // Default: "auto" (inferred from backgroundColor)
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
  pages: Page[];
  layoutDirection: LayoutDirection;
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

export interface SerializedPage {
  id: string;
  w: number;
  h: number;
  o?: string;      // orientation, omit if "portrait"
  paper?: string;   // paperType, omit if "blank"
  ls?: number;      // lineSpacing
  gs?: number;      // gridSize
  mt?: number;      // marginTop
  mb?: number;      // marginBottom
  ml?: number;      // marginLeft
  mr?: number;      // marginRight
  bg?: string;      // backgroundColor, omit if "auto" or undefined
  bgt?: string;     // backgroundColorTheme, omit if "auto" or undefined
}

export interface SerializedDocument {
  v: number;
  meta: { created: number; app: string };
  layout?: string;  // "vertical" | "horizontal", omit if "vertical"
  pages: SerializedPage[];
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
  nibAngle?: number;
  nibThickness?: number;
  nibPressure?: number;
}

export interface SerializedStroke {
  id: string;
  pg: number;   // pageIndex
  st: string;   // style reference
  so?: Partial<SerializedPenStyle>; // style overrides
  bb: [number, number, number, number];
  n: number;
  pts: string;
  tf?: number[]; // transform
}
