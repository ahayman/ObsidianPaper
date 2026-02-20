/**
 * Extended color palette for the Simple color picker mode.
 *
 * 48 colors arranged in an 8-column × 6-row grid.
 * Each column is a single hue family. Rows go dark (top) → light (bottom).
 * Each color has hand-tuned light and dark theme variants.
 *
 * Two palette variants:
 *   - EXTENDED_PALETTE (brightness-matched): both theme variants have
 *     similar brightness. Both go dark→light top-to-bottom.
 *   - EXTENDED_PALETTE_CONTRAST (contrast-matched): dark-theme variants
 *     are inverted so both themes have similar contrast against their
 *     respective backgrounds. Light goes dark→light, dark goes light→dark.
 *
 * Columns: Red, Orange, Green, Teal, Blue, Purple, Pink, Neutral
 * The original 10 COLOR_PALETTE entries are included for compatibility.
 */

import type { SemanticColor } from "./ColorPalette";
import { perceivedLuminance } from "./ColorUtils";

/** Grid dimensions for the Simple picker layout. */
export const PALETTE_COLUMNS = 8;
export const PALETTE_ROWS = 6;

/**
 * Extended palette ordered row-by-row (left-to-right, top-to-bottom).
 * Row 0 = darkest shades, Row 5 = lightest tints.
 * Columns: Red, Orange, Green, Teal, Blue, Purple, Pink, Neutral
 */
export const EXTENDED_PALETTE: SemanticColor[] = [
  // ── Row 0: Darkest ────────────────────────────────────────
  { id: "ext-red-900", name: "Deep Red", light: "#7f1d1d", dark: "#b91c1c" },
  { id: "ext-orange-900", name: "Deep Brown", light: "#78350f", dark: "#b45309" },
  { id: "ext-green-900", name: "Deep Green", light: "#14532d", dark: "#166534" },
  { id: "ext-teal-900", name: "Deep Teal", light: "#134e4a", dark: "#115e59" },
  { id: "ext-blue-900", name: "Navy", light: "#1e3a5f", dark: "#1e40af" },
  { id: "ext-purple-900", name: "Deep Indigo", light: "#312e81", dark: "#818cf8" },
  { id: "ext-pink-900", name: "Deep Pink", light: "#831843", dark: "#be185d" },
  { id: "ink-black", name: "Black", light: "#1a1a1a", dark: "#e8e8e8" },

  // ── Row 1: Dark ───────────────────────────────────────────
  { id: "ext-red-700", name: "Dark Red", light: "#991b1b", dark: "#dc2626" },
  { id: "ink-brown", name: "Brown", light: "#92400e", dark: "#d97706" },
  { id: "ext-green-700", name: "Dark Green", light: "#166534", dark: "#16a34a" },
  { id: "ext-teal-700", name: "Dark Teal", light: "#115e59", dark: "#0d9488" },
  { id: "ext-blue-700", name: "Dark Blue", light: "#1e40af", dark: "#2563eb" },
  { id: "ext-purple-700", name: "Dark Purple", light: "#5b21b6", dark: "#7c3aed" },
  { id: "ext-pink-700", name: "Dark Pink", light: "#be185d", dark: "#db2777" },
  { id: "ext-charcoal", name: "Charcoal", light: "#374151", dark: "#9ca3af" },

  // ── Row 2: Medium (vivid) ─────────────────────────────────
  { id: "ink-red", name: "Red", light: "#dc2626", dark: "#f87171" },
  { id: "ink-orange", name: "Orange", light: "#ea580c", dark: "#fb923c" },
  { id: "ink-green", name: "Green", light: "#16a34a", dark: "#4ade80" },
  { id: "ink-teal", name: "Teal", light: "#0d9488", dark: "#2dd4bf" },
  { id: "ink-blue", name: "Blue", light: "#2563eb", dark: "#60a5fa" },
  { id: "ink-purple", name: "Purple", light: "#7c3aed", dark: "#a78bfa" },
  { id: "ink-pink", name: "Pink", light: "#db2777", dark: "#f472b6" },
  { id: "ink-gray", name: "Gray", light: "#6b7280", dark: "#9ca3af" },

  // ── Row 3: Medium-light ───────────────────────────────────
  { id: "ext-red-400", name: "Rose", light: "#f87171", dark: "#fca5a5" },
  { id: "ext-orange-400", name: "Amber", light: "#fb923c", dark: "#fdba74" },
  { id: "ext-green-400", name: "Mint", light: "#4ade80", dark: "#86efac" },
  { id: "ext-teal-400", name: "Aqua", light: "#2dd4bf", dark: "#5eead4" },
  { id: "ext-blue-400", name: "Sky Blue", light: "#60a5fa", dark: "#93c5fd" },
  { id: "ext-purple-400", name: "Orchid", light: "#a78bfa", dark: "#c4b5fd" },
  { id: "ext-pink-400", name: "Light Pink", light: "#f472b6", dark: "#f9a8d4" },
  { id: "ext-silver", name: "Silver", light: "#9ca3af", dark: "#d1d5db" },

  // ── Row 4: Light ──────────────────────────────────────────
  { id: "ext-red-300", name: "Soft Red", light: "#fca5a5", dark: "#fecaca" },
  { id: "ext-orange-300", name: "Soft Orange", light: "#fdba74", dark: "#fed7aa" },
  { id: "ext-green-300", name: "Soft Green", light: "#86efac", dark: "#bbf7d0" },
  { id: "ext-teal-300", name: "Soft Teal", light: "#5eead4", dark: "#99f6e4" },
  { id: "ext-blue-300", name: "Soft Blue", light: "#93c5fd", dark: "#bfdbfe" },
  { id: "ext-purple-300", name: "Lavender", light: "#c4b5fd", dark: "#ddd6fe" },
  { id: "ext-pink-300", name: "Soft Pink", light: "#f9a8d4", dark: "#fbcfe8" },
  { id: "ext-light-gray", name: "Light Gray", light: "#d1d5db", dark: "#e5e7eb" },

  // ── Row 5: Lightest tints ─────────────────────────────────
  { id: "ext-red-200", name: "Pale Red", light: "#fecaca", dark: "#fee2e2" },
  { id: "ext-orange-200", name: "Pale Orange", light: "#fed7aa", dark: "#ffedd5" },
  { id: "ext-green-200", name: "Pale Green", light: "#bbf7d0", dark: "#dcfce7" },
  { id: "ext-teal-200", name: "Pale Teal", light: "#99f6e4", dark: "#ccfbf1" },
  { id: "ext-blue-200", name: "Pale Blue", light: "#bfdbfe", dark: "#dbeafe" },
  { id: "ext-purple-200", name: "Pale Lavender", light: "#ddd6fe", dark: "#ede9fe" },
  { id: "ext-pink-200", name: "Pale Pink", light: "#fbcfe8", dark: "#fce7f3" },
  { id: "ext-white", name: "White", light: "#f5f5f4", dark: "#ffffff" },
];

