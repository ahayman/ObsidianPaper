/**
 * Color utility functions for parsing, converting, and encoding colors.
 *
 * Color ID formats:
 *   - Dual hex:     "#AABBCC|#DDEEFF"  (light|dark pair — canonical storage format)
 *   - Single hex:   "#AABBCC"   (used as-is in both themes)
 */

import { COLOR_PALETTE } from "./ColorPalette";
import type { SemanticColor } from "./ColorPalette";

// Build a reverse lookup: "light|dark" → SemanticColor
const dualHexToName = new Map<string, SemanticColor>();
for (const color of COLOR_PALETTE) {
  dualHexToName.set(`${color.light}|${color.dark}`, color);
}

// ─── Format Detection ────────────────────────────────────────

/** Check if a colorId uses the dual-hex `"#light|#dark"` format. */
export function isDualHex(colorId: string): boolean {
  return colorId.includes("|");
}

// ─── Parsing / Encoding ──────────────────────────────────────

export interface ColorPair {
  light: string;
  dark: string;
}

/**
 * Parse a colorId into a light/dark hex pair.
 * - Dual-hex strings are split on `|`.
 * - Single hex strings are used for both themes.
 * - Unknown strings fall back to black/white.
 */
export function parseColorId(colorId: string): ColorPair {
  if (isDualHex(colorId)) {
    const [light, dark] = colorId.split("|");
    return { light, dark };
  }

  if (colorId.startsWith("#")) {
    return { light: colorId, dark: colorId };
  }

  // Unknown — fallback
  return { light: "#1a1a1a", dark: "#e8e8e8" };
}

/**
 * Reverse-map a dual-hex colorId to a palette display name.
 * Returns the palette name (e.g. "Black") for known colors,
 * or the raw colorId for custom/unknown colors.
 */
export function getColorDisplayName(colorId: string): string {
  const entry = dualHexToName.get(colorId);
  return entry ? entry.name : colorId;
}

/** Encode a light/dark hex pair into the dual-hex string format. */
export function encodeDualHex(light: string, dark: string): string {
  return `${light}|${dark}`;
}

// ─── Hex ↔ RGB ───────────────────────────────────────────────

/** Parse a hex color string to RGB components (0-255). */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, "");

  // Expand shorthand (#ABC → #AABBCC)
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }

  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Convert RGB components (0-255) to a hex color string. */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    "#" +
    clamp(r).toString(16).padStart(2, "0") +
    clamp(g).toString(16).padStart(2, "0") +
    clamp(b).toString(16).padStart(2, "0")
  );
}

// ─── Luminance ──────────────────────────────────────────────

/**
 * Calculate perceived luminance (0-255) of a hex color.
 * Uses standard ITU-R BT.601 weights: 0.299*R + 0.587*G + 0.114*B.
 */
export function perceivedLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Returns true if a hex color is perceptually "light" (luminance > 128).
 */
export function isLightColor(hex: string): boolean {
  return perceivedLuminance(hex) > 128;
}

// ─── Page Background Resolution ─────────────────────────────

/** Paper fill colors for light/dark themes */
export const PAPER_COLORS = {
  light: "#fffff8",
  dark: "#1e1e1e",
};

export interface ResolvedPageBackground {
  paperColor: string;           // Hex color to fill the page with
  patternTheme: "light" | "dark";  // Which pattern color set to use
}

/**
 * Resolve the effective paper fill color and pattern theme for a page.
 *
 * @param backgroundColor - Page's backgroundColor ("auto"/"light"/"dark"/hex). Undefined treated as "auto".
 * @param backgroundColorTheme - Page's backgroundColorTheme ("auto"/"light"/"dark"). Undefined treated as "auto".
 * @param isDarkMode - Whether Obsidian is currently in dark mode.
 */
export function resolvePageBackground(
  backgroundColor: string | undefined,
  backgroundColorTheme: string | undefined,
  isDarkMode: boolean,
): ResolvedPageBackground {
  const bg = backgroundColor ?? "auto";
  const bgt = backgroundColorTheme ?? "auto";

  // 1. Determine paper fill color
  let paperColor: string;
  if (bg === "auto") {
    paperColor = isDarkMode ? PAPER_COLORS.dark : PAPER_COLORS.light;
  } else if (bg === "light") {
    paperColor = PAPER_COLORS.light;
  } else if (bg === "dark") {
    paperColor = PAPER_COLORS.dark;
  } else {
    // hex string
    paperColor = bg;
  }

  // 2. Determine pattern theme
  let patternTheme: "light" | "dark";
  if (bgt === "light" || bgt === "dark") {
    // User override
    patternTheme = bgt;
  } else {
    // Auto-detect
    if (bg === "auto") {
      patternTheme = isDarkMode ? "dark" : "light";
    } else if (bg === "light") {
      patternTheme = "light";
    } else if (bg === "dark") {
      patternTheme = "dark";
    } else {
      // hex — compute from luminance
      patternTheme = isLightColor(bg) ? "light" : "dark";
    }
  }

  return { paperColor, patternTheme };
}

// ─── Hex ↔ HSL ───────────────────────────────────────────────

/** Convert a hex color to HSL. Returns [h (0-360), s (0-1), l (0-1)]. */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

/** Convert HSL to a hex color string. h: 0-360, s: 0-1, l: 0-1. */
export function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

// ─── RGB ↔ HSL (internal) ────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0) return [0, 0, l];

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) / 6;
  } else {
    h = ((rn - gn) / d + 4) / 6;
  }

  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;

  return [
    Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hn) * 255),
    Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  ];
}
