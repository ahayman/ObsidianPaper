import type { PaperDocument, PenStyle, Stroke } from "../types";
import { decodePoints } from "../document/PointEncoder";
import { generateStrokePath } from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import { deserializeDocument } from "../document/Serializer";

/**
 * Compute the bounding box of all strokes in a document.
 * Returns [minX, minY, maxX, maxY] or null if no strokes.
 */
function computeDocBBox(
  doc: PaperDocument
): [number, number, number, number] | null {
  if (doc.strokes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of doc.strokes) {
    const [sMinX, sMinY, sMaxX, sMaxY] = stroke.bbox;
    if (sMinX < minX) minX = sMinX;
    if (sMinY < minY) minY = sMinY;
    if (sMaxX > maxX) maxX = sMaxX;
    if (sMaxY > maxY) maxY = sMaxY;
  }

  return [minX, minY, maxX, maxY];
}

/**
 * Render a static preview of a PaperDocument onto a canvas.
 * Fits all strokes into the canvas with padding.
 */
export function renderEmbed(
  canvas: HTMLCanvasElement,
  data: string,
  isDarkMode: boolean,
  maxWidth: number
): void {
  const doc = deserializeDocument(data);

  const bbox = computeDocBBox(doc);
  if (!bbox) {
    // No strokes — render empty background
    canvas.width = maxWidth;
    canvas.height = Math.round(maxWidth * 0.5);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = isDarkMode ? "#1e1e1e" : "#fffff8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const padding = 20;
  const [minX, minY, maxX, maxY] = bbox;
  const contentWidth = maxX - minX + padding * 2;
  const contentHeight = maxY - minY + padding * 2;

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

  // Background
  ctx.fillStyle = isDarkMode ? "#1e1e1e" : "#fffff8";
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  // Apply transform to center content
  ctx.scale(scale, scale);
  ctx.translate(-minX + padding, -minY + padding);

  // Render all strokes
  for (const stroke of doc.strokes) {
    renderStroke(ctx, stroke, doc.styles, isDarkMode);
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
 * Compute the aspect ratio (width/height) of a paper document based on its content.
 */
export function getDocumentAspectRatio(data: string): number {
  const doc = deserializeDocument(data);
  const bbox = computeDocBBox(doc);
  if (!bbox) {
    return doc.canvas.width / doc.canvas.height;
  }
  const [minX, minY, maxX, maxY] = bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  if (h <= 0) return 2;
  return w / h;
}
