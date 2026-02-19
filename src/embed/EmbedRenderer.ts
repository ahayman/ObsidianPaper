import type { PenStyle, Stroke } from "../types";
import { decodePoints } from "../document/PointEncoder";
import { generateStrokePath } from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import { deserializeDocument } from "../document/Serializer";
import { computePageLayout, getDocumentBounds } from "../document/PageLayout";

/**
 * Render a static preview of a PaperDocument onto a canvas.
 * Renders pages with desk background, page backgrounds, and clipped strokes.
 */
export function renderEmbed(
  canvas: HTMLCanvasElement,
  data: string,
  isDarkMode: boolean,
  maxWidth: number
): void {
  const doc = deserializeDocument(data);
  const pageLayout = computePageLayout(doc.pages, doc.layoutDirection);

  if (pageLayout.length === 0) {
    // No pages — render empty background
    canvas.width = maxWidth;
    canvas.height = Math.round(maxWidth * 0.5);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = isDarkMode ? "#111111" : "#e8e8e8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const bounds = getDocumentBounds(pageLayout);
  const padding = 20;
  const contentWidth = (bounds.maxX - bounds.minX) + padding * 2;
  const contentHeight = (bounds.maxY - bounds.minY) + padding * 2;

  // Scale to fit within maxWidth while preserving aspect ratio
  const scale = Math.min(1, maxWidth / contentWidth);
  const displayWidth = Math.round(contentWidth * scale);
  const displayHeight = Math.round(contentHeight * scale);

  canvas.width = displayWidth;
  canvas.height = displayHeight;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Desk background
  ctx.fillStyle = isDarkMode ? "#111111" : "#e8e8e8";
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  // Apply transform to center content
  ctx.scale(scale, scale);
  ctx.translate(-bounds.minX + padding, -bounds.minY + padding);

  const paperBg = isDarkMode ? "#1e1e1e" : "#fffff8";

  // Render pages and strokes
  for (const pageRect of pageLayout) {
    // Page background
    ctx.fillStyle = paperBg;
    ctx.fillRect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);

    // Clip strokes to page
    ctx.save();
    ctx.beginPath();
    ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
    ctx.clip();

    for (const stroke of doc.strokes) {
      if (stroke.pageIndex === pageRect.pageIndex) {
        renderStroke(ctx, stroke, doc.styles, isDarkMode);
      }
    }

    ctx.restore();
  }
}

function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  styles: Record<string, PenStyle>,
  isDarkMode: boolean
): void {
  const style = resolveStyle(stroke, styles);
  const points = decodePoints(stroke.pts);
  const path = generateStrokePath(points, style);
  if (!path) return;

  const color = resolveColor(style.color, isDarkMode);
  const penConfig = getPenConfig(style.pen);

  if (penConfig.highlighterMode) {
    ctx.save();
    ctx.globalAlpha = penConfig.baseOpacity;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = color;
    ctx.fill(path);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.globalAlpha = style.opacity;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }
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

/**
 * Compute the aspect ratio (width/height) of a paper document based on its page layout.
 */
export function getDocumentAspectRatio(data: string): number {
  const doc = deserializeDocument(data);
  const pageLayout = computePageLayout(doc.pages, doc.layoutDirection);

  if (pageLayout.length === 0) {
    // Fallback: first page dimensions or default
    if (doc.pages.length > 0) {
      return doc.pages[0].size.width / doc.pages[0].size.height;
    }
    return 612 / 792; // US Letter
  }

  const bounds = getDocumentBounds(pageLayout);
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (h <= 0) return 2;
  return w / h;
}
