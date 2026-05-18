# Fix: "View Raw" Snaps Back to Paper View

## Problem

Tapping the "View raw (markdown)" button in the document-settings popover briefly shows the markdown view, then the Paper view replaces it.

## Root cause

`togglePaperView` does two things in sequence:
1. `processFrontMatter` to write `paper-default-view: markdown`.
2. `setViewState({ type: "markdown" })` to flip the active leaf.

Both are async. Step 2 immediately triggers a `file-open` / `active-leaf-change` event, which fires `considerSwap` → `maybeSwapToPaperView`. That handler reads the frontmatter via `metadataCache.getFileCache(file)` — but the cache has not yet been updated with the write from step 1. It still reports `paper-default-view: paper`, so `maybeSwapToPaperView` proceeds to swap the markdown view back to Paper.

The fix has to bridge that race window without weakening the persistent-preference semantics.

## Approach

Add an in-memory `Set<string>` (file paths) that records "user just requested markdown view for this file." The set is the immediate, race-free signal that the auto-swapper consults first; the metadataCache (frontmatter) remains the persistent source of truth across reloads.

- `togglePaperView` mutates the set the same instant it calls `setViewState`, so by the time `considerSwap` runs, the bypass is already in place.
- The set is cleared on the symmetric path (toggling back to Paper, or any explicit `openInPaperView`) so the user can flip back without a stale block.
- The set is in-memory only. After a plugin reload, the persisted frontmatter takes over — which is the same outcome the user got from the toggle, so behavior is consistent across sessions.

## Why not simply re-read after the write?

`processFrontMatter` does not block on the metadataCache reflecting the new value — the cache update is event-driven, fired later when Obsidian re-parses the file. Awaiting `processFrontMatter` doesn't help; awaiting the next `metadataCache.on("changed")` would be brittle and slow. An in-memory bypass is both simpler and more reliable.

## Files Touched

- `src/main.ts`
  - New field: `private userRequestedMarkdown = new Set<string>()`.
  - `togglePaperView`: after computing `nextView`, mutate the set — `add(file.path)` when flipping to markdown, `delete(file.path)` when flipping back to paper.
  - `openInPaperView`: `userRequestedMarkdown.delete(file.path)` so an explicit "open in Paper view" action clears any stale bypass.
  - `maybeSwapToPaperView`: at the top, if the set contains the file path, return early — same effect as `paper-default-view === "markdown"`.

No type changes, no test changes (the existing `main.test.ts` doesn't exercise view-toggle race conditions and the bypass is internal).

## Validation

- `yarn build && yarn test && yarn build:copy`.
- Manual smoke test: open a `.paper.md` in Paper view → tap "View raw" → markdown view stays put.
- Toggle back via the markdown view's command (uses the same `togglePaperView`) → Paper view returns; the bypass clears.
- Reload Obsidian after step 1 → file opens directly in markdown (frontmatter has `paper-default-view: markdown`).
