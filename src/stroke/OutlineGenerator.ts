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
  style: PenStyle,
  dejitter: boolean = true,
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
    return generateItalicOutline(points, italicConfig, dejitter);
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
 * Uses midpoint quadratic Bézier curves for smooth edges — each outline
 * point becomes a control point with midpoints as curve endpoints,
 * producing a C1-continuous closed curve.
 */
export function outlineToPath2D(outline: number[][]): Path2D | null {
  if (outline.length < 2) return null;

  const path = new Path2D();
  const n = outline.length;

  if (n < 3) {
    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < n; i++) {
      path.lineTo(outline[i][0], outline[i][1]);
    }
    path.closePath();
    return path;
  }

  // Start at midpoint between first and second point
  const mx0 = (outline[0][0] + outline[1][0]) * 0.5;
  const my0 = (outline[0][1] + outline[1][1]) * 0.5;
  path.moveTo(mx0, my0);

  for (let i = 1; i < n; i++) {
    const next = (i + 1) % n;
    const mx = (outline[i][0] + outline[next][0]) * 0.5;
    const my = (outline[i][1] + outline[next][1]) * 0.5;
    path.quadraticCurveTo(outline[i][0], outline[i][1], mx, my);
  }

  // Final curve through P0 back to start
  path.quadraticCurveTo(outline[0][0], outline[0][1], mx0, my0);
  path.closePath();
  return path;
}

/**
 * Number of linear segments used to approximate each quadratic Bézier span.
 * Higher = smoother curves but more vertices. 4 gives good quality without
 * excessive vertex count (a 200-point outline → ~800 vertices).
 */
const BEZIER_SUBDIVISIONS = 4;

/**
 * Convert an outline polygon to a Float32Array of vertex pairs [x0, y0, x1, y1, ...].
 * Uses the same midpoint quadratic Bézier interpolation as outlineToPath2D so that
 * WebGL stroke rendering matches the smooth Canvas2D path quality.
 */
export function outlineToFloat32Array(outline: number[][]): Float32Array | null {
  if (outline.length < 2) return null;
  const n = outline.length;

  if (n < 3) {
    const arr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      arr[i * 2] = outline[i][0];
      arr[i * 2 + 1] = outline[i][1];
    }
    return arr;
  }

  // Each of the n outline points produces one Bézier span, each subdivided
  // into BEZIER_SUBDIVISIONS segments. We emit the start point of each segment
  // (the final point wraps back to the first).
  const totalVerts = n * BEZIER_SUBDIVISIONS;
  const arr = new Float32Array(totalVerts * 2);
  let idx = 0;

  // Precompute first midpoint (start of curve)
  const mx0 = (outline[0][0] + outline[1][0]) * 0.5;
  const my0 = (outline[0][1] + outline[1][1]) * 0.5;

  // Spans 1..n-1: control = outline[i], end = midpoint(outline[i], outline[i+1])
  for (let i = 1; i < n; i++) {
    const prev = (i - 1);
    const next = (i + 1) % n;

    // Start of this span = midpoint(outline[i-1], outline[i])
    const sx = (outline[prev][0] + outline[i][0]) * 0.5;
    const sy = (outline[prev][1] + outline[i][1]) * 0.5;

    // Control point = outline[i]
    const cx = outline[i][0];
    const cy = outline[i][1];

    // End of this span = midpoint(outline[i], outline[i+1])
    const ex = (outline[i][0] + outline[next][0]) * 0.5;
    const ey = (outline[i][1] + outline[next][1]) * 0.5;

    for (let s = 0; s < BEZIER_SUBDIVISIONS; s++) {
      const t = s / BEZIER_SUBDIVISIONS;
      const omt = 1 - t;
      // Quadratic Bézier: B(t) = (1-t)²·S + 2(1-t)t·C + t²·E
      arr[idx++] = omt * omt * sx + 2 * omt * t * cx + t * t * ex;
      arr[idx++] = omt * omt * sy + 2 * omt * t * cy + t * t * ey;
    }
  }

  // Final span: control = outline[0], end = mx0, my0 (back to start)
  {
    const prev = n - 1;
    const sx = (outline[prev][0] + outline[0][0]) * 0.5;
    const sy = (outline[prev][1] + outline[0][1]) * 0.5;
    const cx = outline[0][0];
    const cy = outline[0][1];

    for (let s = 0; s < BEZIER_SUBDIVISIONS; s++) {
      const t = s / BEZIER_SUBDIVISIONS;
      const omt = 1 - t;
      arr[idx++] = omt * omt * sx + 2 * omt * t * cx + t * t * mx0;
      arr[idx++] = omt * omt * sy + 2 * omt * t * cy + t * t * my0;
    }
  }

  return arr;
}

