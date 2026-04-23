import { parseYaml, stringifyYaml } from "obsidian";
import type { PaperDocument } from "../types";
import { createEmptyDocument } from "./Document";
import {
  serializeDocument as serializeDocumentJson,
  deserializeDocument as deserializeDocumentJson,
} from "./Serializer";
import { compressString, decompressString } from "./Compression";

export const PAPER_MD_VERSION = 4;

export type PaperDefaultView = "paper" | "markdown";
export type OcrBackendId = "myscript" | "handwriting-ocr";

/**
 * Frontmatter schema for a .paper.md file.
 *
 * The `paper-*` namespace is reserved for this plugin. Any other keys
 * (tags, aliases, cssclasses, user properties) are preserved verbatim.
 */
export interface PaperMdFrontmatter {
  "paper-version": number;
  "paper-created"?: string;
  "paper-modified"?: string;
  "paper-default-view"?: PaperDefaultView;
  "paper-ocr"?: {
    backend?: OcrBackendId | null;
    "last-run"?: string;
    "doc-hash"?: string;
  };
  [key: string]: unknown;
}

export interface OcrWord {
  text: string;
  bbox?: [number, number, number, number];
  strokeIds?: string[];
  confidence?: number;
}

export interface OcrLine {
  id: string;
  text: string;
  /** Page-local bbox [x, y, w, h]; absent if the backend doesn't supply geometry. */
  bbox?: [number, number, number, number];
  /** 0–1; absent if unknown. */
  confidence?: number;
  strokeIds?: string[];
  words?: OcrWord[];
}

export interface OcrPageResult {
  pageIndex: number;
  lines: OcrLine[];
}

export interface OcrResult {
  v: number;
  backend: OcrBackendId;
  pages: OcrPageResult[];
}

export const OCR_RESULT_VERSION = 1;

export interface ParsedPaperMd {
  document: PaperDocument;
  ocr: OcrResult | null;
  frontmatter: PaperMdFrontmatter;
  transcript: string;
  prelude: string;
}

export interface SerializePaperMdInput {
  document: PaperDocument;
  ocr?: OcrResult | null;
  frontmatter?: Partial<PaperMdFrontmatter>;
  transcript?: string;
  prelude?: string;
}

const PAPER_FENCE = "paper";
const PAPER_OCR_FENCE = "paper-ocr";
const TRANSCRIPT_HEADING = "# Transcript";
const TRANSCRIPT_AUTO_COMMENT =
  "<!-- Auto-generated from handwriting. Manual edits may be overwritten on the next OCR run. -->";

/**
 * Serialize a paper document (+ optional OCR and user markdown) to a .paper.md string.
 *
 * Layout:
 *
 *     ---
 *     <frontmatter yaml>
 *     ---
 *
 *     <prelude, user markdown>
 *
 *     # Transcript
 *     <!-- auto-generated note -->
 *     <transcript>
 *
 *     ```paper
 *     <deflate+base64 scene JSON>
 *     ```
 *
 *     ```paper-ocr
 *     <deflate+base64 OCR JSON>
 *     ```
 */
export function serializePaperMd(input: SerializePaperMdInput): string {
  const { document, ocr = null, frontmatter = {}, transcript = "", prelude = "" } = input;

  const now = new Date().toISOString();
  const createdIso = toIsoMs(document.meta.created) ?? now;
  const modifiedIso = now;

  const fm: PaperMdFrontmatter = {
    ...frontmatter,
    "paper-version": PAPER_MD_VERSION,
    "paper-created": frontmatter["paper-created"] ?? createdIso,
    "paper-modified": modifiedIso,
  };

  if (ocr) {
    const existing = fm["paper-ocr"] ?? {};
    fm["paper-ocr"] = {
      ...existing,
      backend: ocr.backend,
      "last-run": existing["last-run"] ?? modifiedIso,
    };
  }

  const yamlBody = stringifyYaml(fm).trimEnd();
  const parts: string[] = [`---\n${yamlBody}\n---`];

  const trimmedPrelude = prelude.trim();
  if (trimmedPrelude.length > 0) {
    parts.push("", trimmedPrelude);
  }

  parts.push("", TRANSCRIPT_HEADING, TRANSCRIPT_AUTO_COMMENT);
  const trimmedTranscript = transcript.trim();
  if (trimmedTranscript.length > 0) {
    parts.push("", trimmedTranscript);
  }

  const sceneJson = serializeDocumentJson(document);
  parts.push("", "```" + PAPER_FENCE, compressString(sceneJson), "```");

  if (ocr) {
    const ocrJson = JSON.stringify(ocr);
    parts.push("", "```" + PAPER_OCR_FENCE, compressString(ocrJson), "```");
  }

  return parts.join("\n") + "\n";
}

