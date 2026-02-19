# Directional Fountain Pen Implementation Plan

**Date:** 2026-02-19
**Goal:** Make the fountain pen produce direction-dependent stroke width using an italic nib model, where stroke thickness varies based on the angle between the nib edge and the stroke direction. Users must be able to adjust nib angle and dimensions at runtime.

---

## Background

The fountain pen config already defines `nibAngle` (π/6), `nibThickness` (0.25), and `useBarrelRotation` (true), and `PenEngine.ts` already has `computeFountainWidth()` — but none of this is wired into the actual rendering path. Currently all pen types go through `perfect-freehand` via `OutlineGenerator.ts`, which only uses pressure for width variation. `perfect-freehand` has no hook for direction-based width.

Additionally, nib properties are currently hardcoded in `PenConfig` — there's no way for users to adjust the nib angle or thickness, and these values aren't stored per-stroke, so changing pen configuration would break previously drawn strokes.

### Key Decisions

1. **Custom outline generator for fountain pen** — `perfect-freehand` cannot do direction-based width natively. Rather than hacking pressure values, we write a purpose-built outline generator that takes per-point widths and produces the same `number[][]` polygon format.

2. **Flat nib projection formula** — For a rectangular italic nib, the correct formula is `width = nibWidth * |sin(Δ)| + nibHeight * |cos(Δ)|` (linear projection), not the existing ellipse model (`sqrt(W²sin² + T²cos²)`). The flat formula is cheaper and more physically correct for a chisel-edge nib.

3. **Cross-product optimization** — Instead of `atan2(dy,dx)` then `sin(nibAngle - strokeAngle)`, precompute the nib unit vector and use the 2D cross product: `|sin(Δ)| = |nx*sy - ny*sx|`. Eliminates `atan2` + `sin` per point.

4. **CSS-based nib cursor** — Extend the existing DOM `HoverCursor` with a rotated rectangle mode rather than adding a canvas overlay. CSS transforms handle rotation and nib dimensions cleanly.

5. **Per-stroke nib storage** — `nibAngle` and `nibThickness` are added as optional fields on `PenStyle` so each stroke records exactly the nib configuration it was drawn with. This ensures old strokes render correctly even if the user later changes their nib settings.

6. **Runtime nib controls** — The `ToolPalette` shows nib angle and thickness sliders when the fountain pen is selected. These are quick-access controls (not buried in plugin settings), since calligraphers adjust nib angle frequently.

---

## Phase 1: Data Model — Nib Properties in PenStyle

### 1a. Add optional nib fields to `PenStyle`

**File: `src/types.ts`**

```typescript
export interface PenStyle {
  pen: PenType;
  color: string;
  colorDark?: string;
  width: number;
  opacity: number;
  smoothing: number;
  pressureCurve: number;
  tiltSensitivity: number;
  // NEW: Nib configuration (fountain pen and future directional pens)
  nibAngle?: number;       // Nib angle in radians (0 = horizontal)
  nibThickness?: number;   // Minor/major axis ratio (0-1, e.g. 0.25 = 4:1 aspect)
}
```

These are optional — non-fountain pen strokes omit them. When present on a stroke, they override the values from `PenConfig`.

### 1b. Add nib fields to `SerializedPenStyle`

**File: `src/types.ts`**

```typescript
export interface SerializedPenStyle {
  pen: string;
  color: string;
  colorDark?: string;
  width: number;
  opacity: number;
  smoothing: number;
  pressureCurve: number;
  tiltSensitivity: number;
  // NEW
  nibAngle?: number;
  nibThickness?: number;
}
```

### 1c. Update Serializer

**File: `src/document/Serializer.ts`**

In `serializeStyles()` — add nib fields (only when present):
```typescript
...(style.nibAngle != null ? { nibAngle: style.nibAngle } : {}),
...(style.nibThickness != null ? { nibThickness: style.nibThickness } : {}),
```

In `deserializeStyles()` — read nib fields (only when present):
```typescript
...(s.nibAngle != null ? { nibAngle: s.nibAngle } : {}),
...(s.nibThickness != null ? { nibThickness: s.nibThickness } : {}),
```

