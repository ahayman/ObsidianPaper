# WebGL 2 Anti-Aliasing Options — Reducing MSAA Memory Cost

**Date:** 2026-05-18
**Context:** The WebGL2 tile renderer uses 4× MSAA on per-tile FBOs. MSAA memory
overhead is implicated in the iPad deep-zoom crash (see
`2026-04-25-ipad-crash-investigation.md`). This document explains *why* MSAA is
expensive, *why* Canvas 2D's anti-aliasing is not, and *what* memory-efficient
alternatives exist.

---

## TL;DR

The headline problem is **not** that "MSAA is expensive." It is that the current
design **allocates MSAA scratch buffers per cached tile and never frees them**.
The multisampled renderbuffers are only ever touched during the ~1ms it takes to
render that tile; afterwards they sit in VRAM, dead, for the tile's whole cached
lifetime.

- **Why MSAA costs memory:** it is *brute-force point sampling* — it physically
  stores N color + N stencil samples per pixel. The memory *is* the technique.
- **Why Canvas 2D doesn't:** its rasterizer uses *analytic coverage* — it computes
  the exact fractional area each pixel's path covers and bakes it into a single
  8-bit alpha value. The output is an ordinary single-sample bitmap. No extra
  memory; the cost is rasterizer compute instead.
- **The fix (recommended):** keep MSAA quality, but render every tile through **one
  shared MSAA scratch target** and resolve into each tile's cheap single-sample
  texture. Per-tile cost drops from **24 bytes/px → 4 bytes/px (6×)**, and total
  MSAA storage goes from O(tile count) to a single fixed ~21 MB allocation. No
  extension required, no quality change, contained to two files.

Three tiers, in priority order:

| Tier | Approach | Memory result | Effort | Quality |
|------|----------|---------------|--------|---------|
| **A** | Shared MSAA scratch buffer | per-tile 24→4 B/px; MSAA storage O(N)→O(1) | Low | Identical |
| **B** | `WEBGL_multisampled_render_to_texture` (implicit resolve), layered on A | MSAA scratch becomes ~free on iPad TBDR | Low, but must feature-detect | Identical |
| **C** | Analytic coverage AA — drop MSAA entirely | No AA buffers at all | High | Equal/better; new artifacts to manage |

Do **A** now. It removes the root cause of the iPad memory pressure. Feature-detect
**B** and layer it on for iPad. Treat **C** as the longer-term "render like Canvas
does" direction.

---

## Question 1 — Why does MSAA use so much memory?

### The mechanism

MSAA (Multisample Anti-Aliasing) anti-aliases by **storing multiple samples per
pixel**. A 4× MSAA color buffer holds 4 RGBA8 values per pixel; the rasterizer
runs the coverage/stencil test at 4 distinct sub-pixel sample positions and, at
the end, *resolves* (averages) the 4 samples down to one. An edge that covers 2 of
the 4 sample points resolves to 50% coverage — that is the anti-aliasing.

The memory cost is not incidental — **the storage is the algorithm**. There is no
way to do "4× MSAA" without somewhere holding 4× the samples while the render pass
is in flight.

### What the current code allocates

`createMSAAOffscreenTarget()` (`src/canvas/engine/GLTextures.ts:159`) builds, *per
tile*:

| Buffer | Format | Bytes / pixel |
|--------|--------|---------------|
| `colorTexture` (resolve target — the usable tile texture) | RGBA8 | 4 |
| `msaaColorRB` (multisampled color) | RGBA8 × samples | 4 × 4 = 16 |
| `msaaStencilRB` (multisampled stencil) | S8 × samples | 1 × 4 = 4 |
| **Total** | | **24** |

This matches `WebGLTileCache.memoryBytesFor()` (`WebGLTileCache.ts:74`):
`px * (4 + 5 * samples)` → `px * 24` at 4× samples. A non-MSAA tile is `px * 5`
(4 B color texture + 1 B stencil RB). **MSAA tiles are 4.8× heavier.**

The multisampled-only portion is `5 × samples = 20 bytes/px`. For a 512×512 tile
that is **5.24 MB of pure MSAA overhead per tile** — exactly the "~5 MB/tile
overhead at moderate zoom" recorded in the project memory.

### The actual design flaw

