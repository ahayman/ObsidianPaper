/**
 * Comprehensive test stroke data factory for golden master characterization tests.
 *
 * Generates realistic stroke data covering:
 * - Multiple stroke shapes (straight, curve, zigzag, spiral, dot)
 * - Pressure profiles (constant, ramp, bell)
 * - Tilt profiles (none, constant, sweeping)
 * - Speed profiles (moderate, fast, slow)
 * - All pen type style variants
 *
 * All generated points are quantized through encode/decode round-trip
 * to match real-world encoding precision.
 */

import type { StrokePoint, Stroke, PenStyle, PenType } from "../../types";
import { encodePoints, decodePoints, computeBBox } from "../../document/PointEncoder";

// ─── Pressure Profiles ──────────────────────────────────────

export type PressureProfile = (t: number) => number;

export function constantPressure(value: number): PressureProfile {
  return () => value;
}

export function rampPressure(start: number, end: number): PressureProfile {
  return (t: number) => start + (end - start) * t;
}

export function bellPressure(peak: number): PressureProfile {
  return (t: number) => {
    // Smooth bell: ramp up to peak at t=0.5, ramp down
    const x = 2 * t - 1; // -1 to 1
    return peak * (1 - x * x);
  };
}

// ─── Tilt Profiles ──────────────────────────────────────────

export interface TiltValue {
  tiltX: number;
  tiltY: number;
}

export type TiltProfile = (t: number) => TiltValue;

export function noTilt(): TiltProfile {
  return () => ({ tiltX: 0, tiltY: 0 });
}

export function constantTilt(tiltX: number, tiltY: number): TiltProfile {
  return () => ({ tiltX, tiltY });
}

export function sweepingTilt(
  startAngleDeg: number,
  endAngleDeg: number,
  magnitude: number,
): TiltProfile {
  return (t: number) => {
    const angleDeg = startAngleDeg + (endAngleDeg - startAngleDeg) * t;
    const angleRad = (angleDeg * Math.PI) / 180;
    return {
      tiltX: magnitude * Math.cos(angleRad),
      tiltY: magnitude * Math.sin(angleRad),
    };
  };
}

// ─── Speed (timestamp spacing) ──────────────────────────────

/** Pixels per millisecond. Affects timestamp spacing. */
export type SpeedProfile = "moderate" | "fast" | "slow";

function speedToMsPerPixel(speed: SpeedProfile): number {
  switch (speed) {
    case "moderate":
      return 1.0; // 1 ms per pixel
    case "fast":
      return 0.5; // 0.5 ms per pixel (2 px/ms)
    case "slow":
      return 5.0; // 5 ms per pixel (0.2 px/ms)
  }
}

// ─── Stroke Generators ──────────────────────────────────────

export interface StrokeGenOptions {
  pressure: PressureProfile;
  tilt: TiltProfile;
  speed: SpeedProfile;
  twist: number;
}

const DEFAULT_OPTIONS: StrokeGenOptions = {
  pressure: constantPressure(0.5),
  tilt: noTilt(),
  speed: "moderate",
  twist: 0,
};

function mergeOptions(opts?: Partial<StrokeGenOptions>): StrokeGenOptions {
  return { ...DEFAULT_OPTIONS, ...opts };
}

/**
 * Generate a straight line from (100, 200) with the given length.
 */
export function generateStraightLine(
  numPoints: number,
  length: number,
  opts?: Partial<StrokeGenOptions>,
): StrokePoint[] {
  const o = mergeOptions(opts);
  const msPerPx = speedToMsPerPixel(o.speed);
  const points: StrokePoint[] = [];
  const step = length / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const t = numPoints > 1 ? i / (numPoints - 1) : 0;
    const x = 100 + step * i;
    const y = 200;
    const tilt = o.tilt(t);
    const dist = step * i;
    points.push({
      x,
      y,
      pressure: o.pressure(t),
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      twist: o.twist,
      timestamp: Math.round(dist * msPerPx),
    });
  }

  return points;
}

