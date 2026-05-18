import type { App, TFile } from "obsidian";
import { TFile as TFileClass } from "obsidian";
import type { PaperSettings } from "../settings/PaperSettings";
import { deserializePaperMd } from "../document/PaperMdSerializer";
import { pageFingerprint } from "../ocr/PageFingerprint";
import {
  renderFirstPageThumbnail,
  shortHash,
  thumbnailFrontmatterValue,
  thumbnailPathFor,
} from "./ThumbnailGenerator";

const DEBOUNCE_MS = 2500;

/**
 * Manages thumbnail regeneration for .paper.md files. Page-1 stroke-set
 * fingerprint (folded with the active theme) lives in the file's frontmatter
 * as `paper-thumbnail-page-1-fp`; on each call we compare the current
 * fingerprint to the stored one and regenerate only if they differ.
 */
export class ThumbnailManager {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => PaperSettings,
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

  /**
   * True if the page-1 fingerprint differs from what's stored in the file's
   * frontmatter — i.e., regenerating now would actually change the thumbnail.
   * Returns false for blank-page docs (we never write thumbnails for those).
   */
  async isDirty(file: TFile): Promise<boolean> {
    const settings = this.getSettings();
    if (!settings.thumbnailsEnabled) return false;
    let raw: string;
    try {
      raw = await this.app.vault.read(file);
    } catch {
      return false;
    }
    const parsed = deserializePaperMd(raw);
    const currentFp = this.computeFingerprint(parsed.document, this.isDarkMode());
    if (currentFp === "") return false; // no strokes on page 1
    const stored = parsed.frontmatter["paper-thumbnail-page-1-fp"];
    return stored !== currentFp;
  }

  private computeFingerprint(doc: import("../types").PaperDocument, dark: boolean): string {
    const pageFp = pageFingerprint(doc, 0);
    if (pageFp === "") return "";
    return shortHash(`${dark ? "dark" : "light"}:${pageFp}`);
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
    const dark = this.isDarkMode();
    const fp = this.computeFingerprint(parsed.document, dark);
    if (fp === "") return false; // blank page → no thumbnail

    const thumbPath = thumbnailPathFor(file.path, settings.thumbnailFolder);
    const existingThumbnailFile = this.app.vault.getAbstractFileByPath(thumbPath);
    const storedFp = parsed.frontmatter["paper-thumbnail-page-1-fp"];

    // Skip when the stored fp matches AND the PNG still exists. Either the
    // user manually deleted the PNG, or a content change moved the fp —
    // both call for a regen.
    if (!force && storedFp === fp && existingThumbnailFile instanceof TFileClass) {
      // Bump last-gen so the (timestamp-based) dirty indicator clears.
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm["paper-thumbnail-last-gen"] = new Date().toISOString();
      });
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

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[settings.thumbnailPropertyName] = thumbnailFrontmatterValue(thumbPath);
      fm["paper-thumbnail-page-1-fp"] = fp;
      fm["paper-thumbnail-last-gen"] = new Date().toISOString();
      // Strip any leftover legacy fields from earlier plugin versions.
      if ("paper-thumbnail-hash" in fm) delete fm["paper-thumbnail-hash"];
    });

    return true;
  }
}
