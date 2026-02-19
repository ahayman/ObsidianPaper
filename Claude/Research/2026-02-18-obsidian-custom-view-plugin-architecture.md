# Obsidian Custom View/Editor Plugin Architecture for Canvas-Based UI

**Date:** 2026-02-18
**Purpose:** Comprehensive technical research on building a custom view/editor Obsidian plugin that handles a custom file type (`.paper`) with a canvas-based UI, covering view registration, existing plugin patterns, markdown embedding, mobile considerations, file handling, and plugin settings.

---

## 1. Custom View Registration

### 1.1 The View Class Hierarchy

Obsidian provides a layered view hierarchy. The full chain for a file-backed canvas view is:

```
Component
  -> View
    -> ItemView
      -> FileView
        -> EditableFileView
          -> TextFileView
```

**Component** (base): Provides lifecycle (`load`/`unload`/`onload`/`onunload`), child component management (`addChild`/`removeChild`), automatic event cleanup (`registerEvent`), and DOM event auto-detachment (`registerDomEvent`).

**View** (abstract): Adds the view contract -- `containerEl` (root DOM element), `onOpen()`/`onClose()` lifecycle, `getViewType()` (unique type identifier), `getDisplayText()` (tab text), `onResize()` (container resize handler), `getState()`/`setState()` for serialization, and an optional `scope` for hotkey binding.

**ItemView**: Adds `contentEl` (the content area below the header chrome) and `addAction()` (adds icon buttons to the view header bar).

**FileView**: Adds file association -- `file: TFile | null`, `onLoadFile()`/`onUnloadFile()` lifecycle, `onRename()`, and `canAcceptExtension()`. The `navigation` property defaults to `true` (file views are navigable via back/forward).

**EditableFileView**: Marker class indicating the view supports editing (currently no additional methods).

**TextFileView**: The most practical base class for text-backed file views. Provides:
- `data: string` -- in-memory text content
- `requestSave: () => void` -- debounced save (2-second delay)
- `save(clear?: boolean)` -- immediate save
- `abstract getViewData(): string` -- called when saving; return the data string
- `abstract setViewData(data: string, clear: boolean)` -- called when loading a file
- `abstract clear()` -- called when switching files; reset undo history and caches

The `TextFileView` handles the complete read/write lifecycle automatically: `onLoadFile()` reads the file via `Vault.read()`, stores it in `this.data`, and calls `setViewData(data, true)`. On save, it calls `getViewData()` and writes back via `Vault.modify()`.

### 1.2 Using `registerView()` and `registerExtensions()`

From `Plugin`:

```typescript
// Signature
registerView(type: string, viewCreator: ViewCreator): void;
registerExtensions(extensions: string[], viewType: string): void;

// Where:
type ViewCreator = (leaf: WorkspaceLeaf) => View;
```

**`registerView()`** registers a factory function that creates a view instance. The `type` string must match what `getViewType()` returns.

**`registerExtensions()`** maps file extensions to a view type. Once registered:
- Files with that extension appear in the vault file explorer
- Clicking the file opens the associated view
- The file participates in Obsidian's file system events
- The file can be created/deleted/renamed via the Vault API

#### Complete Registration Pattern

```typescript
const VIEW_TYPE_PAPER = "paper-view";
const FILE_EXTENSION = "paper";

class PaperView extends TextFileView {
  private canvas: HTMLCanvasElement;
  private drawingState: DrawingState;

  getViewType(): string {
    return VIEW_TYPE_PAPER;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Paper";
  }

  getIcon(): string {
    return "pencil";
  }

  async onOpen(): Promise<void> {
    // Build the UI
    this.contentEl.empty();
    this.contentEl.addClass("paper-view-content");

    const container = this.contentEl.createDiv({ cls: "paper-canvas-container" });
    this.canvas = container.createEl("canvas", { cls: "paper-canvas" });

    // Set up pointer events using registerDomEvent for automatic cleanup
    this.registerDomEvent(this.canvas, "pointerdown", this.onPointerDown.bind(this));
    this.registerDomEvent(this.canvas, "pointermove", this.onPointerMove.bind(this));
    this.registerDomEvent(this.canvas, "pointerup", this.onPointerUp.bind(this));
    this.registerDomEvent(this.canvas, "pointercancel", this.onPointerCancel.bind(this));

    // Header toolbar actions
    this.addAction("pencil", "Pen tool", () => this.setTool("pen"));
    this.addAction("eraser", "Eraser tool", () => this.setTool("eraser"));
    this.addAction("undo-2", "Undo", () => this.undo());
    this.addAction("redo-2", "Redo", () => this.redo());
  }

  async onClose(): Promise<void> {
    // DOM event listeners are automatically cleaned up by registerDomEvent
    // Clean up any additional resources (animation frames, workers, etc.)
  }

  onResize(): void {
    // Called when workspace leaf is resized -- critical for canvas
    const rect = this.contentEl.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.redraw();
  }

  // TextFileView abstract implementations:

  getViewData(): string {
    return JSON.stringify(this.drawingState);
  }

  setViewData(data: string, clear: boolean): void {
    if (clear) {
      this.clear();
    }
    try {
      this.drawingState = JSON.parse(data);
    } catch {
      this.drawingState = createEmptyState();
    }
    this.redraw();
  }

  clear(): void {
    this.drawingState = createEmptyState();
    // Clear undo/redo history, reset viewport, etc.
  }

  // Call this.requestSave() after each stroke completes
  private onStrokeEnd(): void {
    this.requestSave();  // Debounced, saves in ~2 seconds
  }
}

// Plugin registration:
export default class PaperPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_PAPER, (leaf: WorkspaceLeaf) => {
      return new PaperView(leaf);
    });

    this.registerExtensions([FILE_EXTENSION], VIEW_TYPE_PAPER);

    this.addCommand({
      id: "create-new-paper",
      name: "Create new Paper note",
      callback: async () => {
        const file = await this.app.vault.create(
          `Untitled.${FILE_EXTENSION}`,
          JSON.stringify({ version: 1, strokes: [], viewport: { x: 0, y: 0, zoom: 1 } })
        );
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
      },
    });
  }
}
```

