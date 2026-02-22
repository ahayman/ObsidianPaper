# Embedded Paper — Linked File Previews

## Overview

Enhance the existing `![[name.paper]]` embed support from a static preview to a richer experience with configurable sizing and a fullscreen editing modal. Paper data stays in `.paper` files — embeds are just references, like Excalidraw.

## What Already Exists

- **Reading mode:** `EmbedPostProcessor` renders `![[name.paper]]` and `![[name.paper|width]]` as static canvas previews with click-to-open
- **Live preview:** `EmbedViewPlugin` provides CM6 widget rendering via `renderPaperWidget()`
- **Renderer:** `EmbedRenderer.renderEmbed()` draws pages + strokes onto a canvas, scaled to fit `maxWidth`

## What's Changing

### 1. Configurable embed view size (settings)

Currently embeds scale to fit their container width with no height constraint — a multi-page document renders at full height. Add settings so users can control default embed dimensions:

- `embedMaxWidth: number` — Max width in pixels (default: `0` = fill container)
- `embedMaxHeight: number` — Max height in pixels (default: `400`). Clips the preview if the document is taller.

These are separate from page size settings. They control how much space the _preview_ occupies in the markdown document.

### 2. Height parameter in embed syntax

Extend the existing `|width` parameter parsing to support `|widthxheight`:

- `![[name.paper]]` — Uses defaults
- `![[name.paper|600]]` — 600px max width (existing behavior)
- `![[name.paper|600x300]]` — 600px max width, 300px max height

### 3. Expand-to-fullscreen button

Add a small button overlay on embeds that opens the paper file in a fullscreen modal for editing. Currently clicking anywhere on the embed opens the file in a new leaf — we'll keep that as default but add an explicit expand button:

- Expand button (top-right corner of the embed) → opens `EmbeddedPaperModal`
- Click on the canvas itself → still opens in a leaf (existing behavior)
- On modal close → re-render the embed preview to reflect any changes made

### 4. Auto-refresh on file change

When the `.paper` file is modified (e.g., after editing in a leaf or modal), embeds referencing it should re-render. Use Obsidian's vault `modify` event to watch for changes and trigger re-renders.

## Implementation Plan

### Phase 1: Settings

**Files:** `src/settings/PaperSettings.ts`, `src/settings/PaperSettingsTab.ts`

1. Add to `PaperSettings`:
   ```typescript
   embedMaxWidth: number;   // 0 = fill container (default)
   embedMaxHeight: number;  // 0 = no limit, default: 400
   ```

2. Add to `DEFAULT_SETTINGS`:
   ```typescript
   embedMaxWidth: 0,
   embedMaxHeight: 400,
   ```

3. Add "Embeds" section to `PaperSettingsTab` with:
   - Max width slider/input (0–1200, 0 = auto)
   - Max height slider/input (0–1200, 0 = no limit)

### Phase 2: Enhanced Embed Renderer

**Files:** `src/embed/EmbedRenderer.ts`, `src/embed/EmbedPostProcessor.ts`, `src/embed/EmbedViewPlugin.ts`

1. **Update `renderEmbed()`** to accept a `maxHeight` parameter:
   - After computing the display dimensions, if `displayHeight > maxHeight`, clip to `maxHeight`
   - The canvas renders at full size but the container constrains visible area with `overflow: hidden`
   - This shows the top portion of the document as a preview

2. **Update parameter parsing** in `EmbedPostProcessor.processEmbed()`:
   - Parse `|600x300` syntax: split on `x` to get width and height
   - Fall back to settings defaults when not specified

3. **Apply same parsing** to `EmbedViewPlugin.renderPaperWidget()`

### Phase 3: Expand Button & Modal

**New file:** `src/embed/EmbeddedPaperModal.ts`
**Modified files:** `src/embed/EmbedPostProcessor.ts`, `src/embed/EmbedViewPlugin.ts`

1. **Add expand button to embed containers:**
   - Small icon button (expand/fullscreen icon) positioned top-right of the embed
   - Appears on hover (desktop) or always visible (mobile)
   - `stopPropagation()` so it doesn't trigger the existing click-to-open-in-leaf behavior