No version bump needed — the fields are optional and old documents without them are handled correctly via `PenConfig` fallback.

### 1d. Update `PaperView.getCurrentStyle()`

**File: `src/view/PaperView.ts`**

Include nib properties in the style when relevant:
```typescript
private getCurrentStyle(): PenStyle {
  const penConfig = getPenConfig(this.currentPenType);
  const style: PenStyle = {
    pen: this.currentPenType,
    color: this.currentColorId,
    width: this.currentWidth,
    opacity: penConfig.baseOpacity,
    smoothing: penConfig.smoothing,
    pressureCurve: penConfig.pressureCurve,
    tiltSensitivity: penConfig.tiltSensitivity,
  };
  // Store nib params for fountain pen (and future directional pens)
  if (penConfig.nibAngle !== null) {
    style.nibAngle = this.currentNibAngle;
    style.nibThickness = this.currentNibThickness;
  }
  return style;
}
```

### 1e. Update `computeStyleOverrides()`

**File: `src/view/PaperView.ts`**

Add nib fields to the override comparison:
```typescript
if (current.nibAngle !== base.nibAngle) { overrides.nibAngle = current.nibAngle; has = true; }
if (current.nibThickness !== base.nibThickness) { overrides.nibThickness = current.nibThickness; has = true; }
```

---

## Phase 2: Plugin Settings — Fountain Pen Defaults

### 2a. Add nib defaults to `PaperSettings`

**File: `src/settings/PaperSettings.ts`**

```typescript
export interface PaperSettings {
  // ... existing fields ...

  // Fountain pen
  defaultNibAngle: number;       // Radians (default: Math.PI / 6 ≈ 30°)
  defaultNibThickness: number;   // Ratio 0-1 (default: 0.25)
  useBarrelRotation: boolean;    // Use Apple Pencil Pro twist for nib angle
}
```

```typescript
export const DEFAULT_SETTINGS: PaperSettings = {
  // ... existing defaults ...
  defaultNibAngle: Math.PI / 6,    // 30 degrees
  defaultNibThickness: 0.25,       // 4:1 aspect ratio
  useBarrelRotation: true,
};
```

### 2b. Add fountain pen section to `PaperSettingsTab`

**File: `src/settings/PaperSettingsTab.ts`**

Add a "Fountain pen" section after the existing pen defaults:

```typescript
// --- Fountain Pen Section ---
new Setting(containerEl).setName("Fountain pen").setHeading();

new Setting(containerEl)
  .setName("Default nib angle")
  .setDesc("Angle of the italic nib in degrees (0° = horizontal, 90° = vertical)")
  .addText((text) => {
    text.setValue(String(Math.round(this.settings.defaultNibAngle * 180 / Math.PI)));
    text.onChange((value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num) && num >= 0 && num <= 90) {
        this.settings.defaultNibAngle = num * Math.PI / 180;
        this.notifyChange();
      }
    });
  });

new Setting(containerEl)
  .setName("Default nib thickness")
  .setDesc("Aspect ratio of the nib (0.1 = very flat italic, 1.0 = square)")
  .addText((text) => {
    text.setValue(String(this.settings.defaultNibThickness));
    text.onChange((value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num) && num >= 0.05 && num <= 1) {
        this.settings.defaultNibThickness = num;
        this.notifyChange();
      }
    });
  });

new Setting(containerEl)
  .setName("Use barrel rotation")
  .setDesc("Apple Pencil Pro: twist the pencil to change nib angle dynamically")
  .addToggle((toggle) => {
    toggle.setValue(this.settings.useBarrelRotation);
    toggle.onChange((value: boolean) => {
      this.settings.useBarrelRotation = value;
      this.notifyChange();
    });
  });
```

### 2c. Wire settings into PaperView

**File: `src/view/PaperView.ts`**

Add runtime state fields and update `setSettings()`:

