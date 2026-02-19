# Custom Views and Embeds in Obsidian Plugins

**Date:** 2026-02-18
**Purpose:** Research how Obsidian plugins implement custom file views, register custom file extensions, and render custom embeds within markdown documents.

---

## 1. The View Class Hierarchy

Obsidian provides a well-defined hierarchy of view classes. Understanding this hierarchy is critical for choosing the right base class for a custom view.

### 1.1 Component (Base)

All views ultimately derive from `Component`, which provides lifecycle management:

```typescript
class Component {
  load(): void;
  onload(): void;        // Override to initialize
  unload(): void;
  onunload(): void;      // Override to cleanup
  addChild<T extends Component>(component: T): T;
  removeChild<T extends Component>(component: T): T;
  register(cb: () => any): void;           // Cleanup callback on unload
  registerEvent(eventRef: EventRef): void;  // Auto-detach event on unload
  registerDomEvent(el, type, callback, options?): void;  // Auto-detach DOM event
}
```

Key point: `register()` and `registerEvent()` ensure automatic cleanup when the component unloads, preventing memory leaks.

### 1.2 View (extends Component)

The abstract base for all views. Provides the fundamental view contract:

```typescript
abstract class View extends Component {
  app: App;
  icon: IconName;
  navigation: boolean;    // true = navigable (file views); false = static (sidebar panels)
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;  // The root DOM element for this view
  scope: Scope | null;       // Optional hotkey scope when view is focused

  protected onOpen(): Promise<void>;   // Called when view is opened
  protected onClose(): Promise<void>;  // Called when view is closed

  abstract getViewType(): string;       // Must return the unique view type identifier
  abstract getDisplayText(): string;    // Tab/header text

  getState(): Record<string, unknown>;
  setState(state: unknown, result: ViewStateResult): Promise<void>;
  getEphemeralState(): Record<string, unknown>;
  setEphemeralState(state: unknown): void;
  getIcon(): IconName;
  onResize(): void;                     // Called when view container is resized
  onPaneMenu(menu: Menu, source: string): void;  // Context menu for pane
}
```

**Key observations:**
- `containerEl` is the root HTML element. This is where a canvas would be mounted.
- `onOpen()` is the place to build the UI (create canvas, attach event listeners).
- `onClose()` is the place to tear down the UI.
- `onResize()` is called when the workspace item is resized -- critical for a drawing canvas that needs to recalculate dimensions.
- `navigation: boolean` -- for a file-based view that opens `.paper` files, this should be `true`.

### 1.3 ItemView (extends View)

Adds a `contentEl` property:

```typescript
abstract class ItemView extends View {
  contentEl: HTMLElement;
  addAction(icon: IconName, title: string, callback: (evt: MouseEvent) => any): HTMLElement;
}
```

**Key observations:**
- `contentEl` is a child of `containerEl` where the view's main content goes. The difference: `containerEl` includes the header/chrome; `contentEl` is just the content area.
- `addAction()` adds icon buttons to the view header (useful for toolbar buttons like pen mode, eraser, etc.).
- Use `ItemView` for sidebar panels or non-file views (e.g., a stroke settings panel).

### 1.4 FileView (extends ItemView)

Adds file association:

```typescript
abstract class FileView extends ItemView {
  allowNoFile: boolean;
  file: TFile | null;
  navigation: boolean;  // Defaults to true (file views are navigable)

  getDisplayText(): string;
  onload(): void;
  getState(): Record<string, unknown>;
  setState(state: any, result: ViewStateResult): Promise<void>;

  onLoadFile(file: TFile): Promise<void>;    // Called when a file is loaded into this view
  onUnloadFile(file: TFile): Promise<void>;  // Called when a file is unloaded
  onRename(file: TFile): Promise<void>;      // Called when the file is renamed

  canAcceptExtension(extension: string): boolean;  // Determines if this view can open a file extension
}
```

**Key observations:**
- `onLoadFile()` and `onUnloadFile()` are the file lifecycle methods. When Obsidian opens a file in this view, it calls `onLoadFile()`.
- `canAcceptExtension()` is how Obsidian knows which view to use for which file types. It returns `true` for extensions this view can handle.
- `file` gives you access to the currently loaded `TFile`.
- Use `FileView` if you want to handle file loading/saving yourself (binary or complex formats).

