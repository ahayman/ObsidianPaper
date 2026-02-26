import type { PenType } from "../types";

export interface PenGrainConfig {
  enabled: boolean;
  /** Default grain strength 0-1 */
  strength: number;
}

export interface PenStampConfig {
  /** Stamp texture size in pixels (default 48) */
  textureSize: number;
  /** Spacing between stamps as fraction of diameter (default 0.12) */
  spacing: number;
  /** Maximum rotation jitter per stamp in radians (default ~15 degrees) */
  rotationJitter: number;
}

export interface PenTiltConfig {
  /** Tilt magnitude (degrees) below which only skew offset applies */
  tolerance: number;
  /** Degrees of transition band between skew and shading modes */
  transitionRange: number;
  /** Maximum width multiplier when stroke is perpendicular to tilt (cross-axis shading) */
  crossAxisMultiplier: number;
  /** Width multiplier when stroke is parallel to tilt (along-axis dragging) */
  alongAxisMultiplier: number;
  /** Maximum opacity reduction at full shading tilt (0-1) */
  opacityReduction: number;
  /** Maximum skew offset as fraction of radius */
  maxSkewOffset: number;
}

export interface InkStampConfig {
  /** Ink stamp texture size in pixels (default 64) */
  textureSize: number;
  /** Spacing between stamps as fraction of stamp diameter (default 0.15) */
  spacing: number;
  /** Stamp size as fraction of nib-projected width (default 0.6) */
  stampSizeFraction: number;
}

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
  /** Grain texture configuration (pencil/brush), null = no grain */
  grain: PenGrainConfig | null;
  /** Stamp-based rendering configuration, null = not supported */
  stamp: PenStampConfig | null;
  /** Ink stamp configuration for fountain pen, null = not supported */
  inkStamp: InkStampConfig | null;
  /** Tilt-based scatter configuration, null = no tilt scatter */
  tiltConfig: PenTiltConfig | null;
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
    grain: null,
    stamp: null,
    inkStamp: null,
    tiltConfig: null,
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
    grain: null,
    stamp: null,
    inkStamp: null,
    tiltConfig: { tolerance: 40, transitionRange: 20, crossAxisMultiplier: 2.0, alongAxisMultiplier: 1.3, opacityReduction: 0.2, maxSkewOffset: 0.3 },
  },

  pencil: {
    type: "pencil",
    baseWidth: 3,
    pressureWidthRange: [0.85, 1.15],       // Narrow width range — pressure affects density, not size
    pressureOpacityRange: [0.15, 1.0],       // Maps to draw probability — light touch = sparse, heavy = solid
    thinning: 0.5,
    smoothing: 0.4,
    streamline: 0.35,
    taperStart: 0,
    taperEnd: 0,
    tiltSensitivity: 0,                       // No tilt for stamp rendering — even small values create visible ovals
    pressureCurve: 1.0,
    baseOpacity: 0.85,
    highlighterMode: false,
    nibAngle: null,
    nibThickness: null,
    useBarrelRotation: false,
    grain: { enabled: true, strength: 0.5 },
    stamp: { textureSize: 48, spacing: 0.5, rotationJitter: Math.PI / 12 },
    inkStamp: null,
    tiltConfig: { tolerance: 40, transitionRange: 20, crossAxisMultiplier: 3.5, alongAxisMultiplier: 1.5, opacityReduction: 0.4, maxSkewOffset: 0.4 },
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
    useBarrelRotation: false,
    grain: null,
    stamp: null,
    inkStamp: { textureSize: 64, spacing: 0.15, stampSizeFraction: 2.0 },
    tiltConfig: null,
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
    grain: null,
    stamp: null,
    inkStamp: null,
    tiltConfig: null,
  },
};

/**
 * Get the pen config for a given pen type.
 */
export function getPenConfig(penType: PenType): PenConfig {
  return PEN_CONFIGS[penType];
}
