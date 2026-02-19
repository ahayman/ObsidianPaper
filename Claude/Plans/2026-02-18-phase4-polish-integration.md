# Phase 4: Polish & Integration — Implementation Plan

**Date:** 2026-02-18
**Parent Plan:** 2026-02-18-obsidian-paper-implementation-plan.md
**Phase:** 4 of 5

---

## Overview

Phase 4 adds polish features and Obsidian integration: markdown embedding (reading mode + live preview), a settings tab, Apple Pencil hover cursor, page backgrounds (lined/grid/dot-grid), and barrel rotation support for Apple Pencil Pro.

---

## 4.1 Settings System

**Why first:** Settings are needed by embeddings, backgrounds, and hover cursor, so this goes first.

### New Files
- `src/settings/PaperSettings.ts` — Settings interface + defaults + load/save
- `src/settings/PaperSettingsTab.ts` — Settings UI extending `PluginSettingTab`
- `src/settings/PaperSettings.test.ts` — Tests

### PaperSettings interface
```typescript
interface PaperSettings {
  // Pen defaults
  defaultPenType: PenType;
  defaultColorId: string;
  defaultWidth: number;
  pressureSensitivity: number; // 0-1 multiplier

  // Canvas
  defaultPaperType: PaperType;
  defaultBackgroundColor: string;
  showGrid: boolean;
  gridSize: number;
  lineSpacing: number;

  // Input
  palmRejection: boolean;
  fingerAction: "pan" | "draw";

  // Smoothing
  defaultSmoothing: number; // 0-1

  // File
  defaultFolder: string;
  fileNameTemplate: string;
}
```

### Settings Tab
- Uses Obsidian's `Setting` API with `addDropdown`, `addSlider`, `addToggle`, `addText`
- Sections: Pen, Canvas, Input, Smoothing, File
- Notifies open PaperViews when settings change via a callback pattern

### Changes to existing files
- `src/main.ts` — Load/save settings, pass to PaperView, register settings tab, add `onSettingsChange` event
- `src/view/PaperView.ts` — Accept settings, use defaults from settings instead of hardcoded values

---

## 4.2 Page Backgrounds

### New Files
- `src/canvas/BackgroundRenderer.ts` — Renders paper backgrounds on a dedicated canvas layer
- `src/canvas/BackgroundRenderer.test.ts` — Tests

### Background types
- **Blank** — Just background color fill
- **Lined** — Horizontal ruled lines (configurable spacing)
- **Grid** — Square grid lines (configurable size)
- **Dot grid** — Dot pattern at grid intersections

### Implementation
- Adds a 4th canvas layer (below static layer, z-index 0)
- Background follows camera transform (zooms/pans with content)
- Background color respects light/dark mode:
  - Light: white (#fffff8), cream (#fdf6e3), yellow (#fff8dc)
  - Dark: dark gray (#1e1e1e), slate (#2d333b), sepia-dark (#352f28)
- Line/grid colors: light gray in light mode, subtle gray in dark mode
- Re-renders on camera change (zoom/pan) and theme change

### Changes to existing files
- `src/canvas/Renderer.ts` — Add background canvas layer, delegate background rendering to BackgroundRenderer
- `styles.css` — Add `.paper-background-canvas` with z-index 0
- `src/view/PaperView.ts` — Pass paperType/settings to renderer, handle paperType changes

---

## 4.3 Hover Cursor

### New Files
- `src/input/HoverCursor.ts` — Hover cursor overlay
- `src/input/HoverCursor.test.ts` — Tests

### Implementation
- Detect Apple Pencil hover: `pointerType === "pen"` with `pressure === 0` during `pointermove`
- DOM-based cursor element (circle div) positioned absolutely
- Cursor size reflects current pen width × zoom
- Cursor color matches current ink color (resolved for theme)
- Hide on `pointerleave`, when drawing starts (`pressure > 0`), or when eraser is active
- Show eraser circle cursor when eraser tool is selected

### Changes to existing files
- `src/input/InputManager.ts` — Add `onHover` callback
- `src/view/PaperView.ts` — Create HoverCursor, wire to InputManager hover events
- `styles.css` — Hover cursor styles

---

## 4.4 Markdown Embedding

### New Files
- `src/embed/EmbedRenderer.ts` — Shared static rendering logic for embeds
- `src/embed/EmbedPostProcessor.ts` — Reading mode `registerMarkdownPostProcessor`
- `src/embed/EmbedViewPlugin.ts` — Live preview CM6 `ViewPlugin` + `WidgetType`
- `src/embed/EmbedRenderer.test.ts` — Tests

### Reading Mode (`registerMarkdownPostProcessor`)
- Obsidian calls the post processor for `![[*.paper]]` embed references
- Load file via `app.vault.read()`, parse JSON, render static preview to `<canvas>`
- Click-to-open: clicking embed opens full editor via `app.workspace.openLinkText()`
- Embed sizing: width = 100% container, height = proportional to canvas aspect ratio
- Support Obsidian's embed size syntax: `![[sketch.paper|400]]` for explicit width

### Live Preview (CM6 ViewPlugin)
- `ViewPlugin` + `WidgetType` for live preview embeds
- Detect `![[*.paper]]` patterns using Obsidian's `parseLinktext()`
- Replace with canvas-rendered widget inline in the editor

### Changes to existing files
- `src/main.ts` — Register post processor and editor extension
- `__mocks__/obsidian.ts` — Add `MarkdownPostProcessorContext`, `EditorView` mocks as needed

---

## 4.5 Barrel Rotation Support

### Changes to existing files
- `src/stroke/PenConfigs.ts` — Add `useBarrelRotation` flag to fountain pen config
- `src/stroke/PenEngine.ts` — When barrel rotation detected (non-zero twist), use twist as nib angle for fountain pen
- `src/input/InputManager.ts` — Already captures `event.twist`; add feature detection (observe non-zero twist values)

### Feature detection
- No API to detect Apple Pencil Pro ahead of time
- Observe non-zero twist values during use, set a flag
- When detected, fountain pen uses `twist` as dynamic nib angle instead of fixed angle

---

## Implementation Order

1. **Settings** (4.1) — Foundation for other features
2. **Page Backgrounds** (4.2) — Uses settings for defaults
3. **Hover Cursor** (4.3) — Independent, quick to implement
4. **Barrel Rotation** (4.5) — Small, incremental change
5. **Markdown Embedding** (4.4) — Most complex, does last

---

## Estimated New Tests
- PaperSettings: ~10 tests (defaults, load/save, merge)
- BackgroundRenderer: ~12 tests (each bg type renders, theme colors, camera transform)
- HoverCursor: ~8 tests (show/hide states, size/color, position)
- EmbedRenderer: ~8 tests (static render, sizing, click handling)
- Barrel rotation: ~4 tests (twist detection, nib angle override)
- Settings tab: ~6 tests (display, callbacks)

Total: ~48 new tests (183 existing → ~231)
