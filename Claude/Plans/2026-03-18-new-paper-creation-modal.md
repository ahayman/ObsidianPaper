# New Paper Creation Modal

## Goal

Replace the current direct-create behavior with a modal dialog that lets the user name the document and choose a folder before creating it. Default the name to a human-readable date/time instead of "Untitled Paper".

## Current Behavior

- `createNewPaper()` in `src/main.ts:380` resolves a folder from settings, generates a filename from `fileNameTemplate` (default "Untitled Paper"), and immediately creates the file.
- `generateFileName()` at `src/main.ts:441` appends incrementing numbers if the name already exists.
- Called from: command palette ("Create new handwriting note") and folder context menu ("New Paper Document").

## Plan

### Step 1: Create `NewPaperModal` class

**New file:** `src/modal/NewPaperModal.ts`

A modal extending Obsidian's `Modal` with:

- **Name input:** A text field pre-filled with the current date/time formatted as `"YYYY-MM-DD h.mm A"` (e.g., `"2026-03-18 2.35 PM"`). Use periods instead of colons in the time since colons are not valid in filenames on most systems.
- **Folder input:** A text field showing the resolved default folder path. The user can type a path or use a suggestion dropdown. Pre-populate with the folder that `resolveNewNoteFolder()` would return (or `folderOverride` if provided from the context menu).
- **Folder suggestions:** As the user types in the folder field, show a filtered list of all folders in the vault (using `app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder)`). Clicking a suggestion fills the field.
- **Create button:** Creates the file with the entered name in the chosen folder.
- **Cancel button / Escape:** Closes without creating.
- **Enter key:** Triggers create.

### Step 2: Integrate modal into `createNewPaper()`

Modify `PaperPlugin.createNewPaper()` in `src/main.ts`:

1. Resolve the default folder (using existing `resolveNewNoteFolder()` or `folderOverride`).
2. Open `NewPaperModal` with the default folder and a generated default name (date/time).
3. On confirm, receive `{ name, folder }` from the modal.
4. Handle duplicate name detection (existing `generateFileName` logic adapted for the user-chosen name).
5. Create the document and open it (existing logic from lines 386-408).

### Step 3: Update `generateFileName()`

Change the default name generation from `fileNameTemplate` to a date/time string:

```typescript
private generateDefaultName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = now.getHours();
  const h = hours % 12 || 12;
  const ampm = hours < 12 ? "AM" : "PM";
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${h}.${pad(now.getMinutes())} ${ampm}`;
}
```

Keep `generateFileName()` for deduplication but have it accept a base name parameter.

### Step 4: Clean up settings

The `fileNameTemplate` setting becomes less important since the user picks a name each time. Options:
- **Keep it** as a fallback/default but note it's now overridden by the modal. Could be used as an alternative to the date format if the user prefers a static template.
- Or **remove it** to simplify.

**Recommendation:** Keep `fileNameTemplate` for now. If it's set to something other than "Untitled Paper", use it as the default in the modal instead of the date/time. This preserves backward compatibility.

## File Changes

| File | Change |
|------|--------|
| `src/modal/NewPaperModal.ts` | **New** — Modal class with name + folder inputs |
| `src/main.ts` | Modify `createNewPaper()` to open modal, adjust `generateFileName()` |

## UI Layout

```
┌─────────────────────────────────────┐
│  New Paper Document                 │
│                                     │
│  Name                               │
│  ┌─────────────────────────────────┐│
│  │ 2026-03-18 2.35 PM             ││
│  └─────────────────────────────────┘│
│                                     │
│  Folder                             │
│  ┌─────────────────────────────────┐│
│  │ Papers/                         ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Papers/                         ││
│  │ Papers/Archive                  ││
│  │ Papers/Notes                    ││
│  └─────────────────────────────────┘│
│                                     │
│              [Cancel]  [Create]     │
│                                     │
└─────────────────────────────────────┘
```
