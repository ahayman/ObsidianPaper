import type { App, TFile } from "obsidian";
import { TFile as TFileClass } from "obsidian";
import type { PaperSettings } from "../settings/PaperSettings";
import { deserializePaperMd } from "../document/PaperMdSerializer";
import {
  firstPageHash,
  renderFirstPageThumbnail,
  thumbnailPathFor,
  wikilinkForThumbnail,
} from "./ThumbnailGenerator";

const DEBOUNCE_MS = 2500;

/**
 * Manages thumbnail regeneration for .paper.md files. A vault-modify event
 * schedules a debounced regen; when it fires, we parse the file, diff the
 * first-page hash against what's stored in frontmatter, and only render +
 * write if the visual content actually changed. Keeps API cost and vault
 * churn low.
 */
export class ThumbnailManager {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => PaperSettings,
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
    const hash = firstPageHash(parsed.document);
    if (hash === "blank" || hash === "empty") return false;

    const storedHash = parsed.frontmatter?.["paper-thumbnail-hash"];
    if (!force && storedHash === hash) return false;

    const thumbPath = thumbnailPathFor(file.path, settings.thumbnailFolder);
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
      false,
    );
    if (!rendered) return false;

    const buf = await rendered.blob.arrayBuffer();
    const existingFile = this.app.vault.getAbstractFileByPath(thumbPath);
    if (existingFile instanceof TFileClass) {
      await this.app.vault.modifyBinary(existingFile, buf);
    } else {
      await this.app.vault.createBinary(thumbPath, buf);
    }

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[settings.thumbnailPropertyName] = wikilinkForThumbnail(thumbPath);
      fm["paper-thumbnail-hash"] = hash;
    });

    return true;
  }
}
