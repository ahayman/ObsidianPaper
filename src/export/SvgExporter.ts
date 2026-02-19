import type { PaperDocument, Stroke, PenStyle } from "../types";
import { decodePoints } from "../document/PointEncoder";
import { generateOutline } from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import { computePageLayout, getDocumentBounds } from "../document/PageLayout";

/**
 * Export a PaperDocument to SVG format.
 * Each page is rendered as a clipped group with strokes inside.
 */
export function exportToSvg(doc: PaperDocument, isDarkMode: boolean): string {
  const pageLayout = computePageLayout(doc.pages, doc.layoutDirection);

  if (pageLayout.length === 0 && doc.strokes.length === 0) {
    return buildSvg(0, 0, 100, 100, [], isDarkMode);
  }

  // Compute viewBox from page layout bounds
  const bounds = getDocumentBounds(pageLayout);
  const padding = 20;
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const width = (bounds.maxX - bounds.minX) + padding * 2;
  const height = (bounds.maxY - bounds.minY) + padding * 2;

  // Generate SVG elements: page backgrounds + clipped stroke groups
  const elements: string[] = [];

  const paperBg = isDarkMode ? "#1e1e1e" : "#fffff8";

  for (const pageRect of pageLayout) {
    // Page background rect
    elements.push(
      `  <rect x="${round(pageRect.x)}" y="${round(pageRect.y)}" width="${round(pageRect.width)}" height="${round(pageRect.height)}" fill="${escapeXml(paperBg)}"/>`
    );

    // Clip definition ID
    const clipId = `page-clip-${pageRect.pageIndex}`;
    elements.push(
      `  <clipPath id="${clipId}">`,
      `    <rect x="${round(pageRect.x)}" y="${round(pageRect.y)}" width="${round(pageRect.width)}" height="${round(pageRect.height)}"/>`,
      `  </clipPath>`
    );

    // Strokes for this page, clipped
    const pageStrokes = doc.strokes.filter(s => s.pageIndex === pageRect.pageIndex);
    if (pageStrokes.length > 0) {
      elements.push(`  <g clip-path="url(#${clipId})">`);
      for (const stroke of pageStrokes) {
        const style = resolveStyle(stroke, doc.styles);
        const pathEl = strokeToSvgPath(stroke, style, isDarkMode);
        if (pathEl) {
          elements.push(`  ${pathEl}`);
        }
      }
      elements.push(`  </g>`);
    }
  }

  return buildSvg(minX, minY, width, height, elements, isDarkMode);
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
  elements: string[],
  isDarkMode: boolean
): string {
  const deskBg = isDarkMode ? "#111111" : "#e8e8e8";
  const viewBox = `${round(minX)} ${round(minY)} ${round(width)} ${round(height)}`;

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${round(width)}" height="${round(height)}">`,
    `  <rect x="${round(minX)}" y="${round(minY)}" width="${round(width)}" height="${round(height)}" fill="${escapeXml(deskBg)}"/>`,
    ...elements,
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
