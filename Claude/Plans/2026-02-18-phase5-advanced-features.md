# Phase 5: Advanced Features — Implementation Plan

**Date:** 2026-02-18
**Parent Plan:** 2026-02-18-obsidian-paper-implementation-plan.md
**Phase:** 5 of 5

---

## Overview

Phase 5 adds advanced features for performance and power users: spatial indexing (R-tree), level-of-detail rendering, `.paper.md` hybrid format, SVG export, fountain pen ink pooling, and compressed storage (v2 format).

---

## Implementation Order

1. **Spatial Indexing (5.1)** — Foundation for performance; used by renderer and eraser
2. **Level-of-Detail Rendering (5.2)** — Uses spatial index, improves zoom-out performance
3. **SVG Export (5.4)** — Standalone feature, quick to implement
4. **Fountain Pen Ink Pooling (5.5)** — Visual enhancement, standalone
5. **Compressed Storage v2 (5.6)** — Storage optimization, needs backward compat
6. **`.paper.md` Hybrid Format (5.3)** — Most complex integration, does last

---

## 5.1 Spatial Indexing

### New Files
- `src/spatial/SpatialIndex.ts` — R-tree wrapper around rbush
- `src/spatial/SpatialIndex.test.ts` — Tests

### Implementation
- Install `rbush` library
- Wrap rbush with a `SpatialIndex` class that operates on Stroke bboxes
- Build index on document load (`buildFromStrokes`)
- Insert on stroke add, remove on stroke delete
- `queryRect(bbox)` → stroke indices for viewport culling
- `queryPoint(x, y, radius)` → stroke indices for eraser hit testing

### Changes to existing files
- `src/canvas/Renderer.ts` — Accept optional SpatialIndex for viewport culling
- `src/eraser/StrokeEraser.ts` — Accept optional SpatialIndex for hit testing
- `src/view/PaperView.ts` — Create/manage SpatialIndex, rebuild on document load, update on stroke add/remove

---

## 5.2 Level-of-Detail Rendering

### New Files
- `src/stroke/StrokeSimplifier.ts` — Ramer-Douglas-Peucker simplification
- `src/stroke/StrokeSimplifier.test.ts` — Tests

### Implementation
- RDP algorithm with configurable epsilon
- Two LOD levels: epsilon=2 (zoom 0.25-0.5x), epsilon=5 (zoom 0.1-0.25x)
- At zoom < 0.1: render as simple start-to-end lines
- LOD cache keyed by `{strokeId}-lod{level}`
- Renderer selects LOD based on current zoom

### Changes to existing files
- `src/canvas/Renderer.ts` — LOD selection in renderStrokeToContext
- `src/stroke/OutlineGenerator.ts` — StrokePathCache extended for LOD keys

---

## 5.3 `.paper.md` Hybrid Format

### New Files
- `src/document/HybridFormat.ts` — Parse/serialize .paper.md format
- `src/document/HybridFormat.test.ts` — Tests
- `src/view/HybridPaperView.ts` — MarkdownView extension for .paper.md

### Implementation
- Format:
  ```
  ---
  cssclasses: [obsidian-paper]
  paper-version: 1
  ---
  # Title
  Transcription text for search. [[links]] and #tags work.
  %%paper-data
  {"v":1, "strokes":[...]}
  %%
  ```
- `extractPaperData(markdown)` → JSON string
- `injectPaperData(markdown, jsonData)` → updated markdown
- Settings option to select default format (.paper vs .paper.md)

### Changes to existing files
- `src/main.ts` — Register .paper.md extension, format selection
- `src/settings/PaperSettings.ts` — Add `defaultFormat` setting

---

## 5.4 SVG Export

### New Files
- `src/export/SvgExporter.ts` — Convert strokes to SVG
- `src/export/SvgExporter.test.ts` — Tests

### Implementation
- Command: "Export paper as SVG"
- Convert each stroke's outline polygon to SVG `<path>` elements
- Respect stroke colors, opacity, highlighter mode
- Include background color
- Compute viewBox from content bbox
- Save to vault as `.svg` file

### Changes to existing files
- `src/main.ts` — Register export command

---

## 5.5 Fountain Pen Ink Pooling

### New Files
- `src/stroke/InkPooling.ts` — Detect and render ink pools
- `src/stroke/InkPooling.test.ts` — Tests

### Implementation
- Detect pool locations: stroke start/end + sharp direction changes
- Criteria: velocity < threshold AND curvature > threshold
- Render as slightly darker radial gradients
- Pool size proportional to dwell time and pressure
- Applied during stroke rendering (post-outline)

### Changes to existing files
- `src/canvas/Renderer.ts` — Call ink pooling during fountain pen rendering

---

## 5.6 Compressed Storage (v2 format)

### New Files
- `src/document/Compression.ts` — Deflate/inflate wrapper around fflate
- `src/document/Compression.test.ts` — Tests

### Implementation
- Install `fflate` library
- For large documents (> threshold): deflate pts strings → Base64 encode
- Document `"v": 2` signals compressed encoding
- v1 reader always works (backward compatible)
- Serializer auto-selects v1 or v2 based on document size

### Changes to existing files
- `src/document/Serializer.ts` — v2 serialize/deserialize with compression
- `src/types.ts` — Update SerializedDocument for v2 fields

---

## Estimated New Tests
- SpatialIndex: ~12 tests
- StrokeSimplifier: ~10 tests
- SvgExporter: ~10 tests
- InkPooling: ~8 tests
- Compression: ~10 tests
- HybridFormat: ~10 tests
- Integration: ~5 tests

Total: ~65 new tests (232 existing → ~297)
