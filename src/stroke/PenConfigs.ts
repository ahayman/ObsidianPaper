import type { PenType } from "../types";

/**
 * Full configuration for a pen type.
 * All pen types are handled by the same engine with different parameters.
 */
export interface PenConfig {
  type: PenType;
  baseWidth: number;
  /** Min and max width multipliers based on pressure. [minFraction, maxFraction] */
  pressureWidthRange: [number, number];
  /** Min and max opacity multipliers based on pressure. [minOpacity, maxOpacity]. null = no pressure→opacity mapping. */
  pressureOpacityRange: [number, number] | null;
  /** perfect-freehand thinning parameter */
  thinning: number;
  /** perfect-freehand smoothing parameter */
  smoothing: number;
  /** perfect-freehand streamline parameter */
  streamline: number;
  /** Taper length at stroke start */
  taperStart: number;
  /** Taper length at stroke end */
  taperEnd: number;
  /** Tilt sensitivity 0-1. How much tilt affects width/opacity (pencil). */
  tiltSensitivity: number;
  /** Pressure curve gamma exponent. <1 = more sensitive, >1 = less sensitive */
  pressureCurve: number;
  /** Base opacity for the pen (highlighter is low) */
  baseOpacity: number;
  /** Whether this pen uses special highlighter compositing */
  highlighterMode: boolean;
  /** For fountain pen: nib angle in radians */
  nibAngle: number | null;
  /** For fountain pen: nib thickness ratio (minor/major axis) */
  nibThickness: number | null;
  /** Whether to use barrel rotation (twist) as dynamic nib angle (Apple Pencil Pro) */
  useBarrelRotation: boolean;
}

export const PEN_CONFIGS: Record<PenType, PenConfig> = {
  ballpoint: {
    type: "ballpoint",
    baseWidth: 2,
    pressureWidthRange: [0.85, 1.15],
    pressureOpacityRange: null,
    thinning: 0.15,
    smoothing: 0.3,
    streamline: 0.4,
    taperStart: 0,
    taperEnd: 0,
    tiltSensitivity: 0,
    pressureCurve: 1.0,
    baseOpacity: 1.0,
    highlighterMode: false,
    nibAngle: null,
    nibThickness: null,
    useBarrelRotation: false,
  },

  brush: {
    type: "brush",
    baseWidth: 8,
    pressureWidthRange: [0.05, 1.0],
    pressureOpacityRange: null,
    thinning: 0.8,
    smoothing: 0.6,
    streamline: 0.5,
    taperStart: 20,
    taperEnd: 30,
    tiltSensitivity: 0,
    pressureCurve: 1.0,
    baseOpacity: 1.0,
    highlighterMode: false,
    nibAngle: null,
    nibThickness: null,
    useBarrelRotation: false,
  },

  "felt-tip": {
    type: "felt-tip",
    baseWidth: 6,
    pressureWidthRange: [0.7, 1.3],
    pressureOpacityRange: null,
    thinning: 0.3,
    smoothing: 0.5,
    streamline: 0.45,
    taperStart: 0,
    taperEnd: 0,
    tiltSensitivity: 0,
    pressureCurve: 1.0,
    baseOpacity: 1.0,
    highlighterMode: false,
    nibAngle: null,
    nibThickness: null,
    useBarrelRotation: false,
  },

  pencil: {
    type: "pencil",
    baseWidth: 3,
    pressureWidthRange: [0.5, 1.5],
    pressureOpacityRange: [0.15, 0.85],
    thinning: 0.5,
    smoothing: 0.4,
    streamline: 0.35,
    taperStart: 0,
    taperEnd: 0,
    tiltSensitivity: 0.8,
    pressureCurve: 1.0,
    baseOpacity: 0.85,
    highlighterMode: false,
    nibAngle: null,
    nibThickness: null,
    useBarrelRotation: false,
  },

  fountain: {
    type: "fountain",
    baseWidth: 6,
    pressureWidthRange: [0.7, 1.0],
    pressureOpacityRange: null,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.4,
    taperStart: 0,
    taperEnd: 0,
    tiltSensitivity: 0,
    pressureCurve: 0.8,
    baseOpacity: 1.0,
    highlighterMode: false,
    nibAngle: Math.PI / 6,
    nibThickness: 0.25,
    useBarrelRotation: true,
  },

  highlighter: {
    type: "highlighter",
    baseWidth: 24,
    pressureWidthRange: [0.9, 1.1],
    pressureOpacityRange: null,
    thinning: 0,
    smoothing: 0.8,
    streamline: 0.7,
    taperStart: 0,
    taperEnd: 0,
    tiltSensitivity: 0,
    pressureCurve: 1.0,
    baseOpacity: 0.3,
    highlighterMode: true,
    nibAngle: null,
    nibThickness: null,
    useBarrelRotation: false,
  },
};

/**
 * Get the pen config for a given pen type.
 */
export function getPenConfig(penType: PenType): PenConfig {
  return PEN_CONFIGS[penType];
}
