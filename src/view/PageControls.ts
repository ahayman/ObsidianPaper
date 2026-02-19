import type { LayoutDirection } from "../types";

export interface PageControlsCallbacks {
  onAddPage: () => void;
  onScrollToPage: (pageIndex: number) => void;
  onLayoutDirectionChange: (direction: LayoutDirection) => void;
}

/**
 * Minimal page navigation controls (DOM overlay).
 * Shows page indicator, add page button, and layout direction toggle.
 */
export class PageControls {
  private container: HTMLElement;
  private el: HTMLElement;
  private callbacks: PageControlsCallbacks;
  private pageIndicatorEl: HTMLElement;
  private layoutToggleEl: HTMLElement;
  private currentPage = 0;
  private totalPages = 1;
  private layoutDirection: LayoutDirection = "vertical";

  constructor(
    container: HTMLElement,
    callbacks: PageControlsCallbacks,
    initialState?: { totalPages?: number; layoutDirection?: LayoutDirection }
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.totalPages = initialState?.totalPages ?? 1;
    this.layoutDirection = initialState?.layoutDirection ?? "vertical";

    this.el = container.createEl("div", { cls: "paper-page-controls" });

    // Page indicator (clickable to cycle through pages)
    this.pageIndicatorEl = this.el.createEl("button", {
      cls: "paper-page-indicator",
      text: this.getIndicatorText(),
    });
    this.pageIndicatorEl.addEventListener("click", () => {
      const nextPage = (this.currentPage + 1) % this.totalPages;
      this.callbacks.onScrollToPage(nextPage);
      this.setCurrentPage(nextPage);
    });

    // Add page button
    const addBtn = this.el.createEl("button", {
      cls: "paper-page-add-btn",
      text: "+",
      attr: { title: "Add page" },
    });
    addBtn.addEventListener("click", () => {
      this.callbacks.onAddPage();
    });

    // Layout direction toggle
    this.layoutToggleEl = this.el.createEl("button", {
      cls: "paper-page-layout-toggle",
      text: this.getLayoutIcon(),
      attr: { title: "Toggle layout direction" },
    });
    this.layoutToggleEl.addEventListener("click", () => {
      const newDir: LayoutDirection = this.layoutDirection === "vertical" ? "horizontal" : "vertical";
      this.layoutDirection = newDir;
      this.layoutToggleEl.textContent = this.getLayoutIcon();
      this.callbacks.onLayoutDirectionChange(newDir);
    });
  }

  setCurrentPage(pageIndex: number): void {
    this.currentPage = pageIndex;
    this.pageIndicatorEl.textContent = this.getIndicatorText();
  }

  setTotalPages(total: number): void {
    this.totalPages = total;
    this.pageIndicatorEl.textContent = this.getIndicatorText();
  }

  setLayoutDirection(direction: LayoutDirection): void {
    this.layoutDirection = direction;
    this.layoutToggleEl.textContent = this.getLayoutIcon();
  }

  destroy(): void {
    this.el.remove();
  }

  private getIndicatorText(): string {
    return `Page ${this.currentPage + 1} of ${this.totalPages}`;
  }

  private getLayoutIcon(): string {
    return this.layoutDirection === "vertical" ? "\u2195" : "\u2194";
  }
}