### 1.3 View Lifecycle Details

When a `.paper` file is opened:

1. User clicks `note.paper` in file explorer
2. Obsidian looks up the view type for the `.paper` extension
3. Obsidian calls the `ViewCreator` factory: `(leaf) => new PaperView(leaf)`
4. Component lifecycle: `load()` calls `onload()`
5. `View.onOpen()` fires -- build the UI here (create canvas, attach listeners)
6. `FileView.onLoadFile(file)` fires
7. For `TextFileView`: reads the file, stores in `this.data`, calls `setViewData(data, true)`

When a view is closed:

1. `TextFileView` auto-saves pending changes via `getViewData()`
2. `FileView.onUnloadFile(file)` fires
3. `View.onClose()` fires -- tear down UI here
4. `Component.onunload()` fires -- final cleanup

When a file is renamed: `FileView.onRename(file)` fires.

When the container is resized: `View.onResize()` fires. This is critical for canvas views that must recalculate dimensions.

### 1.4 Rendering a Full-Screen Canvas

The `contentEl` provided by `ItemView` is the correct mount point for a full-screen canvas:

```typescript
async onOpen(): Promise<void> {
  // Make the content area fill the entire view
  this.contentEl.addClass("paper-view-content");

  // Create the canvas
  this.canvas = this.contentEl.createEl("canvas", { cls: "paper-canvas" });

  // Initial sizing
  this.resizeCanvas();
}

private resizeCanvas(): void {
  const rect = this.contentEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // Set canvas resolution to match device pixels
  this.canvas.width = rect.width * dpr;
  this.canvas.height = rect.height * dpr;

  // Set display size via CSS
  this.canvas.style.width = `${rect.width}px`;
  this.canvas.style.height = `${rect.height}px`;

  // Scale context for high-DPI
  const ctx = this.canvas.getContext("2d");
  if (ctx) {
    ctx.scale(dpr, dpr);
  }
}
```

CSS to make the canvas fill the view:

```css
.paper-view-content {
  padding: 0;
  overflow: hidden;
  position: relative;
}

.paper-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  touch-action: none;  /* Critical: prevents browser gesture interference */
}
```

The `touch-action: none` CSS property is essential. Without it, the browser/WKWebView will attempt to interpret pointer events as scroll gestures, pan, or zoom, causing interference with drawing.

### 1.5 Workspace Leaf Management

```typescript
// Open in current leaf (reuses existing)
const leaf = this.app.workspace.getLeaf(false);
await leaf.openFile(file);

// Open in a new tab
const leaf = this.app.workspace.getLeaf(true);  // or 'tab'
await leaf.openFile(file);

// Open in a split pane
const leaf = this.app.workspace.getLeaf('split', 'vertical');
await leaf.openFile(file);

// Find all leaves of our view type
const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER);

// Get the active view if it matches our type
const view = this.app.workspace.getActiveViewOfType(PaperView);

// Set view state explicitly (alternative to openFile)
await leaf.setViewState({
  type: VIEW_TYPE_PAPER,
  state: { file: filePath },
  active: true,
});
```

Deferred loading (since Obsidian 1.7.2): Obsidian may defer loading views in background tabs. The view receives a `DeferredView` placeholder instead. Check with `leaf.isDeferred` and force-load with `await leaf.loadIfDeferred()`.

---

## 2. Existing Plugin Examples

### 2.1 Obsidian Ink Plugin (obsidian-ink)

The Ink plugin by Dale de Silva is the closest reference implementation for ObsidianPaper. Key architectural decisions from the public repository:

**View Registration:**
- Ink uses a custom view type registered via `registerView()` and `registerExtensions()`
- It registers the `.ink` file extension
- The view extends `TextFileView`, meaning `.ink` files are text (JSON) under the hood

**File Format:**
- `.ink` files contain JSON data representing handwriting strokes
- The JSON includes stroke paths, colors, widths, and metadata
- Text-based format means it works with Obsidian Sync and version control

**Rendering Architecture:**
- Ink uses **tldraw** as its underlying drawing/handwriting engine
- tldraw provides an SVG-based rendering pipeline (not HTML Canvas)
- The tldraw React component is mounted into the view's `contentEl`
- tldraw handles all the pen input, stroke rendering, and gesture recognition

**Handwriting Recognition:**
- Ink focuses on handwriting/note-taking rather than general drawing
- It leverages tldraw's "draw" tool mode specifically for handwriting
- The plugin adds custom UI overlays for pen settings

**Embedding in Markdown:**
- Ink supports embedding via the `![[file.ink]]` wikilink syntax
- Uses a markdown post-processor to detect `.ink` embeds in reading mode
- Renders a static preview (likely SVG snapshot) of the ink content

**Key Takeaways for ObsidianPaper:**
1. `TextFileView` with JSON is the proven approach
2. Using an existing drawing library (tldraw) accelerated development significantly
3. SVG rendering (via tldraw) provides resolution independence but may have different performance characteristics than HTML Canvas for very high stroke counts
4. The `.ink` extension registration pattern is directly applicable