```typescript
// New state fields
private currentNibAngle = Math.PI / 6;
private currentNibThickness = 0.25;
private useBarrelRotation = true;

setSettings(settings: PaperSettings): void {
  this.settings = settings;
  this.currentPenType = settings.defaultPenType;
  this.currentColorId = settings.defaultColorId;
  this.currentWidth = settings.defaultWidth;
  // NEW
  this.currentNibAngle = settings.defaultNibAngle;
  this.currentNibThickness = settings.defaultNibThickness;
  this.useBarrelRotation = settings.useBarrelRotation;
  // Update palette
  this.toolPalette?.setPenType(settings.defaultPenType);
  this.toolPalette?.setWidth(settings.defaultWidth);
  this.toolPalette?.setNibAngle(settings.defaultNibAngle);
  this.toolPalette?.setNibThickness(settings.defaultNibThickness);
}
```

---

## Phase 3: ToolPalette — Runtime Nib Controls

### 3a. Extend `ToolPaletteState` and `ToolPaletteCallbacks`

**File: `src/view/ToolPalette.ts`**

```typescript
export interface ToolPaletteState {
  activeTool: ActiveTool;
  penType: PenType;
  colorId: string;
  width: number;
  // NEW
  nibAngle: number;       // Radians
  nibThickness: number;   // Ratio 0-1
}

export interface ToolPaletteCallbacks {
  onToolChange: (tool: ActiveTool) => void;
  onPenTypeChange: (penType: PenType) => void;
  onColorChange: (colorId: string) => void;
  onWidthChange: (width: number) => void;
  // NEW
  onNibAngleChange: (angle: number) => void;
  onNibThicknessChange: (thickness: number) => void;
}
```

### 3b. Add nib controls to ToolPalette

Add a "nib settings" row that appears only when the fountain pen (or a future directional pen) is selected.

```
[ Width slider: ====○======== 6.0 ]   ← existing, always visible
[ Nib angle:    ====○======== 30°  ]   ← NEW, fountain pen only
[ Nib aspect:   ====○======== 0.25 ]   ← NEW, fountain pen only
```

Implementation in `ToolPalette.build()`:

```typescript
// Nib settings row (fountain pen only)
this.nibRow = this.el.createEl("div", { cls: "paper-tool-row paper-nib-row" });

// Nib angle slider (0-90 degrees, displayed in degrees)
const nibAngleLabel = this.nibRow.createEl("span", {
  cls: "paper-nib-label",
  text: "Angle",
});
this.nibAngleSlider = this.nibRow.createEl("input", {
  cls: "paper-nib-slider",
  type: "range",
  attr: { min: "0", max: "90", step: "1", value: String(Math.round(this.state.nibAngle * 180 / Math.PI)) },
});
this.nibAngleValue = this.nibRow.createEl("span", {
  cls: "paper-nib-value",
  text: `${Math.round(this.state.nibAngle * 180 / Math.PI)}°`,
});

this.nibAngleSlider.addEventListener("input", () => {
  const degrees = parseFloat(this.nibAngleSlider!.value);
  const radians = degrees * Math.PI / 180;
  this.state.nibAngle = radians;
  this.nibAngleValue!.textContent = `${Math.round(degrees)}°`;
  this.callbacks.onNibAngleChange(radians);
});

// Nib thickness slider (0.05-1.0)
const nibThicknessLabel = this.nibRow.createEl("span", {
  cls: "paper-nib-label",
  text: "Aspect",
});
this.nibThicknessSlider = this.nibRow.createEl("input", {
  cls: "paper-nib-slider",
  type: "range",
  attr: { min: "0.05", max: "1.0", step: "0.05", value: String(this.state.nibThickness) },
});
this.nibThicknessValue = this.nibRow.createEl("span", {
  cls: "paper-nib-value",
  text: this.state.nibThickness.toFixed(2),
});

this.nibThicknessSlider.addEventListener("input", () => {
  const thickness = parseFloat(this.nibThicknessSlider!.value);
  this.state.nibThickness = thickness;
  this.nibThicknessValue!.textContent = thickness.toFixed(2);
  this.callbacks.onNibThicknessChange(thickness);
});
```

### 3c. Show/hide nib row based on pen type

Update `updateToolButtonState()` to toggle visibility:

