import { Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
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
} from "./migration/PaperMigrator";
import { MigrationConfirmModal, BackupCleanupModal } from "./migration/MigrationModal";
import { HandwritingOcrBackend } from "./ocr/HandwritingOcrBackend";
import type { OcrBackend } from "./ocr/OcrBackend";
import { runIncrementalOcr, countDirtyPages } from "./ocr/IncrementalOcrRunner";
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

    // Auto-refresh embeds when .paper or .paper.md files are modified
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && classifyPaperFile(file.name)) {
          this.refreshEmbedsFor(file.path);
        }
      })
    );

    // Route .paper.md files to the Paper editor view unless the user has
    // explicitly asked for markdown via `paper-default-view: markdown`.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!(file instanceof TFile)) return;
        if (classifyPaperFile(file.name) !== "md") return;
        this.maybeSwapToPaperView(file);
      })
    );

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
        void this.runOcrCommand();
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
    this.settings = mergeSettings(data as Partial<PaperSettings> | null);
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
    await this.saveData(this.settings);
  }

  /**
   * Open a paper file in the Paper editor view. For `.paper.md` files this
   * forces the leaf to switch from the default markdown view to our view.
   */
  private async openInPaperView(file: TFile): Promise<void> {
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
    // Persist any unsaved canvas state before we yank the view out.
    const paperView = this.app.workspace.getActiveViewOfType(PaperView);
    if (paperView && paperView.file === file) {
      await paperView.save();
    }

    let nextView: "paper" | "markdown" = "paper";
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const current = fm["paper-default-view"];
      nextView = current === "paper" ? "markdown" : "paper";
      fm["paper-default-view"] = nextView;
    });

    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;
    await leaf.setViewState({
      type: nextView === "paper" ? VIEW_TYPE_PAPER : "markdown",
      state: { file: file.path },
    });
  }

  /**
   * Called when a `.paper.md` file opens. If the user has set
   * `paper-default-view: markdown` in frontmatter, leaves the leaf in
   * markdown view. Otherwise swaps to the Paper editor view.
   */
  private maybeSwapToPaperView(file: TFile): void {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;
    if (leaf.view.getViewType() === VIEW_TYPE_PAPER) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const defaultView = cache?.frontmatter?.["paper-default-view"];
    if (defaultView === "markdown") return;

    void leaf.setViewState({
      type: VIEW_TYPE_PAPER,
      state: { file: file.path },
    });
  }

  private getOcrBackend(): OcrBackend | null {
    if (this.settings.ocrBackend === "handwriting-ocr") {
      return new HandwritingOcrBackend(() => ({
        apiToken: this.settings.handwritingOcrApiToken,
      }));
    }
    return null;
  }

  private async runOcrCommand(): Promise<void> {
    const view = this.getActivePaperView();
    if (!view || !view.file || classifyPaperFile(view.file.name) !== "md") {
      new Notice("Open a .paper.md file first.");
      return;
    }

    const backend = this.getOcrBackend();
    if (!backend) {
      new Notice("OCR disabled. Pick a backend in settings.");
      return;
    }
    if (!backend.isConfigured()) {
      new Notice("OCR backend not configured. Add an API token in settings.");
      return;
    }

    // Reset the monthly counter if we've rolled into a new month.
    const resetPatch = resetMonthlyCounterIfNeeded(this.settings);
    if (resetPatch) {
      Object.assign(this.settings, resetPatch);
      await this.saveSettings();
    }

    const doc = view.getDocument();
    const previous = view.getMdOcr();
    const dirtyPages = countDirtyPages(doc, previous);
    if (dirtyPages === 0) {
      new Notice("OCR already up to date for this document.");
      return;
    }
    const quota = checkQuota(this.settings, dirtyPages);
    if (!quota.ok) {
      new Notice(`OCR paused: ${quota.reason} Raise the cap in settings or wait until next month.`, 10000);
      return;
    }

    const progress = new Notice("Preparing OCR…", 0);
    try {
      const runResult = await runIncrementalOcr({
        document: doc,
        previous,
        backend,
        onProgress: (p) => {
          progress.setMessage(
            `OCR: page ${p.currentPage}/${p.totalPages} — ${p.phase} ` +
            `(${p.pagesReused} reused, ${p.pagesRecognizing} new)`,
          );
        },
      });

      view.applyOcrResult(runResult.ocr);

      // Only charge quota for pages we actually sent to the backend.
      if (runResult.pagesRecognized > 0) {
        Object.assign(this.settings, incrementCounter(this.settings, runResult.pagesRecognized));
        await this.saveSettings();
      }

      progress.hide();
      const lineTotal = runResult.ocr.pages.reduce((n, p) => n + p.lines.length, 0);
      if (runResult.pagesRecognized === 0 && runResult.pagesReused > 0) {
        new Notice(`OCR up to date — reused all ${runResult.pagesReused} pages.`, 5000);
      } else {
        new Notice(
          `OCR complete: ${lineTotal} lines, ${runResult.pagesRecognized} page(s) recognized, ${runResult.pagesReused} reused.`,
          6000,
        );
      }
    } catch (e) {
      progress.hide();
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`OCR failed: ${message}`, 10000);
      console.error("[Paper OCR]", e);
    }
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
