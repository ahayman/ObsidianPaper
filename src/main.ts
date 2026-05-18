import { Notice, Plugin, TFile, TFolder, normalizePath, WorkspaceLeaf } from "obsidian";
import { PaperView, VIEW_TYPE_PAPER, PAPER_EXTENSION, classifyPaperFile } from "./view/PaperView";
import { createEmptyDocument } from "./document/Document";
import { deserializeDocument } from "./document/Serializer";
import { serializePaperMd, deserializePaperMd, PAPER_MD_VERSION } from "./document/PaperMdSerializer";
import { DEFAULT_SETTINGS, mergeSettings, resolvePageSize, resolveMargins } from "./settings/PaperSettings";
import type { PaperSettings } from "./settings/PaperSettings";
import { ClipboardQueue } from "./selection/Clipboard";
import { PaperSettingsTab } from "./settings/PaperSettingsTab";
import type { DeviceSettings } from "./settings/DeviceSettings";
import { DEFAULT_DEVICE_SETTINGS, loadDeviceSettings, saveDeviceSettings } from "./settings/DeviceSettings";
import { createEmbedPostProcessor } from "./embed/EmbedPostProcessor";
import type { EmbedEntry } from "./embed/EmbedPostProcessor";
import { createPaperCodeBlockProcessor } from "./embed/PaperCodeBlockProcessor";
import { EmbeddedPaperModal } from "./embed/EmbeddedPaperModal";
import {
  planMigration,
  runMigration,
  listBackups,
  deleteBackups,
  reformatAllPaperMd,
} from "./migration/PaperMigrator";
import { MigrationConfirmModal, BackupCleanupModal } from "./migration/MigrationModal";
import { HandwritingOcrBackend } from "./ocr/HandwritingOcrBackend";
import type { OcrBackend } from "./ocr/OcrBackend";
import { runIncrementalOcr, countDirtyPages } from "./ocr/IncrementalOcrRunner";
import { ThumbnailManager } from "./thumbnail/ThumbnailManager";
import { shortHash } from "./thumbnail/ThumbnailGenerator";
import { documentPageFingerprints } from "./ocr/PageFingerprint";
import { checkQuota, incrementCounter, resetMonthlyCounterIfNeeded } from "./ocr/OcrQuota";
import { exportToSvg } from "./export/SvgExporter";
import { NewPaperModal } from "./modal/NewPaperModal";

