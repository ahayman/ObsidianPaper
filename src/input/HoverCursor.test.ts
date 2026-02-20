import { HoverCursor } from "./HoverCursor";
import type { HoverCursorConfig } from "./HoverCursor";

// Augment container with Obsidian's DOM helpers
function createContainer(): HTMLElement {
  const container = document.createElement("div");
  augmentEl(container);
  return container;
}

function augmentEl(el: HTMLElement): void {
  (el as any).createEl = function (
    tag: string,
    opts?: { cls?: string }
  ) {
    const child = document.createElement(tag);
    augmentEl(child);
    if (opts?.cls) {
      for (const c of opts.cls.split(" ")) child.classList.add(c);
    }
    this.appendChild(child);
    return child;
  };
  (el as any).addClass = function (cls: string) {
    this.classList.add(cls);
  };
  (el as any).removeClass = function (cls: string) {
    this.classList.remove(cls);
  };
  (el as any).setCssProps = function (props: Record<string, string>) {
    for (const [k, v] of Object.entries(props)) {
      this.style.setProperty(k, v);
    }
  };
}

describe("HoverCursor", () => {
  let container: HTMLElement;
  let cursor: HoverCursor;

  const defaultConfig: HoverCursorConfig = {
    colorId: "#1a1a1a|#e8e8e8",
    width: 2,
    isDarkMode: false,
    isEraser: false,
    zoom: 1,
    nibThickness: null,
    nibAngle: null,
  };

  beforeEach(() => {
    container = createContainer();
    cursor = new HoverCursor(container);
  });

  afterEach(() => {
    cursor.destroy();
  });

  it("should create a cursor element", () => {
    const el = container.querySelector(".paper-hover-cursor");
    expect(el).not.toBeNull();
  });

  it("should be hidden initially", () => {
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    expect(el.classList.contains("paper-hover-cursor--hidden")).toBe(true);
  });

  it("should show when show is called", () => {
    cursor.show(100, 200, defaultConfig);
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    expect(el.classList.contains("paper-hover-cursor--hidden")).toBe(false);
  });

  it("should hide when hide is called", () => {
    cursor.show(100, 200, defaultConfig);
    cursor.hide();
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    expect(el.classList.contains("paper-hover-cursor--hidden")).toBe(true);
  });

  it("should set size CSS property based on pen width and zoom", () => {
    cursor.show(100, 200, { ...defaultConfig, width: 5, zoom: 2 });
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    // Size = max(2, 5 * 2) = 10
    expect(el.style.getPropertyValue("--cursor-size")).toBe("10px");
  });

  it("should enforce minimum cursor size", () => {
    cursor.show(100, 200, { ...defaultConfig, width: 0.5, zoom: 1 });
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    // Size = max(2, 0.5 * 1) = 2
    expect(el.style.getPropertyValue("--cursor-size")).toBe("2px");
  });

  it("should use fixed size for eraser cursor", () => {
    cursor.show(100, 200, { ...defaultConfig, isEraser: true });
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    expect(el.style.getPropertyValue("--cursor-size")).toBe("20px");
  });

  it("should add eraser class for eraser cursor", () => {
    cursor.show(100, 200, { ...defaultConfig, isEraser: true });
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    expect(el.classList.contains("paper-hover-cursor--eraser")).toBe(true);
    expect(el.classList.contains("paper-hover-cursor--pen")).toBe(false);
  });

  it("should add pen class for pen cursor", () => {
    cursor.show(100, 200, defaultConfig);
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    expect(el.classList.contains("paper-hover-cursor--pen")).toBe(true);
    expect(el.classList.contains("paper-hover-cursor--eraser")).toBe(false);
  });

  it("should position cursor centered on coordinates", () => {
    cursor.show(100, 200, { ...defaultConfig, width: 10, zoom: 1 });
    const el = container.querySelector(".paper-hover-cursor") as HTMLElement;
    // Size = 10, so x = 100 - 5 = 95, y = 200 - 5 = 195
    expect(el.style.getPropertyValue("--cursor-x")).toBe("95px");
    expect(el.style.getPropertyValue("--cursor-y")).toBe("195px");
  });

  it("should remove element on destroy", () => {
    cursor.destroy();
    const el = container.querySelector(".paper-hover-cursor");
    expect(el).toBeNull();
  });
});
