import { Modal, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";

export interface NewPaperResult {
  name: string;
  folder: TFolder;
}

/**
 * Modal that prompts the user for a document name and folder
 * before creating a new Paper file.
 */
export class NewPaperModal extends Modal {
  private nameInput!: HTMLInputElement;
  private folderInput!: HTMLInputElement;
  private suggestionsEl!: HTMLElement;
  private allFolders: TFolder[] = [];
  private defaultFolder: TFolder;
  private defaultName: string;
  private onConfirm: (result: NewPaperResult) => void;
  private resolved = false;

  constructor(
    app: App,
    defaultName: string,
    defaultFolder: TFolder,
    onConfirm: (result: NewPaperResult) => void,
  ) {
    super(app);
    this.defaultName = defaultName;
    this.defaultFolder = defaultFolder;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    this.modalEl.addClass("paper-new-document-modal");
    this.contentEl.empty();

    // Collect all folders in the vault
    this.allFolders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .sort((a, b) => a.path.localeCompare(b.path));

    // Title
    this.contentEl.createEl("h2", { text: "New Paper Document" });

    // Name field
    const nameLabel = this.contentEl.createDiv({ cls: "paper-modal-field" });
    nameLabel.createEl("label", { text: "Name" });
    this.nameInput = nameLabel.createEl("input", {
      type: "text",
      cls: "paper-modal-input",
    });
    this.nameInput.value = this.defaultName;
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });

    // Folder field
    const folderLabel = this.contentEl.createDiv({ cls: "paper-modal-field" });
    folderLabel.createEl("label", { text: "Folder" });

    const folderWrapper = folderLabel.createDiv({ cls: "paper-modal-folder-wrapper" });
    this.folderInput = folderWrapper.createEl("input", {
      type: "text",
      cls: "paper-modal-input",
    });
    this.folderInput.value = this.getFolderDisplay(this.defaultFolder);
    this.folderInput.addEventListener("input", () => this.updateSuggestions());
    this.folderInput.addEventListener("focus", () => this.updateSuggestions());
    this.folderInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });

    this.suggestionsEl = folderWrapper.createDiv({ cls: "paper-modal-suggestions" });
    this.suggestionsEl.style.display = "none";

    // Close suggestions when clicking outside
    this.modalEl.addEventListener("click", (e) => {
      if (!folderWrapper.contains(e.target as Node)) {
        this.suggestionsEl.style.display = "none";
      }
    });

    // Buttons
    const buttonRow = this.contentEl.createDiv({ cls: "paper-modal-buttons" });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const createBtn = buttonRow.createEl("button", {
      text: "Create",
      cls: "mod-cta",
    });
    createBtn.addEventListener("click", () => this.submit());

    // Focus and select the name input
    setTimeout(() => {
      this.nameInput.focus();
      this.nameInput.select();
    }, 10);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private getFolderDisplay(folder: TFolder): string {
    // Root folder shows as "/"
    return folder.isRoot() ? "/" : folder.path;
  }

  private resolveFolder(path: string): TFolder | null {
    if (path === "/" || path === "") {
      return this.app.vault.getRoot();
    }
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    return file instanceof TFolder ? file : null;
  }

  private updateSuggestions(): void {
    const query = this.folderInput.value.toLowerCase();
    this.suggestionsEl.empty();

    const matches = this.allFolders
      .filter((f) => {
        const display = this.getFolderDisplay(f).toLowerCase();
        return display.includes(query);
      })
      .slice(0, 10);

    if (matches.length === 0) {
      this.suggestionsEl.style.display = "none";
      return;
    }

    for (const folder of matches) {
      const display = this.getFolderDisplay(folder);
      const item = this.suggestionsEl.createDiv({
        cls: "paper-modal-suggestion-item",
        text: display,
      });
      item.addEventListener("mousedown", (e) => {
        // Prevent blur before we can set the value
        e.preventDefault();
        this.folderInput.value = display;
        this.suggestionsEl.style.display = "none";
      });
    }

    this.suggestionsEl.style.display = "";
  }

  private submit(): void {
    if (this.resolved) return;

    const name = this.nameInput.value.trim();
    if (!name) {
      this.nameInput.focus();
      return;
    }

    const folder = this.resolveFolder(this.folderInput.value.trim());
    if (!folder) {
      // If the folder doesn't exist, flash the input
      this.folderInput.addClass("paper-modal-input-error");
      setTimeout(() => this.folderInput.removeClass("paper-modal-input-error"), 1000);
      this.folderInput.focus();
      return;
    }

    this.resolved = true;
    this.onConfirm({ name, folder });
    this.close();
  }
}
