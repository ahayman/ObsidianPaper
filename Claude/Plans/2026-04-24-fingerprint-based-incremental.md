# Fingerprint-Based Incremental OCR & Thumbnail

## Why

Both the embedded `paper-ocr` JSON block and the `thumbnailHashes` plugin-data sidecar exist to support incremental detection. They're each working, but they cost:

- The `paper-ocr` block clutters every `.paper.md` with opaque JSON that duplicates information already in the visible `# Transcript` markdown.
- `thumbnailHashes` lives in plugin data, drifts from the document it describes (rename → hash orphaned), and is invisible to the user.
- The runner uses `pageStrokeIds` arrays inside the OcrResult — a `string[]` per page — which works but is bulkier than a fingerprint.

Replace both with per-page **stroke-ID fingerprints** in frontmatter. Same incremental semantics, less storage, visible to the user, no plugin-data sidecar.

## Format

```yaml
paper-ocr-pages-fp:
  - a1b2c3d4    # page 1, FNV-1a 8 chars over sorted stroke IDs
  - ""          # page 2 (no strokes — empty marker)
  - 9c0d1e2f    # page 3
paper-thumbnail-page-1-fp: a1b2c3d4-dark    # fp + theme suffix
```

The `# Transcript` markdown becomes the durable storage of OCR text:

```markdown
# Transcript

## Page 1
text recognized for page 1 here

## Page 3
text recognized for page 3 here
```

## Behavior

### Default (incremental)

OCR-only mode:
- Compute current fp per page from current strokes (sorted IDs → FNV-1a → 8 hex).
- Compare element-wise against `paper-ocr-pages-fp`. Pages where current ≠ stored OR index out of bounds = dirty.
- Run OCR only on dirty pages with strokes.
- Parse existing `# Transcript` into per-page sections; replace dirty-page sections with new OCR results; preserve clean ones.
- Trim trailing sections for pages no longer in the document.
- Write fresh `paper-ocr-pages-fp` array.

Thumbnail-only mode:
- Compute fp = FNV-1a(`<theme>:<sorted page-1 stroke IDs>`).
- Compare against `paper-thumbnail-page-1-fp`. If match AND PNG exists on disk → skip.
- Else regenerate, write PNG, update frontmatter fp.

### Default click on toolbar Process button = "both, incremental"

If nothing is dirty, Notice: **"Everything up to date"** and short-circuit.

### Right-click / long-press menu

- **Update everything (incremental)** — the same as default click; offered explicitly for menu coherence
- **Update transcript only (OCR)** — incremental
- **Update thumbnail only** — incremental
- *separator*
- **Force re-run all OCR** — ignores fp, re-OCRs every non-empty page
- **Force regenerate thumbnail** — ignores fp, redraws + writes
- **Force re-run everything** — both forces

Force modes don't touch existing-but-clean transcript sections beyond what they replace. They just bypass the dirty check.

## Files

### New

- `src/ocr/PageFingerprint.ts`
  - `pageFingerprint(doc, pageIndex): string` — sorted stroke IDs for the page → FNV-1a → 8 hex chars. Returns `""` for blank pages.
  - `documentPageFingerprints(doc): string[]` — array indexed by page, length = `doc.pages.length`.
  - Reuses the FNV-1a helper that already exists in `ThumbnailGenerator.ts:shortHash`.

- `src/ocr/TranscriptSections.ts`
  - `parseTranscriptSections(transcript: string): Map<number, string>` — splits a `# Transcript` body on `## Page N` headings into a 0-indexed map.
  - `buildTranscriptSections(sections: Map<number, string>): string` — emits markdown back, sorted by page index, with `## Page N` (1-indexed display) headings.

### Modified

- `src/document/PaperMdSerializer.ts`
  - Drop `OcrLine`, `OcrPageResult`, `OcrResult`, `OCR_RESULT_VERSION`.
  - Drop the `paper-ocr` code-block emit + decode. Existing files with the block on read are tolerated — extra block is just ignored (no longer recognized).
  - Add `paper-ocr-pages-fp` and `paper-thumbnail-page-1-fp` frontmatter fields to `PaperMdFrontmatter` interface.
  - `ParsedPaperMd` no longer has an `ocr` field.