The MSAA renderbuffers are **scratch space**. The render path is
(`WebGLTileEngine.renderTile`, `WebGLTileEngine.ts:89`):

1. Bind `entry.msaa.msaaFBO`, `engine.clear()`, draw background + every stroke.
2. `resolveMSAA()` — `blitFramebuffer` the multisampled buffer into the tile's
   single-sample `colorTexture` (`GLTextures.ts:197`).
3. Done. The multisampled renderbuffers are **never read or written again** until
   the tile is marked dirty and fully re-rendered from scratch.

`renderTile()` always does a full `clear()` + full re-draw — there is no
incremental compositing into an existing tile. So once `resolveMSAA()` has run,
the 20 B/px of multisampled storage attached to that tile is dead weight.

Yet `WebGLTileCache` keeps it alive for the entire cached lifetime of the tile. A
working set of, say, 30 cached tiles at 512² carries **~150 MB of MSAA scratch
that is in use for microseconds at a time and idle the rest.** That is the memory
problem — and it is also why the iPad crash investigation found a *per-allocation
renderbuffer limit* being hit: the renderer creates one large multisampled
renderbuffer for every tile instead of reusing one.

> **Reframe:** the issue is not "MSAA is too expensive." It is "we are paying for
> MSAA scratch N times when the workload only ever needs one."

---

## Question 2 — Why doesn't Canvas 2D's anti-aliasing cost this?

Because Canvas 2D does not multisample at all. It uses **analytic coverage
anti-aliasing**.

### Analytic coverage vs. sampling

When a 2D rasterizer (Skia in Chrome, Core Graphics in Safari) fills a path, for
each pixel it computes the **exact fraction of that pixel's area covered by the
path** — via scanline / signed-area integration of the path geometry. That
fraction (a value in [0,1]) is written directly into the pixel's **single 8-bit
alpha channel**.

The anti-aliasing is *encoded into one ordinary value per pixel*. The output is a
plain single-sample RGBA bitmap — the same bitmap you would get with AA off,
except the edge pixels carry fractional alpha. **There is no multisample buffer to
allocate.**

| | MSAA | Canvas 2D analytic AA |
|---|------|----------------------|
| How edge coverage is found | Test geometry at N fixed sub-pixel points, count hits | Integrate exact covered area of the pixel |
| Where the AA "lives" | N stored samples, averaged at resolve time | One alpha value, computed once |
| Extra memory | N× color + N× depth/stencil per render target | None — output is a normal bitmap |
| Cost scales with | sample count × resolution × number of render targets | rasterizer compute only (fixed-size output) |
| Edge quality | Quantized to N+1 coverage levels (4× → 0/25/50/75/100%) | Effectively continuous coverage |

This is why Canvas 2D AA is "free" in memory: it trades the storage for
**rasterization compute**. The CPU/GPU path rasterizer does more arithmetic per
edge pixel, but it writes a normal-sized image.

### The catch Canvas 2D pays instead — conflation

Analytic coverage has one well-known artifact: **conflation**. When two shapes
that share an edge are filled in *separate* draw calls, both write partial alpha
to the seam pixels, and the two partial-alpha blends double-count — leaving a
faint seam or halo. MSAA does not have this, because per-sample coverage is
resolved geometrically *after* all draws into that sample.

For this app it mostly does not bite: handwriting strokes are filled as
independent outlines that **overlap** rather than **tile edge-to-edge**, so there
is no shared seam to conflate. It is worth knowing, because it is the reason
GPU vector renderers sometimes still keep a coverage/sample buffer.

### Why you can't just "turn on" Canvas-style AA in WebGL

WebGL's fixed-function rasterizer only does point-in-triangle coverage at sample
positions — it has no analytic-area mode. To get Canvas-quality coverage in WebGL
you must *compute the coverage yourself in a shader* (Option C below). The browser
gets analytic AA because it ships a dedicated path rasterizer (Skia/CoreGraphics);
WebGL hands you triangles and a stencil buffer and nothing else.

---

## What in this renderer actually needs MSAA

Important scoping: **most of the renderer is already analytically anti-aliased and
does not need MSAA at all.**

- **Dot-grid backgrounds** — `CIRCLE_FRAG` (`shaders.ts:189`) computes an SDF
  distance and `smoothstep`s over a `fwidth`-wide band. Analytic AA in-shader.
