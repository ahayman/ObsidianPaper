import { Canvas2DEngine } from "./Canvas2DEngine";
import type { BlendMode } from "./RenderEngine";

// --- Mock canvas context with stateful transform tracking ---

interface TransformState {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

function createMockCtx() {
  const transformStack: TransformState[] = [];
  let current: TransformState = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  const ctx = {
    // Canvas reference (set after creation)
    canvas: null as unknown as HTMLCanvasElement,
    // Transform
    save: jest.fn(() => { transformStack.push({ ...current }); }),
    restore: jest.fn(() => {
      const prev = transformStack.pop();
      if (prev) current = prev;
    }),
    setTransform: jest.fn((a: number, b: number, c: number, d: number, e: number, f: number) => {
      current = { a, b, c, d, e, f };
    }),
    transform: jest.fn(),
    translate: jest.fn((x: number, y: number) => {
      current.e += x;
      current.f += y;
    }),
    scale: jest.fn((sx: number, sy: number) => {
      current.a *= sx;
      current.d *= sy;
    }),
    getTransform: jest.fn(() => ({ ...current })),
    // Style
    fillStyle: "" as string | CanvasPattern,
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    // Shadow
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    // Drawing
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    clearRect: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    clip: jest.fn(),
    drawImage: jest.fn(),
    // Path
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    // Pattern
    createPattern: jest.fn().mockReturnValue({}),
  };
  return ctx;
}

type MockCtx = ReturnType<typeof createMockCtx>;

function createEngine(w = 200, h = 100): { engine: Canvas2DEngine; canvas: HTMLCanvasElement; ctx: MockCtx } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = createMockCtx();
  ctx.canvas = canvas;
  canvas.getContext = jest.fn().mockReturnValue(ctx);

  const engine = new Canvas2DEngine(canvas);
  return { engine, canvas, ctx };
}

// Mock OffscreenCanvas and Path2D for jsdom
beforeAll(() => {
  if (typeof globalThis.OffscreenCanvas === "undefined") {
    (globalThis as any).OffscreenCanvas = class MockOffscreenCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return createMockCtx(); }
    };
  }
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

