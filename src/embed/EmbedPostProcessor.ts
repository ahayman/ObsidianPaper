import type { App, TFile } from "obsidian";
import { renderEmbed } from "./EmbedRenderer";
import { PAPER_EXTENSION } from "../view/PaperView";

/**
 * Create a Markdown post processor that renders `.paper` file embeds
 * as static canvas previews in reading mode.
 *
 * Handles `![[name.paper]]` and `![[name.paper|width]]` syntax.
 */
export function createEmbedPostProcessor(app: App, isDarkMode: () => boolean) {
  return (el: HTMLElement): void => {
    // Find all internal embed spans that reference .paper files
    const embeds = el.querySelectorAll(
      `.internal-embed[src$=".${PAPER_EXTENSION}"]`
    );

    for (const embedEl of Array.from(embeds)) {
      const src = embedEl.getAttribute("src");
      if (!src) continue;

      processEmbed(app, embedEl as HTMLElement, src, isDarkMode);
    }
  };
}

function processEmbed(
  app: App,
  embedEl: HTMLElement,
  src: string,
  isDarkMode: () => boolean
): void {
  // Parse the src — may include display dimensions: "file.paper|400"
  const parts = src.split("|");
  const filePath = parts[0];
  const explicitWidth = parts[1] ? parseInt(parts[1]) : null;

  // Resolve the file
  const file = app.vault.getAbstractFileByPath(filePath) as TFile | null;
  if (!file) return;

  // Read file and render
  void app.vault.read(file).then((data: string) => {
    const container = document.createElement("div");
    container.classList.add("paper-embed-container");

    const canvas = document.createElement("canvas");
    canvas.classList.add("paper-embed-canvas");
    container.appendChild(canvas);

    const maxWidth = explicitWidth ?? (embedEl.parentElement?.clientWidth ?? 600);
    renderEmbed(canvas, data, isDarkMode(), maxWidth);

    // Click to open the paper file
    container.addEventListener("click", () => {
      const leaf = app.workspace.getLeaf(false);
      void leaf.openFile(file);
    });

    // Replace embed content
    embedEl.empty();
    embedEl.appendChild(container);
  });
}
