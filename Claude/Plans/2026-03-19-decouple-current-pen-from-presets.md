# Decouple Current Pen Settings from Presets

## Problem

When the user modifies pen settings via the customization popover, and the current pen was loaded from a preset, those changes are auto-saved back to the preset (`Toolbar.ts:287-293`). This means:
1. Adjusting width/color/etc on the current pen permanently alters the preset
2. Users can't make temporary adjustments without corrupting their presets

## Desired Behavior

- Selecting a preset loads its settings into the current pen (already works)
- Modifying the current pen should **not** update the preset
- The preset strip should deselect (no highlight) once the user modifies settings away from a preset
- If the user's modifications happen to match another preset, that preset should highlight (existing `findMatchingPreset` logic)
- Users can explicitly save settings as a new preset via "Save as new preset" button (already works)

## Plan

### Step 1: Remove auto-save in `Toolbar.ts` `onStateChange` handler

In the `else` branch (lines 285-303), replace the auto-save block with just clearing the active preset and using `findMatchingPreset`:

**Before (lines 285-303):**
```typescript
} else {
  Object.assign(this.state, partial);
  if (this.state.activePresetId) {
    // Auto-save changes back to the active preset
    const data = this.presetManager.createFromState(this.state);
    this.presetManager.updatePreset(this.state.activePresetId, data);
    const updated = this.presetManager.getPreset(this.state.activePresetId);
    if (updated) this.presetStrip?.updateSinglePreset(updated);
    this.callbacks.onPresetSave(this.presetManager.toArray(), this.state.activePresetId);
  } else {
    // No active preset — check if state now matches one
    const match = this.presetManager.findMatchingPreset(this.state);
    if (match !== this.state.activePresetId) {
      this.state.activePresetId = match;
      this.presetStrip?.setActivePreset(match);
    }
  }
  this.currentPenBtn?.update(this.state.colorId, this.state.penType);
  this.callbacks.onPenSettingsChange({ ...this.state });
}
```

**After:**
```typescript
} else {
  Object.assign(this.state, partial);
  // Check if state matches any preset (including the currently active one)
  const match = this.presetManager.findMatchingPreset(this.state);
  if (match !== this.state.activePresetId) {
    this.state.activePresetId = match;
    this.presetStrip?.setActivePreset(match);
  }
  this.currentPenBtn?.update(this.state.colorId, this.state.penType);
  this.callbacks.onPenSettingsChange({ ...this.state });
}
```

This removes the auto-save entirely. When the user changes a setting, the active preset ID will naturally clear (since the modified state won't match the preset anymore), and the preset strip will deselect.

### Step 2: Update the popover's preset context

When the current pen detaches from a preset (activePresetId becomes null), the popover should update its "Save as new preset" / "Delete" buttons. The popover receives the preset at creation time, but once the user modifies settings, we need to tell the popover there's no active preset anymore.

Add a call to `this.popover?.setActivePreset(...)` when the match changes:

```typescript
if (match !== this.state.activePresetId) {
  this.state.activePresetId = match;
  this.presetStrip?.setActivePreset(match);
  const matchedPreset = match ? this.presetManager.getPreset(match) ?? null : null;
  this.popover?.setActivePreset(matchedPreset);
}
```

### Files Changed

- `src/view/toolbar/Toolbar.ts` — Remove auto-save logic, use `findMatchingPreset` for all state changes
