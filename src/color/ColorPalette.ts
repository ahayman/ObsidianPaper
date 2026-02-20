/**
 * Color palette with light/dark pairs for theme-aware rendering.
 * Strokes store dual-hex color IDs ("#light|#dark"), not semantic names.
 */

export interface SemanticColor {
  id: string;
  name: string;
  light: string;
  dark: string;
}

export const COLOR_PALETTE: SemanticColor[] = [
  { id: "ink-black", name: "Black", light: "#1a1a1a", dark: "#e8e8e8" },
  { id: "ink-gray", name: "Gray", light: "#6b7280", dark: "#9ca3af" },
  { id: "ink-red", name: "Red", light: "#dc2626", dark: "#f87171" },
  { id: "ink-orange", name: "Orange", light: "#ea580c", dark: "#fb923c" },
  { id: "ink-blue", name: "Blue", light: "#2563eb", dark: "#60a5fa" },
  { id: "ink-green", name: "Green", light: "#16a34a", dark: "#4ade80" },
  { id: "ink-purple", name: "Purple", light: "#7c3aed", dark: "#a78bfa" },
  { id: "ink-pink", name: "Pink", light: "#db2777", dark: "#f472b6" },
  { id: "ink-brown", name: "Brown", light: "#92400e", dark: "#d97706" },
  { id: "ink-teal", name: "Teal", light: "#0d9488", dark: "#2dd4bf" },
];

/**
 * Resolve a color ID to a hex value based on dark mode state.
 * Supports two formats:
 *   - Dual hex:   "#light|#dark" → picks the appropriate side
 *   - Single hex: "#AABBCC" → returned as-is
 * Unknown strings fall back to a default color.
 */
export function resolveColor(colorId: string, isDarkMode: boolean): string {
  // Dual-hex format: "#light|#dark"
  if (colorId.includes("|")) {
    const [light, dark] = colorId.split("|");
    return isDarkMode ? dark : light;
  }

  if (colorId.startsWith("#")) return colorId;

  // Unknown — fallback
  return isDarkMode ? "#e8e8e8" : "#1a1a1a";
}
