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
  private onActivate: (() => void) | null = null;

  constructor(private readonly el: HTMLElement) {
    el.classList.add("paper-ocr-status");
    el.addEventListener("click", () => {
      if (this.isActionable()) this.onActivate?.();
    });
    this.render();
  }

  /** Wire a click handler for when the user activates the status bar. */
  setOnActivate(fn: () => void): void {
    this.onActivate = fn;
    this.render();
  }

  /** True when the status represents a state where clicking should run OCR. */
  private isActionable(): boolean {
    return this.status.kind === "dirty" || this.status.kind === "up-to-date";
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
    el.classList.toggle("is-clickable", this.isActionable() && !!this.onActivate);

    switch (status.kind) {
      case "off":
        el.textContent = "OCR: off";
        el.setAttribute("aria-label", "OCR is disabled. Configure a backend in plugin settings.");
        el.classList.remove("is-dirty", "is-running", "is-error");
        break;
      case "up-to-date":
        el.textContent = "OCR ✓";
        el.setAttribute("aria-label", "OCR up to date. Click to re-run.");
        el.classList.remove("is-dirty", "is-running", "is-error");
        break;
      case "dirty":
        el.textContent = `OCR: ${status.pages} page${status.pages === 1 ? "" : "s"} dirty — click to run`;
        el.setAttribute("aria-label", "Click to run handwriting recognition.");
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