- **Background lines** — `LINE_FRAG` (`shaders.ts:219`) `smoothstep`s an edge
  varying. Analytic AA in-shader.
- **Stamp pens (ink, marker, felt-tip)** — `STAMP_FRAG` samples a pre-rendered
  stamp texture whose soft edges are already baked into its alpha (Gaussian
  falloff per the project memory). The smoothness comes from the texture, not MSAA.
- **Pencil disc stamps** — `STAMP_DISC_FRAG` is a *hard* circle (`discard` past
  radius), deliberately matching Canvas2D `arc()`. MSAA softens its rim slightly
  but it is not the mechanism it relies on.

The one path that **genuinely depends on MSAA** is the **stencil-then-cover vector
fill**: `fillPath()` / `fillTriangles()` (`WebGL2Engine.ts:447`/`577`), used to
fill the ink-pen nib outline polygon. Its Pass 1 writes a **1-bit-per-sample**
winding mask into the stencil buffer; Pass 2 covers every nonzero-winding pixel
with solid color. The stencil buffer carries **no fractional coverage** — a pixel
is fully in or fully out. Without MSAA's N sample positions, edges are hard
jaggies and sub-pixel-thin strokes can miss every sample and vanish entirely
(the failure mode noted in project memory).

**Consequence:** any AA strategy here only has to serve the stencil fill path.
That is what makes Option C tractable — you would only need to re-engineer one
drawing primitive, not the whole engine.

---

## Options

### Option A — Shared MSAA scratch buffer ⭐ Recommended

Keep 4× MSAA exactly as is, but stop allocating it per tile. Allocate **one**
multisampled scratch target, sized to `maxTilePhysical` (1024² on mobile), and
route every tile render through it.

**New per-tile cost:** just the resolve color texture — `px × 4`. The per-tile
stencil renderbuffer also disappears, because the stencil now lives in the shared
scratch. A tile entry becomes a bare RGBA8 texture.

**Memory math (512² tile, 4× MSAA):**

| | Today (per-tile MSAA) | Option A |
|---|----------------------|----------|
| Per tile | 512² × 24 = 6.29 MB | 512² × 4 = 1.05 MB |
| 30 cached tiles | ~189 MB | ~31 MB |
| Shared MSAA scratch | — | 1024² × 20 ≈ 21 MB (one-time, fixed) |
| **Total** | **~189 MB** | **~52 MB** |

Per-tile storage drops **6×**; total MSAA storage goes from O(tile count) to a
single constant allocation. Crucially for the iPad crash: there is now **exactly
one** large multisampled renderbuffer instead of one per tile, so the
per-allocation renderbuffer limit is hit predictably (or not at all) instead of
scaling with the working set.

**Render flow:**

```
renderTile(entry):
  bind sharedScratch.msaaFBO            # one buffer, reused every tile
  viewport(0,0, tilePhysical, tilePhysical)
  clear(); draw background + strokes
  invalidateFramebuffer([STENCIL])      # keep existing TBDR optimization
  blitFramebuffer(sharedScratch.msaaFBO → entry.resolveFBO,
                  0,0,tilePhysical,tilePhysical)   # MSAA resolve
```

GL serializes the command stream, so resolving tile A before the scratch is
reused for tile B is automatic — no fencing needed.

**Touch points:**
- `GLTextures.ts` — add a "create shared MSAA scratch" that is sized once to the
  max tile; tile entries get a plain color texture (+ a lightweight resolve FBO,
  or one shared resolve FBO whose color attachment is re-pointed per tile via
  `framebufferTexture2D`).
- `WebGLTileCache.ts` — `allocate()` stops calling `createMSAAOffscreenTarget`
  per tile; `memoryBytesFor()` becomes `px × 4`; the shared scratch is owned by
  the cache (or the tile engine) and counted once.
- `WebGLTileEngine.renderTile()` — render into the shared scratch, then blit-
  resolve into the tile's texture.

**Caveats:**
- The scratch must be ≥ the largest tile rendered. One buffer at `maxTilePhysical`
  is simplest; rendering a 128² tile into it just means a 128² viewport (clear is
  viewport/scissor-scoped, so no waste). Optionally keep a tiny pool keyed by the
  few discrete band sizes if you want to avoid the over-sized clear.