export default class PaperPlugin extends Plugin {
  settings: PaperSettings = DEFAULT_SETTINGS;
  deviceSettings: DeviceSettings = DEFAULT_DEVICE_SETTINGS;
  private settingsListeners: Set<(settings: PaperSettings) => void> = new Set();
  private deviceSettingsListeners: Set<(ds: DeviceSettings) => void> = new Set();
  private embedRegistry: EmbedEntry[] = [];
  private clipboard = new ClipboardQueue(DEFAULT_SETTINGS.clipboardQueueSize);
  /** File paths currently being swapped to Paper view (dedup across events). */
  private pendingPaperSwaps = new Set<string>();
  /**
   * File paths the user has explicitly toggled to markdown view this session.
   * Bypasses the auto-swap-to-Paper logic until cleared. Frontmatter
   * (`paper-default-view: markdown`) is the persistent source of truth across
   * reloads; this set just bridges the metadataCache update lag right after
   * the toggle write.
   */
  private userRequestedMarkdown = new Set<string>();
  private thumbnailManager: ThumbnailManager | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_PAPER, (leaf) => {
      const view = new PaperView(leaf);
      view.clipboard = this.clipboard;
      view.setDeviceSettings(this.deviceSettings);
      view.setSettings(this.settings);
      view.onSettingsChange = (changes) => {
        Object.assign(this.settings, changes);
        void this.saveSettings();
        this.notifySettingsListeners();
      };
      view.onDeviceSettingsChange = (changes) => {
        Object.assign(this.deviceSettings, changes);
        this.saveDeviceSettingsLocal();
        this.notifyDeviceSettingsListeners();
      };
      view.onProcessFile = (mode, options) => this.processCurrentFile(view, mode, options);
      view.onRequestMarkdownView = () => {
        if (view.file) void this.togglePaperView(view.file);
      };
      this.onDeviceSettingsChange((ds) => view.setDeviceSettings(ds));
      return view;
    });
    this.registerExtensions([PAPER_EXTENSION], VIEW_TYPE_PAPER);

    // Register embed post processor for reading mode
    this.registerMarkdownPostProcessor(
      createEmbedPostProcessor(
        this.app,
        () => document.body.classList.contains("theme-dark"),
        () => this.settings,
        this.embedRegistry,
        (file: TFile) => this.openPaperModal(file),
      )
    );

    // Render ```paper``` fenced code blocks (the .paper.md scene payload)
    // as static canvas previews in markdown views.
    this.registerMarkdownCodeBlockProcessor(
      "paper",
      createPaperCodeBlockProcessor(
        this.app,
        () => document.body.classList.contains("theme-dark"),
        () => this.settings,
        this.embedRegistry,
        (file: TFile) => {
          void this.openInPaperView(file);
        },
      )
    );

    this.thumbnailManager = new ThumbnailManager(this.app, () => this.settings);

    // Auto-refresh embeds when .paper or .paper.md files are modified.
    // Thumbnail regeneration is explicitly NOT auto-triggered here — it
    // ran canvas rasterization mid-stroke on iPad and occasionally ate
    // strokes as a result. Thumbnails refresh only when the user taps
    // the "Process" toolbar button.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && classifyPaperFile(file.name)) {
          this.refreshEmbedsFor(file.path);
          // Cheap O(1) timestamp check inside isProcessDirty — no debounce
          // needed. Earlier per-page fingerprinting was measurable on iPad
          // during sustained drawing; switching to a `paper-modified` vs.
          // `paper-ocr.last-run` comparison made the work negligible.
          const activeView = this.getActivePaperView();
          if (activeView?.file?.path === file.path) {
            this.refreshProcessDirty(activeView);
          }
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", () => this.refreshProcessDirty()),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refreshProcessDirty()),
    );

    // Route .paper.md files to the Paper editor view unless the user has
    // explicitly asked for markdown via `paper-default-view: markdown`.
    // Listen to both events — file-open sometimes misses reused leaves, and
    // active-leaf-change fires earlier but with a not-yet-mounted file.
    // We dedupe overlapping attempts via pendingPaperSwaps.
    const considerSwap = (): void => {
      const file = this.app.workspace.getActiveFile();
      if (!file) return;
      if (classifyPaperFile(file.name) !== "md") return;
      this.maybeSwapToPaperView(file);
    };
    this.registerEvent(this.app.workspace.on("file-open", considerSwap));
    this.registerEvent(this.app.workspace.on("active-leaf-change", considerSwap));


    this.addSettingTab(
      new PaperSettingsTab(this.app, this, this.settings, (s) => {
        this.settings = s;
        void this.saveSettings();
        this.notifySettingsListeners();
      }, {
        getDeviceSettings: () => this.deviceSettings,
        onDeviceSettingsChange: (ds) => {
          this.deviceSettings = ds;
          this.saveDeviceSettingsLocal();
          this.notifyDeviceSettingsListeners();
        },
      })
    );

    this.addCommand({
      id: "create-paper",
      name: "Create new handwriting note",
      callback: () => this.createNewPaper(),
    });

    this.addRibbonIcon("pen-tool", "New handwriting note", () => {
      void this.createNewPaper();
    });

    this.addCommand({
      id: "undo-stroke",
      name: "Undo stroke",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view) return false;
        if (checking) return true;
        view.undo();
        return true;
      },
    });

    this.addCommand({
      id: "redo-stroke",
      name: "Redo stroke",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view) return false;
        if (checking) return true;
        view.redo();
        return true;
      },
    });

    this.addCommand({
      id: "recognize-handwriting",
      name: "Recognize handwriting (OCR)",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view || classifyPaperFile(view.file?.name) !== "md") return false;
        if (this.settings.ocrBackend === "none") return false;
        if (checking) return true;
        void this.runOcrCommand({ force: false });
        return true;
      },
    });

    this.addCommand({
      id: "recognize-handwriting-force",
      name: "Re-run OCR on current file (ignore cache)",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view || classifyPaperFile(view.file?.name) !== "md") return false;
        if (this.settings.ocrBackend === "none") return false;
        if (checking) return true;
        void this.runOcrCommand({ force: true });
        return true;
      },
    });

    this.addCommand({
      id: "toggle-paper-view",
      name: "Toggle Paper / Markdown view",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || classifyPaperFile(file.name) !== "md") return false;
        if (checking) return true;
        void this.togglePaperView(file);
        return true;
      },
    });

    this.addCommand({
      id: "export-svg",
      name: "Export as SVG",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view) return false;
        if (checking) return true;
        void this.exportCurrentAsSvg(view);
        return true;
      },
    });

    this.addCommand({
      id: "copy-selection",
      name: "Copy selection",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view?.hasSelection()) return false;
        if (checking) return true;
        view.copySelection();
        return true;
      },
    });

    this.addCommand({
      id: "cut-selection",
      name: "Cut selection",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view?.hasSelection()) return false;
        if (checking) return true;
        view.cutSelection();
        return true;
      },
    });

    this.addCommand({
      id: "paste-selection",
      name: "Paste strokes",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view?.hasClipboardContent()) return false;
        if (checking) return true;
        view.pasteClipboard();
        return true;
      },
    });

    this.addCommand({
      id: "duplicate-selection",
      name: "Duplicate selection",
      checkCallback: (checking) => {
        const view = this.getActivePaperView();
        if (!view?.hasSelection()) return false;
        if (checking) return true;
        view.duplicateSelection();
        return true;
      },
    });

    this.addCommand({
      id: "migrate-paper-to-paper-md",
      name: "Migrate .paper files to .paper.md",
      callback: () => void this.runPaperMigrationCommand(),
    });

    this.addCommand({
      id: "delete-paper-backups",
      name: "Delete .paper backups from migration",
      callback: () => void this.runBackupCleanupCommand(),
    });

    this.addCommand({
      id: "reformat-paper-md-files",
      name: "Re-format .paper.md files (upgrade base64 to raw JSON)",
      callback: () => void this.runReformatCommand(),
    });

    this.addCommand({
      id: "regenerate-thumbnail",
      name: "Regenerate thumbnail for current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || classifyPaperFile(file.name) !== "md") return false;
        if (checking) return true;
        void this.runRegenerateThumbnailCommand(file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;
        menu.addItem((item) => {
          item.setTitle("New Paper Document")
            .setIcon("pen-tool")
            .onClick(() => void this.createNewPaper(file as TFolder));
        });
      })
    );

    this.registerNotebookNavigatorMenu();
  }

  onunload(): void {
    this.settingsListeners.clear();
    this.deviceSettingsListeners.clear();
    this.embedRegistry.length = 0;
    this.thumbnailManager?.cancelAll();
  }

  onSettingsChange(listener: (settings: PaperSettings) => void): () => void {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  }

  private notifySettingsListeners(): void {
    for (const listener of this.settingsListeners) {
      listener(this.settings);
    }
  }

  onDeviceSettingsChange(listener: (ds: DeviceSettings) => void): () => void {
    this.deviceSettingsListeners.add(listener);
    return () => this.deviceSettingsListeners.delete(listener);
  }

  private notifyDeviceSettingsListeners(): void {
    for (const listener of this.deviceSettingsListeners) {
      listener(this.deviceSettings);
    }
  }

  private saveDeviceSettingsLocal(): void {
    saveDeviceSettings(this.app, this.deviceSettings);
  }

  private async loadSettings(): Promise<void> {
    const data = await this.loadData() as Record<string, unknown> | null;

    // Plugin data is either the legacy flat shape (the whole object is
    // the settings map) or the wrapped shape ({ settings, ... }) used by
    // older versions that bundled a thumbnailHashes sidecar. Detect by
    // looking for the `settings` marker key. The thumbnailHashes blob is
    // ignored — page-1 fingerprints now live in each file's frontmatter.
    const wrapped = data && typeof data === "object" && "settings" in data;
    const rawSettings = wrapped
      ? (data as { settings?: unknown }).settings as Partial<PaperSettings> | null
      : data as Partial<PaperSettings> | null;
    this.settings = mergeSettings(rawSettings);
    this.clipboard.maxSize = this.settings.clipboardQueueSize;

    // Load device settings from localStorage
    this.deviceSettings = loadDeviceSettings(this.app);

    // One-time migration: if localStorage is empty but data.json had device-specific fields,
    // seed localStorage from the legacy data.json values.
    const localRaw = this.app.loadLocalStorage("paper-device-settings");
    if (!localRaw && data) {
      let migrated = false;

      const legacyPipeline = data["defaultRenderPipeline"] as string | undefined;
      if (legacyPipeline) {
        let pipeline = legacyPipeline;
        if (pipeline === "textures" || pipeline === "stamps") pipeline = "advanced";
        this.deviceSettings.defaultRenderPipeline = pipeline as DeviceSettings["defaultRenderPipeline"];
        migrated = true;
      }
      const legacyEngine = data["defaultRenderEngine"] as string | undefined;
      if (legacyEngine) {
        this.deviceSettings.defaultRenderEngine = legacyEngine as DeviceSettings["defaultRenderEngine"];
        migrated = true;
      }
      if (typeof data["palmRejection"] === "boolean") {
        this.deviceSettings.palmRejection = data["palmRejection"];
        migrated = true;
      }
      if (data["fingerAction"] === "pan" || data["fingerAction"] === "draw") {
        this.deviceSettings.fingerAction = data["fingerAction"];
        migrated = true;
      }
      const legacyPosition = data["toolbarPosition"] as string | undefined;
      if (legacyPosition === "top" || legacyPosition === "bottom" || legacyPosition === "left" || legacyPosition === "right") {
        this.deviceSettings.toolbarPosition = legacyPosition;
        migrated = true;
      }

      if (migrated) {
        this.saveDeviceSettingsLocal();
      }
    }
  }

  private async saveSettings(): Promise<void> {
    this.clipboard.maxSize = this.settings.clipboardQueueSize;
    await this.saveData({ settings: this.settings });
  }

  /**
   * Open a paper file in the Paper editor view. For `.paper.md` files this
   * forces the leaf to switch from the default markdown view to our view.
   */
  private async openInPaperView(file: TFile): Promise<void> {
    this.userRequestedMarkdown.delete(file.path);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const kind = classifyPaperFile(file.name);
    if (kind === "md") {
      await leaf.setViewState({
        type: VIEW_TYPE_PAPER,
        state: { file: file.path },
      });
    }
  }

  /**
   * Flip `paper-default-view` between `paper` and `markdown` in the file's
   * frontmatter, then swap the active leaf to match.
   */
  private async togglePaperView(file: TFile): Promise<void> {
    // Treat anything-not-explicitly-"markdown" as currently-paper. Files
    // open as Paper view by default (no frontmatter required), so a missing
    // value means the user is currently in Paper and wants to flip out.
    const cache = this.app.metadataCache.getFileCache(file);
    const currentlyMarkdown = cache?.frontmatter?.["paper-default-view"] === "markdown";
    const nextView: "paper" | "markdown" = currentlyMarkdown ? "paper" : "markdown";

    // Set the bypass BEFORE any async work so any incidental file-open or
    // active-leaf-change events fired during save / processFrontMatter /
    // setViewState don't trigger the auto-swap-back-to-Paper logic.
    if (nextView === "markdown") {
      this.userRequestedMarkdown.add(file.path);
    } else {
      this.userRequestedMarkdown.delete(file.path);
    }

    // Persist any unsaved canvas state before we yank the view out.
    const paperView = this.app.workspace.getActiveViewOfType(PaperView);
    if (paperView && paperView.file === file) {
      await paperView.save();
    }

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm["paper-default-view"] = nextView;
    });

    // Target the specific leaf showing this file rather than activeLeaf —
    // popover dismissal could in theory shift focus, and we want to flip
    // the leaf that actually has the document.
    let targetLeaf: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const leafFile = (leaf.view as { file?: TFile }).file;
      if (leafFile?.path === file.path) targetLeaf = leaf;
    });
    if (!targetLeaf) targetLeaf = this.app.workspace.activeLeaf;
    if (!targetLeaf) return;

    await (targetLeaf as WorkspaceLeaf).setViewState({
      type: nextView === "paper" ? VIEW_TYPE_PAPER : "markdown",
      state: { file: file.path },
      active: true,
    });
  }

  /**
   * Called when a `.paper.md` file opens. If the user has set
   * `paper-default-view: markdown` in frontmatter, leaves the leaf in
   * markdown view. Otherwise swaps every leaf currently showing this file
   * to the Paper editor view.
   *
   * Two subtleties we learned the hard way:
   *  - We preserve `leaf.getViewState().state` (not just `{ file }`); that
   *    matches what Excalidraw does and gives Obsidian the existing state
   *    fields (mode, source, etc.) so it doesn't reject the swap.
   *  - We defer with a microtask so the markdown view finishes mounting
   *    before we tear it down — otherwise the swap races Obsidian's own
   *    rendering and silently no-ops.
   */
  private maybeSwapToPaperView(file: TFile): void {
    if (this.userRequestedMarkdown.has(file.path)) return;
    const cache = this.app.metadataCache.getFileCache(file);
    const defaultView = cache?.frontmatter?.["paper-default-view"];
    if (defaultView === "markdown") return;

    // Hide any markdown view currently showing this file before the swap
    // commits, so we don't flash the markdown source. Safe even if the
    // leaf hasn't mounted yet — will be a no-op and picked up by retries.
    this.hidePendingPaperLeaves(file.path);

    if (this.pendingPaperSwaps.has(file.path)) return;
    this.pendingPaperSwaps.add(file.path);
    void this.doSwapToPaperView(file, 0);
  }

  /**
   * Mark any non-Paper view showing this file as "pending swap" so our CSS
   * hides its container. The marker is put on the view's containerEl; when
   * setViewState replaces the view, the marked element gets torn down with
   * the old view and the new PaperView's unhidden container takes its place.
   */
  private hidePendingPaperLeaves(filePath: string): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view.getViewType() === VIEW_TYPE_PAPER) return;
      const leafFile = (leaf.view as { file?: TFile }).file;
      if (leafFile?.path !== filePath) return;
      leaf.view.containerEl.classList.add("paper-view-pending-swap");
    });
  }

  /** Safety: if the swap gives up without flipping, unhide so the user
   *  isn't stuck staring at a blank leaf. */
  private unhideIfStillPending(filePath: string): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const leafFile = (leaf.view as { file?: TFile }).file;
      if (leafFile?.path !== filePath) return;
      leaf.view.containerEl.classList.remove("paper-view-pending-swap");
    });
  }

  /**
   * `setViewState` silently no-ops when `active: false` and the leaf is
   * mid-transition. It can also be called before Obsidian has finished
   * mounting the markdown view. We pass `active: true` unconditionally and
   * retry with exponential backoff if the view type didn't flip.
   */
  private async doSwapToPaperView(file: TFile, attempt: number): Promise<void> {
    const MAX_ATTEMPTS = 5;

    const targets: WorkspaceLeaf[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view.getViewType() === VIEW_TYPE_PAPER) return;
      const leafFile = (leaf.view as { file?: TFile }).file;
      if (leafFile?.path === file.path) targets.push(leaf);
    });

    if (targets.length === 0) {
      // No leaf is showing this file yet — retry while it mounts. iPad
      // takes longer to stand up the markdown leaf when switching files,
      // so the budget is generous (8 attempts with exponential backoff,
      // ~1.5 s total). Mac usually succeeds on attempt 0 anyway.
      if (attempt < 8) {
        const delay = 50 * Math.pow(1.4, attempt);
        setTimeout(() => { void this.doSwapToPaperView(file, attempt + 1); }, delay);
        return;
      }
      this.pendingPaperSwaps.delete(file.path);
      return;
    }

    let allSwapped = true;
    for (const leaf of targets) {
      try {
        await leaf.setViewState({
          type: VIEW_TYPE_PAPER,
          state: { file: file.path },
          active: true,
        });
        if (leaf.view.getViewType() !== VIEW_TYPE_PAPER) allSwapped = false;
      } catch (e) {
        console.error("[Paper] setViewState threw:", e);
        allSwapped = false;
      }
    }

    if (!allSwapped && attempt < MAX_ATTEMPTS) {
      const delay = 50 * Math.pow(1.8, attempt);
      setTimeout(() => { void this.doSwapToPaperView(file, attempt + 1); }, delay);
      return;
    }

    this.pendingPaperSwaps.delete(file.path);
    // Whether we succeeded or exhausted retries, make sure we don't leave
    // a hidden markdown leaf behind.
    this.unhideIfStillPending(file.path);
  }

  private getOcrBackend(): OcrBackend | null {
    if (this.settings.ocrBackend === "handwriting-ocr") {
      return new HandwritingOcrBackend(() => ({
        apiToken: this.settings.handwritingOcrApiToken,
      }));
    }
    return null;
  }

  /**
   * Run incremental OCR over a file. Reads the file from disk so any
   * in-memory edits in the calling view should be flushed first.
   * Returns true if any work was done; false if everything was clean
   * (and `notifyEmpty` already showed a Notice or stayed silent).
   */
  private async runOcrForFile(
    file: TFile,
    options: { force: boolean; notifyEmpty: boolean },
  ): Promise<boolean> {
    const backend = this.getOcrBackend();
    if (!backend) {
      new Notice("OCR disabled. Pick a backend in settings.");
      return false;
    }
    if (!backend.isConfigured()) {
      new Notice("OCR backend not configured. Add an API token in settings.");
      return false;
    }

    // Reset the monthly counter if we've rolled into a new month.
    const resetPatch = resetMonthlyCounterIfNeeded(this.settings);
    if (resetPatch) {
      Object.assign(this.settings, resetPatch);
      await this.saveSettings();
    }

    const raw = await this.app.vault.read(file);
    const parsed = deserializePaperMd(raw);
    const previousFps = parsed.frontmatter["paper-ocr-pages-fp"];
    const dirtyCount = countDirtyPages(parsed.document, options.force ? undefined : previousFps);
    if (dirtyCount === 0 && !options.force) {
      // Bump `last-run` so the (timestamp-based) dirty indicator clears
      // even when no pages were actually re-recognized — otherwise an
      // indicator-triggered tap-and-no-op leaves the indicator stuck on.
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm["paper-ocr"] = {
          ...(fm["paper-ocr"] ?? {}),
          "last-run": new Date().toISOString(),
        };
      });
      if (options.notifyEmpty) new Notice("OCR already up to date for this document.");
      return false;
    }

    const effectiveDirty = options.force
      ? documentPageFingerprints(parsed.document).filter((fp) => fp !== "").length
      : dirtyCount;
    const quota = checkQuota(this.settings, effectiveDirty);
    if (!quota.ok) {
      new Notice(`OCR paused: ${quota.reason} Raise the cap in settings or wait until next month.`, 10000);
      return false;
    }

    const progress = new Notice("Preparing OCR…", 0);
    try {
      const runResult = await runIncrementalOcr({
        document: parsed.document,
        previousPageFingerprints: previousFps,
        previousTranscript: parsed.transcript,
        backend,
        force: options.force,
        onProgress: (p) => {
          const msg = `page ${p.currentPage}/${p.totalPages} ${p.phase}`;
          progress.setMessage(`OCR: ${msg} (${p.pagesReused} reused, ${p.pagesRecognizing} new)`);
        },
      });

      // Re-read in case the view (or anyone else) modified the file mid-run.
      const currentRaw = await this.app.vault.read(file);
      const currentParsed = deserializePaperMd(currentRaw);
      const updatedFm = {
        ...currentParsed.frontmatter,
        "paper-ocr-pages-fp": runResult.pageFingerprints,
        "paper-ocr": {
          ...(currentParsed.frontmatter["paper-ocr"] ?? {}),
          backend: backend.id,
          "last-run": new Date().toISOString(),
        },
      };
      const updated = serializePaperMd({
        document: currentParsed.document,
        frontmatter: updatedFm,
        transcript: runResult.transcript,
        prelude: currentParsed.prelude,
      });
      await this.app.vault.modify(file, updated);

      if (runResult.pagesRecognized > 0) {
        Object.assign(this.settings, incrementCounter(this.settings, runResult.pagesRecognized));
        await this.saveSettings();
      }

      progress.hide();
      if (runResult.pagesRecognized === 0 && runResult.pagesReused > 0) {
        new Notice(`OCR up to date — reused all ${runResult.pagesReused} pages.`, 5000);
      } else {
        new Notice(
          `OCR: ${runResult.pagesRecognized} page(s) recognized, ${runResult.pagesReused} reused.`,
          6000,
        );
      }
      return true;
    } catch (e) {
      progress.hide();
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`OCR failed: ${message}`, 10000);
      console.error("[Paper OCR]", e);
      return false;
    }
  }

  private async runOcrCommand(options: { force: boolean } = { force: false }): Promise<void> {
    const view = this.getActivePaperView();
    if (!view || !view.file || classifyPaperFile(view.file.name) !== "md") {
      new Notice("Open a .paper.md file first.");
      return;
    }
    // Flush in-memory edits before we read from disk.
    await view.save();
    await this.runOcrForFile(view.file, { force: options.force, notifyEmpty: true });
  }

  /**
   * Process button handler. Each mode is incremental by default — only
   * dirty pages get re-OCR'd, and the thumbnail is regenerated only if
   * page-1's fingerprint moved. Force flags bypass the dirty check; used
   * by the long-press menu's "Force …" entries.
   */
  private async processCurrentFile(
    view: PaperView,
    mode: "both" | "ocr" | "thumbnail",
    options: { forceOcr?: boolean; forceThumbnail?: boolean } = {},
  ): Promise<void> {
    const file = view.file;
    if (!file || classifyPaperFile(file.name) !== "md") {
      new Notice("This file isn't a .paper.md.");
      return;
    }
    await view.save();

    const wantsOcr = mode === "both" || mode === "ocr";
    const wantsThumbnail = mode === "both" || mode === "thumbnail";
    const ocrConfigured =
      wantsOcr && this.settings.ocrBackend !== "none" && (this.getOcrBackend()?.isConfigured() ?? false);
    const thumbnailEnabled = wantsThumbnail && this.settings.thumbnailsEnabled && this.thumbnailManager !== null;

    if (!ocrConfigured && !thumbnailEnabled) {
      new Notice(
        wantsOcr && wantsThumbnail
          ? "Nothing to update — enable OCR or thumbnails in settings."
          : wantsOcr
            ? "OCR backend not configured. Add an API token in settings."
            : "Thumbnails disabled. Enable them in settings.",
        6000,
      );
      return;
    }

    // Pre-check dirtiness when neither force flag is set, so we can short-circuit
    // with the "everything up to date" Notice instead of running silent no-ops.
    if (!options.forceOcr && !options.forceThumbnail) {
      const ocrDirty = ocrConfigured ? await this.isOcrDirty(file) : false;
      const thumbDirty = thumbnailEnabled
        ? await (this.thumbnailManager as ThumbnailManager).isDirty(file)
        : false;
      if (!ocrDirty && !thumbDirty) {
        new Notice("Everything up to date.", 4000);
        return;
      }
    }

    if (ocrConfigured) {
      await this.runOcrForFile(file, { force: options.forceOcr ?? false, notifyEmpty: false });
    }
    if (thumbnailEnabled && this.thumbnailManager) {
      if (options.forceThumbnail) {
        await this.thumbnailManager.regenerateNow(file);
      } else {
        // Non-force path uses the manager's internal fp comparison; same
        // outcome as regenerateNow when dirty, no-op when clean.
        const wrote = await this.thumbnailManager.regenerateNow(file);
        if (!wrote && !ocrConfigured) {
          // Only OCR was disabled and the thumbnail was already current —
          // the pre-check above caught this, so this branch is rare.
        }
      }
    }
    this.refreshProcessDirty(view);
  }

  /**
   * Is OCR dirty for `file` (i.e. would running incremental do work)?
   * Reads the file's frontmatter via metadataCache, falling back to a disk
   * read so we don't miss recent writes.
   */
  private async isOcrDirty(file: TFile): Promise<boolean> {
    const cache = this.app.metadataCache.getFileCache(file);
    const cachedFps = (cache?.frontmatter as { "paper-ocr-pages-fp"?: string[] } | undefined)?.["paper-ocr-pages-fp"];

    let raw: string;
    try {
      raw = await this.app.vault.read(file);
    } catch {
      return false;
    }
    const parsed = deserializePaperMd(raw);
    const stored = cachedFps ?? parsed.frontmatter["paper-ocr-pages-fp"];
    return countDirtyPages(parsed.document, stored) > 0;
  }

  /**
   * True if the given view has pending OCR or thumbnail work. Called to
   * drive the toolbar button's dirty indicator.
   *
   * Cheap timestamp comparison rather than recomputing per-page
   * fingerprints — fingerprinting was measurable on iPad during sustained
   * drawing, and the indicator only needs to answer "is anything stale?",
   * not "exactly which pages are stale". The OCR runner still uses
   * fingerprints internally when it actually runs (manual trigger only)
   * for cost-efficient per-page incremental.
   *
   * Trade-off: any save (even one that doesn't touch text content, e.g.
   * a viewport pan auto-save) will mark the file dirty until OCR/thumbnail
   * is re-run. In practice users only save by drawing, and a slight
   * over-trigger is invisible since they'd just tap Process anyway.
   */
  private isProcessDirty(view: PaperView): boolean {
    const file = view.file;
    if (!file || classifyPaperFile(file.name) !== "md") return false;
    const doc = view.getDocument();
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as
      | {
          "paper-ocr"?: { "last-run"?: string };
          "paper-thumbnail-last-gen"?: string;
        }
      | undefined;

    const docModified = doc.meta.modified;

    if (this.settings.ocrBackend !== "none") {
      const lastRun = fm?.["paper-ocr"]?.["last-run"];
      const lastRunMs = lastRun ? Date.parse(lastRun) : 0;
      // Page-0-has-strokes guard so a brand-new empty file isn't dirty.
      const hasAnyStrokes = doc.strokes.length > 0;
      if (hasAnyStrokes && docModified > lastRunMs) return true;
    }
    if (this.settings.thumbnailsEnabled) {
      const lastGen = fm?.["paper-thumbnail-last-gen"];
      const lastGenMs = lastGen ? Date.parse(lastGen) : 0;
      const page0HasStrokes = doc.strokes.some((s) => s.pageIndex === 0);
      if (page0HasStrokes && docModified > lastGenMs) return true;
    }
    return false;
  }

  private refreshProcessDirty(view: PaperView | null = this.getActivePaperView()): void {
    if (!view) return;
    view.setProcessDirty(this.isProcessDirty(view));
  }

  private async runPaperMigrationCommand(): Promise<void> {
    const planningNotice = new Notice("Scanning vault for .paper files…", 0);
    let plan;
    try {
      plan = await planMigration(this.app);
    } finally {
      planningNotice.hide();
    }

    if (plan.paperFiles.length === 0 && plan.skipped.length === 0) {
      new Notice("No .paper files found — nothing to migrate.");
      return;
    }

    const choice = await new Promise<"run" | "cancel">((resolve) => {
      new MigrationConfirmModal(this.app, plan, resolve).open();
    });
    if (choice === "cancel") return;

    const progress = new Notice("Migrating…", 0);
    try {
      const result = await runMigration(
        this.app,
        plan,
        this.manifest.version,
        (status) => progress.setMessage(status),
      );
      progress.hide();

      if (result.failed.length === 0) {
        new Notice(
          `Migration complete: converted ${result.migrated} .paper files, rewrote ${result.rewritten} embed refs.`,
          8000,
        );
      } else {
        new Notice(
          `Migration finished with ${result.failed.length} failures. Converted ${result.migrated}, rewrote ${result.rewritten}. See console.`,
          10000,
        );
        for (const f of result.failed) {
          console.error("[Paper migration]", f.path, "—", f.reason);
        }
      }
    } catch (e) {
      progress.hide();
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`Migration aborted: ${message}`, 10000);
    }
  }

  private async runRegenerateThumbnailCommand(file: TFile): Promise<void> {
    if (!this.thumbnailManager) return;
    try {
      const wrote = await this.thumbnailManager.regenerateNow(file);
      if (wrote) new Notice(`Thumbnail regenerated for ${file.name}.`);
      else new Notice(`No thumbnail written — first page is empty.`, 5000);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`Thumbnail regen failed: ${message}`, 10000);
    }
  }

  private async runReformatCommand(): Promise<void> {
    const progress = new Notice("Re-formatting .paper.md files…", 0);
    try {
      const result = await reformatAllPaperMd(this.app, (status) => progress.setMessage(status));
      progress.hide();
      if (result.failed.length === 0) {
        new Notice(
          `Re-formatted ${result.updated} files (${result.unchanged} already current).`,
          6000,
        );
      } else {
        new Notice(
          `Re-formatted ${result.updated}; ${result.failed.length} failed. See console.`,
          10000,
        );
        for (const f of result.failed) {
          console.error("[Paper re-format]", f.path, "—", f.reason);
        }
      }
    } catch (e) {
      progress.hide();
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`Re-format aborted: ${message}`, 10000);
    }
  }

  private async runBackupCleanupCommand(): Promise<void> {
    const listing = listBackups(this.app);
    const summary = {
      count: listing.total,
      paths: listing.files.map((f) => f.path),
    };

    const confirmed = await new Promise<boolean>((resolve) => {
      new BackupCleanupModal(this.app, summary, resolve).open();
    });
    if (!confirmed) return;

    const progress = new Notice("Deleting backups…", 0);
    try {
      const result = await deleteBackups(this.app, (status) => progress.setMessage(status));
      progress.hide();
      if (result.failed.length === 0) {
        new Notice(`Deleted ${result.deleted} .paper backups.`);
      } else {
        new Notice(
          `Deleted ${result.deleted} backups, ${result.failed.length} failed. See console.`,
          10000,
        );
        for (const f of result.failed) {
          console.error("[Paper backup delete]", f.path, "—", f.reason);
        }
      }
    } catch (e) {
      progress.hide();
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`Cleanup aborted: ${message}`, 10000);
    }
  }

  private openPaperModal(file: TFile): void {
    const modal = new EmbeddedPaperModal(
      this.app,
      file,
      this.settings,
      this.deviceSettings,
      () => {
        // On dismiss, embeds auto-refresh via the vault modify listener
      },
      (changes) => {
        Object.assign(this.settings, changes);
        void this.saveSettings();
        this.notifySettingsListeners();
      },
      (changes) => {
        Object.assign(this.deviceSettings, changes);
        this.saveDeviceSettingsLocal();
        this.notifyDeviceSettingsListeners();
      },
    );
    modal.open();
  }

  private refreshEmbedsFor(filePath: string): void {
    // Remove stale entries (container no longer in DOM) and refresh matching ones
    this.embedRegistry = this.embedRegistry.filter((entry) => {
      if (!entry.container.isConnected) return false;
      if (entry.filePath === filePath) {
        entry.reRender();
      }
      return true;
    });
  }

  private getActivePaperView(): PaperView | null {
    const view = this.app.workspace.getActiveViewOfType(PaperView);
    return view;
  }

  private registerNotebookNavigatorMenu(): void {
    // Notebook Navigator (community plugin) exposes a Menus API that lets
    // other plugins add items to its folder context menu. We defer until
    // layout-ready so that Notebook Navigator has finished loading.
    this.app.workspace.onLayoutReady(() => {
      this.tryRegisterNotebookNavigatorMenu();
    });
  }

  private tryRegisterNotebookNavigatorMenu(attempt = 0): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugins = (this.app as any).plugins?.plugins as Record<string, any> | undefined;
    const registerFolderMenu = plugins?.["notebook-navigator"]?.api?.menus?.registerFolderMenu as
      | ((cb: (ctx: { addItem: (cb: (item: { setTitle: (t: string) => any; setIcon: (i: string) => any; onClick: (cb: () => void) => any }) => void) => void; folder: TFolder }) => void) => () => void)
      | undefined;
    if (!registerFolderMenu) return;

    try {
      const dispose = registerFolderMenu(({ addItem, folder }) => {
        addItem((item) => {
          item.setTitle("New Paper Document")
            .setIcon("pen-tool")
            .onClick(() => void this.createNewPaper(folder));
        });
      });
      this.register(dispose);
    } catch (e) {
      // Notebook Navigator may expose its API before internal state
      // (folderMenuExtensions) is initialized. Retry with backoff.
      if (attempt < 5) {
        window.setTimeout(() => this.tryRegisterNotebookNavigatorMenu(attempt + 1), 500 * (attempt + 1));
      } else {
        console.error("[Paper] Failed to register Notebook Navigator menu after retries:", e);
      }
    }
  }

  private async resolveNewNoteFolder(): Promise<TFolder> {
    const mode = this.settings.newNoteLocation;

    if (mode === "current") {
      const parent = this.app.workspace.getActiveFile()?.parent;
      return parent instanceof TFolder ? parent : this.app.vault.getRoot();
    }

    if (mode === "subfolder") {
      const parent = this.app.workspace.getActiveFile()?.parent;
      const base = parent instanceof TFolder ? parent : this.app.vault.getRoot();
      const sub = this.settings.newNoteSubfolder;
      if (!sub) return base;
      const subPath = normalizePath(`${base.path}/${sub}`);
      const existing = this.app.vault.getAbstractFileByPath(subPath);
      if (existing instanceof TFolder) return existing;
      try {
        await this.app.vault.createFolder(subPath);
        const created = this.app.vault.getAbstractFileByPath(subPath);
        if (created instanceof TFolder) return created;
      } catch {
        // Folder may already exist or creation failed — fall back to parent
      }
      return base;
    }

    // "specified" (default)
    const folderPath = this.settings.defaultFolder;
    if (folderPath) {
      const existing = this.app.vault.getAbstractFileByPath(folderPath);
      if (existing instanceof TFolder) return existing;
    }
    return this.app.vault.getRoot();
  }

  private async createNewPaper(folderOverride?: TFolder): Promise<void> {
    const defaultFolder = folderOverride ?? await this.resolveNewNoteFolder();
    const defaultName = this.generateDefaultName();

    new NewPaperModal(this.app, defaultName, defaultFolder, (result) => {
      void this.doCreatePaper(result.name, result.folder);
    }).open();
  }

  private async doCreatePaper(baseName: string, folder: TFolder): Promise<void> {
    const uniqueName = this.ensureUniqueName(baseName, folder);
    const path = normalizePath(`${folder.path}/${uniqueName}.paper.md`);

    const doc = createEmptyDocument(
      this.manifest.version,
      resolvePageSize(this.settings),
      this.settings.defaultOrientation,
      this.settings.defaultPaperType,
      this.settings.defaultLayoutDirection,
      resolveMargins(this.settings),
    );
    // Apply settings to first page
    if (doc.pages.length > 0) {
      doc.pages[0].lineSpacing = this.settings.lineSpacing;
      doc.pages[0].gridSize = this.settings.gridSize;
    }
    const content = serializePaperMd({
      document: doc,
      frontmatter: {
        "paper-version": PAPER_MD_VERSION,
        "paper-default-view": "paper",
      },
    });

    try {
      const file = await this.app.vault.create(path, content);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`Failed to create paper note: ${message}`);
    }
  }

  private async exportCurrentAsSvg(view: PaperView): Promise<void> {
    const file = view.file;
    if (!file) {
      new Notice("No file open to export");
      return;
    }

    try {
      const data = view.getViewData();
      const kind = classifyPaperFile(file.name);
      const doc = kind === "md"
        ? deserializePaperMd(data).document
        : deserializeDocument(data);
      const isDark = document.body.classList.contains("theme-dark");
      const svg = exportToSvg(doc, isDark);

      const svgPath = kind === "md"
        ? file.path.replace(/\.paper\.md$/i, ".svg")
        : file.path.replace(/\.[^.]+$/, ".svg");
      const normalizedPath = normalizePath(svgPath);

      const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, svg);
      } else {
        await this.app.vault.create(normalizedPath, svg);
      }

      new Notice(`Exported SVG to ${normalizedPath}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`SVG export failed: ${message}`);
    }
  }

  private generateDefaultName(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const hours = now.getHours();
    const h = hours % 12 || 12;
    const ampm = hours < 12 ? "AM" : "PM";
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${h}.${pad(now.getMinutes())} ${ampm}`;
  }

  private ensureUniqueName(base: string, folder: TFolder): string {
    const existingFullNames = new Set(
      folder.children
        .filter((f): f is TFile => f instanceof TFile)
        .map((f) => f.name.toLowerCase())
    );

    const candidate = (name: string): string => `${name}.paper.md`.toLowerCase();

    if (!existingFullNames.has(candidate(base))) return base;

    let i = 1;
    while (existingFullNames.has(candidate(`${base} ${i}`))) {
      i++;
    }
    return `${base} ${i}`;
  }
}