2. **`EmbeddedPaperModal` class** (extends Obsidian `Modal`):
   - Opens the `.paper` file in a full-screen modal
   - Reuses the same PaperView component architecture (Camera, Renderer, InputManager, Toolbar, etc.)
   - But instead of extending `TextFileView`, it manages its own document lifecycle:
     - On open: read file, deserialize, initialize canvas
     - On save: serialize and write to file via `app.vault.modify()`
     - On close: final save, call `onClose` callback so the embed can re-render
   - Constructor: `(app: App, file: TFile, settings: PaperSettings, onClose: () => void)`

3. **Wire up the flow:**
   - Embed expand button → `new EmbeddedPaperModal(app, file, settings, () => reRender()).open()`
   - Modal close → callback triggers `renderEmbed()` again with fresh file data

### Phase 4: Auto-Refresh

**Files:** `src/main.ts`, `src/embed/EmbedPostProcessor.ts`

1. **Track active embeds** — Maintain a registry of `{ filePath, containerEl, reRender() }` entries
2. **Listen for vault `modify` events** in `main.ts`:
   ```typescript
   this.registerEvent(this.app.vault.on("modify", (file) => {
     if (file.extension === PAPER_EXTENSION) {
       this.refreshEmbedsFor(file.path);
     }
   }));
   ```
3. **On modify** — Find all registered embeds for that file path, call their `reRender()` to re-read the file and redraw the canvas
4. **Cleanup** — Use a MutationObserver or periodic sweep to remove entries whose container elements are no longer in the DOM

### Phase 5: Styles

**File:** `styles.css`

```css
/* Embed height constraint */
.paper-embed-container {
  position: relative;
  /* existing styles preserved */
}
.paper-embed-container[data-max-height] {
  overflow: hidden;
}

/* Expand button */
.paper-embed-expand-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0;
  transition: opacity 150ms;
  /* standard Obsidian button styling */
}
.paper-embed-container:hover .paper-embed-expand-btn {
  opacity: 0.8;
}

/* Fullscreen modal */
.paper-modal .modal-content {
  padding: 0;
  overflow: hidden;
}
.paper-modal .paper-view-container {
  width: 100%;
  height: 100%;
}
```

### Phase 6: Testing

1. Parameter parsing tests — `"600"` → `{width: 600}`, `"600x300"` → `{width: 600, height: 300}`, `""` → defaults
2. Embed renderer height clipping — verify canvas dimensions when maxHeight constrains
3. Auto-refresh registry — add/remove/trigger cycle

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `src/settings/PaperSettings.ts` | Modify | Add `embedMaxWidth`, `embedMaxHeight` |
| `src/settings/PaperSettingsTab.ts` | Modify | Add Embeds settings section |
| `src/main.ts` | Modify | Add vault modify listener for auto-refresh |
| `src/embed/EmbedRenderer.ts` | Modify | Add `maxHeight` support |
| `src/embed/EmbedPostProcessor.ts` | Modify | Parse `WxH` syntax, add expand button, embed registry |
| `src/embed/EmbedViewPlugin.ts` | Modify | Same enhancements for live preview |
| `src/embed/EmbeddedPaperModal.ts` | **New** | Fullscreen editing modal |
| `styles.css` | Modify | Embed height, expand button, modal styles |

## Considerations

### Why not inline editing?

Embedding live-editable canvases in markdown documents introduces hard problems:
- **Concurrency:** Multiple embeds of the same file, or an embed + an open leaf editing the same file simultaneously
- **Web Workers:** Each active canvas needs its own rendering pipeline; multiple on one page is expensive
- **Data size:** Serialized paper data in code blocks bloats the markdown file and makes it hard to read/edit as text
- **Save complexity:** Writing back into code blocks requires fragile line-range tracking

By keeping embeds as read-only previews with click-to-edit (in modal or leaf), all editing goes through the existing `PaperView` flow with no new concurrency concerns.

### Modal vs. Leaf

The expand button opens a **modal** rather than navigating to a new leaf because:
- User stays in context — they can close and continue reading where they left off
- No tab/leaf navigation required
- The embed auto-refreshes on close, giving immediate visual feedback
- The existing click-on-canvas behavior still opens in a leaf for users who prefer that workflow