### 2.2 Excalidraw Plugin (obsidian-excalidraw-plugin)

The Excalidraw plugin by Zsolt Viczian is the most mature and feature-rich custom view plugin in the Obsidian ecosystem. It provides extensive reference patterns:

**View Registration:**
- Registers a custom view type `excalidraw`
- Uses `registerExtensions()` to handle `.excalidraw` files
- Extends `TextFileView` for file lifecycle management

**Dual File Format Strategy:**

Excalidraw supports two file formats:

1. **`.excalidraw` files** -- Pure JSON containing the Excalidraw scene data. Simple, clean, but limited Obsidian integration.

2. **`.excalidraw.md` files** -- Markdown files with the Excalidraw JSON stored in a fenced code block. The file structure looks like:

```markdown
---
excalidraw-plugin: parsed
tags: [excalidraw]
---

# Drawing Title

Some text that Obsidian can index and search.

%%
# Excalidraw Data
## Text Elements
element1 ^id1
element2 ^id2

## Drawing
```json
{ "type": "excalidraw", "elements": [...], "appState": {...} }
```
%%
```

This dual format approach provides several advantages:
- `.excalidraw.md` files are recognized as markdown by Obsidian, enabling frontmatter, tags, backlinks, and search indexing
- Text elements within the drawing are extracted and placed as markdown text, making them searchable
- The `%%` comment markers hide the raw JSON from the reading view
- Block references (`^id`) can link to specific text elements
- The pure `.excalidraw` format remains available for simpler use cases

**Rendering:**
- Excalidraw renders to an HTML Canvas element (via the excalidraw library)
- The React-based Excalidraw component is mounted into the view's content area
- Pre-renders SVG thumbnails for fast embed display

**Embed Handling:**
- **Reading mode**: Markdown post-processor detects `![[drawing.excalidraw]]` embeds and replaces them with rendered SVG/PNG previews
- **Live preview**: CodeMirror 6 editor extension with `ViewPlugin` and `WidgetType` to replace embed syntax with inline previews
- **Thumbnail caching**: Generates and caches SVG thumbnails to avoid re-rendering the full scene for each embed

**Plugin Settings:**
- Extensive settings tab with sections for:
  - Default drawing settings (theme, grid, pen mode)
  - File format preferences (`.excalidraw` vs `.excalidraw.md`)
  - Embed display options (width, preview quality)
  - Export settings (SVG/PNG)
  - Keyboard shortcuts

**Key Takeaways for ObsidianPaper:**
1. The `.excalidraw.md` format is clever but complex; defer this for later phases
2. SVG thumbnail generation for embeds is a valuable optimization
3. Both reading mode and live preview embed support are needed for full integration
4. The React component mounting pattern works but adds bundle size

### 2.3 Obsidian Canvas (Built-In)

Obsidian's built-in Canvas feature provides insight into how Obsidian itself handles non-markdown file types:

**File Format:**
- `.canvas` files are JSON text files (defined in `canvas.d.ts` shipped with the API)
- The schema is publicly documented:
  ```typescript
  interface CanvasData {
    nodes: AllCanvasNodeData[];  // Text, file, link, or group nodes
    edges: CanvasEdgeData[];    // Connections between nodes
  }
  ```
- Each node has `id`, `x`, `y`, `width`, `height`, optional `color`
- Text nodes store markdown content inline
- File nodes reference other vault files by path

**Rendering:**
- Uses HTML/CSS for rendering (not HTML Canvas despite the name)
- Nodes are positioned absolutely within a scrollable/pannable container
- Edges are rendered as SVG paths
- Supports zoom via CSS transforms
- Infinite canvas with pan/zoom

**Architecture:**
- Canvas registers its own view type internally
- The `.canvas` extension is registered during Obsidian's core initialization
- Canvas views extend the internal `TextFileView` equivalent
- Auto-save is debounced (similar to `TextFileView.requestSave()`)

**Key Takeaways for ObsidianPaper:**
1. JSON text files are the standard pattern even for Obsidian's own non-markdown features
2. HTML/CSS rendering works for node-based layouts; HTML Canvas is better for freeform drawing
3. The auto-save debounce pattern (`requestSave()`) is consistent across all views
4. Obsidian Sync handles `.canvas` files as text, confirming text-based custom formats sync properly

---

## 3. Embedding in Markdown

### 3.1 Overview of Embedding Approaches

There are three complementary approaches to embed custom content in markdown:

| Approach | Works In | Complexity | Use Case |
|----------|----------|------------|----------|
| Markdown Post-Processor | Reading mode | Low | Static preview of `.paper` files |
| CodeMirror 6 ViewPlugin | Live preview (edit mode) | Medium-High | Inline preview while editing |
| Code Block Processor | Both | Low | Inline data within the markdown file |

### 3.2 Approach 1: Markdown Post-Processor (Reading Mode)

`registerMarkdownPostProcessor()` runs when markdown is rendered in reading mode. It can detect embed syntax like `![[file.paper]]` and replace it with a rendered preview.

```typescript
this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
  const embeds = el.querySelectorAll(".internal-embed");
  for (const embed of Array.from(embeds)) {
    const src = embed.getAttribute("src");
    if (src && src.endsWith(".paper")) {
      const file = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (file && file instanceof TFile) {
        const renderChild = new PaperEmbedRenderChild(embed as HTMLElement, file, this);
        ctx.addChild(renderChild);
      }
    }
  }
});
```