### 1.5 EditableFileView (extends FileView)

Currently an empty class (marker interface):

```typescript
abstract class EditableFileView extends FileView {
  // No additional methods
}
```

This is a marker that the view supports editing, not just viewing. The `MarkdownView` extends this.

### 1.6 TextFileView (extends EditableFileView)

The most useful base class for text-based custom file views:

```typescript
abstract class TextFileView extends EditableFileView {
  data: string;                  // In-memory text data
  requestSave: () => void;       // Debounced save (2-second delay)

  onUnloadFile(file: TFile): Promise<void>;  // Auto-saves before unloading
  onLoadFile(file: TFile): Promise<void>;    // Reads file and calls setViewData()
  save(clear?: boolean): Promise<void>;      // Saves using getViewData()

  abstract getViewData(): string;                    // Return current data for saving
  abstract setViewData(data: string, clear: boolean): void;  // Load data into the view
  abstract clear(): void;                            // Clear the view state (undo history, caches)
}
```

**Key observations:**
- `TextFileView` handles the read/write lifecycle automatically. When Obsidian opens a file, it reads the text content and calls `setViewData()`. When saving, it calls `getViewData()` and writes back.
- `requestSave()` triggers a debounced save -- call this whenever the user modifies data (e.g., after a stroke ends).
- `data` holds the in-memory string representation.
- This is ideal for a `.paper` file that stores JSON data as text (like Excalidraw stores its scene as JSON).

**This is the recommended base class for ObsidianPaper** because:
1. `.paper` files would be text (JSON) under the hood
2. Automatic save/load lifecycle via `getViewData()`/`setViewData()`
3. Debounced auto-save via `requestSave()`
4. File rename handling is built in

### 1.7 MarkdownView (extends TextFileView)

For reference, the built-in markdown view:

```typescript
class MarkdownView extends TextFileView implements MarkdownFileInfo {
  editor: Editor;
  previewMode: MarkdownPreviewView;
  currentMode: MarkdownSubView;
  getMode(): MarkdownViewModeType;  // 'source' | 'preview'
  showSearch(replace?: boolean): void;
}
```

---

## 2. Registering a Custom View and File Extension

### 2.1 Plugin.registerView()

```typescript
registerView(type: string, viewCreator: ViewCreator): void;
```

Where `ViewCreator` is:
```typescript
type ViewCreator = (leaf: WorkspaceLeaf) => View;
```

This registers a factory function that creates a view instance. The `type` string is the unique view type identifier (returned by `getViewType()`).

**Example pattern:**

```typescript
const VIEW_TYPE_PAPER = "paper-view";

class PaperView extends TextFileView {
  getViewType(): string {
    return VIEW_TYPE_PAPER;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Paper";
  }

  getViewData(): string {
    // Return the JSON string to save
    return JSON.stringify(this.canvasState);
  }

  setViewData(data: string, clear: boolean): void {
    if (clear) {
      this.clear();
    }
    // Parse the JSON and render
    this.canvasState = JSON.parse(data);
    this.renderCanvas();
  }

  clear(): void {
    // Reset canvas state, undo history, etc.
    this.canvasState = createEmptyState();
  }
}
```

### 2.2 Plugin.registerExtensions()

```typescript
registerExtensions(extensions: string[], viewType: string): void;
```

This maps one or more file extensions to a view type. When the user opens a file with one of these extensions, Obsidian will create an instance of the registered view.

**Example:**

```typescript
// In plugin.onload():
this.registerView(VIEW_TYPE_PAPER, (leaf) => new PaperView(leaf));
this.registerExtensions(["paper"], VIEW_TYPE_PAPER);
```

After this registration:
- Clicking `note.paper` in the file explorer opens it with `PaperView`
- Obsidian knows `.paper` files belong to the `paper-view` view type
- The file appears in the vault file listing

### 2.3 Complete Registration Pattern

```typescript
export default class PaperPlugin extends Plugin {
  async onload(): Promise<void> {
    // 1. Register the view factory
    this.registerView(VIEW_TYPE_PAPER, (leaf: WorkspaceLeaf) => {
      return new PaperView(leaf, this);
    });

    // 2. Register the file extension(s)
    this.registerExtensions(["paper"], VIEW_TYPE_PAPER);

    // 3. Add a command to create new .paper files
    this.addCommand({
      id: "create-new-paper",
      name: "Create new Paper note",
      callback: async () => {
        const file = await this.app.vault.create(
          "Untitled.paper",
          JSON.stringify({ strokes: [] })
        );
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
      },
    });
  }
}
```

