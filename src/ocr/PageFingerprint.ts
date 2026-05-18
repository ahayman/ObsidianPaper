import type { PaperDocument } from "../types";
import { shortHash } from "../thumbnail/ThumbnailGenerator";

/**
 * Compact (8-char FNV-1a) fingerprint of a page's stroke set, used for
 * incremental OCR / thumbnail dirty detection.
 *
 * The fingerprint changes whenever a stroke is added, removed, or its ID
 * changes. Move/transform of an existing stroke does NOT change the fp —
 * which is fine for OCR (text stays the same characters) but means the
 * thumbnail caller folds in extra context (theme + page geometry) before
 * hashing.
 *
 * Returns the empty string for pages with no strokes.
 */
export function pageFingerprint(doc: PaperDocument, pageIndex: number): string {
  const ids = doc.strokes
    .filter((s) => s.pageIndex === pageIndex)
    .map((s) => s.id);
  if (ids.length === 0) return "";
  ids.sort();
  return shortHash(ids.join("|"));
}

/**
 * One fingerprint per page, indexed by page position. Length always
 * matches `doc.pages.length`; blank pages get the empty string.
 */
export function documentPageFingerprints(doc: PaperDocument): string[] {
  return doc.pages.map((_, i) => pageFingerprint(doc, i));
}

/**
 * Compute the set of page indices whose fingerprint differs from the
 * previously-stored list (or are out of range of the previous list).
 * Pages with no strokes are never dirty (we never OCR blank pages).
 */
export function dirtyPageIndices(
  current: readonly string[],
  previous: readonly string[] | undefined,
): number[] {
  const dirty: number[] = [];
  for (let i = 0; i < current.length; i++) {
    const fp = current[i];
    if (fp === "") continue; // blank page — skip
    if (!previous || i >= previous.length || previous[i] !== fp) {
      dirty.push(i);
    }
  }
  return dirty;
}
