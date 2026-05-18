import { parseYaml, stringifyYaml } from "obsidian";
import type { PaperDocument } from "../types";
import { createEmptyDocument } from "./Document";
import {
  serializeDocument as serializeDocumentJson,
  deserializeDocument as deserializeDocumentJson,
} from "./Serializer";
import { decompressString } from "./Compression";

export const PAPER_MD_VERSION = 4;

export type PaperDefaultView = "paper" | "markdown";
export type OcrBackendId = "handwriting-ocr";

/**
 * Frontmatter schema for a .paper.md file.
 *
 * The `paper-*` namespace is reserved for this plugin. Any other keys
 * (tags, aliases, cssclasses, user properties) are preserved verbatim.
 *
 * Incremental OCR / thumbnail dirty detection is keyed on per-page
 * fingerprints stored here directly (no embedded JSON, no plugin-data
 * sidecar). See `src/ocr/PageFingerprint.ts`.
 */
export interface PaperMdFrontmatter {
  "paper-version": number;
  "paper-created"?: string;
  "paper-modified"?: string;
  "paper-default-view"?: PaperDefaultView;
  /** Excalidraw-style "this file has a parsed structure, please skip"
   *  marker. Some community plugins (notably Excalidraw's own ecosystem)
   *  honor similar keys to avoid expensive scans of the body. We emit it
   *  on every save so users can also reference it in plugin configs
   *  (e.g. Dataview's `excludePath` / cssclasses-based filtering). */
  "paper-plugin"?: "parsed";
  "paper-ocr"?: {
    backend?: OcrBackendId | null;
    "last-run"?: string;
  };
  /** Per-page stroke-set fingerprints captured at the most recent OCR run.
   *  Indexed by page; `""` for blank pages. Compared element-wise against
   *  current fingerprints to decide which pages need re-recognition. */
  "paper-ocr-pages-fp"?: string[];
  /** Page-1 fingerprint at the most recent thumbnail render. Includes a
   *  theme suffix so a light↔dark swap regenerates. */
  "paper-thumbnail-page-1-fp"?: string;
  /** ISO timestamp of the most recent thumbnail regeneration. Used by
   *  the toolbar's dirty indicator (cheap timestamp comparison vs.
   *  recomputing fingerprints on every modify event). */
  "paper-thumbnail-last-gen"?: string;
  [key: string]: unknown;
}

export interface ParsedPaperMd {
  document: PaperDocument;
  frontmatter: PaperMdFrontmatter;
  transcript: string;
  prelude: string;
}

export interface SerializePaperMdInput {
  document: PaperDocument;
  frontmatter?: Partial<PaperMdFrontmatter>;
  transcript?: string;
  prelude?: string;
}

const PAPER_FENCE = "paper";
/** Legacy fence — older files may still carry an embedded OCR JSON block.
 *  We recognize it on read so the markdown body parses cleanly, but never
 *  emit it on save. */
const LEGACY_PAPER_OCR_FENCE = "paper-ocr";
const TRANSCRIPT_HEADING = "# Transcript";

/**
 * Serialize a paper document + user markdown to a .paper.md string.
 *
 * Layout:
 *
 *     ---
 *     <frontmatter yaml — includes paper-ocr-pages-fp and similar>
 *     ---
 *
 *     <prelude, user markdown>
 *
 *     # Transcript
 *     <transcript — per-page sections under ## Page N headings>
 *
 *     ```paper
 *     <scene JSON>
 *     ```
 */
export function serializePaperMd(input: SerializePaperMdInput): string {
  const { document, frontmatter = {}, transcript = "", prelude = "" } = input;

  const now = new Date().toISOString();
  const createdIso = toIsoMs(document.meta.created) ?? now;
  const modifiedIso = now;

  const fm: PaperMdFrontmatter = {
    ...frontmatter,
    "paper-version": PAPER_MD_VERSION,
    "paper-created": frontmatter["paper-created"] ?? createdIso,
    "paper-modified": modifiedIso,
    "paper-plugin": "parsed",
  };

  const yamlBody = stringifyYaml(fm).trimEnd();
  const parts: string[] = [`---\n${yamlBody}\n---`];

  const trimmedPrelude = prelude.trim();
  if (trimmedPrelude.length > 0) {
    parts.push("", trimmedPrelude);
  }

  parts.push("", TRANSCRIPT_HEADING);
  const trimmedTranscript = transcript.trim();
  if (trimmedTranscript.length > 0) {
    parts.push("", trimmedTranscript);
  }

  const sceneJson = serializeDocumentJson(document);
  parts.push("", "```" + PAPER_FENCE, sceneJson, "```");

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
      frontmatter: { "paper-version": PAPER_MD_VERSION },
      transcript: "",
      prelude: "",
    };
  }

  const { frontmatter, body } = splitFrontmatter(source);
  // Legacy `paper-ocr` blocks are stripped from the body (we still split on
  // them so they don't leak into the markdown) but their contents are
  // discarded — the durable OCR storage is the # Transcript markdown plus
  // frontmatter fingerprints, not embedded JSON.
  const { blocks, bodyWithoutBlocks } = extractFencedBlocks(body);

  const paperBlock = blocks.find((b) => b.lang === PAPER_FENCE);

  const document = paperBlock
    ? decodeSceneBlock(paperBlock.content)
    : createEmptyDocument();

  applyFrontmatterToDocument(document, frontmatter);

  const { transcript, prelude } = extractTranscriptSection(bodyWithoutBlocks);

  return { document, frontmatter, transcript, prelude };
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

  const RECOGNIZED = new Set([PAPER_FENCE, LEGACY_PAPER_OCR_FENCE]);
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
    // Strip the legacy auto-generated HTML comment that older versions
    // injected under the heading. We no longer emit it, but existing
    // files may still carry one from the OCR command.
    if (/^<!--\s*Auto-generated from handwriting\..*-->\s*$/.test(line.trim())) continue;
    transcriptLines.push(line);
  }

  return {
    transcript: transcriptLines.join("\n").trim(),
    prelude: preludeLines.join("\n").trim(),
  };
}

/**
 * Decode a `paper` code block. Current files embed raw JSON; a prior version
 * of this serializer wrapped the JSON in deflate+base64 (readable only after
 * decompressing). Accept both so existing files still load; they'll be
 * re-emitted as raw JSON on the next save.
 */
function decodeSceneBlock(content: string): PaperDocument {
  const trimmed = content.trim();
  const json = trimmed.startsWith("{") ? trimmed : tryDecompress(trimmed);
  if (!json) return createEmptyDocument();
  try {
    return deserializeDocumentJson(json);
  } catch {
    return createEmptyDocument();
  }
}

function tryDecompress(base64: string): string | null {
  try {
    return decompressString(base64);
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
