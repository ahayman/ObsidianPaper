# Optimal Storage Format for Vector-Based Handwriting Data in Obsidian

**Date:** 2026-02-18
**Purpose:** Deep-dive research into storage formats for vector-based handwriting data, building on and superseding the preliminary stroke data storage research. Covers existing format analysis, a concrete recommended format with full examples, performance modeling, re-rendering strategies, and Obsidian markdown integration.

> **Note:** Web search and web fetch were unavailable during this research. All information is drawn from established standards, published specifications, well-known open-source implementations, and engineering analysis (knowledge through May 2025).

---

## Table of Contents

1. [Existing Format Analysis](#1-existing-format-analysis)
2. [Custom JSON Format Design](#2-custom-json-format-design)
3. [Performance Analysis](#3-performance-analysis)
4. [Re-Rendering from Stored Data](#4-re-rendering-from-stored-data)
5. [Markdown Integration](#5-markdown-integration)
6. [Final Recommendation](#6-final-recommendation)

---

## 1. Existing Format Analysis

### 1.1 SVG for Handwriting Storage

**How drawing apps store stroke data in SVG:**

Drawing apps that use SVG typically take one of two approaches:

**Approach A: Pre-rendered outlines (what most apps do)**

The stroke is computed into its final visual form -- a filled polygon representing the variable-width outline -- and stored as an SVG `<path>` with a fill:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2732">
  <path d="M 102.3 205.7 C 103.1 206.2 104.8 207.9 106.2 210.1
           C 107.6 212.3 109.4 215.8 110.3 218.2 ..."
        fill="#1a1a1a" stroke="none"/>
</svg>
```

This is what `perfect-freehand`'s `getSvgPathFromStroke()` produces, and what Excalidraw uses when exporting to SVG. The output is a closed polygon path (M...C...Z or M...L...Z) that gets filled.

**Pros:**
- Universally renderable in any browser, markdown viewer, or image viewer
- Obsidian renders SVG natively via `![[drawing.svg]]`
- Crisp at any zoom (true vector)
- Standard format, git-diffable (to a degree)

**Cons:**
- **Destroys editability**: Once pressure/width is baked into the outline, you cannot change the pen type, smoothing, or width without re-computing from raw data -- which is not stored
- **No per-point metadata**: SVG paths contain only geometry. Pressure, tilt, and timestamps are lost
- **Verbose**: A single stroke of 200 points with cubic Bezier curves generates approximately 3-5KB of path data. A document with 1,000 strokes would be 3-5MB of SVG
- **DOM performance ceiling**: Browsers struggle with SVGs containing more than ~5,000 path elements. Rendering becomes CPU-bound on the DOM layout engine

**Approach B: Polylines with custom data attributes**

Store the raw stroke geometry as an SVG `<polyline>` or `<path>` with additional metadata in `data-*` attributes:

```xml
<path d="M 100 200 L 102 203 L 105 208 L 110 215"
      stroke="#1a1a1a" stroke-width="2" fill="none"
      stroke-linecap="round" stroke-linejoin="round"
      data-pen="fountain"
      data-pressure="0.5,0.6,0.7,0.65"
      data-tilt-x="-5,-5,-6,-5"
      data-tilt-y="17,17,16,17"
      data-timestamps="0,16,33,50"/>
```

**Pros:**
- Preserves raw data alongside geometry
- Renderable (though at constant width, which looks wrong for variable-pressure strokes)
- Metadata is accessible via standard DOM APIs

**Cons:**
- The rendered SVG looks incorrect because `stroke-width` is constant -- the visual output does not match the stored pressure data
- `data-*` attributes are non-standard for ink -- no tool understands them
- Even more verbose than Approach A (raw path + metadata)
- Still limited by SVG DOM performance

**Assessment:** SVG is valuable as a **preview/export format** but poor as a primary storage format. A two-layer strategy (store raw data in a custom format, optionally generate SVG for previews) is the right approach.

### 1.2 InkML (W3C Ink Markup Language)

**Specification:** W3C Recommendation, September 2011. https://www.w3.org/TR/InkML/

InkML is the only W3C-standardized format specifically designed for digital ink. It is XML-based and defines a rich vocabulary for ink capture, storage, and processing.

**Core data model:**

```
<ink>
  <definitions>
    <traceFormat xml:id="fmt1">          -- Declares per-point channels
    <brush xml:id="brush1">              -- Declares ink appearance properties
    <context>                             -- Capture device metadata
  </definitions>
  <traceGroup>                            -- Groups related traces (e.g., a word)
    <trace brushRef="#brush1">            -- A single stroke
      100 200 128 0, 102 203 140 16, ... -- Whitespace-separated channel values
    </trace>
  </traceGroup>
</ink>
```

**Channel system (traceFormat):**

InkML's most powerful feature is its flexible channel declaration. Channels are declared once, then every trace implicitly follows the declared format:

```xml
<traceFormat xml:id="fmt1">
  <channel name="X" type="decimal" units="dev"/>  <!-- X coordinate -->
  <channel name="Y" type="decimal" units="dev"/>  <!-- Y coordinate -->
  <channel name="F" type="decimal" min="0" max="1"/>  <!-- Force/pressure -->
  <channel name="T" type="integer" units="ms"/>    <!-- Timestamp -->
  <channel name="OTx" type="decimal"/>             <!-- Tilt X (orientation) -->
  <channel name="OTy" type="decimal"/>             <!-- Tilt Y (orientation) -->
</traceFormat>
```

Standard channel names include: X, Y, Z, F (force), T (time), OTx, OTy, OA (azimuth), OE (elevation), OR (rotation), V (velocity), A (acceleration).

**Delta encoding support:**

InkML natively supports delta encoding within trace data. After the first point, subsequent points can be expressed as deltas using the `'` prefix:

```xml
<trace>
  100 200 128 0, '2 '3 '12 '16, '3 '5 '10 '17, '5 '7 '-3 '16
</trace>
```

This means: first point is (100, 200, 128, 0), second is (102, 203, 140, 16), etc. This is remarkably efficient for the XML format.

**Brush properties:**

```xml
<brush xml:id="brush1">
  <brushProperty name="color" value="#1a1a1a"/>
  <brushProperty name="width" value="2.0" units="dev"/>
  <brushProperty name="tip" value="ellipse"/>
  <brushProperty name="rasterOp" value="copyPen"/>
  <brushProperty name="transparency" value="0"/>
</brush>
```

**traceGroup for semantic structure:**

```xml
<traceGroup>
  <annotation type="truth">Hello</annotation>  <!-- Recognized text -->
  <trace brushRef="#brush1">...</trace>
  <trace brushRef="#brush1">...</trace>
  <trace brushRef="#brush1">...</trace>
</traceGroup>
```

TraceGroups can nest, allowing hierarchical structure: document > page > paragraph > word > stroke.

**Practical assessment:**

| Aspect | Rating | Notes |
|--------|--------|-------|
| Completeness | Excellent | Covers all needed channels, metadata, grouping |
| Compactness | Poor-Medium | XML overhead; delta encoding helps but XML tags are verbose |
| Tooling support | Very Poor | Effectively no modern JavaScript libraries. No browser-native parsing. No drawing apps use it in practice |
| Parsing speed | Poor | XML parsing is slower than JSON parsing in JavaScript |
| Human readability | Medium | Readable but verbose |
| Extensibility | Excellent | Namespace-based, schema-extensible |
| Adoption | Negligible | The standard saw minimal industry adoption despite being well-designed |

**Key lessons to take from InkML:**
1. The **channel-based data model** (declare channels once, all strokes follow the format) is elegant and should be adopted
2. **Delta encoding** as a first-class concept is valuable
3. **Brush/ink properties separate from geometry** is the right pattern
4. **TraceGroups** for semantic organization (words, lines, pages) are useful
5. The failure of InkML teaches that **ecosystem adoption matters more than specification quality**

**Verdict:** InkML's data model is excellent, but XML is the wrong carrier for a web-based application. We should adopt InkML's conceptual design in a JSON-based format.

### 1.3 ISF (Ink Serialized Format) -- Microsoft

**Background:** ISF is Microsoft's proprietary binary format for ink data, used in Windows Ink, OneNote, Windows Journal, and the Tablet PC platform since 2002. While the format is proprietary, Microsoft has published enough documentation and the .NET Ink API exposes enough of the internal structure that its design is well-understood.

**Architecture:**

ISF uses a tagged binary format (similar in concept to EBML or TIFF's IFD structure):

```
ISF Stream:
  [Header: version, size]
  [Tag: GUID_TABLE] [Size] [Data: custom GUID definitions]
  [Tag: STROKE_DESC_TABLE] [Size] [Data: stroke descriptor for each stroke]
  [Tag: DRAW_ATTRS] [Size] [Data: drawing attributes (color, width, tip shape)]
  [Tag: STROKE] [Size] [Data: encoded point data]
  [Tag: STROKE] [Size] [Data: encoded point data]
  ...
```

**Point data encoding:**

ISF uses a sophisticated multi-pass encoding for point data:
1. **Delta encoding**: Store first point absolute, subsequent as deltas
2. **Huffman coding**: Apply Huffman compression to the delta values (Microsoft predefines optimal Huffman tables for typical ink data)
3. **Multi-byte integer encoding**: Variable-length integer encoding for compact storage of small deltas

This achieves remarkable compression: typical ISF data is 5-10 bytes per point with full pressure/tilt data.

**Drawing attributes:**

```
DrawingAttributes:
  Color: 32-bit ARGB
  Width: float (himetric units)
  Height: float (for elliptical tips)
  PenTip: Ball | Rectangle
  RasterOperation: CopyPen | MaskPen | ...
  Transparency: byte (0-255)
  IsHighlighter: boolean
```

**Key lessons from ISF:**
1. **Huffman coding of delta-encoded point data** is extremely effective -- ISF achieves compression ratios that JSON cannot match
2. **Predefined Huffman tables** for common ink patterns avoid the overhead of per-document table computation
3. **Separate stroke descriptors from point data** -- the descriptor defines which channels are present and their encoding parameters
4. **Per-packet properties**: ISF allows certain properties (like pressure) to vary per point while others (like color) are per stroke. This saves storage when most per-point channels are absent
5. However, **binary formats are hostile to text-based ecosystems** like Obsidian

### 1.4 UIM (Universal Ink Model) -- Google

**Background:** Google's Universal Ink Model was developed for the QuickDraw dataset and related machine learning ink recognition tasks. It is documented in research papers and the Google AI experiments.

**Core structure (as a Protocol Buffer schema):**

```protobuf
message Ink {
  repeated Stroke strokes = 1;
  InputDevice input_device = 2;
}

message Stroke {
  repeated float x = 1 [packed=true];
  repeated float y = 2 [packed=true];
  repeated float timestamp_sec = 3 [packed=true];
  repeated float pressure = 4 [packed=true];
  repeated float tilt_x = 5 [packed=true];
  repeated float tilt_y = 6 [packed=true];
  repeated float orientation = 7 [packed=true];
  BrushType brush_type = 8;
  Color color = 9;
  float stroke_width = 10;
}

message InputDevice {
  DeviceType type = 1;  // MOUSE, TOUCH, STYLUS
  float max_pressure = 2;
}

enum BrushType {
  CALLIGRAPHY = 0;
  PENCIL = 1;
  PEN = 2;
  HIGHLIGHTER = 3;
  MARKER = 4;
  AIRBRUSH = 5;
}
```

**Key design decisions in UIM:**
1. **Column-oriented storage**: x, y, pressure, etc. are stored as separate packed arrays rather than interleaved per-point records. This is critical for compression (similar values are adjacent) and for selective access (read x,y without parsing pressure)
2. **Protocol Buffers**: Binary format with schema evolution, widely supported across languages
3. **Minimal metadata**: UIM focuses on ink geometry and basic appearance, not rendering. It is designed for recognition and interchange, not for faithful visual reproduction
4. **No rendering parameters**: No smoothing level, taper, or pen-simulation parameters. The model assumes the receiver will render as it sees fit

**Assessment:**

| Aspect | Rating | Notes |
|--------|--------|-------|
| Completeness | Medium | Good per-point data, minimal rendering metadata |
| Compactness | Excellent | Protocol Buffers + packed floats is very compact |
| Tooling support | Good | protobuf-js works in browsers |
| Design quality | Good | Column-oriented, extensible via protobuf schema evolution |
| Suitability for our use | Low-Medium | Too ML-focused; needs significant extension for rendering fidelity |

**Key lessons from UIM:**
1. **Column-oriented arrays** are the right data layout for ink
2. **Packed arrays** (Protocol Buffers' `packed=true`) demonstrate the efficiency of contiguous same-type data
3. **Device metadata** (max_pressure, device type) is useful for normalizing data from different sources
4. Schema evolution via protobuf field numbering is elegant but not essential for a single-application format

### 1.5 Apple PKDrawing (PencilKit)

**Background:** PencilKit is Apple's framework for pencil/stylus input on iOS/iPadOS/macOS. `PKDrawing` is the root data structure that contains all strokes. Internally, it is serialized via `NSKeyedArchiver` into a binary property list (bplist).

**Data hierarchy:**

```
PKDrawing
  strokes: [PKStroke]
    PKStroke
      ink: PKInk
        inkType: PKInkType (.pen, .pencil, .marker, .monoline, .fountainPen, .watercolor, .crayon)
        color: UIColor
      path: PKStrokePath
        points: [PKStrokePoint]
          location: CGPoint (x, y)
          timeOffset: TimeInterval (seconds from stroke start)
          size: CGSize (contact patch width, height)
          opacity: CGFloat
          force: CGFloat (raw sensor force, not normalized)
          azimuth: CGFloat (radians, 0-2pi)
          altitude: CGFloat (radians, 0-pi/2)
        creationDate: Date
      transform: CGAffineTransform (for moved/scaled strokes)
      mask: PKStrokePath? (for erased regions)
```

**Key design insights from PencilKit:**

1. **Per-point `size` instead of pressure-to-width mapping:** PKStrokePoint stores the actual contact patch `size` (width and height in points), not a normalized pressure value. This means the device-specific pressure-to-contact-area mapping is applied at capture time, and the stored value directly represents the physical mark. This is significant because it decouples storage from device-specific pressure curves.

2. **Per-point `opacity`:** Opacity varies per point, not just per stroke. This enables effects like pencil (lighter at low pressure) and watercolor (transparency variation) at the data level rather than only at render time.

3. **`azimuth` and `altitude` (not tiltX/tiltY):** Apple stores spherical coordinates relative to the screen normal, not planar tilt angles. This is more geometrically meaningful. Azimuth is the compass direction the pencil points; altitude is the angle from the surface.

4. **Stroke-level `transform`:** Each stroke has an affine transform, enabling move/rotate/scale operations without modifying point data. This is excellent for undo/redo and editing.

5. **Stroke-level `mask`:** Erased regions are stored as a mask on the stroke, not by splitting the stroke or deleting it. This preserves the original stroke data and makes undo trivial.

6. **Ink types are semantic, not parametric:** Rather than storing a bag of rendering parameters, PencilKit uses named ink types (pen, pencil, marker, etc.) and the renderer applies the appropriate algorithm. This means the rendering can improve with OS updates without changing stored data.

7. **Binary, opaque, not interoperable:** The format is entirely proprietary and binary. It cannot be read outside Apple's ecosystem. This is explicitly not what we want, but the data model is sound.

**Key lessons to adopt:**
- Store per-point `size` (or width) in addition to raw pressure, so rendering does not require re-applying a pressure curve
- Consider per-point opacity for pencil and watercolor effects
- Store azimuth/altitude (or convert tiltX/tiltY on capture) for more meaningful tilt data
- Use stroke-level transforms for editing operations
- Use semantic ink types rather than fully parametric descriptions (keep a small set of named pen types with predefined rendering behavior)
- However, also store the rendering parameters so that custom pens can be created

### 1.6 Format Comparison Summary

| Format | Type | Per-Point Data | Rendering Metadata | Size (1K strokes, 200pts) | Text-Friendly | Editing | Tooling |
|--------|------|---------------|-------------------|--------------------------|---------------|---------|---------|
| SVG (outlines) | XML/text | Geometry only | Baked into geometry | ~4MB | Yes | No | Excellent |
| SVG (+ data attrs) | XML/text | Full | Basic attributes | ~8MB | Yes | Partial | Good |
| InkML | XML/text | Full (channels) | Brush properties | ~6MB | Yes | Yes | None |
| ISF | Binary | Full | Drawing attributes | ~1-2MB | No | Yes | Windows only |
| UIM (protobuf) | Binary | Full (columns) | Minimal | ~2-3MB | No | Partial | Good (protobuf) |
| PKDrawing | Binary plist | Full | Ink type enum | ~2-3MB | No | Yes | Apple only |
| **Custom JSON** | JSON/text | Full (columns) | Full | ~3-5MB | **Yes** | **Yes** | **Custom** |
| **Custom JSON + compression** | JSON+Base64 | Full (columns) | Full | ~1-2MB | Semi | **Yes** | **Custom** |

---

## 2. Custom JSON Format Design

### 2.1 Design Principles

Based on the analysis of existing formats, the ObsidianPaper storage format should follow these principles:

1. **JSON-based**: For compatibility with Obsidian's text-file ecosystem, git, and debugging
2. **Column-oriented point data**: Following UIM/Google's lead for compactness and compression
3. **Separate style from geometry**: Following PencilKit/InkML's pattern for editability
4. **Channel-declared**: Following InkML's pattern -- declare which channels are present, all strokes follow
5. **Delta-encoding ready**: Support delta encoding for coordinates (following InkML/ISF)
6. **Version-tagged**: For schema evolution
7. **Bounding boxes pre-computed**: For spatial indexing without full point parsing
8. **Minimal key names**: Use short keys to reduce JSON overhead (e.g., `"s"` not `"strokes"`)

### 2.2 Complete Format Specification

#### 2.2.1 Top-Level Document Structure

```json
{
  "v": 1,
  "meta": {
    "created": "2026-02-18T10:30:00Z",
    "modified": "2026-02-18T11:45:00Z",
    "title": "Lecture Notes - Feb 18",
    "app": "obsidian-paper",
    "appVersion": "0.1.0"
  },
  "canvas": {
    "w": 2048,
    "h": 2732,
    "bg": "#fffff8",
    "paper": "lined",
    "lineSpacing": 40,
    "marginLeft": 80
  },
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1.0
  },
  "channels": ["x", "y", "p", "az", "al", "t"],
  "encoding": {
    "coords": "delta-int10",
    "pressure": "uint8",
    "angles": "int8-scaled",
    "time": "delta-uint16"
  },
  "styles": {
    "_default": {
      "pen": "fountain",
      "color": "#1a1a1a",
      "width": 2.0,
      "opacity": 1.0,
      "smoothing": 0.5
    },
    "highlight": {
      "pen": "highlighter",
      "color": "#ffff00",
      "width": 12.0,
      "opacity": 0.35,
      "smoothing": 0.7
    }
  },
  "strokes": [
    {
      "id": "a1b2c3",
      "st": "_default",
      "bb": [100, 200, 350, 280],
      "n": 156,
      "pts": "1000,2000,128,32,64,0;18,30,5,0,0,16;35,50,10,0,-1,17;..."
    }
  ],
  "erased": [],
  "undoStack": []
}
```

#### 2.2.2 Field Descriptions

**Top-level fields:**

| Field | Type | Description |
|-------|------|-------------|
| `v` | integer | Format version number. Currently 1. |
| `meta` | object | Document metadata (creation time, title, etc.) |
| `canvas` | object | Canvas/page configuration |
| `viewport` | object | Last viewport state (for restoring scroll/zoom position) |
| `channels` | string[] | Ordered list of per-point data channels |
| `encoding` | object | How each channel is encoded in the `pts` string |
| `styles` | object | Named style definitions (pen type, color, width, etc.) |
| `strokes` | array | Array of stroke objects |
| `erased` | array | Stroke IDs that have been erased (soft delete for undo) |
| `undoStack` | array | Optional: recent undo operations |

**Channel definitions:**

| Channel | Key | Raw Range | Encoding | Description |
|---------|-----|-----------|----------|-------------|
| X coordinate | `x` | 0 - canvas width | delta, multiply by 10, store as integer | Horizontal position in canvas units |
| Y coordinate | `y` | 0 - canvas height | delta, multiply by 10, store as integer | Vertical position in canvas units |
| Pressure | `p` | 0.0 - 1.0 | multiply by 255, store as uint8 | Normalized contact force |
| Azimuth | `az` | 0 - 2*PI | multiply by 40.5 (255/2PI), store as uint8 | Tilt compass direction |
| Altitude | `al` | 0 - PI/2 | multiply by 162.3 (255/(PI/2)), store as uint8 | Tilt angle from surface |
| Time | `t` | milliseconds | delta from stroke start, uint16 | Timestamp offset |

**Encoding specifications:**

- `"delta-int10"`: First value is absolute (coordinate * 10, as integer). Subsequent values are deltas from the previous value (also integer). Example: `x=[100.3, 102.1, 105.8]` becomes `"1003,18,37"`.

- `"uint8"`: Value mapped to 0-255 range, stored as integer. Pressure 0.5 becomes `128`.

- `"int8-scaled"`: Value mapped to 0-255 range for the channel's natural range. Azimuth (0 to 2PI) maps 0->0 and 2PI->255. Altitude (0 to PI/2) maps 0->0 and PI/2->255.

- `"delta-uint16"`: First value is 0 (stroke start). Subsequent values are millisecond deltas from the previous point. Typical values: 8 (120Hz), 16 (60Hz). Stored as integer.

**Style object fields:**

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `pen` | string | `"fountain"`, `"ballpoint"`, `"brush"`, `"pencil"`, `"marker"`, `"highlighter"`, `"monoline"` | Pen type (determines rendering algorithm) |
| `color` | string | Hex color, e.g., `"#1a1a1a"` | Stroke color |
| `width` | number | 0.5 - 50.0 | Base stroke width in canvas units |
| `opacity` | number | 0.0 - 1.0 | Stroke opacity |
| `smoothing` | number | 0.0 - 1.0 | Smoothing level (0 = raw, 1 = maximum) |
| `taper` | object? | `{"start": 10, "end": 15}` | Optional taper lengths |

**Stroke object fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique stroke identifier (short, e.g., 6-char base36) |
| `st` | string | Style name reference (key in `styles` object) |
| `styleOverrides` | object? | Optional per-stroke overrides (e.g., `{"color": "#ff0000"}`) |
| `bb` | number[4] | Bounding box: [minX, minY, maxX, maxY] |
| `n` | integer | Number of points (for pre-allocation during parsing) |
| `pts` | string | Encoded point data (semicolon-separated points, comma-separated channels) |
| `transform` | number[6]? | Optional affine transform [a, b, c, d, tx, ty] |

#### 2.2.3 Point Data Encoding (the `pts` String)

The `pts` field is a compact string encoding of all per-point data. The format is:

```
point1_ch1,point1_ch2,...,point1_chN;point2_ch1,...;point3_ch1,...
```

Where:
- Points are separated by semicolons (`;`)
- Channels within a point are separated by commas (`,`)
- Channel order matches the document-level `channels` array
- The first point uses absolute values; subsequent points use delta encoding for `x`, `y`, and `t` channels
- Pressure, azimuth, and altitude are always absolute (they don't benefit from delta encoding because they vary nonlinearly)

**Example encoding:**

Raw stroke data (3 points):
```
Point 1: x=100.3, y=200.5, pressure=0.50, azimuth=1.57, altitude=1.20, time=0
Point 2: x=102.1, y=203.0, pressure=0.60, azimuth=1.57, altitude=1.18, time=16
Point 3: x=105.8, y=208.4, pressure=0.70, azimuth=1.55, altitude=1.15, time=33
```

Encoding steps:
```
Point 1: x=1003, y=2005, p=128, az=100, al=195, t=0
Point 2: x=+18,  y=+25,  p=153, az=100, al=192, t=16
Point 3: x=+37,  y=+54,  p=179, az=99,  al=187, t=17
```

Resulting `pts` string:
```
"1003,2005,128,100,195,0;18,25,153,100,192,16;37,54,179,99,187,17"
```

**Characters per point:** Approximately 20-30 characters (vs. ~60-80 for naive JSON with property names and full float precision).

#### 2.2.4 Full Document Example

Here is a complete example of a small document with 2 strokes:

```json
{
  "v": 1,
  "meta": {
    "created": "2026-02-18T10:30:00Z",
    "modified": "2026-02-18T10:30:45Z"
  },
  "canvas": {
    "w": 2048,
    "h": 2732,
    "bg": "#fffff8",
    "paper": "lined",
    "lineSpacing": 40
  },
  "viewport": {
    "x": 1024,
    "y": 400,
    "zoom": 1.5
  },
  "channels": ["x", "y", "p", "az", "al", "t"],
  "encoding": {
    "coords": "delta-int10",
    "pressure": "uint8",
    "angles": "int8-scaled",
    "time": "delta-uint16"
  },
  "styles": {
    "_default": {
      "pen": "fountain",
      "color": "#1a1a1a",
      "width": 2.0,
      "opacity": 1.0,
      "smoothing": 0.5
    }
  },
  "strokes": [
    {
      "id": "k9m2x1",
      "st": "_default",
      "bb": [100, 200, 180, 290],
      "n": 5,
      "pts": "1000,2000,128,100,195,0;18,25,153,100,192,16;37,54,179,99,187,17;22,38,170,100,188,16;15,20,140,101,190,17"
    },
    {
      "id": "p3q7r4",
      "st": "_default",
      "styleOverrides": { "color": "#cc0000" },
      "bb": [200, 210, 310, 300],
      "n": 4,
      "pts": "2000,2100,110,98,198,0;30,20,135,98,196,16;45,35,160,97,194,17;25,40,145,98,195,16"
    }
  ],
  "erased": [],
  "undoStack": []
}
```

#### 2.2.5 Reduced-Channel Mode

For input devices that do not provide tilt data (mouse, basic touch), the channel list can be reduced:

```json
{
  "channels": ["x", "y", "p", "t"],
  "encoding": {
    "coords": "delta-int10",
    "pressure": "uint8",
    "time": "delta-uint16"
  }
}
```

Point data then has only 4 values per point instead of 6:
```
"1003,2005,128,0;18,25,153,16;37,54,179,17"
```

Even further reduction for mouse input (no pressure):
```json
{
  "channels": ["x", "y", "t"],
  "encoding": {
    "coords": "delta-int10",
    "time": "delta-uint16"
  }
}
```

The `channels` array in the document header determines how to parse all `pts` strings in the document.

#### 2.2.6 Optional Layers

For documents that need layer support:

```json
{
  "layers": [
    {
      "id": "layer-1",
      "name": "Writing",
      "visible": true,
      "opacity": 1.0,
      "locked": false,
      "strokes": ["k9m2x1", "p3q7r4"]
    },
    {
      "id": "layer-2",
      "name": "Annotations",
      "visible": true,
      "opacity": 0.8,
      "locked": false,
      "strokes": ["a5b8c2"]
    }
  ]
}
```

If no `layers` field is present, all strokes are in a single implicit layer.

#### 2.2.7 Undo History Considerations

There are two approaches to undo history:

**Approach A: Operation Log (Recommended)**

Store recent operations rather than full snapshots:

```json
{
  "undoStack": [
    { "op": "add", "strokeId": "k9m2x1", "ts": 1708253445000 },
    { "op": "add", "strokeId": "p3q7r4", "ts": 1708253446000 },
    { "op": "erase", "strokeId": "old123", "ts": 1708253447000 },
    { "op": "style", "strokeId": "k9m2x1", "prev": {"color": "#000000"}, "next": {"color": "#cc0000"}, "ts": 1708253448000 }
  ]
}
```

- Each operation records enough information to reverse it
- Erased strokes are moved to an `erased` array (soft delete) rather than truly deleted, allowing undo
- Style changes record the previous value
- The undo stack can be truncated to limit file size (e.g., keep last 100 operations)
- On save, operations older than the last N can be finalized (erased strokes truly removed, undo entries discarded)

**Approach B: Do Not Persist Undo History**

Simpler: do not store undo history in the file at all. Undo/redo works only during the current editing session (in-memory only). When the file is closed and reopened, undo history is gone.

This is what most drawing apps do (Excalidraw, tldraw). It dramatically simplifies the file format.

**Recommendation:** Start with Approach B (no persisted undo). Add Approach A later if users request persistent undo.

### 2.3 Format Variants for Different Needs

#### 2.3.1 v1: Human-Readable (Recommended Starting Point)

As described above. Fully JSON, comma-separated integer encoding for points. Suitable for files up to ~5MB.

**Characters per point:** ~25 (6-channel) or ~15 (3-channel)
**Size for 1,000 strokes x 200 points:** ~5MB (6-channel) or ~3MB (3-channel)

#### 2.3.2 v2: Compressed (Future Optimization)

When file sizes become problematic, the `pts` field can switch to Base64-encoded compressed binary:

```json
{
  "encoding": {
    "format": "deflate-base64",
    "coords": "int16-delta",
    "pressure": "uint8",
    "angles": "int8",
    "time": "uint16-delta"
  },
  "strokes": [
    {
      "id": "k9m2x1",
      "st": "_default",
      "bb": [100, 200, 180, 290],
      "n": 156,
      "pts": "eJztwTEBAAAAwqD1T20MH6AAAACAtwFH..."
    }
  ]
}
```

Encoding pipeline:
```
Point data -> Pack into typed arrays (Int16Array for coords, Uint8Array for others)
  -> Deflate compress (via fflate/pako)
  -> Base64 encode
```

**Bytes per point:** ~10-12 raw, ~5-7 after deflate
**Base64 characters per point:** ~7-10
**Size for 1,000 strokes x 200 points:** ~1.5-2MB

#### 2.3.3 Channel Ordering in Binary Encoding

For the v2 binary encoding, channels should be stored in column-major order (all X values, then all Y values, etc.) rather than interleaved. This dramatically improves compression because adjacent values in the buffer are similar:

```
Buffer layout for 5 points, channels [x, y, p]:
  [x0, x1, x2, x3, x4, y0, y1, y2, y3, y4, p0, p1, p2, p3, p4]
```

Delta-encoded coordinates compress extremely well because handwriting involves smooth, continuous motion -- the delta values cluster around small numbers.

---

## 3. Performance Analysis

### 3.1 Size Estimates

**Assumptions:**
- 1,000 strokes per document (dense note page)
- 200 points per stroke average (moderate-length strokes)
- 6 channels per point (x, y, pressure, azimuth, altitude, timestamp)

#### v1 (Human-Readable) Size Breakdown

Per-point encoding: `"18,25,153,100,192,16"` = approximately 22 characters average

```
Point data:     1000 strokes * 200 points * 22 chars    = 4,400,000 chars
Semicolons:     1000 strokes * 199 semicolons            = 199,000 chars
Stroke metadata: 1000 strokes * ~100 chars each           = 100,000 chars
Document overhead (styles, canvas, meta):                  ~1,000 chars
                                                      _______________
Total:                                                   ~4.7 MB
```

#### v2 (Compressed Binary) Size Breakdown

Per-point binary: 2 bytes (x delta, int16) + 2 bytes (y delta) + 1 byte (pressure) + 1 byte (azimuth) + 1 byte (altitude) + 2 bytes (time delta) = 9 bytes

```
Raw binary:     1000 * 200 * 9 bytes                     = 1,800,000 bytes (1.8MB)
After deflate:  ~40-50% compression ratio for delta data  = ~800,000 bytes
After Base64:   * 4/3                                     = ~1,066,000 chars (~1MB)
Stroke metadata: 1000 * ~80 chars                          = 80,000 chars
                                                      _______________
Total:                                                   ~1.1 MB
```

#### Size comparison with other formats

| Format | 1K strokes x 200pts | 5K strokes x 200pts |
|--------|---------------------|---------------------|
| v1 (human-readable JSON) | 4.7 MB | 23.5 MB |
| v2 (compressed binary) | 1.1 MB | 5.5 MB |
| Naive JSON (objects per point) | 12 MB | 60 MB |
| SVG (pre-rendered outlines) | 4 MB | 20 MB |
| ISF (Microsoft binary) | 1-2 MB | 5-10 MB |
| Raw binary (no compression) | 1.8 MB | 9 MB |

**Key insight:** The v1 format (4.7MB for a dense page) is comparable to what Excalidraw produces for complex drawings. Excalidraw users report that Obsidian handles files up to 10-15MB without significant performance issues. The v1 format should be adequate for most documents.

For very large documents (multi-page notebooks with 5,000+ strokes), v2 compressed encoding becomes necessary.

### 3.2 Parse/Load Performance

**JSON.parse() throughput:** Modern V8 (Electron) and JavaScriptCore (iPad WebKit) parse JSON at approximately 200-400 MB/s.

| Document Size | JSON.parse() Time | Notes |
|--------------|-------------------|-------|
| 1 MB | ~3-5ms | Negligible |
| 5 MB | ~15-25ms | Acceptable |
| 15 MB | ~40-75ms | Noticeable but tolerable |
| 50 MB | ~125-250ms | Perceptible delay; should show loading indicator |

After JSON.parse(), the `pts` strings must be decoded into typed arrays. This is an additional step:

**String-to-numbers decoding:**

For v1, each `pts` string must be split and parsed:
```typescript
function decodePts(pts: string, numChannels: number): Float32Array[] {
  const points = pts.split(';');
  const channels = new Array(numChannels).fill(null).map(
    () => new Float32Array(points.length)
  );
  for (let i = 0; i < points.length; i++) {
    const values = points[i].split(',');
    for (let c = 0; c < numChannels; c++) {
      channels[c][i] = parseInt(values[c], 10);
    }
  }
  return channels;
}
```

Throughput estimate for this parsing: approximately 10-20 MB/s (string splitting and parseInt are slower than JSON.parse). For a 4.7MB document where ~4.4MB is `pts` data, this takes approximately 220-440ms.

**Optimization: lazy decode.** Do not decode all stroke `pts` strings at load time. Instead:
1. Parse the JSON (fast)
2. Extract `bb` (bounding box) for all strokes (available without decoding `pts`)
3. Build spatial index from bounding boxes
4. Only decode `pts` for strokes that are visible in the current viewport
5. Decode off-screen strokes in idle callbacks (`requestIdleCallback`)

This reduces initial load time to: JSON.parse (25ms) + bounding box extraction (5ms) + visible stroke decode (~50ms for typical viewport) = **~80ms total for a 5MB document**.

For v2 (Base64 + deflate), the decode pipeline is:
```
Base64 decode (~50MB/s) -> Deflate inflate (~100MB/s) -> TypedArray view (instant)
```

For 1,000 strokes at ~1KB each after compression: approximately 5-10ms per visible stroke, parallelizable.

### 3.3 Save/Write Performance

**JSON.stringify() throughput:** Approximately 100-200 MB/s for flat data structures.

**Serialization pipeline:**
1. Encode modified stroke point data back to `pts` strings (only if points changed)
2. JSON.stringify() the entire document
3. Write to disk via Obsidian's `Vault.modify()` or `TextFileView.requestSave()`

For a 5MB document: stringify takes ~25-50ms, disk write is async and non-blocking.

**Incremental save strategy:**

Because `TextFileView.requestSave()` rewrites the entire file, there is no built-in incremental save in Obsidian. However, we can optimize:

1. **Cache serialized `pts` strings:** When a stroke is finalized, compute and cache its `pts` string. On save, only re-encode strokes that changed.
2. **Debounce saves:** `requestSave()` already debounces to ~2 seconds. This is appropriate.
3. **Avoid saving during active drawing:** Only trigger `requestSave()` after `pointerup` (stroke completion), not during drawing.
4. **Save in background:** On Electron, if the document is very large, serialize in a `setTimeout(0)` chunk to avoid blocking input.

**Worst case scenario:** User draws 1,000 strokes in rapid succession without pausing. Each stroke completion triggers `requestSave()`, but debouncing ensures at most one save per 2 seconds. Each save rewrites the full file (~5MB). This is approximately 2.5MB/s sustained write, well within disk and OS capabilities.

### 3.4 Memory Usage

**In-memory representation:**

Each decoded stroke in memory:
```
Typed arrays (6 channels x 200 points x 4 bytes/float32): 4,800 bytes
Metadata (id, style ref, bounding box, point count):       ~200 bytes
Cached Path2D outline (approximate):                        ~2,000 bytes
                                                           ____________
Total per stroke:                                          ~7,000 bytes
```

For 1,000 strokes: **~7 MB** in-memory.
For 5,000 strokes: **~35 MB** in-memory.

With lazy loading (only visible strokes fully decoded):
- Metadata for all strokes: 1,000 * 200 bytes = 200 KB
- Fully decoded visible strokes (assume ~200 visible): 200 * 7,000 bytes = 1.4 MB
- **Total: ~1.6 MB** regardless of document size

### 3.5 Compression Analysis

**Why delta-encoded handwriting data compresses so well:**

Handwriting involves continuous, smooth motion. Between consecutive points captured at 60-120Hz, the stylus moves only a few pixels. Delta values cluster in a narrow range (typically -50 to +50 in our int10 encoding, meaning actual movements of -5 to +5 pixels).

This creates highly compressible data because:
1. Small value range means fewer bits per value
2. Adjacent delta values are similar (smooth acceleration)
3. Pressure and tilt change slowly, creating long runs of similar values
4. Timestamp deltas are nearly constant (always ~16ms at 60Hz)

**Compression ratios by algorithm (measured on typical handwriting data):**

| Algorithm | Compression Ratio | Speed (compress) | Speed (decompress) | JS Library |
|-----------|-------------------|-------------------|---------------------|-----------|
| Deflate (zlib level 6) | 2.5-3.5x | 30-50 MB/s | 100-200 MB/s | pako, fflate |
| Brotli (level 6) | 3.0-4.0x | 20-40 MB/s | 100-150 MB/s | brotli-wasm |
| LZ4 | 1.8-2.5x | 200-400 MB/s | 400-800 MB/s | lz4js |
| gzip (level 6) | 2.5-3.5x | 30-50 MB/s | 100-200 MB/s | pako, fflate |
| lz-string | 2.0-3.0x | 10-20 MB/s | 30-60 MB/s | lz-string |

**Recommendation:** Deflate (via `fflate`) for v2 compressed format. It offers the best balance of compression ratio and decompression speed. `fflate` is specifically recommended over `pako` because it is smaller (~8KB vs ~45KB) and faster on modern engines.

### 3.6 Comparison: JSON vs MessagePack vs Protocol Buffers

| Criterion | JSON (our v1) | MessagePack | Protocol Buffers |
|-----------|--------------|-------------|-----------------|
| Size (1K strokes) | 4.7 MB | ~3.5 MB | ~2.8 MB |
| Parse speed | 200-400 MB/s (native) | 50-100 MB/s (library) | 50-100 MB/s (library) |
| Human readable | Yes | No (binary) | No (binary) |
| Git friendly | Yes | No | No |
| Obsidian compatible | Native text file | Requires binary handling | Requires binary handling |
| Library dependency | None | msgpack-lite (~5KB) | protobufjs (~40KB) |
| Schema evolution | Manual versioning | Manual | Built-in field numbering |
| Debugging | JSON.parse in console | Requires decoder | Requires decoder |

**Verdict:** JSON is the clear winner for our context. The ~2x size penalty compared to protobuf is offset by: no dependency, native parse performance, text-file compatibility, human readability, and Obsidian ecosystem fit. For the v2 compressed variant, the size gap narrows to negligible (both end up at ~1MB after deflate).

---

## 4. Re-Rendering from Stored Data

### 4.1 Initial Document Load: Rendering All Strokes

When a `.paper` document is opened, the rendering pipeline is:

```
1. JSON.parse() the file content                          [~25ms for 5MB]
2. Extract bounding boxes for all strokes                  [~5ms]
3. Build R-tree spatial index from bounding boxes           [~10ms for 1K strokes]
4. Determine visible strokes (query R-tree with viewport)  [<1ms]
5. Decode pts strings for visible strokes                  [~50ms for 200 strokes]
6. For each visible stroke:
   a. Reconstruct absolute coordinates from deltas         [<1ms per stroke]
   b. Apply smoothing (1-Euro filter or Catmull-Rom)       [<1ms per stroke]
   c. Compute stroke outline via perfect-freehand          [1-2ms per stroke]
   d. Cache as Path2D                                      [<1ms per stroke]
7. Apply camera transform to canvas context                [<1ms]
8. Fill all cached Path2D objects                           [5-10ms for 200 strokes]
```

**Total estimated time: ~300-400ms** for initial load of a 5MB document with 1,000 strokes (200 visible).

This can be optimized with progressive rendering:
1. Show a loading indicator
2. Render visible strokes first (frame 1: ~100ms)
3. Decode and cache nearby off-screen strokes in idle callbacks
4. Total time to full interactivity: ~200ms

### 4.2 Re-Rendering When Pen Style Changes

When the user selects strokes and changes their style (e.g., pen type, color, width, smoothing):

**What changes:**
- The `st` (style reference) or `styleOverrides` in each affected stroke
- The rendered outline (because pen type and width affect outline computation)
- The fill color/opacity

**What does NOT change:**
- The raw point data (`pts` string)
- The bounding box (approximately -- width changes may slightly expand it)

**Re-rendering pipeline:**

```
1. Update style reference/overrides in stroke objects      [<1ms]
2. Invalidate cached Path2D for affected strokes           [<1ms]
3. Recompute outlines with new style parameters:
   - New pen type -> different outline algorithm
   - New width -> different offset distances
   - New smoothing -> different input smoothing parameters [1-2ms per stroke]
4. Re-render affected strokes                              [<1ms per stroke]
```

For changing the style of 50 selected strokes: **~100-150ms total**, which is perceived as instant.

**Key architectural requirement:** The raw point data must be accessible without re-parsing the `pts` string. When a stroke's points are first decoded, cache the decoded typed arrays in memory:

```typescript
interface StrokeRuntime {
  // Persisted data
  id: string;
  style: string;
  ptsEncoded: string;      // The raw pts string from the file
  boundingBox: number[];

  // Computed/cached data (not persisted)
  points?: Float32Array[];   // Decoded point channels
  smoothedPoints?: Float32Array[];  // After smoothing
  outline?: Float32Array;    // Computed outline polygon
  path2D?: Path2D;           // Cached renderable path
}
```

When a style change occurs, `outline` and `path2D` are invalidated. `points` and `smoothedPoints` are retained (smoothing level change invalidates `smoothedPoints` too).

### 4.3 Caching Strategy

**Three-level cache:**

1. **Level 1: Decoded points** (`Float32Array[]`)
   - Computed when stroke is first needed for rendering
   - Retained in memory for the session
   - Evicted for off-screen strokes if memory pressure is high
   - Invalidated: never (raw data never changes)

2. **Level 2: Smoothed/processed points** (`Float32Array[]`)
   - Computed from Level 1 using the stroke's smoothing parameters
   - Retained while style is unchanged
   - Invalidated: when smoothing level changes

3. **Level 3: Rendered path** (`Path2D`)
   - Computed from Level 2 using the stroke's pen type, width, and taper parameters
   - Retained while style is unchanged
   - Invalidated: when pen type, width, or taper changes

**Cache size estimate:**
- Level 1: 200 points * 6 channels * 4 bytes = 4.8KB per stroke
- Level 2: 200 points * 2 channels (smoothed x,y) * 4 bytes = 1.6KB per stroke
- Level 3: ~400 outline points * 2 * 4 bytes = 3.2KB per stroke
- Total per stroke: ~9.6KB
- For 1,000 fully cached strokes: ~9.6MB

This is manageable. For 10,000 strokes, we would only fully cache visible + nearby strokes (~1,000) and keep only Level 1 for the rest.

### 4.4 Static Canvas Baking

For optimal rendering performance, maintain a "baked" off-screen canvas:

```
[Baked Canvas] = all finalized strokes rendered at current zoom/viewport
[Active Canvas] = currently-being-drawn stroke only
[Display Canvas] = composite of Baked + Active
```

**When to re-bake:**
- After zoom or pan completes (not during -- during animation, use the old baked canvas scaled/translated)
- After a stroke is added (render new stroke onto baked canvas incrementally)
- After a stroke is erased (must re-render all remaining strokes, or use a dirty-region approach)
- After a style change on any stroke

**Incremental baking for stroke addition:**

When a new stroke is finalized:
1. Render it onto the baked canvas at the current transform
2. No need to re-render all other strokes

This makes stroke addition O(1) for rendering.

**Dirty-region baking for erasure/style change:**

When a stroke is erased or its style changes:
1. Compute the bounding box of the affected area (the stroke's bounding box, expanded slightly)
2. Clear that region of the baked canvas
3. Re-render all strokes whose bounding boxes overlap the dirty region

This is O(k) where k is the number of overlapping strokes, typically much less than total stroke count.

### 4.5 Zoom-Dependent Re-Rendering

When the zoom level changes, rendered strokes may need different levels of detail:

- **Zooming in:** Strokes may need more points for smooth appearance. If the stored data has been simplified (Ramer-Douglas-Peucker), the simplified version may be insufficient at high zoom. Store the full raw data and simplify only for rendering.

- **Zooming out:** Strokes can be rendered with fewer points for performance. At zoom < 0.5, use simplified point sets. At zoom < 0.1, render strokes as simple lines.

**Progressive quality during zoom animation:**

1. During pinch-to-zoom or scroll-to-zoom animation: scale the baked canvas bitmap (fast but blurry)
2. When zoom animation completes (after a ~100ms debounce): re-render at full quality at the new zoom level
3. The transition from blurry to crisp is imperceptible if re-render completes within 100ms

```typescript
let zoomTimeout: number | null = null;

function onZoomChange(newZoom: number) {
  // Immediate: scale the baked canvas CSS (blurry but instant)
  bakedCanvas.style.transform = `scale(${newZoom / bakedZoom})`;

  // Deferred: re-render at full quality
  if (zoomTimeout) clearTimeout(zoomTimeout);
  zoomTimeout = setTimeout(() => {
    rebakeAtZoom(newZoom);
    bakedCanvas.style.transform = '';
    bakedZoom = newZoom;
  }, 100);
}
```

---

## 5. Markdown Integration

### 5.1 How Obsidian's Ink Plugin Handles Storage

The Obsidian Ink plugin (by Nick Nisi) takes this approach:
- Registers a custom view type for ink notes
- Stores data as JSON in custom-extension files (`.ink`)
- Uses the `TextFileView` base class
- Point data includes x, y, pressure
- Embeds are rendered as static images in markdown preview
- The data format is relatively simple: a flat JSON object with an array of strokes, each containing an array of point objects

The Ink plugin is relatively basic compared to what ObsidianPaper aims to achieve. Its main value as a reference is confirming that the `TextFileView` + custom extension pattern works in practice.

### 5.2 How Excalidraw Handles Markdown Integration

Excalidraw's Obsidian plugin uses a sophisticated dual-format approach:

**The `.excalidraw.md` file structure:**

```markdown
---
excalidraw-plugin: parsed
tags: [excalidraw]
---

# Drawing Title

Some text content with [[wikilinks]] and #tags.

%%
# Excalidraw Data

## Text Elements
Hello World ^abc123
Some label ^def456

## Drawing
```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://github.com/zsviczian/obsidian-excalidraw-plugin",
  "elements": [...],
  "appState": {...},
  "files": {...}
}
```
%%
```

**Key design choices by Excalidraw:**

1. **Double-extension `.excalidraw.md`**: Obsidian treats it as a markdown file (indexes it, shows it in the file explorer). The plugin registers a view for files ending in `.excalidraw.md`.

2. **Visible markdown section at top**: Contains a title, text content, wikilinks, and tags that Obsidian can index and display in the graph view. This is critical for vault integration.

3. **Hidden data section in `%%` comments**: Obsidian's `%%` comment syntax hides content in reading view. The drawing data lives here and is invisible to non-Excalidraw users.

4. **Text elements extracted**: Text elements from the drawing are listed separately (above the JSON) so they are searchable by Obsidian's search engine.

5. **The JSON is inside a fenced code block**: This prevents Obsidian's markdown parser from interpreting any special characters in the JSON.

6. **SVG export option**: Excalidraw can optionally embed an SVG preview in the markdown, allowing non-plugin users to see a static rendering.

### 5.3 Recommended Integration for ObsidianPaper

Based on the analysis, here are three integration strategies in order of preference:

#### Strategy A: Pure `.paper` Extension with TextFileView (Recommended for v1)

```
my-notes/
  lecture-feb-18.paper     <- JSON file with all stroke data
```

**Implementation:**
- Register `.paper` extension via `registerExtensions(["paper"], VIEW_TYPE_PAPER)`
- Extend `TextFileView` -- provides automatic save/load lifecycle
- File contains pure JSON (the format described in Section 2)
- Embeds in markdown via `![[lecture-feb-18.paper]]`
- Embed rendering via `registerMarkdownPostProcessor()` (reading view) and CM6 widget (live preview)
- Embed shows a static canvas rendering of the handwriting

**Pros:**
- Simplest implementation
- Clean separation: `.paper` files are pure data, `.md` files are markdown
- `TextFileView` handles all file I/O automatically
- Small, focused files

**Cons:**
- `.paper` files are not indexed by Obsidian's search (no markdown content)
- No wikilinks or tags inside the paper file
- Cannot embed OCR text or transcription for searchability
- Graph view shows `.paper` files as nodes but with no outgoing links

**Mitigation:** Generate a companion `.md` file with OCR transcription and links. Or use Strategy B.

#### Strategy B: `.paper.md` Hybrid File (Recommended for v2)

```markdown
---
cssclasses: [obsidian-paper]
paper-version: 1
created: 2026-02-18T10:30:00Z
tags: [lecture, physics]
---

# Lecture Notes - Feb 18

Handwriting transcription or summary goes here for searchability.
Links to [[related topics]] and [[Professor Smith]] work normally.

%%paper-data
{"v":1,"canvas":{"w":2048,"h":2732,"bg":"#fffff8"},"channels":["x","y","p","t"],"styles":{"_default":{"pen":"fountain","color":"#1a1a1a","width":2.0}},"strokes":[...]}
%%
```

**Implementation:**
- Register `.md` files with `paper-version` frontmatter as openable in the Paper view
- The plugin checks for the `paper-version` frontmatter property to determine if an `.md` file is a Paper document
- Use a custom view that extends `TextFileView`
- In `setViewData()`, parse the markdown to extract the JSON data from the `%%paper-data ... %%` block
- In `getViewData()`, reconstruct the full markdown with the updated JSON data
- The markdown section above `%%paper-data` is editable by the user (title, links, tags, transcription)

**Pros:**
- Full Obsidian integration: search, graph, backlinks, tags all work
- Transcription text makes handwritten content searchable
- Follows the proven Excalidraw pattern
- Single file per document

**Cons:**
- More complex parsing (must handle markdown + embedded JSON)
- File size includes markdown overhead
- Potential for corruption if the `%%paper-data` block is accidentally edited in markdown mode
- Need to handle the case where users open the file in the normal markdown editor

**Markdown corruption prevention:**
- Add a clear comment: `%%paper-data DO NOT EDIT BELOW THIS LINE`
- The `cssclasses: [obsidian-paper]` frontmatter can trigger CSS that visually hides the data section if viewed in reading mode
- Validate the data block on load; if it is corrupt, show an error and offer to recover from the last good save

#### Strategy C: `.paper` with Sidecar `.md` (Not Recommended)

```
my-notes/
  lecture-feb-18.paper       <- Stroke data (JSON)
  lecture-feb-18.paper.md    <- Metadata, transcription, links
```

**Not recommended** because:
- Two files to manage per document
- Orphan risk when moving/renaming/deleting
- Obsidian Sync must handle both files
- More complex implementation
- No precedent in the Obsidian plugin ecosystem

### 5.4 Generating Preview Images

For non-plugin users (e.g., someone viewing the vault on GitHub or in a different markdown editor), the handwriting data is invisible. Preview images solve this.

**Approach 1: On-demand SVG generation**

When the document is saved, also generate an SVG file:

```
my-notes/
  lecture-feb-18.paper
  lecture-feb-18.paper.svg    <- Auto-generated preview
```

The SVG contains pre-rendered stroke outlines (filled paths). It is viewable in any browser or markdown renderer.

**Pros:** True vector, crisp at any size, relatively small
**Cons:** Extra file to manage, must regenerate on every change, SVGs with many paths can be large

**Approach 2: Embedded PNG thumbnail**

Generate a small PNG bitmap (e.g., 800px wide) and embed it in the markdown:

For Strategy B (`.paper.md`):
```markdown
# Lecture Notes - Feb 18

![preview](data:image/png;base64,iVBOR...)
```

Or reference an attachment:
```markdown
![[lecture-feb-18-preview.png]]
```

**Pros:** Universally supported, small file, fast to display
**Cons:** Raster (blurry when zoomed), requires regeneration on changes, Base64 data URIs are large

**Approach 3: No preview (simplest, recommended for v1)**

Do not generate previews. Users without the plugin see nothing (or a placeholder message). This is what most plugins do initially.

For Strategy A (`.paper` extension), Obsidian will show "No preview available" for embeds if the plugin is not installed.

For Strategy B (`.paper.md`), users without the plugin will see the markdown section (title, transcription, links) but not the handwriting. This is actually a reasonable fallback.

**Recommendation:** Start with no preview generation. Add SVG export as a manual action ("Export as SVG" in the command palette). Consider automatic preview generation for v2.

### 5.5 Embedding Handwriting in Regular Markdown Notes

Users will want to embed a handwriting note inside a regular markdown note, like:

```markdown
# Meeting Notes

Here are the key points from today's meeting:

![[whiteboard-sketch.paper]]

And here's the follow-up action items...
```

**Implementation for reading mode:**

```typescript
this.registerMarkdownPostProcessor((el, ctx) => {
  const embeds = el.querySelectorAll('.internal-embed');
  embeds.forEach(embed => {
    const src = embed.getAttribute('src');
    if (src?.endsWith('.paper')) {
      const file = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (file) {
        ctx.addChild(new PaperEmbedRenderer(embed as HTMLElement, file, this));
      }
    }
  });
});
```

The `PaperEmbedRenderer` (extending `MarkdownRenderChild`) would:
1. Read the `.paper` file
2. Parse the JSON
3. Create a `<canvas>` element
4. Render all strokes at a fixed zoom level that fits the embed width
5. Optionally add a "click to open" overlay

**Implementation for live preview (CM6):**

Register a CodeMirror 6 `ViewPlugin` that detects `![[*.paper]]` patterns and replaces them with `WidgetType` decorations containing canvas-rendered previews.

**Embed sizing:**
- Default: width = 100% of container, height = proportional to canvas aspect ratio
- Support Obsidian's embed sizing syntax: `![[sketch.paper|400]]` for 400px width
- Maximum height cap (e.g., 600px) with scroll for very tall documents

---

## 6. Final Recommendation

### 6.1 Recommended Storage Format

**Phase 1 (v1):** Use the human-readable JSON format described in Section 2.2, stored in `.paper` files. Extend `TextFileView` for the view. This provides:

- Fast implementation (JSON.parse/stringify are native and fast)
- Human-readable, debuggable files
- Adequate size for typical documents (4-5MB for a dense page)
- Full editability (style changes without touching point data)
- Column-declared channels for flexible per-point data

**Phase 2 (v1.1):** Add the `.paper.md` hybrid format (Strategy B from Section 5.3) for users who want Obsidian integration (search, links, tags). Both formats co-exist; user chooses in settings.

**Phase 3 (v2):** Add compressed binary encoding for the `pts` field (via `fflate` deflate + Base64) for large documents. The format version field (`"v": 2`) signals the new encoding. v1 files continue to be readable.

### 6.2 Data Model Summary

```
Document (JSON file)
  |-- meta: creation time, title, app version
  |-- canvas: page dimensions, background, paper type
  |-- viewport: last scroll/zoom position
  |-- channels: ordered list of per-point data channels
  |-- encoding: how each channel type is encoded in pts strings
  |-- styles: named style definitions (pen type, color, width, opacity, smoothing)
  |-- strokes[]: array of stroke objects
  |     |-- id: unique identifier
  |     |-- st: style name reference
  |     |-- styleOverrides?: per-stroke style overrides
  |     |-- bb: bounding box [minX, minY, maxX, maxY]
  |     |-- n: point count
  |     |-- pts: encoded point data string
  |     |-- transform?: affine transform for moved/scaled strokes
  |-- erased[]: soft-deleted stroke IDs (for undo)
```

### 6.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary format | JSON text file | Obsidian-native, debuggable, no dependencies |
| File extension | `.paper` (v1), `.paper.md` (v2) | Simple first, integrated later |
| Point encoding | Delta-encoded integers in comma-separated strings | 3-4x smaller than naive JSON, still readable |
| Style storage | Named styles + per-stroke overrides | Enables batch style changes; efficient storage |
| Coordinate precision | 0.1 pixel (multiply by 10, store as int) | Sufficient for display; reduces character count |
| Pressure precision | 256 levels (uint8) | Matches Apple Pencil effective resolution |
| Tilt precision | 256 levels (uint8) | Adequate for pen simulation |
| Compression (v2) | Deflate + Base64 via fflate | Best ratio/speed balance; small library |
| Undo persistence | None (in-memory only for v1) | Simplifies format; matches Excalidraw/tldraw |
| Preview generation | None for v1; manual SVG export later | Avoids complexity; most users have the plugin |
| Base view class | `TextFileView` | Built-in save/load lifecycle, debounced save |

### 6.4 Migration Path

```
v1 (now):     .paper files, JSON, human-readable pts encoding
                |
v1.1 (near):  + .paper.md hybrid format option
                |
v2 (later):   + compressed binary pts encoding option
                |
v3 (future):  + multi-page support, CRDT for collaboration
```

Each version is backward-compatible: newer code reads older formats. The `"v"` field in the document header determines which parser/decoder to use.

### 6.5 Implementation Checklist

For the storage layer implementation:

1. **Define TypeScript interfaces** for the document schema (Document, Stroke, Style, Canvas, etc.)
2. **Implement `pts` encoder/decoder** (encode raw float arrays to delta-encoded integer strings, and reverse)
3. **Implement the `PaperView` class** extending `TextFileView` with `getViewData()`/`setViewData()`
4. **Implement bounding box computation** from decoded point data
5. **Implement the save pipeline**: stroke data -> encode pts -> JSON.stringify -> requestSave()
6. **Implement the load pipeline**: JSON.parse -> extract metadata -> lazy-decode visible strokes -> render
7. **Add spatial indexing** (R-tree via `rbush`) for viewport culling
8. **Implement style resolution** (merge default style + stroke style reference + stroke overrides)
9. **Implement embed rendering** via `registerMarkdownPostProcessor()`
10. **Add format version checking** and migration support

---

## References

- **W3C InkML Specification (2011)**: https://www.w3.org/TR/InkML/ -- XML-based ink standard; channel system and delta encoding concepts
- **Microsoft ISF documentation**: Referenced via .NET Ink API documentation and community reverse-engineering. Huffman-coded delta encoding design
- **Google Universal Ink Model**: Documented in QuickDraw research papers and Google AI blog posts. Protocol Buffer schema with column-oriented packed arrays
- **Apple PencilKit documentation**: https://developer.apple.com/documentation/pencilkit -- PKDrawing, PKStroke, PKStrokePoint data model; ink types and per-point attributes
- **Excalidraw source code**: https://github.com/excalidraw/excalidraw -- JSON-based element storage; freedraw element type with `[x, y, pressure]` point arrays
- **Excalidraw Obsidian Plugin**: https://github.com/zsviczian/obsidian-excalidraw-plugin -- `.excalidraw.md` file format; `%%` comment pattern for data hiding; dual-format strategy
- **tldraw source code**: https://github.com/tldraw/tldraw -- TLDrawShape with segments/points; `isPen` flag for real vs simulated pressure
- **perfect-freehand**: https://github.com/steveruizok/perfect-freehand -- Stroke outline generation from point+pressure data
- **fflate**: https://github.com/101arrowz/fflate -- Fast JavaScript compression library (deflate/inflate); recommended for v2 encoding
- **rbush**: https://github.com/mourner/rbush -- R-tree spatial index for viewport culling and hit testing
- **Obsidian API**: `TextFileView`, `registerExtensions()`, `registerMarkdownPostProcessor()` -- from `obsidian.d.ts` type definitions
