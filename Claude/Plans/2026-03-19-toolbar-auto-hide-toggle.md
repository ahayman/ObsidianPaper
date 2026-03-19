# Toolbar Auto-Hide Toggle

## Goal
Make the toolbar auto-hide-while-writing behavior a user-configurable option (currently always enabled).

## Current Behavior
- `AutoMinimizer` state machine in `src/view/toolbar/AutoMinimizer.ts` auto-minimizes toolbar on stroke start, expands 500ms after stroke end
- `Toolbar.ts` creates an `AutoMinimizer` instance and wires it to stroke start/end notifications
- No user setting exists to disable this

## Plan

### 1. Add `autoHideToolbar` to DeviceSettings
**File:** `src/settings/DeviceSettings.ts`
- Add `autoHideToolbar: boolean` to `DeviceSettings` interface
- Default to `true` in `DEFAULT_DEVICE_SETTINGS` (preserves current behavior)

This is a device setting (like `toolbarPosition`) because auto-hide preference may differ per device (e.g., want it on iPad but not desktop).

### 2. Add setting toggle to Settings Tab
**File:** `src/settings/PaperSettingsTab.ts`
- Add a toggle under the existing "Toolbar" heading (after toolbar position dropdown)
- Label: "Auto-hide toolbar while writing"
- Description: "Minimize the toolbar when writing and restore it when finished"

### 3. Wire setting into AutoMinimizer
**File:** `src/view/toolbar/AutoMinimizer.ts`
- Add `setEnabled(enabled: boolean)` method
- When disabled (`enabled = false`), force expand and ignore stroke notifications
- When re-enabled, resume normal behavior

### 4. Pass setting to Toolbar
**File:** `src/view/toolbar/Toolbar.ts`
- Accept initial `autoHideToolbar` boolean (from device settings)
- Call `autoMinimizer.setEnabled(autoHideToolbar)` on construction
- Add `setAutoHide(enabled: boolean)` public method for live updates

### 5. Wire through PaperView and EmbeddedPaperModal
**Files:** `src/view/PaperView.ts`, `src/embed/EmbeddedPaperModal.ts`
- Pass `autoHideToolbar` from device settings when constructing toolbar
- In `onDeviceSettingsChange` handler, call `toolbar.setAutoHide(...)` so changes take effect immediately

### 6. Update AutoMinimizer tests
**File:** `src/view/toolbar/AutoMinimizer.test.ts`
- Add tests for disabled state: stroke start/end should not minimize
- Test enable/disable transitions

## Files Changed
1. `src/settings/DeviceSettings.ts` — add field + default
2. `src/settings/PaperSettingsTab.ts` — add toggle UI
3. `src/view/toolbar/AutoMinimizer.ts` — add `setEnabled()`
4. `src/view/toolbar/Toolbar.ts` — accept + expose setting
5. `src/view/PaperView.ts` — wire setting through
6. `src/embed/EmbeddedPaperModal.ts` — wire setting through
7. `src/view/toolbar/AutoMinimizer.test.ts` — new tests