```typescript
private updateToolButtonState(): void {
  // ... existing tool button logic ...
  // Show nib controls only for pens with nib properties
  const penConfig = getPenConfig(this.state.penType);
  const hasNib = penConfig.nibAngle !== null;
  this.nibRow?.toggleVisibility(isPen && hasNib);
}
```

When pen type changes (via `onPenTypeChange`), refresh nib row visibility.

### 3d. Public setters

```typescript
setNibAngle(angle: number): void {
  this.state.nibAngle = angle;
  if (this.nibAngleSlider) this.nibAngleSlider.value = String(Math.round(angle * 180 / Math.PI));
  if (this.nibAngleValue) this.nibAngleValue.textContent = `${Math.round(angle * 180 / Math.PI)}°`;
}

setNibThickness(thickness: number): void {
  this.state.nibThickness = thickness;
  if (this.nibThicknessSlider) this.nibThicknessSlider.value = String(thickness);
  if (this.nibThicknessValue) this.nibThicknessValue.textContent = thickness.toFixed(2);
}
```

### 3e. Wire callbacks in PaperView

**File: `src/view/PaperView.ts`**

```typescript
private createToolPaletteCallbacks(): ToolPaletteCallbacks {
  return {
    // ... existing callbacks ...
    onNibAngleChange: (angle: number) => {
      this.currentNibAngle = angle;
    },
    onNibThicknessChange: (thickness: number) => {
      this.currentNibThickness = thickness;
    },
  };
}
```

Also update `onPenTypeChange` to reset nib values to defaults when switching to fountain pen:

```typescript
onPenTypeChange: (penType: PenType) => {
  this.currentPenType = penType;
  const config = getPenConfig(penType);
  this.currentWidth = config.baseWidth;
  this.toolPalette?.setWidth(config.baseWidth);
  // Reset nib to defaults when switching pen types
  if (config.nibAngle !== null) {
    this.currentNibAngle = this.settings.defaultNibAngle;
    this.currentNibThickness = this.settings.defaultNibThickness;
    this.toolPalette?.setNibAngle(this.currentNibAngle);
    this.toolPalette?.setNibThickness(this.currentNibThickness);
  }
},
```

---

## Phase 4: Update PenEngine Width Computation

**File: `src/stroke/PenEngine.ts`**

### 4a. Optimize `computeFountainWidth()`

Replace the ellipse projection with the flat nib (cross-product) formula:

```typescript
function computeFountainWidth(
  baseWidth: number,
  nibThickness: number,
  nibAngle: number,
  strokeDx: number,      // raw dx (not an angle)
  strokeDy: number,      // raw dy
  pressure: number
): number {
  const len = Math.hypot(strokeDx, strokeDy);
  if (len < 0.001) return baseWidth * nibThickness; // fallback to min width

  const sx = strokeDx / len;
  const sy = strokeDy / len;

  // Precomputed nib unit vector (caller should cache for fixed angle)
  const nx = Math.cos(nibAngle);
  const ny = Math.sin(nibAngle);

  // |sin(nibAngle - strokeAngle)| via 2D cross product
  const crossMag = Math.abs(nx * sy - ny * sx);

  const W = baseWidth;                    // major axis (nib edge width)
  const H = baseWidth * nibThickness;     // minor axis (nib thickness)

  // Flat nib projection
  const projectedWidth = W * crossMag + H * (1 - crossMag);

  // Apply pressure modulation
  return projectedWidth * lerp(0.5, 1.0, pressure);
}
```

### 4b. Update `computePointAttributes()` call site

Change the fountain pen branch to pass `dx, dy` instead of computing `strokeAngle`:

```typescript
if (config.nibAngle !== null && config.nibThickness !== null) {
  const dx = prevPoint ? point.x - prevPoint.x : 0;
  const dy = prevPoint ? point.y - prevPoint.y : 0;

  const effectiveNibAngle =
    config.useBarrelRotation && point.twist !== 0
      ? (point.twist * Math.PI) / 180
      : config.nibAngle;

  width = computeFountainWidth(
    config.baseWidth,
    config.nibThickness,
    effectiveNibAngle,
    dx, dy,
    effectivePressure
  );
}
```

---

## Phase 5: Custom Italic Outline Generator

**New file: `src/stroke/ItalicOutlineGenerator.ts`**

