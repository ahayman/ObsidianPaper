/**
 * Unit tests for MSAAResolver — shared MSAA scratch target for tile rendering.
 *
 * Mocks WebGL2RenderingContext since jsdom doesn't support WebGL2.
 */

import { MSAAResolver } from "./MSAAResolver";

// ─── Mock WebGL2 ────────────────────────────────────────────────

function createMockExt() {
  return {
    framebufferTexture2DMultisampleEXT: jest.fn(),
    renderbufferStorageMultisampleEXT: jest.fn(),
  };
}

function createMockGL(overrides?: Record<string, unknown>): WebGL2RenderingContext {
  return {
    MAX_SAMPLES: 0x8D57,
    RENDERBUFFER: 0x8D41,
    RGBA8: 0x8058,
    STENCIL_INDEX8: 0x8D48,
    FRAMEBUFFER: 0x8D40,
    DRAW_FRAMEBUFFER: 0x8CA9,
    READ_FRAMEBUFFER: 0x8CA8,
    COLOR_ATTACHMENT0: 0x8CE0,
    STENCIL_ATTACHMENT: 0x8D20,
    TEXTURE_2D: 0x0DE1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    COLOR_BUFFER_BIT: 0x4000,
    NEAREST: 0x2600,
    FRAMEBUFFER_COMPLETE: 0x8CD5,

    getParameter: jest.fn(() => 4), // MAX_SAMPLES
    getExtension: jest.fn(() => null),
    createFramebuffer: jest.fn(() => ({})),
    deleteFramebuffer: jest.fn(),
    bindFramebuffer: jest.fn(),
    createRenderbuffer: jest.fn(() => ({})),
    deleteRenderbuffer: jest.fn(),
    bindRenderbuffer: jest.fn(),
    renderbufferStorageMultisample: jest.fn(),
    framebufferRenderbuffer: jest.fn(),
    framebufferTexture2D: jest.fn(),
    createTexture: jest.fn(() => ({})),
    deleteTexture: jest.fn(),
    bindTexture: jest.fn(),
    texImage2D: jest.fn(),
    checkFramebufferStatus: jest.fn(() => 0x8CD5), // FRAMEBUFFER_COMPLETE
    viewport: jest.fn(),
    blitFramebuffer: jest.fn(),
    ...overrides,
  } as unknown as WebGL2RenderingContext;
}

// ─── Tests ──────────────────────────────────────────────────────

describe("MSAAResolver", () => {
  describe("mode selection", () => {
    it("uses explicit mode when the extension is absent", () => {
      const gl = createMockGL();
      const resolver = new MSAAResolver(gl, 1024);

      expect(resolver.mode).toBe("explicit");
      // Explicit mode allocates multisampled colour + stencil renderbuffers.
      expect(gl.renderbufferStorageMultisample).toHaveBeenCalledTimes(2);
    });

    it("uses implicit mode when the extension is present and complete", () => {
      const gl = createMockGL({ getExtension: jest.fn(() => createMockExt()) });
      const resolver = new MSAAResolver(gl, 1024);

      expect(resolver.mode).toBe("implicit");
    });

    it("falls back to explicit when the implicit probe is incomplete", () => {
      const gl = createMockGL({
        getExtension: jest.fn(() => createMockExt()),
        checkFramebufferStatus: jest.fn(() => 0), // not FRAMEBUFFER_COMPLETE
      });
      const resolver = new MSAAResolver(gl, 1024);

      expect(resolver.mode).toBe("explicit");
    });

    it("falls back to explicit when the extension lacks required methods", () => {
      const gl = createMockGL({ getExtension: jest.fn(() => ({})) });
      const resolver = new MSAAResolver(gl, 1024);

      expect(resolver.mode).toBe("explicit");
    });
  });

  describe("sample count", () => {
    it("clamps requested samples to MAX_SAMPLES", () => {
      const gl = createMockGL({ getParameter: jest.fn(() => 2) });
      const resolver = new MSAAResolver(gl, 1024, 4);

      expect(resolver.samples).toBe(2);
    });

    it("uses the requested samples when below MAX_SAMPLES", () => {
      const gl = createMockGL({ getParameter: jest.fn(() => 8) });
      const resolver = new MSAAResolver(gl, 1024, 4);

      expect(resolver.samples).toBe(4);
    });
  });

  describe("explicit mode", () => {
    it("beginTile binds a framebuffer and sets the viewport", () => {
      const gl = createMockGL();
      const resolver = new MSAAResolver(gl, 1024);
      (gl.bindFramebuffer as jest.Mock).mockClear();

      resolver.beginTile({} as WebGLTexture, 512, 256);

      expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, expect.anything());
      expect(gl.viewport).toHaveBeenCalledWith(0, 0, 512, 256);
    });

    it("endTile resolves into the tile texture via blitFramebuffer", () => {
      const gl = createMockGL();
      const resolver = new MSAAResolver(gl, 1024);
      const texture = {} as WebGLTexture;

      resolver.beginTile(texture, 512, 512);
      resolver.endTile(texture, 512, 512);

      // Tile texture is pointed at the resolve FBO, then the MSAA buffer blits in.
      expect(gl.framebufferTexture2D).toHaveBeenCalledWith(
        gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
      );
      expect(gl.blitFramebuffer).toHaveBeenCalledWith(
        0, 0, 512, 512, 0, 0, 512, 512, gl.COLOR_BUFFER_BIT, gl.NEAREST,
      );
    });
  });

  describe("implicit mode", () => {
    it("beginTile attaches the tile texture via the extension", () => {
      const ext = createMockExt();
      const gl = createMockGL({ getExtension: jest.fn(() => ext) });
      const resolver = new MSAAResolver(gl, 1024);
      expect(resolver.mode).toBe("implicit");
      ext.framebufferTexture2DMultisampleEXT.mockClear();

      const texture = {} as WebGLTexture;
      resolver.beginTile(texture, 256, 256);

      expect(ext.framebufferTexture2DMultisampleEXT).toHaveBeenCalledWith(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0, resolver.samples,
      );
    });

    it("endTile does not blit — the resolve is implicit", () => {
      const gl = createMockGL({ getExtension: jest.fn(() => createMockExt()) });
      const resolver = new MSAAResolver(gl, 1024);
      const texture = {} as WebGLTexture;

      resolver.beginTile(texture, 512, 512);
      resolver.endTile(texture, 512, 512);

      expect(gl.blitFramebuffer).not.toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("releases GL resources", () => {
      const gl = createMockGL();
      const resolver = new MSAAResolver(gl, 1024);

      resolver.destroy();

      expect(gl.deleteFramebuffer).toHaveBeenCalled();
      expect(gl.deleteRenderbuffer).toHaveBeenCalled();
    });
  });
});
