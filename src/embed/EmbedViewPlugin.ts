import type { App, TFile } from "obsidian";
import { renderEmbed } from "./EmbedRenderer";
import { PAPER_EXTENSION } from "../view/PaperView";

/**
 * Creates a CM6 EditorExtension that renders `.paper` embeds
 * as inline canvas widgets in live preview mode.
 *
 * Note: This returns a ViewPlugin factory function. The actual CM6 classes
 * (ViewPlugin, WidgetType, etc.) are imported from @codemirror/view which
 * is provided by Obsidian at runtime. Since @codemirror is declared external
 * in our build config, we import it directly.
 */
export function createEmbedExtension(app: App, isDarkMode: () => boolean) {
  // Dynamically import @codemirror/view since it's external (provided by Obsidian)
  // We use a lazy approach: the extension is registered in main.ts
  // using Obsidian's registerEditorExtension() which handles CM6 integration.
  // For now, we provide the widget rendering logic.
  return {
    app,
    isDarkMode,
    renderWidget: renderPaperWidget,
  };
}

/**
 * Render a paper embed widget into a container element.
 * Called by the CM6 widget decoration system.
 */
export function renderPaperWidget(
  container: HTMLElement,
  app: App,
  filePath: string,
  isDarkMode: boolean,
  maxWidth: number
): void {
  container.classList.add("paper-embed-container");

  const file = app.vault.getAbstractFileByPath(filePath) as TFile | null;
  if (!file) {
    container.textContent = `Paper file not found: ${filePath}`;
    return;
  }

  void app.vault.read(file).then((data: string) => {
    const canvas = document.createElement("canvas");
    canvas.classList.add("paper-embed-canvas");
    container.appendChild(canvas);

    renderEmbed(canvas, data, isDarkMode, maxWidth);

    container.addEventListener("click", () => {
      const leaf = app.workspace.getLeaf(false);
      void leaf.openFile(file);
    });
  });
}

/**
 * Check if a link target is a paper file.
 */
export function isPaperEmbed(href: string): boolean {
  return href.endsWith(`.${PAPER_EXTENSION}`);
}
