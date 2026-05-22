import { executeMaterial } from "./MaterialExecutor";
import type { StrokeRenderData, ExecutorResources } from "./MaterialExecutor";
import type { StrokeMaterial } from "./StrokeMaterial";
import { RecordingEngine } from "../canvas/__tests__/RecordingEngine";
import { WebGLBackend } from "./WebGLBackend";

// ─── Helpers ────────────────────────────────────────────────

function makeBackend(opts = { width: 2048, height: 2048 }) {
  const engine = new RecordingEngine(opts);
  engine.setTransform(2, 0, 0, 2, -100, -100);
  engine.calls.length = 0;
  return { engine, backend: new WebGLBackend(engine) };
}

function makeVertices(): Float32Array {
  return new Float32Array([100, 200, 200, 200, 200, 250, 100, 250]);
}

function makeStampData(): Float32Array {
  return new Float32Array([
    150, 225, 10, 0.5,
    160, 225, 10, 0.6,
  ]);
}

function makeData(overrides: Partial<StrokeRenderData> = {}): StrokeRenderData {
  return {
    vertices: makeVertices(),
    italic: false,
    color: "#1a1a1a",
    bbox: [100, 200, 200, 250],
    ...overrides,
  };
}

function makeResources(overrides: Partial<ExecutorResources> = {}): ExecutorResources {
  return {
    grainTexture: null,
    inkStampTexture: null,
    canvasWidth: 2048,
    canvasHeight: 2048,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe("executeMaterial", () => {
  describe("fill body, source-over, no isolation", () => {
    const material: StrokeMaterial = {
      body: { type: "fill" },
      blending: "source-over",
      bodyOpacity: 1,
      isolation: false,
      effects: [],
    };

    it("produces setFillColor → setAlpha → fillPath → setAlpha(1)", () => {
      const { engine, backend } = makeBackend();
      executeMaterial(backend, material, makeData(), makeResources());

      const methods = engine.calls.map((c) => c.method);
      expect(methods).toEqual(["setFillColor", "setAlpha", "fillPath", "setAlpha"]);
      expect(engine.calls[0].args).toEqual(["#1a1a1a"]);
      expect(engine.calls[1].args).toEqual([1]);
      expect(engine.calls[3].args).toEqual([1]);
    });

    it("uses fillTriangles for italic vertices", () => {
      const { engine, backend } = makeBackend();
      const data = makeData({ italic: true, vertices: new Float32Array([0, 0, 10, 0, 5, 10]) });
      executeMaterial(backend, material, data, makeResources());

      const methods = engine.calls.map((c) => c.method);
      expect(methods).toContain("fillTriangles");
      expect(methods).not.toContain("fillPath");
    });

    it("does nothing when vertices are null", () => {
      const { engine, backend } = makeBackend();
      executeMaterial(backend, material, makeData({ vertices: null }), makeResources());
      expect(engine.calls).toHaveLength(0);
    });
  });

  describe("fill body, multiply blend (highlighter)", () => {
    const material: StrokeMaterial = {
      body: { type: "fill" },
      blending: "multiply",
      bodyOpacity: 0.3,
      isolation: false,
      effects: [],
    };

    it("produces save → setAlpha → setBlendMode → setFillColor → fillPath → restore", () => {
      const { engine, backend } = makeBackend();
      executeMaterial(backend, material, makeData(), makeResources());

      const methods = engine.calls.map((c) => c.method);
      expect(methods).toEqual([
        "save", "setAlpha", "setBlendMode", "setFillColor", "fillPath", "restore",
      ]);
      expect(engine.calls[1].args).toEqual([0.3]);
      expect(engine.calls[2].args).toEqual(["multiply"]);
    });
  });

  describe("stampDiscs body", () => {
    const material: StrokeMaterial = {
      body: { type: "stampDiscs" },
      blending: "source-over",
      bodyOpacity: 0.85,
      isolation: false,
      effects: [],
    };

    it("produces setAlpha → drawStampDiscs → setAlpha(1)", () => {
      const { engine, backend } = makeBackend();
      const data = makeData({ stampData: makeStampData() });
      executeMaterial(backend, material, data, makeResources());

      const methods = engine.calls.map((c) => c.method);
      expect(methods).toEqual(["setAlpha", "drawStampDiscs", "setAlpha"]);
      expect(engine.calls[0].args).toEqual([0.85]);
      expect(engine.calls[1].args[0]).toBe("#1a1a1a");
    });

    it("does nothing without stamp data", () => {
      const { engine, backend } = makeBackend();
      executeMaterial(backend, material, makeData(), makeResources());
      expect(engine.calls).toHaveLength(0);
    });
  });

  describe("inkShading body + outlineMask, offscreen isolation", () => {
    const material: StrokeMaterial = {
      body: { type: "inkShading" },
      blending: "source-over",
      bodyOpacity: 1,
      isolation: true,
      effects: [{ type: "outlineMask" }],
    };

    it("produces offscreen → stamps → mask → composite sequence", () => {
      const { engine, backend } = makeBackend();
      const inkTex = { width: 64, height: 64 };
      const data = makeData({
        stampData: makeStampData(),
        strokeWidth: 6,
      });
      executeMaterial(backend, material, data, makeResources({ inkStampTexture: inkTex }));

      const methods = engine.calls.map((c) => c.method);

      // Offscreen setup
      expect(methods[0]).toBe("beginOffscreen");
      expect(methods[1]).toBe("clear");
      expect(methods[2]).toBe("setTransform");

      // Body: stamps
      expect(methods).toContain("setAlpha");
      expect(methods).toContain("drawStamps");

      // Effect: outline mask
      expect(methods).toContain("maskToPath");

      // Composite back
      expect(methods).toContain("endOffscreen");
      expect(methods).toContain("save");
      expect(methods).toContain("drawOffscreen");
      expect(methods).toContain("restore");
    });

    it("uses maskToTriangles for italic vertices", () => {
      const { engine, backend } = makeBackend();
      const inkTex = { width: 64, height: 64 };
      const data = makeData({
        stampData: makeStampData(),
        italic: true,
        vertices: new Float32Array([0, 0, 10, 0, 5, 10]),
        strokeWidth: 6,
      });
      executeMaterial(backend, material, data, makeResources({ inkStampTexture: inkTex }));

      const methods = engine.calls.map((c) => c.method);
      expect(methods).toContain("maskToTriangles");
      expect(methods).not.toContain("maskToPath");
    });
  });

  describe("fill body + grain effect, offscreen isolation", () => {
    const material: StrokeMaterial = {
      body: { type: "fill" },
      blending: "source-over",
      bodyOpacity: 0.85,
      isolation: true,
      effects: [{ type: "grain" }],
    };

    it("produces offscreen → fill → clip + applyGrain → composite", () => {
      const { engine, backend } = makeBackend();
      const grainTex = { width: 256, height: 256 };
      const data = makeData({
        grainAnchor: [100, 200],
        grainStrength: 0.5,
      });
      executeMaterial(backend, material, data, makeResources({ grainTexture: grainTex }));

      const methods = engine.calls.map((c) => c.method);

      // Offscreen
      expect(methods[0]).toBe("beginOffscreen");
      expect(methods[1]).toBe("clear");
      expect(methods[2]).toBe("setTransform");

      // Fill
      expect(methods).toContain("setFillColor");
      expect(methods).toContain("fillPath");

      // Grain effect
      expect(methods).toContain("save");
      expect(methods).toContain("clipPath");
      expect(methods).toContain("applyGrain");
      expect(methods).toContain("restore");

      // Composite
      expect(methods).toContain("endOffscreen");
      expect(methods).toContain("drawOffscreen");
    });

    it("skips grain when texture not available", () => {
      const { engine, backend } = makeBackend();
      const data = makeData({ grainAnchor: [100, 200], grainStrength: 0.5 });
      executeMaterial(backend, material, data, makeResources({ grainTexture: null }));

      const methods = engine.calls.map((c) => c.method);
      expect(methods).not.toContain("applyGrain");
      // Fill still happens
      expect(methods).toContain("fillPath");
    });
  });

  describe("fill body + inkPooling effect", () => {
    const material: StrokeMaterial = {
      body: { type: "fill" },
      blending: "source-over",
      bodyOpacity: 1,
      isolation: false,
      effects: [{ type: "inkPooling" }],
    };

    it("fill executes but inkPooling is skipped (engine path)", () => {
      const { engine, backend } = makeBackend();
      executeMaterial(backend, material, makeData(), makeResources());

      const methods = engine.calls.map((c) => c.method);
      expect(methods).toEqual(["setFillColor", "setAlpha", "fillPath", "setAlpha"]);
      // No ink pooling calls — skipped in engine path
    });
  });
});