A self-contained module that generates an outline polygon from stroke points using per-point nib-projected widths. Produces the same `number[][]` output format as `perfect-freehand` so it slots directly into the existing `outlineToPath2D()` → `Path2D` → `ctx.fill()` pipeline.

### Core Interface

```typescript
export interface ItalicNibConfig {
  nibWidth: number;        // Major axis (base stroke width)
  nibHeight: number;       // Minor axis (nibWidth * nibThickness)
  nibAngle: number;        // Radians, from PenConfig or barrel rotation
  useBarrelRotation: boolean;
  pressureCurve: number;   // Gamma exponent
  pressureWidthRange: [number, number];
  widthSmoothing: number;  // 0-1, controls EMA blend for width transitions
  taperStart: number;      // Taper distance at stroke start (world units)
  taperEnd: number;        // Taper distance at stroke end (world units)
}

export function generateItalicOutline(
  points: readonly StrokePoint[],
  config: ItalicNibConfig
): number[][]
```

### Algorithm

1. **Per-point width computation:**
   - Compute stroke direction vector from consecutive points (`p[i] - p[i-1]`, using `p[i+1] - p[i]` for the first point)
   - Precompute nib unit vector from `config.nibAngle` (or per-point from `twist` if `useBarrelRotation`)
   - Cross-product projection: `crossMag = |nx*sy - ny*sx|`
   - Raw width: `nibWidth * crossMag + nibHeight * (1 - crossMag)`
   - Apply pressure: `width *= lerp(minW, maxW, pressure^gamma)`
   - Temporal smoothing: EMA with `prevWidth * (1 - α) + rawWidth * α` where `α = widthSmoothing`
   - Minimum floor: `max(nibHeight * 0.5, smoothedWidth)` — never go below half the nib thickness
   - Start/end taper: scale width by `min(1, runningLength / taperStart)` at start, `min(1, remainingLength / taperEnd)` at end

2. **Offset path construction:**
   - For each point, compute perpendicular normal to stroke direction: `perpX = -sy, perpY = sx`
   - Left offset: `(x + perpX * halfWidth, y + perpY * halfWidth)`
   - Right offset: `(x - perpX * halfWidth, y - perpY * halfWidth)`
   - Accumulate into `leftSide[]` and `rightSide[]` arrays

3. **Join handling:**
   - Use bevel joins: connect consecutive offset points with straight segments (this is implicit when the polygon is filled as a single path)
   - No special handling needed — the polygon fill operation inherently handles this

4. **Output:**
   - Return `[...leftSide, ...rightSide.reverse()]` — the same closed polygon format that `outlineToPath2D()` expects

### Edge Cases

- **Single point (dot):** Return a small filled circle approximation (8-point polygon at `nibHeight` radius)
- **Two points:** Generate a simple quad
- **Near-zero-length segments:** Skip, carry forward previous width and perpendicular
- **Direction reversal:** The width smoothing EMA prevents abrupt jumps; the bevel join fills gaps

---

## Phase 6: Integration into OutlineGenerator

**File: `src/stroke/OutlineGenerator.ts`**

### 6a. Update `generateOutline()` to route fountain pen

The key change: read `nibAngle` and `nibThickness` from the **`PenStyle`** (per-stroke values set by the user) with `PenConfig` as fallback. This ensures each stroke renders with the nib settings it was drawn at, not the current global config.

```typescript
import { generateItalicOutline, type ItalicNibConfig } from "./ItalicOutlineGenerator";
import { getPenConfig } from "./PenConfigs";

export function generateOutline(
  points: readonly StrokePoint[],
  style: PenStyle
): number[][] {
  if (points.length === 0) return [];

  const penConfig = getPenConfig(style.pen);

  // Fountain pen: use italic outline generator
  // Read nib params from style (per-stroke) with PenConfig fallback
  const nibAngle = style.nibAngle ?? penConfig.nibAngle;
  const nibThickness = style.nibThickness ?? penConfig.nibThickness;

  if (nibAngle !== null && nibThickness !== null) {
    const italicConfig: ItalicNibConfig = {
      nibWidth: style.width,
      nibHeight: style.width * nibThickness,
      nibAngle: nibAngle,
      useBarrelRotation: penConfig.useBarrelRotation,
      pressureCurve: penConfig.pressureCurve,
      pressureWidthRange: penConfig.pressureWidthRange,
      widthSmoothing: 0.4,
      taperStart: penConfig.taperStart,
      taperEnd: penConfig.taperEnd,
    };
    return generateItalicOutline(points, italicConfig);
  }

  // All other pen types: perfect-freehand
  const options = penStyleToOutlineOptions(style);
  const input = pointsToFreehandInput(points);
  return getStroke(input, { ... });
}
```

