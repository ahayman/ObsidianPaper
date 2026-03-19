# Fix: Tapping active preset should edit the preset, not just the current pen

## Problem
After commit b20eb01 ("Current Pen modifications modified preset pen"), editing a preset by tapping it no longer saves changes back to the preset. Instead, it only modifies the current pen state.

## Root Cause
In `Toolbar.ts` `handlePresetClick()` (line 217-221), when the user taps an already-active preset, the code opens the popover **without** setting `editingPresetId` / `editingState`. This means the `onStateChange` callback takes the non-editing branch (line 329), which only updates `this.state` (current pen) and never calls `presetManager.updatePreset()`.

The right-click/long-press path (`handlePresetContextMenu`) correctly sets up editing mode and saves changes back to the preset.

## Fix
In `handlePresetClick`, when the active preset is tapped, delegate to `handlePresetContextMenu(presetId)` instead of directly calling `openPopover()`. This ensures the editing state is properly initialized and changes are persisted to the preset.

### Code Change
In `src/view/toolbar/Toolbar.ts`, change lines 217-221:

**Before:**
```typescript
if (this.state.activePresetId === presetId && this.state.activeTool === "pen") {
  const anchor = this.presetStrip?.getButtonElement(presetId);
  this.openPopover(anchor ?? undefined);
  return;
}
```

**After:**
```typescript
if (this.state.activePresetId === presetId && this.state.activeTool === "pen") {
  this.handlePresetContextMenu(presetId);
  return;
}
```

This is safe because when `activePresetId === presetId`, the current pen state matches the preset (otherwise `findMatchingPreset` would have cleared `activePresetId`). So `editingState` built from the preset will match the current state.
