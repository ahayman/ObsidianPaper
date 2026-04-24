import type { PaperDocument, PenStyle, Stroke } from "../types";
import { decodePoints } from "../document/PointEncoder";
import { generateStrokePath } from "../stroke/OutlineGenerator";
import { computePageLayout } from "../document/PageLayout";
import { getPenConfig } from "../stroke/PenConfigs";

/** DPI tuned for handwriting OCR. 150 is comfortable for cloud services that
 *  expect 100–300 DPI. Higher uses more bandwidth; lower loses detail. */
export const OCR_RENDER_DPI = 150;
const WORLD_DPI = 72;

export interface RasterizedPage {
  pageIndex: number;
  blob: Blob;
  widthPx: number;
  heightPx: number;
}

/**
 * Rasterize every page of a document to PNG blobs suitable for OCR upload.
 * Renders a white background with black ink to maximize contrast; per-pen
 * styling (color, opacity, pen type) is intentionally ignored.
 */
export async function rasterizeDocument(
  doc: PaperDocument,
  dpi: number = OCR_RENDER_DPI,
): Promise<RasterizedPage[]> {
  const results: RasterizedPage[] = [];
  for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
    const raster = await rasterizePage(doc, pageIndex, dpi);
    if (raster) results.push(raster);
  }
  return results;
}

/**
 * Rasterize a single page to a PNG blob.
 * Returns null if the page has no strokes — no point sending a blank image
 * to OCR and paying for it.
 */
export async function rasterizePage(
  doc: PaperDocument,
  pageIndex: number,
  dpi: number = OCR_RENDER_DPI,
): Promise<RasterizedPage | null> {
  const page = doc.pages[pageIndex];
  if (!page) return null;

  const pageStrokes = doc.strokes.filter((s) => s.pageIndex === pageIndex);
  if (pageStrokes.length === 0) return null;

  // Pages are positioned in world space via computePageLayout (vertical
  // layout centers on X=0 → rect.x is negative). We must translate so
  // the page's top-left lands at canvas (0, 0), otherwise strokes on
  // the left half of the page fall off the canvas and OCR sees blank.
  const layout = computePageLayout(doc.pages, doc.layoutDirection);
  const pageRect = layout.find((r) => r.pageIndex === pageIndex);
  if (!pageRect) return null;

  const scale = dpi / WORLD_DPI;
  const widthPx = Math.max(1, Math.ceil(pageRect.width * scale));
  const heightPx = Math.max(1, Math.ceil(pageRect.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create 2D canvas context for rasterizing");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-pageRect.x, -pageRect.y);

  for (const stroke of pageStrokes) {
    renderStrokeForOcr(ctx, stroke, doc.styles);
  }
  ctx.restore();

  const blob = await canvasToPngBlob(canvas);
  return { pageIndex, blob, widthPx, heightPx };
}

function renderStrokeForOcr(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  styles: Record<string, PenStyle>,
): void {
  // Use the stroke's actual pen style so generateStrokePath produces the
  // right outline shape (pencils, fountain pens, felt-tips differ). Color
  // and opacity are then overridden for OCR contrast. Previously we
  // forced a ballpoint style here which generated wrong-shaped paths
  // for any non-ballpoint stroke.
  const base: PenStyle = styles[stroke.style] ?? {
    pen: "ballpoint",
    color: "#000000",
    width: 2,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 1,
    tiltSensitivity: 0,
  };
  const style: PenStyle = stroke.styleOverrides
    ? { ...base, ...stroke.styleOverrides }
    : base;

  // Highlighters are marking, not text — they'd just smear a big rectangle
  // over whatever's underneath, hurting OCR. Skip them.
  const penConfig = getPenConfig(style.pen);
  if (penConfig.highlighterMode) return;

  const points = decodePoints(stroke.pts);
  const path = generateStrokePath(points, style);
  if (!path) return;

  ctx.save();
  if (stroke.transform) {
    const [a, b, c, d, tx, ty] = stroke.transform;
    ctx.transform(a, b, c, d, tx, ty);
  }
  ctx.fillStyle = "#000000";
  ctx.globalAlpha = 1;
  ctx.fill(path);
  ctx.restore();
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("canvas.toBlob returned null"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}
