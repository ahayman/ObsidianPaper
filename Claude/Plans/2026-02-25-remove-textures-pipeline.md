# Remove Textures Pipeline, Rename Stamps to Advanced

## Goal
Remove the "textures" rendering pipeline entirely, leaving only two pipelines: **Basic** and **Advanced** (renamed from "Stamps").

## Rationale
The textures pipeline offers no performance gain over stamps and its rendering technique is inferior.

## Key Insight
The `textures` pipeline is never branched on directly in the rendering code — it falls through to the same code as `stamps` for grain/ink-pooling (via `pipeline !== "basic"` checks). The only thing `stamps` adds over `textures` is the stamp-based rendering (checked via `pipeline === "stamps"`). Removing `textures` means the `pipeline !== "basic"` checks still work correctly for the renamed `advanced` pipeline.

## Changes

### 1. Update the type definition
**File:** `src/types.ts` (line 61)
- Change `"basic" | "textures" | "stamps"` → `"basic" | "advanced"`

### 2. Update global settings default
**File:** `src/settings/PaperSettings.ts` (line 169)
- Change default from `"textures"` to `"advanced"`

### 3. Update settings UI
**File:** `src/settings/PaperSettingsTab.ts` (lines 436-438)
- Remove `textures` option
- Rename `stamps` to `advanced` with label "Advanced (default)"
- Update `basic` label to "Basic (fastest)"

### 4. Update document settings popover
**File:** `src/view/toolbar/DocumentSettingsPopover.ts` (lines 137-140)
- Remove `textures` option from `PIPELINE_OPTIONS`
- Rename `stamps` to `advanced` with label "Advanced"

### 5. Update all `=== "stamps"` checks to `=== "advanced"`
Files with `pipeline === "stamps"` checks:
- `src/canvas/StrokeRenderCore.ts` — lines 105, 139, 496, 543
- `src/canvas/Renderer.ts` — lines 561, 690, 787
- `src/canvas/tiles/worker/tileWorker.ts` — lines 598, 632

### 6. Update default initializers
Files that initialize `pipeline = "textures"`:
- `src/canvas/Renderer.ts` — lines 107, 1426
- `src/canvas/tiles/TileRenderer.ts` — line 39
- `src/canvas/tiles/WebGLTileEngine.ts` — line 49
- `src/canvas/tiles/worker/tileWorker.ts` — line 52

Change all to `= "advanced"`.

### 7. Update `grainToTextureStrength` doc comment
**File:** `src/stamp/GrainMapping.ts` (lines 52-60)
- Update the doc comment to no longer refer to "textures pipeline" — just reference the non-basic pipeline.

### 8. Update serialization/deserialization
**File:** `src/document/Serializer.ts`
- Add migration: if deserialized `rp` is `"textures"` or `"stamps"`, map to `"advanced"`
- Serialization of `"advanced"` writes `rp: "advanced"` (no change needed in logic, just the value)

### 9. Update tests
**File:** `src/settings/PaperSettings.test.ts` (line 105)
- Change expected default from `"textures"` to `"advanced"`

### 10. Update GrainMapping test if relevant
**File:** `src/stamp/GrainMapping.test.ts`
- Check for any pipeline-specific references and update

## Migration Notes
- Existing documents with `rp: "textures"` in their serialized data need to be mapped to `"advanced"` on load
- Existing documents with `rp: "stamps"` also need to be mapped to `"advanced"` on load
- No data loss — the advanced pipeline is a superset of textures functionality