- `src/ocr/OcrBackend.ts`
  - `OcrPageResult` keeps `lines` (still used as the backend's per-page output type) but loses `pageStrokeIds`. `OcrResult` keeps `pages` and `backend` for the same reason. Internal-only — never persisted.

- `src/ocr/IncrementalOcrRunner.ts`
  - New input shape: `{ document, previousPageFingerprints?, previousTranscriptByPage?, backend, force?, onProgress? }`.
  - Output shape: `{ pageFingerprints: string[], transcript: string, pagesRecognized, pagesReused, pagesEmpty }`.
  - `countDirtyPages(doc, prevFingerprints?)` — used by quota check and dirty-indicator.
  - Drop `OcrPageResult` use; keep the per-call backend.recognizeDocument abstraction.

- `src/thumbnail/ThumbnailManager.ts`
  - Drop `ThumbnailHashStore` constructor arg.
  - Read/write the fp from frontmatter via `processFrontMatter`.
  - `regenerate(file, force)` — same semantics, fp from frontmatter instead of hash store.

- `src/thumbnail/ThumbnailGenerator.ts`
  - `firstPageHash` already exists; either reuse or refactor to use `PageFingerprint.pageFingerprint(doc, 0)` plus the theme suffix.

- `src/main.ts`
  - Drop `thumbnailHashes` field, `ThumbnailHashStore` instantiation, and the wrapped `{ settings, thumbnailHashes }` plugin-data shape (legacy fallback can stay one release for safety, then go).
  - `processCurrentFile(view, mode, options: { forceOcr?: boolean, forceThumbnail?: boolean })`. Default = both flags false (incremental). The "nothing dirty" Notice fires here, after dirty detection but before any work.
  - `isProcessDirty` reads frontmatter fps via metadataCache, compares to current doc fps.
  - `runOcrCommand({ force })` — adapted to the new runner signature; force flag bypasses fp comparison.
  - PaperView no longer needs `applyOcrResult` or `getMdOcr` — write directly to disk via vault.modify after the runner completes (analogous to current `writeOcrToDisk` path, but always taken). View reloads naturally on the resulting modify event.

- `src/view/PaperView.ts`
  - Drop `mdOcr`, `applyOcrResult`, `getMdOcr`. Toolbar `setProcessDirty` plumbing stays.

- `src/view/toolbar/Toolbar.ts`
  - `runProcess(mode, options)` — accepts a force-flags option object.
  - `showProcessMenu` — adds three force entries below a separator.

### Tests

- New: `PageFingerprint.test.ts`, `TranscriptSections.test.ts`.
- Rewrite: `IncrementalOcrRunner.test.ts` — exercise new signature with fp comparison, transcript merging, force mode.
- Rewrite: `PaperMdSerializer.test.ts` — drop OCR-block tests; add fp frontmatter round-trip tests.
- Update: `ThumbnailManager` (no existing test? check).
- Update: `main.test.ts` — confirm plugin still loads after dropping the hash store.

## Migration

Forwards-only. No version bump needed at the file level (still `paper-version: 4`). Existing files:
- `paper-ocr` JSON block on read: ignored. Stripped on next save.
- `# Transcript` markdown body: preserved verbatim. First incremental run treats every page as dirty (no stored fps), so it runs full OCR once, then incremental from there.
- `thumbnailHashes` in plugin data: ignored on load. Cleared on next save (plugin-data shape simplifies).
- Existing `paper-ocr.last-run` and `paper-ocr.backend` frontmatter entries: kept; `last-run` updated, `backend` updated.

## Validation

`yarn build && yarn test && yarn build:copy`.

Manual:
- Open a previously-OCR'd file → click Process → "Everything up to date" Notice (since fp was just stored, nothing changed).
- Edit one stroke on page 2 → click Process → only page 2 re-OCR'd, page 1/3 transcripts intact.
- Long-press → "Force re-run all OCR" → all pages re-OCR'd regardless of fp.
- Switch theme → click Process → thumbnail regenerated (theme is in fp suffix).