describe("Canvas2DEngine", () => {
  describe("lifecycle", () => {
    it("initializes with canvas dimensions", () => {
      const { engine } = createEngine(300, 150);
      expect(engine.width).toBe(300);
      expect(engine.height).toBe(150);
    });

    it("resize updates dimensions", () => {
      const { engine } = createEngine();
      engine.resize(500, 400);
      expect(engine.width).toBe(500);
      expect(engine.height).toBe(400);
    });

    it("destroy does not throw", () => {
      const { engine } = createEngine();
      expect(() => engine.destroy()).not.toThrow();
    });
  });

  describe("fillRect", () => {
    it("delegates to canvas context", () => {
      const { engine, ctx } = createEngine();
      engine.fillRect(10, 20, 30, 40);
      expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 30, 40);
    });
  });

  describe("save/restore", () => {
    it("saves and restores transform state", () => {
      const { engine } = createEngine();
      engine.setTransform(2, 0, 0, 2, 10, 20);
      engine.save();
      engine.setTransform(1, 0, 0, 1, 0, 0);

      const identity = engine.getTransform();
      expect(identity.a).toBe(1);
      expect(identity.e).toBe(0);

      engine.restore();
      const restored = engine.getTransform();
      expect(restored.a).toBe(2);
      expect(restored.e).toBe(10);
    });
  });

  describe("setTransform/getTransform", () => {
    it("round-trips transform values", () => {
      const { engine } = createEngine();
      engine.setTransform(1, 0, 0, 1, 50, 75);
      const t = engine.getTransform();
      expect(t.a).toBe(1);
      expect(t.b).toBe(0);
      expect(t.c).toBe(0);
      expect(t.d).toBe(1);
      expect(t.e).toBe(50);
      expect(t.f).toBe(75);
    });
  });

  describe("setBlendMode", () => {
    it.each<[BlendMode, string]>([
      ["source-over", "source-over"],
      ["destination-in", "destination-in"],
      ["destination-out", "destination-out"],
      ["multiply", "multiply"],
    ])("maps %s to %s", (mode, expected) => {
      const { engine, ctx } = createEngine();
      engine.setBlendMode(mode);
      expect(ctx.globalCompositeOperation).toBe(expected);
    });
  });

  describe("setAlpha", () => {
    it("sets globalAlpha", () => {
      const { engine, ctx } = createEngine();
      engine.setAlpha(0.5);
      expect(ctx.globalAlpha).toBe(0.5);
    });
  });

  describe("clipRect", () => {
    it("calls ctx.clip", () => {
      const { engine, ctx } = createEngine();
      engine.save();
      engine.clipRect(0, 0, 100, 100);
      expect(ctx.clip).toHaveBeenCalled();
      engine.restore();
    });
  });

  describe("offscreen targets", () => {
    it("getOffscreen returns a target with correct dimensions", () => {
      const { engine } = createEngine();
      const target = engine.getOffscreen("test", 128, 64);
      expect(target.width).toBe(128);
      expect(target.height).toBe(64);
    });

    it("getOffscreen returns the same target for the same id", () => {
      const { engine } = createEngine();
      const t1 = engine.getOffscreen("a", 100, 100);
      const t2 = engine.getOffscreen("a", 100, 100);
      expect(t1).toBe(t2);
    });

    it("getOffscreen resizes existing target if dimensions change", () => {
      const { engine } = createEngine();
      const t1 = engine.getOffscreen("a", 100, 100);
      const t2 = engine.getOffscreen("a", 200, 150);
      expect(t1).toBe(t2);
      expect(t2.width).toBe(200);
      expect(t2.height).toBe(150);
    });

    it("beginOffscreen/endOffscreen switches context", () => {
      const { engine, ctx } = createEngine();
      const target = engine.getOffscreen("test", 50, 50);

      // Before offscreen: fill goes to main canvas ctx
      engine.fillRect(0, 0, 10, 10);
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);

      // During offscreen: fill goes to offscreen context (not main)
      engine.beginOffscreen(target);
      engine.fillRect(0, 0, 5, 5);
      // Main ctx should still only have 1 call
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
      engine.endOffscreen();

      // After endOffscreen: back to main
      engine.fillRect(0, 0, 10, 10);
      expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    });
  });

  describe("fillPath", () => {
    it("fills a triangle from vertex pairs", () => {
      const { engine, ctx } = createEngine();
      // Triangle: 3 vertices = 6 floats
      const vertices = new Float32Array([0, 0, 100, 0, 50, 100]);
      engine.fillPath(vertices);
      expect(ctx.fill).toHaveBeenCalled();
    });

    it("handles fewer than 2 vertices gracefully", () => {
      const { engine, ctx } = createEngine();
      const vertices = new Float32Array([10, 20]);
      engine.fillPath(vertices);
      expect(ctx.fill).not.toHaveBeenCalled();
    });
  });

  describe("drawLines", () => {
    it("strokes lines from float array", () => {
      const { engine, ctx } = createEngine();

      // Two lines: [x1, y1, x2, y2] each
      const lines = new Float32Array([0, 0, 100, 0, 0, 50, 100, 50]);
      engine.drawLines(lines, "#000", 1);

      expect(ctx.moveTo).toHaveBeenCalledTimes(2);
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });
  });

  describe("drawCircles", () => {
    it("fills circles from float array", () => {
      const { engine, ctx } = createEngine();

      // Two circles: [cx, cy, radius] each
      const circles = new Float32Array([50, 50, 5, 100, 100, 3]);
      engine.drawCircles(circles, "#f00");

      expect(ctx.arc).toHaveBeenCalledTimes(2);
      expect(ctx.fill).toHaveBeenCalledTimes(1);
    });
  });

  describe("shadow", () => {
    it("setShadow sets context shadow properties", () => {
      const { engine, ctx } = createEngine();
      engine.setShadow("rgba(0,0,0,0.5)", 4, 2, 3);
      expect(ctx.shadowColor).toBe("rgba(0,0,0,0.5)");
      expect(ctx.shadowBlur).toBe(4);
      expect(ctx.shadowOffsetX).toBe(2);
      expect(ctx.shadowOffsetY).toBe(3);
    });

    it("clearShadow resets shadow properties", () => {
      const { engine, ctx } = createEngine();
      engine.setShadow("rgba(0,0,0,0.5)", 4, 2, 3);
      engine.clearShadow();
      expect(ctx.shadowColor).toBe("transparent");
      expect(ctx.shadowBlur).toBe(0);
      expect(ctx.shadowOffsetX).toBe(0);
      expect(ctx.shadowOffsetY).toBe(0);
    });
  });

  describe("clear", () => {
    it("clears the entire canvas", () => {
      const { engine, ctx } = createEngine(200, 100);
      engine.clear();
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
    });
  });

  describe("style setters", () => {
    it("setFillColor sets fillStyle", () => {
      const { engine, ctx } = createEngine();
      engine.setFillColor("#ff0000");
      expect(ctx.fillStyle).toBe("#ff0000");
    });

    it("setStrokeColor sets strokeStyle", () => {
      const { engine, ctx } = createEngine();
      engine.setStrokeColor("#00ff00");
      expect(ctx.strokeStyle).toBe("#00ff00");
    });

    it("setLineWidth sets lineWidth", () => {
      const { engine, ctx } = createEngine();
      engine.setLineWidth(3);
      expect(ctx.lineWidth).toBe(3);
    });
  });

  describe("transform helpers", () => {
    it("translate moves the origin", () => {
      const { engine } = createEngine();
      engine.setTransform(1, 0, 0, 1, 0, 0);
      engine.translate(10, 20);
      const t = engine.getTransform();
      expect(t.e).toBe(10);
      expect(t.f).toBe(20);
    });

    it("scale changes the scale", () => {
      const { engine } = createEngine();
      engine.setTransform(1, 0, 0, 1, 0, 0);
      engine.scale(2, 3);
      const t = engine.getTransform();
      expect(t.a).toBe(2);
      expect(t.d).toBe(3);
    });
  });
});
