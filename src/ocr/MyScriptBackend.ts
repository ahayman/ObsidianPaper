import { requestUrl } from "obsidian";
import type { Stroke } from "../types";
import { decodePoints } from "../document/PointEncoder";
import type {
  OcrBackend,
  OcrBackendId,
  OcrDocumentInput,
  OcrPageResult,
  OcrResult,
  OcrTestResult,
} from "./OcrBackend";
import { makeLineId } from "./OcrBackend";
import { OCR_RESULT_VERSION } from "../document/PaperMdSerializer";

const API_BASE = "https://cloud.myscript.com/api/v4.0/iink";
/** Use /batch for now — same endpoint the official iinkJS examples target. */
const ENDPOINT = "/batch/";

export interface MyScriptConfig {
  applicationKey: string;
  hmacKey: string;
  /** BCP-47-ish language code like "en_US", "fr_FR". MyScript uses underscore. */
  language: string;
}

/**
 * MyScript iink Cloud backend. Unlike Handwriting OCR (which receives
 * rasterized PNGs), MyScript consumes the raw pen-trajectory strokes —
 * arrays of x/y/t/(p) per point. That temporal information is what lets
 * it disambiguate visually-identical cursive letters that image OCR has
 * to guess at.
 *
 * Docs: https://developer.myscript.com/docs/interactive-ink/2.0/web/rest/architecture/
 * Sample: https://github.com/MyScript/iinkJS/blob/master/examples/v4/rest_no_ui.html
 */
export class MyScriptBackend implements OcrBackend {
  readonly id: OcrBackendId = "myscript";
  readonly inputType = "strokes" as const;

  constructor(private getConfig: () => MyScriptConfig) {}

  isConfigured(): boolean {
    const cfg = this.getConfig();
    return !!cfg.applicationKey && !!cfg.hmacKey;
  }

  async testConnection(): Promise<OcrTestResult> {
    // MyScript has no dedicated health endpoint; we send a minimal
    // recognition request (one short stroke) and check for a 2xx response.
    try {
      const body = buildRequestBody([{ x: [0, 1], y: [0, 1], t: [0, 10] }], this.getConfig().language);
      const res = await this.post(body);
      if (res.status >= 200 && res.status < 300) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `Auth rejected (${res.status}) — check applicationKey / hmacKey.` };
      }
      return { ok: false, error: `Unexpected status ${res.status}: ${res.text?.slice(0, 200) ?? ""}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async recognizeDocument(input: OcrDocumentInput): Promise<OcrResult> {
    const cfg = this.getConfig();
    if (!cfg.applicationKey || !cfg.hmacKey) {
      throw new Error("MyScript not configured — missing applicationKey or hmacKey.");
    }

    const pages: OcrPageResult[] = [];
    for (let i = 0; i < input.pages.length; i++) {
      input.signal?.throwIfAborted?.();
      const page = input.pages[i];
      const pageStrokes = page.strokes ?? [];
      const total = input.pages.length;

      if (pageStrokes.length === 0) {
        pages.push({ pageIndex: page.pageIndex, lines: [] });
        continue;
      }

      input.onProgress?.({ currentPage: i + 1, totalPages: total, phase: "uploading" });

      const strokes = strokesToMyScriptFormat(pageStrokes);
      const body = buildRequestBody(strokes, cfg.language);

      input.onProgress?.({ currentPage: i + 1, totalPages: total, phase: "processing" });
      const res = await this.post(body);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`MyScript failed: ${res.status} ${res.text?.slice(0, 200) ?? ""}`);
      }

      input.onProgress?.({ currentPage: i + 1, totalPages: total, phase: "parsing" });
      const transcript = res.text ?? "";
      console.log(`[Paper OCR] MyScript returned ${transcript.length} chars for page ${page.pageIndex}`);
      pages.push({
        pageIndex: page.pageIndex,
        lines: transcriptToLines(transcript, page.pageIndex),
      });
    }

    return { v: OCR_RESULT_VERSION, backend: this.id, pages };
  }

  private async post(body: string) {
    const cfg = this.getConfig();
    const hmac = await hmacSha512Hex(body, cfg.applicationKey + cfg.hmacKey);
    return requestUrl({
      url: `${API_BASE}${ENDPOINT}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // text/plain means we get back the recognized string directly in
        // res.text instead of a JSON envelope. JIIX (bounding boxes) would
        // come from "application/vnd.myscript.jiix" — future upgrade.
        "Accept": "text/plain",
        "applicationKey": cfg.applicationKey,
        "hmac": hmac,
      },
      body,
      throw: false,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

interface MyScriptStroke {
  x: number[];
  y: number[];
  t: number[];
  p?: number[];
}

/**
 * Decode a stroke's `pts` string back to point arrays and apply its
 * transform so MyScript sees the visible shape.
 */
export function strokesToMyScriptFormat(strokes: readonly Stroke[]): MyScriptStroke[] {
  const out: MyScriptStroke[] = [];
  for (const stroke of strokes) {
    const decoded = decodePoints(stroke.pts);
    if (decoded.length < 2) continue; // MyScript wants at least 2 points per stroke

    const x: number[] = new Array(decoded.length);
    const y: number[] = new Array(decoded.length);
    const t: number[] = new Array(decoded.length);
    const p: number[] = new Array(decoded.length);
    let hasPressure = false;

    for (let i = 0; i < decoded.length; i++) {
      const pt = decoded[i];
      // Apply stroke transform so rotated/scaled strokes come through correctly.
      if (stroke.transform) {
        const [a, b, c, d, tx, ty] = stroke.transform;
        x[i] = a * pt.x + c * pt.y + tx;
        y[i] = b * pt.x + d * pt.y + ty;
      } else {
        x[i] = pt.x;
        y[i] = pt.y;
      }
      t[i] = pt.timestamp;
      p[i] = pt.pressure;
      if (pt.pressure > 0 && pt.pressure !== 0.5) hasPressure = true;
    }

    out.push(hasPressure ? { x, y, t, p } : { x, y, t });
  }
  return out;
}

/** Build the JSON body MyScript's /batch/ endpoint expects. */
export function buildRequestBody(strokes: MyScriptStroke[], language: string): string {
  const body = {
    xDPI: 96,
    yDPI: 96,
    contentType: "Text",
    configuration: {
      lang: language,
      text: {
        guides: { enable: false },
        smartGuide: false,
      },
    },
    strokeGroups: [
      { strokes },
    ],
  };
  return JSON.stringify(body);
}

/** HMAC-SHA512 in hex using Web Crypto (available in Electron + iOS WebView). */
export async function hmacSha512Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bufToHex(sig);
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** MyScript returns plain text with line breaks; split into OcrLines. */
export function transcriptToLines(transcript: string, pageIndex: number): OcrResult["pages"][number]["lines"] {
  const raw = transcript.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0);
  return raw.map((text, idx) => ({
    id: makeLineId(pageIndex, idx),
    text,
  }));
}
