# Plan: Remove Brush Pen Type

## Context

ObsidianPaper is a handwriting app, not a painting app. The brush pen type (wide pressure range, tapered ends, high thinning) serves no practical purpose for handwriting/note-taking. It was also the only pen (besides pencil) with grain texture, but the grain was identical to pencil's dot-cluster texture — a proper bristle-streak texture would require significant additional complexity for a feature with no handwriting use case.

Removing brush simplifies the pen type roster to: **ballpoint, felt-tip, pencil, fountain, highlighter** — all of which serve clear handwriting purposes. Felt-tip stays as the "marker" option (wider, more pressure-sensitive than ballpoint).

---

## Step 1: Remove "brush" from PenType union

**File:** `src/types.ts`

Remove `| "brush"` from the `PenType` type definition.

---

## Step 2: Remove brush from PenConfigs + add fallback

**File:** `src/stroke/PenConfigs.ts`

- Delete the `brush` entry from `PEN_CONFIGS`

---

## Step 3: Remove brush from OutlineGenerator

**File:** `src/stroke/OutlineGenerator.ts`

Remove the `case "brush":` branch from the switch in `penStyleToOutlineOptions()`.

---

## Step 4: Remove brushGrainStrength from settings

**File:** `src/settings/PaperSettings.ts`

- Remove `brushGrainStrength` from `PaperSettings` interface
- Remove `brushGrainStrength` from `DEFAULT_SETTINGS`

---

## Step 5: Remove brush grain UI from settings tab

**File:** `src/settings/PaperSettingsTab.ts`

- Remove `brush: "Brush"` from `PEN_TYPE_OPTIONS`
- Remove the "Brush grain strength" setting input

---

## Step 6: Remove brush from toolbar UI

**File:** `src/view/toolbar/CustomizePopover.ts`
- Remove `{ type: "brush", label: "Brush" }` from `PEN_TYPES` array

**File:** `src/view/toolbar/PresetManager.ts`
- Remove `brush: "Brush"` from `PEN_TYPE_LABELS`

**File:** `src/view/toolbar/PenIcons.ts`
- Remove brush SVG icon definition

---

## Step 7: Remove brush grain wiring from PaperView

**File:** `src/view/PaperView.ts`

- Remove `this.renderer.setGrainStrength("brush", ...)` calls from `onOpen()` and `setSettings()`

---

## Step 8: Update tests

**File:** `src/stroke/PenConfigs.test.ts`
- Remove `expect(penTypes).toContain("brush")`
- Remove "brush should have wide width range" test
- Remove "brush should have grain enabled" test
- Remove "brush grain should be weaker than pencil grain" test
- Remove "brush" from pen type iteration arrays
- Add test for `getPenConfig` fallback behavior

**File:** `src/stroke/OutlineGenerator.test.ts`
- Remove "should map brush style correctly" test
- Remove "brush" from pen type arrays

**File:** `src/stroke/PenEngine.test.ts`
- Change brush references to use another pen type (e.g., felt-tip)

**File:** `src/view/toolbar/PresetManager.test.ts`
- Change `penType: "brush"` in test data to another valid type

**File:** `src/settings/PaperSettings.test.ts`
- Remove `brushGrainStrength` assertions
- Change `defaultPenType: "brush"` in test overrides to another type
- Remove brushGrainStrength from full-override test object

**File:** `src/document/Serializer.test.ts`
- Change `pen: "brush"` in test styles to another valid type

---

## Files Changed

| File | Type | Description |
|------|------|-------------|
| `src/types.ts` | Modify | Remove "brush" from PenType union |
| `src/stroke/PenConfigs.ts` | Modify | Remove brush config, add fallback |
| `src/stroke/OutlineGenerator.ts` | Modify | Remove brush switch case |
| `src/settings/PaperSettings.ts` | Modify | Remove brushGrainStrength |
| `src/settings/PaperSettingsTab.ts` | Modify | Remove brush from UI |
| `src/view/toolbar/CustomizePopover.ts` | Modify | Remove brush option |
| `src/view/toolbar/PresetManager.ts` | Modify | Remove brush label |
| `src/view/toolbar/PenIcons.ts` | Modify | Remove brush icon |
| `src/view/PaperView.ts` | Modify | Remove brush grain wiring |
| `src/stroke/PenConfigs.test.ts` | Modify | Remove brush tests, add fallback test |
| `src/stroke/OutlineGenerator.test.ts` | Modify | Remove brush test |
| `src/stroke/PenEngine.test.ts` | Modify | Change brush refs |
| `src/view/toolbar/PresetManager.test.ts` | Modify | Change brush refs |
| `src/settings/PaperSettings.test.ts` | Modify | Remove brush grain tests |
| `src/document/Serializer.test.ts` | Modify | Change brush refs |

---

## Verification

1. `yarn build` — compiles without errors
2. `yarn test` — all tests pass
3. `yarn lint` — no lint errors
4. Manual: toolbar pen picker shows no brush option
5. Manual: settings page has no brush grain strength field
6. Manual: open a document with old brush strokes — they render as felt-tip (no crash)
