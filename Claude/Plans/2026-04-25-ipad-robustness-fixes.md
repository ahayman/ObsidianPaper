# iPad Robustness + Plugin Co-existence Fixes

## Symptoms reported

1. **(minor)** First file shows correctly, but switching to a different `.paper.md` file shows the markdown view rather than swapping to Paper.
2. **(major)** iPad crashes Obsidian during zoom + rotate, sometimes during writing. Zoom is also "less smooth than it used to be." No console access on iPad.
3. **(Mac console)** `WebGL2Engine creation failed, falling back to Canvas 2D: Error: WebGL2 not available`.
4. **(Mac console)** Dataview: `.paper.md: Error: Cannot index file, since it has no Obsidian file metadata.`

User's theory: writing to `.md` means Obsidian and other plugins now run hooks on every modify, which they didn't for the binary `.paper` format.

## Diagnosis

The theory is largely correct. `.paper.md` participates in Obsidian's metadataCache, so every save fires plugin modify hooks. Dataview's "cannot index" error is benign (it bails out fast), but Obsidian's own metadata pipeline still scans the body, and any other plugin's modify listener runs unconditionally. Combined with our own `vault.on("modify")` listener doing per-page fingerprinting on every stroke, the main thread is contended in a way the binary `.paper` format never was.

The WebGL2 mismatch is a probe vs. constructor inconsistency: the probe calls `getContext("webgl2")` with no options, but the engine constructor requests `stencil: true, antialias: true` together — a combination iOS Safari (and apparently the Mac context here) sometimes refuses. The probe lies, the constructor throws, we fall back to Canvas 2D. On iPad, Canvas 2D rendering is slower, and a crash during zoom is likely a memory/perf cliff in that path.

The file-switch issue is timing: `doSwapToPaperView` retries the "no target leaf yet" case only twice (50ms × 2), which is enough on Mac during initial app boot but apparently not when iPad mounts the markdown view as a switch-in.

## Fixes

### 1. WebGL2 probe matches constructor options

`src/canvas/engine/EngineFactory.ts:isWebGL2Available` calls `getContext("webgl2")` with no options. Update it to request the same options the engine actually uses (`stencil: true, antialias: true`). When a context can't be created with those options, the probe correctly returns false and we don't waste a try/catch on the engine constructor.

### 2. `paper-plugin: parsed` frontmatter marker

Emit `paper-plugin: parsed` (Excalidraw's convention; many community plugins explicitly skip files with similar markers) on every serialize. Dataview specifically respects `excalidraw-plugin` keys; it doesn't currently know about `paper-plugin` but the marker is also a useful explicit signal in the file itself, and we can document it for users who want to hand-configure plugin exclusions. This is the cheapest available "please skip this file" hint.

### 3. Debounce the dirty-refresh modify handler

`vault.on("modify")` currently calls `refreshProcessDirty(activeView)` synchronously, which runs `documentPageFingerprints` (O(N) over all strokes) on every stroke save. Wrap it in a 500ms debounce so per-stroke saves don't recompute. The dirty indicator updating half a second late is invisible to the user.

`refreshEmbedsFor` also runs on every modify; it should remain synchronous (embed users expect updated previews promptly) but a quick audit confirms it only iterates the embedRegistry array.

### 4. Longer iPad-friendly retry budget

`doSwapToPaperView`'s "no targets yet" branch caps at 2 attempts × 50ms = 150ms. Bump to 8 attempts with the same exponential backoff (50ms → 90ms → 162ms → ...), capping total wait around 1.5s. Mac's fast initial swap still completes on attempt 0; iPad has the headroom it needs.

## Files Touched

- `src/canvas/engine/EngineFactory.ts` — probe matches constructor options.
- `src/document/PaperMdSerializer.ts` — emit `paper-plugin: parsed` in serialized frontmatter; mention in `PaperMdFrontmatter` interface.
- `src/main.ts` — debounced dirty refresh on modify; bump retry budget in `doSwapToPaperView`.
- Tests as needed (serializer test for the new field; runner tests already exercise the flow).

## Validation

`yarn build && yarn test && yarn build:copy`.

Manual on iPad after iCloud sync:
- Open one `.paper.md`, switch to another → both show Paper view.
- Zoom + rotate without crash; subjective smoothness.
- Save several pages of writing, observe whether sustained drawing remains responsive.

If crashes persist, next steps would be: route the binary scene blob to a paired sidecar file (`.paper.md` + `.paper.scene`) so the markdown body stays small and Obsidian's metadataCache stops scanning huge JSON every save. That's a larger refactor and we'd want to confirm it's worth doing first.