---

## 3. Custom File Extensions

### 3.1 Can Obsidian Plugins Register Custom Extensions?

**Yes.** The `Plugin.registerExtensions()` method is explicitly designed for this purpose. When an extension is registered:

- Files with that extension appear in the vault file explorer
- Clicking the file opens the associated view
- The file participates in Obsidian's link resolution (with caveats)
- The file can be created, deleted, renamed via the Vault API

### 3.2 Text-Based Custom Extensions

A `.paper` file can absolutely be text-based (JSON, YAML, custom format). The `TextFileView` base class is designed for this:

- `Vault.create(path, data)` creates a plaintext file with any extension
- `Vault.read(file)` reads it as text
- `Vault.modify(file, data)` writes text back
- `TextFileView` automates this read/write cycle

### 3.3 Binary Custom Extensions

For truly binary formats, use `FileView` directly and handle I/O with:

- `Vault.createBinary(path, data: ArrayBuffer)`
- `Vault.readBinary(file): Promise<ArrayBuffer>`
- `Vault.modifyBinary(file, data: ArrayBuffer)`

### 3.4 How Excalidraw Handles `.excalidraw` Files

Based on analysis of the Excalidraw plugin architecture (from the public repository structure and community documentation):

1. **Registration:** Excalidraw registers the `.excalidraw` extension mapped to its custom view type via `registerExtensions(["excalidraw"], EXCALIDRAW_VIEW_TYPE)`.

2. **File format:** `.excalidraw` files are **JSON text files** containing the Excalidraw scene data. This allows them to be version-controlled, diffed, and processed as text.

3. **Markdown integration:** Excalidraw also supports `.excalidraw.md` files, which are **markdown files** with the Excalidraw JSON stored in a code block (typically a fenced code block with language `excalidraw`). This approach:
   - Allows frontmatter (YAML) for metadata
   - Makes the file appear as a markdown file in the vault
   - Embeds naturally in other markdown documents
   - Allows text links within the excalidraw file to be recognized by Obsidian's link resolution

4. **View:** Excalidraw extends `TextFileView`, reading the file content as a string, parsing the JSON/markdown, and rendering the drawing on an HTML canvas.

5. **Dual format strategy:** Supporting both `.excalidraw` (pure JSON) and `.excalidraw.md` (markdown-wrapped) gives users flexibility. The `.excalidraw.md` approach is generally preferred because it integrates better with Obsidian's metadata and link systems.

### 3.5 Recommended Strategy for ObsidianPaper

**Option A: Pure `.paper` extension (JSON)**
- Simple implementation
- Clean separation between handwriting data and markdown
- Drawback: Obsidian's link resolver may not fully index content

**Option B: `.paper.md` extension (Markdown-wrapped)**
- Store stroke data in a fenced code block within markdown
- Allows frontmatter for metadata (creation date, title, tags)
- Better integration with Obsidian's search, backlinks, and graph
- More complex parsing

**Option C: Both (like Excalidraw)**
- Offer both formats, let users choose
- Maximum compatibility but doubles the implementation surface

**Recommendation for v1:** Start with Option A (pure `.paper` JSON extension) for simplicity, with Option B as a future enhancement.

---

## 4. View Lifecycle Management

### 4.1 Opening a View

The lifecycle when a `.paper` file is opened:

1. User clicks `note.paper` in file explorer
2. Obsidian looks up the registered view type for `.paper` extension
3. Obsidian calls the `ViewCreator` factory: `(leaf) => new PaperView(leaf)`
4. Obsidian calls the Component lifecycle: `load()` -> `onload()`
5. Obsidian calls `View.onOpen()` -- build UI here
6. Obsidian calls `FileView.onLoadFile(file)`
7. For `TextFileView`: `onLoadFile()` reads the file, stores in `this.data`, calls `setViewData(data, true)`

### 4.2 Closing a View

1. `TextFileView` saves any pending changes via `getViewData()`
2. `FileView.onUnloadFile(file)` is called
3. `View.onClose()` is called -- tear down UI here
4. `Component.onunload()` is called -- cleanup resources

