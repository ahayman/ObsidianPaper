import { ColorStripManager } from "./ColorStripManager";

describe("ColorStripManager", () => {
  // ─── Constructor ──────────────────────────────────────────

  it("initializes with saved and recent colors", () => {
    const mgr = new ColorStripManager(["#s1", "#s2"], ["#r1", "#r2"]);
    expect([...mgr.getSavedColors()]).toEqual(["#s1", "#s2"]);
    expect([...mgr.getRecentColors()]).toEqual(["#r1", "#r2"]);
  });

  it("deduplicates saved colors", () => {
    const mgr = new ColorStripManager(["#s1", "#s2", "#s1"]);
    expect([...mgr.getSavedColors()]).toEqual(["#s1", "#s2"]);
  });

  it("excludes saved colors from recent", () => {
    const mgr = new ColorStripManager(["#s1"], ["#s1", "#r1"]);
    expect([...mgr.getSavedColors()]).toEqual(["#s1"]);
    expect([...mgr.getRecentColors()]).toEqual(["#r1"]);
  });

  it("clamps saved to maxSaved", () => {
    const saved = Array.from({ length: 15 }, (_, i) => `#s${i}`);
    const mgr = new ColorStripManager(saved, [], 16, 12);
    expect(mgr.getSavedColors()).toHaveLength(12);
  });

  it("clamps recent to fill remaining slots", () => {
    const recent = Array.from({ length: 20 }, (_, i) => `#r${i}`);
    const mgr = new ColorStripManager(["#s1", "#s2"], recent, 16, 12);
    // 16 total - 2 saved = 14 history slots
    expect(mgr.getRecentColors()).toHaveLength(14);
  });

  // ─── pinColor ─────────────────────────────────────────────

  it("pins a color to saved", () => {
    const mgr = new ColorStripManager([], ["#r1"]);
    expect(mgr.pinColor("#r1")).toBe(true);
    expect([...mgr.getSavedColors()]).toEqual(["#r1"]);
    expect([...mgr.getRecentColors()]).toEqual([]);
  });

  it("returns false if already saved", () => {
    const mgr = new ColorStripManager(["#s1"]);
    expect(mgr.pinColor("#s1")).toBe(false);
  });

  it("returns false if at max saved capacity", () => {
    const saved = Array.from({ length: 12 }, (_, i) => `#s${i}`);
    const mgr = new ColorStripManager(saved, [], 16, 12);
    expect(mgr.pinColor("#new")).toBe(false);
  });

  it("pins a new color that is not in history", () => {
    const mgr = new ColorStripManager([], []);
    expect(mgr.pinColor("#new")).toBe(true);
    expect([...mgr.getSavedColors()]).toEqual(["#new"]);
  });

  it("trims history when pinning reduces available slots", () => {
    // 4 recent, 0 saved. maxTotal=4
    const mgr = new ColorStripManager([], ["#r1", "#r2", "#r3", "#r4"], 4, 4);
    mgr.pinColor("#new"); // Now 1 saved, max 3 recent
    expect(mgr.getRecentColors()).toHaveLength(3);
  });

  // ─── unpinColor ───────────────────────────────────────────

  it("unpins a saved color and moves to history front", () => {
    const mgr = new ColorStripManager(["#s1", "#s2"], ["#r1"]);
    expect(mgr.unpinColor("#s1")).toBe(true);
    expect([...mgr.getSavedColors()]).toEqual(["#s2"]);
    expect([...mgr.getRecentColors()]).toEqual(["#s1", "#r1"]);
  });

  it("returns false for non-saved color", () => {
    const mgr = new ColorStripManager(["#s1"]);
    expect(mgr.unpinColor("#r1")).toBe(false);
  });

  // ─── promote ──────────────────────────────────────────────

  it("promotes a new color to history front", () => {
    const mgr = new ColorStripManager([], []);
    expect(mgr.promote("#new")).toBe(true);
    expect([...mgr.getRecentColors()]).toEqual(["#new"]);
  });

  it("promotes an existing history color to front", () => {
    const mgr = new ColorStripManager([], ["#r1", "#r2", "#r3"]);
    expect(mgr.promote("#r3")).toBe(true);
    expect([...mgr.getRecentColors()]).toEqual(["#r3", "#r1", "#r2"]);
  });

  it("returns false when promoting a saved color", () => {
    const mgr = new ColorStripManager(["#s1"], ["#r1"]);
    expect(mgr.promote("#s1")).toBe(false);
  });

  it("returns false when already at front", () => {
    const mgr = new ColorStripManager([], ["#r1", "#r2"]);
    expect(mgr.promote("#r1")).toBe(false);
  });

  it("evicts oldest history when at capacity", () => {
    const mgr = new ColorStripManager(["#s1"], ["#r1", "#r2", "#r3"], 4, 4);
    // maxTotal=4, saved=1, so max 3 history slots. Already full.
    mgr.promote("#new");
    expect([...mgr.getRecentColors()]).toEqual(["#new", "#r1", "#r2"]);
  });

  // ─── remove ───────────────────────────────────────────────

  it("removes a saved color", () => {
    const mgr = new ColorStripManager(["#s1", "#s2"]);
    expect(mgr.remove("#s1")).toBe(true);
    expect([...mgr.getSavedColors()]).toEqual(["#s2"]);
  });

  it("removes a history color", () => {
    const mgr = new ColorStripManager([], ["#r1", "#r2"]);
    expect(mgr.remove("#r1")).toBe(true);
    expect([...mgr.getRecentColors()]).toEqual(["#r2"]);
  });

  it("returns false for non-existent color", () => {
    const mgr = new ColorStripManager(["#s1"], ["#r1"]);
    expect(mgr.remove("#nope")).toBe(false);
  });

  // ─── isSaved ──────────────────────────────────────────────

  it("returns true for saved colors", () => {
    const mgr = new ColorStripManager(["#s1"]);
    expect(mgr.isSaved("#s1")).toBe(true);
  });

  it("returns false for non-saved colors", () => {
    const mgr = new ColorStripManager([], ["#r1"]);
    expect(mgr.isSaved("#r1")).toBe(false);
    expect(mgr.isSaved("#nope")).toBe(false);
  });

  // ─── Serialization ───────────────────────────────────────

  it("toSavedArray returns a copy", () => {
    const mgr = new ColorStripManager(["#s1"]);
    const arr = mgr.toSavedArray();
    arr.push("#s2");
    expect([...mgr.getSavedColors()]).toEqual(["#s1"]);
  });

  it("toRecentArray returns a copy", () => {
    const mgr = new ColorStripManager([], ["#r1"]);
    const arr = mgr.toRecentArray();
    arr.push("#r2");
    expect([...mgr.getRecentColors()]).toEqual(["#r1"]);
  });

  // ─── Dynamic slot allocation ──────────────────────────────

  it("history expands when saved colors are removed", () => {
    // Start with 2 saved, 4 recent. maxTotal=6
    const mgr = new ColorStripManager(["#s1", "#s2"], ["#r1", "#r2", "#r3", "#r4"], 6, 12);
    expect(mgr.getRecentColors()).toHaveLength(4);

    // Unpin one saved: now 1 saved, 5 slots for history
    mgr.unpinColor("#s1");
    // #s1 moves to front of history: [#s1, #r1, #r2, #r3, #r4]
    expect(mgr.getRecentColors()).toHaveLength(5);
    expect([...mgr.getRecentColors()][0]).toBe("#s1");

    // Promote a new color — should fit in the 5 history slots
    mgr.promote("#new");
    expect(mgr.getRecentColors()).toHaveLength(5);
    expect([...mgr.getRecentColors()][0]).toBe("#new");
  });
});
