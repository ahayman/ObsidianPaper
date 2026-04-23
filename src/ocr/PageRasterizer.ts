import type { PaperDocument, Stroke } from "../types";
import { decodePoints } from "../document/PointEncoder";
import { generateStrokePath } from "../stroke/OutlineGenerator";

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

  const scale = dpi / WORLD_DPI;
  const widthPx = Math.max(1, Math.ceil(page.size.width * scale));
  const heightPx = Math.max(1, Math.ceil(page.size.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create 2D canvas context for rasterizing");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);

  ctx.save();
  ctx.scale(scale, scale);

  for (const stroke of pageStrokes) {
    renderStrokeForOcr(ctx, stroke);
  }
  ctx.restore();

  const blob = await canvasToPngBlob(canvas);
  return { pageIndex, blob, widthPx, heightPx };
}

function renderStrokeForOcr(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const points = decodePoints(stroke.pts);
  // Ignore per-pen styling — force a single black outline for OCR contrast.
  const path = generateStrokePath(points, {
    pen: "ballpoint",
    color: "#000000",
    width: 2.5,
    opacity: 1,
    smoothing: 0.5,
    pressureCurve: 1,
    tiltSensitivity: 0,
  });
  if (!path) return;

  ctx.save();
  if (stroke.transform) {
    const [a, b, c, d, tx, ty] = stroke.transform;
    ctx.transform(a, b, c, d, tx, ty);
  }
  ctx.fillStyle = "#000000";
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