/**
 * Generate a smooth curve (quarter circle arc).
 */
export function generateCurve(
  numPoints: number,
  radius: number,
  opts?: Partial<StrokeGenOptions>,
): StrokePoint[] {
  const o = mergeOptions(opts);
  const msPerPx = speedToMsPerPixel(o.speed);
  const points: StrokePoint[] = [];
  const cx = 100;
  const cy = 200 + radius;

  let cumDist = 0;
  let prevX = cx;
  let prevY = cy - radius;

  for (let i = 0; i < numPoints; i++) {
    const t = numPoints > 1 ? i / (numPoints - 1) : 0;
    const angle = -Math.PI / 2 + (Math.PI / 2) * t; // -90 to 0 degrees
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const tilt = o.tilt(t);

    const dx = x - prevX;
    const dy = y - prevY;
    cumDist += Math.sqrt(dx * dx + dy * dy);
    prevX = x;
    prevY = y;

    points.push({
      x,
      y,
      pressure: o.pressure(t),
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      twist: o.twist,
      timestamp: Math.round(cumDist * msPerPx),
    });
  }

  return points;
}

/**
 * Generate a zigzag pattern.
 */
export function generateZigzag(
  numSegments: number,
  segmentLength: number,
  amplitude: number,
  opts?: Partial<StrokeGenOptions>,
): StrokePoint[] {
  const o = mergeOptions(opts);
  const msPerPx = speedToMsPerPixel(o.speed);
  const points: StrokePoint[] = [];
  const pointsPerSegment = 8;
  const totalPoints = numSegments * pointsPerSegment + 1;

  let cumDist = 0;
  let prevX = 100;
  let prevY = 200;

  for (let i = 0; i < totalPoints; i++) {
    const t = i / (totalPoints - 1);
    const x = 100 + t * numSegments * segmentLength;
    const segT = (t * numSegments) % 1;
    const segIdx = Math.floor(t * numSegments);
    const y = 200 + (segIdx % 2 === 0 ? segT : 1 - segT) * amplitude * 2 - amplitude;
    const tilt = o.tilt(t);

    const dx = x - prevX;
    const dy = y - prevY;
    cumDist += Math.sqrt(dx * dx + dy * dy);
    prevX = x;
    prevY = y;

    points.push({
      x,
      y,
      pressure: o.pressure(t),
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      twist: o.twist,
      timestamp: Math.round(cumDist * msPerPx),
    });
  }

  return points;
}

/**
 * Generate a spiral pattern (outward from center).
 */
export function generateSpiral(
  numPoints: number,
  turns: number,
  maxRadius: number,
  opts?: Partial<StrokeGenOptions>,
): StrokePoint[] {
  const o = mergeOptions(opts);
  const msPerPx = speedToMsPerPixel(o.speed);
  const points: StrokePoint[] = [];
  const cx = 200;
  const cy = 200;

  let cumDist = 0;
  let prevX = cx;
  let prevY = cy;

  for (let i = 0; i < numPoints; i++) {
    const t = numPoints > 1 ? i / (numPoints - 1) : 0;
    const angle = t * turns * 2 * Math.PI;
    const r = t * maxRadius;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    const tilt = o.tilt(t);

    const dx = x - prevX;
    const dy = y - prevY;
    cumDist += Math.sqrt(dx * dx + dy * dy);
    prevX = x;
    prevY = y;

    points.push({
      x,
      y,
      pressure: o.pressure(t),
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      twist: o.twist,
      timestamp: Math.round(cumDist * msPerPx),
    });
  }

  return points;
}

/**
 * Generate a single dot (1-3 points, near-zero movement).
 */