The `MarkdownRenderChild` pattern ensures lifecycle management:

```typescript
class PaperEmbedRenderChild extends MarkdownRenderChild {
  constructor(containerEl: HTMLElement, private file: TFile, private plugin: PaperPlugin) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    const data = await this.plugin.app.vault.cachedRead(this.file);
    const state = JSON.parse(data);

    // Replace the embed placeholder with a rendered preview
    this.containerEl.empty();
    this.containerEl.addClass("paper-embed");

    const canvas = this.containerEl.createEl("canvas", { cls: "paper-embed-canvas" });
    this.renderStaticPreview(canvas, state);
  }

  onunload(): void {
    // Cleanup when the embed is removed from the DOM
  }
}
```

**Important**: `MarkdownPostProcessorContext.addChild()` ensures the render child's lifecycle is tied to the DOM. When the embed element is removed (e.g., user edits the source), `onunload()` is automatically called.

### 3.3 Approach 2: CodeMirror 6 Decorations (Live Preview)

For embeds to render in live preview mode (the default editing mode), you need a CodeMirror 6 editor extension registered via `registerEditorExtension()`.

```typescript
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

class PaperEmbedWidget extends WidgetType {
  constructor(private filePath: string, private plugin: PaperPlugin) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.classList.add("paper-embed-widget");

    // Async render: load and display
    this.loadAndRender(container);
    return container;
  }

  private async loadAndRender(container: HTMLElement): Promise<void> {
    const file = this.plugin.app.vault.getFileByPath(this.filePath);
    if (!file) return;

    const data = await this.plugin.app.vault.cachedRead(file);
    const state = JSON.parse(data);

    const canvas = container.createEl("canvas");
    // Render static preview onto canvas
  }

  eq(other: PaperEmbedWidget): boolean {
    return this.filePath === other.filePath;
  }
}

// ViewPlugin to detect embed patterns and apply decorations
class PaperEmbedViewPlugin {
  decorations: DecorationSet;

  constructor(private view: EditorView, private plugin: PaperPlugin) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    const text = doc.toString();
    const pattern = /!\[\[([^\]]+\.paper)\]\]/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      builder.add(from, to, Decoration.replace({
        widget: new PaperEmbedWidget(match[1], this.plugin),
      }));
    }

    return builder.finish();
  }
}

// Factory function that captures the plugin reference
function createPaperEmbedExtension(plugin: PaperPlugin) {
  return ViewPlugin.fromClass(
    class extends PaperEmbedViewPlugin {
      constructor(view: EditorView) {
        super(view, plugin);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// In plugin.onload():
this.registerEditorExtension(createPaperEmbedExtension(this));
```

**Challenge: Accessing `App` from CM6 extensions.** CM6 extensions don't naturally have access to the Obsidian `App`. Solutions:
1. **Closure over plugin reference** (shown above) -- pass the plugin to the extension factory
2. **Module-level variable** -- store a reference globally (less clean)
3. **StateField** -- store a reference in CM6 state (more idiomatic but complex)

### 3.4 Approach 3: Code Block Processor

For inline handwriting regions within a markdown document (not external file embeds):

````markdown
```paper
{"strokes": [...], "viewport": {...}}
```
````

Registration:

```typescript
this.registerMarkdownCodeBlockProcessor("paper", (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
  try {
    const state = JSON.parse(source);
    const canvas = el.createEl("canvas", { cls: "paper-inline-canvas" });
    this.renderPreview(canvas, state);
  } catch {
    el.createEl("p", { text: "Invalid paper data" });
  }
});
```

**Pros:**
- Works in both reading mode and live preview
- Data lives inline in the markdown
- Simple API

**Cons:**
- Stroke data is directly in the markdown file, making files large
- Editing the code block directly is impractical for users
- Not suitable for complex drawings with thousands of strokes
- Does not support the `![[embed]]` wikilink syntax

### 3.5 Can You Have an Inline Handwriting Region in Markdown?

**Yes, but with significant caveats.** The approaches are:

1. **Code block processor** (above): Stores stroke data inline. Limited by the JSON size becoming unwieldy. Works for small annotations or signatures.

2. **CM6 Widget Decoration**: A CodeMirror 6 widget that renders an interactive canvas within the editor. This is the most technically sophisticated approach:
   - Use a `Decoration.widget()` at a specific document position
   - The widget renders an interactive canvas that captures pointer events
   - Stroke data is serialized back into a code block or custom syntax in the markdown source
   - Challenge: preventing the editor from stealing focus/events when the user draws

3. **Hybrid approach**: Store a reference to an external `.paper` file within the markdown, and render an interactive (not just preview) canvas via a widget decoration. The external file holds the actual stroke data.

**Recommendation**: For v1, support only the `![[file.paper]]` embed syntax with static previews. Interactive inline handwriting within markdown is technically possible but dramatically increases complexity. Consider it for a later phase.

### 3.6 How Excalidraw and Ink Handle Embedding

**Excalidraw:**
- Reading mode: Post-processor replaces `![[drawing.excalidraw]]` with a rendered SVG/PNG
- Live preview: CM6 extension replaces the embed pattern with a widget showing the drawing
- Clicking the embed opens the full Excalidraw editor
- Pre-renders and caches SVG thumbnails for fast embed display
- Also supports code block embedding for the `.excalidraw.md` format

**Ink:**
- Reading mode: Post-processor detects `.ink` embeds and shows a static SVG preview
- The preview is read-only; clicking opens the full editor in a new leaf
- Simpler approach than Excalidraw -- fewer rendering layers

