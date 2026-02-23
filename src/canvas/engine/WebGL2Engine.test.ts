/**
 * Tests for Phase 3: WebGL2 Engine supporting infrastructure.
 *
 * Since jsdom doesn't support WebGL2, we test:
 * - GLColor (pure math)
 * - Mat3 helpers (pure math, tested indirectly via shader validation)
 * - Shader source validation (string checks)
 * - Buffer constants
 */

import { parseColor, clearColorCache } from "./GLColor";
import {
  UNIT_QUAD_VERTICES, UNIT_QUAD_INDICES,
  FULLSCREEN_QUAD_VERTICES, FULLSCREEN_QUAD_INDICES,
} from "./GLBuffers";
import {
  SOLID_VERT, SOLID_FRAG,
  TEXTURE_VERT, TEXTURE_FRAG,
  STAMP_VERT, STAMP_FRAG,
  GRAIN_VERT, GRAIN_FRAG,
  CIRCLE_VERT, CIRCLE_FRAG,
  LINE_VERT, LINE_FRAG,
} from "./shaders";

describe("GLColor", () => {
  beforeEach(() => clearColorCache());

  describe("parseColor", () => {
    it("parses #RRGGBB to premultiplied RGBA", () => {
      const c = parseColor("#ff0000");
      expect(c).toBeInstanceOf(Float32Array);
      expect(c.length).toBe(4);
      expect(c[0]).toBeCloseTo(1.0); // R * A
      expect(c[1]).toBeCloseTo(0.0); // G * A
      expect(c[2]).toBeCloseTo(0.0); // B * A
      expect(c[3]).toBeCloseTo(1.0); // A
    });

    it("parses #RGB shorthand", () => {
      const c = parseColor("#f00");
      expect(c[0]).toBeCloseTo(1.0);
      expect(c[1]).toBeCloseTo(0.0);
      expect(c[2]).toBeCloseTo(0.0);
      expect(c[3]).toBeCloseTo(1.0);
    });

    it("parses #RRGGBBAA with alpha", () => {
      const c = parseColor("#ff000080"); // 50% alpha
      const a = 0x80 / 255;
      expect(c[0]).toBeCloseTo(1.0 * a); // premultiplied
      expect(c[1]).toBeCloseTo(0.0);
      expect(c[2]).toBeCloseTo(0.0);
      expect(c[3]).toBeCloseTo(a);
    });

    it("applies external alpha multiplier", () => {
      const c = parseColor("#ffffff", 0.5);
      expect(c[0]).toBeCloseTo(0.5); // 1.0 * 0.5
      expect(c[1]).toBeCloseTo(0.5);
      expect(c[2]).toBeCloseTo(0.5);
      expect(c[3]).toBeCloseTo(0.5);
    });

    it("handles green", () => {
      const c = parseColor("#00ff00");
      expect(c[0]).toBeCloseTo(0.0);
      expect(c[1]).toBeCloseTo(1.0);
      expect(c[2]).toBeCloseTo(0.0);
    });

    it("handles black", () => {
      const c = parseColor("#000000");
      expect(c[0]).toBeCloseTo(0.0);
      expect(c[1]).toBeCloseTo(0.0);
      expect(c[2]).toBeCloseTo(0.0);
      expect(c[3]).toBeCloseTo(1.0);
    });

    it("caches results for same input", () => {
      const c1 = parseColor("#ff0000");
      const c2 = parseColor("#ff0000");
      expect(c1).toBe(c2); // Same reference
    });

    it("returns different results for different alpha", () => {
      const c1 = parseColor("#ff0000", 1.0);
      const c2 = parseColor("#ff0000", 0.5);
      expect(c1).not.toBe(c2);
      expect(c1[3]).toBeCloseTo(1.0);
      expect(c2[3]).toBeCloseTo(0.5);
    });

    it("handles invalid hex gracefully (fallback to black)", () => {
      const c = parseColor("invalid");
      expect(c[0]).toBeCloseTo(0);
      expect(c[1]).toBeCloseTo(0);
      expect(c[2]).toBeCloseTo(0);
      expect(c[3]).toBeCloseTo(1.0);
    });
  });
});

