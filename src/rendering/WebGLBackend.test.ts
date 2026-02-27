import { WebGLBackend } from "./WebGLBackend";
import { RecordingEngine } from "../canvas/__tests__/RecordingEngine";

function makeBackend(opts = { width: 2048, height: 2048 }) {
  const engine = new RecordingEngine(opts);
  const backend = new WebGLBackend(engine);
  return { engine, backend };
}

describe("WebGLBackend", () => {
  describe("dimensions", () => {
    it("reports engine width and height", () => {
      const { backend } = makeBackend({ width: 1024, height: 768 });
      expect(backend.width).toBe(1024);
      expect(backend.height).toBe(768);
    });
  });

  describe("state stack", () => {
    it("save delegates to engine.save", () => {
      const { engine, backend } = makeBackend();
      backend.save();
      expect(engine.calls).toEqual([{ method: "save", args: [] }]);
    });

    it("restore delegates to engine.restore", () => {
      const { engine, backend } = makeBackend();
      backend.save();
      backend.restore();
      expect(engine.calls).toEqual([
        { method: "save", args: [] },
        { method: "restore", args: [] },
      ]);
    });
  });

  describe("transform", () => {
    it("setTransform delegates to engine", () => {
      const { engine, backend } = makeBackend();
      backend.setTransform(2, 0, 0, 2, 10, 20);
      expect(engine.calls).toEqual([
        { method: "setTransform", args: [2, 0, 0, 2, 10, 20] },
      ]);
    });

    it("getTransform returns engine transform", () => {
      const { backend } = makeBackend();
      backend.setTransform(3, 0, 0, 3, 5, 5);
      const m = backend.getTransform();
      expect(m.a).toBe(3);
      expect(m.e).toBe(5);
    });
  });

  describe("style", () => {
    it("setFillColor delegates to engine", () => {
      const { engine, backend } = makeBackend();
      backend.setFillColor("#ff0000");
      expect(engine.calls).toEqual([
        { method: "setFillColor", args: ["#ff0000"] },
      ]);
    });

    it("setAlpha delegates to engine", () => {
      const { engine, backend } = makeBackend();
      backend.setAlpha(0.5);
      expect(engine.calls).toEqual([
        { method: "setAlpha", args: [0.5] },
      ]);
    });

    it("setBlendMode delegates to engine", () => {
      const { engine, backend } = makeBackend();
      backend.setBlendMode("multiply");
      expect(engine.calls).toEqual([
        { method: "setBlendMode", args: ["multiply"] },
      ]);
    });
  });

  describe("geometry fill", () => {
    it("fillPath delegates to engine.fillPath", () => {
      const { engine, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
      backend.fillPath(verts);
      expect(engine.calls).toEqual([
        { method: "fillPath", args: [Array.from(verts)] },
      ]);
    });

    it("fillTriangles delegates to engine.fillTriangles", () => {
      const { engine, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 5, 10]);
      backend.fillTriangles(verts);
      expect(engine.calls).toEqual([
        { method: "fillTriangles", args: [Array.from(verts)] },
      ]);
    });
  });

  describe("stamps", () => {
    it("drawStampDiscs delegates to engine", () => {
      const { engine, backend } = makeBackend();
      const data = new Float32Array([100, 200, 10, 0.8]);
      backend.drawStampDiscs("#000", data);
      expect(engine.calls).toEqual([
        { method: "drawStampDiscs", args: ["#000", Array.from(data)] },
      ]);
    });

    it("drawStamps delegates to engine", () => {
      const { engine, backend } = makeBackend();
      const tex = { width: 64, height: 64 };
      const data = new Float32Array([100, 200, 10, 0.8]);
      backend.drawStamps(tex, data);
      expect(engine.calls).toEqual([
        { method: "drawStamps", args: [{ w: 64, h: 64 }, Array.from(data)] },
      ]);
    });
  });

  describe("grain texture", () => {
    it("applyGrain delegates to engine", () => {
      const { engine, backend } = makeBackend();
      const tex = { width: 256, height: 256 };
      backend.applyGrain(tex, 10, 20, 0.5);
      expect(engine.calls).toEqual([
        { method: "applyGrain", args: [{ w: 256, h: 256 }, 10, 20, 0.5] },
      ]);
    });
  });

  describe("masking", () => {
    it("maskToPath delegates to engine", () => {
      const { engine, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 10, 10]);
      backend.maskToPath(verts);
      expect(engine.calls).toEqual([
        { method: "maskToPath", args: [Array.from(verts)] },
      ]);
    });

    it("maskToTriangles delegates to engine", () => {
      const { engine, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 5, 10]);
      backend.maskToTriangles(verts);
      expect(engine.calls).toEqual([
        { method: "maskToTriangles", args: [Array.from(verts)] },
      ]);
    });
  });

  describe("clipping", () => {
    it("clipPath delegates to engine", () => {
      const { engine, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 10, 10]);
      backend.clipPath(verts);
      expect(engine.calls).toEqual([
        { method: "clipPath", args: [Array.from(verts)] },
      ]);
    });

    it("clipRect delegates to engine", () => {
      const { engine, backend } = makeBackend();
      backend.clipRect(0, 0, 100, 200);
      expect(engine.calls).toEqual([
        { method: "clipRect", args: [0, 0, 100, 200] },
      ]);
    });
  });

  describe("offscreen rendering", () => {
    it("getOffscreen returns a target from the engine", () => {
      const { backend } = makeBackend();
      const target = backend.getOffscreen("test", 256, 256);
      expect(target.width).toBe(256);
      expect(target.height).toBe(256);
    });

    it("beginOffscreen and endOffscreen delegate to engine", () => {
      const { engine, backend } = makeBackend();
      const target = backend.getOffscreen("test", 256, 256);
      backend.beginOffscreen(target);
      backend.endOffscreen();
      expect(engine.calls).toEqual([
        { method: "beginOffscreen", args: [{ w: 256, h: 256 }] },
        { method: "endOffscreen", args: [] },
      ]);
    });

    it("drawOffscreen delegates to engine", () => {
      const { engine, backend } = makeBackend();
      const target = backend.getOffscreen("test", 256, 256);
      backend.drawOffscreen(target, 10, 20, 256, 256);
      expect(engine.calls).toEqual([
        { method: "drawOffscreen", args: [{ w: 256, h: 256 }, 10, 20, 256, 256] },
      ]);
    });
  });

  describe("clear", () => {
    it("delegates to engine.clear", () => {
      const { engine, backend } = makeBackend();
      backend.clear();
      expect(engine.calls).toEqual([{ method: "clear", args: [] }]);
    });
  });

  describe("fillRect", () => {
    it("delegates to engine.fillRect", () => {
      const { engine, backend } = makeBackend();
      backend.fillRect(10, 20, 30, 40);
      expect(engine.calls).toEqual([
        { method: "fillRect", args: [10, 20, 30, 40] },
      ]);
    });
  });
});