---

## 4. Mobile Considerations

### 4.1 Obsidian Mobile Architecture

Obsidian mobile uses **Capacitor** (formerly Cordova-based) to run the web app inside a native container:

- **iOS**: Uses **WKWebView** (WebKit engine, effectively Safari)
- **Android**: Uses the system **WebView** (Chromium-based)

The same JavaScript code runs on both platforms. Obsidian exposes `Platform` for runtime detection:

```typescript
import { Platform } from "obsidian";

// Runtime detection
Platform.isMobile       // true on phone/tablet
Platform.isMobileApp    // true when running in Capacitor
Platform.isIosApp       // true on iOS
Platform.isAndroidApp   // true on Android
Platform.isPhone        // small screen mobile
Platform.isTablet       // large screen mobile (iPad)
Platform.isSafari       // true on iOS (WKWebView is Safari-based)
Platform.isDesktop      // desktop Electron app
Platform.isDesktopApp   // specifically Electron (not web)
```

### 4.2 Touch and Pointer Event Handling

**Pointer Events API** is the recommended approach. It provides a unified model across mouse, touch, and pen (Apple Pencil). All modern browsers (including WKWebView) support Pointer Events Level 2.

Key differences between platforms:

| Aspect | Desktop (Electron) | iOS (WKWebView) | Android (WebView) |
|--------|-------------------|-----------------|-------------------|
| Pointer Events | Full support | Full support | Full support |
| `pointerType` for stylus | `"pen"` | `"pen"` (Apple Pencil) | `"pen"` (varies) |
| Pressure sensitivity | Depends on hardware | Apple Pencil: yes (0.0-1.0) | Varies by device |
| Tilt support | Depends on hardware | Apple Pencil: yes (tiltX, tiltY) | Varies |
| Coalesced events | `getCoalescedEvents()` supported | Supported in modern iOS | Supported |
| Predicted events | `getPredictedEvents()` supported | Supported | Supported |
| Touch vs Pen discrimination | Automatic via `pointerType` | Automatic | Automatic |

**Critical CSS for mobile:**

```css
.paper-canvas {
  touch-action: none;       /* Prevents browser gestures on the canvas */
  -webkit-user-select: none; /* Prevents text selection */
  -webkit-touch-callout: none; /* Prevents iOS callout menu */
  user-select: none;
}
```

Without `touch-action: none`, the browser/WKWebView will interpret pointer events as scroll, pan, or zoom gestures, causing severe interference with drawing.

**Distinguishing pen from finger:**

```typescript
onPointerDown(event: PointerEvent): void {
  if (event.pointerType === "pen") {
    // Apple Pencil or stylus input -- always draw
    this.startStroke(event);
  } else if (event.pointerType === "touch") {
    // Finger input -- use for pan/zoom or as configured
    this.startPanGesture(event);
  } else if (event.pointerType === "mouse") {
    // Mouse input (desktop) -- draw
    this.startStroke(event);
  }
}
```

### 4.3 Performance Considerations on Mobile

1. **Canvas resolution**: Mobile devices have high DPI screens (3x on iPhone, 2x on iPad). A full-screen canvas at 3x DPI creates a very large pixel buffer. Consider:
   - Using `window.devicePixelRatio` but capping at 2x on mobile to save memory
   - Using `OffscreenCanvas` where supported for background rendering

2. **Stroke rendering**: Each `pointermove` event should NOT trigger a full canvas redraw. Instead:
   - Render only the new stroke segment (incremental rendering)
   - Redraw the full canvas only when needed (zoom, scroll, undo)
   - Use `requestAnimationFrame()` to batch rendering

3. **Memory**: Mobile Safari has aggressive memory limits. Large canvases (>4096x4096 pixels) may be killed. Monitor `document.addEventListener('pagehide', ...)` and Obsidian's `'active-leaf-change'` event to save state when backgrounded.

4. **Coalesced events**: On mobile, pointer events may be coalesced (multiple points per event). Use `event.getCoalescedEvents()` to get all intermediate points for smooth strokes:

```typescript
onPointerMove(event: PointerEvent): void {
  const events = event.getCoalescedEvents();
  if (events.length > 0) {
    for (const e of events) {
      this.addStrokePoint(e.clientX, e.clientY, e.pressure, e.tiltX, e.tiltY);
    }
  } else {
    this.addStrokePoint(event.clientX, event.clientY, event.pressure, event.tiltX, event.tiltY);
  }
  this.renderCurrentStroke();
}
```

5. **Predicted events**: Use `event.getPredictedEvents()` to reduce perceived latency by rendering predicted stroke positions ahead of actual input.

6. **60fps target**: Keep the render path under 16ms. Profile on actual iPad hardware, not just the simulator.

### 4.4 Virtual Keyboard and Toolbar Handling

On mobile, the virtual keyboard can interfere with a full-screen canvas view:

1. **Preventing keyboard appearance**: A canvas-based handwriting view should NOT trigger the virtual keyboard. Ensure the canvas element is not an `input`, `textarea`, or `contenteditable` element. A plain `<canvas>` element will not trigger the keyboard.

2. **If you need text input** (e.g., for labeling or searching within the canvas): Create a hidden `<input>` element that you programmatically focus when needed. This triggers the keyboard. Position your canvas above the keyboard by listening for viewport resize:

```typescript
// Detect keyboard appearance via viewport resize
if (Platform.isMobileApp) {
  this.registerDomEvent(window, "resize", () => {
    // The visible viewport shrinks when the keyboard appears
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    this.adjustCanvasForKeyboard(viewportHeight);
  });
}
```

