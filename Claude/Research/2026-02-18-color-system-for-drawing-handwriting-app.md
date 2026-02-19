# Color System for a Drawing/Handwriting App with Light & Dark Canvas Support

**Date:** 2026-02-18
**Scope:** Research into color palettes, light/dark mode pairing, color representation, custom color pickers, and Obsidian theming integration for ObsidianPaper.

---

## 1. Light/Dark Safe Color Pairs

### The Core Problem

A handwriting app must display ink strokes that remain legible regardless of whether the canvas background is light (e.g., white or cream) or dark (e.g., near-black or dark gray). A pure black pen on a white canvas is the classic default, but that same black pen is invisible on a dark canvas. The same applies to many colors: a bright yellow that works as a highlighter on white paper becomes invisible on a dark background.

### Approaches Used by Note-Taking Apps

#### GoodNotes
- Provides a fixed palette of ~12-18 preset colors arranged in two rows.
- Default pen colors include: black, dark gray, white, red, orange, yellow, green, blue, purple, pink, and brown.
- When the user switches to a dark paper template, GoodNotes does **not** automatically remap colors. Instead, it provides a white pen as a default, and users manually select light-colored pens.
- The "black" pen writes black regardless of background; it is the user's responsibility to pick visible colors.
- Custom colors are supported via a full color wheel picker.

#### Notability
- Offers a configurable color palette with ~12 default slots.
- Default colors: black, dark blue, red, green, purple, orange, pink, brown, gray, teal, and two user-customizable slots.
- Like GoodNotes, Notability does **not** automatically swap colors when the paper color changes.
- Users select their own colors, with a custom picker available.
- The app provides "dark mode" paper templates but color selection remains manual.

#### Apple Notes
- Extremely simple: approximately 5-8 pen colors.
- Default set: black, blue, green, yellow, red (plus sometimes orange, purple).
- In dark mode (system-level), the Apple Notes canvas background becomes dark, and the pen colors shift:
  - Black becomes white automatically.
  - Other colors shift to lighter/more vibrant versions.
- Apple Notes is the most notable example of **automatic color adaptation**: it maps pen colors to a dark-mode equivalent behind the scenes.

#### CollaNote / Nebo / Samsung Notes
- CollaNote offers ~12 default colors with a full picker.
- Nebo provides semantic pen types (pen, highlighter, eraser) with fixed color sets.
- Samsung Notes provides paired palettes for light/dark paper.

### Strategy: Paired Colors (Automatic Switching)

The Apple Notes approach of automatic color adaptation is the most user-friendly for an Obsidian plugin, since Obsidian itself switches between light and dark themes. The recommended approach:

**Define each "logical" color as a pair:**

| Logical Color | Light Mode Value      | Dark Mode Value       | Notes                          |
|---------------|----------------------|----------------------|--------------------------------|
| Black/Default | `#1a1a1a` (near-black) | `#e8e8e8` (near-white) | Primary writing color          |
| Dark Gray     | `#4a4a4a`            | `#b8b8b8`            | Secondary writing color        |
| Red           | `#d32f2f`            | `#ef5350`            | Slightly brighter for dark bg  |
| Orange        | `#e65100`            | `#ff9800`            | Warmer/lighter for dark bg     |
| Yellow        | `#f9a825`            | `#ffee58`            | Much lighter for dark bg       |
| Green         | `#2e7d32`            | `#66bb6a`            | Lighter green for dark bg      |
| Blue          | `#1565c0`            | `#42a5f5`            | Lighter blue for dark bg       |
| Purple        | `#6a1b9a`            | `#ab47bc`            | Lighter purple for dark bg     |
| Pink          | `#c2185b`            | `#ec407a`            | Lighter pink for dark bg       |
| Brown         | `#5d4037`            | `#a1887f`            | Lighter brown for dark bg      |
| Teal          | `#00695c`            | `#4db6ac`            | Lighter teal for dark bg       |
| White         | `#f5f5f5` (near-white) | `#2a2a2a` (near-black) | Inverse of default             |

**Key principles for paired colors:**

