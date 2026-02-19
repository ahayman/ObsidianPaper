# Page-Based Canvas

**Date:** 2026-02-19
**Status:** Draft

## Overview

Transform the current infinite canvas into a page-based document model. Instead of one unbounded writing surface, documents contain one or more discrete "pages" with defined sizes (US Letter, A4, A5, etc.). Lines, grids, and dots are confined to page boundaries. Strokes are visually clipped to their page but the underlying data is not modified. Pages are visually distinct from the surrounding canvas via background contrast. Zoom is constrained relative to page width. Pan is constrained so at least 20pt of a page is always visible.

## Current State

- **Document model** (`types.ts`): Single `CanvasConfig` with `width`/`height` — one canvas, no concept of pages
- **Camera** (`Camera.ts`): Zoom range 0.1–5.0, no constraints on pan
- **BackgroundRenderer** (`BackgroundRenderer.ts`): Renders patterns (lined/grid/dot-grid) across the entire visible world rect — infinite in all directions
- **Renderer** (`Renderer.ts`): 4-layer canvas system, no page awareness
- **Serializer** (`Serializer.ts`): Serializes a single `canvas` config, not an array of pages
- **Settings** (`PaperSettings.ts`): No page size setting

## Design

### Page Sizes (World Units)

Standard page sizes at 72 PPI (matching PDF convention), stored as portrait dimensions (width < height). Orientation flag swaps them at layout time.

| Name | Inches | World Units (px @ 72 PPI) |
|------|--------|--------------------------|
| US Letter | 8.5 × 11 | 612 × 792 |
| US Legal | 8.5 × 14 | 612 × 1008 |
| A4 | 8.27 × 11.69 | 595 × 842 |
| A5 | 5.83 × 8.27 | 420 × 595 |
| A3 | 11.69 × 16.54 | 842 × 1191 |
| Custom | user-defined | converted from inches or cm at 72 PPI |

### Page Orientation

Each page has an `orientation` field: `"portrait"` (default) or `"landscape"`.
- **Portrait**: uses preset dimensions as-is (width < height)
- **Landscape**: swaps width and height at layout time
- Default orientation set in settings; per-page override stored in document

### Page Layout Direction

Pages can be arranged:
- **Vertical** (default): top-to-bottom, centered on world X axis
- **Horizontal**: left-to-right, centered on world Y axis

Layout direction is saved per-document (with a default in settings). The user can change it at any time.

### Page Layout

- Gap between pages: **40 world units** (configurable constant)
- Each page has its own `paperType`, `lineSpacing`, `gridSize` (inherited from document defaults unless overridden)
- Strokes are stored **per-page** (each stroke has a `pageIndex` field)

**Vertical layout:**
- Pages centered on X=0: `x = -effectiveWidth / 2`
- Y position accumulated: each page starts at `prevPage.y + prevPage.height + PAGE_GAP`

**Horizontal layout:**
- Pages centered on Y=0: `y = -effectiveHeight / 2`
- X position accumulated: each page starts at `prevPage.x + prevPage.width + PAGE_GAP`

### Visual Appearance

- **Page area**: Rendered with the paper background color (light: `#fffff8`, dark: `#1e1e1e`)
- **Outside page area**: Rendered with a contrasting "desk" color (light: `#e8e8e8`, dark: `#111111`)
- **Page shadow**: Subtle drop shadow on each page for depth (2px offset, 8px blur, 20% black)
- Lines/grid/dots are clipped to page boundaries
- **Strokes are visually clipped** to their page boundary during rendering (using canvas clip regions), but the underlying stroke data is not modified — full point data is preserved for future lasso-select/move operations

### Zoom Constraints

Current: `MIN_ZOOM = 0.1`, `MAX_ZOOM = 5.0`

New: Dynamic based on page width (or height for horizontal layout) and screen dimensions:
- **Min zoom**: Largest page dimension (in layout direction) fills 1/3 of screen → `minZoom = screenSize / (3 × largestPageSize)`
- **Max zoom**: Smallest page dimension fills 3× screen → `maxZoom = (3 × screenSize) / smallestPageSize`
- Recalculated on resize and page size change

### Pan Constraints

The camera is constrained so pages cannot be scrolled completely off-screen. At least **20 world units** of the document's bounding box must remain visible on each edge.

