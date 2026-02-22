import type { App, TFile } from "obsidian";
import { renderEmbed, parseEmbedDimensions } from "./EmbedRenderer";
import { PAPER_EXTENSION } from "../view/PaperView";
import type { PaperSettings } from "../settings/PaperSettings";

export interface EmbedEntry {
  filePath: string;
  container: HTMLElement;
  reRender: () => void;
}

/**
 * Create a Markdown post processor that renders `.paper` file embeds
 * as static canvas previews in reading mode.
 *
 * Handles `![[name.paper]]`, `![[name.paper|width]]`, and `![[name.paper|widthxheight]]` syntax.
 */
export function createEmbedPostProcessor(
  app: App,
  isDarkMode: () => boolean,
  getSettings: () => PaperSettings,
  embedRegistry: EmbedEntry[],
  openModal: (file: TFile) => void,
) {
  return (el: HTMLElement): void => {
    // Find all internal embed spans that reference .paper files
    const embeds = el.querySelectorAll(
      `.internal-embed[src$=".${PAPER_EXTENSION}"]`
    );

    for (const embedEl of Array.from(embeds)) {
      const src = embedEl.getAttribute("src");
      if (!src) continue;

      processEmbed(app, embedEl as HTMLElement, src, isDarkMode, getSettings, embedRegistry, openModal);
    }
  };
}

function processEmbed(
  app: App,
  embedEl: HTMLElement,
  src: string,
  isDarkMode: () => boolean,
  getSettings: () => PaperSettings,
  embedRegistry: EmbedEntry[],
  openModal: (file: TFile) => void,
): void {
  // Parse the src — may include display dimensions: "file.paper|600" or "file.paper|600x300"
  const parts = src.split("|");
  const filePath = parts[0];
  const dims = parseEmbedDimensions(parts[1] ?? null);

  // Resolve the file
  const file = app.vault.getAbstractFileByPath(filePath) as TFile | null;
  if (!file) return;

  const settings = getSettings();
  const maxWidth = dims.width ?? (settings.embedMaxWidth || (embedEl.parentElement?.clientWidth ?? 600));
  const maxHeight = dims.height ?? (settings.embedMaxHeight || undefined);

  const renderInto = (container: HTMLElement) => {
    // Clear existing content but preserve the container
    while (container.firstChild) container.firstChild.remove();

    const canvas = document.createElement("canvas");
    canvas.classList.add("paper-embed-canvas");
    container.appendChild(canvas);

    // Expand button
    const expandBtn = document.createElement("button");
    expandBtn.classList.add("paper-embed-expand-btn");
    expandBtn.setAttribute("aria-label", "Open fullscreen");
    expandBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      openModal(file);
    });
    container.appendChild(expandBtn);

    void app.vault.read(file).then((data: string) => {
      renderEmbed(canvas, data, isDarkMode(), maxWidth, maxHeight);
    });
  };

  const container = document.createElement("div");
  container.classList.add("paper-embed-container");
  if (maxHeight) {
    container.dataset.maxHeight = String(maxHeight);
  }

  renderInto(container);

  // Click canvas to open in leaf
  container.addEventListener("click", (e) => {
    // Don't open in leaf if the expand button was clicked
    if ((e.target as HTMLElement).closest(".paper-embed-expand-btn")) return;
    const leaf = app.workspace.getLeaf(false);
    void leaf.openFile(file);
  });

  // Register for auto-refresh
  embedRegistry.push({
    filePath: file.path,
    container,
    reRender: () => renderInto(container),
  });

  // Replace embed content
  embedEl.empty();
  embedEl.appendChild(container);
}
