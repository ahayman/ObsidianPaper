import { BackgroundRenderer } from "./BackgroundRenderer";
import type { BackgroundConfig } from "./BackgroundRenderer";
import { Camera } from "./Camera";

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
  } as unknown as CanvasRenderingContext2D;
}

function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const mockCtx = createMockCtx();
  canvas.getContext = jest.fn().mockReturnValue(mockCtx);
  return canvas;
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
    paperType: "blank",
    isDarkMode: false,
    lineSpacing: 32,
    gridSize: 40,
  };

  it("should create without error", () => {
    expect(renderer).toBeDefined();
  });

  it("should render blank background without error", () => {
    expect(() => renderer.render(blankConfig)).not.toThrow();
  });

  it("should render lined background without error", () => {
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "lined" })
    ).not.toThrow();
  });

  it("should render grid background without error", () => {
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "grid" })
    ).not.toThrow();
  });

  it("should render dot-grid background without error", () => {
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "dot-grid" })
    ).not.toThrow();
  });

  it("should render dark mode backgrounds without error", () => {
    const darkConfig: BackgroundConfig = { ...blankConfig, isDarkMode: true };
    expect(() => renderer.render(darkConfig)).not.toThrow();
    expect(() =>
      renderer.render({ ...darkConfig, paperType: "lined" })
    ).not.toThrow();
    expect(() =>
      renderer.render({ ...darkConfig, paperType: "grid" })
    ).not.toThrow();
    expect(() =>
      renderer.render({ ...darkConfig, paperType: "dot-grid" })
    ).not.toThrow();
  });

  it("should handle zoomed camera", () => {
    camera.zoomAt(400, 300, 2);
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "grid" })
    ).not.toThrow();
  });

  it("should handle panned camera", () => {
    camera.pan(100, 200);
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "lined" })
    ).not.toThrow();
  });

  it("should handle different grid sizes", () => {
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "grid", gridSize: 10 })
    ).not.toThrow();
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "grid", gridSize: 100 })
    ).not.toThrow();
  });

  it("should handle different line spacings", () => {
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "lined", lineSpacing: 16 })
    ).not.toThrow();
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "lined", lineSpacing: 64 })
    ).not.toThrow();
  });

  it("should expose canvas element", () => {
    expect(renderer.getCanvas()).toBe(canvas);
  });

  it("should handle high DPI", () => {
    renderer.setSize(800, 600, 2);
    expect(() =>
      renderer.render({ ...blankConfig, paperType: "dot-grid" })
    ).not.toThrow();
  });
});
