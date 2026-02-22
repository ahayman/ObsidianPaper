# Notebook Navigator & Obsidian File Creation API Research

## Date: 2026-02-22

---

## 1. How Notebook Navigator Handles Creating New Notes

### Its Own Creation Mechanism (Not Core's)

Notebook Navigator implements its **own note creation system** that bypasses Obsidian's default "Create new note" behavior. The plugin registers a command `new-note` ("Create new note") and recommends users rebind `Cmd/Ctrl+N` to it (unbinding from Obsidian's default first).

**Command registration** (in `src/services/commands/registerNavigatorCommands.ts`):
```typescript
plugin.addCommand({
  id: 'new-note',
  name: strings.commands.createNewNote,
  callback: () => {
    runAsyncAction(async () => {
      const view = await ensureNavigatorOpen(plugin);
      if (view) {
        await view.createNoteInSelectedFolder(
          plugin.settings.createNewNotesInNewTab
        );
      }
    });
  }
});
```

**File creation** (in `src/services/FileSystemService.ts`):
- Uses `app.fileManager.createNewMarkdownFile()` for markdown files (so Obsidian plugin hooks still run)
- Uses `app.vault.create()` directly for canvas/drawing files with custom content
- The service includes methods: `createNewFile()`, `createNewFileForTag()`, `createNewFileForProperty()`, `createCanvas()`, `createBase()`
- File names are auto-generated as "Untitled" with incrementing numbers via a `generateUniqueFilename()` utility

### Location Determination

Notebook Navigator **does** read Obsidian's core settings for default file location:
```typescript
const defaultParent = this.app.fileManager.getNewFileParent(sourceFilePath ?? '');
```
This reads the user's configured `newFileLocation` setting (under Settings > Files & links > Default location for new notes). However, the plugin's primary behavior is to create notes in the **currently selected folder** in its navigator pane, which overrides the core setting in practice.

---

## 2. Notebook Navigator's API & Extension Points

### Public API (v1.2.0+)

Notebook Navigator exposes a public API accessible via:
```typescript
const api = app.plugins.plugins['notebook-navigator']?.api;
```

The API has four namespaces:

**Metadata API:**
- `getFolderMeta()` / `setFolderMeta()` - Folder appearance (color, background, icon)
- `getTagMeta()` / `setTagMeta()` - Tag node appearance
- `getPropertyMeta()` / `setPropertyMeta()` - Property node appearance
- `pin()` / `unpin()` / `isPinned()` / `getPinned()` - Pinned file management

**Navigation API:**
- `reveal(file)` - Highlight and select a file in the navigator
- `navigateToFolder()` / `navigateToTag()` / `navigateToProperty()` - Switch views

**Selection API:**
- `getNavItem()` - Get selected folder/tag/property
- `getCurrent()` - Get complete selection state `{ files, focused }`

**Menus API (most relevant):**
- `registerFileMenu(callback)` - Add items to file right-click context menu
- `registerFolderMenu(callback)` - Add items to folder right-click context menu

The `registerFolderMenu` callback receives `{ addItem, folder }` where `addItem` wraps Obsidian's standard `MenuItem` functionality. Items must be added synchronously.

**Events:**
- `storage-ready` event (via `.on()` / `.once()`)

### Can Other Plugins Register Custom Document Types?

**No.** The Notebook Navigator API does **not** provide any mechanism for:
- Registering custom file types
- Adding custom "new file" creation options to its UI
- Extending the types of documents it can create
- Hooking into its file creation flow

The Menus API only allows adding items to existing context menus -- it does not expose the file creation pipeline itself. You could potentially add a "New Handwriting Note" menu item to the folder context menu using `registerFolderMenu`, which would then call your own file creation logic, but the item would only appear in Notebook Navigator's context menu, not in Obsidian's core file explorer or other plugins.

---

## 3. Obsidian's Core Settings Access

### `newFileLocation` and `newFileFolderPath`

Obsidian stores core settings that plugins can read and write:

```typescript
// Read
this.app.vault.getConfig('newFileLocation');    // e.g., 'folder', 'current', 'root'
this.app.vault.getConfig('newFileFolderPath');   // e.g., 'Notes/Inbox'

// Write
this.app.vault.setConfig('newFileLocation', 'folder');
this.app.vault.setConfig('newFileFolderPath', 'My Folder');
```

**Note:** `getConfig()` / `setConfig()` are **not in the official type definitions** (`obsidian.d.ts`). They exist at runtime but are undocumented, meaning they could change. The officially supported alternative is:

```typescript
this.app.fileManager.getNewFileParent(sourcePath);  // Returns TFolder
```

This method (`@since 1.1.13`) respects the user's configured default location settings and is the recommended way to determine where new files should go.

---

## 4. Obsidian's Core Plugin API for File Creation Registration

### There Is No "File Creator Registry"

