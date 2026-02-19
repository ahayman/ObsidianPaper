import { PresetManager } from "./PresetManager";
import type { PenPreset, ToolbarState } from "./ToolbarTypes";

function makePreset(overrides: Partial<PenPreset> = {}): PenPreset {
  return {
    id: overrides.id ?? "test-1",
    name: overrides.name ?? "Test Preset",
    penType: overrides.penType ?? "ballpoint",
    colorId: overrides.colorId ?? "ink-black",
    width: overrides.width ?? 2,
    smoothing: overrides.smoothing ?? 0.3,
    ...overrides,
  };
}

function makeState(overrides: Partial<ToolbarState> = {}): ToolbarState {
  return {
    activeTool: "pen",
    activePresetId: null,
    penType: "ballpoint",
    colorId: "ink-black",
    width: 2,
    smoothing: 0.3,
    nibAngle: Math.PI / 6,
    nibThickness: 0.25,
    nibPressure: 0.5,
    ...overrides,
  };
}

describe("PresetManager", () => {
  describe("getPresets", () => {
    it("returns initial presets", () => {
      const initial = [makePreset({ id: "a" }), makePreset({ id: "b" })];
      const mgr = new PresetManager(initial);
      expect(mgr.getPresets()).toHaveLength(2);
    });

    it("does not mutate when source array changes", () => {
      const initial = [makePreset({ id: "a" })];
      const mgr = new PresetManager(initial);
      initial.push(makePreset({ id: "b" }));
      expect(mgr.getPresets()).toHaveLength(1);
    });
  });

  describe("getPreset", () => {
    it("returns preset by id", () => {
      const mgr = new PresetManager([makePreset({ id: "x", name: "X" })]);
      expect(mgr.getPreset("x")?.name).toBe("X");
    });

    it("returns undefined for unknown id", () => {
      const mgr = new PresetManager([]);
      expect(mgr.getPreset("nope")).toBeUndefined();
    });
  });

  describe("addPreset", () => {
    it("adds a preset and returns it with generated id", () => {
      const mgr = new PresetManager([]);
      const result = mgr.addPreset({
        name: "New",
        penType: "brush",
        colorId: "ink-red",
        width: 5,
        smoothing: 0.5,
      });
      expect(result).not.toBeNull();
      expect(result!.id).toMatch(/^preset-/);
      expect(result!.name).toBe("New");
      expect(mgr.getPresets()).toHaveLength(1);
    });

    it("enforces 20-preset max", () => {
      const presets = Array.from({ length: 20 }, (_, i) =>
        makePreset({ id: `p-${i}` })
      );
      const mgr = new PresetManager(presets);
      const result = mgr.addPreset({
        name: "One Too Many",
        penType: "ballpoint",
        colorId: "ink-black",
        width: 2,
        smoothing: 0.3,
      });
      expect(result).toBeNull();
      expect(mgr.getPresets()).toHaveLength(20);
    });
  });

  describe("updatePreset", () => {
    it("updates fields of an existing preset", () => {
      const mgr = new PresetManager([makePreset({ id: "u1", name: "Old" })]);
      expect(mgr.updatePreset("u1", { name: "New", width: 10 })).toBe(true);
      expect(mgr.getPreset("u1")?.name).toBe("New");
      expect(mgr.getPreset("u1")?.width).toBe(10);
    });

    it("returns false for unknown id", () => {
      const mgr = new PresetManager([]);
      expect(mgr.updatePreset("nope", { name: "X" })).toBe(false);
    });
  });

  describe("deletePreset", () => {
    it("removes a preset", () => {
      const mgr = new PresetManager([makePreset({ id: "d1" })]);
      expect(mgr.deletePreset("d1")).toBe(true);
      expect(mgr.getPresets()).toHaveLength(0);
    });

    it("returns false for unknown id", () => {
      const mgr = new PresetManager([]);
      expect(mgr.deletePreset("nope")).toBe(false);
    });
  });

  describe("reorderPreset", () => {
    it("moves a preset to a new index", () => {
      const mgr = new PresetManager([
        makePreset({ id: "a" }),
        makePreset({ id: "b" }),
        makePreset({ id: "c" }),
      ]);
      expect(mgr.reorderPreset("a", 2)).toBe(true);
      const ids = mgr.getPresets().map((p) => p.id);
      expect(ids).toEqual(["b", "c", "a"]);
    });

    it("clamps to valid index", () => {
      const mgr = new PresetManager([
        makePreset({ id: "a" }),
        makePreset({ id: "b" }),
      ]);
      mgr.reorderPreset("a", 100);
      const ids = mgr.getPresets().map((p) => p.id);
      expect(ids).toEqual(["b", "a"]);
    });

    it("returns false for unknown id", () => {
      const mgr = new PresetManager([]);
      expect(mgr.reorderPreset("nope", 0)).toBe(false);
    });
  });

  describe("createFromState", () => {
    it("creates a preset from toolbar state with auto-generated name", () => {
      const mgr = new PresetManager([]);
      const state = makeState({ penType: "fountain", colorId: "ink-black", nibAngle: 0.5, nibThickness: 0.3, nibPressure: 0.7 });
      const preset = mgr.createFromState(state);
      expect(preset.name).toBe("Fountain (Black)");
      expect(preset.penType).toBe("fountain");
      expect(preset.nibAngle).toBe(0.5);
      expect(preset.nibThickness).toBe(0.3);
      expect(preset.nibPressure).toBe(0.7);
    });

    it("uses hex color in name when not semantic", () => {
      const mgr = new PresetManager([]);
      const state = makeState({ penType: "highlighter", colorId: "#FFE066" });
      const preset = mgr.createFromState(state);
      expect(preset.name).toBe("Highlighter (#FFE066)");
    });
  });

  describe("findMatchingPreset", () => {
    it("finds exact match", () => {
      const mgr = new PresetManager([
        makePreset({ id: "m1", penType: "ballpoint", colorId: "ink-black", width: 2, smoothing: 0.3 }),
      ]);
      const state = makeState({ penType: "ballpoint", colorId: "ink-black", width: 2, smoothing: 0.3 });
      expect(mgr.findMatchingPreset(state)).toBe("m1");
    });

    it("returns null when no match", () => {
      const mgr = new PresetManager([
        makePreset({ id: "m1", width: 5 }),
      ]);
      const state = makeState({ width: 2 });
      expect(mgr.findMatchingPreset(state)).toBeNull();
    });

    it("matches nib properties for fountain preset", () => {
      const mgr = new PresetManager([
        makePreset({
          id: "f1",
          penType: "fountain",
          nibAngle: 0.5,
          nibThickness: 0.3,
          nibPressure: 0.7,
        }),
      ]);
      const state = makeState({
        penType: "fountain",
        nibAngle: 0.5,
        nibThickness: 0.3,
        nibPressure: 0.7,
      });
      expect(mgr.findMatchingPreset(state)).toBe("f1");
    });
  });

  describe("toArray", () => {
    it("returns a copy of presets", () => {
      const mgr = new PresetManager([makePreset({ id: "t1" })]);
      const arr = mgr.toArray();
      expect(arr).toHaveLength(1);
      arr.push(makePreset({ id: "t2" }));
      expect(mgr.getPresets()).toHaveLength(1);
    });
  });
});
