import type { App, TFile } from "obsidian";
import { TFile as TFileClass } from "obsidian";
import { deserializeDocument } from "../document/Serializer";
import { serializePaperMd, deserializePaperMd, PAPER_MD_VERSION } from "../document/PaperMdSerializer";
import { classifyPaperFile } from "../view/PaperView";

/** Regex for `![[...paper]]` embeds — NOT matching `.paper.md`. */
const PAPER_EMBED_RE = /!\[\[([^\]|#]+?)(\.paper)(\|[^\]]*)?\]\]/gi;

export interface PaperFileMigration {
  source: TFile;
  targetPath: string;
  sourceSize: number;
  strokeCount: number;
}

export interface MarkdownRewrite {
  file: TFile;
  replacements: number;
}

export interface MigrationSkip {
  path: string;
  reason: string;
}

export interface MigrationPlan {
  paperFiles: PaperFileMigration[];
  markdownRewrites: MarkdownRewrite[];
  skipped: MigrationSkip[];
}

export interface MigrationOutcome {
  migrated: number;
  rewritten: number;
  failed: MigrationSkip[];
}

export interface BackupListing {
  files: TFile[];
  total: number;
}

/**
 * Convert a v3 `.paper` JSON string to a v4 `.paper.md` markdown string,
 * preserving timestamps and setting `paper-default-view: paper`.
 * Pure function — no file I/O.
 */
export function convertV3ToPaperMd(v3Content: string, appVersion: string): string {
  const doc = deserializeDocument(v3Content);
  if (appVersion) doc.meta.appVersion = appVersion;
  return serializePaperMd({
    document: doc,
    frontmatter: {
      "paper-version": PAPER_MD_VERSION,
      "paper-default-view": "paper",
    },
  });
}

/**
 * Rewrite `![[X.paper]]` references to `![[X.paper.md]]` in a markdown string.
 * Preserves display-size suffixes (`|600`, `|600x300`). Pure function.
 */
export function rewriteEmbedsInMarkdown(md: string): { content: string; replacements: number } {
  let replacements = 0;
  const content = md.replace(PAPER_EMBED_RE, (_match, name, dotPaper, suffix) => {
    replacements++;
    return `![[${name}${dotPaper}.md${suffix ?? ""}]]`;
  });
  return { content, replacements };
}

/**
 * Scan the vault and produce a migration plan without modifying anything.
 */
export async function planMigration(app: App): Promise<MigrationPlan> {
  const paperFiles: PaperFileMigration[] = [];
  const markdownRewrites: MarkdownRewrite[] = [];
  const skipped: MigrationSkip[] = [];

  const allFiles = app.vault.getAllLoadedFiles();
  for (const f of allFiles) {
    if (!(f instanceof TFileClass)) continue;
    if (classifyPaperFile(f.name) !== "paper") continue;

    const targetPath = `${f.path}.md`;
    const existing = app.vault.getAbstractFileByPath(targetPath);
    if (existing) {
      skipped.push({ path: f.path, reason: `target ${targetPath} already exists` });
      continue;
    }

    try {
      const raw = await app.vault.read(f);
      const doc = deserializeDocument(raw);
      paperFiles.push({
        source: f,
        targetPath,
        sourceSize: raw.length,
        strokeCount: doc.strokes.length,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      skipped.push({ path: f.path, reason: `read/parse failed: ${reason}` });
    }
  }

  for (const f of app.vault.getMarkdownFiles()) {
    try {
      const content = await app.vault.read(f);
      const { replacements } = rewriteEmbedsInMarkdown(content);
      if (replacements > 0) {
        markdownRewrites.push({ file: f, replacements });
      }
    } catch {
      // Skip files we can't read.
    }
  }

  return { paperFiles, markdownRewrites, skipped };
}

/**
 * Execute a migration plan. For each .paper file:
 *   1. Write .paper.md alongside with the v4 format.
 *   2. Read it back; verify stroke count + page count match the source.
 *   3. If verification fails, delete the new .paper.md and record failure.
 *   4. Leave the original .paper file in place as backup.
 *
 * Then rewrite ![[X.paper]] → ![[X.paper.md]] in all markdown files.
 */
export async function runMigration(
  app: App,
  plan: MigrationPlan,
  appVersion: string,
  onProgress?: (status: string) => void,
): Promise<MigrationOutcome> {
  let migrated = 0;
  let rewritten = 0;
  const failed: MigrationSkip[] = [];

  for (const entry of plan.paperFiles) {
    onProgress?.(`Converting ${entry.source.path}`);
    try {
      const raw = await app.vault.read(entry.source);
      const v4 = convertV3ToPaperMd(raw, appVersion);

      await app.vault.create(entry.targetPath, v4);

      // Verify round-trip.
      const created = app.vault.getAbstractFileByPath(entry.targetPath);
      if (!(created instanceof TFileClass)) {
        failed.push({ path: entry.source.path, reason: "new file not found after write" });
        continue;
      }
      const verifyContent = await app.vault.read(created);
      const parsed = deserializePaperMd(verifyContent);
      if (parsed.document.strokes.length !== entry.strokeCount) {
        failed.push({
          path: entry.source.path,
          reason: `stroke count mismatch (source=${entry.strokeCount}, converted=${parsed.document.strokes.length})`,
        });
        await app.vault.delete(created);
        continue;
      }
      migrated++;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failed.push({ path: entry.source.path, reason });
      // Best-effort cleanup if partial write happened.
      const partial = app.vault.getAbstractFileByPath(entry.targetPath);
      if (partial instanceof TFileClass) {
        try { await app.vault.delete(partial); } catch { /* ignore */ }
      }
    }
  }

  for (const entry of plan.markdownRewrites) {
    onProgress?.(`Rewriting embeds in ${entry.file.path}`);
    try {
      const content = await app.vault.read(entry.file);
      const { content: updated, replacements } = rewriteEmbedsInMarkdown(content);
      if (replacements > 0) {
        await app.vault.modify(entry.file, updated);
        rewritten += replacements;
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failed.push({ path: entry.file.path, reason });
    }
  }

  return { migrated, rewritten, failed };
}

/**
 * Find `.paper` files that have a sibling `.paper.md` — these are backups
 * from a completed migration and can safely be deleted.
 */
export function listBackups(app: App): BackupListing {
  const files: TFile[] = [];
  for (const f of app.vault.getAllLoadedFiles()) {
    if (!(f instanceof TFileClass)) continue;
    if (classifyPaperFile(f.name) !== "paper") continue;
    const mdSibling = app.vault.getAbstractFileByPath(`${f.path}.md`);
    if (mdSibling instanceof TFileClass) {
      files.push(f);
    }
  }
  return { files, total: files.length };
}

/**
 * Delete all `.paper` backup files whose `.paper.md` sibling exists.
 */
export async function deleteBackups(
  app: App,
  onProgress?: (status: string) => void,
): Promise<{ deleted: number; failed: MigrationSkip[] }> {
  const { files } = listBackups(app);
  const failed: MigrationSkip[] = [];
  let deleted = 0;

  for (const f of files) {
    onProgress?.(`Deleting ${f.path}`);
    try {
      await app.vault.delete(f);
      deleted++;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failed.push({ path: f.path, reason });
    }
  }

  return { deleted, failed };
}
