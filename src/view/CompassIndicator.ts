/**
 * A small compass indicator shown when the viewport is rotated.
 * The needle always points to "true north" (original up direction).
 * Tap to reset rotation back to 0°.
 */
export class CompassIndicator {
  private container: HTMLElement;
  private needle: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement, private onTap: () => void) {
    this.container = parent.createEl("div", { cls: "paper-compass" });
    this.container.style.display = "none";

    // Outer ring
    const ring = this.container.createEl("div", { cls: "paper-compass__ring" });

    // Needle (north indicator)
    this.needle = ring.createEl("div", { cls: "paper-compass__needle" });

    // Center dot
    ring.createEl("div", { cls: "paper-compass__center" });

    this.container.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onTap();
    });
  }

  update(rotation: number): void {
    if (rotation === 0 && this.visible) {
      this.hide();
      return;
    }
    if (rotation !== 0 && !this.visible) {
      this.show();
    }
    // Needle always points to original "up", so rotate by -rotation
    this.needle.style.transform = `rotate(${-rotation}rad)`;
  }

  private show(): void {
    this.visible = true;
    this.container.style.display = "";
    this.container.classList.add("paper-compass--visible");
  }

  private hide(): void {
    this.visible = false;
    this.container.classList.remove("paper-compass--visible");
    // Delay hiding to allow fade-out animation
    setTimeout(() => {
      if (!this.visible) {
        this.container.style.display = "none";
      }
    }, 200);
  }

  destroy(): void {
    this.container.remove();
  }
}