Obsidian does **not** have a formal API like `registerFileCreator()` or a "file creator registry" that lets plugins register new file types that automatically appear in global menus (like the file explorer's "New note" dropdown or a system-wide "New file" menu).

### What Obsidian Does Provide

**File type registration (viewing/opening):**
```typescript
// Register a custom view type
this.registerView('handwriting-view', (leaf) => new HandwritingView(leaf));

// Associate file extension with view
this.registerExtensions(['handwriting'], 'handwriting-view');
```
This makes Obsidian recognize `.handwriting` files and open them with your custom view. But it does NOT add a "New Handwriting" option to any menu.

**Vault file operations:**
```typescript
await this.app.vault.create('path/to/file.handwriting', initialContent);
await this.app.vault.createBinary('path/to/file.handwriting', arrayBuffer);
await this.app.vault.createFolder('path/to/folder');
```

**Vault events (post-creation only):**
```typescript
this.registerEvent(this.app.vault.on('create', (file) => { /* after creation */ }));
this.registerEvent(this.app.vault.on('modify', (file) => { /* after modification */ }));
this.registerEvent(this.app.vault.on('delete', (file) => { /* after deletion */ }));
this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { /* after rename */ }));
```
**Important:** The `create` event fires **after** file creation (and also on vault load for existing files). There is no pre-creation hook or interceptor.

**Context menu extension:**
```typescript
// Add items to file explorer right-click menu
this.registerEvent(
  this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
    menu.addItem((item) => {
      item.setTitle('New Handwriting Note')
          .setIcon('pencil')
          .onClick(() => {
            // Create your file here using vault.create()
          });
    });
  })
);

// Multi-file context menu (since v1.4.10)
this.registerEvent(
  this.app.workspace.on('files-menu', (menu, files, source, leaf) => {
    // Similar pattern
  })
);

// Editor right-click menu
this.registerEvent(
  this.app.workspace.on('editor-menu', (menu, editor, info) => {
    // Add editor context menu items
  })
);
```

**Commands (command palette):**
```typescript
this.addCommand({
  id: 'create-handwriting-note',
  name: 'Create new handwriting note',
  callback: () => {
    // Your creation logic
  }
});
```

### How Canvas Does It (For Reference)

Canvas is a **core plugin** (not a community plugin), so it has privileged access to internal APIs that community plugins do not. It registers `.canvas` as a file type and adds its "New canvas" option through internal mechanisms. Community plugins cannot replicate this pattern for the core "New file" dropdown.

---

## 5. Inter-Plugin Communication Patterns

### Method 1: Plugin Instance Access
```typescript
const otherPlugin = this.app.plugins.plugins['plugin-id'];
if (otherPlugin?.api) {
  otherPlugin.api.someMethod();
}
```

### Method 2: Global Window Property
```typescript
// Publisher plugin
(window as any).myPluginAPI = { version: '1.0', doSomething: () => {} };

// Consumer plugin
const api = (window as any).myPluginAPI;
```

### Method 3: npm Package with Accessor
Publish an npm package with a getter function that retrieves the API from a uniquely named window property. Consumers import and call the getter. This is the community-recommended best practice (used by Dataview, Templater, etc.).

### Method 4: Command Invocation (Unofficial)
```typescript
(this.app as any).commands.executeCommandById('plugin-id:command-id');
```
**Warning:** `app.commands` is not in the official type definitions and may be deprecated. It requires `(app as any)` casting and there is no official confirmation of long-term support.

---

## 6. Summary & Implications for ObsidianPaper

### What's Possible for Custom File Creation

1. **Register `.paper` (or similar) extension** with a custom view via `registerView()` + `registerExtensions()`. This makes Obsidian recognize and open the files.

2. **Add "New handwriting note" command** via `addCommand()` so users can create notes from the command palette (and bind a hotkey).

3. **Add context menu items** via the `file-menu` workspace event, adding a "New Handwriting Note" option when right-clicking folders in the core file explorer.

4. **Integrate with Notebook Navigator** via its Menus API (`registerFolderMenu`), adding a "New Handwriting Note" option to its folder context menu.

5. **Use `vault.create()` or `vault.createBinary()`** to programmatically create the file with appropriate initial content.

### What's NOT Possible

- There is no way to make a custom file type appear in Obsidian's built-in "New note" button/dropdown alongside "New note" and "New canvas". That UI element is controlled by core and not extensible by community plugins.
- There is no pre-creation hook to intercept or modify file creation initiated by other plugins or core.
- There is no formal "file creator registry" that plugins can participate in.

### Recommended Integration Strategy

The most comprehensive approach would be:
1. `registerView()` + `registerExtensions()` for `.paper` files
2. `addCommand()` for "Create new handwriting note" (bindable to hotkey)
3. `workspace.on('file-menu')` to add creation option to core file explorer context menus
4. Notebook Navigator's `menus.registerFolderMenu()` to add creation option to its folder context menus
5. Optionally use `addRibbonIcon()` for a sidebar quick-create button

This covers all the main entry points where users would expect to create new documents.
