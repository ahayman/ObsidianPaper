/**
 * Helpers for splitting / rebuilding the `# Transcript` markdown body
 * into per-page sections. The transcript becomes the durable storage of
 * OCR text; per-page fingerprints in frontmatter tell us which sections
 * are still valid and which need re-recognition.
 *
 * Convention: each page's section is introduced by a level-2 heading
 * `## Page N` (1-indexed for human reading), followed by the recognized
 * lines until the next `## ` heading or end of body.
 */

const PAGE_HEADING_RE = /^##\s+Page\s+(\d+)\s*$/;

/**
 * Parse a transcript body (the markdown that lives under `# Transcript`)
 * into a 0-indexed map of page → recognized text.
 *
 * Tolerant of:
 * - Empty input → empty map.
 * - Pre-heading prose (dropped — there is no page-0 prelude in our format).
 * - Out-of-order or duplicate `## Page N` headings (last one wins).
 * - Trailing blank lines inside a section (trimmed).
 */
export function parseTranscriptSections(transcript: string): Map<number, string> {
  const out = new Map<number, string>();
  if (!transcript || transcript.trim() === "") return out;

  const lines = transcript.split("\n");
  let currentPage: number | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (currentPage === null) return;
    const body = buffer.join("\n").trim();
    if (body.length > 0) out.set(currentPage, body);
    buffer = [];
  };

  for (const line of lines) {
    const m = PAGE_HEADING_RE.exec(line);
    if (m) {
      flush();
      const oneIndexed = parseInt(m[1] ?? "0", 10);
      currentPage = oneIndexed > 0 ? oneIndexed - 1 : null;
      continue;
    }
    if (currentPage !== null) buffer.push(line);
  }
  flush();
  return out;
}

/**
 * Demote any ATX-style markdown headings in `text` by `levels` (clamped so
 * the result never exceeds six `#`s).
 *
 * The transcript layout uses `# Transcript` as the section heading and
 * `## Page N` per page; raw OCR output that happens to start lines with
 * `#` would then either collide with the Page heading (`##`) or terminate
 * the Transcript section entirely on next read (the markdown body parser
 * stops at the next `#` heading after `# Transcript`). Demoting by 2
 * levels keeps OCR-derived headings safely inside their page section.
 *
 * Code fences (``` and ~~~) are tracked so `# foo` inside a fenced block
 * is left untouched.
 */
export function demoteMarkdownHeadings(text: string, levels: number): string {
  if (levels <= 0 || text.length === 0) return text;
  let inFence = false;
  return text.split("\n").map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const match = /^(\s*)(#+)(\s+)/.exec(line);
    if (!match) return line;
    const [, leading, hashes, trailing] = match;
    const newCount = Math.min(6, hashes.length + levels);
    return `${leading}${"#".repeat(newCount)}${trailing}${line.slice(match[0].length)}`;
  }).join("\n");
}

/**
 * Emit a transcript body from per-page sections, sorted by page index.
 * Blank-section entries (empty string after trim) are dropped — we don't
 * write `## Page N` headings for pages we have nothing to say about.
 */
export function buildTranscriptSections(sections: Map<number, string>): string {
  const indices = [...sections.keys()].sort((a, b) => a - b);
  const parts: string[] = [];
  for (const i of indices) {
    const text = sections.get(i)?.trim() ?? "";
    if (text.length === 0) continue;
    parts.push(`## Page ${i + 1}\n${text}`);
  }
  return parts.join("\n\n");
}