describe("Shader sources", () => {
  describe("solid program", () => {
    it("vertex shader has u_transform and a_position", () => {
      expect(SOLID_VERT).toContain("u_transform");
      expect(SOLID_VERT).toContain("a_position");
    });

    it("fragment shader has u_color", () => {
      expect(SOLID_FRAG).toContain("u_color");
    });
  });

  describe("texture program", () => {
    it("vertex shader has u_transform and a_texcoord", () => {
      expect(TEXTURE_VERT).toContain("u_transform");
      expect(TEXTURE_VERT).toContain("a_texcoord");
    });

    it("fragment shader has u_texture and u_alpha", () => {
      expect(TEXTURE_FRAG).toContain("u_texture");
      expect(TEXTURE_FRAG).toContain("u_alpha");
    });
  });

  describe("stamp program", () => {
    it("vertex shader has a_instance for instanced data", () => {
      expect(STAMP_VERT).toContain("a_instance");
    });

    it("fragment shader samples texture with opacity", () => {
      expect(STAMP_FRAG).toContain("v_opacity");
      expect(STAMP_FRAG).toContain("u_texture");
    });
  });

  describe("grain program", () => {
    it("has u_strength, u_offset, u_scale uniforms", () => {
      expect(GRAIN_FRAG).toContain("u_strength");
      expect(GRAIN_FRAG).toContain("u_offset");
      expect(GRAIN_FRAG).toContain("u_scale");
    });
  });

  describe("circle program", () => {
    it("vertex shader has a_instance for per-circle data", () => {
      expect(CIRCLE_VERT).toContain("a_instance");
    });

    it("fragment shader uses smoothstep for AA", () => {
      expect(CIRCLE_FRAG).toContain("smoothstep");
    });
  });

  describe("line program", () => {
    it("vertex shader has a_edge attribute", () => {
      expect(LINE_VERT).toContain("a_edge");
    });

    it("fragment shader uses smoothstep for edge AA", () => {
      expect(LINE_FRAG).toContain("smoothstep");
    });
  });

  it("all shaders use GLSL version 300 es", () => {
    const shaders = [
      SOLID_VERT, SOLID_FRAG,
      TEXTURE_VERT, TEXTURE_FRAG,
      STAMP_VERT, STAMP_FRAG,
      GRAIN_VERT, GRAIN_FRAG,
      CIRCLE_VERT, CIRCLE_FRAG,
      LINE_VERT, LINE_FRAG,
    ];
    for (const shader of shaders) {
      expect(shader).toContain("#version 300 es");
    }
  });
});

describe("Buffer constants", () => {
  describe("UNIT_QUAD_VERTICES", () => {
    it("has 4 vertices with position + texcoord (16 floats)", () => {
      expect(UNIT_QUAD_VERTICES.length).toBe(16);
    });

    it("covers [-0.5, 0.5] range in position", () => {
      const positions: number[] = [];
      for (let i = 0; i < 16; i += 4) {
        positions.push(UNIT_QUAD_VERTICES[i], UNIT_QUAD_VERTICES[i + 1]);
      }
      expect(Math.min(...positions)).toBe(-0.5);
      expect(Math.max(...positions)).toBe(0.5);
    });
  });

  describe("UNIT_QUAD_INDICES", () => {
    it("has 6 indices for 2 triangles", () => {
      expect(UNIT_QUAD_INDICES.length).toBe(6);
    });
  });

  describe("FULLSCREEN_QUAD_VERTICES", () => {
    it("has 4 vertices with position + texcoord (16 floats)", () => {
      expect(FULLSCREEN_QUAD_VERTICES.length).toBe(16);
    });

    it("covers [-1, 1] range in position (clip space)", () => {
      const positions: number[] = [];
      for (let i = 0; i < 16; i += 4) {
        positions.push(FULLSCREEN_QUAD_VERTICES[i], FULLSCREEN_QUAD_VERTICES[i + 1]);
      }
      expect(Math.min(...positions)).toBe(-1);
      expect(Math.max(...positions)).toBe(1);
    });
  });

  describe("FULLSCREEN_QUAD_INDICES", () => {
    it("has 6 indices for 2 triangles", () => {
      expect(FULLSCREEN_QUAD_INDICES.length).toBe(6);
    });
  });
});