Implementation: After every pan/zoom operation, clamp `camera.x` and `camera.y` so that the visible viewport overlaps the document bounds (plus 20pt margin) on all sides.

### Stroke-to-Page Association

- When a stroke starts, determine which page the starting point falls within via `findPageAtPoint()`
- If the starting point is **outside all pages**, the stroke is **not created** — instead, the input is treated as a pan gesture (scrolls the canvas)
- Assign `pageIndex` to the stroke
- Strokes are visually clipped to their page rect during rendering but data is preserved unmodified

### Custom Page Sizes in Settings

Users can define custom page sizes using either **inches** or **centimeters**:
- Unit selector: "in" or "cm"
- Width and height input fields (in chosen unit)
- Converted to world units at 72 PPI: `worldUnits = inches × 72` or `worldUnits = cm × (72 / 2.54)`
- Stored in settings as world units (pre-converted)

## Implementation Steps

### Step 1: Define Page Types and Update Document Model

**Files:** `src/types.ts`

Add new types:
```typescript
export type PageSizePreset = "us-letter" | "us-legal" | "a4" | "a5" | "a3" | "custom";
export type PageOrientation = "portrait" | "landscape";
export type LayoutDirection = "vertical" | "horizontal";
export type PageUnit = "in" | "cm";

export interface PageSize {
  width: number;   // World units (portrait dimensions, width < height)
  height: number;  // World units
}

export interface Page {
  id: string;
  size: PageSize;
  orientation: PageOrientation;
  paperType: PaperType;
  lineSpacing: number;
  gridSize: number;
}

export const PAGE_SIZE_PRESETS: Record<Exclude<PageSizePreset, "custom">, PageSize> = {
  "us-letter": { width: 612, height: 792 },
  "us-legal": { width: 612, height: 1008 },
  "a4": { width: 595, height: 842 },
  "a5": { width: 420, height: 595 },
  "a3": { width: 842, height: 1191 },
};

export const PPI = 72;
export const CM_PER_INCH = 2.54;
```

Update `PaperDocument`:
```typescript
export interface PaperDocument {
  version: number;
  meta: DocumentMeta;
  pages: Page[];
  layoutDirection: LayoutDirection;
  viewport: Viewport;
  channels: string[];
  styles: Record<string, PenStyle>;
  strokes: Stroke[];
}
```

Remove `CanvasConfig` from `PaperDocument` (no longer needed — page-level config replaces it).

Update `Stroke`:
```typescript
export interface Stroke {
  id: string;
  pageIndex: number;          // Which page this stroke belongs to
  style: string;
  styleOverrides?: Partial<PenStyle>;
  bbox: [number, number, number, number];
  pointCount: number;
  pts: string;
  transform?: number[];
}
```

Update serialized types:
```typescript
export interface SerializedPage {
  id: string;
  w: number;
  h: number;
  o?: string;      // orientation, omit if "portrait"
  paper?: string;
  ls?: number;
  gs?: number;
}

export interface SerializedDocument {
  v: number;
  meta: { created: number; app: string };
  layout?: string;  // "vertical" | "horizontal", omit if "vertical"
  pages: SerializedPage[];
  viewport: { x: number; y: number; zoom: number };
  channels: string[];
  styles: Record<string, SerializedPenStyle>;
  strokes: SerializedStroke[];
}

// SerializedStroke adds: pg: number (pageIndex)
```

### Step 2: Create Page Layout Engine

**New file:** `src/document/PageLayout.ts`

This module computes page positions in world space:

```typescript
export const PAGE_GAP = 40; // World units between pages

export interface PageRect {
  pageIndex: number;
  x: number;      // World X (left edge)
  y: number;      // World Y (top edge)
  width: number;  // Effective width (after orientation swap)
  height: number; // Effective height (after orientation swap)
}

/**
 * Get effective dimensions for a page (applies orientation swap).
 */
export function getEffectiveSize(page: Page): { width: number; height: number };

/**
 * Compute world-space rectangles for all pages.
 * Vertical: stacked top-to-bottom, centered on X=0.
 * Horizontal: stacked left-to-right, centered on Y=0.
 */
export function computePageLayout(pages: Page[], direction: LayoutDirection): PageRect[];

/**
 * Find which page a world-space point falls within.
 * Returns -1 if the point is outside all pages.
 */
export function findPageAtPoint(x: number, y: number, layout: PageRect[]): number;

/**
 * Get the total bounding box encompassing all pages.
 */
export function getDocumentBounds(layout: PageRect[]): {
  minX: number; minY: number; maxX: number; maxY: number
};
```

