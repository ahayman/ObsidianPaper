import type { PaperDocument, PenStyle } from "../types";

const DEFAULT_CANVAS_WIDTH = 2048;
const DEFAULT_CANVAS_HEIGHT = 2732;
const DEFAULT_BACKGROUND = "#fffff8";

const DEFAULT_STYLE: PenStyle = {
  pen: "ballpoint",
  color: "ink-black",
  width: 2.0,
  opacity: 1.0,
  smoothing: 0.5,
  pressureCurve: 1.0,
  tiltSensitivity: 0,
};

export function createEmptyDocument(appVersion: string = "0.1.0"): PaperDocument {
  const now = Date.now();
  return {
    version: 1,
    meta: {
      created: now,
      modified: now,
      appVersion,
    },
    canvas: {
      width: DEFAULT_CANVAS_WIDTH,
      height: DEFAULT_CANVAS_HEIGHT,
      backgroundColor: DEFAULT_BACKGROUND,
      paperType: "blank",
      lineSpacing: 32,
      gridSize: 40,
    },
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
