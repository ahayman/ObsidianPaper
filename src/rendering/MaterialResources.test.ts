import {
  MaterialResourceManager,
  type GrainTextureProvider,
  type StampTextureProvider,
  type InkStampTextureProvider,
} from "./MaterialResources";
import type { TextureRef } from "./DrawingBackend";

// ─── Mock providers ─────────────────────────────────────────

function mockTexture(w = 256, h = 256): TextureRef {
  return { width: w, height: h };
}

function mockGrainProvider(texture: TextureRef | null = mockTexture()): GrainTextureProvider {
  return { getTexture: () => texture };
}

function mockStampProvider(): StampTextureProvider {
  return {
    getTexture: (color: string, grainValue: number) =>
      mockTexture(48, 48),
  };
}

function mockInkStampProvider(): InkStampTextureProvider {
  return {
    getTexture: (presetId: string | undefined, color: string) =>
      mockTexture(64, 64),
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe("MaterialResourceManager", () => {
  describe("grain texture registration", () => {
    it("returns null for unregistered texture id", () => {
      const mgr = new MaterialResourceManager();
      expect(mgr.getGrainTexture("nonexistent")).toBeNull();
    });

    it("returns texture from registered provider", () => {
      const mgr = new MaterialResourceManager();
      const tex = mockTexture(256, 256);
      mgr.registerGrainTexture("pencil-graphite", mockGrainProvider(tex));
      expect(mgr.getGrainTexture("pencil-graphite")).toBe(tex);
    });

    it("returns null when provider returns null (not initialized)", () => {
      const mgr = new MaterialResourceManager();
      mgr.registerGrainTexture("pencil-graphite", mockGrainProvider(null));
      expect(mgr.getGrainTexture("pencil-graphite")).toBeNull();
    });

    it("unregister removes provider", () => {
      const mgr = new MaterialResourceManager();
      mgr.registerGrainTexture("pencil-graphite", mockGrainProvider());
      mgr.unregisterGrainTexture("pencil-graphite");
      expect(mgr.getGrainTexture("pencil-graphite")).toBeNull();
    });

    it("supports multiple grain textures", () => {
      const mgr = new MaterialResourceManager();
      const tex1 = mockTexture(256, 256);
      const tex2 = mockTexture(512, 512);
      mgr.registerGrainTexture("pencil-graphite", mockGrainProvider(tex1));
      mgr.registerGrainTexture("custom-noise", mockGrainProvider(tex2));
      expect(mgr.getGrainTexture("pencil-graphite")).toBe(tex1);
      expect(mgr.getGrainTexture("custom-noise")).toBe(tex2);
    });
  });

  describe("stamp texture registration", () => {
    it("returns null for unregistered manager id", () => {
      const mgr = new MaterialResourceManager();
      expect(mgr.getStampTexture("nonexistent", "#000", 0.5)).toBeNull();
    });

    it("returns texture from registered provider", () => {
      const mgr = new MaterialResourceManager();
      mgr.registerStampManager("pencil-scatter", mockStampProvider());
      const tex = mgr.getStampTexture("pencil-scatter", "#ff0000", 0.35);
      expect(tex).not.toBeNull();
      expect(tex!.width).toBe(48);
    });

    it("passes color and grain value to provider", () => {
      const mgr = new MaterialResourceManager();
      const provider: StampTextureProvider = {
        getTexture: jest.fn().mockReturnValue(mockTexture()),
      };
      mgr.registerStampManager("pencil-scatter", provider);
      mgr.getStampTexture("pencil-scatter", "#00ff00", 0.7);
      expect(provider.getTexture).toHaveBeenCalledWith("#00ff00", 0.7);
    });

    it("unregister removes provider", () => {
      const mgr = new MaterialResourceManager();
      mgr.registerStampManager("pencil-scatter", mockStampProvider());
      mgr.unregisterStampManager("pencil-scatter");
      expect(mgr.getStampTexture("pencil-scatter", "#000", 0.5)).toBeNull();
    });
  });

  describe("ink stamp texture registration", () => {
    it("returns null for unregistered manager id", () => {
      const mgr = new MaterialResourceManager();
      expect(mgr.getInkStampTexture("nonexistent", "standard", "#000")).toBeNull();
    });

    it("returns texture from registered provider", () => {
      const mgr = new MaterialResourceManager();
      mgr.registerInkStampManager("ink-shading", mockInkStampProvider());
      const tex = mgr.getInkStampTexture("ink-shading", "standard", "#000");
      expect(tex).not.toBeNull();
      expect(tex!.width).toBe(64);
    });

    it("passes preset and color to provider", () => {
      const mgr = new MaterialResourceManager();
      const provider: InkStampTextureProvider = {
        getTexture: jest.fn().mockReturnValue(mockTexture()),
      };
      mgr.registerInkStampManager("ink-shading", provider);
      mgr.getInkStampTexture("ink-shading", "iron-gall", "#0000ff");
      expect(provider.getTexture).toHaveBeenCalledWith("iron-gall", "#0000ff");
    });

    it("handles undefined preset id", () => {
      const mgr = new MaterialResourceManager();
      const provider: InkStampTextureProvider = {
        getTexture: jest.fn().mockReturnValue(mockTexture()),
      };
      mgr.registerInkStampManager("ink-shading", provider);
      mgr.getInkStampTexture("ink-shading", undefined, "#000");
      expect(provider.getTexture).toHaveBeenCalledWith(undefined, "#000");
    });
  });

  describe("grain strength", () => {
    it("uses config strength when no override exists", () => {
      const mgr = new MaterialResourceManager();
      // grainToTextureStrength(0.5, 0.35) ≈ 0.5 * lerp(1.6, 0.2, 0.35) ≈ 0.5 * 1.11 ≈ 0.555
      const strength = mgr.getGrainStrength("pencil", 0.5, 0.35);
      expect(strength).toBeCloseTo(0.5 * (1.6 + (0.2 - 1.6) * 0.35), 4);
    });

    it("uses override strength when set", () => {
      const mgr = new MaterialResourceManager();
      mgr.setStrengthOverride("pencil", 0.8);
      const strength = mgr.getGrainStrength("pencil", 0.5, 0.35);
      // Should use 0.8 (override) instead of 0.5 (config)
      expect(strength).toBeCloseTo(0.8 * (1.6 + (0.2 - 1.6) * 0.35), 4);
    });

    it("clearStrengthOverride reverts to config", () => {
      const mgr = new MaterialResourceManager();
      mgr.setStrengthOverride("pencil", 0.8);
      mgr.clearStrengthOverride("pencil");
      const strength = mgr.getGrainStrength("pencil", 0.5, 0.35);
      expect(strength).toBeCloseTo(0.5 * (1.6 + (0.2 - 1.6) * 0.35), 4);
    });

    it("clamps result to [0, 1]", () => {
      const mgr = new MaterialResourceManager();
      // grainValue=0 → multiplier=1.6, strength 1.0 * 1.6 = 1.6 → clamped to 1.0
      expect(mgr.getGrainStrength("pencil", 1.0, 0)).toBe(1.0);
      // grainValue=1 → multiplier=0.2, strength 0.0 * 0.2 = 0 → clamped to 0.0
      expect(mgr.getGrainStrength("pencil", 0.0, 1)).toBe(0.0);
    });

    it("getStrengthOverrides returns current overrides", () => {
      const mgr = new MaterialResourceManager();
      mgr.setStrengthOverride("pencil", 0.7);
      mgr.setStrengthOverride("felt-tip", 0.3);
      const overrides = mgr.getStrengthOverrides();
      expect(overrides.get("pencil")).toBe(0.7);
      expect(overrides.get("felt-tip")).toBe(0.3);
      expect(overrides.size).toBe(2);
    });
  });

  describe("replaces provider on re-register", () => {
    it("grain texture uses latest provider", () => {
      const mgr = new MaterialResourceManager();
      const tex1 = mockTexture(256, 256);
      const tex2 = mockTexture(512, 512);
      mgr.registerGrainTexture("g", mockGrainProvider(tex1));
      mgr.registerGrainTexture("g", mockGrainProvider(tex2));
      expect(mgr.getGrainTexture("g")).toBe(tex2);
    });
  });
});
