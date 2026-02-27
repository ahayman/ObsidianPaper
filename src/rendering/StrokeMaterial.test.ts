import { resolveMaterial } from "./StrokeMaterial";
import type { StrokeMaterial } from "./StrokeMaterial";
import { PEN_CONFIGS } from "../stroke/PenConfigs";
import type { PenStyle } from "../types";

// ─── Style fixtures ─────────────────────────────────────────

const ballpointStyle: PenStyle = {
  pen: "ballpoint", color: "#1a1a1a", width: 2, opacity: 1,
  smoothing: 0.5, pressureCurve: 1, tiltSensitivity: 0,
};

const feltTipStyle: PenStyle = {
  pen: "felt-tip", color: "#333333", width: 6, opacity: 1,
  smoothing: 0.5, pressureCurve: 1, tiltSensitivity: 0,
};

const pencilStyle: PenStyle = {
  pen: "pencil", color: "#2d2d2d", width: 3, opacity: 0.85,
  smoothing: 0.4, pressureCurve: 1, tiltSensitivity: 0, grain: 0.5,
};

const fountainItalicStyle: PenStyle = {
  pen: "fountain", color: "#000000", width: 6, opacity: 1,
  smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0,
  nibAngle: Math.PI / 6, nibThickness: 0.25, inkPreset: "standard",
};

// Note: All current ink presets have shading > 0, so fountain pen in
// advanced/LOD 0 always resolves to inkShading body. The "no shading"
// code path is a fallback for future presets with shading ≤ 0.

// Fountain pen without explicit nibAngle — still gets inkShading because
// all presets have shading > 0 (getInkPreset(undefined) returns "standard").
const fountainNoNibStyle: PenStyle = {
  pen: "fountain", color: "#000000", width: 6, opacity: 1,
  smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0,
};

const highlighterStyle: PenStyle = {
  pen: "highlighter", color: "#FFD700", width: 24, opacity: 0.3,
  smoothing: 0.8, pressureCurve: 1, tiltSensitivity: 0,
};

// ─── Tests ──────────────────────────────────────────────────

describe("resolveMaterial", () => {
  describe("highlighter", () => {
    const config = PEN_CONFIGS.highlighter;

    it("uses multiply blend regardless of pipeline", () => {
      const basic = resolveMaterial(config, highlighterStyle, "basic", 0);
      const adv = resolveMaterial(config, highlighterStyle, "advanced", 0);
      expect(basic.blending).toBe("multiply");
      expect(adv.blending).toBe("multiply");
    });

    it("uses fill body with baseOpacity", () => {
      const m = resolveMaterial(config, highlighterStyle, "basic", 0);
      expect(m.body.type).toBe("fill");
      expect(m.bodyOpacity).toBe(0.3); // penConfig.baseOpacity
      expect(m.isolation).toBe(false);
      expect(m.effects).toEqual([]);
    });

    it("same at any LOD", () => {
      const lod0 = resolveMaterial(config, highlighterStyle, "basic", 0);
      const lod3 = resolveMaterial(config, highlighterStyle, "basic", 3);
      expect(lod0).toEqual(lod3);
    });
  });

  describe("ballpoint", () => {
    const config = PEN_CONFIGS.ballpoint;

    it("basic: simple fill", () => {
      const m = resolveMaterial(config, ballpointStyle, "basic", 0);
      expect(m).toEqual({
        body: { type: "fill" },
        blending: "source-over",
        bodyOpacity: 1,
        isolation: false,
        effects: [],
      });
    });

    it("advanced LOD 0: same (no stamps/grain)", () => {
      const m = resolveMaterial(config, ballpointStyle, "advanced", 0);
      expect(m.body.type).toBe("fill");
      expect(m.isolation).toBe(false);
    });

    it("advanced LOD 3: same", () => {
      const m = resolveMaterial(config, ballpointStyle, "advanced", 3);
      expect(m.body.type).toBe("fill");
    });
  });

  describe("felt-tip", () => {
    const config = PEN_CONFIGS["felt-tip"];

    it("basic: simple fill", () => {
      const m = resolveMaterial(config, feltTipStyle, "basic", 0);
      expect(m.body.type).toBe("fill");
      expect(m.blending).toBe("source-over");
    });

    it("advanced LOD 0: same (no stamps/grain)", () => {
      const m = resolveMaterial(config, feltTipStyle, "advanced", 0);
      expect(m.body.type).toBe("fill");
      expect(m.effects).toEqual([]);
    });
  });

  describe("pencil", () => {
    const config = PEN_CONFIGS.pencil;

    it("advanced LOD 0: stampDiscs body", () => {
      const m = resolveMaterial(config, pencilStyle, "advanced", 0);
      expect(m.body.type).toBe("stampDiscs");
      expect(m.blending).toBe("source-over");
      expect(m.bodyOpacity).toBe(0.85);
      expect(m.isolation).toBe(false);
      expect(m.effects).toEqual([]);
    });

    it("basic LOD 0: simple fill (no stamps in basic)", () => {
      const m = resolveMaterial(config, pencilStyle, "basic", 0);
      expect(m.body.type).toBe("fill");
      expect(m.effects).toEqual([]);
    });

    it("advanced LOD 1+: simple fill (stamps only at LOD 0)", () => {
      const m = resolveMaterial(config, pencilStyle, "advanced", 1);
      expect(m.body.type).toBe("fill");
    });
  });

  describe("fountain", () => {
    const config = PEN_CONFIGS.fountain;

    it("advanced LOD 0 with ink shading: inkShading body + outlineMask", () => {
      const m = resolveMaterial(config, fountainItalicStyle, "advanced", 0);
      expect(m.body.type).toBe("inkShading");
      expect(m.isolation).toBe(true);
      expect(m.effects).toEqual([{ type: "outlineMask" }]);
    });

    it("advanced LOD 0 without explicit nib still gets inkShading (default preset has shading)", () => {
      // getInkPreset(undefined) returns "standard" which has shading > 0
      const m = resolveMaterial(config, fountainNoNibStyle, "advanced", 0);
      expect(m.body.type).toBe("inkShading");
      expect(m.isolation).toBe(true);
      expect(m.effects).toEqual([{ type: "outlineMask" }]);
    });

    it("basic: simple fill regardless of ink settings", () => {
      const m = resolveMaterial(config, fountainItalicStyle, "basic", 0);
      expect(m.body.type).toBe("fill");
      expect(m.effects).toEqual([]);
    });

    it("advanced LOD 2: simple fill", () => {
      const m = resolveMaterial(config, fountainItalicStyle, "advanced", 2);
      expect(m.body.type).toBe("fill");
      expect(m.effects).toEqual([]);
    });
  });

  describe("all pens at high LOD produce simple fill", () => {
    const pens = [
      { config: PEN_CONFIGS.ballpoint, style: ballpointStyle },
      { config: PEN_CONFIGS["felt-tip"], style: feltTipStyle },
      { config: PEN_CONFIGS.pencil, style: pencilStyle },
      { config: PEN_CONFIGS.fountain, style: fountainItalicStyle },
    ] as const;

    for (const { config, style } of pens) {
      for (const lod of [1, 2, 3] as const) {
        it(`${config.type} at LOD ${lod}: fill body, no effects`, () => {
          const m = resolveMaterial(config, style, "advanced", lod);
          expect(m.body.type).toBe("fill");
          expect(m.blending).toBe("source-over");
          expect(m.isolation).toBe(false);
          expect(m.effects).toEqual([]);
        });
      }
    }
  });
});
