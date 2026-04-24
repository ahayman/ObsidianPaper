import type { OcrBackendId, OcrResult } from "../document/PaperMdSerializer";
import type { Stroke } from "../types";

export type { OcrBackendId, OcrResult, OcrPageResult, OcrLine, OcrWord } from "../document/PaperMdSerializer";

/** Legacy alias for image backends — kept so call sites don't break. */
export type OcrPageBitmap = OcrPageInput;

/**
 * One page's worth of input to the backend. Exactly one of `blob` or
 * `strokes` is populated, matching the backend's declared `inputType`.
 * The orchestrator prepares the right field per backend.
 */
export interface OcrPageInput {
  pageIndex: number;
  /** PNG of the page. Populated for image-based backends. */
  blob?: Blob;
  /** Raw strokes on this page in world coordinates. Populated for stroke-based backends. */
  strokes?: Stroke[];
}

export interface OcrProgress {
  currentPage: number;
  totalPages: number;
  phase: "uploading" | "processing" | "parsing";
  message?: string;
}

export interface OcrDocumentInput {
  pages: OcrPageInput[];
  signal?: AbortSignal;
  onProgress?: (status: OcrProgress) => void;
}

export interface OcrTestResult {
  ok: boolean;
  error?: string;
}

/** Abstracts a recognition backend so the rest of the plugin doesn't know about
 *  whether we're sending strokes or images or calling which service. */
export interface OcrBackend {
  readonly id: OcrBackendId;
  /** Tells the orchestrator whether to rasterize the page (image) or pass
   *  strokes through unchanged (strokes). */
  readonly inputType: "image" | "strokes";
  isConfigured(): boolean;
  testConnection(): Promise<OcrTestResult>;
  recognizeDocument(input: OcrDocumentInput): Promise<OcrResult>;
}

/** Simple integer ID generator for transient line IDs. Stable across a single
 *  backend run, but not stable across runs — Phase 5 will introduce a clusterer
 *  that assigns stable IDs keyed on stroke geometry. */
export function makeLineId(pageIndex: number, lineIndex: number): string {
  return `L-${pageIndex}-${lineIndex}`;
}
