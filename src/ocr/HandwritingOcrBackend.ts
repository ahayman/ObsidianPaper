import { requestUrl } from "obsidian";
import type { RequestUrlResponse } from "obsidian";
import type {
  OcrBackend,
  OcrBackendId,
  OcrDocumentInput,
  OcrResult,
  OcrPageResult,
  OcrLine,
  OcrTestResult,
} from "./OcrBackend";
import { makeLineId, OCR_RESULT_VERSION } from "./OcrBackend";

const API_BASE = "https://www.handwritingocr.com/api/v3";

export interface HandwritingOcrConfig {
  apiToken: string;
  /** ms between status polls. Server rate limit is 2 rps → ≥500ms. */
  pollIntervalMs?: number;
  /** Total timeout per page in seconds. */
  maxWaitSeconds?: number;
}

interface UploadResponse {
  id: string;
  status?: string;
  page_count?: number;
}

interface PollResponse {
  id: string;
  status: string;
  page_count?: number;
  /** Per-page transcripts, as of API v3. Keyed `results` in the response body —
   *  not `pages` (which is a separate thumbnails array on the document). */
  results?: Array<{ page_number: number; transcript: string }>;
  error?: string;
}

/**
 * Handwriting OCR backend (https://www.handwritingocr.com/api/v3).
 *
 * Uploads each page as a PNG, polls until processed, then parses the per-page
 * transcript into line-level `OcrLine` entries. This backend does not provide
 * bounding boxes or confidence — those fields are left undefined.
 */
export class HandwritingOcrBackend implements OcrBackend {
  readonly id: OcrBackendId = "handwriting-ocr";
  readonly inputType = "image" as const;

  private pollIntervalMs: number;
  private maxWaitSeconds: number;

  constructor(private getConfig: () => HandwritingOcrConfig) {
    this.pollIntervalMs = 700;
    this.maxWaitSeconds = 120;
  }

  isConfigured(): boolean {
    return !!this.getConfig().apiToken;
  }

  async testConnection(): Promise<OcrTestResult> {
    try {
      const res = await this.httpRequest("GET", "/documents?per_page=1");
      if (res.status === 200) return { ok: true };
      if (res.status === 401) return { ok: false, error: "Invalid API token (401)" };
      if (res.status === 403) return { ok: false, error: "Forbidden (403)" };
      return { ok: false, error: `Unexpected response (${res.status})` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async recognizeDocument(input: OcrDocumentInput): Promise<OcrResult> {
    const config = this.getConfig();
    if (!config.apiToken) {
      throw new Error("Handwriting OCR not configured — missing API token.");
    }

    this.pollIntervalMs = config.pollIntervalMs ?? 700;
    this.maxWaitSeconds = config.maxWaitSeconds ?? 120;

    const pages: OcrPageResult[] = [];
    for (let i = 0; i < input.pages.length; i++) {
      input.signal?.throwIfAborted?.();
      const page = input.pages[i];
      const totalPages = input.pages.length;

      if (!page.blob) continue; // image backend — blob must be present
      input.onProgress?.({ currentPage: i + 1, totalPages, phase: "uploading" });
      const uploaded = await this.uploadPage(page.blob, page.pageIndex);

      input.onProgress?.({ currentPage: i + 1, totalPages, phase: "processing" });
      const transcript = await this.pollUntilReady(uploaded.id, input.signal);

      input.onProgress?.({ currentPage: i + 1, totalPages, phase: "parsing" });
      pages.push({
        pageIndex: page.pageIndex,
        lines: transcriptToLines(transcript, page.pageIndex),
      });
    }

    return {
      v: OCR_RESULT_VERSION,
      backend: this.id,
      pages,
    };
  }

  // ─── Internals ────────────────────────────────────────────────────

  private async uploadPage(blob: Blob, pageIndex: number): Promise<UploadResponse> {
    const arrayBuf = await blob.arrayBuffer();
    const filename = `paper-page-${pageIndex}.png`;

    const { body, contentType } = buildMultipartBody([
      { name: "action", value: "transcribe" },
      { name: "file", filename, contentType: "image/png", data: new Uint8Array(arrayBuf) },
    ]);

    const res = await this.httpRequest("POST", "/documents", {
      body,
      contentType,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Handwriting OCR upload failed: ${res.status} ${res.text?.slice(0, 200) ?? ""}`);
    }
    const parsed = parseJson<UploadResponse>(res);
    if (!parsed.id) {
      throw new Error("Handwriting OCR upload returned no document id.");
    }
    return parsed;
  }

  private async pollUntilReady(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const start = Date.now();
    const timeoutMs = this.maxWaitSeconds * 1000;

    while (true) {
      signal?.throwIfAborted?.();
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Handwriting OCR timed out after ${this.maxWaitSeconds}s`);
      }

      const res = await this.httpRequest("GET", `/documents/${documentId}`);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Handwriting OCR poll failed: ${res.status} ${res.text?.slice(0, 200) ?? ""}`);
      }
      const data = parseJson<PollResponse>(res);
      const status = (data.status ?? "").toLowerCase();

      if (status === "processed" || status === "complete" || status === "done") {
        return concatPageTranscripts(data.results);
      }
      if (status === "failed" || status === "error") {
        throw new Error(`Handwriting OCR failed: ${data.error ?? status}`);
      }

      await sleep(this.pollIntervalMs);
    }
  }

  private async httpRequest(
    method: string,
    path: string,
    opts?: { body?: ArrayBuffer; contentType?: string },
  ): Promise<RequestUrlResponse> {
    const { apiToken } = this.getConfig();
    return requestUrl({
      url: `${API_BASE}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        ...(opts?.contentType ? { "Content-Type": opts.contentType } : {}),
      },
      body: opts?.body,
      throw: false,
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

interface TextPart {
  name: string;
  value: string;
}
interface FilePart {
  name: string;
  filename: string;
  contentType: string;
  data: Uint8Array;
}
type MultipartPart = TextPart | FilePart;

/**
 * Build a multipart/form-data body as an ArrayBuffer. requestUrl doesn't
 * accept FormData directly, so we construct the wire format by hand.
 */
export function buildMultipartBody(parts: MultipartPart[]): {
  body: ArrayBuffer;
  contentType: string;
} {
  const boundary = `----ObsidianPaperOcr${Math.random().toString(36).slice(2)}${Date.now()}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const part of parts) {
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    if ("filename" in part) {
      chunks.push(encoder.encode(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
        `Content-Type: ${part.contentType}\r\n\r\n`,
      ));
      chunks.push(part.data);
      chunks.push(encoder.encode("\r\n"));
    } else {
      chunks.push(encoder.encode(
        `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
      ));
    }
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }

  return {
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function parseJson<T>(res: RequestUrlResponse): T {
  try {
    return res.json as T;
  } catch {
    return JSON.parse(res.text) as T;
  }
}

function concatPageTranscripts(results: PollResponse["results"]): string {
  if (!results || results.length === 0) return "";
  const sorted = [...results].sort((a, b) => a.page_number - b.page_number);
  return sorted.map((p) => p.transcript ?? "").join("\n");
}

/**
 * Split a page transcript into OcrLines. The service returns one string per
 * page; we split by newlines and drop empties. Empty pages produce no lines.
 */
export function transcriptToLines(transcript: string, pageIndex: number): OcrLine[] {
  const raw = transcript.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0);
  return raw.map((text, idx) => ({
    id: makeLineId(pageIndex, idx),
    text,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
