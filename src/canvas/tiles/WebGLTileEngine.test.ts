/**
 * Unit tests for WebGLTileEngine — renders tile content into FBO textures.
 *
 * Verifies:
 * - Render flow: FBO bind → viewport → transform → render → unbind
 * - Context loss handling
 * - resetState delegation
 * - Grain/stamp texture lifecycle
 * - Validity checks
 */

import { WebGLTileEngine } from "./WebGLTileEngine";
import type { TileGridConfig } from "./TileTypes";
import type { GLTileEntry } from "./WebGLTileCache";
import type { GLOffscreenTarget } from "../engine/GLTextures";
import { StrokePathCache } from "../../stroke/OutlineGenerator";

// ─── Mock dependencies ──────────────────────────────────────────

// Mock WebGL2Engine to track method calls
const mockEngine = {
  setViewport: jest.fn(),
  setTransform: jest.fn(),
  clear: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  clipRect: jest.fn(),
  invalidateFramebuffer: jest.fn(),
  isValid: jest.fn(() => true),
  getCanvas: jest.fn(() => ({ width: 2048, height: 2048 })),
  createGrainTexture: jest.fn(() => ({ _id: "grain-tex", width: 256, height: 256 })),
  deleteTexture: jest.fn(),
  createTexture: jest.fn(() => ({ _id: "stamp-tex", width: 128, height: 128 })),
  destroy: jest.fn(),
  resetState: jest.fn(),
};

jest.mock("../engine/WebGL2Engine", () => ({
  WebGL2Engine: jest.fn().mockImplementation(() => mockEngine),
}));

// Mock rendering functions
jest.mock("../BackgroundRenderer", () => ({
  renderDeskFillEngine: jest.fn(),
  renderPageBackgroundEngine: jest.fn(),
}));

jest.mock("../StrokeRenderCore", () => ({
  renderStrokeToEngine: jest.fn(),
}));

jest.mock("../../stroke/StrokeSimplifier", () => ({
  selectLodLevel: jest.fn(() => 0),
}));

jest.mock("../../color/ColorUtils", () => ({
  resolvePageBackground: jest.fn(() => ({ patternTheme: "light" })),
}));

jest.mock("../../stamp/InkStampTextureManager", () => ({
  InkStampTextureManager: jest.fn().mockImplementation(() => ({
    getCache: jest.fn(() => ({
      getColored: jest.fn(() => ({ width: 128, height: 128 })),
    })),
  })),
}));

// ─── Helpers ────────────────────────────────────────────────────

function makeConfig(): TileGridConfig {
  return {
    tileWorldSize: 512,
    dpr: 2,
    maxMemoryBytes: 200 * 1024 * 1024,
    overscanTiles: 1,
    maxTilePhysical: 2048,
    minTilePhysical: 256,
    resolutionScale: 1,
  };
}

