# MyScript Per-Page Chunking

## Why

Even after the payload-shrink pass (RDP, relative timestamps, rounded coords/pressure), a page that mixes journal text with margin sketches can exceed MyScript's 4 MB request cap. The user explicitly expects this — sketches alongside writing is a common case for them. We need a graceful path that handles oversize pages instead of failing with a 413.

## Approach

Greedy bin-pack at stroke boundaries, in capture order, into multiple POSTs per page.

```
strokesToMyScriptFormat(pageStrokes)         // already-shrunk MyScriptStroke[]
  │
  ▼
chunkStrokesByByteSize(strokes, MAX_BYTES)   // → MyScriptStroke[][]
  │
  ▼ for each chunk
buildRequestBody(chunk, language) → POST    // one MyScript billing unit per chunk
  │
  ▼
transcripts.join("\n") → transcriptToLines  // assemble the per-page result
```

### Why these design choices

- **Stroke boundaries (never split mid-stroke).** After payload shrink, no single stroke approaches the limit. Splitting mid-stroke would lose recognition fidelity and complicate the helper. Stroke-boundary chunks fit naturally and never break a character.

- **Capture order (not Y-sorted).** Apple Pencil capture order is roughly reading order, and MyScript's recognizer uses inter-stroke temporal cues (e.g., to group words). Sorting by Y would shuffle that signal. The trade-off: a stroke that lands across a chunk boundary (say, an "i" dot written after a line) loses inter-chunk context. Tolerable, since chunks are several MB each so this is rare.

- **3.5 MB threshold (`MAX_CHUNK_BYTES`).** MyScript caps at 4 MB; 12.5% headroom covers JSON envelope (`{xDPI, yDPI, contentType, configuration, strokeGroups: [{strokes:[...]}]}` ≈ 200 bytes) and any minor encoding fluctuation. Lower thresholds would just inflate billing without improving safety.

- **Cost-aware default.** Chunking is opt-in only when needed: pages under 3.5 MB still send as a single request (1 recognition unit). Only oversize pages pay for extra calls. A 7 MB page becomes 2 recognitions, an 11 MB page becomes 3.

- **Reassembly: `transcripts.join("\n")`.** `transcriptToLines` already splits on `\n` and filters empties, so concatenating with newline preserves line semantics regardless of where chunk boundaries fell.

### Edge case: a stroke larger than the threshold

Should be impossible after payload shrink (would require ~30k decoded points in one continuous stroke). If it happens, the helper still emits that stroke as its own one-stroke chunk; MyScript will return 413 and we surface that error verbatim to the user.

## Files Touched

- `src/ocr/MyScriptBackend.ts`
  - New constant: `MAX_CHUNK_BYTES = 3_500_000`.
  - New exported helper: `chunkStrokesByByteSize(strokes, maxBytes?)` that returns `MyScriptStroke[][]`.
  - `recognizeDocument`: replace the per-page single POST with a chunk loop. Concatenate transcripts and pass through `transcriptToLines`. Update the existing `console.log` to mention chunk count when > 1.
  - Aborts and per-chunk progress phases are honored; no API surface change.

- `src/ocr/MyScriptBackend.test.ts`
  - Unit tests for `chunkStrokesByByteSize`:
    - Empty input → `[]`.
    - All strokes fit → 1 chunk.
    - Total exceeds threshold → multiple chunks; each chunk under threshold.
    - Single oversize stroke → 1 chunk containing only that stroke (graceful handling).
  - One integration-ish test for `recognizeDocument` with two chunks → confirms two POSTs, transcripts concatenated.

No type changes. No consumer-side changes.

## Validation

`yarn build && yarn test && yarn build:copy`.

Manual: re-OCR the journal page that previously hit 413. Console should log chunk count if > 1, and the resulting transcript should appear in the `# Transcript` section.
