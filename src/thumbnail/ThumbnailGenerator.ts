import type { PaperDocument, Page, Stroke } from "../types";
import { decodePoints } from "../document/PointEncoder";
import { generateStrokePath } from "../stroke/OutlineGenerator";
import { resolveColor } from "../color/ColorPalette";
import { getPenConfig } from "../stroke/PenConfigs";
import { computePageLayout } from "../document/PageLayout";

const WORLD_DPI = 72;

/**
 * Identity hash for the inputs that determine a thumbnail. Changes only
 * when the visual content of the first page changes, so the pipeline
 * can skip regen when the OCR run, frontmatter edits, or later pages
 * are what triggered the vault-modify event.
 */
export function firstPageHash(doc: PaperDocument): string {
  const page = doc.pages[0];
  if (!page) return "empty";
  const strokes = doc.strokes.filter((s) => s.pageIndex === 0);
  if (strokes.length === 0) return "blank";

  // Stroke IDs + bbox + point count are enough — if any of these change,
  // the first page's visual changed. Sorted so iteration order doesn't
  // affect the hash.
  const parts = strokes
    .map((s) => `${s.id}:${s.bbox.join(",")}:${s.pointCount}`)
    .sort()
    .join("|");
  return `${page.size.width}x${page.size.height}|${parts}`;
}

/**
 * Render the first page of a document to a PNG blob using preview-style
 * rendering (paper background, colored ink). Returns null if the page
 * has no strokes — we don't save blank thumbnails.
 *
 * Uses computePageLayout so the rasterizer gets page 0's actual world
 * rect (orientation + centered-x offset); translating by -rect.x/-rect.y
 * maps page-local coords to canvas-local coords. Without that step
 * strokes on the left half of the page fall off the canvas since
 * vertical layout centers pages on world X=0 (rect.x = -width/2).
 */
export async function renderFirstPageThumbnail(
  doc: PaperDocument,
  maxWidth: number,
  isDarkMode: boolean,
): Promise<{ blob: Blob; widthPx: number; heightPx: number } | null> {
  if (!doc.pages[0]) return null;
  const strokes = doc.strokes.filter((s) => s.pageIndex === 0);
  if (strokes.length === 0) return null;

  const layout = computePageLayout(doc.pages, doc.layoutDirection);
  const pageRect = layout.find((r) => r.pageIndex === 0);
  if (!pageRect) return null;

  const scale = Math.min(1, maxWidth / pageRect.width);
  const widthPx = Math.max(1, Math.round(pageRect.width * scale));
  const heightPx = Math.max(1, Math.round(pageRect.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create 2D canvas context for thumbnail");

  ctx.fillStyle = isDarkMode ? "#1e1e1e" : "#fffff8";
  ctx.fillRect(0, 0, widthPx, heightPx);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-pageRect.x, -pageRect.y);
  for (const stroke of strokes) {
    renderStrokeForThumbnail(ctx, stroke, doc.styles, isDarkMode);
  }
  ctx.restore();

  const blob = await canvasToPngBlob(canvas);
  return { blob, widthPx, heightPx };
}

function renderStrokeForThumbnail(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  styles: PaperDocument["styles"],
  isDarkMode: boolean,
): void {
  const base = styles[stroke.style];
  const style = !stroke.styleOverrides || !base
    ? base ?? {
        pen: "ballpoint" as const,
        color: "#1a1a1a",
        width: 2,
        opacity: 1,
        smoothing: 0.5,
        pressureCurve: 1,
        tiltSensitivity: 0,
      }
    : { ...base, ...stroke.styleOverrides };

  const points = decodePoints(stroke.pts);
  const path = generateStrokePath(points, style);
  if (!path) return;

  const color = resolveColor(style.color, isDarkMode);
  const penConfig = getPenConfig(style.pen);

  ctx.save();
  if (stroke.transform) {
    const [a, b, c, d, tx, ty] = stroke.transform;
    ctx.transform(a, b, c, d, tx, ty);
  }
  if (penConfig.highlighterMode) {
    ctx.globalAlpha = penConfig.baseOpacity;
    ctx.globalCompositeOperation = "multiply";
  } else {
    ctx.globalAlpha = style.opacity;
  }
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("canvas.toBlob returned null"));
      else resolve(blob);
    }, "image/png");
  });
}

/**
 * Compute the thumbnail's relative path (within the vault) for a given
 * source file path and configured subfolder. Keeps the source basename
 * and appends `.png`.
 */
export function thumbnailPathFor(sourcePath: string, subfolder: string): string {
  const lastSlash = sourcePath.lastIndexOf("/");
  const folder = lastSlash === -1 ? "" : sourcePath.slice(0, lastSlash);
  const base = sourcePath.slice(lastSlash + 1).replace(/\.paper\.md$/i, "");
  const cleanSub = subfolder.replace(/^\/+|\/+$/g, "");
  const prefix = folder.length > 0
    ? (cleanSub ? `${folder}/${cleanSub}` : folder)
    : cleanSub;
  const filename = `${base}.paper.png`;
  return prefix ? `${prefix}/${filename}` : filename;
}

/**
 * Format the thumbnail path for a frontmatter property. Returns a
 * single-item list containing a wikilink string — this is Obsidian's
 * canonical "list of links" property shape. A bare string value like
 * "[[foo]]" is unreliable: YAML sees `[[` as a flow-sequence opener
 * and Obsidian's frontmatter layer sometimes drops the property when
 * quoting is lost on round-trip.
 */
export function thumbnailFrontmatterValue(thumbPath: string): string[] {
  return [`[[${thumbPath}]]`];
}

/**
 * FNV-1a 32-bit hash rendered as 8 hex chars. Used as a compact cache
 * key for detecting first-page changes.
 */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
