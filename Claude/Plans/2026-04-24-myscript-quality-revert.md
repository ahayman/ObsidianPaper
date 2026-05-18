# MyScript Quality Revert: drop RDP + per-stroke relative timestamps

## Problem

After payload-shrink + chunking, MyScript transcripts came back with phantom characters and broken line layout — substantially worse than Handwriting OCR on the same pages.

## Hypothesis

Two of the four shrink levers are likely destroying recognition signal:

1. **Per-stroke relative timestamps** (`t[i] = pt.timestamp - t0`). Each stroke's `t[]` starts at 0, so two consecutive strokes look "drawn simultaneously" to MyScript. The recognizer uses inter-stroke timing to group letters into words and segment lines — zeroing it out is exactly the kind of corruption that produces phantom inter-word characters.

2. **RDP at ε=1**. For tight handwriting, 1 world unit can smooth the closure of a bowl ("a"/"o"), the difference between "n" and "h", or punctuation strokes. Light dejittering helps; aggressive simplification hurts.

The other two levers (coord rounding to 1 decimal, pressure rounding to 2 decimals) are essentially lossless at handwriting scales — keep them.

## Approach

Strip RDP and the per-stroke `t0` normalization. Send absolute `Math.round(pt.timestamp)` and the full point list. Chunking handles size — that's its whole job — so we don't need micro-shrinking at the cost of recognition quality.

If the resulting body is still consistently large enough to drive 3+ chunks per page (extra cost), revisit with a much more conservative RDP (ε≈0.3) and/or page-global timestamp reference (subtract t0 of the *first* stroke from all). But ship the simple revert first and observe.

## Files Touched

- `src/ocr/MyScriptBackend.ts`
  - Remove `import { rdpSimplify } from "../stroke/StrokeSimplifier";`.
  - Remove the `OCR_RDP_EPSILON` constant.
  - In `strokesToMyScriptFormat`: drop the `simplified = rdpSimplify(...)` step and the `t0` capture; iterate `decoded` directly; emit `t[i] = Math.round(pt.timestamp)`.
  - Keep coord/pressure rounding as-is.

- `src/ocr/MyScriptBackend.test.ts`
  - Delete the "simplifies collinear points via RDP" test (no longer applicable).
  - Delete the "emits timestamps relative to each stroke's first point" test (no longer applicable).
  - Restore the original "populates x/y/t arrays in point order" fixture (collinear, all three points kept since RDP is gone).
  - Keep the rounding and transform tests; they're unaffected.

## Validation

- `yarn build && yarn test && yarn build:copy`.
- Manual: re-run OCR on the same page that produced garbage. Compare quality to Handwriting OCR on the same page. If it's now competitive, the diagnosis was right and we keep MyScript. If still bad, MyScript is the wrong tool for this corpus and we rip it out.
