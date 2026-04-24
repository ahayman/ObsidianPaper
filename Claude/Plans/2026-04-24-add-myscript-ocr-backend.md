# Add MyScript as a Second OCR Backend

**Date:** 2026-04-24
**Status:** Planning → immediate implementation.

## Goal

Offer MyScript iink Cloud alongside Handwriting OCR so the user can compare recognition quality. MyScript is **stroke-based**, which for cursive Latin should beat image-based OCR because stroke order disambiguates letter shapes that look identical when rendered.

## Non-goals

- Replacing Handwriting OCR (stays as the default option).
- Using MyScript's JS SDK (iinkTS/iinkJS) — too heavy, UI-focused, and we only want the REST recognition call.
- Math, diagrams, shape recognition — text only.
- Online/streaming (WebSocket) recognition — REST batch is enough.

## MyScript REST API shape (confirmed from docs + iinkJS example)

- **Endpoint:** `POST https://cloud.myscript.com/api/v4.0/iink/batch/` (text). The newer `/recognize/` endpoint exists too but `/batch/` is what the JS examples target.
- **Headers:**
  - `Content-Type: application/json`
  - `Accept: application/json,text/plain`
  - `applicationKey: <app-key>` (as-is)
  - `hmac: <HMAC-SHA512(body, key=appKey+hmacKey)>` (hex-encoded)
- **Body:**
  ```json
  {
    "xDPI": 96,
    "yDPI": 96,
    "contentType": "Text",
    "configuration": {
      "lang": "en_US",
      "text": { "guides": { "enable": false } }
    },
    "strokeGroups": [
      {
        "strokes": [
          { "x": [123.4, 124.1, ...], "y": [50.2, 50.4, ...], "t": [0, 16, ...], "p": [0.5, 0.52, ...] }
        ]
      }
    ]
  }
  ```
- **Response** (when `Accept: text/plain`): plain text body with the recognized transcript. With `Accept: application/json`: `{ "exports": { "text/plain": "...", "application/vnd.myscript.jiix": {...} } }` where JIIX contains word/line bboxes.
- **Auth secrets:** both `applicationKey` and `hmacKey` (two keys, not one). Free tier: 2k recognitions/month.

## Design

### Backend-interface evolution

Current `OcrBackend.recognizeDocument` takes `OcrPageBitmap[]`. MyScript needs stroke data, not bitmaps. Two options considered; going with **backend declares its input type**:

```typescript
interface OcrBackend {
  readonly id: OcrBackendId;
  readonly inputType: "image" | "strokes"; // NEW
  isConfigured(): boolean;
  testConnection(): Promise<OcrTestResult>;
  recognizeDocument(input: OcrDocumentInput): Promise<OcrResult>;
}

interface OcrPageInput {
  pageIndex: number;
  // Exactly one is populated, matching the backend's inputType.
  blob?: Blob;        // for image backends
  strokes?: Stroke[]; // for stroke backends
}
```

`IncrementalOcrRunner` checks `backend.inputType` and prepares the right payload per page — either calls the existing rasterizer (image) or collects strokes by pageIndex (strokes). The rest of the orchestrator (dirty-page detection, result merging, page stroke-ID tracking) is unchanged.

### MyScriptBackend.ts

- REST client calling `cloud.myscript.com/api/v4.0/iink/batch/`.
- HMAC-SHA512 via Web Crypto (`crypto.subtle.importKey` + `sign`) — works in Electron and iOS WebView, no native deps.
- One stroke group per page is fine for text; stroke x/y/t arrays built by decoding existing `Stroke.pts` via `decodePoints`.
- Timestamp: if the stroke's decoded points carry `t`, use them; otherwise synthesize monotonic offsets (MyScript mostly cares about relative timing).
- Pressure: pass through if present.
- Skip highlighter strokes — they're annotations, not text.
- Transform: apply stroke.transform to points before sending (so rotated/scaled strokes match the visual).
- Coordinate space: send in world units at 96 DPI (`xDPI: 96, yDPI: 96`).
- Language: take from settings (default `en_US`).

### Settings additions

```typescript
ocrBackend: "none" | "handwriting-ocr" | "myscript"  // expanded
myscriptApplicationKey: string
myscriptHmacKey: string
myscriptLanguage: string    // e.g., "en_US", default
```

### Settings UI

Backend dropdown gets a third option. When `myscript` is selected, show two password fields (appKey, hmacKey), a language text input, and a "Test connection" button.

## Implementation order

1. **OcrBackend interface**: add `inputType`, extend `OcrPageInput` with optional `strokes`. Update `HandwritingOcrBackend` to declare `inputType: "image"`.
2. **IncrementalOcrRunner**: branch on `backend.inputType` — existing rasterize path for image, new stroke-collect path for strokes. Tests.
3. **MyScriptBackend.ts**: REST client + HMAC + stroke→request conversion. Unit tests for HMAC, body shape, response parsing.
4. **Settings**: fields, defaults, UI rows, test-connection button.
5. **main.ts**: `getOcrBackend()` returns the right backend for the selected ID.
6. **Build + test + deploy + commit**.

## Open questions (flagged, not blocking)

- MyScript's `/batch/` vs `/recognize/` endpoint — JS examples use `/batch/`, newer docs mention `/recognize/`. I'll start with `/batch/` (what's in the working examples) and note the alternative in the code.
- JIIX response parsing — MyScript returns per-word bounding boxes in JIIX. Tempting to use them to populate `OcrLine.bbox`/`OcrWord.bbox` (useful for stroke↔word mapping later), but adds complexity. For this first pass we'll use `Accept: text/plain` and split by newline — same shape as HWOCR. JIIX parsing can be a follow-up.
- Incremental OCR — MyScript recognizes one "group" at a time. We can send per-page groups and the runner's existing per-page dirty detection still works. Finer-grained (per-line) re-OCR remains a future optimization.