3. **Obsidian mobile toolbar**: Obsidian's mobile toolbar (the bottom bar with formatting buttons) is managed by Obsidian itself. For a `TextFileView`-based custom view, this toolbar does not appear because it is tied to the `MarkdownView`. Your custom view gets the full screen area.

4. **Navigation gestures**: On iOS, be aware of the edge swipe gesture for back navigation. The `touch-action: none` CSS prevents scroll/zoom gestures on the canvas, but the system-level edge swipe (from the left edge) still fires. Consider adding padding or a non-drawing zone at the left edge, or handle `pointercancel` events gracefully when iOS interrupts a stroke with a navigation gesture.

5. **iPad Split View / Slide Over**: The `onResize()` method is called when the view changes size due to iPad multitasking. Ensure your canvas handles arbitrary aspect ratio changes.

### 4.5 iOS-Specific Considerations

- **Apple Pencil hover** (iPad Pro M2+ with Apple Pencil Pro/2nd gen): Pointer events fire with `pointerType: "pen"` and no `pointerdown`. Use `pointermove` events where `event.pressure === 0` and `event.pointerType === "pen"` to detect hover.

- **Apple Pencil double-tap** (2nd gen and Pro): This is a system gesture that switches tools in supported apps. In a web context, you cannot directly listen for the double-tap gesture. However, you can implement a double-tap on the canvas as a tool switcher.

- **Apple Pencil squeeze** (Pencil Pro): Also a system gesture, not accessible via web APIs.

- **120Hz ProMotion displays**: iPads with ProMotion deliver pointer events at up to 120Hz. Ensure your event handler does not block; offload heavy work to `requestAnimationFrame`.

- **Safari/WKWebView 16.4+ (iOS 16.4+)**: Supports `getCoalescedEvents()` and `getPredictedEvents()` on PointerEvent. Earlier versions may not have coalesced events.

---

## 5. File Handling

### 5.1 `loadData()` / `saveData()` vs File I/O

These are two completely separate systems:

**`Plugin.loadData()` / `Plugin.saveData()`** -- For **plugin settings only**:
- Data is stored in `<vault>/.obsidian/plugins/<plugin-id>/data.json`
- Returns a Promise (async)
- `loadData()` returns `null` if no data file exists yet
- `saveData(data: any)` serializes the object as JSON
- This is NOT for file content; it is for configuration and preferences

**`Vault` API** -- For **file content** (reading/writing `.paper` files):
- `Vault.create(path, data)` -- create a new text file
- `Vault.createBinary(path, data: ArrayBuffer)` -- create a new binary file
- `Vault.read(file)` -- read text content (for modification)
- `Vault.cachedRead(file)` -- read text content (cached, for display)
- `Vault.readBinary(file)` -- read binary content
- `Vault.modify(file, data)` -- write text content
- `Vault.modifyBinary(file, data: ArrayBuffer)` -- write binary content
- `Vault.process(file, fn)` -- atomic read-modify-write
- `Vault.delete(file)` -- delete a file
- `Vault.rename(file, newPath)` -- rename/move a file

**For ObsidianPaper, `TextFileView` handles file I/O automatically.** You implement `getViewData()` and `setViewData()`, and the base class calls `Vault.read()` and `Vault.modify()` at the right times.

### 5.2 Reading/Writing Custom File Formats

For a JSON-based `.paper` format with `TextFileView`:

```typescript
// Reading is handled automatically:
// TextFileView.onLoadFile() -> Vault.read(file) -> setViewData(data, true)

// Writing is handled automatically:
// TextFileView.save() -> getViewData() -> Vault.modify(file, data)

// Trigger save after changes:
this.requestSave();  // Debounced (2 seconds)
await this.save();   // Immediate
```

For a binary `.paper` format (if you later need binary):

```typescript
class PaperView extends FileView {
  async onLoadFile(file: TFile): Promise<void> {
    const buffer = await this.app.vault.readBinary(file);
    this.loadFromBinary(buffer);
  }

  async saveFile(): Promise<void> {
    if (!this.file) return;
    const buffer = this.serializeToBinary();
    await this.app.vault.modifyBinary(this.file, buffer);
  }
}
```

### 5.3 Auto-Save Strategies

`TextFileView.requestSave()` provides a built-in debounced save with a 2-second delay. This is the recommended primary auto-save mechanism.

For additional auto-save triggers:

```typescript
// Save when the view loses focus
this.registerEvent(
  this.app.workspace.on("active-leaf-change", (leaf) => {
    if (leaf !== this.leaf && this.isDirty) {
      this.save();
    }
  })
);

// Save when the app is about to quit (desktop)
this.register(() => {
  if (this.isDirty) {
    // Synchronous save attempt -- may not complete
    // Better to rely on requestSave() keeping things up to date
  }
});

// For mobile: save when backgrounded
if (Platform.isMobileApp) {
  this.registerDomEvent(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden" && this.isDirty) {
      this.save();
    }
  });
}
```

**Best practice**: Call `this.requestSave()` after every stroke completes. The 2-second debounce prevents excessive writes during rapid drawing. For very long drawing sessions, consider an additional periodic save (e.g., every 30 seconds) as a safety net.

### 5.4 How Obsidian Sync Handles Different File Types

Obsidian Sync synchronizes files based on their content:

**Text files** (including `.paper` JSON files):
- Synced as text with diff-based change detection
- Conflict resolution: Obsidian Sync can merge text changes or present conflict resolution UI
- Changes are detected by content comparison, not just timestamp
- Small changes (e.g., adding a stroke) result in small sync deltas

