# OCR Types YAGNI Cleanup

## Why

The OCR types carry several fields that scaffold a click-to-navigate-from-transcript-to-stroke feature we have not built and (after the cost/benefit conversation about MyScript billing) likely will not build. Carrying them forward bloats the embedded `paper-ocr` JSON in every `.paper.md` file and adds dead branches to the runner.

Concretely:

- `OcrLine.bbox`, `OcrLine.confidence`, `OcrLine.words`, `OcrLine.strokeIds` — never read by `TranscriptBuilder`, `PaperView`, `main.ts`, or any UI surface.
- `OcrWord` — type only ever appears in `OcrLine.words`, which we are removing.
- `attachStrokeIdsToLines` (in `IncrementalOcrRunner.ts`) — its only job is to populate `OcrLine.strokeIds` and `OcrLine.bbox`. With those fields gone it becomes a no-op.
- `LineClusterer.ts` — exclusively consumed by `attachStrokeIdsToLines`. Becomes dead with that helper gone.
- `OcrPageBitmap` (alias for `OcrPageInput` in `OcrBackend.ts`) — labeled "legacy alias for image backends — kept so call sites don't break." With the runner being the only call site we can fold it in this pass.

Result: simpler types, smaller serialized OCR block, no behavior change. `pageStrokeIds` on `OcrPageResult` stays — it is the input to incremental cache-hit detection.

## Files Touched

1. `src/document/PaperMdSerializer.ts`
   - Remove `OcrWord` interface.
   - Strip `bbox`, `confidence`, `strokeIds`, `words` from `OcrLine`.
   - Keep `id`, `text`. Keep `OcrPageResult.pageStrokeIds`.

2. `src/ocr/OcrBackend.ts`
   - Drop `OcrWord` from the re-export list.
   - Remove `OcrPageBitmap` alias.

3. `src/ocr/IncrementalOcrRunner.ts`
   - Remove `import { clusterStrokesIntoLines } from "./LineClusterer";`.
   - Remove `attachStrokeIdsToLines` function entirely.
   - Replace `OcrPageBitmap` references with `OcrPageInput`.
   - Inside the dirty-page loop: `lines: attachStrokeIdsToLines(backendPage.lines, plan.strokes)` → `lines: backendPage.lines`.

4. `src/ocr/IncrementalOcrRunner.test.ts`
   - Drop the `describe("attachStrokeIdsToLines", ...)` block and its import.

5. `src/ocr/LineClusterer.ts` — delete.
6. `src/ocr/LineClusterer.test.ts` — delete.

7. `src/document/PaperMdSerializer.test.ts`
   - In `makeOcr()`, drop `bbox`, `confidence`, `strokeIds`, `words` from the fixture.
   - Update the "round-trips an OCR result" expectations: drop the `strokeIds`/`words` assertions.

## Validation

`yarn lint && yarn build && yarn test && yarn build:copy`.

The migration story is forwards-only by design: the decoder treats unknown fields on `OcrLine` as ignored extras (we never spread them back), so any existing `.paper.md` file with the old shape will load without error and re-serialize without the dead fields on next save. No migration code needed.