- `blitFramebuffer` MSAA-resolve requires READ multisampled, DRAW single-sample,
  identical format, identical rectangle size — all already true.
- This also makes the `MSAA_MAX_BAND = 3` quality cliff (`Renderer.ts:1505`)
  unnecessary: MSAA cost is no longer per-tile, so you *could* keep MSAA at every
  zoom band for free and delete that whole branch. (Optional; the cliff exists
  only because per-tile MSAA was expensive.)

### Option B — `WEBGL_multisampled_render_to_texture` (implicit resolve)

A WebGL2 extension that adds `framebufferTexture2DMultisampleEXT()`: you attach an
ordinary single-sample texture to an FBO and tell the driver "render this
multisampled, samples are transient." There is **no separate MSAA renderbuffer
object and no explicit `blitFramebuffer`** — the resolve is implicit.

On a **tile-based GPU like the iPad's** this is the ideal case. Per the Android
GPU team's analysis, with implicit-resolve the driver keeps the MSAA samples in
**on-chip tile memory** for the duration of the render pass and writes only the
resolved single-sample result to VRAM — the multisampled storage **never touches
main memory**. MSAA becomes nearly free in both bandwidth and memory. Explicit
`renderbufferStorageMultisample` + `blitFramebuffer` (what the code does today)
*defeats* this, because a named multisampled renderbuffer forces a real VRAM
allocation the driver must assume is persistent.

**However:**
- **Support is not guaranteed.** It is well supported in Chrome (via ANGLE).
  Safari/iOS support could **not** be confirmed for current versions and has
  historically been absent — it **must be feature-detected** at runtime via
  `gl.getExtension("WEBGL_multisampled_render_to_texture")`, with Option A as the
  mandatory fallback.
- It is a memory win specifically on TBDR GPUs. On a desktop immediate-mode GPU it
  still allocates full multisampled storage (neutral, not harmful).
- There are restrictions on sampling a texture while it is an implicit-multisample
  attachment; the render→resolve→sample sequence the tile renderer already uses
  fits within them, but it needs care.

**Recommendation:** implement Option A as the unconditional baseline, then, if the
extension is present, have the shared scratch use `framebufferTexture2DMultisampleEXT`
so that on iPad the MSAA samples become memoryless. B is a thin enhancement layered
on A, never a dependency.

### Option C — Analytic coverage AA (render the way Canvas does)

Eliminate MSAA entirely by computing fractional coverage in the shader, so the
stencil fill produces soft edges into a plain single-sample buffer. This is the
literal answer to "do what Canvas does." It only has to replace the `fillPath` /
`fillTriangles` primitive (see scoping section). Two viable techniques:

1. **NanoVG-style AA fringe.** NanoVG (a mature OpenGL 2D vector library) renders
   antialiased fills with **no MSAA**: it triangulates the fill, then adds a 1px-
   wide *fringe* strip of triangles along every edge carrying a varying that goes
   `1` (inner) → `0` (outer). The fragment shader uses that varying as coverage
   (`alpha = clamp(varying)`). Combined with stencil-then-cover for correct
   self-intersection, this gives analytic edge AA in a single-sample buffer.
   This would mean the `ItalicOutlineGenerator` emits an inner fill plus an edge
   fringe, instead of one hard polygon.

2. **SDF the ink outline.** The renderer already proves the pattern works —
   `CIRCLE_FRAG` and `LINE_FRAG` are analytic-AA SDFs. The ink stroke outline
   could be rasterized as a signed distance field and the fragment shader could
   `smoothstep` a `fwidth`-wide band, identical in spirit to those shaders. More
   work for an arbitrary outline polygon than for a circle, but conceptually the
   same and consistent with the existing engine.

