import type { PaperDocument } from "../types";
import type { OcrResult } from "../document/PaperMdSerializer";
import { countDirtyPages } from "./IncrementalOcrRunner";

export type OcrStatus =
  | { kind: "off" }
  | { kind: "hidden" }
  | { kind: "up-to-date" }
  | { kind: "dirty"; pages: number }
  | { kind: "running"; message: string }
  | { kind: "error"; message: string };

/**
 * Thin wrapper around the Obsidian status-bar HTMLElement. Safe to use
 * on mobile (Obsidian hides the status bar there — it's a no-op).
 */
export class OcrStatusBar {
  private status: OcrStatus = { kind: "hidden" };

  constructor(private readonly el: HTMLElement) {
    el.classList.add("paper-ocr-status");
    this.render();
  }

  setStatus(status: OcrStatus): void {
    this.status = status;
    this.render();
  }

  /** Compute and apply the steady-state status for the active .paper.md view. */
  setFromDocument(doc: PaperDocument | null, previous: OcrResult | null, backendEnabled: boolean): void {
    if (!doc) {
      this.setStatus({ kind: "hidden" });
      return;
    }
    if (!backendEnabled) {
      this.setStatus({ kind: "off" });
      return;
    }
    const dirty = countDirtyPages(doc, previous);
    this.setStatus(dirty === 0 ? { kind: "up-to-date" } : { kind: "dirty", pages: dirty });
  }

  private render(): void {
    const { el, status } = this;
    el.textContent = "";
    if (status.kind === "hidden") {
      el.style.display = "none";
      return;
    }
    el.style.display = "";

    switch (status.kind) {
      case "off":
        el.textContent = "OCR: off";
        el.setAttribute("aria-label", "OCR is disabled. Configure a backend in plugin settings.");
        el.classList.remove("is-dirty", "is-running", "is-error");
        break;
      case "up-to-date":
        el.textContent = "OCR ✓";
        el.setAttribute("aria-label", "OCR is up to date for this file.");
        el.classList.remove("is-dirty", "is-running", "is-error");
        break;
      case "dirty":
        el.textContent = `OCR: ${status.pages} page${status.pages === 1 ? "" : "s"} dirty`;
        el.setAttribute("aria-label", "Run the 'Recognize handwriting' command to update.");
        el.classList.add("is-dirty");
        el.classList.remove("is-running", "is-error");
        break;
      case "running":
        el.textContent = `OCR: ${status.message}`;
        el.setAttribute("aria-label", status.message);
        el.classList.add("is-running");
        el.classList.remove("is-dirty", "is-error");
        break;
      case "error":
        el.textContent = "OCR: error";
        el.setAttribute("aria-label", status.message);
        el.classList.add("is-error");
        el.classList.remove("is-dirty", "is-running");
        break;
    }
  }
}
