import type { App, TFile } from "obsidian";
import { renderEmbed, parseEmbedDimensions } from "./EmbedRenderer";
import { PAPER_EXTENSION } from "../view/PaperView";
import type { PaperSettings } from "../settings/PaperSettings";
import type { EmbedEntry } from "./EmbedPostProcessor";

/**
 * Creates a CM6 EditorExtension that renders `.paper` embeds
 * as inline canvas widgets in live preview mode.
 *
 * Note: This returns a ViewPlugin factory function. The actual CM6 classes
 * (ViewPlugin, WidgetType, etc.) are imported from @codemirror/view which
 * is provided by Obsidian at runtime. Since @codemirror is declared external
 * in our build config, we import it directly.
 */
export function createEmbedExtension(
  app: App,
  isDarkMode: () => boolean,
  getSettings: () => PaperSettings,
  embedRegistry: EmbedEntry[],
  openModal: (file: TFile) => void,
) {
  return {
    app,
    isDarkMode,
    getSettings,
    embedRegistry,
    openModal,
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
  maxWidth: number,
  maxHeight?: number,
  embedRegistry?: EmbedEntry[],
  openModal?: (file: TFile) => void,
): void {
  container.classList.add("paper-embed-container");

  const file = app.vault.getAbstractFileByPath(filePath) as TFile | null;
  if (!file) {
    container.textContent = `Paper file not found: ${filePath}`;
    return;
  }

  const renderInto = (target: HTMLElement) => {
    while (target.firstChild) target.firstChild.remove();

    const canvas = document.createElement("canvas");
    canvas.classList.add("paper-embed-canvas");
    target.appendChild(canvas);

    if (openModal) {
      const expandBtn = document.createElement("button");
      expandBtn.classList.add("paper-embed-expand-btn");
      expandBtn.setAttribute("aria-label", "Open fullscreen");
      expandBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        openModal(file);
      });
      target.appendChild(expandBtn);
    }

    void app.vault.read(file).then((data: string) => {
      renderEmbed(canvas, data, isDarkMode, maxWidth, maxHeight);
    });
  };

  renderInto(container);

  if (maxHeight) {
    container.dataset.maxHeight = String(maxHeight);
  }

  container.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".paper-embed-expand-btn")) return;
    const leaf = app.workspace.getLeaf(false);
    void leaf.openFile(file);
  });

  if (embedRegistry) {
    embedRegistry.push({
      filePath: file.path,
      container,
      reRender: () => renderInto(container),
    });
  }
}

/**
 * Check if a link target is a paper file.
 */
export function isPaperEmbed(href: string): boolean {
  return href.endsWith(`.${PAPER_EXTENSION}`);
}
