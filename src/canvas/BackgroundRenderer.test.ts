import { BackgroundRenderer } from "./BackgroundRenderer";
import type { BackgroundConfig } from "./BackgroundRenderer";
import { Camera } from "./Camera";
import type { PageRect } from "../document/PageLayout";
import type { Page } from "../types";

// Mock CanvasRenderingContext2D for jsdom
function createMockCtx(): CanvasRenderingContext2D {
  return {
    setTransform: jest.fn(),
    scale: jest.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    rect: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    transform: jest.fn(),
    translate: jest.fn(),
    clearRect: jest.fn(),
    clip: jest.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const mockCtx = createMockCtx();
  canvas.getContext = jest.fn().mockReturnValue(mockCtx);
  return canvas;
}

function makePage(paperType: Page["paperType"] = "blank"): Page {
  return {
    id: "p00001",
    size: { width: 612, height: 792 },
    orientation: "portrait",
    paperType,
    lineSpacing: 32,
    gridSize: 40,
    margins: { top: 72, bottom: 36, left: 36, right: 36 },
  };
}

function makePageLayout(page: Page): PageRect[] {
  return [
    {
      pageIndex: 0,
      x: -306,
      y: 0,
      width: page.orientation === "landscape" ? page.size.height : page.size.width,
      height: page.orientation === "landscape" ? page.size.width : page.size.height,
    },
  ];
}

describe("BackgroundRenderer", () => {
  let camera: Camera;
  let canvas: HTMLCanvasElement;
  let renderer: BackgroundRenderer;

  beforeEach(() => {
    camera = new Camera();
    canvas = createMockCanvas();
    renderer = new BackgroundRenderer(canvas, camera);
    renderer.setSize(800, 600, 1);
  });

  const blankConfig: BackgroundConfig = {
    isDarkMode: false,
  };

  it("should create without error", () => {
    expect(renderer).toBeDefined();
  });

  it("should render blank background without error", () => {
    const page = makePage("blank");
    expect(() => renderer.render(blankConfig, makePageLayout(page), [page])).not.toThrow();
  });

  it("should render lined background without error", () => {
    const page = makePage("lined");
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page), [page])
    ).not.toThrow();
  });

  it("should render grid background without error", () => {
    const page = makePage("grid");
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page), [page])
    ).not.toThrow();
  });

  it("should render dot-grid background without error", () => {
    const page = makePage("dot-grid");
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page), [page])
    ).not.toThrow();
  });

  it("should render dark mode backgrounds without error", () => {
    const darkConfig: BackgroundConfig = { isDarkMode: true };
    const blank = makePage("blank");
    const lined = makePage("lined");
    const grid = makePage("grid");
    const dotGrid = makePage("dot-grid");
    expect(() => renderer.render(darkConfig, makePageLayout(blank), [blank])).not.toThrow();
    expect(() =>
      renderer.render(darkConfig, makePageLayout(lined), [lined])
    ).not.toThrow();
    expect(() =>
      renderer.render(darkConfig, makePageLayout(grid), [grid])
    ).not.toThrow();
    expect(() =>
      renderer.render(darkConfig, makePageLayout(dotGrid), [dotGrid])
    ).not.toThrow();
  });

  it("should handle zoomed camera", () => {
    camera.zoomAt(400, 300, 2);
    const page = makePage("grid");
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page), [page])
    ).not.toThrow();
  });

  it("should handle panned camera", () => {
    camera.pan(100, 200);
    const page = makePage("lined");
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page), [page])
    ).not.toThrow();
  });

  it("should handle different grid sizes", () => {
    const page1: Page = { ...makePage("grid"), gridSize: 10 };
    const page2: Page = { ...makePage("grid"), gridSize: 100 };
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page1), [page1])
    ).not.toThrow();
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page2), [page2])
    ).not.toThrow();
  });

  it("should handle different line spacings", () => {
    const page1: Page = { ...makePage("lined"), lineSpacing: 16 };
    const page2: Page = { ...makePage("lined"), lineSpacing: 64 };
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page1), [page1])
    ).not.toThrow();
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page2), [page2])
    ).not.toThrow();
  });

  it("should expose canvas element", () => {
    expect(renderer.getCanvas()).toBe(canvas);
  });

  it("should handle high DPI", () => {
    renderer.setSize(800, 600, 2);
    const page = makePage("dot-grid");
    expect(() =>
      renderer.render(blankConfig, makePageLayout(page), [page])
    ).not.toThrow();
  });
});