export function generateDot(
  opts?: Partial<StrokeGenOptions>,
): StrokePoint[] {
  const o = mergeOptions(opts);
  const tilt = o.tilt(0.5);
  return [
    {
      x: 150,
      y: 200,
      pressure: o.pressure(0),
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      twist: o.twist,
      timestamp: 0,
    },
    {
      x: 150.1,
      y: 200.05,
      pressure: o.pressure(0.5),
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      twist: o.twist,
      timestamp: 10,
    },
    {
      x: 150.2,
      y: 200.1,
      pressure: o.pressure(1),
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      twist: o.twist,
      timestamp: 20,
    },
  ];
}

// ─── Stroke Shape Registry ──────────────────────────────────

export type StrokeShape =
  | "straight"
  | "curve"
  | "zigzag"
  | "spiral"
  | "dot"
  | "straight-tilted"
  | "curve-tilt-sweep"
  | "straight-fast"
  | "straight-slow";

export function generateStrokePoints(
  shape: StrokeShape,
  pressure: PressureProfile,
): StrokePoint[] {
  switch (shape) {
    case "straight":
      return generateStraightLine(40, 200, { pressure });
    case "curve":
      return generateCurve(50, 80, { pressure });
    case "zigzag":
      return generateZigzag(6, 30, 15, { pressure, speed: "fast" });
    case "spiral":
      return generateSpiral(80, 2, 60, { pressure, speed: "moderate" });
    case "dot":
      return generateDot({ pressure });
    case "straight-tilted":
      return generateStraightLine(30, 150, {
        pressure,
        tilt: constantTilt(30, 0),
      });
    case "curve-tilt-sweep":
      return generateCurve(40, 60, {
        pressure,
        tilt: sweepingTilt(0, 45, 30),
      });
    case "straight-fast":
      return generateStraightLine(30, 200, { pressure, speed: "fast" });
    case "straight-slow":
      return generateStraightLine(30, 100, { pressure, speed: "slow" });
  }
}

// ─── Pressure Profile Registry ──────────────────────────────

export type PressureName = "constant" | "ramp" | "bell";

export function getPressureProfile(name: PressureName): PressureProfile {
  switch (name) {
    case "constant":
      return constantPressure(0.5);
    case "ramp":
      return rampPressure(0.1, 1.0);
    case "bell":
      return bellPressure(0.8);
  }
}

// ─── Quantization ───────────────────────────────────────────

/**
 * Quantize points through encode/decode round-trip to match real-world precision.
 * This ensures test data matches the precision loss from delta-encoded storage.
 */
export function quantizePoints(points: StrokePoint[]): StrokePoint[] {
  if (points.length === 0) return [];
  const encoded = encodePoints(points);
  return decodePoints(encoded);
}

// ─── Stroke Builder ─────────────────────────────────────────

let nextStrokeId = 1;

/**
 * Build a complete Stroke object from points, quantized through encode/decode.
 */
export function buildStroke(
  rawPoints: StrokePoint[],
  styleId: string,
  overrides?: Partial<Stroke>,
): Stroke {
  const pts = encodePoints(rawPoints);
  const decoded = decodePoints(pts);
  const bbox = computeBBox(decoded);
  const grainAnchor: [number, number] | undefined =
    decoded.length > 0 ? [decoded[0].x, decoded[0].y] : undefined;

  return {
    id: `stroke-${nextStrokeId++}`,
    pageIndex: 0,
    style: styleId,
    bbox,
    grainAnchor,
    pointCount: decoded.length,
    pts,
    ...overrides,
  };
}

/**
 * Reset the stroke ID counter (call in beforeEach if needed).
 */
export function resetStrokeIds(): void {
  nextStrokeId = 1;
}

// ─── Test Styles ────────────────────────────────────────────

