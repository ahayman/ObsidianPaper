# Plan: Group Settings into Tabs

## Context

The settings panel currently displays all 11 sections as a flat list, making it long and hard to navigate. This change groups settings into 4 logical tabs: **Writing**, **Page**, **Device**, and **Files & Embeds**. The "Device" tab specifically collects all `localStorage`-backed settings that don't sync across devices.

## Tab Groupings

### Writing
- Pen defaults (pen type, width, pressure sensitivity)
- Smoothing (smoothing level)
- Grain texture (pencil grain strength)
- Fountain pen (nib angle, thickness, pressure, barrel rotation)

### Page
- Canvas (paper type, show grid, spacing unit, grid size, line spacing)
- Margins (top, bottom, sides)
- Page setup (page size, orientation, layout direction, custom size)

### Device (localStorage-backed, never syncs)
- Input (palm rejection, finger action)
- Rendering (render pipeline, render engine)
- Toolbar position

### Files & Embeds
- File (note location, folder, subfolder, filename template, format)
- Embeds (max width, max height)

## Implementation

### Step 1: Add tab CSS to `styles.css`

Add a `.paper-settings-tabs` tab bar and `.paper-settings-tab-content` container styles. Use the underline-style pattern already established in the project's color picker tabs (`.paper-color-picker__tab`), adapted for the settings context:

- Flex row for tab bar with bottom border
- Tab buttons with bottom-border active indicator using `--interactive-accent`
- Smooth transitions consistent with existing styles
- A description note below the "Device" tab content header explaining these settings are device-local

### Step 2: Refactor `PaperSettingsTab.display()` in `src/settings/PaperSettingsTab.ts`

The `display()` method currently appends all settings directly to `containerEl`. Refactor it to:

1. Create a tab bar (`div.paper-settings-tabs`) with 4 buttons
2. Create 4 content containers (`div.paper-settings-tab-content`), one per tab
3. Track active tab in a private field (`activeTab: string`, default `"writing"`)
4. Extract section-building into private methods:
   - `buildWritingTab(container: HTMLElement)` — pen defaults, smoothing, grain, fountain pen sections
   - `buildPageTab(container: HTMLElement)` — canvas, margins, page sections
   - `buildDeviceTab(container: HTMLElement)` — input, rendering sections + add toolbar position setting
   - `buildFilesTab(container: HTMLElement)` — file, embeds sections
5. `display()` rebuilds everything, then shows only the active tab's content
6. Tab click updates `activeTab` and toggles visibility (show/hide containers) without calling `display()` — except when `display()` is called for other reasons (unit change, conditional fields), in which case it preserves the active tab

Key considerations:
- When `this.display()` is called (e.g. spacing unit change, page size → custom), the active tab must be preserved. The `activeTab` field persists across `display()` calls since it's on the instance.
- Obsidian `Setting` objects just need an `HTMLElement` parent — passing the tab content div instead of `containerEl` works naturally.
- Add a small info note in the Device tab: "These settings are stored locally and won't sync across devices."

### Step 3: Add toolbar position to Device tab

Currently `toolbarPosition` is only settable from the toolbar popover. Add it as a dropdown in the Device settings tab for discoverability:
- Options: Top, Bottom, Left, Right
- Reads/writes via `deviceAccess` same as other device settings

### Step 4: Update tests in `src/settings/PaperSettingsTab.test.ts`

- Update existing smoke tests (they should still pass since `display()` still populates `containerEl`)
- Add a test that verifies 4 tab buttons are rendered
- Add a test that verifies tab switching shows/hides the correct content

## Files to Modify

| File | Change |
|------|--------|
| `src/settings/PaperSettingsTab.ts` | Refactor `display()` into tabbed layout with private section builders |
| `styles.css` | Add `.paper-settings-tabs` and `.paper-settings-tab-content` styles |
| `src/settings/PaperSettingsTab.test.ts` | Update/add tests for tabbed layout |

## Verification

1. `yarn build` — compiles without errors
2. `yarn test` — all tests pass
3. `yarn build:copy` — deploy to local vault
4. Manual: open settings → Paper → verify 4 tabs render, clicking each shows correct settings, device tab shows info note, all controls still functional
