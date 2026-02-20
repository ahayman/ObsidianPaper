import getStroke from "perfect-freehand";
import type { StrokePoint, PenStyle } from "../types";
import { getPenConfig } from "./PenConfigs";
import { generateItalicOutline, type ItalicNibConfig } from "./ItalicOutlineGenerator";

export interface StrokeOutlineOptions {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  taperStart: number;
  taperEnd: number;
  simulatePressure: boolean;
}

/**
 * Map a PenStyle to perfect-freehand stroke options.
 */
export function penStyleToOutlineOptions(style: PenStyle): StrokeOutlineOptions {
  // Default mapping for ballpoint-type pens
  let thinning = 0.5;
  let smoothing = style.smoothing;
  let streamline = style.smoothing;
  let taperStart = 0;
  let taperEnd = 0;

  switch (style.pen) {
    case "ballpoint":
      thinning = 0.15;
      smoothing = 0.3;
      streamline = 0.4;
      break;
    case "felt-tip":
      thinning = 0.3;
      smoothing = 0.5;
      streamline = 0.45;
      break;
    case "pencil":
      thinning = 0.5;
      smoothing = 0.4;
      streamline = 0.35;
      break;
    case "fountain":
      thinning = 0.6;
      smoothing = 0.5;
      streamline = 0.4;
      taperStart = 10;
      taperEnd = 15;
      break;
    case "highlighter":
      thinning = 0;
      smoothing = 0.8;
      streamline = 0.7;
      break;
  }

  return {
    size: style.width,
    thinning,
    smoothing,
    streamline,
    taperStart,
    taperEnd,
    simulatePressure: false,
  };
}

/**
 * Convert StrokePoints to the input format expected by perfect-freehand:
 * array of [x, y, pressure] tuples.
 */
export function pointsToFreehandInput(
  points: readonly StrokePoint[]
): number[][] {
  return points.map((p) => [p.x, p.y, p.pressure]);
}

/**
 * Generate an outline polygon from stroke points using perfect-freehand.
 * Returns an array of [x, y] pairs forming a closed polygon.
 */
export function generateOutline(
  points: readonly StrokePoint[],
  style: PenStyle
): number[][] {
  if (points.length === 0) return [];

  // Fountain pen: use italic outline generator
  // Read nib params from style (per-stroke) with PenConfig fallback
  const penConfig = getPenConfig(style.pen);
  const nibAngle = style.nibAngle ?? penConfig.nibAngle;
  const nibThickness = style.nibThickness ?? penConfig.nibThickness;

  if (nibAngle !== null && nibThickness !== null) {
    // nibPressure 0-1 maps to pressureWidthRange min:
    // 0 → [1.0, 1.0] (no pressure effect), 1 → [0.3, 1.0] (max effect)
    const nibPressure = style.nibPressure ?? 0.5;
    const pressureMin = 1.0 - nibPressure * 0.7;
    const italicConfig: ItalicNibConfig = {
      nibWidth: style.width,
      nibHeight: style.width * nibThickness,
      nibAngle: nibAngle,
      useBarrelRotation: penConfig.useBarrelRotation,
      pressureCurve: penConfig.pressureCurve,
      pressureWidthRange: [pressureMin, 1.0],
      widthSmoothing: 0.4,
      taperStart: penConfig.taperStart,
      taperEnd: penConfig.taperEnd,
    };
    return generateItalicOutline(points, italicConfig);
  }

  // All other pen types: perfect-freehand
  const options = penStyleToOutlineOptions(style);
  const input = pointsToFreehandInput(points);

  return getStroke(input, {
    size: options.size,
    thinning: options.thinning,
    smoothing: options.smoothing,
    streamline: options.streamline,
    start: { taper: options.taperStart },
    end: { taper: options.taperEnd },
    simulatePressure: options.simulatePressure,
  });
}

/**
 * Build a Path2D from an outline polygon (array of [x, y] points).
 */
export function outlineToPath2D(outline: number[][]): Path2D | null {
  if (outline.length < 2) return null;

  const path = new Path2D();
  const first = outline[0];
  path.moveTo(first[0], first[1]);

  for (let i = 1; i < outline.length; i++) {
    path.lineTo(outline[i][0], outline[i][1]);
  }

  path.closePath();
  return path;
}

/**
 * Generate a stroke outline and convert it to a Path2D in one step.
 */
export function generateStrokePath(
  points: readonly StrokePoint[],
  style: PenStyle
): Path2D | null {
  const outline = generateOutline(points, style);
  return outlineToPath2D(outline);
}

/**
 * Cache for completed stroke Path2D objects.
 * Keyed by stroke ID.
 */
export class StrokePathCache {
  private cache = new Map<string, Path2D>();

  get(strokeId: string): Path2D | undefined {
    return this.cache.get(strokeId);
  }

  set(strokeId: string, path: Path2D): void {
    this.cache.set(strokeId, path);
  }

  has(strokeId: string): boolean {
    return this.cache.has(strokeId);
  }

  delete(strokeId: string): void {
    this.cache.delete(strokeId);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