/**
 * Parse a .paper.md string into its components.
 *
 * Robust to empty input, malformed frontmatter, and missing sections. A file
 * with no `paper` code block produces an empty document; a file with no
 * `paper-ocr` block has `ocr: null`.
 */
export function deserializePaperMd(source: string): ParsedPaperMd {
  if (!source || source.trim() === "") {
    return {
      document: createEmptyDocument(),
      ocr: null,
      frontmatter: { "paper-version": PAPER_MD_VERSION },
      transcript: "",
      prelude: "",
    };
  }

  const { frontmatter, body } = splitFrontmatter(source);
  const { blocks, bodyWithoutBlocks } = extractFencedBlocks(body);

  const paperBlock = blocks.find((b) => b.lang === PAPER_FENCE);
  const ocrBlock = blocks.find((b) => b.lang === PAPER_OCR_FENCE);

  const document = paperBlock
    ? decodeSceneBlock(paperBlock.content)
    : createEmptyDocument();
  const ocr = ocrBlock ? decodeOcrBlock(ocrBlock.content) : null;

  applyFrontmatterToDocument(document, frontmatter);

  const { transcript, prelude } = extractTranscriptSection(bodyWithoutBlocks);

  return { document, ocr, frontmatter, transcript, prelude };
}

// --- Internals -------------------------------------------------------------

interface FencedBlock {
  lang: string;
  content: string;
}

function splitFrontmatter(source: string): { frontmatter: PaperMdFrontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) {
    return {
      frontmatter: { "paper-version": PAPER_MD_VERSION },
      body: source,
    };
  }
  const yamlText = match[1];
  let parsed: PaperMdFrontmatter;
  try {
    const raw = parseYaml(yamlText) as Record<string, unknown> | null;
    parsed = (raw ?? {}) as PaperMdFrontmatter;
  } catch {
    parsed = { "paper-version": PAPER_MD_VERSION };
  }
  if (typeof parsed["paper-version"] !== "number") {
    parsed["paper-version"] = PAPER_MD_VERSION;
  }
  return { frontmatter: parsed, body: source.slice(match[0].length) };
}

/**
 * Scan for top-level ```lang ... ``` fenced code blocks.
 * Only recognizes the languages we care about so arbitrary user code blocks
 * pass through as markdown.
 */
function extractFencedBlocks(body: string): { blocks: FencedBlock[]; bodyWithoutBlocks: string } {
  const lines = body.split("\n");
  const blocks: FencedBlock[] = [];
  const keptLines: string[] = [];

  const RECOGNIZED = new Set([PAPER_FENCE, PAPER_OCR_FENCE]);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fenceMatch = /^```([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (fenceMatch && RECOGNIZED.has(fenceMatch[1])) {
      const lang = fenceMatch[1];
      const contentLines: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (/^```\s*$/.test(lines[j] ?? "")) {
          closed = true;
          break;
        }
        contentLines.push(lines[j] ?? "");
        j++;
      }
      if (closed) {
        blocks.push({ lang, content: contentLines.join("\n").trim() });
        i = j + 1;
        continue;
      }
      // Unclosed fence — keep the line as markdown and keep scanning.
    }
    keptLines.push(line);
    i++;
  }

  return { blocks, bodyWithoutBlocks: keptLines.join("\n") };
}

function extractTranscriptSection(body: string): { transcript: string; prelude: string } {
  const lines = body.split("\n");
  const headingIdx = lines.findIndex((l) => /^#\s+Transcript\s*$/.test(l));

  if (headingIdx === -1) {
    return { transcript: "", prelude: body.trim() };
  }

  const preludeLines = lines.slice(0, headingIdx);
  const afterHeading = lines.slice(headingIdx + 1);

  const transcriptLines: string[] = [];
  for (const line of afterHeading) {
    if (/^#\s+/.test(line)) break;
    if (line.trim() === TRANSCRIPT_AUTO_COMMENT) continue;
    transcriptLines.push(line);
  }

  return {
    transcript: transcriptLines.join("\n").trim(),
    prelude: preludeLines.join("\n").trim(),
  };
}

function decodeSceneBlock(content: string): PaperDocument {
  try {
    const json = decompressString(content.trim());
    return deserializeDocumentJson(json);
  } catch {
    return createEmptyDocument();
  }
}

function decodeOcrBlock(content: string): OcrResult | null {
  try {
    const json = decompressString(content.trim());
    const parsed = JSON.parse(json) as OcrResult;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.v !== "number") return null;
    if (!Array.isArray(parsed.pages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function applyFrontmatterToDocument(
  document: PaperDocument,
  frontmatter: PaperMdFrontmatter,
): void {
  const created = fromIsoString(frontmatter["paper-created"]);
  const modified = fromIsoString(frontmatter["paper-modified"]);
  if (created != null) document.meta.created = created;
  if (modified != null) document.meta.modified = modified;
}

function toIsoMs(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function fromIsoString(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
