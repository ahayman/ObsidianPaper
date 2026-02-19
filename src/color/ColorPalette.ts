/**
 * Semantic color palette with light/dark pairs.
 * Strokes store color IDs, not hex values — enabling automatic theme switching.
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

const colorMap = new Map<string, SemanticColor>();
for (const color of COLOR_PALETTE) {
  colorMap.set(color.id, color);
}

/**
 * Resolve a color ID to a hex value based on dark mode state.
 * If the ID is already a hex color (starts with #), returns it directly.
 * If the ID is unknown, returns a default color.
 */
export function resolveColor(colorId: string, isDarkMode: boolean): string {
  if (colorId.startsWith("#")) return colorId;

  const semantic = colorMap.get(colorId);
  if (!semantic) {
    return isDarkMode ? "#e8e8e8" : "#1a1a1a";
  }

  return isDarkMode ? semantic.dark : semantic.light;
}

/**
 * Get the semantic color entry by ID.
 */
export function getSemanticColor(colorId: string): SemanticColor | undefined {
  return colorMap.get(colorId);
}

/**
 * Check if a color ID is a semantic color (not a raw hex).
 */
export function isSemanticColor(colorId: string): boolean {
  return colorMap.has(colorId);
}
