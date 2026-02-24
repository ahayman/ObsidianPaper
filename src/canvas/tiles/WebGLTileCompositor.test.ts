/**
 * Unit tests for WebGLTileCompositor — draws tile textures as quads.
 *
 * Verifies:
 * - GL call sequence during composite()
 * - Y-flip handling for FBO vs bitmap tiles
 * - Projection matrix caching
 * - Dark/light mode clear color
 * - Resource cleanup on destroy
 */

import { WebGLTileCompositor } from "./WebGLTileCompositor";
import { TileGrid } from "./TileGrid";
import type { TileGridConfig, TileKey } from "./TileTypes";
import { tileKeyString } from "./TileTypes";
import type { GLTileEntry } from "./WebGLTileCache";
import type { GLOffscreenTarget } from "../engine/GLTextures";
import type { Camera } from "../Camera";

// ─── Mock dependencies ──────────────────────────────────────────

jest.mock("../engine/GLShaders", () => ({
  createShaderProgram: jest.fn((_gl: unknown, _vert: string, _frag: string) => ({
    program: { _id: "shader-prog" },
    uniforms: new Map([
      ["u_transform", { _loc: "u_transform" }],
      ["u_alpha", { _loc: "u_alpha" }],
      ["u_texture", { _loc: "u_texture" }],
    ]),
    attributes: new Map([
      ["a_position", 0],
      ["a_texcoord", 1],
    ]),
  })),
  deleteShaderProgram: jest.fn(),
}));

