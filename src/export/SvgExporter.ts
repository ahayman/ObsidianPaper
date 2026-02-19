import type { PaperDocument, Stroke, PenStyle } from "../types";
import { decodePoints } from "../document/PointEncoder";
import { generateOutline } from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";

/**
 * Export a PaperDocument to SVG format.
 * Each stroke is rendered as a filled <path> element.
 */
export function exportToSvg(doc: PaperDocument, isDarkMode: boolean): string {
  if (doc.strokes.length === 0) {
    return buildSvg(0, 0, 100, 100, [], isDarkMode, doc.canvas.backgroundColor);
  }

  // Compute content bounding box from all strokes
  const contentBbox = computeContentBbox(doc.strokes);
  const padding = 20;
  const minX = contentBbox[0] - padding;
  const minY = contentBbox[1] - padding;
  const width = contentBbox[2] - contentBbox[0] + padding * 2;
  const height = contentBbox[3] - contentBbox[1] + padding * 2;

  // Generate SVG path elements for each stroke
  const pathElements: string[] = [];
  for (const stroke of doc.strokes) {
    const style = resolveStyle(stroke, doc.styles);
    const pathEl = strokeToSvgPath(stroke, style, isDarkMode);
    if (pathEl) {
      pathElements.push(pathEl);
    }
  }

  return buildSvg(minX, minY, width, height, pathElements, isDarkMode, doc.canvas.backgroundColor);
}

function computeContentBbox(strokes: readonly Stroke[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    if (stroke.bbox[0] < minX) minX = stroke.bbox[0];
    if (stroke.bbox[1] < minY) minY = stroke.bbox[1];
    if (stroke.bbox[2] > maxX) maxX = stroke.bbox[2];
    if (stroke.bbox[3] > maxY) maxY = stroke.bbox[3];
  }

  return [minX, minY, maxX, maxY];
}

function strokeToSvgPath(
  stroke: Stroke,
  style: PenStyle,
  isDarkMode: boolean
): string | null {
  const points = decodePoints(stroke.pts);
  if (points.length === 0) return null;

  const outline = generateOutline(points, style);
  if (outline.length < 2) return null;

  const color = resolveColor(style.color, isDarkMode);
  const penConfig = getPenConfig(style.pen);

  // Build SVG path data from outline polygon
  const d = outlineToPathData(outline);

  const attrs: string[] = [`d="${d}"`, `fill="${escapeXml(color)}"`];

  if (penConfig.highlighterMode) {
    attrs.push(`opacity="${penConfig.baseOpacity}"`);
    attrs.push(`style="mix-blend-mode:multiply"`);
  } else if (style.opacity < 1) {
    attrs.push(`opacity="${style.opacity}"`);
  }

  return `  <path ${attrs.join(" ")}/>`;
}

function outlineToPathData(outline: number[][]): string {
  const parts: string[] = [];
  parts.push(`M${round(outline[0][0])},${round(outline[0][1])}`);

  for (let i = 1; i < outline.length; i++) {
    parts.push(`L${round(outline[i][0])},${round(outline[i][1])}`);
  }

  parts.push("Z");
  return parts.join("");
}

function buildSvg(
  minX: number,
  minY: number,
  width: number,
  height: number,
  pathElements: string[],
  isDarkMode: boolean,
  backgroundColor: string
): string {
  const bgColor = backgroundColor || (isDarkMode ? "#1e1e1e" : "#ffffff");
  const viewBox = `${round(minX)} ${round(minY)} ${round(width)} ${round(height)}`;

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${round(width)}" height="${round(height)}">`,
    `  <rect x="${round(minX)}" y="${round(minY)}" width="${round(width)}" height="${round(height)}" fill="${escapeXml(bgColor)}"/>`,
    ...pathElements,
    `</svg>`,
  ];

  return lines.join("\n");
}

function resolveStyle(
  stroke: Stroke,
  styles: Record<string, PenStyle>
): PenStyle {
  const base = styles[stroke.style];
  if (!base) {
    return {
      pen: "ballpoint",
      color: "#1a1a1a",
      width: 2,
      opacity: 1,
      smoothing: 0.5,
      pressureCurve: 1,
      tiltSensitivity: 0,
    };
  }
  if (!stroke.styleOverrides) return base;
  return { ...base, ...stroke.styleOverrides };
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