This is a clean branching point — no changes to perfect-freehand usage for other pen types. The output format is identical, so `outlineToPath2D()`, `generateStrokePath()`, and all Renderer code work unchanged.

### 6b. BBox expansion

The italic nib can produce wider strokes than `style.width` alone suggests (when perpendicular to the nib). The existing bbox computation uses `style.width / 2` and `style.width` equals the max possible nib width (the major axis).

No change needed here — the existing bbox already covers the maximum italic width.

---

## Phase 7: Nib-Shaped Hover Cursor

### 7a. Update `HoverCursorConfig`

**File: `src/input/HoverCursor.ts`**

Add nib properties to the config:

```typescript
export interface HoverCursorConfig {
  colorId: string;
  width: number;
  isDarkMode: boolean;
  isEraser: boolean;
  zoom: number;
  // New: nib shape for fountain pen
  nibThickness: number | null;  // ratio (minor/major), null = circle cursor
  nibAngle: number | null;      // radians, null = no rotation
}
```

### 7b. Update `HoverCursor.show()`

When `nibThickness` is not null, render as a rotated rectangle instead of a circle:

```typescript
show(x: number, y: number, config: HoverCursorConfig): void {
  if (config.isEraser) {
    // ... existing eraser logic unchanged ...
  } else if (config.nibThickness !== null && config.nibAngle !== null) {
    // Nib cursor: rotated rectangle
    const nibWidth = Math.max(2, config.width * config.zoom);
    const nibHeight = Math.max(1, nibWidth * config.nibThickness);
    const angleDeg = (config.nibAngle * 180) / Math.PI;

    this.el.addClass("paper-hover-cursor--nib");
    this.el.removeClass("paper-hover-cursor--pen");
    this.el.removeClass("paper-hover-cursor--eraser");

    this.el.setCssProps({
      "--cursor-width": `${nibWidth}px`,
      "--cursor-height": `${nibHeight}px`,
      "--cursor-x": `${x - nibWidth / 2}px`,
      "--cursor-y": `${y - nibHeight / 2}px`,
      "--cursor-rotation": `${angleDeg}deg`,
      "--cursor-color": resolveColor(config.colorId, config.isDarkMode),
      "--cursor-border": resolveColor(config.colorId, config.isDarkMode),
    });
  } else {
    // ... existing pen circle logic unchanged ...
  }
  // ... visibility toggle ...
}
```

### 7c. CSS additions

**File: `styles.css`**

```css
.paper-hover-cursor--nib {
  border-radius: 1px;
  width: var(--cursor-width, 4px);
  height: var(--cursor-height, 2px);
  transform: translateZ(0) rotate(var(--cursor-rotation, 0deg));
  background-color: var(--cursor-color);
}
```

### 7d. Update PaperView hover callback

**File: `src/view/PaperView.ts`**

Pass nib config from runtime state (user-adjustable values, not hardcoded PenConfig):

```typescript
onHover: (x: number, y: number) => {
  const penConfig = getPenConfig(this.currentPenType);
  const hasNib = penConfig.nibAngle !== null;
  this.hoverCursor?.show(x, y, {
    colorId: this.currentColorId,
    width: this.currentWidth,
    isDarkMode: this.themeDetector?.isDarkMode ?? false,
    isEraser: this.activeTool === "eraser",
    zoom: this.camera.zoom,
    nibThickness: hasNib ? this.currentNibThickness : null,
    nibAngle: hasNib ? this.currentNibAngle : null,
  });
},
```

---

## Phase 8: Tests