function makeMockCanvas(): HTMLCanvasElement & { _triggerEvent: (event: string, eventObj?: any) => void } {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const mockGLContext = {
    _mock: true,
    FRAMEBUFFER: 0x8D40,
    STENCIL_ATTACHMENT: 0x8D20,
    bindFramebuffer: jest.fn(),
    viewport: jest.fn(),
    invalidateFramebuffer: jest.fn(),
  };
  return {
    width: 2048,
    height: 2048,
    getContext: jest.fn(() => mockGLContext),
    addEventListener: jest.fn((event: string, fn: (...args: any[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    _triggerEvent: (event: string, eventObj?: any) => {
      for (const fn of listeners[event] || []) {
        fn(eventObj || {});
      }
    },
  } as unknown as HTMLCanvasElement & { _triggerEvent: (event: string, eventObj?: any) => void };
}

function makeFboEntry(tilePhysical = 1024): GLTileEntry {
  const fbo: GLOffscreenTarget = {
    fbo: { _id: "fbo" } as unknown as WebGLFramebuffer,
    colorTexture: { _id: "color-tex" } as unknown as WebGLTexture,
    stencilRB: { _id: "stencil-rb" } as unknown as WebGLRenderbuffer,
    width: tilePhysical,
    height: tilePhysical,
  };

  return {
    key: { col: 0, row: 0 },
    texture: fbo.colorTexture,
    textureWidth: tilePhysical,
    textureHeight: tilePhysical,
    worldBounds: [0, 0, 512, 512] as [number, number, number, number],
    strokeIds: new Set<string>(),
    dirty: true,
    lastAccess: 0,
    memoryBytes: tilePhysical * tilePhysical * 4,
    renderedAtBand: 0,
    fbo,
    msaa: null,
  };
}

function makeDoc() {
  return {
    strokes: [],
    styles: {},
    pages: [{ backgroundColor: "#ffffff", backgroundColorTheme: null }],
    layoutDirection: "vertical" as const,
  } as any;
}

function makePageLayout() {
  return [
    { pageIndex: 0, x: 0, y: 0, width: 1024, height: 1024 },
  ] as any;
}

function makeSpatialIndex() {
  return {
    queryRect: jest.fn(() => []),
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────

describe("WebGLTileEngine", () => {
  let canvas: ReturnType<typeof makeMockCanvas>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEngine.isValid.mockReturnValue(true);
    canvas = makeMockCanvas();
  });

  describe("constructor", () => {
    it("creates WebGL2Engine with the canvas", () => {
      const { WebGL2Engine } = require("../engine/WebGL2Engine");
      new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      expect(WebGL2Engine).toHaveBeenCalledWith(canvas, { preserveDrawingBuffer: true });
    });

    it("caches GL context", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const gl = engine.getGL();
      expect(gl).toBeDefined();
      // Should be cached — calling getGL again returns same reference
      expect(engine.getGL()).toBe(gl);
    });

    it("sets up context loss listeners", () => {
      new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      expect(canvas.addEventListener).toHaveBeenCalledWith(
        "webglcontextlost",
        expect.any(Function),
      );
      expect(canvas.addEventListener).toHaveBeenCalledWith(
        "webglcontextrestored",
        expect.any(Function),
      );
    });
  });

  describe("isValid", () => {
    it("returns true when engine is valid", () => {
      mockEngine.isValid.mockReturnValue(true);
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      expect(engine.isValid()).toBe(true);
    });

    it("returns false after context loss", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      canvas._triggerEvent("webglcontextlost", { preventDefault: jest.fn() });

      expect(engine.isValid()).toBe(false);
    });
  });

  describe("renderTile", () => {
    it("binds FBO, sets viewport, renders, then unbinds", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const entry = makeFboEntry(1024);
      const gl = engine.getGL() as any;

      engine.renderTile(entry, makeDoc(), makePageLayout(), makeSpatialIndex(), false);

      // Should bind tile FBO
      expect(gl.bindFramebuffer).toHaveBeenCalledWith(
        gl.FRAMEBUFFER,
        entry.fbo!.fbo,
      );

      // Should set viewport to tile size
      expect(mockEngine.setViewport).toHaveBeenCalledWith(1024, 1024);

      // Should clear
      expect(mockEngine.clear).toHaveBeenCalled();

      // Should set transform (world → tile coords)
      expect(mockEngine.setTransform).toHaveBeenCalled();

      // Should call invalidateFramebuffer (iPad TBDR optimization)
      expect(mockEngine.invalidateFramebuffer).toHaveBeenCalled();

      // Should unbind FBO at end
      const fboCalls = gl.bindFramebuffer.mock.calls;
      const lastFboCall = fboCalls[fboCalls.length - 1];
      expect(lastFboCall[1]).toBeNull(); // Unbind to default

      engine.destroy();
    });

    it("skips render when engine is not valid", () => {
      mockEngine.isValid.mockReturnValue(false);
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      engine.renderTile(makeFboEntry(), makeDoc(), makePageLayout(), makeSpatialIndex(), false);

      // No FBO binding should happen
      expect(mockEngine.setViewport).not.toHaveBeenCalled();
      expect(mockEngine.clear).not.toHaveBeenCalled();

      engine.destroy();
    });

    it("skips render when entry has no FBO (bitmap tile)", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const entry = makeFboEntry();
      entry.fbo = null; // bitmap tile

      engine.renderTile(entry, makeDoc(), makePageLayout(), makeSpatialIndex(), false);

      expect(mockEngine.clear).not.toHaveBeenCalled();

      engine.destroy();
    });

    it("sets correct world-to-tile transform", () => {
      const config = makeConfig();
      const engine = new WebGLTileEngine(canvas, config, new StrokePathCache());
      const entry = makeFboEntry(1024);
      entry.worldBounds = [512, 512, 1024, 1024]; // tile at (1,1)

      engine.renderTile(entry, makeDoc(), makePageLayout(), makeSpatialIndex(), false);

      // Transform should be setTransform(scale, 0, 0, scale, tx, ty)
      // scale = tilePhysical / tileWorldSize = 1024 / 512 = 2
      // tx = -worldBounds[0] * scale = -512 * 2 = -1024
      // ty = -worldBounds[1] * scale = -512 * 2 = -1024
      const calls = mockEngine.setTransform.mock.calls;
      // Second setTransform call is the world-to-tile one (first is identity reset)
      const transformCall = calls[1];
      expect(transformCall[0]).toBeCloseTo(2);  // scale
      expect(transformCall[1]).toBe(0);
      expect(transformCall[2]).toBe(0);
      expect(transformCall[3]).toBeCloseTo(2);  // scale
      expect(transformCall[4]).toBeCloseTo(-1024); // tx
      expect(transformCall[5]).toBeCloseTo(-1024); // ty

      engine.destroy();
    });

    it("renders background for overlapping pages", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const entry = makeFboEntry(1024);
      entry.worldBounds = [0, 0, 512, 512];

      const { renderDeskFillEngine, renderPageBackgroundEngine } = require("../BackgroundRenderer");

      engine.renderTile(entry, makeDoc(), makePageLayout(), makeSpatialIndex(), false);

      expect(renderDeskFillEngine).toHaveBeenCalled();
      expect(renderPageBackgroundEngine).toHaveBeenCalled();

      engine.destroy();
    });

    it("clips strokes to their page rect", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const entry = makeFboEntry(1024);
      entry.worldBounds = [0, 0, 512, 512];

      const doc = makeDoc();
      doc.strokes = [{ id: "s1", pageIndex: 0 }];
      const spatialIndex = makeSpatialIndex();
      spatialIndex.queryRect.mockReturnValue(["s1"]);

      engine.renderTile(entry, doc, makePageLayout(), spatialIndex, false);

      // Should save/restore for clip
      expect(mockEngine.save).toHaveBeenCalled();
      expect(mockEngine.clipRect).toHaveBeenCalled();
      expect(mockEngine.restore).toHaveBeenCalled();

      engine.destroy();
    });

    it("tracks stroke IDs on the entry", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const entry = makeFboEntry(1024);
      entry.worldBounds = [0, 0, 512, 512];

      const doc = makeDoc();
      doc.strokes = [{ id: "s1", pageIndex: 0 }, { id: "s2", pageIndex: 0 }];
      const spatialIndex = makeSpatialIndex();
      spatialIndex.queryRect.mockReturnValue(["s1", "s2"]);

      engine.renderTile(entry, doc, makePageLayout(), spatialIndex, false);

      expect(entry.strokeIds.has("s1")).toBe(true);
      expect(entry.strokeIds.has("s2")).toBe(true);

      engine.destroy();
    });

    it("restores canvas viewport after rendering", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const entry = makeFboEntry(1024);

      engine.renderTile(entry, makeDoc(), makePageLayout(), makeSpatialIndex(), false);

      // Last setViewport should restore to canvas dimensions
      const calls = mockEngine.setViewport.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe(2048); // canvas.width
      expect(lastCall[1]).toBe(2048); // canvas.height

      engine.destroy();
    });
  });

  describe("resetState", () => {
    it("delegates to engine.resetState()", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      engine.resetState();
      expect(mockEngine.resetState).toHaveBeenCalledTimes(1);
      engine.destroy();
    });
  });

  describe("grain texture management", () => {
    it("creates grain texture from generator canvas", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      const mockGenerator = {
        getCanvas: jest.fn(() => ({ width: 256, height: 256 })),
      } as any;

      engine.setGrainGenerator(mockGenerator);

      expect(mockEngine.createGrainTexture).toHaveBeenCalled();

      engine.destroy();
    });

    it("deletes old grain texture before creating new one", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      const gen1 = { getCanvas: () => ({ width: 256, height: 256 }) } as any;
      engine.setGrainGenerator(gen1);
      expect(mockEngine.createGrainTexture).toHaveBeenCalledTimes(1);

      const gen2 = { getCanvas: () => ({ width: 512, height: 512 }) } as any;
      engine.setGrainGenerator(gen2);
      expect(mockEngine.deleteTexture).toHaveBeenCalled();
      expect(mockEngine.createGrainTexture).toHaveBeenCalledTimes(2);

      engine.destroy();
    });

    it("handles null generator", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      const gen = { getCanvas: () => ({ width: 256, height: 256 }) } as any;
      engine.setGrainGenerator(gen);

      // Setting to null should delete the texture
      engine.setGrainGenerator(null);
      expect(mockEngine.deleteTexture).toHaveBeenCalled();

      engine.destroy();
    });

    it("handles generator with null canvas", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      const gen = { getCanvas: () => null } as any;
      engine.setGrainGenerator(gen);

      // Should not create texture when canvas is null
      expect(mockEngine.createGrainTexture).not.toHaveBeenCalled();

      engine.destroy();
    });
  });

  describe("context loss", () => {
    it("clears grain texture ref on context loss", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      const gen = { getCanvas: () => ({ width: 256, height: 256 }) } as any;
      engine.setGrainGenerator(gen);

      canvas._triggerEvent("webglcontextlost", { preventDefault: jest.fn() });

      expect(engine.isValid()).toBe(false);

      engine.destroy();
    });

    it("recreates grain texture on context restore", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      const grainCanvas = { width: 256, height: 256 };
      const gen = { getCanvas: () => grainCanvas } as any;
      engine.setGrainGenerator(gen);

      jest.clearAllMocks();
      mockEngine.isValid.mockReturnValue(true);

      canvas._triggerEvent("webglcontextrestored");

      expect(mockEngine.createGrainTexture).toHaveBeenCalledWith(grainCanvas);

      engine.destroy();
    });
  });

  describe("page overlap filtering", () => {
    it("does not render pages that don't overlap the tile", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const entry = makeFboEntry(1024);
      entry.worldBounds = [0, 0, 512, 512]; // tile at origin

      const { renderPageBackgroundEngine } = require("../BackgroundRenderer");

      // Page far away from tile
      const farPageLayout = [
        { pageIndex: 0, x: 5000, y: 5000, width: 1024, height: 1024 },
      ] as any;

      engine.renderTile(entry, makeDoc(), farPageLayout, makeSpatialIndex(), false);

      // Should NOT render page background (doesn't overlap tile)
      expect(renderPageBackgroundEngine).not.toHaveBeenCalled();

      engine.destroy();
    });

    it("renders pages that overlap the tile", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());
      const entry = makeFboEntry(1024);
      entry.worldBounds = [0, 0, 512, 512];

      const { renderPageBackgroundEngine } = require("../BackgroundRenderer");

      // Overlapping page
      const layout = [
        { pageIndex: 0, x: 256, y: 256, width: 1024, height: 1024 },
      ] as any;

      engine.renderTile(entry, makeDoc(), layout, makeSpatialIndex(), false);

      expect(renderPageBackgroundEngine).toHaveBeenCalled();

      engine.destroy();
    });
  });

  describe("destroy", () => {
    it("cleans up stamp texture cache and grain texture", () => {
      const engine = new WebGLTileEngine(canvas, makeConfig(), new StrokePathCache());

      const gen = { getCanvas: () => ({ width: 256, height: 256 }) } as any;
      engine.setGrainGenerator(gen);

      jest.clearAllMocks();

      engine.destroy();

      expect(mockEngine.deleteTexture).toHaveBeenCalled(); // grain texture
      expect(mockEngine.destroy).toHaveBeenCalled();
    });
  });
});