/**
 * Generate a stroke outline and convert it to a Float32Array in one step.
 */
export function generateStrokeVertices(
  points: readonly StrokePoint[],
  style: PenStyle,
  dejitter: boolean = true,
): Float32Array | null {
  return outlineToFloat32Array(generateOutline(points, style, dejitter));
}

/**
 * Generate a stroke outline and convert it to a Path2D in one step.
 */
export function generateStrokePath(
  points: readonly StrokePoint[],
  style: PenStyle,
  dejitter: boolean = true,
): Path2D | null {
  const outline = generateOutline(points, style, dejitter);
  return outlineToPath2D(outline);
}

/**
 * Dual cache for completed stroke data.
 * Stores raw outline data and lazily produces Path2D or Float32Array.
 * Keyed by stroke ID (or LOD-qualified key).
 */
export class StrokePathCache {
  private pathCache = new Map<string, Path2D>();
  private vertexCache = new Map<string, Float32Array>();
  private outlineCache = new Map<string, number[][]>();

  /** Get a cached Path2D (legacy callers, workers). */
  get(strokeId: string): Path2D | undefined {
    return this.pathCache.get(strokeId);
  }

  /** Cache a Path2D directly (legacy callers, workers). */
  set(strokeId: string, path: Path2D): void {
    this.pathCache.set(strokeId, path);
  }

  has(strokeId: string): boolean {
    return this.pathCache.has(strokeId) || this.outlineCache.has(strokeId);
  }

  /** Store raw outline data. Path2D and Float32Array are produced lazily. */
  setOutline(strokeId: string, outline: number[][]): void {
    this.outlineCache.set(strokeId, outline);
    // Invalidate derived caches — they will be rebuilt lazily
    this.pathCache.delete(strokeId);
    this.vertexCache.delete(strokeId);
  }

  /** Get or lazily build Path2D from cached outline. */
  getPath(strokeId: string): Path2D | undefined {
    const cached = this.pathCache.get(strokeId);
    if (cached) return cached;
    const outline = this.outlineCache.get(strokeId);
    if (!outline) return undefined;
    const path = outlineToPath2D(outline);
    if (path) {
      this.pathCache.set(strokeId, path);
    }
    return path ?? undefined;
  }

  /** Get or lazily build Float32Array from cached outline. */
  getVertices(strokeId: string): Float32Array | undefined {
    const cached = this.vertexCache.get(strokeId);
    if (cached) return cached;
    const outline = this.outlineCache.get(strokeId);
    if (!outline) return undefined;
    const verts = outlineToFloat32Array(outline);
    if (verts) {
      this.vertexCache.set(strokeId, verts);
    }
    return verts ?? undefined;
  }

  delete(strokeId: string): void {
    this.pathCache.delete(strokeId);
    this.vertexCache.delete(strokeId);
    this.outlineCache.delete(strokeId);
  }

  clear(): void {
    this.pathCache.clear();
    this.vertexCache.clear();
    this.outlineCache.clear();
  }

  get size(): number {
    // Count unique keys across all caches
    const keys = new Set<string>();
    for (const k of this.pathCache.keys()) keys.add(k);
    for (const k of this.outlineCache.keys()) keys.add(k);
    return keys.size;
  }
}