### 4.3 Resizing

```typescript
onResize(): void {
  // Called when the workspace leaf is resized
  // Critical for canvas-based views: recalculate dimensions
  const rect = this.contentEl.getBoundingClientRect();
  this.canvas.width = rect.width;
  this.canvas.height = rect.height;
  this.redraw();
}
```

### 4.4 File Rename

```typescript
onRename(file: TFile): Promise<void> {
  // Called when the file is renamed
  // Update display text, any internal references
}
```

### 4.5 Saving

For `TextFileView`, saving is straightforward:

```typescript
// After any modification (e.g., stroke completed):
this.requestSave();  // Debounced, saves in ~2 seconds

// Or immediate save:
await this.save();

// The save process:
// 1. Calls this.getViewData() to get the current data string
// 2. Writes it to disk via vault.modify()
```

---

## 5. Getting a Container Element for a Canvas

The view provides two container elements:

### 5.1 containerEl

The full view element including the header/chrome. Generally do not mount into this directly.

### 5.2 contentEl (ItemView+)

The content area below the header. This is where you mount your canvas:

```typescript
class PaperView extends TextFileView {
  private canvasContainer: HTMLElement;
  private canvas: HTMLCanvasElement;

  async onOpen(): Promise<void> {
    // contentEl is available from ItemView
    this.canvasContainer = this.contentEl.createDiv({ cls: "paper-canvas-container" });
    this.canvas = this.canvasContainer.createEl("canvas", { cls: "paper-canvas" });

    // Set up touch/pointer event listeners
    this.registerDomEvent(this.canvas, "pointerdown", this.onPointerDown.bind(this));
    this.registerDomEvent(this.canvas, "pointermove", this.onPointerMove.bind(this));
    this.registerDomEvent(this.canvas, "pointerup", this.onPointerUp.bind(this));
  }

  async onClose(): Promise<void> {
    // contentEl is automatically cleaned up, but clean up any custom state
    this.canvasContainer.remove();
  }
}
```

### 5.3 Header Actions

Use `addAction()` from `ItemView` to add toolbar buttons:

```typescript
async onOpen(): Promise<void> {
  this.addAction("pencil", "Pen tool", () => this.setTool("pen"));
  this.addAction("eraser", "Eraser tool", () => this.setTool("eraser"));
  this.addAction("undo", "Undo", () => this.undo());
}
```

---

## 6. Embedding Custom Views in Markdown

This is the most complex area. There are three main approaches.

### 6.1 Approach 1: Markdown Post-Processor (Reading Mode)

The `registerMarkdownPostProcessor()` method allows you to modify how markdown renders in **reading mode** (preview). This handles the `![[file.paper]]` embed syntax in preview.

```typescript
this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
  // Find all embed elements that point to .paper files
  const embeds = el.querySelectorAll(".internal-embed");
  for (const embed of embeds) {
    const src = embed.getAttribute("src");
    if (src && src.endsWith(".paper")) {
      // Replace the embed placeholder with a rendered canvas
      const file = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (file) {
        // Create a render child for lifecycle management
        const renderChild = new PaperEmbedRenderChild(embed as HTMLElement, file, this);
        ctx.addChild(renderChild);
      }
    }
  }
});
```

The `MarkdownRenderChild` pattern ensures proper cleanup:

```typescript
class PaperEmbedRenderChild extends MarkdownRenderChild {
  constructor(containerEl: HTMLElement, private file: TFile, private plugin: PaperPlugin) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    // Read the paper file and render a preview
    const data = await this.plugin.app.vault.cachedRead(this.file);
    const state = JSON.parse(data);

    // Create a preview canvas
    const canvas = this.containerEl.createEl("canvas", { cls: "paper-embed-preview" });
    this.renderPreview(canvas, state);
  }

  onunload(): void {
    // Cleanup
  }
}
```

**Limitations:** Post-processors only work in reading/preview mode, not in live preview (editing mode).

### 6.2 Approach 2: CodeMirror 6 Decorations (Live Preview / Edit Mode)

For embeds to render in **live preview mode** (the default editing mode in modern Obsidian), you need CodeMirror 6 editor extensions. This is registered via `registerEditorExtension()`.

#### 6.2.1 Key CM6 Concepts

