# Notebook Navigator Menus API Research

**Date:** 2026-03-17
**Plugin Version:** 2.4.1 (API version 1.3.0)
**Source:** Decompiled from `main.js` (no README/docs exist in the plugin directory)

## API Access Path

```
app.plugins.plugins["notebook-navigator"].api.menus.registerFolderMenu(callback)
```

The API object hierarchy:
- `plugin.api` is an instance of the main API class (internally `MP`)
- `plugin.api.menus` is an instance of the Menus class (internally `xP`)
- `plugin.api.menus.registerFolderMenu(callback)` registers a folder context menu extension
- `plugin.api.menus.registerFileMenu(callback)` registers a file context menu extension

## `registerFolderMenu` Signature

```typescript
registerFolderMenu(callback: (ctx: FolderMenuContext) => void): () => void
```

**Return value:** An unregister function. Call it to remove the menu extension.

**CRITICAL: The callback does NOT receive `(menu, folder)` as two separate arguments.** It receives a **single object** with these properties:

```typescript
interface FolderMenuContext {
  addItem: (itemCallback: (item: MenuItem) => void) => void;
  folder: TFolder;  // Obsidian TFolder
}
```

The `addItem` function is a **wrapper** around the real Obsidian `Menu.addItem()`. The wrapper:
1. Checks that items are added synchronously (errors if called async)
2. Delegates to the real `menu.addItem()` internally
3. Counts the number of items added (return value of `applyFolderMenuExtensions`)

## Correct Usage

```typescript
const unregister = nnPlugin.api.menus.registerFolderMenu((ctx) => {
  ctx.addItem((item) => {
    item.setTitle("My Menu Item")
      .setIcon("lucide-icon-name")
      .onClick(() => {
        // Do something with ctx.folder
        console.log(ctx.folder.path);
      });
  });
});

// Later, to unregister:
unregister();
```

## Current ObsidianPaper Bug

The current code in `src/main.ts` line 274 calls:

```typescript
registerFolderMenu((menu, folder) => {
  menu.addItem((item) => { ... });
});
```

This is **incorrect**. The callback receives a single argument (the context object), not two. The parameter named `menu` is actually the full context object `{ addItem, folder }`. It happens to **work by accident** because:
- `menu` receives the context object `{ addItem, folder }`
- `menu.addItem(...)` works because `addItem` is a property of the context object
- `folder` receives `undefined` (second arg of a single-arg call)

So `menu.addItem()` works, but `folder` is **undefined**. Any code using the `folder` parameter (like `this.createNewPaper(folder)`) receives `undefined` instead of the TFolder.

### Corrected code should be:

```typescript
registerFolderMenu((ctx) => {
  ctx.addItem((item) => {
    item.setTitle("New Paper Document")
      .setIcon("pen-tool")
      .onClick(() => void this.createNewPaper(ctx.folder));
  });
});
```

## `registerFileMenu` Signature (for reference)

```typescript
registerFileMenu(callback: (ctx: FileMenuContext) => void): () => void
```

```typescript
interface FileMenuContext {
  addItem: (itemCallback: (item: MenuItem) => void) => void;
  file: TFile;  // Obsidian TFile
  selection: Readonly<{
    mode: string;
    files: ReadonlyArray<TFile>;
  }>;
}
```

## Async Restrictions

Both `registerFolderMenu` and `registerFileMenu` callbacks are subject to strict synchronous execution:

1. The callback itself **must not return a Promise**. If it does, an error is logged: "Notebook Navigator folder menu extension returned a Promise."
2. `addItem()` **must be called synchronously** during the callback execution. If called after the callback returns, an error is logged and the item is silently dropped.
3. Async work should be done inside `onClick` handlers.

## Timing / Initialization

- `this.menus = new xP()` happens in the API constructor, which runs in `onload()` of the Notebook Navigator plugin.
- The `folderMenuExtensions` Set is initialized in the constructor immediately.
- `registerFolderMenu` simply adds to a Set - there is **no timing issue** with calling it too early.
- The API is available as soon as `app.plugins.plugins["notebook-navigator"].api` is set, which happens during Notebook Navigator's `onload()`.
- The existing approach of waiting for `onLayoutReady` and retrying is sound and sufficient.

## Separator Behavior

When `applyFolderMenuExtensions` returns a count > 0, Notebook Navigator automatically adds a separator after the extension items. Extensions do not need to add their own separators.

## Other Plugins in Vault

No other installed plugins in this vault use the Notebook Navigator Menus API. ObsidianPaper is the only consumer.
