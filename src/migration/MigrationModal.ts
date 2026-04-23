import { App, Modal, Notice } from "obsidian";
import type { MigrationPlan } from "./PaperMigrator";

export type MigrationChoice = "run" | "cancel";

/**
 * Shows a summary of a migration plan and asks the user to confirm.
 * Resolves with "run" if the user clicks the primary button, "cancel" otherwise.
 */
export class MigrationConfirmModal extends Modal {
  private plan: MigrationPlan;
  private resolver: (choice: MigrationChoice) => void;
  private resolved = false;

  constructor(app: App, plan: MigrationPlan, resolver: (choice: MigrationChoice) => void) {
    super(app);
    this.plan = plan;
    this.resolver = resolver;
  }

  onOpen(): void {
    const { contentEl, plan } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Migrate .paper files to .paper.md" });

    const intro = contentEl.createEl("p");
    intro.setText(
      "Converts each .paper file to an equivalent .paper.md wrapper so Obsidian can index it. " +
      "Originals are kept as backups; use the 'Delete .paper backups' command once you've verified the new files work.",
    );

    const stats = contentEl.createEl("ul");
    stats.createEl("li", { text: `${plan.paperFiles.length} .paper files to convert` });
    stats.createEl("li", { text: `${plan.markdownRewrites.length} markdown files with embeds to rewrite` });
    if (plan.skipped.length > 0) {
      stats.createEl("li", { text: `${plan.skipped.length} files skipped (see details below)` });
    }

    if (plan.paperFiles.length > 0) {
      const details = contentEl.createEl("details");
      details.createEl("summary", { text: "Files to convert" });
      const list = details.createEl("ul");
      for (const entry of plan.paperFiles.slice(0, 100)) {
        list.createEl("li", { text: `${entry.source.path} → ${entry.targetPath} (${entry.strokeCount} strokes)` });
      }
      if (plan.paperFiles.length > 100) {
        list.createEl("li", { text: `… and ${plan.paperFiles.length - 100} more` });
      }
    }

    if (plan.markdownRewrites.length > 0) {
      const details = contentEl.createEl("details");
      details.createEl("summary", { text: "Embeds to rewrite" });
      const list = details.createEl("ul");
      for (const entry of plan.markdownRewrites.slice(0, 100)) {
        list.createEl("li", { text: `${entry.file.path} (${entry.replacements} refs)` });
      }
    }

    if (plan.skipped.length > 0) {
      const details = contentEl.createEl("details");
      details.createEl("summary", { text: "Skipped" });
      const list = details.createEl("ul");
      for (const entry of plan.skipped) {
        list.createEl("li", { text: `${entry.path}: ${entry.reason}` });
      }
    }

    const buttons = contentEl.createEl("div", { cls: "paper-migration-buttons" });
    buttons.style.display = "flex";
    buttons.style.gap = "8px";
    buttons.style.marginTop = "16px";
    buttons.style.justifyContent = "flex-end";

    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.resolve("cancel");
      this.close();
    });

    const confirm = buttons.createEl("button", { text: "Run migration", cls: "mod-cta" });
    if (plan.paperFiles.length === 0) {
      confirm.setAttribute("disabled", "true");
    }
    confirm.addEventListener("click", () => {
      this.resolve("run");
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve("cancel");
  }

  private resolve(choice: MigrationChoice): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolver(choice);
  }
}

export interface CleanupSummary {
  count: number;
  paths: string[];
}

/**
 * Confirms backup cleanup — shows which .paper files will be deleted.
 */
export class BackupCleanupModal extends Modal {
  private summary: CleanupSummary;
  private resolver: (confirmed: boolean) => void;
  private resolved = false;

  constructor(app: App, summary: CleanupSummary, resolver: (confirmed: boolean) => void) {
    super(app);
    this.summary = summary;
    this.resolver = resolver;
  }

  onOpen(): void {
    const { contentEl, summary } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Delete .paper backups" });

    if (summary.count === 0) {
      contentEl.createEl("p", {
        text: "No .paper backups found (every .paper file is either unmigrated, or has no .paper.md sibling).",
      });
      const buttons = contentEl.createEl("div");
      buttons.style.textAlign = "right";
      buttons.style.marginTop = "16px";
      const ok = buttons.createEl("button", { text: "OK" });
      ok.addEventListener("click", () => {
        this.resolve(false);
        this.close();
      });
      return;
    }

    contentEl.createEl("p", {
      text: `The following ${summary.count} .paper files have migrated .paper.md siblings and can be safely deleted.`,
    });

    const warn = contentEl.createEl("p");
    warn.style.color = "var(--text-error, #d73a49)";
    warn.setText("This action cannot be undone. Make sure you have a backup if you're unsure.");

    if (summary.paths.length > 0) {
      const details = contentEl.createEl("details");
      details.createEl("summary", { text: "Files to delete" });
      const list = details.createEl("ul");
      for (const path of summary.paths.slice(0, 200)) {
        list.createEl("li", { text: path });
      }
      if (summary.paths.length > 200) {
        list.createEl("li", { text: `… and ${summary.paths.length - 200} more` });
      }
    }

    const buttons = contentEl.createEl("div");
    buttons.style.display = "flex";
    buttons.style.gap = "8px";
    buttons.style.marginTop = "16px";
    buttons.style.justifyContent = "flex-end";

    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.resolve(false);
      this.close();
    });

    const confirm = buttons.createEl("button", { text: `Delete ${summary.count} files`, cls: "mod-warning" });
    confirm.addEventListener("click", () => {
      this.resolve(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(false);
  }

  private resolve(confirmed: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolver(confirmed);
  }
}

export function showProgressNotice(message: string): Notice {
  return new Notice(message, 0);
}
