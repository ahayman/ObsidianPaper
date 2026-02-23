import { createRenderEngine, isWebGL2Available } from "./EngineFactory";
import { Canvas2DEngine } from "./Canvas2DEngine";

// Mock Path2D for jsdom
beforeAll(() => {
  if (typeof globalThis.Path2D === "undefined") {
    (globalThis as any).Path2D = class MockPath2D {
      moveTo() { /* no-op */ }
      lineTo() { /* no-op */ }
      quadraticCurveTo() { /* no-op */ }
      closePath() { /* no-op */ }
      rect() { /* no-op */ }
    };
  }
});

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const mockCtx = {
    canvas,
    save: jest.fn(),
    restore: jest.fn(),
    setTransform: jest.fn(),
    getTransform: jest.fn().mockReturnValue({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    fillRect: jest.fn(),
    clearRect: jest.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  canvas.getContext = jest.fn().mockReturnValue(mockCtx);
  return canvas;
}

describe("EngineFactory", () => {
  describe("createRenderEngine", () => {
    it("returns Canvas2DEngine for canvas2d type", () => {
      const engine = createRenderEngine("canvas2d", makeCanvas());
      expect(engine).toBeInstanceOf(Canvas2DEngine);
    });

    it("returns Canvas2DEngine for webgl type (fallback)", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const engine = createRenderEngine("webgl", makeCanvas());
      expect(engine).toBeInstanceOf(Canvas2DEngine);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Falling back"),
      );
    });
  });

  describe("isWebGL2Available", () => {
    it("returns a boolean", () => {
      const result = isWebGL2Available();
      expect(typeof result).toBe("boolean");
    });

    // jsdom does not support WebGL, so this should return false
    it("returns false in jsdom (no WebGL support)", () => {
      expect(isWebGL2Available()).toBe(false);
    });
  });
});