1. **Maintain similar perceived contrast.** The light-mode color on a white background should have roughly the same contrast ratio as the dark-mode color on the dark background. WCAG contrast ratio tools can help validate this.

2. **Preserve hue identity.** Red should still look red; only the lightness/saturation shifts. In HSL terms, keep the hue (H) the same or very close, and adjust lightness (L) and saturation (S).

3. **Avoid pure black (#000000) and pure white (#FFFFFF).** Near-black (`#1a1a1a`) and near-white (`#e8e8e8`) are softer and more natural for handwriting.

4. **Highlighter colors need special treatment.** A yellow highlighter on white paper uses ~20-30% opacity. On dark paper, the same semi-transparent yellow becomes nearly invisible. Solutions:
   - Use a different highlighter color pair (e.g., bright yellow on light, soft amber on dark).
   - Adjust opacity: ~25% on light, ~40% on dark.
   - Or use a "lighten" blend mode on light backgrounds and a "screen" blend mode on dark backgrounds.

### Colors That Work Well on Both Backgrounds (Without Pairing)

Some "middle-lightness" colors are naturally visible on both light and dark backgrounds. These are colors with HSL lightness roughly between 40-60%:

- **Medium red:** `hsl(0, 70%, 50%)` = `#d92626`
- **Medium blue:** `hsl(220, 70%, 50%)` = `#2662d9`
- **Medium green:** `hsl(140, 60%, 40%)` = `#298a47`
- **Medium purple:** `hsl(280, 60%, 50%)` = `#8c33cc`
- **Medium orange:** `hsl(25, 80%, 50%)` = `#e67a17`
- **Medium teal:** `hsl(180, 60%, 40%)` = `#298a8a`
- **Medium pink:** `hsl(340, 70%, 50%)` = `#d92672`

These colors have enough contrast against both white (~#FFFFFF) and dark (~#1e1e1e) backgrounds. The tradeoff: they may not look as natural or refined as purpose-paired colors. On a light background, they appear slightly washed out; on a dark background, slightly muted.

---

## 2. Default Color Palettes for Handwriting Apps

### Industry Survey: Default Palette Sizes

| App              | Default Colors | Custom Support | Organization       |
|------------------|---------------|----------------|-------------------|
| GoodNotes 5/6    | 12-18         | Yes (wheel)    | 2 rows, grouped   |
| Notability       | 12            | Yes (wheel)    | Single row        |
| Apple Notes      | 5-8           | No             | Single row        |
| Samsung Notes    | 12            | Yes (palette)  | Single row        |
| CollaNote        | 12            | Yes (wheel)    | Single row        |
| Nebo             | 8             | Yes (picker)   | Single row        |
| OneNote          | 16            | Yes (RGB)      | Grid (4x4)        |
| Procreate        | Unlimited     | Yes (disc/pal) | Customizable       |

### Recommended Default Palette: 10 Colors

Based on commonalities across apps, the sweet spot for a writing-focused app is **8-12 colors**. A 10-color default palette provides coverage without overwhelming the toolbar:

**Primary Row (pen colors):**
1. **Black** (or near-black) -- the default
2. **Dark Gray** -- secondary writing, lighter notes
3. **Red** -- emphasis, corrections, grading
4. **Blue** -- headings, links, secondary emphasis
5. **Green** -- highlights, checkmarks, positive annotations
6. **Orange** -- warm emphasis, bullet points
7. **Purple** -- categories, creative work
8. **Pink** -- personal notes, romantic categorization
9. **Brown** -- organic, vintage aesthetic
10. **Teal** -- technical, cool-toned accent

**Highlighter Row (separate, 4-5 colors):**
1. **Yellow** -- classic highlight
2. **Green** -- secondary highlight
3. **Blue** -- tertiary highlight
4. **Pink** -- quaternary highlight
5. **Orange** -- additional highlight

### Color Organization Patterns

1. **Grayscale-first, then rainbow:** Black, grays, then ROYGBIV order. Most common in note-taking apps.
2. **Warm-to-cool:** Reds/oranges first, then yellows/greens, then blues/purples. Used by some art apps.
3. **Frequency-of-use:** Most commonly used colors first (black, red, blue, green, etc.). Practical for handwriting.
4. **Semantic grouping:** Writing colors vs. highlighting colors vs. decoration colors. Useful if the UI has separate tool categories.

**Recommendation:** Grayscale-first, then rainbow order. This matches user expectations from nearly every note-taking app and provides a predictable, scannable layout.

---

## 3. Color Representation

### HSL vs RGB vs Hex for Storage

| Format | Pros | Cons | Best For |
|--------|------|------|----------|
| **Hex** (`#d32f2f`) | Compact, universal, easy to serialize. Obsidian's `ColorComponent` uses `HexString` as its primary type. | Not human-readable for color manipulation. No native alpha channel (need 8-digit hex). | Storage, serialization, interchange. |
| **RGB** (`{r:211, g:47, b:47}`) | Obsidian provides `RGB` interface. Direct mapping to canvas rendering. Easy alpha extension (RGBA). | Difficult to reason about perceptually. Hard to "lighten" or "shift" a color intuitively. | Canvas rendering, Obsidian API compatibility. |
| **HSL** (`{h:0, s:70, l:50}`) | Obsidian provides `HSL` interface. Intuitive for generating color pairs (same H, adjust S/L). Easy to create harmonious palettes. Human-readable. | Perceptually non-uniform (same L change looks different across hues). Requires conversion for canvas. | Color pair generation, palette design, UI sliders. |

### Recommendation: HSL for Definition, Hex for Storage

**Define color pairs in HSL** because it makes the light/dark pair relationship explicit and easy to adjust:

```
// Conceptual structure (not code -- for illustration only)
{
  name: "Red",
  light: { h: 0, s: 75, l: 38 },  // darker red for light bg
  dark:  { h: 0, s: 75, l: 60 },   // lighter red for dark bg
}
```

The hue stays the same; only lightness (and sometimes saturation) changes. This makes the system predictable and maintainable.

**Store as hex strings** in settings/persistence because:
- Obsidian's `ColorComponent` natively works with `HexString`.
- Hex is compact and universally understood.
- JSON serialization is trivial.

**Convert to RGB/RGBA at render time** because:
- Canvas 2D context uses `rgba()` strings or `ctx.strokeStyle = '#rrggbb'`.
- Alpha channel for highlighters needs RGBA.

### Obsidian's Built-in Color Types

From the Obsidian API (`obsidian.d.ts`):

```typescript
// Already defined in Obsidian's types:
type HexString = string;  // e.g., "#d32f2f"

interface RGB {
  r: number;  // 0-255
  g: number;  // 0-255
  b: number;  // 0-255
}

interface HSL {
  h: number;  // 0-360
  s: number;  // 0-100
  l: number;  // 0-100
}
```

The `ColorComponent` class provides:
- `getValue(): HexString`
- `getValueRgb(): RGB`
- `getValueHsl(): HSL`
- `setValue(value: HexString): this`
- `setValueRgb(rgb: RGB): this`
- `setValueHsl(hsl: HSL): this`

This means we can use Obsidian's own types and avoid defining our own color interfaces.

### Defining Color Pairs

A proposed data structure for a paired color:

```
PairedColor {
  id: string           // unique identifier, e.g., "red"
  name: string         // display name, e.g., "Red"
  light: HexString     // color for light canvas, e.g., "#d32f2f"
  dark: HexString      // color for dark canvas, e.g., "#ef5350"
}
```

At runtime, the active color is resolved based on the current theme:

```
resolveColor(pair: PairedColor, isDarkMode: boolean): HexString {
  return isDarkMode ? pair.dark : pair.light;
}
```

### Opacity/Alpha Handling for Highlighters

Highlighters are fundamentally different from pens:
- They use **semi-transparent** color (typically 20-40% opacity).
- They should use a **destination-over** or **multiply** composite operation so they appear behind existing strokes.
- Their color definition should include an alpha value or a separate opacity field.

Proposed approach:

```
HighlighterColor {
  id: string
  name: string
  light: HexString      // base color (fully opaque)
  dark: HexString        // base color for dark mode
  lightOpacity: number   // e.g., 0.25
  darkOpacity: number    // e.g., 0.40 (higher because dark bg absorbs more)
}
```

At render time, the hex color is combined with the opacity to produce an RGBA string:

```
// Conceptual: "#ffee58" at 0.25 opacity -> "rgba(255, 238, 88, 0.25)"
```

**Why separate opacities for light and dark?** On a dark background, semi-transparent colors appear less vibrant because there is less background light to show through. Increasing opacity by ~10-15 percentage points on dark backgrounds compensates for this.

---

## 4. Custom Color Picker Approaches

### Standard Web Color Picker Patterns

There are several established patterns for color pickers in web/hybrid apps:

#### 1. Native HTML `<input type="color">`
- Renders the OS-native color picker dialog.
- Pros: Zero implementation effort, familiar to users, accessible.
- Cons: No alpha/opacity control, appearance varies by OS, limited customization.
- **Verdict:** Too limited for a drawing app that needs opacity control.

#### 2. Obsidian's Built-in `ColorComponent`
- Available via `Setting.addColorPicker()`.
- Provides hex, RGB, and HSL get/set methods.
- Pros: Consistent with Obsidian's design language. Already available in the API.
- Cons: Designed for settings UI, not for inline toolbar use. No opacity slider.
- **Verdict:** Good for settings/preferences, not suitable as the primary in-canvas color picker.

#### 3. Custom HSL/HSV Color Picker (Recommended for In-Canvas Use)
A typical custom color picker UI consists of:
- **Saturation/Brightness area:** A 2D square or rectangle. X-axis = saturation, Y-axis = brightness (or lightness). The user drags a circle indicator within this area.
- **Hue slider:** A horizontal or vertical bar showing the full hue spectrum (0-360). The user drags a handle along it.
- **Opacity slider:** A horizontal bar from transparent to opaque. Essential for highlighters.
- **Hex input:** A text field showing the current hex value, editable for precise entry.
- **Preset swatches:** Quick-access to palette colors and recently used colors.

This is the pattern used by Figma, Canva, and most modern design tools.

#### 4. Color Wheel + Lightness Slider
- A circular hue wheel with a lightness/saturation triangle or square inside.
- Used by Procreate, some versions of GoodNotes.
- More complex to implement but visually appealing and intuitive for artists.
- **Verdict:** Over-engineered for a handwriting/note-taking app.

### Recommendation

For ObsidianPaper, a **two-tier approach**:

**Tier 1 -- Quick Palette (always visible in toolbar):**
- A row of ~10 circular color swatches (the default palette).
- Tap a swatch to select it. Active swatch has a visual indicator (ring, checkmark, or size increase).
- A "+" button or a "custom" swatch at the end to open the full picker.

**Tier 2 -- Full Color Picker (modal/popover on demand):**
- HSV/HSL 2D picker area + hue bar + opacity slider.
- Hex/RGB input fields.
- A row of "recent colors" (last 5-8 colors used).
- A "Save to palette" button that adds the color to the user's custom palette.
- A "Color pair" toggle: if the user is in dark mode, they can also set the light-mode equivalent (and vice versa), so custom colors are also paired.

### Letting Users Add Custom Colors to the Palette

**Data model for custom palette:**

```
UserPalette {
  colors: PairedColor[]    // User's saved colors (max ~20-24)
}
```

**Interaction flow:**
1. User opens full picker, selects a color.
2. User taps "Add to Palette" button.
3. The color is appended to their custom palette row.
4. If in "paired" mode, the user is prompted to also set the alternate-theme color (or it is auto-generated by inverting lightness in HSL).

**Auto-generating the paired color:**
Given a user-picked color in HSL, a reasonable dark-mode equivalent can be generated:
- Keep H (hue) the same.
- Keep S (saturation) the same or slightly increase.
- Invert L (lightness): `darkL = 100 - lightL` (with clamping). A more nuanced formula: `darkL = max(30, min(80, 100 - lightL + 10))`.

This auto-pairing gives the user a starting point they can fine-tune.

### Saving Custom Palettes

Custom palettes should be persisted via Obsidian's `plugin.saveData()` / `plugin.loadData()` mechanism. The data structure stored:

```
PluginSettings {
  // ... other settings
  customPalette: PairedColor[]
  recentColors: HexString[]  // last N colors used (simple hex, not paired)
  highlighterOpacity: { light: number, dark: number }
}
```

This integrates naturally with Obsidian's plugin data persistence (stored as `data.json` in the plugin folder).

---

## 5. Obsidian Theming: Light/Dark Mode Detection and Response

### How Obsidian Handles Light/Dark Mode

Obsidian uses a **CSS class-based theming system**:

- The `<body>` element receives the class `theme-dark` or `theme-light` depending on the active theme.
- Obsidian defines a comprehensive set of **CSS custom properties** (variables) that change values based on the theme. Plugins and themes override these variables.
- The user can switch themes via Settings > Appearance, and community themes can be installed.

**Key body classes:**
- `body.theme-dark` -- dark mode is active.
- `body.theme-light` -- light mode is active.
- `body.is-mobile` -- running on mobile (iPad).
- `body.is-phone` -- running on phone.
- `body.is-tablet` -- running on tablet.

### Detecting the Current Theme in a Plugin

**Method 1: Check the body class (simple, reliable)**

```typescript
function isDarkMode(): boolean {
  return document.body.classList.contains('theme-dark');
}
```

This is the most straightforward approach and is widely used by community plugins.

**Method 2: Read CSS variable values**

```typescript
function getBackgroundColor(): string {
  return getComputedStyle(document.body)
    .getPropertyValue('--background-primary')
    .trim();
}
```

This gives you the actual resolved color, which accounts for community themes that may use non-standard backgrounds.

**Method 3: Use `app.getTheme()` (undocumented/internal)**

Some community plugins reference `app.vault.getConfig('theme')` or similar internal APIs, but these are **not part of the public API** and may break with updates. Avoid this.

### Responding to Theme Changes

Obsidian fires a `css-change` event on the workspace whenever the theme changes (including switching between light/dark mode, changing community themes, or modifying CSS snippets).

From the Obsidian API type definitions:

```typescript
// In Workspace:
on(name: 'css-change', callback: () => any, ctx?: any): EventRef;
```

**Usage in a plugin:**

```typescript
// In onload():
this.registerEvent(
  this.app.workspace.on('css-change', () => {
    const dark = document.body.classList.contains('theme-dark');
    // Update canvas colors, re-render palette, etc.
    this.onThemeChanged(dark);
  })
);
```

This is the officially supported mechanism. The `registerEvent` call ensures the listener is automatically cleaned up when the plugin unloads.

### Key Obsidian CSS Variables for Color Reference

Obsidian provides many CSS variables that automatically adapt to light/dark mode. Relevant ones for a drawing/handwriting plugin:

**Background colors:**
- `--background-primary` -- main content background
- `--background-secondary` -- sidebar/secondary area background
- `--background-modifier-border` -- borders

**Text colors:**
- `--text-normal` -- primary text color
- `--text-muted` -- secondary/dimmed text
- `--text-faint` -- very subtle text
- `--text-on-accent` -- text on accent-colored backgrounds

**Accent/interactive:**
- `--interactive-accent` -- primary accent color (blue by default)
- `--interactive-accent-hover` -- hover state for accent

**Named colors (with `-rgb` variants for alpha use):**
- `--color-red` / `--color-red-rgb`
- `--color-orange` / `--color-orange-rgb`
- `--color-yellow` / `--color-yellow-rgb`
- `--color-green` / `--color-green-rgb`
- `--color-cyan` / `--color-cyan-rgb`
- `--color-blue` / `--color-blue-rgb`
- `--color-purple` / `--color-purple-rgb`
- `--color-pink` / `--color-pink-rgb`

As seen in the ObsidianWordsmith `styles.css`, the pattern for using these with alpha is:

```css
background-color: rgba(var(--color-red-rgb), 0.2);
color: var(--color-red);
```

These named colors automatically adjust their values between light and dark themes. They are excellent for UI elements (toolbar buttons, palette indicators) but should NOT be used as the actual ink/stroke color because:
1. They may not provide sufficient contrast on all backgrounds.
2. The handwriting strokes should have consistent, predictable colors, not theme-dependent UI colors.
3. When exporting or sharing notes, the stroke colors should be absolute, not theme-relative.

### Canvas Background Strategy

For the drawing canvas itself, there are two approaches:

**Approach A: Canvas follows Obsidian theme**
- Light mode: white/cream canvas background.
- Dark mode: dark gray/black canvas background.
- Pen colors swap automatically using the paired color system.
- Pro: Seamless integration with Obsidian's appearance.
- Con: Handwriting colors shift when switching themes, which may confuse users.

**Approach B: Canvas has its own background setting (independent of theme)**
- User explicitly selects canvas background (white, cream, dark, black, etc.).
- Pen colors are paired to the canvas background, not the Obsidian theme.
- Pro: Consistent writing experience regardless of theme. User controls the "paper" feel.
- Con: May look jarring if the canvas background mismatches the surrounding Obsidian UI.

**Approach C: Hybrid (Recommended)**
- Default: Canvas background follows Obsidian theme (Approach A).
- Setting available: "Lock canvas background" -- user can pin to light or dark regardless of theme.
- Pen colors always pair to the **canvas** background, not the Obsidian theme, so they remain correct even if the canvas is locked.

This hybrid approach respects the user's theme preference while allowing explicit control.

---

## 6. Implementation Considerations

### Stored Color vs. Rendered Color

A critical distinction for a handwriting app:

- **Stored color:** The color saved in the note's data. This should be **absolute** (e.g., `#d32f2f`) and should NOT change when the theme changes. The note's data represents what the user wrote.
- **Rendered color:** The color displayed on screen. This CAN be transformed at render time based on the current canvas background.

This means:
1. When the user picks "Red" and writes on a light canvas, the stroke data stores the light-mode red (`#d32f2f`).
2. When the same note is opened on a dark canvas, the renderer maps `#d32f2f` to its dark-mode equivalent (`#ef5350`) for display.
3. If the note is exported (to PNG, SVG, or PDF), the export uses the stored color appropriate for the export background.

This is analogous to how syntax highlighting works in code editors: the tokens are stored as-is, but the colors used to render them depend on the active color scheme.

### Color Mapping Table

At the core of the system is a mapping table:

```
Map<HexString, HexString>  // lightColor -> darkColor
```

For default palette colors, this mapping is defined at compile time. For custom colors, the mapping is stored in the user's palette data. For completely unknown colors (e.g., from an imported note), a **fallback algorithm** can auto-generate an approximate pair using HSL lightness inversion.

### Performance Considerations

- Color lookup should be O(1). A `Map` or plain object keyed by hex string is appropriate.
- Color conversion (hex to RGB, HSL to hex) should be done with simple math functions, not library calls.
- The palette UI re-render on theme change should be minimal -- just swapping displayed color values, not rebuilding the entire UI.

---

## 7. Summary of Recommendations

| Aspect | Recommendation |
|--------|---------------|
| **Palette size** | 10 pen colors + 4-5 highlighter colors |
| **Color organization** | Grayscale first, then rainbow (ROYGBIV) |
| **Storage format** | Hex strings (`HexString`) for persistence |
| **Working format** | HSL for palette design and color pair generation |
| **Render format** | RGB/RGBA for canvas operations |
| **Color pairing** | Each logical color has a light and dark variant; same hue, different lightness |
| **Theme detection** | `document.body.classList.contains('theme-dark')` |
| **Theme change response** | `workspace.on('css-change', callback)` |
| **Canvas background** | Default follows Obsidian theme; user can lock to light/dark |
| **Stored colors** | Absolute hex values; mapped at render time |
| **Custom color picker** | HSV 2D area + hue bar + opacity slider + hex input |
| **Custom palette persistence** | `plugin.saveData()` with `PairedColor[]` array |
| **Highlighter opacity** | 25% on light, 40% on dark (configurable) |
| **Obsidian integration** | Use Obsidian's `RGB`, `HSL`, `HexString` types; use `ColorComponent` in settings |
| **Auto-pair generation** | Keep hue, invert lightness with offset: `darkL = clamp(30, 80, 100 - lightL + 10)` |
