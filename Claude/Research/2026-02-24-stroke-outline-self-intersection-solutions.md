# Stroke Outline Self-Intersection Solutions: Comprehensive Research

**Date**: 2026-02-24 (Updated)
**Problem**: Variable-width pen strokes (especially calligraphic/italic nib) produce self-intersecting outlines at sharp direction changes when using perpendicular offset from centerline.

---

## Table of Contents

1. [Problem Definition](#1-problem-definition)
2. [Approach 1: Corner Detection + Round Cap (perfect-freehand)](#2-approach-1-corner-detection--round-cap-perfect-freehand)
3. [Approach 2: Quad-Per-Segment with Triangle Winding Normalization (Our Current)](#3-approach-2-quad-per-segment-with-triangle-winding-normalization-our-current)
4. [Approach 3: Flatten + Offset + Join Rules (Cairo / SVG / Skia)](#4-approach-3-flatten--offset--join-rules-cairo--svg--skia)
5. [Approach 4: Offset + Boolean Self-Intersection Removal (FontForge / Paper.js / Clipper)](#5-approach-4-offset--boolean-self-intersection-removal-fontforge--paperjs--clipper)
6. [Approach 5: Euler Spiral Stroke Expansion (Vello/Linebender)](#6-approach-5-euler-spiral-stroke-expansion-vellolinebender)
7. [Approach 6: Stamp-Based Rendering (Procreate / Our InkStampRenderer)](#7-approach-6-stamp-based-rendering-procreate--our-inkstamprenderer)
8. [Approach 7: Polygon Self-Intersection Removal (Post-Processing)](#8-approach-7-polygon-self-intersection-removal-post-processing)
9. [Approach 8: SDF Rendering](#9-approach-8-sdf-rendering)
10. [Approach 9: Minkowski Sum / Convolution (Metafont)](#10-approach-9-minkowski-sum--convolution-metafont)
11. [Approach 10: Corner-Adaptive Nib Envelope Interpolation (Novel Hybrid)](#11-approach-10-corner-adaptive-nib-envelope-interpolation-novel-hybrid)
12. [Fill Rule Behavior with Self-Intersecting Polygons](#12-fill-rule-behavior-with-self-intersecting-polygons)
13. [Comparison Matrix](#13-comparison-matrix)
14. [How Production Libraries Handle This](#14-how-production-libraries-handle-this)
15. [Recommendations for ObsidianPaper](#15-recommendations-for-obsidianpaper)

---

## 1. Problem Definition

When generating the outline of a variable-width stroke:
- For each centerline point, compute left/right outline points by offsetting perpendicular to the stroke direction by half-width.
- At sharp turns (U-turns, direction reversals, tight corners), the perpendicular direction flips rapidly.
- The left and right offset curves cross each other, creating self-intersections.
- When rendered as a filled polygon, these crossings create:
  - **Holes** (with even-odd fill rule, overlapping regions cancel)
  - **Bowties** (quad segments where L/R sides swap, creating degenerate geometry)
  - **Notches** (visible gaps where the outline pinches)

### Our Specific Situation

In `ItalicOutlineGenerator.ts`:
- Italic nib width varies with stroke direction (cross-product projection of nib against stroke tangent)
- At direction reversals, the perpendicular flips ~180 degrees
- Current mitigations: perpendicular consistency enforcement (flip-to-match-reference), Gaussian smoothing of perpendiculars, pinched-pair expansion, width dip elimination
- Our rendering uses two-triangles-per-segment with winding normalization (`italicSidesToPath2D`), which handles micro-level bowties
- **Remaining issue**: At true U-turns and tight Z-scribble corners, these mitigations are insufficient -- the left/right sides still cross at a macro level over multiple segments

### Our Specific Pipeline

1. `generateItalicOutlineSides()` produces left/right side arrays
2. `italicSidesToPath2D()` converts to triangles with normalized winding
3. The path is filled (either directly for opaque, or with `destination-in` for ink stamp masking)
4. Self-intersecting regions create visual artifacts

---

## 2. Approach 1: Corner Detection + Round Cap (perfect-freehand)

**Source**: [perfect-freehand](https://github.com/steveruizok/perfect-freehand) by Steve Ruiz

### How It Works

The `getStrokeOutlinePoints` function detects sharp corners using dot products between consecutive direction vectors:

```typescript
prevDpr = dot(vector, prevVector)
nextDpr = dot(vector, nextVector)
```

When `prevDpr < 0` or `nextDpr < 0` (angle > 90 degrees):
1. **Skip normal outline generation** at that point (no left/right offset emitted)
2. **Insert a rounded cap** by rotating points in small increments around the corner vertex using `CORNER_CAP_SEGMENTS` arc subdivisions
3. Continue normal outline generation on the other side

Additional safeguards:
- **Distance filtering**: Points closer than `minDistance = (size * smoothing)^2` are skipped to reduce jitter
- **Directional blending**: Perpendicular offset direction is interpolated between current and next vectors using their dot product: `lerp(offset, nextVector, vector, nextDpr)`
- **Proper winding**: Output is `leftPts.concat(endCap, rightPts.reverse(), startCap)` ensuring consistent topology
- **Pressure simulation averaging**: Initial pressure values are averaged to prevent "fat starts"

### Pros
- Simple to implement: detect corners, skip, insert cap geometry
- Avoids self-intersection entirely at sharp corners
- Works well for round-tipped pens (the cap looks natural)
- Fast: O(n) single pass through points
- Battle-tested in production (used by tldraw)

### Cons
- **Round caps at corners don't match italic/calligraphic nibs** -- a calligraphy pen should show the nib shape at corners, not a round cap
- Only works for round/ballpoint style pens
- The "skip + cap" approach creates a visual discontinuity
- Not suitable for our use case where the nib projection changes width based on stroke direction
- perfect-freehand itself acknowledges its outlines can self-intersect and recommends `polygon-clipping` library for cleanup

### Applicability to Us
**Low for italic strokes, high conceptual value**. The corner detection via dot product is directly useful. The round cap insertion could be adapted to insert **nib-shaped** geometry instead.

---

## 3. Approach 2: Quad-Per-Segment with Triangle Winding Normalization (Our Current)

**Source**: Our `OutlineGenerator.ts` -- `italicSidesToPath2D()`

### How It Works

1. Generate left/right outline sides from perpendicular offsets
2. For each segment, emit **two triangles** instead of one quad:
   - Triangle 1: L[i], L[i+1], R[i+1]
   - Triangle 2: L[i], R[i+1], R[i]
3. **Normalize all triangle winding** to the same direction via cross-product check in `addNormalizedTriangle()`
4. Fill with **nonzero winding rule**

### Why Triangles Over Quads
At sharp curves, the quad L0->L1->R1->R0 can form a "bowtie" (self-intersecting quadrilateral). Canvas2D's nonzero fill rule cancels the crossed region of a bowtie to winding 0, creating holes. Triangles cannot self-intersect. With normalized winding, both triangles of a bowtie have the same winding direction and together fill the convex hull of the 4 vertices.

### WebGL Variant
`italicSidesToFloat32Array()` emits 6 vertices (12 floats) per segment as `gl.TRIANGLES` format, directly usable as a triangle list.

### Pros
- Elegantly solves micro-level bowtie/hole problems
- Simple implementation (already done)
- O(n) performance
- Works with both Canvas2D (nonzero fill) and WebGL (triangle mesh)
- No post-processing or boolean operations needed

### Cons
- **Does not prevent macro-level crossings**: When L/R sides swap over multiple consecutive segments, individual triangles are fine but the overall outline crosses itself
- The "convex hull of 4 vertices" fill at bowties may overextend the stroke slightly
- Still requires good perpendicular computation upstream -- garbage in, garbage out
- The remaining macro-level artifacts are what we need to fix

### Applicability to Us
**Already in use**. This handles the rendering correctly for whatever geometry it receives. The problem is upstream in `ItalicOutlineGenerator.ts` where the geometry itself has macro-level crossings.

---

## 4. Approach 3: Flatten + Offset + Join Rules (Cairo / SVG / Skia)

**Sources**:
- [Cairo stroke documentation](https://cairographics.org/manual/cairo-cairo-t.html)
- [SVG stroke-linejoin (MDN)](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-linejoin)
- [Skia SkStroke.cpp](https://github.com/google/skia/blob/main/src/core/SkStroke.cpp)
- [Line Join Studies by Tavmjong](http://tavmjong.free.fr/SVG/LINEJOIN_STUDY/)

### How It Works

The standard approach used by all major 2D graphics engines:

1. **Flatten curves to polylines** (within tolerance)
2. **Compute perpendicular offset** on each straight segment independently (not per-point)
3. **At joins between segments**, apply a join rule:
   - **Miter**: Extend offset lines until they intersect. If the miter length exceeds `miterLimit * strokeWidth`, fall back to bevel.
   - **Bevel**: Connect offset endpoints with a straight line across the corner
   - **Round**: Insert a circular arc connecting offset endpoints
   - **Arcs** (SVG 2 draft): Continue the offset curves with matching curvature at the join

**Cairo specifically**:
- Approximates curves with piecewise-linear segments (within tolerance)
- Uses `cairo_pen_t` structure to represent the pen shape
- `line_join` determines the join codepath; `miter_limit` controls miter behavior
- Half of `line_width` is added to either side of each line segment

**Skia**:
- Approximates parallel curves directly with quadratic Beziers
- Measures approximation error to determine if further subdivision is needed
- Handles tangent computation issues by subdividing at problematic points
- Uses `SkStrokeRec` to configure join type and miter limit

**SVG specification** defines joins as:
- The outer side of the join gets the join geometry (miter/bevel/round)
- The inner side is simply clipped to the shorter of the two offset edges

### Key Insight from Tavmjong's Line Join Studies
Two principles guide robust join design:
1. Small changes in the path should not result in large visible changes in line joins
2. Join shapes should be easy to calculate

Curved path segments create additional challenges when the radius of curvature is less than half the stroke width (cusp condition).

### Pros
- **Industry standard**: Used by every major vector graphics engine
- Well-understood, extensively tested
- Handles all corner types through explicit join rules
- Fast: O(n) for polyline processing
- Provides explicit control over corner appearance

### Cons
- **Designed for constant-width strokes only** -- does not natively handle per-point variable width
- Join rules assume the stroke width is the same on both sides of the join
- For variable-width strokes, the join geometry becomes ambiguous
- Does not address mid-segment crossings caused by per-point width variation
- Miter joins can produce very long spikes at shallow angles (miter limit needed)

### Applicability to Us
**Moderate conceptual value**. The join concept is directly useful: at detected sharp corners, we could insert join geometry (bevel or round or nib-shaped). Our width varies per-point rather than per-segment, so the standard join approach needs adaptation. The adaptation: detect corners, split the stroke into segments at corners, apply join geometry between segments.

---

## 5. Approach 4: Offset + Boolean Self-Intersection Removal (FontForge / Paper.js / Clipper)

**Sources**:
- [FontForge Expand Stroke](https://fontforge.org/docs/techref/stroke.html)
- [Paper.js offset discussion (Issue #371)](https://github.com/paperjs/paper.js/issues/371)
- [Clipper Library](https://github.com/junmer/clipper-lib)
- [polygon-clipping npm](https://www.npmjs.com/package/polygon-clipping)

### How It Works

Two-phase approach:
1. **Generate raw offset curves** (including all self-intersections, cusps, and loops)
2. **Apply boolean "Remove Overlap"** operation to extract only the outer boundary

**FontForge's implementation**:
- Generates "generalized offset curves" which explicitly include cusps and self-intersecting loops
- Cusps occur where nib curvature < source contour curvature, producing "inverted curvature"
- Runs "Remove Overlap" to reduce to counterclockwise contours
- Acknowledges it "may fail or produce inaccurate results" in rare cases
- Recommends disabling Simplify and Add Extrema if unexpected results occur

**Paper.js discussion** (long-running Issue #371):
- Hoschek's Adaptive Least Squares Method for offset Bezier approximation -- "one of the most performant and precise"
- Pomax's subdivision method via bezierinfo
- Core obstacle: "boolean path operations do not produce the expected results" when dealing with overlapping paths and self-intersecting curves
- Consensus: robust boolean operations are essential prerequisites

**Practical JS libraries**:
- `polygon-clipping`: Recommended by perfect-freehand for boolean union cleanup
- `clipper-lib`: JS port of Angus Johnson's Clipper; integer-only arithmetic (requires coordinate scaling)
- `js-angusj-clipper`: WebAssembly port, faster

### Pros
- Mathematically correct: produces the exact geometric envelope
- Handles all edge cases including cusps, loops, and self-tangencies
- Well-studied in computational geometry literature
- Off-the-shelf libraries available

### Cons
- **Complex to implement from scratch**: Robust boolean operations on paths are notoriously difficult
- **Slow**: O(n log n + k) intersection detection via sweep line, plus topological processing
- Library dependencies add bundle size
- Integer-only arithmetic (Clipper) requires coordinate scaling, introducing precision loss
- Not suitable for real-time interactive rendering (too slow for per-frame active stroke)
- May produce different vertex count than input, losing segment correspondence for triangle mesh

### Applicability to Us
**Low for active strokes, moderate for baked strokes**. Could be applied as a post-processing step on completed strokes before baking to tiles. The `polygon-clipping` library is the easiest to integrate. Not viable for the active stroke path.

---

## 6. Approach 5: Euler Spiral Stroke Expansion (Vello/Linebender)

**Sources**:
- [GPU-friendly Stroke Expansion (Levien & Uguray, HPG 2024)](https://arxiv.org/html/2405.00127v1)
- [Parallel curves of cubic Beziers (Raph Levien)](https://raphlinus.github.io/curves/2022/09/09/parallel-beziers.html)
- [Vello GPU renderer](https://github.com/linebender/vello)

### How It Works

Raph Levien's approach for the Vello GPU 2D renderer:

1. **Convert input curves to Euler spiral segments** (intermediate representation)
2. **Compute parallel curves analytically**: The parallel curve of an Euler spiral has a closed-form Cesaro representation
3. **Cusp detection is trivial**: For Euler spirals, finding cusps in the parallel curve is "a simple linear equation, and there is at most one cusp in any such segment" -- contrast with cubics where cusp detection requires higher-degree polynomial root-finding
4. **Subdivide at cusps**: Split at cusp points, generate offset segments
5. **Output as line or arc segments**: Suited for GPU rendering

### Levien's Parallel Curve Research

For cubic Bezier offset specifically, Levien's blog post describes:
- The exact offset of a cubic Bezier has degree 10 -- direct computation is impractical
- **Cusp condition**: When curvature x offset_distance + 1 = 0 (signed curvature equals reciprocal of offset distance)
- Uses interval arithmetic to robustly partition the parameter space for cusp detection
- Curve fitting via Green's theorem (area/moment computation) + quartic root finding
- Error measurement via Tiller-Hanson technique (sample + project)
- Achieves O(n^6) error scaling -- halving segment length reduces error by 64x
- JavaScript implementation: ~12 microseconds per output segment

### "Weak" vs "Strong" Correctness
- **Weak correctness** (sufficient for visual rendering): Requires only parallel curves + caps + outer join contours. The flattening algorithm "naturally generates a point within the given error tolerance of the true cusp," eliminating explicit intersection handling.
- **Strong correctness**: Additionally requires evolutes and inner join contours.

### Pros
- Mathematically elegant: cusp detection becomes trivial with Euler spiral representation
- GPU-friendly: fully parallel algorithm, no recursion or divergent control flow
- Robust: 32-bit float-safe numerical techniques
- Minimal output segments
- State of the art (HPG 2024)

### Cons
- **Very complex to implement**: Requires Euler spiral fitting, Cesaro representations, interval arithmetic
- Designed for constant-width strokes (standard path stroking)
- Overkill for polyline input (our problem is simpler than arbitrary Bezier paths)
- GPU compute shader infrastructure required for full benefit

### Applicability to Us
**Low for direct use, high conceptual value**. Key takeaway: *choose a representation where cusp detection is easy*. For polylines, cusp detection reduces to detecting sharp angle changes in the direction sequence -- which we already do. The insight about "weak correctness" is useful: for rendering purposes, we don't need exact self-intersection resolution; we just need the outline to look right.

---

## 7. Approach 6: Stamp-Based Rendering (Procreate / Our InkStampRenderer)

**Sources**:
- [Procreate Brush Studio](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
- [Efficient Rendering of Linear Brush Strokes (Apoorva Joshi)](https://apoorvaj.io/efficient-rendering-of-linear-brush-strokes/)
- Our own `InkStampRenderer.ts`

### How It Works

Instead of computing an outline polygon, render the stroke by **repeatedly stamping a brush shape** along the centerline:

1. Walk along the centerline at regular intervals (controlled by `spacing`)
2. At each position, render the nib shape (ellipse, circle, textured image) at the current nib angle
3. Stamps overlap, building up opacity through compositing
4. The outline is implicitly defined by the union of all stamp footprints
5. No explicit outline polygon means no self-intersection

**Procreate's implementation**:
- Brush = shape (container) + grain (texture)
- `spacing` determines stamp frequency along path
- Very low spacing = continuous stroke appearance
- Width varies per-stamp based on pressure/tilt
- Six rendering modes control how stamps blend (Glaze, Blending)

**Apoorva Joshi's analytical approach**:
- Models the stamp as "continuously slid" along the path
- For each pixel, integrates the stamp's contribution analytically: alpha(X,Y) = integral of f(x, X, Y) dx
- Completely avoids discrete stamp overdraw
- Supports variable brush diameter, hardness, and flow

**Our `InkStampRenderer.ts`**:
- Stamps deposit color via `source-over` within a `destination-in` mask
- Gaussian texture falloff (`InkStampTexture.ts`) + alpha dithering prevent banding
- Corner fill stamps at sharp direction changes cover wedge gaps
- Speed-dependent opacity creates velocity-based ink shading

### Pros
- **Completely avoids the self-intersection problem** -- no outline to self-intersect
- Natural handling of variable width (just vary stamp size)
- Natural handling of direction changes (stamps don't care about direction continuity)
- Physically intuitive: mimics how a real pen deposits ink
- Handles all corner types uniformly
- Already partially implemented in our codebase

### Cons
- **Performance**: Many draw calls for dense stamps (can be batched with texture atlas)
- **Banding artifacts**: Visible stamp spacing at low overlap, requires dithering (we handle this)
- **Opacity buildup**: Self-overlapping strokes accumulate differently than outline-fill
- **Edge quality**: Stamp edges are inherently soft/fuzzy; hard to match crispness of outline-fill
- Memory: stamp textures consume GPU memory
- **For calligraphy**: Stamping ellipses produces a different edge profile than the true Minkowski envelope of the nib swept along the path

### Applicability to Us
**High -- already in use for ink shading**. We already combine stamp rendering with an outline clip mask. The outline self-intersection affects the clip mask; stamps fill the body. Options:
1. Improve the clip mask (fix outline self-intersection)
2. Use stamps more aggressively so the clip mask matters less
3. Render the clip mask to a separate canvas via `source-over` (overlap OK), then apply as `destination-in` image

---

## 8. Approach 7: Polygon Self-Intersection Removal (Post-Processing)

**Sources**:
- [Polygon Self-Intersection Removal (quadst.rip)](https://quadst.rip/poly-isect.html)
- [Offset algorithm for polyline curves (INRIA)](https://inria.hal.science/inria-00518005/document)

### How It Works

Generate the raw (possibly self-intersecting) outline, then remove self-intersections:

**"Turn Left at Crossroads" algorithm**:
1. **Compute all edge-pair intersections** across the outline polygon
2. **Store intersection metadata** sorted by distance from each vertex
3. **Start at the leftmost vertex**, proceed clockwise
4. For each edge AB, if it intersects another edge CD at the closest intersection point, go to C if C is LEFT of AB, else go to D ("turn left at crossroads")
5. **Terminate** when returning to start vertex
6. The traced path is the outermost boundary

**INRIA polyline offset algorithm**:
1. Compute perpendicular offset for each segment independently
2. Detect intersections between offset segments
3. Classify and remove invalid (internal) segments
4. Assemble remaining valid segments into final outline

**Winding-number-based alternative**:
- Compute winding number for each region of the self-intersecting polygon
- Keep only regions with positive winding number (nonzero rule) or odd winding (even-odd)
- Equivalent to boolean self-union

### Pros
- Works with any outline generation method: just post-process the result
- Produces correct outer boundary regardless of input complexity
- Simpler than full boolean operations
- Handles both local loops and global crossings

### Cons
- **O(n^2) naive, O(n log n + k) with sweep line** for intersection detection
- Adds latency: must generate full outline before processing
- Edge cases with tangent intersections, coincident edges, floating-point issues
- May change vertex count (loses segment correspondence)
- Not suitable for real-time active stroke rendering
- Implementation requires robust geometric predicates

### Applicability to Us
**Moderate for baked strokes**. After a stroke is complete, we could run self-intersection removal as a cleanup pass before caching. Implementation complexity is moderate. For active strokes, too slow.

---

## 9. Approach 8: SDF Rendering

**Sources**:
- [SDF-2D library](https://github.com/schmelczer/sdf-2d)
- [Distance Fields (prideout.net)](https://prideout.net/blog/distance_fields/)

### How It Works

Define the stroke as a distance field computed per-pixel:
1. For each pixel, compute the minimum distance to the centerline
2. Compare against half the stroke width at the nearest centerline point
3. If `distance < halfWidth`, the pixel is inside; otherwise outside
4. Anti-alias by smoothstepping at the boundary

**For variable-width strokes**: The "width at nearest centerline point" varies, so finding the correct boundary requires evaluating the distance function considering the width profile along the entire centerline.

**For nib-shaped pens**: Replace circular distance with elliptical distance oriented to the nib angle.

### Pros
- **Completely avoids self-intersection**: No outline polygon exists
- Perfect anti-aliasing built-in
- Resolution-independent
- Handles all corner types naturally

### Cons
- **Performance**: Per-pixel evaluation of nearest centerline point is O(pixels * segments)
- Variable-width: "closest point considering varying width" is not just geometrically nearest
- GPU shader required for real-time performance
- Elliptical distance function for nib shapes adds complexity
- Not compatible with Canvas2D (requires WebGL fragment shader)
- The SDF union of ellipses differs from the true Minkowski envelope

### Applicability to Us
**Low**. Requires a specialized fragment shader iterating over all centerline segments per pixel. Too expensive for our use case. Could work for baked strokes rendered to texture tiles, but our tile rendering already uses a different pipeline.

---

## 10. Approach 9: Minkowski Sum / Convolution (Metafont)

**Sources**:
- [Metafont (Wikipedia)](https://en.wikipedia.org/wiki/Metafont)
- [CGAL Minkowski Sums](https://doc.cgal.org/latest/Minkowski_sum_2/index.html)
- [Minkowski Sums presentation (MPI)](https://resources.mpi-inf.mpg.de/departments/d1/teaching/ss10/Seminar_CGGC/Slides/07_Bock_MS.pdf)

### How It Works

The Minkowski sum of a pen shape P swept along a path C gives the exact stroke envelope:
```
Stroke = C + P = { c + p : c in C, p in P }
```

For a convex pen shape (like an elliptical nib) swept along a polyline:
1. At each point on the path, conceptually place the nib shape centered at that point
2. The boundary of the union of all nib placements is the stroke outline
3. For a polyline path + convex pen: the boundary consists of translated copies of the pen edges along each path segment, connected by arcs of pen vertices at corners

**Knuth's Metafont** (1984):
- Pen shapes are convex polygons
- The stroke envelope is computed by sweeping the pen polygon along the path
- At each path segment, two "silhouette edges" of the nib are selected -- the edges whose normals best match the segment's perpendicular
- At joints, insert the arc of pen vertices between outgoing and incoming silhouette edges
- Output is rasterized, not vectorized

**CGAL implementation**:
- Both decomposition (break non-convex shapes into convex pieces) and convolution approaches
- Convolution usually generates a smaller intermediate arrangement
- Still requires boundary extraction from the arrangement (which may contain self-intersections)

### Pros
- **Mathematically exact**: Produces the true geometric envelope
- Natural for convex pen shapes (nibs)
- Well-studied (Metafont, 1984; CGAL, ongoing)
- The "silhouette + arc" approach at corners produces the correct calligraphic corner shape

### Cons
- Self-intersection in the raw Minkowski sum boundary still needs resolution for non-convex results
- For smooth curves (not polylines), exact computation requires arrangement structures
- Not commonly implemented in interactive graphics libraries
- Metafont used raster output; vectorized Minkowski boundary is more complex

### Applicability to Us
**Moderate to high conceptual value**. The "silhouette edge" idea is directly relevant: at each centerline point, determine which parts of the nib ellipse form the outline boundary, and connect those boundary points smoothly between segments. At corners, sweep through the nib boundary from the incoming silhouette to the outgoing silhouette. This is essentially the proper way to handle corners for broad-nib pens.

---

## 11. Approach 10: Corner-Adaptive Nib Envelope Interpolation (Novel Hybrid)

This is a **synthesized approach** combining insights from Metafont's Minkowski sum, SVG join rules, and our existing infrastructure.

### How It Works

At sharp corners (detected by dot product of adjacent segment directions):

1. **Segment the stroke at corners**: Split the stroke into segments at sharp direction changes
2. **For each straight segment**: Generate left/right offsets as currently done (perpendicular to stroke direction, scaled by nib projection width)
3. **At each corner**: Instead of trying to maintain perpendicular consistency across the direction reversal:
   a. End the current segment's left/right sides
   b. Compute the **nib ellipse silhouette** for both the incoming direction and the outgoing direction
   c. Generate a series of points that **sweep around the nib ellipse** from the incoming silhouette point to the outgoing silhouette point
   d. This arc of points forms a smooth, geometrically correct transition between segments
   e. For the **outer** side of the corner: insert the arc (nib vertices between silhouettes)
   f. For the **inner** side of the corner: clip to the intersection point (bevel) or simply connect directly

### Why This Works for Italic Nibs

For a broad-nib calligraphy pen at a corner:
- The incoming stroke segment has the nib at one angle relative to the stroke direction, producing one width
- The outgoing stroke segment has the nib at a different angle relative to the new direction, producing a different width
- In reality, as the pen traverses the corner, the nib doesn't teleport -- it sweeps through all intermediate angles
- The nib silhouette traces an arc on the nib ellipse between the two silhouette points
- This arc produces the characteristic **diamond/wedge** shape that real broad-nib pens create at corners

### Implementation Sketch

```typescript
function generateCornerJoin(
  center: {x: number, y: number},
  incomingPerp: {x: number, y: number},
  incomingHalfWidth: number,
  outgoingPerp: {x: number, y: number},
  outgoingHalfWidth: number,
  nibConfig: ItalicNibConfig,
): { outerArc: number[][], innerPoint: number[] } {
  // 1. Determine which side is "outer" (wider angle)
  // 2. For outer side: interpolate nib boundary between incoming and outgoing
  // 3. For inner side: find intersection of incoming/outgoing offset lines
  // 4. Return arc points for outer, single point for inner
}
```

### Pros
- Produces the **correct calligraphic corner shape** (matches real broad-nib pen behavior)
- O(n) performance -- only adds work at detected corners
- No post-processing or boolean operations
- Works in real-time for active strokes
- Integrates naturally with our existing ItalicOutlineGenerator
- Handles variable width correctly (width changes across the corner via nib sweep)

### Cons
- Requires detecting corners (already done via perpendicular consistency check)
- Requires computing nib silhouette at given stroke direction (moderate math)
- The nib sweep arc computation adds complexity at corner points
- May need tuning of the corner detection threshold
- The inner-side bevel/clip requires line-line intersection computation

### Applicability to Us
**Very high**. This addresses the root cause of our problem (what happens at corners with italic nibs) with the correct geometric answer. It integrates with our existing architecture and works in real-time.

---

## 12. Fill Rule Behavior with Self-Intersecting Polygons

Canvas 2D supports two fill rules via `ctx.fill(path, fillRule)`:

### Nonzero Winding Rule (default)
- Counts directional crossings: +1 for counterclockwise, -1 for clockwise
- A point is "inside" if the winding number is nonzero
- For a simple self-intersecting polygon where the outline crosses itself, the overlapping region typically has winding number 2 (same direction) and remains filled
- **However**: when left and right sides of the outline cross, one side traces clockwise and the other counterclockwise, creating regions with winding number 0 -- holes

### Evenodd Rule
- Counts total crossings regardless of direction
- A point is "inside" if crossing count is odd
- Self-intersecting regions always flip inside/outside
- **Worse** for our use case: guaranteed holes at every self-intersection

### Key Insight
Neither fill rule solves the problem. The nonzero rule helps in some cases (simple loop-backs) but fails at the specific type of self-intersection we encounter (left-right outline crossover at sharp turns). **Our triangle mesh + winding normalization approach handles this by preventing individual triangles from having conflicting winding.**

---

## 13. Comparison Matrix

| Approach | Fixes Self-Intersection | Variable Width | Italic Nib | Real-Time Active | Real-Time Baked | Impl. Complexity | Production Users |
|----------|------------------------|---------------|-----------|-----------------|----------------|-----------------|-----------------|
| Corner + Round Cap | At corners only | Yes | Poor | Yes | Yes | Low | perfect-freehand, tldraw |
| Triangle Winding Norm. | Micro (bowties) | Yes | Yes | Yes | Yes | Low (done) | Us (ObsidianPaper) |
| Join Rules (Miter/Bevel) | At joins | No (const) | No | Yes | Yes | Moderate | Cairo, SVG, Skia |
| Boolean Removal | Full | N/A | Yes | No | Yes | Very High | FontForge, CGAL |
| Euler Spiral | Full | No (const) | No | Yes (GPU) | Yes | Very High | Vello |
| Stamp-Based | Avoids entirely | Yes | Natural | Yes | Yes | Low (done) | Procreate, us |
| Polygon Cleanup | Full | Yes | Yes | No | Yes | Moderate | General CG |
| SDF | Avoids entirely | Complex | Complex | GPU only | GPU | High | Research/games |
| Minkowski Sum | Correct envelope | Via nib | Natural | No | Yes | High | Metafont |
| **Corner Nib Envelope** | **At corners** | **Yes** | **Yes** | **Yes** | **Yes** | **Moderate** | **Novel** |

---

## 14. How Production Libraries Handle This

| Library | Approach |
|---------|----------|
| **Skia** (Chrome, Android, Flutter) | Tessellates strokes to triangles; per-segment offset with miter/bevel/round joins; subdivides at cusps |
| **Cairo** (GTK, Firefox) | Flattens curves to polylines; per-segment offset; `cairo_pen_t` pen model; miter/bevel/round joins with miter limit |
| **SVG specification** | Per-segment offset with explicit join rules (miter, bevel, round, arcs); stroke-miterlimit fallback |
| **perfect-freehand** (tldraw) | Generates polygon with potential self-intersections; corner detection + round cap insertion; recommends polygon-clipping for cleanup |
| **Canva** | perfect-freehand + Martinez-Rueda-Feito boolean union for storage |
| **Vello/Linebender** | GPU Euler spiral stroke expansion with analytical cusp detection |
| **FontForge** | Raw offset curves + Remove Overlap boolean operation |
| **Procreate** | Stamp-based rendering with spacing/texture controls; no outline polygon |
| **Metafont** | Minkowski sum of convex pen polygon along path; silhouette + arc at corners |
| **Inkscape calligraphy** | Dynamic nib simulation with mass/friction; output as filled path |

**Common pattern**: Production 2D libraries almost universally tessellate into independent triangles/trapezoids with explicit join geometry rather than generating a single closed polygon. The single-polygon approach (perfect-freehand, our ItalicOutlineGenerator) is simpler to implement but inherently produces self-intersections.

---

## 15. Recommendations for ObsidianPaper

### Core Insight

Our problem is narrower than the general "parallel curve self-intersection" problem because:
1. We have a **polyline** (not arbitrary Bezier curves), so cusps only occur at vertex corners
2. Our nib is **convex** (elliptical), so Minkowski sum theory applies cleanly
3. We already use **triangle mesh + winding normalization**, which handles micro-level bowties
4. The remaining issue is **macro-level side crossings at sharp direction reversals**
5. We already have **stamp-based rendering** that hides minor outline imperfections

### Priority-Ordered Recommendations

#### 1. Corner-Adaptive Nib Envelope Interpolation (Approach 10)
**Effort**: Moderate | **Impact**: High | **For**: Both active and baked strokes

Modify `ItalicOutlineGenerator.ts` to:
1. Detect sharp corners (dot product of adjacent directions < threshold, e.g., 0.3)
2. At corners, split the outline into incoming/outgoing segments
3. Generate nib ellipse arc points from incoming silhouette to outgoing silhouette
4. Insert these arc points into the outline, replacing the problematic perpendicular-flip region

This produces the geometrically correct calligraphic corner shape while preventing self-intersection.

#### 2. Two-Canvas Mask Rendering (Quick Fix)
**Effort**: Low | **Impact**: Moderate | **For**: Canvas2D ink stamp masking specifically

Render the outline path to a dedicated mask canvas using `source-over` fill (white on transparent), then apply that mask canvas via `destination-in` drawImage. Self-intersections in the `source-over` fill don't create holes because overlapping regions stay at alpha=1.

```typescript
// On a separate mask canvas:
maskCtx.fillStyle = "white";
maskCtx.fill(outlinePath); // source-over: overlap just stays white
// Then on the stamp canvas:
offCtx.globalCompositeOperation = "destination-in";
offCtx.drawImage(maskCanvas, 0, 0);
```

This is a band-aid but could be implemented quickly while working on approach 1.

#### 3. Stroke Segmentation at Corners
**Effort**: Moderate | **Impact**: High | **For**: Both active and baked

Split strokes into segments at detected sharp corners. Each segment gets its own perpendicular reference direction (no cross-segment flip issues). Connect segments with bevel geometry (simple) or nib-arc geometry (correct).

#### 4. Polygon Cleanup for Baked Strokes
**Effort**: Moderate | **Impact**: Moderate | **For**: Baked strokes only

Use `polygon-clipping` npm library to run boolean self-union on completed stroke outlines before caching. This fixes all remaining self-intersection issues for the final baked output.

#### 5. Enhanced Stamp Coverage (Already Partially Done)
**Effort**: Low | **Impact**: Low-Moderate | **For**: Ink-shaded fountain pen strokes

Improve stamp density and corner fill stamps so the visual body of the stroke is dominated by stamps rather than the clip mask. The clip mask's self-intersection artifacts become less visible when stamps provide strong coverage.

---

## References

- [perfect-freehand (GitHub)](https://github.com/steveruizok/perfect-freehand)
- [Paper.js offset issue #371](https://github.com/paperjs/paper.js/issues/371)
- [FontForge Expand Stroke](https://fontforge.org/docs/techref/stroke.html)
- [GPU-friendly Stroke Expansion (Levien & Uguray, HPG 2024)](https://arxiv.org/html/2405.00127v1)
- [Parallel curves of cubic Beziers (Raph Levien)](https://raphlinus.github.io/curves/2022/09/09/parallel-beziers.html)
- [Fast cubic Bezier offsetting (Gasiulis)](https://gasiulis.name/cubic-curve-offsetting/)
- [Skia SkStroke.cpp](https://github.com/google/skia/blob/main/src/core/SkStroke.cpp)
- [Cairo stroke documentation](https://cairographics.org/manual/cairo-cairo-t.html)
- [SVG stroke-linejoin (MDN)](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-linejoin)
- [Line Join Studies (Tavmjong)](http://tavmjong.free.fr/SVG/LINEJOIN_STUDY/)
- [Efficient Linear Brush Strokes (Apoorva Joshi)](https://apoorvaj.io/efficient-rendering-of-linear-brush-strokes/)
- [Procreate Brush Studio](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings)
- [Polygon Self-Intersection Removal (quadst.rip)](https://quadst.rip/poly-isect.html)
- [Offset algorithm for polyline curves (INRIA)](https://inria.hal.science/inria-00518005/document)
- [Vello GPU renderer](https://github.com/linebender/vello)
- [Metafont (Wikipedia)](https://en.wikipedia.org/wiki/Metafont)
- [CGAL 2D Minkowski Sums](https://doc.cgal.org/latest/Minkowski_sum_2/index.html)
- [Minkowski Sums presentation (MPI)](https://resources.mpi-inf.mpg.de/departments/d1/teaching/ss10/Seminar_CGGC/Slides/07_Bock_MS.pdf)
- [Clipper Library](https://github.com/junmer/clipper-lib)
- [polygon-clipping npm](https://www.npmjs.com/package/polygon-clipping)
- [SDF-2D library](https://github.com/schmelczer/sdf-2d)
- [Behind the Draw - Canva Engineering Blog](https://www.canva.dev/blog/engineering/behind-the-draw/)