### 8a. `src/stroke/ItalicOutlineGenerator.test.ts`

- **Width projection math:** Verify that stroke perpendicular to nib edge → max width, parallel → min width
- **Pressure scaling:** Higher pressure → wider stroke
- **Barrel rotation:** When twist != 0 and useBarrelRotation = true, nib angle follows twist
- **Width smoothing:** Consecutive points with abrupt direction change → width transitions smoothly
- **Taper:** First/last points have reduced width
- **Single point → valid polygon**
- **Output format:** Returns array of [x,y] pairs forming a closed polygon
- **Minimum width floor:** Never produces zero-width geometry

### 8b. `src/stroke/PenEngine.test.ts` updates

- Update existing `computeFountainWidth` tests for new function signature (dx/dy instead of strokeAngle)
- Verify cross-product formula matches expected values at key angles (0°, 45°, 90°)

### 8c. `src/input/HoverCursor.test.ts` updates

- Verify nib cursor mode sets correct CSS properties (width, height, rotation)
- Verify non-nib pens still show circular cursor
- Verify eraser still shows eraser cursor

### 8d. `src/view/ToolPalette.test.ts` updates

- Verify nib controls appear when fountain pen is selected
- Verify nib controls are hidden for non-fountain pen types
- Verify nib angle slider updates state and fires callback (degrees ↔ radians conversion)
- Verify nib thickness slider updates state and fires callback

### 8e. `src/document/Serializer.test.ts` updates

- Verify nibAngle and nibThickness round-trip through serialize/deserialize
- Verify old documents without nib fields deserialize correctly (fields undefined)
- Verify nib fields are omitted from serialized output when not present

---

## Files Changed Summary

| File | Change |
|---|---|
| `src/types.ts` | Add `nibAngle?` and `nibThickness?` to `PenStyle` and `SerializedPenStyle` |
| `src/document/Serializer.ts` | Serialize/deserialize nib fields |
| `src/settings/PaperSettings.ts` | Add `defaultNibAngle`, `defaultNibThickness`, `useBarrelRotation` |
| `src/settings/PaperSettingsTab.ts` | Add fountain pen settings section |
| `src/view/ToolPalette.ts` | Add nib angle/thickness sliders (fountain pen only) |
| `src/view/PaperView.ts` | Runtime nib state, wire callbacks, pass to hover cursor + style |
| `src/stroke/PenEngine.ts` | Update `computeFountainWidth()` to cross-product flat nib formula |
| `src/stroke/ItalicOutlineGenerator.ts` | **NEW** — Custom outline generator for directional nib pens |
| `src/stroke/ItalicOutlineGenerator.test.ts` | **NEW** — Tests |
| `src/stroke/OutlineGenerator.ts` | Route fountain pen to `generateItalicOutline()`, read nib from PenStyle |
| `src/input/HoverCursor.ts` | Add nib cursor mode (rotated rectangle) |
| `styles.css` | Add `.paper-hover-cursor--nib` styles + nib control styles |

No changes to: `PenConfigs.ts` (hardcoded defaults remain as fallbacks), `StrokeBuilder.ts`, `Renderer.ts`, or the rendering pipeline. The outline generator output format is unchanged so the entire Path2D → fill pipeline works without modification. No document version bump needed — nib fields are optional and old documents deserialize correctly.

---

## Implementation Order

1. **Phase 1**: Data model (`types.ts`, `Serializer.ts`) — foundation, no visible effect yet
2. **Phase 2-3**: Settings + ToolPalette — user can now adjust nib, values stored in runtime state
3. **Phase 4**: PenEngine optimization — improves the width formula (used by Phase 5)
4. **Phase 5**: ItalicOutlineGenerator + tests — core rendering module, buildable and testable in isolation
5. **Phase 6**: OutlineGenerator integration — wires fountain pen to new generator (makes it live)
6. **Phase 7**: HoverCursor nib shape — visual polish, independent of stroke rendering
7. **Phase 8**: Remaining tests

Phases 1-3 (data/UI) and Phases 4-5 (engine) can be developed in parallel. Phase 6 depends on both tracks. Phase 7 is independent.