From `@codemirror/view`:
- **`Decoration`**: Marks or replaces ranges of text with custom rendering
  - `Decoration.mark({ class })` -- adds CSS classes to text ranges
  - `Decoration.replace({ widget })` -- replaces a text range with a widget
  - `Decoration.widget({ widget, side })` -- inserts a widget at a position
- **`WidgetType`**: Abstract class for custom DOM elements inserted into the editor
- **`ViewPlugin`**: A plugin that can provide decorations and react to editor state changes
- **`DecorationSet`**: An immutable set of decorations
- **`RangeSetBuilder`**: Builder for creating `DecorationSet`s

#### 6.2.2 Pattern for Embed Decoration

```typescript
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

class PaperEmbedWidget extends WidgetType {
  constructor(private filePath: string) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.classList.add("paper-embed-widget");
    // Render a preview of the paper file
    // Note: accessing the app/vault from here requires passing references
    return container;
  }

  eq(other: PaperEmbedWidget): boolean {
    return this.filePath === other.filePath;
  }
}

class PaperEmbedPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    // Find ![[*.paper]] patterns in the document
    const doc = view.state.doc;
    const text = doc.toString();
    const pattern = /!\[\[([^\]]+\.paper)\]\]/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      builder.add(from, to, Decoration.replace({
        widget: new PaperEmbedWidget(match[1]),
      }));
    }

    return builder.finish();
  }
}

const paperEmbedExtension = ViewPlugin.fromClass(PaperEmbedPlugin, {
  decorations: (v) => v.decorations,
});

// Registration in plugin:
this.registerEditorExtension(paperEmbedExtension);
```

#### 6.2.3 Accessing the App from CM6 Extensions

A challenge with CM6 extensions is that they don't have direct access to the Obsidian `App` object. Solutions:

1. **StateField with app reference**: Obsidian provides `editorEditorField` to get the `EditorView` from state.
2. **Closure over plugin reference**: Pass the plugin instance through the extension factory.
3. **Global reference**: Store a reference in a module-level variable (less clean but works).

### 6.3 Approach 3: Code Block Processor

Another embedding approach uses fenced code blocks:

````markdown
```paper
{"strokes": [...]}
```
````

Register with:

```typescript
this.registerMarkdownCodeBlockProcessor("paper", (source, el, ctx) => {
  // source = the code block content (JSON)
  // el = the container div to render into
  // ctx = post-processor context
  const state = JSON.parse(source);
  const canvas = el.createEl("canvas");
  this.renderPreview(canvas, state);
});
```

**Pros:**
- Works in both reading mode and live preview
- Data is inline in the markdown document
- Simple registration

**Cons:**
- Data is directly in the markdown file (makes files huge for complex drawings)
- Not suitable for large stroke datasets
- Doesn't support the `![[embed]]` syntax

### 6.4 How Excalidraw Handles Embeds

Based on community documentation and the public Excalidraw plugin architecture:

1. **Reading mode embeds**: Post-processor scans for `.excalidraw` embeds and replaces them with rendered SVG/canvas previews.
2. **Live preview embeds**: CM6 editor extension detects `![[drawing.excalidraw]]` patterns and replaces them with widget decorations showing the drawing preview.
3. **Thumbnail generation**: Excalidraw pre-renders SVG thumbnails for fast embed display without parsing the full scene.

### 6.5 Recommended Embed Strategy for ObsidianPaper

1. **Phase 1**: Implement `registerMarkdownPostProcessor()` for reading mode embeds (simpler)
2. **Phase 2**: Add CM6 `ViewPlugin` with `WidgetType` for live preview embeds
3. **Phase 3**: Consider pre-rendered SVG thumbnails for performance

---

## 7. WorkspaceLeaf Management

### 7.1 Opening a File in a View

```typescript
// Open in the current leaf
const leaf = this.app.workspace.getLeaf(false);
await leaf.openFile(file);

// Open in a new tab
const leaf = this.app.workspace.getLeaf(true);  // or 'tab'
await leaf.openFile(file);

// Open in a split
const leaf = this.app.workspace.getLeaf('split', 'vertical');
await leaf.openFile(file);
```

### 7.2 Finding Existing Leaves

```typescript
// Find all leaves of our view type
const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER);

// Get the active view if it's our type
const view = this.app.workspace.getActiveViewOfType(PaperView);
```

### 7.3 Setting View State

