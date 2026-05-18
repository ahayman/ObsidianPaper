# Ribbon Icon for "New Paper Document"

## Why

On iPad the only way to start a new `.paper.md` document is right-click → menu (awkward without a mouse) or the command palette (too many keystrokes). A ribbon icon is the canonical Obsidian shortcut: swipe the sidebar in, one tap, modal opens.

## What

Add a ribbon icon via `addRibbonIcon("pen-tool", "New handwriting note", ...)` in `Plugin.onload()`. The callback delegates to the existing `createNewPaper()` method — the same code path that the `create-paper` command and the file/folder context-menu items already use, so behavior (folder resolution, default name, modal flow) is identical across all four entry points.

`addRibbonIcon` returns an `HTMLElement`. We don't need to capture or style it — the default ribbon styling matches every other plugin's ribbon icon, which is what users expect.

## Why `pen-tool` for the icon

The existing file-menu and folder-menu "Create paper note" entries already use `setIcon("pen-tool")` (`src/main.ts:334`, `:982`). Same icon → same affordance.

## Files Touched

- `src/main.ts` — one new `this.addRibbonIcon(...)` call in `onload()`, placed next to the existing `create-paper` command registration so the two entry points are co-located. No other changes.

## Validation

`yarn build && yarn test && yarn build:copy`.

Manual smoke test on iPad after sync: tap the ribbon icon → modal opens with default name + folder → confirm → new `.paper.md` opens in the active leaf. Same behavior as the command palette path.