**Binary files:**
- Synced as whole files (no diffing)
- Any change replaces the entire file on other devices
- Larger sync overhead for frequent changes
- Conflict resolution: last-write-wins (no merge)

**Implication for ObsidianPaper:** Using JSON text (via `TextFileView`) for `.paper` files is strongly preferred because:
1. Obsidian Sync handles text files more efficiently (diff-based)
2. Text conflicts can potentially be resolved (though JSON merge is non-trivial)
3. The file is human-readable for debugging
4. Works with external sync (Dropbox, iCloud Drive, Git) as plain text

**Vault sync events** (available for detecting external changes):
```typescript
this.registerEvent(
  this.app.vault.on("modify", (file) => {
    if (file === this.file) {
      // File was modified externally (sync, another device, etc.)
      // Re-read and update the view
      this.reloadFile();
    }
  })
);
```

### 5.5 File Format Recommendation

A `.paper` file should be structured as minified JSON for a balance of human readability and file size:

```json
{
  "version": 1,
  "created": 1708272000000,
  "modified": 1708272100000,
  "strokes": [
    {
      "id": "s1",
      "tool": "pen",
      "color": "#000000",
      "width": 2,
      "opacity": 1,
      "points": [
        [100, 200, 0.5, 0, 0],
        [102, 201, 0.6, 1, -2]
      ]
    }
  ],
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1.0,
    "width": 1024,
    "height": 768
  },
  "settings": {
    "backgroundColor": "#ffffff",
    "gridEnabled": false,
    "ruledLines": false
  }
}
```

Points are stored as arrays `[x, y, pressure, tiltX, tiltY]` rather than objects to minimize file size. For a page of handwritten notes with ~10,000 points across ~200 strokes, this would be approximately 200-400 KB of JSON.

---

## 6. Plugin Settings

### 6.1 Settings Tab Architecture

Obsidian provides `PluginSettingTab` as the base class for plugin settings UI. The settings appear in Settings > Community Plugins > [Your Plugin].

```typescript
interface PaperSettings {
  // Pen preferences
  defaultPenColor: string;
  defaultPenWidth: number;
  defaultPenOpacity: number;
  pressureSensitivity: number;  // 0.0 to 1.0 multiplier

  // Eraser preferences
  eraserWidth: number;

  // Canvas preferences
  backgroundColor: string;
  showGrid: boolean;
  gridSize: number;
  showRuledLines: boolean;
  ruledLineSpacing: number;

  // Behavior
  autoSaveInterval: number;     // ms, 0 = use default debounce
  palmRejection: boolean;       // Only accept pen input, ignore touch for drawing
  fingerAction: "pan" | "draw"; // What finger touch does

  // File management
  defaultFolder: string;        // Where to create new .paper files
  fileNameTemplate: string;     // Template for new file names

  // Embed preferences
  embedHeight: number;          // Height in pixels for embedded previews
}

const DEFAULT_SETTINGS: PaperSettings = {
  defaultPenColor: "#000000",
  defaultPenWidth: 2,
  defaultPenOpacity: 1,
  pressureSensitivity: 1.0,
  eraserWidth: 20,
  backgroundColor: "#ffffff",
  showGrid: false,
  gridSize: 20,
  showRuledLines: false,
  ruledLineSpacing: 30,
  autoSaveInterval: 0,
  palmRejection: true,
  fingerAction: "pan",
  defaultFolder: "",
  fileNameTemplate: "Paper {date}",
  embedHeight: 300,
};
```

### 6.2 Implementing the Settings Tab

```typescript
class PaperSettingsTab extends PluginSettingTab {
  plugin: PaperPlugin;

  constructor(app: App, plugin: PaperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Pen Settings Section
    new Setting(containerEl).setName("Pen").setHeading();

    new Setting(containerEl)
      .setName("Default pen color")
      .setDesc("The default color for new strokes")
      .addColorPicker((color) => {
        color
          .setValue(this.plugin.settings.defaultPenColor)
          .onChange(async (value) => {
            this.plugin.settings.defaultPenColor = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default pen width")
      .setDesc("Stroke width in pixels (1-20)")
      .addSlider((slider) => {
        slider
          .setLimits(1, 20, 1)
          .setValue(this.plugin.settings.defaultPenWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultPenWidth = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Pressure sensitivity")
      .setDesc("How much pen pressure affects stroke width (0 = none, 1 = full)")
      .addSlider((slider) => {
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.plugin.settings.pressureSensitivity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pressureSensitivity = value;
            await this.plugin.saveSettings();
          });
      });

    // Canvas Settings Section
    new Setting(containerEl).setName("Canvas").setHeading();

    new Setting(containerEl)
      .setName("Background color")
      .addColorPicker((color) => {
        color
          .setValue(this.plugin.settings.backgroundColor)
          .onChange(async (value) => {
            this.plugin.settings.backgroundColor = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Show grid")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showGrid)
          .onChange(async (value) => {
            this.plugin.settings.showGrid = value;
            await this.plugin.saveSettings();
          });
      });

    // Input Settings Section
    new Setting(containerEl).setName("Input").setHeading();

    new Setting(containerEl)
      .setName("Palm rejection")
      .setDesc("Only accept Apple Pencil/stylus for drawing. Finger input is used for pan/zoom.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.palmRejection)
          .onChange(async (value) => {
            this.plugin.settings.palmRejection = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Finger action")
      .setDesc("What happens when you draw with your finger")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("pan", "Pan & zoom")
          .addOption("draw", "Draw")
          .setValue(this.plugin.settings.fingerAction)
          .onChange(async (value: "pan" | "draw") => {
            this.plugin.settings.fingerAction = value;
            await this.plugin.saveSettings();
          });
      });
  }
}
```

