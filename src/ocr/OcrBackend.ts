import type { OcrBackendId, OcrResult } from "../document/PaperMdSerializer";

export type { OcrBackendId, OcrResult, OcrPageResult, OcrLine, OcrWord } from "../document/PaperMdSerializer";

export interface OcrPageBitmap {
  pageIndex: number;
  blob: Blob;
}

export interface OcrProgress {
  currentPage: number;
  totalPages: number;
  phase: "uploading" | "processing" | "parsing";
  message?: string;
}

export interface OcrDocumentInput {
  pages: OcrPageBitmap[];
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