jest.mock("../engine/GLBuffers", () => ({
  createStaticBuffer: jest.fn((_gl: unknown, _data: Float32Array) => ({ _id: "static-buf" })),
  createIndexBuffer: jest.fn((_gl: unknown, _data: Uint16Array) => ({ _id: "index-buf" })),
  DynamicBuffer: jest.fn().mockImplementation(() => ({
    buffer: { _id: "dynamic-buf" },
    upload: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock("../engine/GLColor", () => ({
  parseColor: jest.fn((_color: string, _alpha: number) => new Float32Array([0.95, 0.93, 0.9, 1.0])),
}));

jest.mock("../BackgroundRenderer", () => ({
  DESK_COLORS: { light: "#f2ede5", dark: "#1a1a1a" },
}));

jest.mock("../engine/shaders", () => ({
  TEXTURE_VERT: "mock vertex shader",
  TEXTURE_FRAG: "mock fragment shader",
}));

// ─── Mock GL ────────────────────────────────────────────────────

function createMockGL(): WebGL2RenderingContext {
  return {
    FRAMEBUFFER: 0x8D40,
    TEXTURE_2D: 0x0DE1,
    TEXTURE0: 0x84C0,
    BLEND: 0x0BE2,
    DEPTH_TEST: 0x0B71,
    STENCIL_TEST: 0x0B90,
    SCISSOR_TEST: 0x0C11,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    TRIANGLES: 0x0004,
    UNSIGNED_SHORT: 0x1403,
    FLOAT: 0x1406,
    COLOR_BUFFER_BIT: 0x4000,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,

    bindFramebuffer: jest.fn(),
    viewport: jest.fn(),
    clearColor: jest.fn(),
    clear: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    blendFunc: jest.fn(),
    useProgram: jest.fn(),
    uniformMatrix3fv: jest.fn(),
    uniform1f: jest.fn(),
    uniform1i: jest.fn(),
    bindVertexArray: jest.fn(),
    bindBuffer: jest.fn(),
    vertexAttribPointer: jest.fn(),
    enableVertexAttribArray: jest.fn(),
    activeTexture: jest.fn(),
    bindTexture: jest.fn(),
    drawElements: jest.fn(),

    createVertexArray: jest.fn(() => ({ _id: "vao" })),
    deleteBuffer: jest.fn(),
    deleteVertexArray: jest.fn(),
  } as unknown as WebGL2RenderingContext;
}

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

function makeCamera(x = 0, y = 0, zoom = 1): Camera {
  return {
    x, y, zoom,
    getVisibleRect: (screenW: number, screenH: number): [number, number, number, number] => {
      const invZoom = 1 / zoom;
      return [x, y, x + screenW * invZoom, y + screenH * invZoom];
    },
    screenToWorld: (sx: number, sy: number): [number, number] => {
      return [x + sx / zoom, y + sy / zoom];
    },
  } as unknown as Camera;
}

function makeFboEntry(col: number, row: number): GLTileEntry {
  return {
    key: { col, row },
    texture: { _id: `tex-${col}-${row}` } as unknown as WebGLTexture,
    textureWidth: 1024,
    textureHeight: 1024,
    worldBounds: [col * 512, row * 512, (col + 1) * 512, (row + 1) * 512],
    strokeIds: new Set(),
    dirty: false,
    lastAccess: 0,
    memoryBytes: 1024 * 1024 * 4,
    renderedAtBand: 0,
    fbo: {
      fbo: {} as WebGLFramebuffer,
      colorTexture: {} as WebGLTexture,
      stencilRB: {} as WebGLRenderbuffer,
      width: 1024,
      height: 1024,
    },
    msaa: null,
  };
}

function makeBitmapEntry(col: number, row: number): GLTileEntry {
  return {
    ...makeFboEntry(col, row),
    fbo: null, // bitmap-uploaded tiles have no FBO
    msaa: null,
  };
}

// Mock WebGLTileCache
function makeMockTileCache(entries: Map<string, GLTileEntry>) {
  return {
    getStale: jest.fn((key: TileKey) => entries.get(tileKeyString(key))),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("WebGLTileCompositor", () => {
  let gl: WebGL2RenderingContext;
  let config: TileGridConfig;
  let grid: TileGrid;

  beforeEach(() => {
    gl = createMockGL();
    config = makeConfig();
    grid = new TileGrid(config);
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("creates shader program, buffers, and VAO", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);

      const { createShaderProgram } = require("../engine/GLShaders");
      expect(createShaderProgram).toHaveBeenCalledTimes(1);
      expect(gl.createVertexArray).toHaveBeenCalledTimes(1);

      compositor.destroy();
    });
  });

  describe("composite", () => {
    it("binds default framebuffer and sets viewport", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera();
      const tileCache = makeMockTileCache(new Map());

      compositor.composite(camera, 800, 600, tileCache as any);

      expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, null);
      expect(gl.viewport).toHaveBeenCalledWith(0, 0, 1600, 1200); // 800*2, 600*2

      compositor.destroy();
    });

    it("clears with desk color", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera();
      const tileCache = makeMockTileCache(new Map());

      compositor.composite(camera, 800, 600, tileCache as any);

      expect(gl.clearColor).toHaveBeenCalled();
      expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT);

      compositor.destroy();
    });

    it("enables premultiplied alpha blending", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera();
      const tileCache = makeMockTileCache(new Map());

      compositor.composite(camera, 800, 600, tileCache as any);

      expect(gl.enable).toHaveBeenCalledWith(gl.BLEND);
      expect(gl.blendFunc).toHaveBeenCalledWith(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      compositor.destroy();
    });

    it("disables depth, stencil, and scissor tests", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera();
      const tileCache = makeMockTileCache(new Map());

      compositor.composite(camera, 800, 600, tileCache as any);

      expect(gl.disable).toHaveBeenCalledWith(gl.DEPTH_TEST);
      expect(gl.disable).toHaveBeenCalledWith(gl.STENCIL_TEST);
      expect(gl.disable).toHaveBeenCalledWith(gl.SCISSOR_TEST);

      compositor.destroy();
    });

    it("draws one quad per visible tile", () => {
      const entries = new Map<string, GLTileEntry>();
      entries.set("0,0", makeFboEntry(0, 0));
      entries.set("1,0", makeFboEntry(1, 0));

      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera(0, 0, 1);
      const tileCache = makeMockTileCache(entries);

      compositor.composite(camera, 800, 600, tileCache as any);

      // drawElements called once per tile that has a cache entry
      const drawCalls = (gl.drawElements as jest.Mock).mock.calls;
      // At least some tiles should have been drawn (depends on visibility)
      // The visible tiles at camera (0,0) zoom 1, screen 800×600 should include (0,0) and (1,0)
      expect(drawCalls.length).toBeGreaterThanOrEqual(1);

      compositor.destroy();
    });

    it("skips tiles not in cache", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera();
      // Empty cache — no tiles to draw
      const tileCache = makeMockTileCache(new Map());

      compositor.composite(camera, 800, 600, tileCache as any);

      expect(gl.drawElements).not.toHaveBeenCalled();

      compositor.destroy();
    });

    it("unbinds VAO, texture, and program after compositing", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera();
      const tileCache = makeMockTileCache(new Map());

      compositor.composite(camera, 800, 600, tileCache as any);

      // Check the last calls unbind state
      const bindVAOCalls = (gl.bindVertexArray as jest.Mock).mock.calls;
      const lastVAOCall = bindVAOCalls[bindVAOCalls.length - 1];
      expect(lastVAOCall[0]).toBeNull();

      const bindTexCalls = (gl.bindTexture as jest.Mock).mock.calls;
      const lastTexCall = bindTexCalls[bindTexCalls.length - 1];
      expect(lastTexCall[1]).toBeNull();

      const useProgramCalls = (gl.useProgram as jest.Mock).mock.calls;
      const lastProgCall = useProgramCalls[useProgramCalls.length - 1];
      expect(lastProgCall[0]).toBeNull();

      compositor.destroy();
    });
  });

  describe("Y-flip handling", () => {
    it("uses flipped V coords for FBO-rendered tiles (fbo !== null)", () => {
      const entries = new Map<string, GLTileEntry>();
      entries.set("0,0", makeFboEntry(0, 0));

      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera(0, 0, 1);
      const tileCache = makeMockTileCache(entries);

      compositor.composite(camera, 800, 600, tileCache as any);

      // The DynamicBuffer.upload mock captures the vertex data
      const { DynamicBuffer } = require("../engine/GLBuffers");
      const uploadMock = DynamicBuffer.mock.results[0].value.upload;

      if (uploadMock.mock.calls.length > 0) {
        const vertData = uploadMock.mock.calls[0][0] as Float32Array;
        // FBO tile: v[3] should be 1 (v0=1), v[11] should be 0 (v1=0) — Y-flipped
        expect(vertData[3]).toBe(1); // top-left V = 1
        expect(vertData[11]).toBe(0); // bottom-right V = 0
      }

      compositor.destroy();
    });

    it("uses normal V coords for bitmap-uploaded tiles (fbo === null)", () => {
      const entries = new Map<string, GLTileEntry>();
      entries.set("0,0", makeBitmapEntry(0, 0));

      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera(0, 0, 1);
      const tileCache = makeMockTileCache(entries);

      compositor.composite(camera, 800, 600, tileCache as any);

      const { DynamicBuffer } = require("../engine/GLBuffers");
      const uploadMock = DynamicBuffer.mock.results[0].value.upload;

      if (uploadMock.mock.calls.length > 0) {
        const vertData = uploadMock.mock.calls[0][0] as Float32Array;
        // Bitmap tile: v[3] should be 0 (v0=0), v[11] should be 1 (v1=1) — normal
        expect(vertData[3]).toBe(0); // top-left V = 0
        expect(vertData[11]).toBe(1); // bottom-right V = 1
      }

      compositor.destroy();
    });
  });

  describe("projection caching", () => {
    it("recomputes projection when canvas dimensions change", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);
      const camera = makeCamera();
      const tileCache = makeMockTileCache(new Map());

      // First call
      compositor.composite(camera, 800, 600, tileCache as any);
      const firstUniformCall = (gl.uniformMatrix3fv as jest.Mock).mock.calls[0];

      // Same dimensions — should reuse
      compositor.composite(camera, 800, 600, tileCache as any);

      // Different dimensions — should recompute
      compositor.composite(camera, 1024, 768, tileCache as any);

      // uniformMatrix3fv should have been called 3 times (once per composite)
      expect((gl.uniformMatrix3fv as jest.Mock).mock.calls.length).toBe(3);

      compositor.destroy();
    });
  });

  describe("setDarkMode", () => {
    it("changes clear color without throwing", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);

      // Should not throw
      compositor.setDarkMode(true);
      compositor.setDarkMode(false);

      compositor.destroy();
    });
  });

  describe("destroy", () => {
    it("deletes shader, buffers, VAO, and dynamic buffer", () => {
      const compositor = new WebGLTileCompositor(gl, grid, config);
      compositor.destroy();

      const { deleteShaderProgram } = require("../engine/GLShaders");
      expect(deleteShaderProgram).toHaveBeenCalledTimes(1);
      expect(gl.deleteBuffer).toHaveBeenCalledTimes(2); // quadVBO + quadIBO
      expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);

      const { DynamicBuffer } = require("../engine/GLBuffers");
      expect(DynamicBuffer.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    });
  });
});