### 6.3 Loading and Saving Settings

The standard pattern used across all Obsidian plugins:

```typescript
export default class PaperPlugin extends Plugin {
  settings: PaperSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new PaperSettingsTab(this.app, this));
    // ... rest of initialization
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

**`Object.assign({}, DEFAULT_SETTINGS, data)`** merges saved data over defaults, ensuring new settings (added in plugin updates) get their default values while preserving user-configured values.

### 6.4 Settings Best Practices

1. **Default values**: Always define `DEFAULT_SETTINGS` with sensible defaults. Never assume `loadData()` returns complete data.

2. **Migration**: When the settings schema changes between plugin versions, handle migration:
   ```typescript
   async loadSettings(): Promise<void> {
     const data = await this.loadData();
     this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
     if (this.settings.version !== CURRENT_SETTINGS_VERSION) {
       this.migrateSettings();
       await this.saveSettings();
     }
   }
   ```

3. **Reactive updates**: When settings change, notify open views:
   ```typescript
   async saveSettings(): Promise<void> {
     await this.saveData(this.settings);
     // Notify all open PaperViews of the change
     this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER).forEach((leaf) => {
       const view = leaf.view as PaperView;
       view.onSettingsChanged(this.settings);
     });
   }
   ```

4. **Avoid saving too frequently**: `saveData()` writes to disk. If settings can change rapidly (e.g., a live slider), debounce the save.

5. **Type safety**: Define the settings interface with strict types. Use the TypeScript strict mode settings already configured in this project (`noImplicitAny`, `strictNullChecks`).

6. **Available Setting components** (from the Obsidian API):
   - `addText()` -- text input (`TextComponent`)
   - `addTextArea()` -- multi-line text input (`TextAreaComponent`)
   - `addToggle()` -- boolean switch (`ToggleComponent`)
   - `addDropdown()` -- select dropdown (`DropdownComponent`)
   - `addSlider()` -- numeric slider (`SliderComponent`) with `setLimits(min, max, step)`
   - `addColorPicker()` -- color picker (`ColorComponent`) returning hex string
   - `addButton()` -- button (`ButtonComponent`)
   - `addSearch()` -- search input (`SearchComponent`)
   - `addProgressBar()` -- progress bar (`ProgressBarComponent`)
   - `addExtraButton()` -- small icon button (`ExtraButtonComponent`)

---

## 7. Architecture Summary for ObsidianPaper

Based on all research findings, the recommended architecture:

| Aspect | Recommendation | Rationale |
|--------|---------------|-----------|
| **View base class** | `TextFileView` | Automatic JSON read/write, debounced save, file lifecycle |
| **File extension** | `.paper` | Custom extension registered via `registerExtensions()` |
| **File format** | JSON text | Sync-friendly, diffable, debuggable |
| **Rendering** | HTML `<canvas>` with 2D context | Best for freeform drawing performance |
| **Input handling** | Pointer Events API | Unified mouse/touch/pen; pressure and tilt support |
| **Embed (Phase 1)** | `registerMarkdownPostProcessor()` | Reading mode static previews |
| **Embed (Phase 2)** | CM6 `ViewPlugin` + `WidgetType` | Live preview inline previews |
| **Settings storage** | `loadData()` / `saveData()` | Standard plugin settings pattern |
| **File I/O** | Automatic via `TextFileView` | `getViewData()` / `setViewData()` |
| **Auto-save** | `requestSave()` after each stroke | Built-in 2-second debounce |
| **Mobile input** | `pointerType` discrimination | Palm rejection via pen vs touch detection |
| **Mobile canvas** | Cap DPI at 2x, use coalesced events | Memory and performance optimization |

---

## 8. Sources

- **Obsidian API type definitions** (`/Users/aaronhayman/Projects/ObsidianPaper/node_modules/obsidian/obsidian.d.ts`, version 1.12.0) -- authoritative source for all API signatures, class hierarchies, and JSDoc documentation
- **Obsidian Canvas type definitions** (`/Users/aaronhayman/Projects/ObsidianPaper/node_modules/obsidian/canvas.d.ts`) -- schema for Obsidian's built-in Canvas file format
- **ObsidianWordsmith reference project** (`/Users/aaronhayman/Projects/ObsidianWordsmith/`) -- patterns for settings tabs, plugin structure, and service architecture
- **ObsidianNewNoteTemplate reference project** (`/Users/aaronhayman/Projects/ObsidianNewNoteTemplate/`) -- patterns for `registerEditorExtension()`, CodeMirror 6 extensions, and React-based UI
- **Existing project research** (`/Users/aaronhayman/Projects/ObsidianPaper/Claude/Research/2026-02-18-pointer-events-api-apple-pencil-webkit.md`) -- detailed pointer events and Apple Pencil capabilities
- **Excalidraw Obsidian Plugin** (github.com/zsviczian/obsidian-excalidraw-plugin) -- public repository analysis for dual file format strategy, embed handling, and view registration patterns
- **Obsidian Ink Plugin** (github.com/daledesilva/obsidian_ink) -- public repository analysis for TextFileView-based handwriting view, tldraw integration, and `.ink` file format
- **Obsidian Developer Documentation** (docs.obsidian.md) -- referenced in JSDoc links within the type definitions for Views, Markdown post-processing, and Settings
