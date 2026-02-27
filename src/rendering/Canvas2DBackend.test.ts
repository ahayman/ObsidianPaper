import { Canvas2DBackend } from "./Canvas2DBackend";
import { RecordingContext2D } from "../canvas/__tests__/RecordingContext2D";

function makeBackend(opts = { width: 512, height: 512 }) {
  const ctx = new RecordingContext2D(opts);
  const backend = new Canvas2DBackend(ctx as unknown as CanvasRenderingContext2D);
  return { ctx, backend };
}

describe("Canvas2DBackend", () => {
  describe("dimensions", () => {
    it("reports canvas width and height", () => {
      const { backend } = makeBackend({ width: 1024, height: 768 });
      expect(backend.width).toBe(1024);
      expect(backend.height).toBe(768);
    });
  });

  describe("state stack", () => {
    it("save and restore delegate to context", () => {
      const { ctx, backend } = makeBackend();
      backend.save();
      backend.restore();
      const methods = ctx.calls.map((c) => c.method);
      expect(methods).toEqual(["save", "restore"]);
    });
  });

  describe("transform", () => {
    it("setTransform records the call", () => {
      const { ctx, backend } = makeBackend();
      backend.setTransform(2, 0, 0, 2, 10, 20);
      expect(ctx.calls).toEqual([
        { method: "setTransform", args: [2, 0, 0, 2, 10, 20] },
      ]);
    });

    it("getTransform returns the current transform", () => {
      const { backend } = makeBackend();
      backend.setTransform(3, 0, 0, 3, 5, 5);
      const m = backend.getTransform();
      expect(m.a).toBe(3);
      expect(m.e).toBe(5);
    });
  });

  describe("style", () => {
    it("setFillColor sets fillStyle", () => {
      const { ctx, backend } = makeBackend();
      backend.setFillColor("#ff0000");
      expect(ctx.calls).toEqual([
        { method: "set:fillStyle", args: ["#ff0000"] },
      ]);
    });

    it("setAlpha sets globalAlpha", () => {
      const { ctx, backend } = makeBackend();
      backend.setAlpha(0.5);
      expect(ctx.calls).toEqual([
        { method: "set:globalAlpha", args: [0.5] },
      ]);
    });

    it("setBlendMode sets globalCompositeOperation", () => {
      const { ctx, backend } = makeBackend();
      backend.setBlendMode("multiply");
      expect(ctx.calls).toEqual([
        { method: "set:globalCompositeOperation", args: ["multiply"] },
      ]);
    });
  });

  describe("geometry fill", () => {
    it("fillPath calls fill with Path2D", () => {
      const { ctx, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
      backend.fillPath(verts);
      expect(ctx.calls).toEqual([
        { method: "fill", args: ["Path2D"] },
      ]);
    });

    it("fillPath does nothing for insufficient vertices", () => {
      const { ctx, backend } = makeBackend();
      backend.fillPath(new Float32Array([0, 0]));
      expect(ctx.calls).toEqual([]);
    });

    it("fillTriangles calls fill with Path2D", () => {
      const { ctx, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 5, 10]);
      backend.fillTriangles(verts);
      expect(ctx.calls).toEqual([
        { method: "fill", args: ["Path2D"] },
      ]);
    });
  });

  describe("stamps", () => {
    it("drawStampDiscs draws arcs for each stamp", () => {
      const { ctx, backend } = makeBackend();
      const data = new Float32Array([
        100, 200, 10, 0.8,
        300, 400, 20, 0.6,
      ]);
      backend.drawStampDiscs("#000000", data);

      const methods = ctx.calls.map((c) => c.method);
      expect(methods).toContain("set:fillStyle");
      expect(methods).toContain("beginPath");
      expect(methods).toContain("arc");
      expect(methods).toContain("fill");
    });

    it("drawStampDiscs skips low-opacity stamps", () => {
      const { ctx, backend } = makeBackend();
      const data = new Float32Array([100, 200, 10, 0.01]);
      backend.drawStampDiscs("#000000", data);
      // Only fillStyle set + globalAlpha reset, no arc
      const arcCalls = ctx.calls.filter((c) => c.method === "arc");
      expect(arcCalls).toHaveLength(0);
    });
  });

  describe("masking", () => {
    it("maskToPath applies destination-in compositing", () => {
      const { ctx, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
      backend.maskToPath(verts);

      const methods = ctx.calls.map((c) => c.method);
      expect(methods).toContain("save");
      expect(methods).toContain("set:globalCompositeOperation");
      expect(methods).toContain("fill");
      expect(methods).toContain("restore");

      const gcoCall = ctx.calls.find((c) => c.method === "set:globalCompositeOperation");
      expect(gcoCall!.args[0]).toBe("destination-in");
    });

    it("maskToTriangles applies destination-in compositing", () => {
      const { ctx, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 5, 10]);
      backend.maskToTriangles(verts);

      const gcoCall = ctx.calls.find((c) => c.method === "set:globalCompositeOperation");
      expect(gcoCall!.args[0]).toBe("destination-in");
    });
  });

  describe("clipping", () => {
    it("clipPath calls clip with Path2D", () => {
      const { ctx, backend } = makeBackend();
      const verts = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
      backend.clipPath(verts);
      expect(ctx.calls).toEqual([
        { method: "clip", args: ["Path2D"] },
      ]);
    });

    it("clipRect calls clip with a rect Path2D", () => {
      const { ctx, backend } = makeBackend();
      backend.clipRect(0, 0, 100, 100);
      expect(ctx.calls).toEqual([
        { method: "clip", args: ["Path2D"] },
      ]);
    });
  });

  describe("fillRect", () => {
    it("delegates to ctx.fillRect", () => {
      const { ctx, backend } = makeBackend();
      backend.fillRect(10, 20, 30, 40);
      expect(ctx.calls).toEqual([
        { method: "fillRect", args: [10, 20, 30, 40] },
      ]);
    });
  });

  describe("clear", () => {
    it("clears the full canvas via identity transform", () => {
      const { ctx, backend } = makeBackend();
      backend.clear();
      const methods = ctx.calls.map((c) => c.method);
      expect(methods).toContain("save");
      expect(methods).toContain("setTransform");
      expect(methods).toContain("clearRect");
      expect(methods).toContain("restore");
    });
  });
});
