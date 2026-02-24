# Auto-Save Pen Presets

## Problem
1. The "Update Preset" button doesn't reliably save changes.
2. When editing a preset pen's settings in the popover, changes apply to the "current pen" state rather than to the preset itself.

## Goal
- Remove the "Update Preset" button entirely.
- When a preset is active and the user changes settings in the popover, those changes should immediately update the preset and persist.

## Changes

### 1. `CustomizePopover.ts` — Remove "Update Preset" button and callback

- Remove `onUpdatePreset` from `CustomizePopoverCallbacks` interface (line 27).
- In `buildPresetActions()` (lines 344-350), remove the "Update preset" button block. The active-preset section will only show "Save as new preset" and "Delete".

### 2. `Toolbar.ts` — Auto-save preset on every state change

- Remove the `onUpdatePreset` callback from the `openPopover()` method (lines 242-248).
- Modify the `onStateChange` callback (lines 221-230): when `this.state.activePresetId` is set, after applying the partial state change, also:
  1. Call `this.presetManager.updatePreset(activePresetId, data)` with the new state converted via `createFromState()`.
  2. Update the preset strip UI.
  3. Call `this.callbacks.onPresetSave(...)` to persist.
  4. **Skip** the `findMatchingPreset()` logic — since we're updating the preset to match, the active preset should stay active. Only run `findMatchingPreset` when no preset is active.

### 3. `PresetManager.test.ts` — Update tests

- Remove or update any tests that reference `onUpdatePreset`.
- Add test verifying that `updatePreset` works correctly when called with `createFromState` output.

## Key Behavior Change

**Before:** Changing a slider when a preset is active modifies the "current pen" state. The preset strip de-highlights the preset (because it no longer matches). User must click "Update Preset" to save changes back.

**After:** Changing a slider when a preset is active immediately updates the preset itself. The preset strip keeps the preset highlighted. Changes persist automatically.
