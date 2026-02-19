/**
 * Generic toolbar button with 44x44 touch targets.
 */
export class ToolbarButton {
  readonly el: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    label: string,
    cls: string,
    onClick: () => void
  ) {
    this.el = parent.createEl("button", {
      cls: `paper-toolbar__btn ${cls}`,
      attr: { "aria-label": label },
    });
    this.el.textContent = label;
    this.el.addEventListener("click", onClick);
  }

  setActive(active: boolean): void {
    this.el.toggleClass("is-active", active);
  }

  setDisabled(disabled: boolean): void {
    this.el.disabled = disabled;
    this.el.toggleClass("is-disabled", disabled);
  }

  destroy(): void {
    this.el.remove();
  }
}
