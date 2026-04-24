import type { App, TFile } from "obsidian";
import { TFile as TFileClass } from "obsidian";
import type { PaperSettings } from "../settings/PaperSettings";
import { deserializePaperMd } from "../document/PaperMdSerializer";
import {
  firstPageHash,
  renderFirstPageThumbnail,
  shortHash,
  thumbnailFrontmatterValue,
  thumbnailPathFor,
} from "./ThumbnailGenerator";

const DEBOUNCE_MS = 2500;

/** Storage interface for thumbnail cache keys. Kept out of frontmatter so
 *  the on-disk file stays clean. Implementations typically persist into
 *  plugin data (via loadData/saveData). */
export interface ThumbnailHashStore {
  get(filePath: string): string | undefined;
  set(filePath: string, hash: string): Promise<void>;
  delete(filePath: string): Promise<void>;
}

/**
 * Manages thumbnail regeneration for .paper.md files. A vault-modify event
 * schedules a debounced regen; when it fires, we parse the file, diff the
 * first-page hash against the cached one, and only render + write if the
 * visual content actually changed. Keeps API cost and vault churn low.
 */
export class ThumbnailManager {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => PaperSettings,
    private readonly hashStore: ThumbnailHashStore,
    private readonly isDarkMode: () => boolean = () =>
      typeof document !== "undefined" &&
      document.body.classList.contains("theme-dark"),
  ) {}

  /** Debounced schedule — cancels any pending regen for the same file. */
  schedule(file: TFile): void {
    if (!this.getSettings().thumbnailsEnabled) return;
    const existing = this.pending.get(file.path);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(file.path);
      void this.regenerate(file, false);
    }, DEBOUNCE_MS);
    this.pending.set(file.path, timer);
  }

  /** Cancel any pending regen (e.g., before plugin unload). */
  cancelAll(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  /**
   * Force a regen right now (used by the manual command).
   * Returns true if a new thumbnail was written.
   */
  async regenerateNow(file: TFile): Promise<boolean> {
    return this.regenerate(file, true);
  }

  private async regenerate(file: TFile, force: boolean): Promise<boolean> {
    const settings = this.getSettings();
    if (!settings.thumbnailsEnabled && !force) return false;

    let raw: string;
    try {
      raw = await this.app.vault.read(file);
    } catch {
      return false;
    }
    const parsed = deserializePaperMd(raw);
    const pageHash = firstPageHash(parsed.document);
    if (pageHash === "blank" || pageHash === "empty") return false;

    // Fold the theme in so a light→dark swap regenerates, then compact
    // to 8 hex chars — it's a cache key, not document metadata.
    const dark = this.isDarkMode();
    const hash = shortHash(`${dark ? "dark" : "light"}:${pageHash}`);

    const thumbPath = thumbnailPathFor(file.path, settings.thumbnailFolder);
    const existingThumbnailFile = this.app.vault.getAbstractFileByPath(thumbPath);
    const storedHash = this.hashStore.get(file.path);

    // Skip only if we have a cached hash AND the PNG is still on disk. If
    // the user deleted it manually, regen even when the hash matches.
    if (!force && storedHash === hash && existingThumbnailFile instanceof TFileClass) {
      return false;
    }

    const folderPath = thumbPath.slice(0, thumbPath.lastIndexOf("/"));
    if (folderPath) {
      const existingFolder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!existingFolder) {
        try {
          await this.app.vault.createFolder(folderPath);
        } catch {
          // Folder may have been created concurrently — ignore.
        }
      }
    }

    const rendered = await renderFirstPageThumbnail(
      parsed.document,
      settings.thumbnailMaxWidth,
      dark,
    );
    if (!rendered) return false;

    const buf = await rendered.blob.arrayBuffer();
    if (existingThumbnailFile instanceof TFileClass) {
      await this.app.vault.modifyBinary(existingThumbnailFile, buf);
    } else {
      await this.app.vault.createBinary(thumbPath, buf);
    }

    // Strip the legacy per-file hash entry if it's still sitting in
    // frontmatter from an earlier plugin version.
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[settings.thumbnailPropertyName] = thumbnailFrontmatterValue(thumbPath);
      if ("paper-thumbnail-hash" in fm) delete fm["paper-thumbnail-hash"];
    });

    await this.hashStore.set(file.path, hash);
    return true;
  }
}
