# ObsidianPaper Implementation Plan

**Date:** 2026-02-18
**Goal:** Build a handwriting plugin for Obsidian optimized for Apple Pencil, with vector-based stroke storage, zoomable canvas, multiple pen types, and full stroke editability.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Storage Format](#2-storage-format)
3. [Implementation Phases](#3-implementation-phases)
4. [Phase 1: Foundation](#4-phase-1-foundation)
5. [Phase 2: Core Drawing](#5-phase-2-core-drawing)
6. [Phase 3: Pen Types & Tools](#6-phase-3-pen-types--tools)
7. [Phase 4: Polish & Integration](#7-phase-4-polish--integration)
8. [Phase 5: Advanced Features](#8-phase-5-advanced-features)
9. [Key Technical Decisions](#9-key-technical-decisions)
10. [Dependencies](#10-dependencies)
11. [File Structure](#11-file-structure)
12. [Testing Strategy](#12-testing-strategy)
13. [Research References](#13-research-references)

---

## 1. Architecture Overview

### Rendering Stack (bottom to top)

```
[Background Layer]    Paper/grid lines (HTML canvas or CSS)
[Static Canvas]       All completed strokes (cached bitmap, re-rendered on zoom/pan/edit)
[Active Canvas]       Stroke currently being drawn (cleared/redrawn per frame)
[Prediction Canvas]   Predicted stroke extension (temporary, replaced each frame)
[UI Overlay]          Tool palette, selection handles, cursor (DOM/HTML)
```

### Data Flow

```
PointerEvent (240Hz via coalesced events)
  -> InputManager (pen/touch discrimination, palm rejection)
    -> 1-Euro Filter (jitter reduction, adaptive to velocity)
      -> StrokeBuilder (accumulates points, applies smoothing)
        -> PenEngine (computes width/opacity/shape per-point using pen config)
          -> OutlineGenerator (produces filled polygon from width data)
            -> Renderer (fills Path2D on active canvas)
              -> on pointerup: finalize to static canvas + persist to Document
```

### Core Data Model

```
Document
  |-- meta: { version, created, modified, appVersion }
  |-- canvas: { width, height, backgroundColor, paperType }
  |-- viewport: { x, y, zoom }
  |-- channels: ["x", "y", "p", "tx", "ty", "tw", "t"]
  |-- styles: { [name]: PenStyle }
  |-- strokes: Stroke[]
  |-- undoStack: UndoAction[] (in-memory only)
```

### Key Interfaces

```typescript
interface Stroke {
  id: string;
  style: string;                    // Reference to styles map
  styleOverrides?: Partial<PenStyle>; // Per-stroke overrides
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  pointCount: number;
  pts: string;                      // Delta-encoded integer string
  transform?: number[];             // Affine transform [a,b,c,d,tx,ty]
}

interface PenStyle {
  pen: PenType;
  color: string;          // Semantic color ID or hex
  colorDark?: string;     // Dark mode pair
  width: number;          // Base width in world units
  opacity: number;        // 0-1
  smoothing: number;      // 0-1 (streamline factor)
  pressureCurve: number;  // Gamma exponent
  tiltSensitivity: number;
}

type PenType = 'ballpoint' | 'brush' | 'felt-tip' | 'pencil' | 'fountain' | 'highlighter';

interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;        // Apple Pencil Pro barrel rotation
  timestamp: number;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}
```

---

## 2. Storage Format

### File Format: `.paper` (JSON text via TextFileView)

**Why JSON text:**
- Native `JSON.parse`/`stringify` performance (~400 MB/s parse)
- Obsidian Sync handles text files efficiently (diff-based)
- Human-readable, debuggable
- No binary dependencies
- Git-friendly

**Point encoding strategy:** Delta-encoded integers in semicolon-separated strings.

Each point's channels are stored as comma-separated delta values. Coordinates multiplied by 10 (0.1px precision), pressure/tilt mapped to 0-255 (uint8):

```json
{
  "v": 1,
  "meta": { "created": 1708272000000, "app": "0.1.0" },
  "canvas": { "w": 2048, "h": 2732, "bg": "#fffff8", "paper": "lined" },
  "viewport": { "x": 0, "y": 0, "zoom": 1.0 },
  "channels": ["x", "y", "p", "tx", "ty", "t"],
  "styles": {
    "_default": { "pen": "ballpoint", "color": "ink-black", "width": 2.0, "opacity": 1.0, "smoothing": 0.5, "pressureCurve": 1.0, "tiltSensitivity": 0 }
  },
  "strokes": [
    {
      "id": "s1a2b3",
      "st": "_default",
      "bb": [100, 200, 350, 280],
      "n": 150,
      "pts": "1000,2000,128,128,128,0;18,25,153,128,128,16;-5,30,160,127,129,17"
    }
  ]
}
```

**Size estimate:** ~4.7 MB for 1,000 strokes x 200 points. Acceptable for typical handwriting documents.

**Future (v2):** Add deflate compression via `fflate` for the `pts` field (Base64-encoded), reducing to ~1.1 MB.

### Style System

Named styles enable batch changes. A stroke references a style by name and optionally overrides specific properties:

```json
{
  "st": "my-blue-pen",
  "so": { "width": 3.0 }
}
```

Changing a style definition re-renders all strokes referencing it. This is the key mechanism for retroactive pen type/color/smoothing changes.

---

## 3. Implementation Phases

| Phase | Focus | Est. Scope |
|-------|-------|------------|
| **Phase 1** | Foundation — Plugin skeleton, custom view, canvas, file I/O | Moderate |
| **Phase 2** | Core Drawing — Input handling, stroke rendering, zoom/pan, undo | Large |
| **Phase 3** | Pen Types & Tools — Multiple pens, eraser, color palette | Large |
| **Phase 4** | Polish & Integration — Embeds, settings UI, dark mode colors, hover | Medium |
| **Phase 5** | Advanced — Fountain pen, pencil texture, spatial indexing, LOD | Large |

---

## 4. Phase 1: Foundation

### 1.1 Plugin Registration & Custom View

**Goal:** Register `.paper` file extension, create a TextFileView that displays a canvas.

**Tasks:**
- [ ] Create `PaperView` class extending `TextFileView`
- [ ] Register view type and `.paper` extension in `main.ts`
- [ ] Implement `getViewType()`, `getDisplayText()`, `getIcon()`
- [ ] Implement `getViewData()` → serialize Document to JSON string
- [ ] Implement `setViewData()` → parse JSON, render to canvas
- [ ] Mount `<canvas>` element into `contentEl`
- [ ] Handle `onResize()` to adjust canvas dimensions
- [ ] Add "New Paper" command to create `.paper` files

**Key code patterns (from research):**

```typescript
// main.ts
export const VIEW_TYPE_PAPER = "paper-view";
export const PAPER_EXTENSION = "paper";

export default class PaperPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_PAPER, (leaf) => new PaperView(leaf, this));
    this.registerExtensions([PAPER_EXTENSION], VIEW_TYPE_PAPER);
    this.addCommand({
      id: "create-paper",
      name: "New Paper note",
      callback: () => this.createNewPaper(),
    });
  }
}
```

```typescript
// PaperView.ts
class PaperView extends TextFileView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private document: PaperDocument;

  getViewType() { return VIEW_TYPE_PAPER; }
  getDisplayText() { return this.file?.basename ?? "Paper"; }

  async onOpen() {
    this.canvas = this.contentEl.createEl("canvas", { cls: "paper-canvas" });
    this.ctx = this.canvas.getContext("2d")!;
    this.setupHighDPI();
  }

  getViewData(): string {
    return JSON.stringify(serializeDocument(this.document));
  }

  setViewData(data: string, clear: boolean): void {
    this.document = deserializeDocument(data);
    this.renderAll();
  }

  clear(): void {
    this.document = createEmptyDocument();
  }
}
```

### 1.2 Canvas Setup with High-DPI Support

**Tasks:**
- [ ] Set canvas backing store to `width * devicePixelRatio`
- [ ] Apply `ctx.scale(dpr, dpr)` for coordinate normalization
- [ ] Handle `ResizeObserver` for Obsidian pane resizes
- [ ] Cap DPI at 2x on mobile for memory conservation
- [ ] Apply `touch-action: none` CSS to prevent browser gesture interference

### 1.3 Camera & Coordinate System

**Tasks:**
- [ ] Implement `Camera` class with `{ x, y, zoom }` state
- [ ] Implement `screenToWorld(sx, sy)` and `worldToScreen(wx, wy)` transforms
- [ ] Apply camera transform to canvas context before rendering: `ctx.translate()` + `ctx.scale()`
- [ ] Implement pinch-to-zoom using two-finger Pointer Events tracking
- [ ] Implement finger-based pan (translate camera on touch drag)
- [ ] Zoom centered on pinch midpoint
- [ ] Zoom limits: 0.1x to 5.0x
- [ ] Momentum/inertia for pan gestures (optional, can defer)

### 1.4 Document Serialization

**Tasks:**
- [ ] Define TypeScript interfaces for the document schema
- [ ] Implement `pts` encoder: raw `Float32Array[]` → delta-encoded integer strings
- [ ] Implement `pts` decoder: delta-encoded strings → raw arrays
- [ ] Implement `serializeDocument()` and `deserializeDocument()`
- [ ] Implement bounding box computation from decoded points
- [ ] Add format version checking

---

## 5. Phase 2: Core Drawing

### 2.1 Pointer Event Handling

**Goal:** Capture Apple Pencil input with full pressure/tilt/twist data at maximum resolution.

**Tasks:**
- [ ] Create `InputManager` class that handles all pointer events on the canvas
- [ ] Set `touch-action: none` and `-webkit-user-modify: read-only` on canvas
- [ ] Discriminate `pointerType === "pen"` (draw) vs `"touch"` (pan/zoom) vs `"mouse"` (draw)
- [ ] Call `setPointerCapture()` on `pointerdown` for reliable event delivery
- [ ] Call `event.preventDefault()` on `pointerdown` to suppress legacy events
- [ ] Extract coalesced events via `getCoalescedEvents()` (Safari 17+)
- [ ] Extract predicted events via `getPredictedEvents()` (Safari 18+)
- [ ] Feature-detect both APIs; fall back gracefully
- [ ] Capture all properties: `clientX`, `clientY`, `pressure`, `tiltX`, `tiltY`, `twist`, `altitudeAngle`, `azimuthAngle`, `timeStamp`
- [ ] Convert `altitudeAngle`/`azimuthAngle` to `tiltX`/`tiltY` when needed
- [ ] Handle `pointercancel` gracefully (discard in-progress stroke)
- [ ] Palm rejection: ignore `pointerType === "touch"` while pen stroke is active
- [ ] Prevent context menu on long press

### 2.2 Input Smoothing

**Tasks:**
- [ ] Implement 1-Euro filter for X and Y coordinates
  - Configurable `minCutoff` (default: 1.0) and `beta` (default: 0.007)
  - Adapts smoothing based on velocity: slow = more smoothing, fast = less lag
- [ ] Apply filter to each coalesced point in real-time
- [ ] Optionally smooth pressure/tilt with simple EMA (alpha = 0.3)

### 2.3 Real-Time Stroke Rendering (Double Buffer)

**Tasks:**
- [ ] Create `StrokeBuilder` class that accumulates points during active drawing
- [ ] Create `Renderer` class managing static + active + prediction canvases
- [ ] On `pointermove`: add smoothed points to `StrokeBuilder`, clear and re-render active canvas
- [ ] On `pointermove` with predictions: render predicted extension on prediction canvas
- [ ] On `pointerup`: finalize stroke → render onto static canvas → clear active + prediction
- [ ] Use `requestAnimationFrame` batching (don't render on every pointermove — batch per frame)
- [ ] Use `perfect-freehand` for stroke outline computation:
  - Input: `[[x, y, pressure], ...]`
  - Output: polygon outline points
  - Convert to `Path2D` and `ctx.fill()`

### 2.4 Variable-Width Stroke Rendering

**Tasks:**
- [ ] Integrate `perfect-freehand` library
- [ ] Map pen config to `perfect-freehand` options:
  - `size` ← pen width
  - `thinning` ← pressure sensitivity
  - `smoothing` ← outline smoothness
  - `streamline` ← input smoothing level
  - `start.taper` / `end.taper` ← stroke end tapering
  - `simulatePressure: false` (we have real pressure data)
- [ ] Convert outline polygon to `Path2D` → `ctx.fill()`
- [ ] Cache `Path2D` per completed stroke for efficient re-rendering

### 2.5 Undo/Redo

**Tasks:**
- [ ] Implement stroke-level undo stack (in-memory)
- [ ] Each completed stroke pushes to undo stack
- [ ] Undo = remove last stroke from document, add to redo stack, re-render static canvas
- [ ] Redo = restore stroke, re-render
- [ ] Also support undo for eraser operations (restore erased strokes / re-merge split strokes)
- [ ] Two-finger tap gesture for undo (standard iOS convention)
- [ ] Three-finger tap for redo (optional)
- [ ] Register Obsidian commands: "Undo stroke", "Redo stroke"
- [ ] Undo stack is not persisted (clears on file close)

### 2.6 Static Canvas Re-Rendering

**Tasks:**
- [ ] On zoom/pan: re-render visible strokes from document data
- [ ] Viewport culling: only render strokes whose `bbox` overlaps current viewport
- [ ] During zoom animation: scale cached bitmap (fast, blurry), then re-render at full quality after debounce (~100ms)
- [ ] Incremental bake on stroke addition: render new stroke onto existing bitmap (O(1))
- [ ] Dirty-region re-render on erasure/edit: clear affected area, re-render overlapping strokes

---

## 6. Phase 3: Pen Types & Tools

### 3.1 Pen Configuration System

**Tasks:**
- [ ] Define `PenConfig` interface with all pen parameters
- [ ] Create preset configurations for each pen type:
  - **Ballpoint:** `{ baseWidth: 2, pressureWidthRange: [0.85, 1.15], thinning: 0.15, smoothing: 0.3 }`
  - **Brush:** `{ baseWidth: 8, pressureWidthRange: [0.05, 1.0], thinning: 0.8, smoothing: 0.6, taperStart: 20, taperEnd: 30 }`
  - **Felt-tip:** `{ baseWidth: 6, pressureWidthRange: [0.7, 1.3], thinning: 0.3, smoothing: 0.5 }`
  - **Pencil:** `{ baseWidth: 3, pressureWidthRange: [0.5, 1.5], pressureOpacityRange: [0.15, 0.85], tiltSensitivity: 0.8, texture: 'grain' }`
  - **Fountain:** `{ baseWidth: 6, nibThickness: 1.5, nibAngle: Math.PI/6, directionWidthInfluence: 0.9 }`
  - **Highlighter:** `{ baseWidth: 24, opacity: 0.3, blendMode: 'multiply', flatCap: true }`
- [ ] All pen types use the same outline engine with different parameters — not separate classes

### 3.2 Pen Engine (Unified Width/Opacity Computation)

**Tasks:**
- [ ] Create `PenEngine` that takes `(StrokePoint, PenConfig)` → `{ width, opacity }`
- [ ] Pressure mapping: `effectivePressure = pow(rawPressure, config.pressureCurve)`
- [ ] Width computation: `width = baseWidth * lerp(minWidth, maxWidth, effectivePressure)`
- [ ] For fountain pen: angle-dependent width using `sqrt((W*sin(delta))^2 + (T*cos(delta))^2)`
- [ ] For pencil with tilt: `width *= 1 + tiltFactor * 3`, `opacity *= 1 - tiltFactor * 0.6`
- [ ] Apply velocity-based thinning (faster = thinner)

### 3.3 Custom Outline Generator (Extended)

**Goal:** Extend beyond `perfect-freehand` for non-circular nibs (fountain, chisel).

**Tasks:**
- [ ] For circular nibs (ballpoint, brush, felt-tip round): use `perfect-freehand` directly
- [ ] For elliptical nibs (fountain, highlighter, felt-tip chisel):
  - Implement custom outline generator that computes directionally-dependent offsets
  - At each point, compute stroke direction
  - Project rotated nib ellipse/rectangle onto the perpendicular
  - Produce left/right outline offsets
- [ ] Generate end caps (round for circular nibs, elliptical for non-circular)
- [ ] Cache computed outlines per stroke

### 3.4 Pencil Texture

**Tasks:**
- [ ] Generate tileable paper grain texture using simplex noise (256x256)
- [ ] Store texture as `ImageBitmap` for fast compositing
- [ ] Pencil rendering pipeline:
  1. Render stroke shape to offscreen canvas at full opacity
  2. Apply grain texture via `globalCompositeOperation = 'destination-in'`
  3. Composite onto main canvas at computed opacity
- [ ] Texture sampled in **world coordinates** (so grain doesn't shift on pan)
- [ ] Consider `simplex-noise` library (~3KB)

### 3.5 Highlighter Special Rendering

**Tasks:**
- [ ] Render each highlighter stroke to offscreen canvas at full opacity
- [ ] Composite entire stroke onto main canvas at `globalAlpha = 0.3`
- [ ] This prevents intra-stroke opacity stacking artifacts
- [ ] For inter-stroke overlap, use `globalCompositeOperation = 'multiply'`

### 3.6 Eraser Tool

**Tasks (Priority order):**
- [ ] **Stroke Eraser (v1):** Tap/drag to delete entire strokes on contact
  - Point-to-segment distance testing
  - Bounding box quick reject
  - Record erased strokes in undo stack
- [ ] **Stroke-Splitting Eraser (v2):** Drag to split strokes at eraser boundaries
  - Find intersection points between eraser circle and stroke segments
  - Merge overlapping erased ranges along stroke parameterization
  - Split stroke into sub-strokes at erased boundaries
  - Interpolate point data (pressure, tilt) at split points
  - Recompute bounding boxes for new sub-strokes
  - Record original stroke + split results in undo stack for reversal
- [ ] **Lasso Select + Delete (v3):**
  - Draw freeform selection boundary
  - Point-in-polygon test (ray casting) for enclosed strokes
  - Segment intersection test for strokes crossing the lasso
  - Delete or cut selected strokes

### 3.7 Color System

**Tasks:**
- [ ] Define semantic color palette with light/dark pairs:

| ID | Name | Light | Dark |
|----|------|-------|------|
| `ink-black` | Black | `#1a1a1a` | `#e8e8e8` |
| `ink-gray` | Gray | `#6b7280` | `#9ca3af` |
| `ink-red` | Red | `#dc2626` | `#f87171` |
| `ink-orange` | Orange | `#ea580c` | `#fb923c` |
| `ink-blue` | Blue | `#2563eb` | `#60a5fa` |
| `ink-green` | Green | `#16a34a` | `#4ade80` |
| `ink-purple` | Purple | `#7c3aed` | `#a78bfa` |
| `ink-pink` | Pink | `#db2777` | `#f472b6` |
| `ink-brown` | Brown | `#92400e` | `#d97706` |
| `ink-teal` | Teal | `#0d9488` | `#2dd4bf` |

- [ ] Detect Obsidian dark/light mode via `document.body.classList.contains('theme-dark')`
- [ ] Listen for theme changes via `MutationObserver` on body class
- [ ] Resolve stroke color at render time: `resolveColor(colorId, isDarkMode) → hex`
- [ ] Custom color picker using Obsidian's `ColorComponent`
- [ ] Recent colors list (last 5 custom colors, persisted in settings)
- [ ] Strokes store semantic color IDs, not hex values — enables automatic light/dark switching

### 3.8 Tool Palette UI

**Tasks:**
- [ ] Create floating tool palette (DOM overlay, not canvas)
- [ ] Tool buttons: Pen, Eraser, Color, Width slider
- [ ] Pen type selector (dropdown or expandable panel)
- [ ] Color swatches (default palette + custom)
- [ ] Width preview that shows current pen width
- [ ] Touch-friendly sizing (44px minimum touch targets)
- [ ] Compact mode for smaller screens
- [ ] Position: bottom of canvas or side rail

---

## 7. Phase 4: Polish & Integration

### 4.1 Markdown Embedding

**Tasks:**
- [ ] `registerMarkdownPostProcessor()` for reading mode embeds
  - Detect `![[*.paper]]` embed references
  - Load file, parse JSON, render static preview to `<canvas>`
  - Click-to-open: clicking embed opens full editor
- [ ] CM6 `ViewPlugin` + `WidgetType` for live preview embeds
  - Detect `![[*.paper]]` patterns in editor content
  - Replace with canvas-rendered widget
- [ ] Embed sizing: width = 100% container, height = proportional to canvas aspect ratio
- [ ] Support Obsidian's embed size syntax: `![[sketch.paper|400]]`

### 4.2 Settings Tab

**Tasks:**
- [ ] Create `PaperSettingsTab extends PluginSettingTab`
- [ ] **Pen section:** Default color, default width, pressure sensitivity slider, default pen type
- [ ] **Canvas section:** Background color, show grid toggle, grid size, ruled lines toggle, line spacing
- [ ] **Input section:** Palm rejection toggle, finger action dropdown (pan vs draw)
- [ ] **Smoothing section:** Default smoothing level slider (0-1)
- [ ] **File section:** Default folder for new papers, file name template
- [ ] Use `Setting` with `addColorPicker`, `addSlider`, `addToggle`, `addDropdown`
- [ ] Notify open views on settings change

### 4.3 Hover Cursor

**Tasks:**
- [ ] Detect Apple Pencil hover: `pointerType === "pen"` with `pressure === 0`
- [ ] Show cursor dot/crosshair at hover position
- [ ] Cursor reflects current pen size and color
- [ ] Hide on `pointerleave` or when drawing starts
- [ ] Graceful degradation on devices without hover support

### 4.4 Page Backgrounds

**Tasks:**
- [ ] Blank, lined, grid, dot grid backgrounds
- [ ] Render background on a separate (bottom) canvas layer
- [ ] Background follows camera transform (lines zoom with content)
- [ ] Background color respects light/dark mode
- [ ] Paper background color options: white, cream, yellow (light mode); dark gray, slate, sepia-dark (dark mode)

### 4.5 Barrel Rotation Support

**Tasks:**
- [ ] Read `event.twist` (0-359 degrees) on Apple Pencil Pro
- [ ] Feature detection: observe non-zero twist values during use (no way to detect ahead of time)
- [ ] For fountain pen: optionally use twist as nib angle (instead of fixed angle)
- [ ] For brush pen: twist could rotate brush texture
- [ ] Store twist in point data when available (the `"tw"` channel)

---

## 8. Phase 5: Advanced Features

### 5.1 Spatial Indexing

**Tasks:**
- [ ] Add `rbush` library (~5KB)
- [ ] Build R-tree from stroke bounding boxes on document load
- [ ] Update R-tree on stroke add/remove
- [ ] Replace linear viewport culling with R-tree query
- [ ] Use for eraser hit testing (query area around eraser position)

### 5.2 Level-of-Detail Rendering

**Tasks:**
- [ ] Pre-compute simplified versions of each stroke using Ramer-Douglas-Peucker:
  - `simplified_2`: epsilon = 2 (for zoom 0.25-0.5x)
  - `simplified_5`: epsilon = 5 (for zoom 0.1-0.25x)
- [ ] At zoom < 0.1: render strokes as simple start-to-end lines
- [ ] Select LOD level based on current zoom in render loop

### 5.3 `.paper.md` Hybrid Format

**Tasks:**
- [ ] Create alternative format following Excalidraw's pattern:
  ```markdown
  ---
  cssclasses: [obsidian-paper]
  paper-version: 1
  ---
  # Title
  Transcription/notes for searchability. [[links]] and #tags work.
  %%paper-data
  {"v":1, "strokes":[...]}
  %%
  ```
- [ ] Full Obsidian integration: search, graph view, backlinks, tags
- [ ] Both `.paper` and `.paper.md` formats coexist (user chooses)
- [ ] Settings option to select default format

### 5.4 SVG Export

**Tasks:**
- [ ] Command: "Export Paper as SVG"
- [ ] Convert each stroke's outline polygon to SVG `<path>` elements
- [ ] Respect stroke colors, opacity
- [ ] Include background if configured
- [ ] Save to vault as `.svg` file

### 5.5 Fountain Pen Ink Pooling

**Tasks:**
- [ ] Detect ink pool locations: stroke start/end points and sharp direction changes
  - Criteria: velocity < threshold AND curvature > threshold
- [ ] Render as slightly darker radial gradients at pool locations
- [ ] Pool size proportional to dwell time and pressure

### 5.6 Compressed Storage (v2 format)

**Tasks:**
- [ ] Add `fflate` library (~8KB) for deflate/inflate
- [ ] For large documents: deflate `pts` strings → Base64 encode
- [ ] Document version field `"v": 2` signals compressed encoding
- [ ] Maintain backward compatibility (v1 reader always works)

---

## 9. Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering engine | Canvas 2D | Compatible across Electron + WKWebView; sufficient for <2000 visible strokes; simpler than WebGL |
| Input API | Pointer Events | Unified model for mouse/touch/pen; pressure, tilt, twist support; coalesced + predicted events |
| Stroke outline | perfect-freehand (v1), custom engine (v2) | Proven library for pressure-sensitive outlines; extend for non-circular nibs later |
| Input smoothing | 1-Euro filter | Adaptive, minimal latency, well-proven for pen input |
| Storage format | JSON text in `.paper` files | Native parse speed, sync-friendly, debuggable, no deps |
| Point encoding | Delta-encoded integers | 3-4x smaller than naive JSON; preserves 0.1px coordinate precision |
| View base class | TextFileView | Built-in file I/O lifecycle, debounced save via `requestSave()` |
| Color storage | Semantic IDs with light/dark pairs | Enables automatic theme switching |
| Pen variation | Config objects, not classes | Same engine handles all pens through parameter variation |
| Undo model | Stroke-level, in-memory only | Simple; matches GoodNotes/Notability behavior |
| Spatial indexing | rbush R-tree (deferred to Phase 5) | Not needed until document complexity demands it |
| Palm rejection | OS-level + filter by pointerType | iPadOS handles most cases; filter remaining edge cases in code |
| Scribble prevention | `<canvas>` element + `-webkit-user-modify: read-only` | Canvas elements are recognized as drawing surfaces by iPadOS |

---

## 10. Dependencies

### Runtime (bundled)

| Library | Purpose | Size | Phase |
|---------|---------|------|-------|
| `perfect-freehand` | Variable-width stroke outlines | ~3KB | Phase 2 |
| `simplex-noise` | Pencil grain texture generation | ~3KB | Phase 3 |
| `rbush` | R-tree spatial index | ~5KB | Phase 5 |
| `fflate` | Deflate compression for v2 format | ~8KB | Phase 5 |

### Dev Dependencies (already in project)

- TypeScript, esbuild, Jest, ESLint (all configured)

### Not Using

| Library | Reason |
|---------|--------|
| Paper.js | Too heavy; study algorithms but don't depend on it |
| Fabric.js | Wrong tool for handwriting |
| Konva.js | Wrong tool for handwriting |
| React | Unnecessary; Obsidian's DOM API is sufficient |
| tldraw | Too heavy; we only need the stroke rendering concept |

---

## 11. File Structure

```
src/
  main.ts                         # Plugin entry point
  types.ts                        # Core type definitions

  view/
    PaperView.ts                  # TextFileView implementation
    ToolPalette.ts                # Tool selection UI (DOM)

  canvas/
    Camera.ts                     # Camera/viewport management
    Renderer.ts                   # Multi-layer canvas rendering
    HighDPI.ts                    # DPI handling utilities

  input/
    InputManager.ts               # Pointer event handling, pen/touch discrimination
    OneEuroFilter.ts              # 1-Euro jitter filter
    GestureRecognizer.ts          # Pinch-to-zoom, pan gestures

  stroke/
    StrokeBuilder.ts              # Accumulates points during drawing
    PenEngine.ts                  # Width/opacity computation per pen type
    OutlineGenerator.ts           # Polygon outline from width data
    PenConfigs.ts                 # Preset pen configurations

  document/
    Document.ts                   # Document data model
    Serializer.ts                 # JSON serialize/deserialize
    PointEncoder.ts               # Delta-encoded pts encode/decode
    UndoManager.ts                # Stroke-level undo/redo

  eraser/
    StrokeEraser.ts               # Whole-stroke eraser
    SplittingEraser.ts            # Stroke-splitting eraser

  color/
    ColorPalette.ts               # Default + custom color management
    ThemeDetector.ts              # Light/dark mode detection

  embed/
    EmbedPostProcessor.ts         # Reading mode embeds
    EmbedViewPlugin.ts            # Live preview embeds (CM6)

  settings/
    PaperSettings.ts              # Settings interface + defaults
    PaperSettingsTab.ts           # Settings UI

  __tests__/
    PointEncoder.test.ts
    PenEngine.test.ts
    OutlineGenerator.test.ts
    Camera.test.ts
    OneEuroFilter.test.ts
    StrokeEraser.test.ts
    Document.test.ts
```

---

## 12. Testing Strategy

### Unit Tests (Jest + jsdom)

- **PointEncoder:** Round-trip encode/decode with known data; verify precision preservation
- **PenEngine:** Width/opacity outputs at known pressure/tilt/velocity combinations per pen type
- **OutlineGenerator:** No self-intersections for simple curves; correct polygon winding
- **Camera:** screenToWorld/worldToScreen round-trip; zoom-at-point correctness
- **1-Euro Filter:** Smoothing behavior (verify reduced jitter without excessive lag)
- **Eraser:** Stroke-splitting produces correct sub-stroke count; point interpolation preserves data
- **Document Serialization:** Round-trip serialize/deserialize; backward compatibility

### Integration Tests

- **TextFileView lifecycle:** `setViewData()` → modify → `getViewData()` preserves data
- **Color resolution:** Correct hex output for semantic IDs in both light/dark modes

### Manual Testing

- iPad with Apple Pencil (primary target)
- Desktop with mouse (secondary)
- Verify pressure, tilt, and twist data capture
- Verify Scribble does not interfere
- Verify palm rejection during drawing
- Performance profiling on actual iPad hardware

---

## 13. Research References

All detailed research is in `Claude/Research/`:

| File | Topics |
|------|--------|
| `pointer-events-apple-pencil-deep-dive.md` | Complete PointerEvent API, pressure/tilt/twist, coalesced/predicted events, palm rejection, Scribble |
| `pressure-sensitive-tilt-aware-stroke-rendering.md` | Libraries (perfect-freehand, etc.), smoothing algorithms (1-Euro, Catmull-Rom), pen simulation, Canvas 2D performance |
| `optimal-storage-format-deep-dive.md` | Format comparison (SVG/InkML/ISF/UIM/PKDrawing), recommended JSON format, delta encoding, re-rendering pipelines, markdown integration |
| `obsidian-custom-view-plugin-architecture.md` | TextFileView, registerExtensions, embeds (post-processor + CM6), mobile/Capacitor, settings, file I/O |
| `pen-simulation-deep-dive-and-erasers.md` | Mathematical pen models (fountain/ballpoint/brush/pencil/highlighter), color pairs, eraser algorithms (stroke/splitting/lasso) |
| `pointer-events-api-apple-pencil-webkit.md` | PointerEvent properties matrix, Safari support table |
| `stroke-data-storage-formats.md` | Earlier storage format research |
| `zoomable-drawing-canvas-research.md` | Zoom/pan implementation, viewport culling, R-tree, LOD, double-buffer |
| `pen-brush-simulation-techniques.md` | Earlier pen simulation research |
| `color-system-for-drawing-handwriting-app.md` | Color palettes, light/dark pairing strategies |
| `custom-views-and-embeds-in-obsidian.md` | Earlier Obsidian view/embed research |

---

## Implementation Order Summary

```
Phase 1: Foundation
  1.1 Plugin + TextFileView + canvas mount
  1.2 High-DPI canvas setup
  1.3 Camera + zoom/pan
  1.4 Document serialization + point encoding

Phase 2: Core Drawing
  2.1 Pointer event handling + Apple Pencil input
  2.2 1-Euro input smoothing
  2.3 Double-buffer rendering (static + active canvas)
  2.4 Variable-width strokes via perfect-freehand
  2.5 Undo/redo (stroke level)
  2.6 Viewport culling + static canvas management

Phase 3: Pen Types & Tools
  3.1 Pen configuration system
  3.2 Unified pen engine (width/opacity computation)
  3.3 Custom outline generator for non-circular nibs
  3.4 Pencil texture (simplex noise + compositing)
  3.5 Highlighter special rendering
  3.6 Eraser (stroke → splitting → lasso)
  3.7 Color system (semantic IDs, light/dark pairs)
  3.8 Tool palette UI

Phase 4: Polish & Integration
  4.1 Markdown embeds (reading mode + live preview)
  4.2 Settings tab
  4.3 Hover cursor
  4.4 Page backgrounds
  4.5 Barrel rotation support

Phase 5: Advanced
  5.1 Spatial indexing (R-tree)
  5.2 Level-of-detail rendering
  5.3 .paper.md hybrid format
  5.4 SVG export
  5.5 Fountain pen ink pooling
  5.6 Compressed storage (v2)
```
