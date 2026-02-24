/**
 * Unit tests for GLState — WebGL state tracker.
 *
 * Verifies:
 * - State deduplication (skips redundant GL calls)
 * - reset() invalidates all cached state
 * - Blend mode, stencil, texture, VAO, FBO tracking
 */

import { GLState } from "./GLState";

// ─── Mock GL ────────────────────────────────────────────────────

function createMockGL() {
  return {
    TEXTURE_2D: 0x0DE1,
    TEXTURE0: 0x84C0,
    FRAMEBUFFER: 0x8D40,
    STENCIL_TEST: 0x0B90,
    ONE: 1,
    ZERO: 0,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    SRC_ALPHA: 0x0302,
    DST_COLOR: 0x0306,

    useProgram: jest.fn(),
    bindVertexArray: jest.fn(),
    activeTexture: jest.fn(),
    bindTexture: jest.fn(),
    bindFramebuffer: jest.fn(),
    blendFunc: jest.fn(),
    blendFuncSeparate: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
  } as unknown as WebGL2RenderingContext;
}

// ─── Tests ──────────────────────────────────────────────────────

describe("GLState", () => {
  let gl: ReturnType<typeof createMockGL>;
  let state: GLState;

  beforeEach(() => {
    gl = createMockGL();
    state = new GLState(gl as any);
  });

  describe("useProgram", () => {
    it("calls gl.useProgram on first use", () => {
      const prog = {} as WebGLProgram;
      const changed = state.useProgram(prog);

      expect(changed).toBe(true);
      expect(gl.useProgram).toHaveBeenCalledWith(prog);
    });

    it("skips redundant gl.useProgram for same program", () => {
      const prog = {} as WebGLProgram;
      state.useProgram(prog);
      (gl.useProgram as jest.Mock).mockClear();

      const changed = state.useProgram(prog);

      expect(changed).toBe(false);
      expect(gl.useProgram).not.toHaveBeenCalled();
    });

    it("calls gl.useProgram when switching programs", () => {
      const prog1 = { _id: 1 } as unknown as WebGLProgram;
      const prog2 = { _id: 2 } as unknown as WebGLProgram;

      state.useProgram(prog1);
      state.useProgram(prog2);

      expect(gl.useProgram).toHaveBeenCalledTimes(2);
      expect(gl.useProgram).toHaveBeenLastCalledWith(prog2);
    });
  });

  describe("bindVAO", () => {
    it("calls gl.bindVertexArray on first use", () => {
      const vao = {} as WebGLVertexArrayObject;
      const changed = state.bindVAO(vao);

      expect(changed).toBe(true);
      expect(gl.bindVertexArray).toHaveBeenCalledWith(vao);
    });

    it("skips redundant bind for same VAO", () => {
      const vao = {} as WebGLVertexArrayObject;
      state.bindVAO(vao);
      (gl.bindVertexArray as jest.Mock).mockClear();

      expect(state.bindVAO(vao)).toBe(false);
      expect(gl.bindVertexArray).not.toHaveBeenCalled();
    });

    it("tracks null VAO correctly", () => {
      state.bindVAO(null);
      (gl.bindVertexArray as jest.Mock).mockClear();

      expect(state.bindVAO(null)).toBe(false);
      expect(gl.bindVertexArray).not.toHaveBeenCalled();
    });
  });

  describe("bindTexture", () => {
    it("calls gl.bindTexture on first use", () => {
      const tex = {} as WebGLTexture;
      const changed = state.bindTexture(tex);

      expect(changed).toBe(true);
      expect(gl.activeTexture).toHaveBeenCalledWith(gl.TEXTURE0);
      expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_2D, tex);
    });

    it("skips redundant bind for same texture on unit 0", () => {
      const tex = {} as WebGLTexture;
      state.bindTexture(tex);
      (gl.bindTexture as jest.Mock).mockClear();
      (gl.activeTexture as jest.Mock).mockClear();

      expect(state.bindTexture(tex)).toBe(false);
      expect(gl.bindTexture).not.toHaveBeenCalled();
    });

    it("always binds for non-zero texture units (no caching)", () => {
      const tex = {} as WebGLTexture;
      state.bindTexture(tex, 1);
      (gl.bindTexture as jest.Mock).mockClear();

      // Same texture on unit 1 → not cached, should bind again
      expect(state.bindTexture(tex, 1)).toBe(true);
      expect(gl.bindTexture).toHaveBeenCalled();
    });

    it("tracks null texture", () => {
      state.bindTexture(null);
      (gl.bindTexture as jest.Mock).mockClear();

      expect(state.bindTexture(null)).toBe(false);
    });
  });

  describe("bindFramebuffer", () => {
    it("calls gl.bindFramebuffer on first use", () => {
      const fbo = {} as WebGLFramebuffer;
      const changed = state.bindFramebuffer(fbo);

      expect(changed).toBe(true);
      expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, fbo);
    });

    it("skips redundant bind", () => {
      const fbo = {} as WebGLFramebuffer;
      state.bindFramebuffer(fbo);
      (gl.bindFramebuffer as jest.Mock).mockClear();

      expect(state.bindFramebuffer(fbo)).toBe(false);
      expect(gl.bindFramebuffer).not.toHaveBeenCalled();
    });

    it("tracks null (default) framebuffer", () => {
      state.bindFramebuffer(null);
      (gl.bindFramebuffer as jest.Mock).mockClear();

      expect(state.bindFramebuffer(null)).toBe(false);
    });
  });

  describe("setBlendMode", () => {
    it("starts with source-over (default)", () => {
      // Setting source-over should be a no-op (already default)
      state.setBlendMode("source-over");
      expect(gl.blendFunc).not.toHaveBeenCalled();
    });

    it("changes to destination-in", () => {
      state.setBlendMode("destination-in");
      expect(gl.blendFunc).toHaveBeenCalledWith(gl.ZERO, gl.SRC_ALPHA);
    });

    it("changes to destination-out", () => {
      state.setBlendMode("destination-out");
      expect(gl.blendFunc).toHaveBeenCalledWith(gl.ZERO, (gl as any).ONE_MINUS_SRC_ALPHA);
    });

    it("changes to multiply (uses blendFuncSeparate)", () => {
      state.setBlendMode("multiply");
      expect(gl.blendFuncSeparate).toHaveBeenCalled();
    });

    it("skips redundant blend mode change", () => {
      state.setBlendMode("destination-in");
      (gl.blendFunc as jest.Mock).mockClear();

      state.setBlendMode("destination-in");
      expect(gl.blendFunc).not.toHaveBeenCalled();
    });
  });

  describe("stencil", () => {
    it("enables stencil test", () => {
      state.enableStencil();
      expect(gl.enable).toHaveBeenCalledWith(gl.STENCIL_TEST);
    });

    it("skips redundant enable", () => {
      state.enableStencil();
      (gl.enable as jest.Mock).mockClear();

      state.enableStencil();
      expect(gl.enable).not.toHaveBeenCalled();
    });

    it("disables stencil test", () => {
      state.enableStencil();
      state.disableStencil();
      expect(gl.disable).toHaveBeenCalledWith(gl.STENCIL_TEST);
    });

    it("skips redundant disable", () => {
      // Stencil starts disabled
      state.disableStencil();
      expect(gl.disable).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("forces re-bind of all state on next call", () => {
      const prog = {} as WebGLProgram;
      const vao = {} as WebGLVertexArrayObject;
      const tex = {} as WebGLTexture;
      const fbo = {} as WebGLFramebuffer;

      // Set up cached state
      state.useProgram(prog);
      state.bindVAO(vao);
      state.bindTexture(tex);
      state.bindFramebuffer(fbo);
      state.enableStencil();
      state.setBlendMode("destination-in");

      // Clear mock call counts
      (gl.useProgram as jest.Mock).mockClear();
      (gl.bindVertexArray as jest.Mock).mockClear();
      (gl.bindTexture as jest.Mock).mockClear();
      (gl.bindFramebuffer as jest.Mock).mockClear();
      (gl.blendFunc as jest.Mock).mockClear();
      (gl.enable as jest.Mock).mockClear();

      // Reset
      state.reset();

      // Now the same values should be treated as "new" (cache invalidated)
      expect(state.useProgram(prog)).toBe(true);
      expect(state.bindVAO(vao)).toBe(true);
      expect(state.bindTexture(tex)).toBe(true);
      expect(state.bindFramebuffer(fbo)).toBe(true);

      // Stencil was enabled, reset sets to disabled, so enableStencil triggers
      state.enableStencil();
      expect(gl.enable).toHaveBeenCalledWith(gl.STENCIL_TEST);

      // Blend was destination-in, reset sets to source-over, so setting source-over is no-op
      // but setting destination-in triggers change
      state.setBlendMode("destination-in");
      expect(gl.blendFunc).toHaveBeenCalled();
    });

    it("resets blend mode to source-over", () => {
      state.setBlendMode("destination-in");
      state.reset();

      // Setting source-over after reset should be a no-op (already default)
      (gl.blendFunc as jest.Mock).mockClear();
      state.setBlendMode("source-over");
      expect(gl.blendFunc).not.toHaveBeenCalled();
    });

    it("allows null bindings after reset without redundancy check", () => {
      // Bind something, then reset (resets to null), then bind null → should be no-op
      state.bindVAO({} as WebGLVertexArrayObject);
      state.reset();

      (gl.bindVertexArray as jest.Mock).mockClear();
      expect(state.bindVAO(null)).toBe(false); // Already null after reset
      expect(gl.bindVertexArray).not.toHaveBeenCalled();
    });
  });

  describe("compositor/engine coordination scenario", () => {
    it("simulates compositor bypassing GLState, then reset fixes stale caches", () => {
      const prog = {} as WebGLProgram;
      const vao = {} as WebGLVertexArrayObject;
      const tex = {} as WebGLTexture;

      // Engine sets state via GLState
      state.useProgram(prog);
      state.bindVAO(vao);
      state.bindTexture(tex);

      // Compositor uses raw gl.* calls (bypasses GLState)
      // This changes actual GL state but GLState doesn't know
      (gl as any).useProgram(null);   // Raw call
      (gl as any).bindVertexArray(null); // Raw call
      (gl as any).bindTexture(gl.TEXTURE_2D, null); // Raw call

      // GLState still thinks prog/vao/tex are bound → would skip re-bind
      (gl.useProgram as jest.Mock).mockClear();
      expect(state.useProgram(prog)).toBe(false); // BUG: skips because cache is stale

      // After reset, GLState knows nothing → forces re-bind
      state.reset();
      (gl.useProgram as jest.Mock).mockClear();
      expect(state.useProgram(prog)).toBe(true); // Correctly re-binds
      expect(gl.useProgram).toHaveBeenCalledWith(prog);
    });
  });
});