```typescript
await leaf.setViewState({
  type: VIEW_TYPE_PAPER,
  state: { file: filePath },
  active: true,
});
```

### 7.4 Deferred Loading (since Obsidian 1.7.2)

Obsidian may defer loading background tabs. Check with:

```typescript
if (leaf.isDeferred) {
  await leaf.loadIfDeferred();
}
```

---

## 8. File Handling with the Vault API

### 8.1 Creating Files

```typescript
// Create a text file
const file = await this.app.vault.create("path/to/note.paper", JSON.stringify(initialData));

// Create a binary file
const buffer = new ArrayBuffer(/* ... */);
const file = await this.app.vault.createBinary("path/to/note.paper", buffer);

// Create a folder
await this.app.vault.createFolder("Papers");
```

### 8.2 Reading Files

```typescript
// Read text (for modification)
const data = await this.app.vault.read(file);

// Read text (cached, for display only -- faster)
const data = await this.app.vault.cachedRead(file);

// Read binary
const buffer = await this.app.vault.readBinary(file);
```

### 8.3 Writing Files

```typescript
// Write text
await this.app.vault.modify(file, JSON.stringify(updatedData));

// Write binary
await this.app.vault.modifyBinary(file, buffer);

// Atomic read-modify-write
await this.app.vault.process(file, (data) => {
  const parsed = JSON.parse(data);
  parsed.lastModified = Date.now();
  return JSON.stringify(parsed);
});
```

### 8.4 Getting a File's Resource Path

```typescript
// Get a file:// URI for the browser engine (useful for embedding images, etc.)
const uri = this.app.vault.getResourcePath(file);
```

### 8.5 How Drawing Plugins Persist Data

Most drawing plugins use one of these strategies:

**Strategy 1: JSON text file**
- File contains raw JSON with drawing state
- Simple, version-control friendly
- Used by Excalidraw for `.excalidraw` files

**Strategy 2: Markdown-wrapped JSON**
- Markdown file with frontmatter + JSON in a code block
- Better Obsidian integration (metadata, links, search)
- Used by Excalidraw for `.excalidraw.md` files

**Strategy 3: Separate data + metadata**
- Drawing data in one file, metadata in frontmatter of a linked `.md` file
- More complex but cleanest separation of concerns

**Recommended for ObsidianPaper:** Start with Strategy 1 (JSON text in `.paper` file). The `TextFileView` handles all the read/write plumbing. A `.paper` file would contain:

```json
{
  "version": 1,
  "strokes": [
    {
      "id": "stroke-1",
      "points": [
        { "x": 100, "y": 200, "pressure": 0.5, "timestamp": 1708272000000 }
      ],
      "color": "#000000",
      "width": 2,
      "tool": "pen"
    }
  ],
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1.0
  }
}
```

---

## 9. Summary: Architecture for ObsidianPaper

Based on this research, the recommended architecture for ObsidianPaper is:

1. **View**: Extend `TextFileView` for the main `.paper` file view
   - `getViewData()` returns JSON string
   - `setViewData()` parses JSON and renders on canvas
   - `requestSave()` after each stroke completes
   - `onResize()` to handle canvas resizing
   - Mount `<canvas>` into `contentEl`

2. **Registration**:
   - `registerView()` with a `ViewCreator` factory
   - `registerExtensions(["paper"], VIEW_TYPE_PAPER)`

3. **Embeds (Phase 1)**: `registerMarkdownPostProcessor()` for reading mode
4. **Embeds (Phase 2)**: CM6 `ViewPlugin` with `WidgetType` for live preview
5. **File format**: JSON text in `.paper` files
6. **File I/O**: Handled automatically by `TextFileView` (uses `Vault.read()`/`Vault.modify()` internally)

---

## 10. Sources

- Obsidian API type definitions (`node_modules/obsidian/obsidian.d.ts`) -- the authoritative source for all API signatures and JSDoc comments
- ObsidianNewNoteTemplate sibling project -- reference implementation for `registerEditorExtension()`, CodeMirror 6 `ViewPlugin`, `Decoration`, `WidgetType` usage patterns
- Excalidraw Obsidian plugin -- public repository architecture analysis for view registration, dual file format strategy, and embed handling patterns
- Obsidian developer documentation at docs.obsidian.md (referenced in JSDoc links within the type definitions)
