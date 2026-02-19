import { Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { PaperView, VIEW_TYPE_PAPER, PAPER_EXTENSION } from "./view/PaperView";
import { createEmptyDocument } from "./document/Document";
import { serializeDocument, deserializeDocument } from "./document/Serializer";
import { DEFAULT_SETTINGS, mergeSettings, resolvePageSize, resolveMargins } from "./settings/PaperSettings";
import type { PaperSettings } from "./settings/PaperSettings";
import { PaperSettingsTab } from "./settings/PaperSettingsTab";
import { createEmbedPostProcessor } from "./embed/EmbedPostProcessor";
import { exportToSvg } from "./export/SvgExporter";

export default class PaperPlugin extends Plugin {
  settings: PaperSettings = DEFAULT_SETTINGS;
  private settingsListeners: Set<(settings: PaperSettings) => void> = new Set();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_PAPER, (leaf) => {
      const view = new PaperView(leaf);
      view.setSettings(this.settings);
      view.onSettingsChange = (changes) => {
        Object.assign(this.settings, changes);
        void this.saveSettings();
        this.notifySettingsListeners();
      };
      return view;
    });
    this.registerExtensions([PAPER_EXTENSION], VIEW_TYPE_PAPER);

    // Register embed post processor for reading mode
    this.registerMarkdownPostProcessor(
      createEmbedPostProcessor(this.app, () => {
        return document.body.classList.contains("theme-dark");
      })
    );

    this.addSettingTab(
      new PaperSettingsTab(this.app, this, this.settings, (s) => {
        this.settings = s;
        void this.saveSettings();
        this.notifySettingsListeners();
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
  }

  onunload(): void {
    this.settingsListeners.clear();
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

  private async loadSettings(): Promise<void> {
    const data: unknown = await this.loadData();
    this.settings = mergeSettings(data as Partial<PaperSettings> | null);
  }

  private async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private getActivePaperView(): PaperView | null {
    const view = this.app.workspace.getActiveViewOfType(PaperView);
    return view;
  }

  private async createNewPaper(): Promise<void> {
    const folderPath = this.settings.defaultFolder;
    let folder: TFolder;

    if (folderPath) {
      const existing = this.app.vault.getAbstractFileByPath(folderPath);
      if (existing instanceof TFolder) {
        folder = existing;
      } else {
        folder = this.app.vault.getRoot();
      }
    } else {
      folder = this.app.vault.getRoot();
    }

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
