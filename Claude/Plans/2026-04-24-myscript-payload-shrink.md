# MyScript Payload Shrink (413 fix)

## Problem

A single journal page produced a 14.8 MB request body, blowing past MyScript's 4 MB cap:

```
413 {"code":"access.payload.too.big","message":"Payload size 14,869,637 exceeds size 4,000,000"}
```

## Where the bytes go

The wire format is parallel arrays inside `strokeGroups[].strokes[]`:

```json
{ "x":[...], "y":[...], "t":[...], "p":[...] }
```

Per point, today's encoder emits roughly:

| Field   | Why it's expensive                                                                 | Sample                  |
|---------|-------------------------------------------------------------------------------------|-------------------------|
| `t`     | Absolute `Date.now()` ms — 13 digits per value                                      | `1750000000123,`        |
| `p`     | `int / 255` decode produces values like `0.07058823529411765` — full IEEE-754 print | `0.0705882352941176,`   |
| `x`,`y` | After `stroke.transform` matrix multiply we get float artifacts (`100.00000000003`) | `100.00000000003,`      |

Plus we send every captured point. Apple Pencil samples ~120 Hz; a dense page can hit 250k+ points. None of that resolution helps OCR — MyScript characterizes shape, not sub-pixel detail.

## Fix

In `strokesToMyScriptFormat` only — the rest of the pipeline keeps the original `pts` blob, so nothing else is affected.

1. **RDP-simplify** each decoded stroke with `epsilon = 1` (one world-unit / 1 pt at 72 PPI). Existing utility: `src/stroke/StrokeSimplifier.ts:rdpSimplify`. Conservative threshold — well below the smallest meaningful pen movement, but enough to drop 3–5× of redundant samples on long curves.

2. **Relative timestamps** per stroke. Subtract `points[0].timestamp` so each `t[]` starts at 0. Within-stroke deltas (which is what MyScript actually uses for cursive disambiguation) are preserved exactly.

3. **Round x, y to 1 decimal** after the transform multiply. The original encoder is already 0.1 px precision, so 1 decimal is lossless relative to what we have on disk.

4. **Round pressure to 2 decimals.** OCR doesn't care about the difference between `0.4823647` and `0.48`.

These all happen in one pass over the simplified point list — no perf concern.

## What we don't change

- The `inputType="strokes"` branch in the runner.
- The HMAC/auth path.
- Stroke ordering or grouping (`strokeGroups[].strokes[]` shape stays identical).
- The on-disk `pts` encoding. We only adjust what gets serialized to the API body.

## Estimated impact

For a representative page:

- Pressure rounding: ~4× shrink on `p[]`.
- Relative timestamps: ~3× shrink on `t[]`.
- RDP @ ε=1: ~3–5× point-count reduction on `x`, `y`, `t`, `p` together.
- x/y rounding: minor (~10–15%).

Combined: 5–15× total. 14.8 MB → ~1–3 MB, comfortably under 4 MB for typical journal pages.

If a page is genuinely too big after this (someone's writing 600+ strokes of fine detail), the existing `MyScript failed: 413 ...` message surfaces clearly to the user — handle that with paging/chunking later if it actually happens.

## Files Touched

- `src/ocr/MyScriptBackend.ts` — `strokesToMyScriptFormat` only.
- `src/ocr/MyScriptBackend.test.ts` — fixture timestamps already start at 0 in the existing test, so the relative-timestamp change won't break expectations. The transform test already uses integers (`100`, `50`, etc.) which round to themselves. Pressure test uses `0.2`/`0.8`, already 1-decimal — round to 2 decimals is a no-op.

No type changes, no API changes, no other consumers affected.

## Validation

- `yarn build && yarn test && yarn build:copy`.
- Manual: same journal page that produced 14.8 MB, retry OCR, confirm no 413.
