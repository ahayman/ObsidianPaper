import { Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { PaperView, VIEW_TYPE_PAPER, PAPER_EXTENSION } from "./view/PaperView";
import { createEmptyDocument } from "./document/Document";
import { serializeDocument, deserializeDocument } from "./document/Serializer";
import { DEFAULT_SETTINGS, mergeSettings, resolvePageSize, resolveMargins } from "./settings/PaperSettings";
import type { PaperSettings } from "./settings/PaperSettings";
import { PaperSettingsTab } from "./settings/PaperSettingsTab";
import type { DeviceSettings } from "./settings/DeviceSettings";
import { DEFAULT_DEVICE_SETTINGS, loadDeviceSettings, saveDeviceSettings } from "./settings/DeviceSettings";
import { createEmbedPostProcessor } from "./embed/EmbedPostProcessor";
import type { EmbedEntry } from "./embed/EmbedPostProcessor";
import { EmbeddedPaperModal } from "./embed/EmbeddedPaperModal";
import { exportToSvg } from "./export/SvgExporter";

export default class PaperPlugin extends Plugin {
  settings: PaperSettings = DEFAULT_SETTINGS;
  deviceSettings: DeviceSettings = DEFAULT_DEVICE_SETTINGS;
  private settingsListeners: Set<(settings: PaperSettings) => void> = new Set();
  private deviceSettingsListeners: Set<(ds: DeviceSettings) => void> = new Set();
  private embedRegistry: EmbedEntry[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_PAPER, (leaf) => {
      const view = new PaperView(leaf);
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

    // Auto-refresh embeds when .paper files are modified
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === PAPER_EXTENSION) {
          this.refreshEmbedsFor(file.path);
        }
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
    await this.saveData(this.settings);
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

  private tryRegisterNotebookNavigatorMenu(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugins = (this.app as any).plugins?.plugins as Record<string, any> | undefined;
    const registerFolderMenu = plugins?.["notebook-navigator"]?.api?.menus?.registerFolderMenu as
      | ((cb: (menu: { addItem: (cb: (item: { setTitle: (t: string) => any; setIcon: (i: string) => any; onClick: (cb: () => void) => any }) => void) => void }, folder: TFolder) => void) => void)
      | undefined;
    if (!registerFolderMenu) return;

    registerFolderMenu((menu, folder) => {
      menu.addItem((item) => {
        item.setTitle("New Paper Document")
          .setIcon("pen-tool")
          .onClick(() => void this.createNewPaper(folder));
      });
    });
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
    const folder = folderOverride ?? await this.resolveNewNoteFolder();

    const baseName = this.generateFileName(folder);
    const path = normalizePath(`${folder.path}/${baseName}.${PAPER_EXTENSION}`);

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
    const content = serializeDocument(doc);

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
      const doc = deserializeDocument(data);
      const isDark = document.body.classList.contains("theme-dark");
      const svg = exportToSvg(doc, isDark);

      const svgPath = file.path.replace(/\.[^.]+$/, ".svg");
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

  private generateFileName(folder: TFolder): string {
    const base = this.settings.fileNameTemplate || "Untitled Paper";
    const existingNames = new Set(
      folder.children
        .filter((f): f is TFile => f instanceof TFile)
        .map((f) => f.basename)
    );

    if (!existingNames.has(base)) return base;

    let i = 1;
    while (existingNames.has(`${base} ${i}`)) {
      i++;
    }
    return `${base} ${i}`;
  }
}