export const TEST_STYLES: Record<string, PenStyle> = {
  "ballpoint-default": {
    pen: "ballpoint",
    color: "#1a1a1a",
    width: 2,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 1,
    tiltSensitivity: 0,
  },
  "felt-tip-default": {
    pen: "felt-tip",
    color: "#333333",
    width: 6,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 1,
    tiltSensitivity: 0,
  },
  "pencil-default": {
    pen: "pencil",
    color: "#2d2d2d",
    width: 3,
    opacity: 0.85,
    smoothing: 0.4,
    pressureCurve: 1,
    tiltSensitivity: 0,
    grain: 0.5,
  },
  "pencil-low-grain": {
    pen: "pencil",
    color: "#2d2d2d",
    width: 3,
    opacity: 0.85,
    smoothing: 0.4,
    pressureCurve: 1,
    tiltSensitivity: 0,
    grain: 0.1,
  },
  "pencil-high-grain": {
    pen: "pencil",
    color: "#2d2d2d",
    width: 3,
    opacity: 0.85,
    smoothing: 0.4,
    pressureCurve: 1,
    tiltSensitivity: 0,
    grain: 0.9,
  },
  "fountain-default": {
    pen: "fountain",
    color: "#000000",
    width: 6,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 0.8,
    tiltSensitivity: 0,
    nibAngle: Math.PI / 6,
    nibThickness: 0.25,
    inkPreset: "standard",
  },
  "fountain-no-nib": {
    pen: "fountain",
    color: "#000000",
    width: 6,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 0.8,
    tiltSensitivity: 0,
    inkPreset: "standard",
  },
  "fountain-no-shading": {
    pen: "fountain",
    color: "#000000",
    width: 6,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 0.8,
    tiltSensitivity: 0,
    nibAngle: Math.PI / 6,
    nibThickness: 0.25,
  },
  "fountain-barrel-rotation": {
    pen: "fountain",
    color: "#000000",
    width: 6,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 0.8,
    tiltSensitivity: 0,
    nibAngle: Math.PI / 6,
    nibThickness: 0.25,
    useBarrelRotation: true,
    inkPreset: "standard",
  },
  "highlighter-default": {
    pen: "highlighter",
    color: "#FFD700",
    width: 24,
    opacity: 0.3,
    smoothing: 0.8,
    pressureCurve: 1,
    tiltSensitivity: 0,
  },
};

// ─── Test Matrix Configuration ──────────────────────────────

/**
 * Returns the meaningful shape/pressure combinations for a given style + pipeline + LOD.
 * Avoids testing combinations that don't exercise different code paths.
 */
export function getMeaningfulCombinations(
  styleName: string,
  pipeline: "basic" | "advanced",
  lod: 0 | 1 | 2 | 3,
): Array<{ shape: StrokeShape; pressure: PressureName }> {
  const style = TEST_STYLES[styleName];
  if (!style) return [];

  const combos: Array<{ shape: StrokeShape; pressure: PressureName }> = [];

  // Core shapes tested for all combinations
  const coreShapes: StrokeShape[] = ["straight", "curve", "zigzag", "spiral", "dot"];
  const corePressures: PressureName[] = ["constant", "ramp", "bell"];

  // At LOD > 0 with advanced pipeline, skip (effects disabled at high LOD)
  if (lod > 0 && pipeline === "advanced") return [];

  // At LOD > 0, just test core shapes with constant pressure (LOD simplifies, less variation)
  if (lod > 0) {
    for (const shape of coreShapes) {
      combos.push({ shape, pressure: "constant" });
    }
    return combos;
  }

  // LOD 0: full matrix
  for (const shape of coreShapes) {
    for (const pressure of corePressures) {
      combos.push({ shape, pressure });
    }
  }

  // Tilt-specific shapes only for pens with tiltConfig (pencil, felt-tip)
  if (style.pen === "pencil" || style.pen === "felt-tip") {
    combos.push(
      { shape: "straight-tilted", pressure: "constant" },
      { shape: "curve-tilt-sweep", pressure: "constant" },
    );
  }

  // Speed-specific shapes only for fountain pen (affects ink deposit/pooling)
  if (style.pen === "fountain" && pipeline === "advanced") {
    combos.push(
      { shape: "straight-fast", pressure: "constant" },
      { shape: "straight-slow", pressure: "constant" },
    );
  }

  return combos;
}