**Pros:** zero AA buffers — no MSAA renderbuffers, no oversized scratch, no
resolve blit. Coverage quality is continuous (better than 4× MSAA's 5 levels).
Removes the deep-zoom MSAA cliff entirely.

**Cons:** highest effort — touches stroke geometry generation, not just buffer
allocation. Re-introduces conflation-style artifacts at self-overlaps that MSAA
hid, which need handling (NanoVG uses the stencil pass for exactly this). Active
strokes already render on the Canvas 2D layer, so this is a baked-tile-only change
— but still a real geometry rework.

### Options that do NOT help — and why

- **Post-process AA (FXAA / SMAA).** Runs on the *already-rasterized* single-
  sample image. It can only smooth edges that **did** get rendered. It **cannot
  recover a sub-pixel-thin stroke that fell between sample points and never
  rasterized** — which is precisely the stencil-fill failure mode here. FXAA also
  tends to blur thin features it misreads as noise. Cheap, but it does not solve
  *this* problem. Not a substitute for MSAA/coverage on thin strokes.
- **`SAMPLE_ALPHA_TO_COVERAGE`.** Converts shader alpha into a coverage mask — but
  only into a **multisample buffer**. It still needs the MSAA storage, so there is
  no memory win. Irrelevant here.
- **Just lowering sample count (4× → 2×).** Scales the per-tile waste down by 2×
  but leaves the O(tile-count) structure intact and halves edge quality. A shared
  scratch (Option A) keeps 4× quality *and* cuts memory far more. Strictly worse.
- **Supersampling (SSAA) as a per-tile buffer.** Rendering each tile into its own
  2× texture is the same per-tile-allocation mistake in a different hat. SSAA is
  only viable as a *shared scratch* (a 2×-resolution variant of Option A) — and as
  a shared scratch, MSAA is the better-quality choice for the same memory, so this
  is at best a fallback if multisampled renderbuffers prove problematic.

---

## Recommendation

1. **Implement Option A (shared MSAA scratch) now.** It is the direct fix for the
   root cause: it converts MSAA storage from O(tile count) to one fixed ~21 MB
   buffer, cuts per-tile memory 6×, keeps quality bit-identical, needs no
   extension, and is contained to `GLTextures.ts`, `WebGLTileCache.ts`, and
   `WebGLTileEngine.ts`. It also directly relieves the iPad per-allocation
   renderbuffer pressure from `2026-04-25-ipad-crash-investigation.md`.

2. **Feature-detect Option B and layer it on A.** If
   `WEBGL_multisampled_render_to_texture` is present, have the shared scratch use
   the implicit-resolve path so the MSAA samples become memoryless on the iPad's
   tile-based GPU. Pure upside where available; A remains the fallback.

3. **Consider deleting `MSAA_MAX_BAND`.** Once MSAA is no longer per-tile, the
   deep-zoom quality cliff exists for no reason. Keeping MSAA at all bands is then
   free.

4. **Keep Option C on the roadmap.** If you later want to drop multisampling
   altogether — the only true "render like Canvas" outcome — re-engineer the
   `fillPath` stencil-cover into a NanoVG-style AA-fringe or SDF coverage fill.
   It is the highest-effort path but the only one with *zero* AA buffers, and the
   engine already demonstrates the technique in `CIRCLE_FRAG` / `LINE_FRAG`.

A next step would be a formal implementation plan for Option A in `Claude/Plans`.

---

## Sources

- [Multisampled Anti-aliasing For Almost Free — On Tile-Based Rendering Hardware (Android Developers)](https://medium.com/androiddevelopers/multisampled-anti-aliasing-for-almost-free-on-tile-based-rendering-hardware-21794c479cb9)
- [EXT_multisampled_render_to_texture — Khronos OpenGL extension registry](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_multisampled_render_to_texture.txt)
- [nanovg — antialiased 2D vector drawing on OpenGL (memononen/nanovg)](https://github.com/memononen/nanovg)
- [nanovg_gl.h — fill / fringe / stencil implementation](https://github.com/memononen/nanovg/blob/master/src/nanovg_gl.h)
- [WebGL best practices — invalidateFramebuffer on MSAA attachments (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [WebGL 2.0 Achieves Pervasive Support from All Major Web Browsers (Khronos)](https://www.khronos.org/blog/webgl-2-achieves-pervasive-support-from-all-major-web-browsers)
- [WebGL Performance on Safari and Apple Vision Pro — Safari runs WebGL on ANGLE/Metal (Wonderland Engine)](https://wonderlandengine.com/news/webgl-performance-safari-apple-vision-pro/)
- [WebGL 2: New Features — multisampled renderbuffers & blitFramebuffer (Real-Time Rendering)](https://www.realtimerendering.com/blog/webgl-2-new-features/)
