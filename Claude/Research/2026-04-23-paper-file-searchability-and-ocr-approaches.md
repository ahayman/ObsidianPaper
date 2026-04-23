# Paper File Searchability & OCR — Approach Research

**Date:** 2026-04-23
**Status:** Research only. No implementation. Pick an approach, then I'll write a plan in `Claude/Plans/`.

## Problem

`.paper` files are opaque to Obsidian. Three concrete consequences:

1. **No full-text search** — you can't find a note by what you wrote in it.
2. **No metadata indexing** — no tags, no frontmatter properties, no backlinks, no graph-view participation.
3. **No previews** — hover preview, search snippets, graph nodes all come up empty.

The user already uses [handwritingocr.com](https://www.handwritingocr.com) for extracting text from photographed journal entries and storing it in markdown. The goal is to bring that same searchability into `ObsidianPaper` directly.

---

## What We Have to Work With (current state)

Key facts from the codebase:

- `.paper` is **JSON text**, versioned (`v: 3`), with an optional deflate+base64 compression over the bulky stroke points. Structure: `meta`, `pages`, `styles`, `strokes`, and a few optional fields. See `src/document/Serializer.ts:60–160` and `src/document/types.ts:108–146`.
- **Strokes carry full vector + temporal data**: per-point x, y, pressure, tilt, twist, timestamp, delta-encoded (`src/document/PointEncoder.ts:80–105`). This is valuable — we're not working from a rasterized image like the user's current photo workflow.
- `DocumentMeta` currently holds only `created`, `modified`, `appVersion` — no title, tags, or author. The filename is the title.
- Registration: `this.registerExtensions(["paper"], "paper-view")` in `src/main.ts:46`. The view extends `TextFileView`, so save/load flow through `getViewData()` / `setViewData()` at `src/view/PaperView.ts:314–339`. **Those are clean hooks** for inserting an OCR pass.
- **Embed pipeline exists already** for `![[file.paper]]` in markdown, via a markdown post-processor in `src/embed/` — renders a static canvas preview, expand button opens editor. No code-block processor registered yet.
- File sizes: empty ~500B, typical page 10–50KB, heavily annotated 100–500KB+. Compression kicks in at 10KB (`src/document/Compression.ts:4`).

---

## Obsidian's Indexing Reality (the constraint)

This is the hard part, and the answer shapes everything else:

- `MetadataCache` **only populates for `.md` files** in practice. `getFileCache(paperFile)` returns null/stub. No public API to contribute entries for a custom extension. ([docs](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache))
- **Core search** indexes markdown contents directly; for other extensions it indexes filename only. No hook to provide searchable text for custom extensions.
- **Frontmatter in a non-`.md` file is ignored** even if syntactically valid. Tags, aliases, properties only flow into search/tag pane/Bases/Dataview for `.md`.
- **Graph view, backlinks pane, Bases, Dataview** all read `MetadataCache` → so everything depends on markdown.
- **Omnisearch** ([scambier/obsidian-omnisearch](https://github.com/scambier/obsidian-omnisearch)) builds its own index via MiniSearch and can consume OCR'd text from its companion plugin [Text Extractor](https://github.com/scambier/obsidian-text-extractor). This is an *external* index but a real integration path.

**Excalidraw hit this exact wall and solved it.** They abandoned the legacy `.excalidraw` extension in v1.2 and switched to `.excalidraw.md` — a markdown file with:
- YAML frontmatter (tags, properties, Excalidraw-specific settings)
- Visible `# Text Elements` section with all text nodes in plaintext, anchored by block refs
- The scene JSON in an LZ-String-compressed fenced code block (keeps bulk out of search hits)
- An OCR feature that writes recognized handwriting into that same indexed section

That precedent matters — the guy wrote a drawing plugin, hit this wall, and his conclusion was "the format has to be markdown."

---

## Approaches (ranked)

### A. Migrate to `.paper.md` — adopt the Excalidraw architecture ★ recommended

Change the on-disk format to a markdown file. Inside:

```markdown
---
paper-version: 4
paper-created: 2026-04-23T…
tags: [journal, meeting]
---

# Transcript
Today I thought about the problem of making paper files searchable…
(OCR output, per page)

```paper
<LZ-string or deflate+base64 JSON of strokes/pages/styles>
```
```

- Register `registerMarkdownCodeBlockProcessor("paper", …)` to render a read-only canvas preview inside markdown views.
- Keep `registerView` + a custom editor view for the drawing-first editing experience (opened via "Open in Paper view" action or by default when a file has the `paper` code block). The editor still round-trips the codeblock on save.
- Add a post-processor that strips the visible `# Transcript` section when rendering in the Paper editor (so it doesn't visually pollute the drawing surface).

**Wins:**
- Native full-text search of OCR'd text — no plugin-specific search index.
- Frontmatter properties, tags, aliases — all free.
- Graph view, backlinks, Bases, Dataview queries — all free.
- `[[wikilinks]]` in the transcript resolve as real links.
- Hover preview shows the transcript.
- One file per note (no sidecar sync problems).
- Well-trodden path — users already understand `.excalidraw.md`.

**Costs:**
- **Migration.** Existing `.paper` files need converting. A one-shot migration command on plugin update is straightforward; we control the serializer.
- **Bigger files** — LZ-string+base64 over JSON is ~1.4× vs. raw deflate. Not a dealbreaker.
- **Default-open behavior** — Obsidian opens `.md` in the markdown editor by default. We need to decide UX: does double-click open the Paper editor or the markdown editor? Excalidraw handles this with a per-file flag and a "convert" action. Their solution is good to copy.
- **Code-block processors are unmounted when scrolled off-screen** — we must re-render cheaply. We already have the tile cache + embed renderer, so this is survivable.
- Bigger change to users' vaults; we own the migration.

### B. Companion `.md` file auto-generated next to `.paper`

Keep `.paper` as-is. Auto-generate `MyNote.md` alongside with:
- Frontmatter copied from `.paper` meta
- `![[MyNote.paper]]` embed at the top
- OCR'd text below

**Wins:**
- No format migration. Existing files keep working.
- Full-text search works natively on the companion `.md`.
- Least invasive technical change.

**Costs:**
- **Two-file sync tax forever.** Rename/move/delete must keep both in sync; we have to intercept `file-manager` events and act on them reliably, including on mobile where plugin reliability is uneven.
- **Source-of-truth ambiguity.** User edits the `.md` body → what happens on next OCR run? We either overwrite their edits or merge, both of which are bug surfaces.
- **Clutter.** Explorer shows every note twice.
- **Graph view shows both nodes** (the `.md` and the embedded `.paper`), which is visually noisy.
- This is what [obsidian-attachments-md-indexer](https://github.com/iinkov/obsidian-attachments-md-indexer) does for `.canvas` files — functional, but the UX friction is why Excalidraw didn't stop here.

### C. Keep `.paper`, add `extractedText` field + integrate with Text Extractor

Status quo format, but:
- Add `meta.extractedText: string` (or per-page blocks) to the JSON.
- Run OCR on save (debounced) and populate it.
- Implement the [Text Extractor companion interface](https://deepwiki.com/scambier/obsidian-text-extractor) — expose `extractText(file: TFile): Promise<string>` on our plugin — so Omnisearch picks up handwriting notes automatically.

**Wins:**
- Smallest change. No migration, no new file extension, no format break.
- Users running Omnisearch get vault-wide fuzzy search of handwriting for free.

**Costs:**
- **Core Obsidian search still blind.** Users without Omnisearch see nothing.
- **No graph/backlinks/frontmatter.** The same opacity problem survives for everything except Omnisearch.
- **Compounds tech debt.** If we later decide to go to markdown (A), we'll migrate anyway.

### D. Hybrid: do (C) now, add (A) later

Ship (C) as a 1–2 week improvement, schedule (A) as a follow-up. Low risk, immediate search win for Omnisearch users, keeps the option open.

**Cost:** users have to migrate twice — once to get the extractedText field, again to move to `.paper.md`. Probably not worth the double churn unless we're uncertain about (A).

### E. Keep `.paper`, generate a static preview image sidecar

`MyNote.paper.png` auto-generated next to the `.paper` file for graph-view thumbnails, hover previews, etc.

**Wins:** Solves the preview problem.
**Costs:** Doesn't help with search at all. Would pair with (A), (B), or (C), not replace them.

---

## OCR Backend (independent of which approach above)

We have stroke data — timestamped pen trajectories. That's gold. Image-based OCR throws it away. So the first question is: stroke-based or image-based?

### Online (stroke-based) HWR

The market is basically one player:

- **MyScript iink Cloud** ([developer.myscript.com](https://developer.myscript.com/pricing)) — industry standard. JS SDK ([iinkTS](https://github.com/MyScript/iinkTS)) sends strokes as JSON, returns text with bounding boxes and structure. Best-in-class for cursive Latin. **2,000 recognitions/month free, then $10/1k.** Cloud call (not local). Works from any Obsidian environment via `requestUrl`. EU-hosted.
- Azure Ink Recognizer — dead since Jan 2021, don't build on it.
- WICG Handwriting Recognition API — ChromeOS only, skip.
- Open-source generic-Latin online HWR — nothing production-grade. `handwriting.js` wraps a now-private Google endpoint.

### Offline (image-based) OCR

If we go image-based, rasterize the page and send a PNG:

| Service | Handwriting Quality | Pricing | Notes |
|---|---|---|---|
| **Handwriting OCR** ([handwritingocr.com](https://www.handwritingocr.com/api/docs)) | Strong on messy cursive | $0.15/page PAYG | What user pays for today. Simple REST + webhook. [ikmolbo/handwriting-ocr-obsidian-plugin](https://github.com/ikmolbo/handwriting-ocr-obsidian-plugin) already wraps it — good reference implementation. |
| Google Cloud Vision `DOCUMENT_TEXT_DETECTION` | 80–95% | $1.50/1k pages, 1k free | Paragraph/word/symbol hierarchy with bboxes. |
| Azure Document Intelligence "Read" | Comparable to Google | $1.50/1k pages | Claims 99%+ on mixed text+handwriting. |
| AWS Textract | Weakest on cursive | $1.50/1k pages | Skip for this use case. |
| Mathpix | Excellent math, OK prose | Tiered | Only if math is the focus. |
| Transkribus metagrapho | Strong on manuscripts | ~€0.10–0.19/credit | EU-hosted, GDPR. |

### Local / on-device

- **Tesseract.js** — essentially doesn't do handwriting. Don't consider for cursive.
- **TrOCR via Transformers.js** — ~234MB model download, slow on CPU, iOS Obsidian WebView has no WebGPU. Marginal.
- **Apple Vision `VNRecognizeTextRequest`** — macOS-only via native addon ([bytefer/macos-vision-ocr](https://github.com/bytefer/macos-vision-ocr)), not available in iOS Obsidian plugin sandbox, and *not tuned for cursive*. Would still need a cloud fallback.

### Existing Obsidian OCR plugins (reference)

- `scambier/obsidian-text-extractor` + `scambier/obsidian-omnisearch` — Tesseract, cache in plugin dir, companion-interface model. **We should interoperate with this pair.**
- `ikmolbo/handwriting-ocr-obsidian-plugin` — already wraps handwritingocr.com. Good UX reference.
- `MohrJonas/obsidian-ocr` — Tesseract, no mobile.

### Recommendation on backend

**MyScript as primary + Handwriting OCR as image-based fallback.**

Reasoning:
- Stroke-based beats image-based on messy handwriting because stroke order disambiguates shapes.
- 2,000 free/month covers personal-notes volume indefinitely with per-line incremental re-OCR.
- Same REST call works on desktop Electron and iOS — no native modules, no platform-specific footguns.
- Handwriting OCR is the natural "fall back to the thing the user already pays for" option if MyScript has an outage or they prefer it.
- Local options are not competitive yet for Latin cursive.

Make both opt-in, user-supplied API keys, explicit about data leaving the device.

---

## OCR Storage Shape (once we pick an approach)

Regardless of whether it lives in `.paper.md` frontmatter/transcript, or a field in `.paper` JSON, the useful shape is three layers:

1. **Plain text** (page-joined) — drives search.
2. **Per-line structured** — `{ text, bbox, confidence, strokeIds }`. Enables click-to-jump-to-ink and confidence-filtered display.
3. **Stroke ↔ word mapping** — we compute this ourselves by intersecting stroke bboxes with OCR word bboxes. Unique to our plugin because we own both sides. Enables per-line incremental re-OCR (only re-process lines with changed strokes — big cost saver).

---

## Key UX Questions (for you to decide)

1. **Approach A vs. B vs. C+D?** My read: A is the right destination, but it's the biggest change. C is the fastest win. If we think we'll end up at A anyway, do A once.
2. **Default editor for `.paper.md`** — open the Paper canvas view, or Obsidian's markdown editor? Excalidraw has a per-file flag; we probably want the same.
3. **OCR trigger** — background auto (on idle after N seconds), on-save, on-demand via command only, or all of the above with a setting?
4. **Which backend to ship first** — MyScript (stroke, best quality, new account) or Handwriting OCR (image, user already has an account)?
5. **Where does the transcript live visually?** Inside the drawing view as a collapsible panel? Only inside markdown preview? Hidden in frontmatter and rendered on demand?

---

## My Recommendation

**Approach A** (migrate to `.paper.md`) **+ MyScript primary / Handwriting OCR fallback** backend **+ per-line incremental re-OCR** driven by stroke-id dirty tracking.

- It solves all three problems (search, metadata, preview) in one move instead of spreading fixes across future releases.
- It follows the precedent a more experienced Obsidian drawing-plugin author already validated.
- It keeps the door open to everything Obsidian does today and will add tomorrow (Bases queries, new metadata features, etc.) without any more format work on our end.
- Migration is a one-time operation we fully control.

If you want a lower-risk first step, **Approach C + Text Extractor interface** ships handwriting search for Omnisearch users in a fraction of the time and doesn't foreclose on moving to A later — the cost is that core search, graph, and frontmatter all stay blind until we migrate, and we'd migrate `.paper` files twice.

Tell me which direction you want and I'll write a plan in `Claude/Plans/`.

---

## Sources

### Obsidian API & plugin ecosystem
- [MetadataCache docs](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache)
- [registerExtensions docs](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerExtensions)
- [registerMarkdownCodeBlockProcessor docs](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerMarkdownCodeBlockProcessor)
- [Markdown post-processing guide](https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing)
- [Excalidraw file formats (DeepWiki)](https://deepwiki.com/zsviczian/obsidian-excalidraw-plugin/3.1-file-formats-and-conversion)
- [obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin)
- [JSON Canvas spec announcement](https://obsidian.md/blog/json-canvas/)
- [obsidian-attachments-md-indexer](https://github.com/iinkov/obsidian-attachments-md-indexer)
- [Searchable OCR forum thread](https://forum.obsidian.md/t/searchable-ocr-lets-get-it-built/28968)

### OCR services
- [MyScript iinkTS](https://github.com/MyScript/iinkTS) · [REST architecture](https://developer.myscript.com/docs/interactive-ink/2.0/web/rest/architecture/) · [Pricing](https://developer.myscript.com/pricing)
- [Handwriting OCR API docs](https://www.handwritingocr.com/api/docs) · [Pricing](https://www.handwritingocr.com/blog/handwriting-ocr-api-pricing)
- [Google Cloud Vision pricing](https://cloud.google.com/vision/pricing)
- [Azure Document Intelligence pricing](https://azure.microsoft.com/en-us/pricing/details/document-intelligence/) · [Read model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read)
- [AWS Textract pricing](https://aws.amazon.com/textract/pricing/)
- [Mathpix Convert pricing](https://mathpix.com/pricing/api)
- [Transkribus metagrapho](https://www.transkribus.org/metagrapho)
- [Tesseract vs. AI OCR comparison](https://www.handwritingocr.com/blog/tesseract-vs-ai-ocr-handwriting)
- [Xenova/trocr-small-handwritten (Transformers.js)](https://huggingface.co/Xenova/trocr-small-handwritten)

### Obsidian OCR plugins (reference implementations)
- [scambier/obsidian-text-extractor](https://github.com/scambier/obsidian-text-extractor) · [DeepWiki](https://deepwiki.com/scambier/obsidian-text-extractor)
- [scambier/obsidian-omnisearch](https://github.com/scambier/obsidian-omnisearch)
- [ikmolbo/handwriting-ocr-obsidian-plugin](https://github.com/ikmolbo/handwriting-ocr-obsidian-plugin)
- [MohrJonas/obsidian-ocr](https://github.com/MohrJonas/obsidian-ocr)
- [jo-minjun/petrify](https://github.com/jo-minjun/petrify)

### Dead ends (for the record)
- [WICG Handwriting Recognition API](https://wicg.github.io/handwriting-recognition/) — ChromeOS only
- [Azure Ink Recognizer retired](https://learn.microsoft.com/en-us/answers/questions/149212/alternative-for-ink-recognizer-api)
