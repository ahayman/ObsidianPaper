# Remove MyScript Backend

## Why

MyScript's recognition quality on this corpus didn't compete with Handwriting OCR even after fixing the obvious issues (per-stroke t-zeroing, RDP simplification, reading-order pre-sort). It still produced phantom characters, and the spatial-ordering workaround we needed felt brittle. Handwriting OCR has been consistently accurate, so we ship one OCR path and remove the other.

## Scope

Pure removal — no replacement, no compat shim. Existing files with `paper-ocr.backend: "myscript"` in their frontmatter or embedded JSON will load fine (the backend tag is just a string), and a re-OCR will overwrite them with the Handwriting OCR result. Users who had `ocrBackend: "myscript"` saved in settings get coerced to `"none"` on load — they'll need to re-enable Handwriting OCR if they want it.

## Files

**Delete:**
- `src/ocr/MyScriptBackend.ts`
- `src/ocr/MyScriptBackend.test.ts`

**Edit:**
- `src/main.ts` — drop the `MyScriptBackend` import + the `if (ocrBackend === "myscript")` branch in `getOcrBackend`.
- `src/document/PaperMdSerializer.ts` — narrow `OcrBackendId` from `"myscript" | "handwriting-ocr"` to just `"handwriting-ocr"`.
- `src/settings/PaperSettings.ts` — drop `myscriptApplicationKey`, `myscriptHmacKey`, `myscriptLanguage` fields and their defaults; narrow `ocrBackend` union; in `mergeSettings`, coerce a loaded `"myscript"` value to `"none"` so old settings don't blow up.
- `src/settings/PaperSettings.test.ts` — drop the three myscript fields from the round-trip fixture.
- `src/settings/PaperSettingsTab.ts` — drop the dropdown option, the appKey/hmacKey/language inputs, and the test-connection button.
- `src/ocr/IncrementalOcrRunner.ts` — update the inline comment that mentions MyScript by name (the stroke-based code path stays — it's part of the abstraction, not MyScript-specific).

**Leave:**
- `Claude/Plans/2026-04-23-add-myscript-ocr-backend.md` and the four MyScript-fix plans under `Claude/Plans/2026-04-24-myscript-*.md` — they're historical record.
- `Claude/Research/2026-04-23-paper-file-searchability-and-ocr-approaches.md` — historical decision context.

## Validation

`yarn build && yarn test && yarn build:copy`. The full suite must pass with one less backend.
