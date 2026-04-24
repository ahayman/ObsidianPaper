import type { PaperDocument, Stroke } from "../types";
import { OCR_RESULT_VERSION, type OcrResult, type OcrPageResult, type OcrLine } from "../document/PaperMdSerializer";
import type { OcrBackend, OcrPageBitmap, OcrProgress } from "./OcrBackend";
import { rasterizePage } from "./PageRasterizer";
import { clusterStrokesIntoLines } from "./LineClusterer";

export type PageRasterizer = (doc: PaperDocument, pageIndex: number) => Promise<OcrPageBitmap | null>;

const defaultRasterizer: PageRasterizer = async (doc, pageIndex) => {
  const r = await rasterizePage(doc, pageIndex);
  if (!r) return null;
  return { pageIndex: r.pageIndex, blob: r.blob };
};

export interface IncrementalOcrRunInput {
  document: PaperDocument;
  previous: OcrResult | null;
  backend: OcrBackend;
  onProgress?: (status: OcrProgress & { pagesReused: number; pagesRecognizing: number }) => void;
  /** Optional override for tests. Defaults to PageRasterizer.rasterizePage. */
  rasterize?: PageRasterizer;
  /** Invoked with each rasterized page right before it's sent to the backend.
   *  Handy for debug sidecars (save the PNG the service is actually seeing). */
  onRasterized?: (page: OcrPageBitmap) => void | Promise<void>;
}

export interface IncrementalOcrRunResult {
  ocr: OcrResult;
  /** Pages that were re-OCR'd (cost paid to the backend). */
  pagesRecognized: number;
  /** Pages reused from the previous OCR result (no cost). */
  pagesReused: number;
  /** Pages skipped entirely because they had no strokes. */
  pagesEmpty: number;
}

/**
 * Run OCR with page-level incremental skipping.
 *
 * For each page:
 *  - If there are no strokes: omit from the result (don't pay to recognize
 *    blank pages).
 *  - If the stroke IDs match a previous page exactly: reuse the old lines.
 *  - Otherwise: rasterize and send to the backend.
 *
 * The returned result has stable stroke-to-line mapping where possible
 * (assigned by Y-order when OCR line count matches cluster count).
 */
export async function runIncrementalOcr(
  input: IncrementalOcrRunInput,
): Promise<IncrementalOcrRunResult> {
  const { document, previous, backend, onProgress, onRasterized, rasterize = defaultRasterizer } = input;

  const prevByPage = indexPreviousResultByPageIndex(previous);

  interface PagePlan {
    pageIndex: number;
    strokes: Stroke[];
    strokeIdsSorted: string[];
    reusePrev?: OcrPageResult;
  }

  const plans: PagePlan[] = [];
  for (let pageIndex = 0; pageIndex < document.pages.length; pageIndex++) {
    const strokes = document.strokes.filter((s) => s.pageIndex === pageIndex);
    if (strokes.length === 0) continue;

    const strokeIdsSorted = [...strokes.map((s) => s.id)].sort();
    const prev = prevByPage.get(pageIndex);
    const canReuse = !!prev && arraysEqual(prev.pageStrokeIds ?? [], strokeIdsSorted);

    plans.push({
      pageIndex,
      strokes,
      strokeIdsSorted,
      reusePrev: canReuse ? prev : undefined,
    });
  }

  const recognizingCount = plans.filter((p) => !p.reusePrev).length;
  const reusedCount = plans.length - recognizingCount;

  const pages: OcrPageResult[] = [];
  let dirtyIdx = 0;

  for (const plan of plans) {
    if (plan.reusePrev) {
      pages.push({
        ...plan.reusePrev,
        pageStrokeIds: plan.strokeIdsSorted,
      });
      continue;
    }

    dirtyIdx++;

    // Stroke-based backends (MyScript) consume the raw strokes directly;
    // image-based backends (Handwriting OCR) take a rasterized PNG blob.
    // The backend declares which it wants via inputType.
    let pageInput: OcrPageBitmap;
    if (backend.inputType === "strokes") {
      pageInput = { pageIndex: plan.pageIndex, strokes: plan.strokes };
    } else {
      const rastered = await rasterize(document, plan.pageIndex);
      if (!rastered) continue;
      if (onRasterized) await onRasterized(rastered);
      pageInput = rastered;
    }

    const result = await backend.recognizeDocument({
      pages: [pageInput],
      onProgress: onProgress
        ? (p) => onProgress({ ...p, pagesReused: reusedCount, pagesRecognizing: recognizingCount })
        : undefined,
    });

    const backendPage = result.pages[0];
    if (!backendPage) continue;

    pages.push({
      pageIndex: plan.pageIndex,
      lines: attachStrokeIdsToLines(backendPage.lines, plan.strokes),
      pageStrokeIds: plan.strokeIdsSorted,
    });
  }

  pages.sort((a, b) => a.pageIndex - b.pageIndex);

  return {
    ocr: {
      v: OCR_RESULT_VERSION,
      backend: backend.id,
      pages,
    },
    pagesRecognized: recognizingCount,
    pagesReused: reusedCount,
    pagesEmpty: document.pages.length - plans.length,
  };
}

function indexPreviousResultByPageIndex(
  prev: OcrResult | null,
): Map<number, OcrPageResult> {
  const map = new Map<number, OcrPageResult>();
  if (!prev) return map;
  for (const page of prev.pages) map.set(page.pageIndex, page);
  return map;
}

/**
 * Count how many pages would be sent to the backend if we ran incremental
 * OCR right now (does not perform any I/O). Used by quota checks.
 */
export function countDirtyPages(doc: PaperDocument, previous: OcrResult | null): number {
  const prevByPage = indexPreviousResultByPageIndex(previous);
  let count = 0;
  for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
    const strokes = doc.strokes.filter((s) => s.pageIndex === pageIndex);
    if (strokes.length === 0) continue;
    const strokeIdsSorted = [...strokes.map((s) => s.id)].sort();
    const prev = prevByPage.get(pageIndex);
    const canReuse = !!prev && arraysEqual(prev.pageStrokeIds ?? [], strokeIdsSorted);
    if (!canReuse) count++;
  }
  return count;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Best-effort assignment of stroke IDs to OCR lines based on Y-cluster order.
 * Only attached when the cluster count matches the OCR line count (otherwise
 * we can't be confident which strokes belong to which line and the field
 * stays undefined).
 */
export function attachStrokeIdsToLines(
  lines: OcrLine[],
  strokes: readonly Stroke[],
): OcrLine[] {
  if (lines.length === 0) return lines;
  const clusters = clusterStrokesIntoLines(strokes);
  if (clusters.length !== lines.length) return lines;

  return lines.map((line, i) => ({
    ...line,
    strokeIds: clusters[i].strokeIds,
    bbox: line.bbox ?? clusters[i].bbox,
  }));
}
