import type { PaperDocument } from "../types";
import type { OcrBackend, OcrPageInput, OcrProgress } from "./OcrBackend";
import { rasterizePage } from "./PageRasterizer";
import { documentPageFingerprints, dirtyPageIndices } from "./PageFingerprint";
import { parseTranscriptSections, buildTranscriptSections, demoteMarkdownHeadings } from "./TranscriptSections";

/** Levels to push every OCR-emitted ATX heading down by. The transcript
 *  uses `#` and `##` for its own structure, so anything from the backend
 *  needs to start at `###` or deeper. */
const OCR_HEADING_DEMOTION = 2;

export type PageRasterizer = (doc: PaperDocument, pageIndex: number) => Promise<OcrPageInput | null>;

const defaultRasterizer: PageRasterizer = async (doc, pageIndex) => {
  const r = await rasterizePage(doc, pageIndex);
  if (!r) return null;
  return { pageIndex: r.pageIndex, blob: r.blob };
};

export interface IncrementalOcrRunInput {
  document: PaperDocument;
  /** Per-page fingerprints captured at the previous OCR run (length = doc.pages.length;
   *  blank pages are `""`). Pass `undefined` if no prior run; every non-empty page
   *  becomes dirty. */
  previousPageFingerprints?: readonly string[];
  /** Existing `# Transcript` body. Reused verbatim for clean pages, replaced
   *  for dirty pages. Pass `""` if no prior transcript. */
  previousTranscript?: string;
  backend: OcrBackend;
  /** Skip the fp comparison and recognize every non-empty page. */
  force?: boolean;
  onProgress?: (status: OcrProgress & { pagesReused: number; pagesRecognizing: number }) => void;
  /** Optional override for tests. Defaults to PageRasterizer.rasterizePage. */
  rasterize?: PageRasterizer;
  /** Invoked with each rasterized page right before it's sent to the backend.
   *  Handy for debug sidecars (save the PNG the service is actually seeing). */
  onRasterized?: (page: OcrPageInput) => void | Promise<void>;
}

export interface IncrementalOcrRunResult {
  /** Updated transcript body to write back into the # Transcript section. */
  transcript: string;
  /** Updated per-page fingerprints to store in `paper-ocr-pages-fp` frontmatter. */
  pageFingerprints: string[];
  /** Pages re-recognized this run (cost paid to backend). */
  pagesRecognized: number;
  /** Pages whose transcript section was reused without re-recognition. */
  pagesReused: number;
  /** Pages with no strokes (always skipped). */
  pagesEmpty: number;
}

/**
 * Run OCR with per-page fingerprint-based incremental skipping.
 *
 * For each page:
 *  - Blank pages (no strokes): omitted from the result.
 *  - Fingerprint matches the previous run AND `force === false`: reuse the
 *    existing `## Page N` section from the prior transcript verbatim.
 *  - Otherwise: rasterize (image backends) or pass strokes through (stroke
 *    backends), send to the backend, replace that page's section.
 *
 * Returns the merged transcript (in 0-indexed page order) plus the fresh
 * fingerprint array to persist in frontmatter.
 */
export async function runIncrementalOcr(
  input: IncrementalOcrRunInput,
): Promise<IncrementalOcrRunResult> {
  const {
    document,
    previousPageFingerprints,
    previousTranscript = "",
    backend,
    force = false,
    onProgress,
    onRasterized,
    rasterize = defaultRasterizer,
  } = input;

  const currentFps = documentPageFingerprints(document);
  const previousByPage = parseTranscriptSections(previousTranscript);

  // Determine which pages need recognition this run.
  const dirty = force
    ? currentFps.map((fp, i) => (fp !== "" ? i : -1)).filter((i) => i >= 0)
    : dirtyPageIndices(currentFps, previousPageFingerprints);

  const totalNonEmpty = currentFps.filter((fp) => fp !== "").length;
  const pagesRecognizing = dirty.length;
  const pagesReused = totalNonEmpty - pagesRecognizing;
  const pagesEmpty = currentFps.length - totalNonEmpty;

  const sections = new Map<number, string>();

  // Carry forward clean pages' existing transcripts. A page is "clean" if it
  // has strokes (fp != "") and isn't in the dirty set.
  for (let i = 0; i < currentFps.length; i++) {
    if (currentFps[i] === "") continue;
    if (dirty.includes(i)) continue;
    const text = previousByPage.get(i);
    if (text) sections.set(i, text);
  }

  // Recognize dirty pages.
  for (let n = 0; n < dirty.length; n++) {
    input.onProgress?.bind(input);
    const pageIndex = dirty[n];
    const pageStrokes = document.strokes.filter((s) => s.pageIndex === pageIndex);

    let pageInput: OcrPageInput;
    if (backend.inputType === "strokes") {
      pageInput = { pageIndex, strokes: pageStrokes };
    } else {
      const rastered = await rasterize(document, pageIndex);
      if (!rastered) continue;
      if (onRasterized) await onRasterized(rastered);
      pageInput = rastered;
    }

    const result = await backend.recognizeDocument({
      pages: [pageInput],
      onProgress: onProgress
        ? (p) => onProgress({ ...p, pagesReused, pagesRecognizing })
        : undefined,
    });

    const backendPage = result.pages[0];
    if (!backendPage) continue;
    const rawText = backendPage.lines
      .map((l) => l.text.trim())
      .filter((t) => t.length > 0)
      .join("\n");
    const text = demoteMarkdownHeadings(rawText, OCR_HEADING_DEMOTION);
    if (text.length > 0) sections.set(pageIndex, text);
  }

  return {
    transcript: buildTranscriptSections(sections),
    pageFingerprints: currentFps,
    pagesRecognized: pagesRecognizing,
    pagesReused,
    pagesEmpty,
  };
}

/**
 * Count how many pages would be re-recognized if we ran incremental OCR
 * right now (used by the quota check + dirty indicator). Pure — no I/O.
 */
export function countDirtyPages(
  doc: PaperDocument,
  previousPageFingerprints: readonly string[] | undefined,
): number {
  return dirtyPageIndices(documentPageFingerprints(doc), previousPageFingerprints).length;
}
