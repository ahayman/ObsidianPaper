import type {
  PaperDocument,
  PenStyle,
  PageSize,
  PageOrientation,
  PaperType,
  LayoutDirection,
  PageMargins,
} from "../types";
import { PAGE_SIZE_PRESETS } from "../types";

const DEFAULT_STYLE: PenStyle = {
  pen: "ballpoint",
  color: "#1a1a1a|#e8e8e8",
  width: 2.0,
  opacity: 1.0,
  smoothing: 0.5,
  pressureCurve: 1.0,
  tiltSensitivity: 0,
};

const DEFAULT_MARGINS: PageMargins = {
  top: 72,     // 1 inch
  bottom: 36,  // 0.5 inch
  left: 36,    // 0.5 inch
  right: 36,   // 0.5 inch
};

export function createEmptyDocument(
  appVersion: string = "0.1.0",
  pageSize?: PageSize,
  orientation?: PageOrientation,
  paperType?: PaperType,
  layoutDirection?: LayoutDirection,
  margins?: PageMargins,
): PaperDocument {
  const now = Date.now();
  const size = pageSize ?? PAGE_SIZE_PRESETS["us-letter"];
  return {
    version: 3,
    meta: {
      created: now,
      modified: now,
      appVersion,
    },
    pages: [
      {
        id: generatePageId(),
        size: { width: size.width, height: size.height },
        orientation: orientation ?? "portrait",
        paperType: paperType ?? "blank",
        lineSpacing: 32,
        gridSize: 40,
        margins: margins ?? { ...DEFAULT_MARGINS },
      },
    ],
    layoutDirection: layoutDirection ?? "vertical",
    viewport: { x: 0, y: 0, zoom: 1.0 },
    channels: ["x", "y", "p", "tx", "ty", "tw", "t"],
    styles: {
      _default: { ...DEFAULT_STYLE },
    },
    strokes: [],
  };
}

/**
 * Generate a short unique stroke ID.
 */
export function generateStrokeId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "s";
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Generate a short unique page ID.
 */
export function generatePageId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "p";
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
