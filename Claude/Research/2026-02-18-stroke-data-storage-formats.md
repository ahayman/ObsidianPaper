# Research: Vector-Based Handwriting/Drawing Stroke Data Storage for Markdown

**Date:** 2026-02-18
**Purpose:** Evaluate approaches for storing vector-based handwriting stroke data in a text-based format suitable for embedding in or alongside markdown files in Obsidian.

---

## Table of Contents

1. [Existing Formats Survey](#1-existing-formats-survey)
2. [SVG Approach](#2-svg-approach)
3. [Custom JSON and Binary Formats](#3-custom-json-and-binary-formats)
4. [Compression Techniques](#4-compression-techniques)
5. [Performance Considerations](#5-performance-considerations)
6. [Editability Requirements](#6-editability-requirements)
7. [Markdown-Friendly Storage in Obsidian](#7-markdown-friendly-storage-in-obsidian)
8. [Recommendations](#8-recommendations)

---

## 1. Existing Formats Survey

### 1.1 Native App Formats

#### GoodNotes
- Uses a proprietary binary format (`.goodnotes` files, which are actually bundles/packages).
- Internally stores strokes as serialized objects with per-point data: x, y, pressure, timestamp.
- Stroke metadata (color, pen type, width) stored separately from point data.
- Uses a page-based model where each page has its own stroke collection.
- Binary format is optimized for fast random access and partial loading.
- Not suitable as a reference for text-based storage.

#### Notability
- Also proprietary binary format (`.note` files).
- Similar per-point storage: x, y, pressure, velocity.
- Stores strokes grouped by page with rendering hints pre-computed.
- Uses Core Data (SQLite-backed) for internal storage on iOS.
- Not text-friendly.

#### Apple Notes (PencilKit)
- Apple's PencilKit framework uses a proprietary binary archive format (`PKDrawing`).
- Serialized via `NSKeyedArchiver` as binary plist data.
- Per-point data includes: location (x, y), force (pressure), azimuth, altitude (tilt), timestamp, opacity.
- `PKStroke` objects contain a `PKStrokePath` with `PKStrokePoint` array.
- Ink properties (color, tool type, width) stored at the stroke level via `PKInk`.
- Tool types: pen, pencil, marker, monoline, fountainPen, watercolor, crayon.
- The format is compact but entirely opaque -- not human-readable.
- **Key insight**: PencilKit's data model is well-structured and separates ink properties from geometry, which is the right architectural pattern.

#### Apple's PKDrawing Data Model (relevant reference):
```
PKDrawing
  -> [PKStroke]
       -> PKInk (inkType, color, width)
       -> PKStrokePath
            -> [PKStrokePoint]
                 -> location: CGPoint (x, y)
                 -> force: CGFloat (pressure)
                 -> azimuth: CGFloat (tilt direction)
                 -> altitude: CGFloat (tilt angle from surface)
                 -> timeOffset: TimeInterval
                 -> opacity: CGFloat
```

### 1.2 Web-Based Drawing Apps

#### Excalidraw
- Stores data as **JSON** in `.excalidraw` files.
- Each element is a JSON object with `type`, `id`, `x`, `y`, `width`, `height`, `strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `roughness`, etc.
- Freehand drawings use `type: "freedraw"` with a `points` array.
- Points are stored as `[x, y, pressure?]` arrays (relative to element origin).
- Pressure is optional and only included when available.
- No tilt data is stored.
- File format example:
```json
{
  "type": "freedraw",
  "id": "abc123",
  "x": 100,
  "y": 200,
  "points": [[0,0,0.5],[2,3,0.6],[5,8,0.7]],
  "strokeColor": "#000000",
  "strokeWidth": 1,
  "roughness": 0,
  "simulatePressure": true
}
```
- **Performance note**: Excalidraw files can become large with many freehand strokes. A complex drawing can easily reach several MB of JSON.
- Excalidraw uses the `perfect-freehand` library by Steve Ruiz for stroke rendering, which takes points+pressure and generates smooth outlines.

#### tldraw
- Uses a **JSON-based schema** (`TLDrawShape`).
- Draw shapes store segments, each containing an array of points.
- Per-point data: `x`, `y`, `z` (where `z` is used for pressure, range 0-1).
- Properties at shape level: `color`, `fill`, `dash`, `size`, `isClosed`, `isComplete`, `isPen` (indicates stylus input with real pressure data).
- The `isPen` flag determines whether to use real pressure data or simulated pressure.
- Also uses `perfect-freehand` for rendering.
- Stores data in a CRDT-based store (Y.js/their own sync engine) for collaboration.
- Shape schema:
```json
{
  "type": "draw",
  "props": {
    "segments": [
      {
        "type": "free",
        "points": [
          {"x": 0, "y": 0, "z": 0.5},
          {"x": 2.1, "y": 3.4, "z": 0.6}
        ]
      }
    ],
    "color": "black",
    "fill": "none",
    "dash": "draw",
    "size": "m",
    "isComplete": true,
    "isClosed": false,
    "isPen": true
  }
}
```

### 1.3 W3C Standards

#### InkML (Ink Markup Language)
- W3C standard (2011) for representing digital ink.
- XML-based format.
- Designed specifically for handwriting recognition, annotation, and storage.
- Supports rich per-point channel data: X, Y, F (force/pressure), T (time), OTx/OTy (tilt), etc.
- Channels are declared in a `<traceFormat>` element, then data is stored as whitespace-separated values in `<trace>` elements.
- Example:
```xml
<ink xmlns="http://www.w3.org/2003/InkML">
  <traceFormat>
    <channel name="X" type="decimal"/>
    <channel name="Y" type="decimal"/>
    <channel name="F" type="decimal"/>
    <channel name="T" type="integer"/>
    <channel name="OTx" type="decimal"/>
    <channel name="OTy" type="decimal"/>
  </traceFormat>
  <brush xml:id="brush1">
    <brushProperty name="color" value="#000000"/>
    <brushProperty name="width" value="2.0"/>
    <brushProperty name="tip" value="ellipse"/>
  </brush>
  <trace brushRef="#brush1">
    100 200 0.5 0 -0.1 0.3, 102 203 0.6 16 -0.1 0.3, 105 208 0.7 33 -0.1 0.3
  </trace>
</ink>
```
- Supports delta encoding: after first point, subsequent values can be deltas (prefixed with `'`).
- Supports velocity (`V`) and acceleration (`A`) channels.
- **Pros**: Well-specified, supports all needed channels, designed for ink.
- **Cons**: XML is verbose; the standard is somewhat academic and never saw widespread adoption in consumer apps; no modern web implementations.

#### W3C Ink API (Handwriting Recognition API)
- A newer browser API proposal focused on handwriting **recognition**, not storage.
- Defines `HandwritingStroke` with `addPoint({x, y, t})` -- notably minimal per-point data (no pressure/tilt).
- Not designed for ink storage or rendering -- not relevant for our needs.

### 1.4 Other Relevant Formats

#### Stroke Vector Format (SVF) / Universal Ink Model
- Microsoft's proprietary ink format used in Windows Ink / OneNote.
- Binary format, not publicly documented in full.
- Supports pressure, tilt, and rich per-point data.
- Not suitable for our use.

#### ISF (Ink Serialized Format)
- Microsoft's older format for Tablet PC ink.
- Binary, compact, with Huffman coding for point data.
- Well-engineered but proprietary and binary.

---

## 2. SVG Approach

### 2.1 How SVG Could Store Strokes

SVG paths can represent freehand strokes using:
- `<path d="M x y L x y L x y ...">` for straight segments between points
- `<path d="M x y C cx1 cy1 cx2 cy2 x y ...">` for cubic Bezier curves (smoother)
- `<path d="M x y Q cx cy x y ...">` for quadratic Bezier curves

Stroke appearance is controlled via attributes:
```xml
<path d="M 100 200 L 102 203 L 105 208"
      stroke="#000000"
      stroke-width="2"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"/>
```

### 2.2 Storing Pressure/Tilt Data in SVG

**This is where SVG breaks down for handwriting.** SVG path data (`d` attribute) only stores geometry -- there is no native mechanism for per-point pressure, tilt, or timestamps.

Workarounds:
1. **Variable-width paths**: Pre-render pressure as varying `stroke-width` by splitting each stroke into many small segments with different widths. This bakes rendering into the data and loses editability.
2. **Custom data attributes**: Store pressure/tilt in `data-*` attributes:
   ```xml
   <path d="M 100 200 L 102 203"
         data-pressure="0.5,0.6"
         data-tilt-x="-0.1,-0.1"
         data-tilt-y="0.3,0.3"/>
   ```
3. **Filled outlines instead of strokes**: Compute the outline of a variable-width stroke and store it as a filled `<path>`. This is what `perfect-freehand` does. Loses all editability.
4. **Parallel metadata**: Store SVG for display but keep a separate data structure for the raw points.

### 2.3 Pros of SVG

- **Universally renderable**: Any browser, any markdown renderer can display SVGs.
- **Standard format**: Well-documented, widely supported.
- **Human-readable** (to some degree).
- **Obsidian renders SVG** natively when embedded as `![[drawing.svg]]`.
- **Git-friendly**: Text-based, diffable.
- **CSS-styleable**: Colors, widths, opacity can be changed via CSS.

### 2.4 Cons of SVG

- **No native pressure/tilt support**: Must use workarounds that compromise editability.
- **Verbose**: Thousands of strokes with many points each produce massive SVG files. A single stroke of 200 points with Bezier curves could be 2-4KB of path data. 1000 strokes = 2-4MB of SVG.
- **Rendering performance**: Browsers struggle with SVGs containing thousands of paths. DOM node count becomes a serious bottleneck above ~5000 elements.
- **Editing requires re-rendering**: If you store pre-rendered outlines, changing pen type or smoothing requires recomputing all outlines.
- **Precision bloat**: Floating-point coordinates with full precision (e.g., `103.47265625`) add significant character count.
- **Not designed for real-time**: SVG DOM manipulation is slow for live drawing.

### 2.5 SVG Assessment

**SVG is a poor primary storage format for a handwriting app** but could serve as a **secondary export/preview format**. The lack of per-point metadata and the verbosity make it unsuitable for a primary data store when editability and performance are requirements.

A hybrid approach -- store raw stroke data in a custom format, generate SVG for preview/display -- may have merit. Excalidraw's Obsidian plugin does something similar: it stores its JSON data and renders to SVG/canvas for display.

---

## 3. Custom JSON and Binary Formats

### 3.1 Excalidraw's Approach (JSON)

Excalidraw stores everything as JSON:
- Simple, human-readable, debuggable.
- Each element is self-contained with all properties.
- Points stored as nested arrays `[[x,y,p], ...]`.
- Files become large with many freehand elements.
- Performance managed by:
  - Rendering only visible elements (viewport culling).
  - Caching rendered elements as bitmaps.
  - Batching re-renders with `requestAnimationFrame`.
- **File sizes**: A typical Excalidraw drawing with significant freehand content can be 1-10MB of JSON.

### 3.2 tldraw's Approach (JSON + CRDT)

tldraw uses a record-based store:
- Each shape is a record in a normalized store.
- Records can be independently updated (good for collaboration).
- Point data stored as objects `{x, y, z}` in arrays.
- The store is serialized as JSON for persistence.
- Uses incremental rendering -- only re-renders changed shapes.
- **Page-based model**: Shapes are organized by page, allowing lazy loading.

### 3.3 Custom Compact JSON Design

For a handwriting app with per-point pressure/tilt/timestamp, a well-designed JSON format might look like:

```json
{
  "version": 1,
  "strokes": [
    {
      "id": "s1",
      "ink": {
        "type": "pen",
        "color": "#1a1a1a",
        "width": 2.0,
        "smoothing": 0.5,
        "opacity": 1.0
      },
      "points": {
        "x": [100, 102, 105, 110],
        "y": [200, 203, 208, 215],
        "p": [0.5, 0.6, 0.7, 0.65],
        "tx": [-0.1, -0.1, -0.12, -0.11],
        "ty": [0.3, 0.3, 0.28, 0.29],
        "t": [0, 16, 33, 50]
      },
      "bbox": [100, 200, 110, 215]
    }
  ]
}
```

**Column-oriented vs. row-oriented storage:**
- **Row-oriented** (Excalidraw): `[[x,y,p], [x,y,p], ...]` -- intuitive but verbose due to repeated brackets/commas.
- **Column-oriented** (shown above): `{x: [...], y: [...], p: [...]}` -- more compact, better for compression, enables independent access to channels. Approx **30-40% smaller** than row-oriented for the same data.

### 3.4 Binary Format Considerations

A binary format could be dramatically more compact:
- Each point: 6 values x 4 bytes (float32) = 24 bytes per point.
- Or with 2-byte fixed-point for coordinates and 1-byte for pressure: ~9 bytes per point.
- A stroke of 200 points: 1.8KB (float32) or 1.8KB binary vs. ~4KB JSON.
- 1000 strokes of 200 points each: 1.8MB binary vs. ~4MB JSON.

However, binary has significant downsides for our use case:
- Not human-readable; opaque in git diffs.
- Requires Base64 encoding for text-based storage (+33% overhead).
- Harder to debug and inspect.
- Custom parsing code required.

### 3.5 MessagePack / CBOR

Binary JSON alternatives:
- **MessagePack**: Binary serialization format compatible with JSON data structures but ~50% smaller. Libraries available in JS.
- **CBOR (Concise Binary Object Representation)**: RFC 7049 standard. Similar to MessagePack but with more features.
- Both would need Base64 encoding for markdown embedding, partly negating size benefits.

---

## 4. Compression Techniques

### 4.1 Delta Encoding

Instead of storing absolute values, store the first point absolutely and subsequent points as deltas:

```
Absolute: [100.5, 102.3, 105.8, 110.2]
Delta:    [100.5, +1.8, +3.5, +4.4]
```

**Effectiveness for handwriting:**
- Handwriting involves small, continuous movements. Delta values are typically small numbers (1-5 pixels between samples at 60-120Hz).
- Reduces character count significantly because small numbers have fewer digits.
- Deltas compress much better with general-purpose compression (smaller value ranges = more repetition).
- **Expected size reduction**: 30-50% for coordinate data.

### 4.2 Quantization / Fixed-Point

Reduce floating-point precision:
- Raw input: `103.47265625` (14 characters)
- 1 decimal place: `103.5` (5 characters) -- sufficient for most display purposes
- Integer (multiply by 10): `1035` (4 characters)

For pressure (0-1 range):
- Raw: `0.6328125` (9 characters)
- Quantized to 256 levels (uint8): values 0-255, store as integer
- 2 decimal places: `0.63` (4 characters)

For tilt (-1 to 1 range):
- Similar to pressure; 2 decimal places usually sufficient.

**Expected size reduction**: 40-60% for coordinate/pressure data through quantization alone.

### 4.3 Run-Length Encoding for Sparse Channels

Tilt data often changes slowly or not at all. Run-length encoding can help:
```
Full:    [0.3, 0.3, 0.3, 0.3, 0.31, 0.31, 0.31]
RLE:     [0.3, "x4", 0.31, "x3"]
```

Timestamps are often evenly spaced (e.g., every 16ms at 60Hz):
```
Full:    [0, 16, 33, 50, 66, 83]
Compact: {"start": 0, "interval": 16, "deviations": [0, 0, 1, 0, 0, 1]}
```

### 4.4 Base64-Encoded Binary Compression

Approach: serialize point data to a compact binary representation, then compress with a standard algorithm, then Base64-encode.

Pipeline: `PointData -> Float32Array -> pako.deflate() -> Base64.encode()`

- Raw 200-point stroke (6 channels): 4800 bytes binary
- After deflate compression: ~1500-2500 bytes (handwriting data compresses well due to smooth value progressions)
- After Base64: ~2000-3300 characters

Compare to JSON for same stroke: ~4000 characters uncompressed.

**Libraries available:**
- `pako` -- zlib/deflate in JS, widely used
- `fflate` -- faster, smaller alternative
- `lz4js` -- very fast compression/decompression
- `lz-string` -- designed specifically for storing compressed data in text/localStorage

### 4.5 Custom Compact Text Encoding

Design a custom text encoding optimized for stroke data:

```
# Stroke format: "ink_props|channel_data"
# Channel data: delta-encoded, fixed-precision, pipe-separated channels
pen,#1a1a1a,2.0,0.5|1005,18,35,44,-12,8|2000,30,50,70,25,-30|50,60,70,65|...
```

This is essentially a CSV-like format optimized for the specific data shape. Advantages:
- Very compact (minimal syntax overhead).
- Still somewhat human-readable.
- Easy to parse.
- Good compression ratio.

### 4.6 Compression Comparison Estimate

For a document with 1000 strokes, 200 points each, 6 channels per point (x, y, pressure, tiltX, tiltY, timestamp):

| Format | Size Estimate | Notes |
|--------|--------------|-------|
| Naive JSON (row-oriented) | ~12 MB | `[[x,y,p,tx,ty,t], ...]` |
| Column JSON | ~8 MB | `{x:[...], y:[...]}` |
| Column JSON + quantized | ~4 MB | Reduced decimal places |
| Column JSON + delta + quantized | ~2.5 MB | Delta-encoded coordinates |
| Custom compact text | ~2 MB | Minimal syntax overhead |
| Binary (Float32) | ~4.6 MB | Raw binary, no compression |
| Binary + deflate + Base64 | ~1.5 MB | Compressed binary |
| Binary + deflate + Base64 (delta-encoded) | ~0.8 MB | Delta + compressed |

**Note**: These are rough estimates. Actual sizes depend on stroke characteristics (length, curvature, sampling rate).

---

## 5. Performance Considerations

### 5.1 Loading Performance

The critical question: how fast can we parse and prepare stroke data for rendering?

**JSON.parse()** performance:
- Modern V8/JavaScriptCore can parse ~200MB/s of JSON.
- A 4MB stroke file parses in ~20ms -- acceptable.
- However, allocating millions of small objects (point arrays) causes GC pressure.
- **Column-oriented** JSON is better for parsing: fewer object allocations, contiguous arrays.

**Binary decode** performance:
- Base64 decode + inflate: ~50-100ms for 1MB (depends on decompressed size).
- Typed array creation is fast.
- Overall faster than JSON for large files when measuring parse + object creation.

### 5.2 Rendering Performance

**Canvas 2D** (recommended for handwriting):
- Can draw thousands of strokes per frame.
- Use `Path2D` objects to cache stroke paths.
- Only re-render strokes that changed or are in the viewport.
- Pressure-variable rendering: compute stroke outline once, cache as `Path2D`, fill.
- For `perfect-freehand` style rendering: outline computation is O(n) per stroke, results should be cached.
- **Target**: 60fps during active drawing, full redraw in <100ms.

**Incremental rendering strategy**:
1. Keep an off-screen canvas with all finalized strokes rendered.
2. During active drawing, only render the current stroke on top.
3. When stroke is finalized, render it to the off-screen canvas and add to data store.
4. On viewport change, re-render only the off-screen canvas region.

### 5.3 Memory Considerations

For 1000 strokes x 200 points x 6 channels:
- As typed arrays (Float32Array): ~4.6MB
- As JS objects: ~20-30MB (due to object overhead, property names, etc.)
- **Recommendation**: Store point data in typed arrays in memory, not as object arrays.

**Spatial indexing**:
- For viewport culling and hit testing, use an R-tree or grid-based spatial index.
- Index strokes by bounding box.
- Keeps rendering efficient as stroke count grows.
- Libraries: `rbush` (excellent R-tree implementation for JS).

### 5.4 Save/Persist Performance

Writing back to disk should not block the UI:
- Debounce saves (e.g., save at most once per second).
- Serialize in a Web Worker if format requires significant computation.
- For JSON: `JSON.stringify()` of column-oriented data is fast (~100MB/s).
- For binary: typed array serialization + compression in a worker.
- Consider incremental/append-only save strategies for very large documents.

### 5.5 Lazy Loading / Pagination

For very large documents:
- Consider page-based or region-based partitioning.
- Load only strokes for the visible region.
- Keep stroke metadata (bounding box, ink properties) always loaded; load point data on demand.
- This requires a format that supports random access or chunked loading.

---

## 6. Editability Requirements

### 6.1 What Must Be Editable

After a stroke is placed, the user should be able to change:
1. **Pen type** (e.g., ballpoint -> fountain pen -> marker) -- changes how pressure affects width, edge texture.
2. **Color** -- stroke color, potentially gradient/opacity.
3. **Width/size** -- base stroke width.
4. **Smoothing level** -- how much the raw points are smoothed for display.
5. **Opacity** -- per-stroke opacity.

All of these are **rendering parameters**, not geometry changes. The raw point data (x, y, pressure, tilt, time) should remain unchanged.

### 6.2 Architecture for Editability

**Separation of concerns:**

```
StrokeData = {
  id: string
  points: {x[], y[], p[], tx[], ty[], t[]}  // Immutable geometry
}

StrokeStyle = {
  strokeId: string
  penType: "ballpoint" | "fountain" | "marker" | "pencil" | "brush"
  color: string
  width: number
  smoothing: number  // 0-1
  opacity: number    // 0-1
  taper: { start: number, end: number }
}
```

When a style property changes:
1. Look up the style by stroke ID.
2. Update the style property.
3. Invalidate the cached rendering for that stroke.
4. Re-render the stroke from raw points + new style.
5. Save only the updated style (point data unchanged).

**This means the storage format must keep style and geometry separate**, or at least structured so that style changes don't require rewriting point data.

### 6.3 Style Inheritance / Defaults

For efficiency, use a default style and per-stroke overrides:

```json
{
  "defaultStyle": {
    "penType": "ballpoint",
    "color": "#1a1a1a",
    "width": 2.0,
    "smoothing": 0.5,
    "opacity": 1.0
  },
  "strokes": [
    {
      "id": "s1",
      "points": {...},
      "style": {}  // Empty = use defaults
    },
    {
      "id": "s2",
      "points": {...},
      "style": {"color": "#ff0000"}  // Only override color
    }
  ]
}
```

This reduces storage when most strokes share the same style (common in handwriting).

### 6.4 Batch Style Operations

Users may want to select multiple strokes and change their color at once. The format should support:
- Named style groups (like CSS classes).
- Stroke -> style group references.
- Changing a style group updates all referencing strokes.

```json
{
  "styleGroups": {
    "default": {"penType": "ballpoint", "color": "#1a1a1a", "width": 2.0},
    "highlight": {"penType": "marker", "color": "#ffff00", "width": 8.0, "opacity": 0.4}
  },
  "strokes": [
    {"id": "s1", "styleGroup": "default", "points": {...}},
    {"id": "s2", "styleGroup": "highlight", "points": {...}}
  ]
}
```

---

## 7. Markdown-Friendly Storage in Obsidian

### 7.1 How Excalidraw's Obsidian Plugin Handles Storage

Excalidraw's Obsidian plugin (obsidian-excalidraw-plugin by Zsolt Viczian) is the best reference for how a drawing tool integrates with Obsidian's file system. Its approach:

1. **Dedicated file extension**: Uses `.excalidraw.md` files (markdown files with a custom extension that Obsidian recognizes).
2. **Markdown + embedded data**: The file is valid markdown. It contains:
   - A markdown section at the top for text content, links, and tags (searchable by Obsidian).
   - A fenced code block containing the Excalidraw JSON data.
   - Optionally, an embedded SVG for preview rendering.
3. **File structure**:
   ```markdown
   # My Drawing

   Some text notes, [[links]], and #tags that Obsidian can index.

   %%
   # Excalidraw Data
   ## Text Elements
   Hello World ^textId1

   ## Drawing
   ```json
   {"type":"excalidraw","version":2,"elements":[...],"appState":{...}}
   ```
   %%
   ```
4. **The `%%` markers**: These are Obsidian comment delimiters. Content between `%%` pairs is hidden in reading mode but preserved in the file. This keeps the drawing data invisible in preview while maintaining it in the file.
5. **Embedded images**: References external files or uses Base64 data URIs.
6. **The plugin registers a custom view**: When the user opens a `.excalidraw.md` file, the plugin intercepts the open event and renders its custom canvas-based editor instead of the default markdown editor.

**Key lessons from Excalidraw:**
- Using `.md` extension ensures Obsidian's file indexer processes the file.
- Markdown at the top allows links and tags to work with Obsidian's graph/search.
- Hiding data in `%%` comments keeps reading view clean.
- Large drawings (many freehand strokes) do create large files and Obsidian handles this without issues up to several MB.
- Sync services (Obsidian Sync, iCloud, git) handle these files fine.

### 7.2 Option A: Single `.paper.md` File (Excalidraw Model)

```markdown
---
cssclass: paper-note
created: 2026-02-18T10:30:00Z
---

# My Handwritten Note

Transcription or OCR text could go here for searchability.
Links to [[other notes]] and #tags work normally.

%%
# Paper Data v1
```paper-json
{
  "version": 1,
  "canvas": {"width": 2048, "height": 2732, "bgColor": "#fffff8"},
  "defaultStyle": {"penType": "fountain", "color": "#1a1a1a", "width": 1.5},
  "strokes": [...]
}
```
%%
```

**Pros:**
- Single file, simple mental model.
- Obsidian links/tags work.
- Preview text searchable.
- Excalidraw has proven this works.

**Cons:**
- File gets large (5-15MB for dense handwriting pages).
- Every save rewrites the entire file.
- Git diffs are noisy for large stroke data blocks.
- Sync services must transfer entire file on any change.

### 7.3 Option B: Markdown + Sidecar Data File

```
my-note.paper.md          -- Markdown with metadata, links, tags, transcription
my-note.paper.json         -- Stroke data (or .paper.bin for binary)
```

Or using Obsidian's attachment folder:
```
Notes/
  my-note.paper.md
  attachments/
    my-note.paper.data     -- Stroke data
```

The markdown file references the data:
```markdown
---
paper-data: attachments/my-note.paper.data
---

# My Handwritten Note

![[my-note.paper.data]]
```

**Pros:**
- Keeps markdown files small and clean.
- Stroke data file can be binary (more compact).
- Partial saves possible (only rewrite changed strokes).
- Better for git (data file changes are separate from text changes).

**Cons:**
- Two files to manage; risk of orphaned sidecar files.
- Obsidian doesn't natively link non-md files in all contexts.
- Plugin must manage file lifecycle (create, rename, delete sidecar with markdown file).
- Obsidian Sync might not sync unknown file extensions (needs `.json` or another recognized extension).
- More complex implementation.

### 7.4 Option C: Chunked Storage in Markdown

Split stroke data into pages/chunks, each in its own fenced code block:

```markdown
---
paper-version: 1
---

# Page 1

%%paper-chunk:page1:meta
{"canvas":{"width":2048,"height":2732},"defaultStyle":{...}}
%%

%%paper-chunk:page1:strokes:0-99
[compressed stroke data for strokes 0-99]
%%

%%paper-chunk:page1:strokes:100-199
[compressed stroke data for strokes 100-199]
%%
```

**Pros:**
- Single file.
- Could enable partial loading (parse only needed chunks).
- Smaller diffs when only some chunks change.

**Cons:**
- Complex parsing logic.
- Obsidian's file API reads entire files; chunking doesn't help with I/O.
- Markdown file structure becomes fragile.

### 7.5 Option D: Obsidian's `loadData()` / `saveData()`

Obsidian plugins can use `this.loadData()` and `this.saveData()` to persist arbitrary JSON in the plugin's data directory (`.obsidian/plugins/paper/data.json`).

**Not suitable for stroke data**: This is designed for plugin settings, not per-document data. There's no per-file data API.

### 7.6 Option E: Custom Binary in Vault

Store as `.paper` binary files in the vault, use a custom view to render them, and maintain a parallel `.md` file for Obsidian integration.

**Verdict**: Too complex, doubles file count, and Obsidian can't index binary files.

### 7.7 Recommended Approach

**Option A (Single `.paper.md` file)** is the recommended approach, following the proven Excalidraw pattern. Reasons:

1. Excalidraw has demonstrated this works at scale in the Obsidian ecosystem.
2. Single file = simple mental model for users.
3. Obsidian links, tags, search, graph all work.
4. Sync services (Obsidian Sync, iCloud, Dropbox) handle it well.
5. The data section can use any text-based encoding (JSON, compressed, etc.).
6. The Obsidian community is familiar with this pattern.

To mitigate the file size concern:
- Use compact encoding (column-oriented, delta-encoded, quantized).
- Consider page-based partitioning within the file.
- For very large documents, the sidecar approach (Option B) could be offered as an advanced option.

---

## 8. Recommendations

### 8.1 Proposed Storage Format

**File extension**: `.paper.md`

**File structure**:
```markdown
---
cssclass: obsidian-paper
paper-version: 1
created: 2026-02-18T10:30:00Z
modified: 2026-02-18T11:45:00Z
---

# [User title or auto-generated]

[Optional transcription, links, tags for Obsidian indexing]

%%
```paper-data
[Compact encoded stroke data]
```
%%
```

### 8.2 Proposed Data Format

Use a **custom JSON format with column-oriented, delta-encoded, quantized point data**. This balances:
- Human readability (still JSON, can be inspected/debugged).
- Compactness (column + delta + quantization = ~3x smaller than naive JSON).
- Parseability (JSON.parse() is fast and native).
- Editability (style separated from geometry).

**Schema**:
```json
{
  "v": 1,
  "canvas": {
    "w": 2048,
    "h": 2732,
    "bg": "#fffff8",
    "paper": "lined"
  },
  "styles": {
    "default": {"pen": "fountain", "c": "#1a1a1a", "w": 1.5, "sm": 0.5, "op": 1.0},
    "highlight": {"pen": "marker", "c": "#ffff00", "w": 8.0, "sm": 0.3, "op": 0.4}
  },
  "strokes": [
    {
      "id": "a1b2",
      "st": "default",
      "bb": [100, 200, 300, 400],
      "pts": "BASE64_OR_COMPACT_ENCODED_POINT_DATA"
    }
  ]
}
```

**Point data encoding** (per stroke, stored as a compact string):
- Delta-encode x and y (first point absolute, rest as deltas).
- Quantize: x/y to 0.1 pixel precision (multiply by 10, store as int). Pressure to 0-255 (uint8). Tilt to 0-255 mapped from -PI/2 to PI/2. Timestamps as ms deltas (typically 8-16ms between points).
- Serialize as a flat binary buffer: `[x0_16, y0_16, dx1_16, dy1_16, ..., p0_8, p1_8, ..., tx0_8, tx1_8, ..., ty0_8, ty1_8, ..., dt0_8, dt1_8, ...]`
- Compress with deflate (via `pako` or `fflate`).
- Base64-encode the result.

This yields approximately **5-10 bytes per point** after compression (vs. ~40 bytes per point in naive JSON), an improvement of **4-8x**.

**Alternative (simpler, slightly larger)**: Skip binary encoding and use delta-encoded comma-separated integers within the JSON:
```json
{
  "pts": {
    "x": "1005,18,35,44,52,-12,8",
    "y": "2003,30,50,72,25,-30,15",
    "p": "128,5,10,3,-2,-5,0",
    "tx": "64,0,0,-1,0,1,0",
    "ty": "128,2,-1,0,0,1,0",
    "t": "0,16,17,16,17,16,17"
  }
}
```
This is about **2x larger** than the binary approach but remains **fully human-readable** and debuggable.

### 8.3 Migration Path

Start with the simpler comma-separated delta format. If file sizes become problematic, migrate to binary encoding. The version field (`"v": 1`) enables format evolution.

### 8.4 Key Technical Decisions Summary

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| File format | `.paper.md` with data in `%%` comments | Proven by Excalidraw, Obsidian-native |
| Data format | JSON with compact point encoding | Balance of readability and size |
| Point storage | Column-oriented, delta-encoded, quantized | 3-8x smaller than naive JSON |
| Style storage | Separate from geometry, with style groups | Enables post-hoc editing without touching points |
| Rendering | Canvas 2D with `perfect-freehand` or similar | Performance for thousands of strokes |
| Spatial indexing | R-tree (e.g., `rbush`) | Viewport culling, hit testing |
| In-memory format | Typed arrays (Float32Array) | Memory-efficient, fast access |
| Compression | Optional deflate + Base64 for v2 | Keep v1 simple and readable |

### 8.5 Open Questions for Future Research

1. **OCR/handwriting recognition**: Should transcription be stored alongside strokes for searchability? What libraries/services are available?
2. **Undo/redo**: How to efficiently store undo history? Operation log vs. snapshots?
3. **Multi-page documents**: How to handle documents with many pages? Lazy loading strategy?
4. **Collaboration**: Is real-time collaboration a future goal? If so, CRDT-based storage (like tldraw) should be considered from the start.
5. **Apple Pencil specifics**: What exact data does the Obsidian iOS/iPadOS app expose from PointerEvents? Is azimuth/altitude available?
6. **Rendering library evaluation**: Evaluate `perfect-freehand`, custom renderers, and whether PencilKit's rendering can be approximated in Canvas 2D.
7. **File size limits**: At what file size does Obsidian's performance degrade? Test with 5MB, 10MB, 20MB `.md` files.
8. **Sync behavior**: How do Obsidian Sync, iCloud, and git handle frequent updates to large text files?

---

## References and Sources

- **InkML W3C Recommendation** (2011): https://www.w3.org/TR/InkML/ -- XML-based ink standard with per-point channel data.
- **Excalidraw source code**: https://github.com/excalidraw/excalidraw -- JSON-based element storage, `freedraw` element type.
- **Excalidraw Obsidian Plugin**: https://github.com/zsviczian/obsidian-excalidraw-plugin -- `.excalidraw.md` file format with JSON in `%%` comments.
- **tldraw source code**: https://github.com/tldraw/tldraw -- `TLDrawShape` with segments/points, `perfect-freehand` integration.
- **perfect-freehand**: https://github.com/steveruizok/perfect-freehand -- Library for converting point+pressure data to smooth stroke outlines.
- **Apple PencilKit documentation**: https://developer.apple.com/documentation/pencilkit -- `PKDrawing`, `PKStroke`, `PKStrokePoint` data model.
- **rbush**: https://github.com/mourner/rbush -- High-performance R-tree spatial index for JS.
- **pako**: https://github.com/nodeca/pako -- zlib port for JS (deflate/inflate).
- **fflate**: https://github.com/101arrowz/fflate -- Fast JS compression library.