Implementation details:
- `getEffectiveSize`: If orientation is "landscape", swap width/height
- **Vertical**: Pages centered on X=0 (`x = -effectiveWidth / 2`), Y accumulated with gaps
- **Horizontal**: Pages centered on Y=0 (`y = -effectiveHeight / 2`), X accumulated with gaps
- First page starts at origin (0,0 for the primary axis)

### Step 3: Update BackgroundRenderer for Page-Based Rendering

**File:** `src/canvas/BackgroundRenderer.ts`

Major changes:
1. **Fill entire screen with "desk" color** before rendering pages
2. **For each visible page**: draw page shadow, fill page rect, clip and draw patterns within it
3. **Stroke clipping support**: expose page rects so the Renderer can clip strokes per-page

Update `BackgroundConfig` to remove per-pattern fields (they're now per-page):
```typescript
export interface BackgroundConfig {
  isDarkMode: boolean;
}
```

New `render()` signature:
```typescript
render(config: BackgroundConfig, pageLayout: PageRect[], pages: Page[]): void
```

Algorithm:
```
1. Fill entire canvas with desk color
2. Apply camera transform
3. For each page in pageLayout:
   a. Check if page rect overlaps visible rect (skip if not)
   b. Draw drop shadow rect (offset, blur)
   c. Fill page rect with paper background color
   d. ctx.save() + ctx.beginPath() + ctx.rect(page) + ctx.clip()
   e. Render lines/grid/dots using page's own paperType/lineSpacing/gridSize
   f. ctx.restore()
4. Reset camera transform
```

### Step 4: Update Camera with Dynamic Zoom Limits and Pan Constraints

**File:** `src/canvas/Camera.ts`

Changes:
- Replace static `MIN_ZOOM`/`MAX_ZOOM` with instance properties and `setZoomLimits(min, max)`
- Add `setDocumentBounds(bounds)` to store the document bounding box
- Add `clampPan(screenWidth, screenHeight)` method that ensures at least 20 world units of the document bounds remain visible
- `pan()` and `zoomAt()` call `clampPan()` automatically

```typescript
private minZoom = 0.1;
private maxZoom = 5.0;
private docBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

setZoomLimits(min: number, max: number): void;
setDocumentBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void;

/**
 * Clamp camera position so at least 20 world units of document bounds
 * remain visible on screen.
 */
clampPan(screenWidth: number, screenHeight: number): void;
```

Pan clamping logic:
```
visible = getVisibleRect(screenWidth, screenHeight)
margin = 20  // world units that must remain visible

// Ensure document right edge is at least `margin` past screen left edge
// Ensure document left edge is at least `margin` before screen right edge
// Same for top/bottom
```

### Step 5: Update Renderer for Stroke Clipping

**File:** `src/canvas/Renderer.ts`

Changes to `renderStaticLayer()`:
- Receives `pageLayout: PageRect[]` parameter
- After rendering background, renders strokes **grouped by page**
- For each page: set a clip region to the page rect, then render all strokes with that `pageIndex`
- This visually clips strokes to their page without modifying stroke data

```typescript
renderStaticLayer(doc: PaperDocument, pageLayout: PageRect[], spatialIndex?: SpatialIndex): void {
  // ... background render ...

  // Group visible strokes by page
  for (const pageRect of pageLayout) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);
    ctx.clip();

    // Render strokes belonging to this page
    for (const stroke of doc.strokes) {
      if (stroke.pageIndex === pageRect.pageIndex && isVisible(stroke)) {
        this.renderStrokeToContext(ctx, stroke, doc.styles, lod);
      }
    }

    ctx.restore();
  }
}
```

Same clipping applied to `bakeStroke()`, `renderActiveStroke()`, and `renderPrediction()`.

### Step 6: Update Document Creation and Settings

**File:** `src/document/Document.ts`

Remove old `DEFAULT_CANVAS_WIDTH`/`DEFAULT_CANVAS_HEIGHT` constants. `createEmptyDocument()` now creates a document with one page:

```typescript
export function createEmptyDocument(
  appVersion: string = "0.1.0",
  pageSize?: PageSize,
  orientation?: PageOrientation,
  paperType?: PaperType,
  layoutDirection?: LayoutDirection,
): PaperDocument
```

**File:** `src/settings/PaperSettings.ts`

Add new settings:
```typescript
export interface PaperSettings {
  // ... existing fields ...

  // Page
  defaultPageSize: PageSizePreset;
  defaultOrientation: PageOrientation;
  defaultLayoutDirection: LayoutDirection;

  // Custom page size
  customPageUnit: PageUnit;       // "in" or "cm"
  customPageWidth: number;        // In chosen unit (e.g., 8.5 inches)
  customPageHeight: number;       // In chosen unit (e.g., 11 inches)
}
```

Defaults:
```typescript
defaultPageSize: "us-letter",
defaultOrientation: "portrait",
defaultLayoutDirection: "vertical",
customPageUnit: "in",
customPageWidth: 8.5,
customPageHeight: 11,
```

Helper to resolve effective page size from settings:
```typescript
export function resolvePageSize(settings: PaperSettings): PageSize {
  if (settings.defaultPageSize === "custom") {
    const factor = settings.customPageUnit === "in" ? PPI : PPI / CM_PER_INCH;
    return {
      width: Math.round(settings.customPageWidth * factor),
      height: Math.round(settings.customPageHeight * factor),
    };
  }
  return PAGE_SIZE_PRESETS[settings.defaultPageSize];
}
```

**File:** `src/settings/PaperSettingsTab.ts`

Add "Page" settings section:
- Dropdown: Default page size (US Letter, US Legal, A4, A5, A3, Custom)
- Dropdown: Default orientation (Portrait, Landscape)
- Dropdown: Default layout direction (Vertical, Horizontal)
- (Shown only when "Custom" selected):
  - Dropdown: Unit (Inches, Centimeters)
  - Number input: Width
  - Number input: Height

### Step 7: Update Serializer (Fresh v3 Format)

**File:** `src/document/Serializer.ts`

Set `CURRENT_VERSION = 3`. No backward compatibility with v1/v2 needed (old data deleted).

**Serialization:**
- Serialize `pages` array and `layoutDirection` (omit if "vertical")
- Serialize `pg` (pageIndex) on each stroke
- Remove old `canvas` field entirely

**Deserialization:**
- Only handle v3 format
- If version is missing or < 3, return a fresh empty document

### Step 8: Update PaperView

**File:** `src/view/PaperView.ts`

Key changes:
- Maintain `pageLayout: PageRect[]` (recomputed on page changes via `recomputeLayout()`)
- **Stroke start behavior**: On `onStrokeStart`, check `findPageAtPoint()`:
  - If on a page → create stroke with that `pageIndex`
  - If outside all pages → **do not create stroke**; instead treat as pan start (delegate to pan handling)
- Pass `pageLayout` to renderer for background + stroke clipping
- Call `updateZoomLimits()` and update document bounds on resize and page changes
- Call `camera.clampPan()` after pan/zoom operations
- Center initial viewport on first page on document load

```typescript
private pageLayout: PageRect[] = [];

private recomputeLayout(): void {
  this.pageLayout = computePageLayout(this.document.pages, this.document.layoutDirection);
  const bounds = getDocumentBounds(this.pageLayout);
  this.camera.setDocumentBounds(bounds);
  this.updateZoomLimits();
}
```

**onStrokeStart modification:**
```typescript
onStrokeStart: (point: StrokePoint) => {
  const world = this.camera.screenToWorld(point.x, point.y);
  const pageIndex = findPageAtPoint(world.x, world.y, this.pageLayout);

  if (pageIndex === -1) {
    // Outside all pages — treat as pan gesture
    this.inputManager?.switchToPan(point);
    return;
  }

  // Normal stroke creation with pageIndex
  ...
}
```

New method for adding pages:
```typescript
addPage(size?: PageSize, orientation?: PageOrientation, paperType?: PaperType): void {
  const page: Page = {
    id: generatePageId(),
    size: size ?? resolvePageSize(this.settings),
    orientation: orientation ?? this.settings.defaultOrientation,
    paperType: paperType ?? this.settings.defaultPaperType,
    lineSpacing: this.settings.lineSpacing,
    gridSize: this.settings.gridSize,
  };
  this.document.pages.push(page);
  this.recomputeLayout();
  this.requestStaticRender();
  this.requestSave();
}
```

### Step 9: Update StrokeBuilder

**File:** `src/stroke/StrokeBuilder.ts`

- Add `pageIndex` parameter to constructor
- Include `pageIndex` in finalized `Stroke` object

### Step 10: Update InputManager for Pan Fallback

**File:** `src/input/InputManager.ts`

Add ability to "switch" a pen stroke into a pan gesture mid-stream:
```typescript
/**
 * Convert the current pen stroke into a pan gesture.
 * Called when stroke starts outside all pages.
 */
switchToPan(startPoint: StrokePoint): void;
```

This cancels the stroke builder and begins pan tracking from the given point.

### Step 11: Update SVG Export and Embed Renderer

**File:** `src/export/SvgExporter.ts`

- Export with page-aware layout
- Each page as a clipped `<g>` group
- ViewBox encompasses all pages

**File:** `src/embed/EmbedRenderer.ts`

- Render pages in layout direction with appropriate viewBox

### Step 12: Add Page Navigation UI

**New file:** `src/view/PageControls.ts`

Minimal page controls:
- Page indicator: "Page 1 of 3"
- "Add page" button (+ icon)
- Tap page indicator to jump between pages (scroll viewport to center on that page)
- Layout direction toggle (vertical/horizontal icon)

### Step 13: Tests

Add tests for:
- `PageLayout.ts` — layout computation (vertical + horizontal), orientation swap, point-to-page lookup, document bounds
- `Serializer.ts` — v3 round-trip with pages, layout direction
- `Camera.ts` — dynamic zoom limits, pan clamping
- `BackgroundRenderer.ts` — page rendering with clipping (mock canvas)
- Page size resolution from settings (inches, cm, presets)

## File Change Summary

| File | Change Type |
|------|------------|
| `src/types.ts` | **Modify** — Add Page/Layout types, update Stroke/Document, remove CanvasConfig from document |
| `src/document/PageLayout.ts` | **New** — Page layout engine (vertical + horizontal) |
| `src/canvas/BackgroundRenderer.ts` | **Modify** — Page-aware rendering with desk color, shadows, clipping |
| `src/canvas/Camera.ts` | **Modify** — Dynamic zoom limits, pan clamping with document bounds |
| `src/canvas/Renderer.ts` | **Modify** — Stroke clipping per page rect |
| `src/document/Document.ts` | **Modify** — Create documents with pages, orientation, layout direction |
| `src/settings/PaperSettings.ts` | **Modify** — Page size, orientation, layout, custom sizes with units |
| `src/settings/PaperSettingsTab.ts` | **Modify** — Page settings UI with custom size inputs |
| `src/document/Serializer.ts` | **Modify** — v3 format with pages, no backward compat |
| `src/view/PaperView.ts` | **Modify** — Page layout, stroke-to-page assignment, pan fallback, zoom/pan limits |
| `src/stroke/StrokeBuilder.ts` | **Modify** — Add pageIndex |
| `src/input/InputManager.ts` | **Modify** — switchToPan for off-page pen input |
| `src/export/SvgExporter.ts` | **Modify** — Page-aware export |
| `src/embed/EmbedRenderer.ts` | **Modify** — Page-aware embed |
| `src/view/PageControls.ts` | **New** — Page navigation UI |
| Tests | **New/Modify** — PageLayout, Serializer, Camera, settings resolution |

## Resolved Decisions

1. **Stroke clipping**: Strokes are **visually clipped** to page boundaries during rendering (canvas clip regions), but the underlying stroke data is **not modified**. This preserves full data for future lasso-select/move operations.
2. **Off-page pen input**: Strokes **cannot begin** outside a page. Pen input outside pages becomes a pan gesture.
3. **Pan constraints**: Pages cannot be scrolled completely off-screen. At least 20 world units of the document bounds must remain visible.
4. **Layout direction**: Vertical (default) or horizontal, saved per-document with a settings default.
5. **Orientation**: Portrait (default) or landscape per-page, swapping dimensions at layout time.
6. **Custom sizes**: Defined in settings using inches or centimeters, converted to world units at 72 PPI.
7. **No migration**: v1/v2 format not supported; old data has been deleted.