/** Which pairing strategy the Simple picker uses. */
export type PaletteMode = "brightness" | "contrast";

/** Index of the neutral column (grayscale). */
const NEUTRAL_COL = 7;

/**
 * Build the contrast-matched palette from the brightness-matched one.
 *
 * For chromatic columns: reverse the dark values within each column so
 * the lightest dark value lands on row 0 (highest contrast on dark bg).
 *
 * For the neutral column: mirror the light values instead, because the
 * original dark neutrals don't span a useful range for inversion.
 *
 * After reordering, each column's dark values are sorted by perceived
 * luminance descending to guarantee a smooth gradient (fixes edge cases
 * like the purple column where the original order isn't monotonic).
 */
function buildContrastPalette(src: SemanticColor[]): SemanticColor[] {
  const result: SemanticColor[] = src.map((c) => ({ ...c }));

  for (let col = 0; col < PALETTE_COLUMNS; col++) {
    // Collect new dark values for this column
    const darkValues: string[] = [];

    if (col === NEUTRAL_COL) {
      // Mirror light values from opposite rows
      for (let row = PALETTE_ROWS - 1; row >= 0; row--) {
        darkValues.push(src[row * PALETTE_COLUMNS + col].light);
      }
    } else {
      // Reverse existing dark values
      for (let row = PALETTE_ROWS - 1; row >= 0; row--) {
        darkValues.push(src[row * PALETTE_COLUMNS + col].dark);
      }
    }

    // Sort by perceived luminance descending (lightest first = top row)
    darkValues.sort(
      (a, b) => perceivedLuminance(b) - perceivedLuminance(a)
    );

    // Assign back
    for (let row = 0; row < PALETTE_ROWS; row++) {
      result[row * PALETTE_COLUMNS + col].dark = darkValues[row];
    }
  }

  return result;
}

/**
 * Contrast-matched palette: dark-theme variants are inverted so that
 * row 0 has high contrast in both themes, row 5 has low contrast in both.
 */
export const EXTENDED_PALETTE_CONTRAST: SemanticColor[] =
  buildContrastPalette(EXTENDED_PALETTE);
