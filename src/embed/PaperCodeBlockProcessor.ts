import type { App, MarkdownPostProcessorContext, TFile } from "obsidian";
import { renderEmbed } from "./EmbedRenderer";
import { decompressString } from "../document/Compression";
import type { PaperSettings } from "../settings/PaperSettings";
import type { EmbedEntry } from "./EmbedPostProcessor";

/**
 * Extract scene JSON from a `paper` code block. Current files contain raw
 * JSON; legacy files embedded deflate+base64, so accept both.
 */
function extractSceneJson(source: string): string | null {
  const trimmed = source.trim();
  if (trimmed.startsWith("{")) return trimmed;
  try {
    return decompressString(trimmed);
  } catch {
    return null;
  }
}

/**
 * Create a handler for fenced `paper` code blocks.
 *
 *     ```paper
 *     <deflate+base64 scene JSON>
 *     ```
 *
 * Renders a static canvas preview inside the container. When the host file
 * is a `.paper.md`, clicking the preview opens it in the full Paper editor.
 */
export function createPaperCodeBlockProcessor(
  app: App,
  isDarkMode: () => boolean,
  getSettings: () => PaperSettings,
  embedRegistry: EmbedEntry[],
  openFile: (file: TFile) => void,
) {
  return (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    const sourcePath = ctx.sourcePath;
    const hostFile = sourcePath
      ? (app.vault.getAbstractFileByPath(sourcePath) as TFile | null)
      : null;

    const sceneJson = extractSceneJson(source);
    if (!sceneJson) {
      const err = document.createElement("div");
      err.classList.add("paper-embed-error");
      err.textContent = "Unable to decode paper code block.";
      el.appendChild(err);
      return;
    }

    const settings = getSettings();
    // `??` falls through on null/undefined only; the element is in the DOM
    // but its parent may have zero width at post-process time, so use `||`
    // to also fall through on 0.
    const containerWidth = el.parentElement?.clientWidth || 600;
    const maxWidth = settings.embedMaxWidth || containerWidth;
    const maxHeight = settings.embedMaxHeight || undefined;

    const container = document.createElement("div");
    container.classList.add("paper-embed-container");
    container.classList.add("paper-codeblock-preview");
    if (maxHeight) container.dataset.maxHeight = String(maxHeight);
    el.appendChild(container);

    const renderInto = (target: HTMLElement): void => {
      while (target.firstChild) target.firstChild.remove();

      const canvas = document.createElement("canvas");
      canvas.classList.add("paper-embed-canvas");
      target.appendChild(canvas);

      if (hostFile) {
        const expandBtn = document.createElement("button");
        expandBtn.classList.add("paper-embed-expand-btn");
        expandBtn.setAttribute("aria-label", "Open in Paper editor");
        expandBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
        expandBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          openFile(hostFile);
        });
        target.appendChild(expandBtn);
      }

      renderEmbed(canvas, sceneJson, isDarkMode(), maxWidth, maxHeight);
    };

    renderInto(container);

    if (hostFile) {
      container.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".paper-embed-expand-btn")) return;
        openFile(hostFile);
      });
      embedRegistry.push({
        filePath: hostFile.path,
        container,
        reRender: () => renderInto(container),
      });
    }
  };
}
