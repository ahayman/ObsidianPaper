import { RecentColorManager } from "./RecentColorManager";

describe("RecentColorManager", () => {
  // ─── promote ──────────────────────────────────────────────

  it("promotes a new color to the front", () => {
    const mgr = new RecentColorManager([]);
    expect(mgr.promote("#aaa|#bbb")).toBe(true);
    expect(mgr.getColors()).toEqual(["#aaa|#bbb"]);
  });

  it("promotes an existing color to the front", () => {
    const mgr = new RecentColorManager(["#111|#222", "#333|#444", "#555|#666"]);
    expect(mgr.promote("#555|#666")).toBe(true);
    expect(mgr.getColors()).toEqual(["#555|#666", "#111|#222", "#333|#444"]);
  });

  it("returns false when color is already at front", () => {
    const mgr = new RecentColorManager(["#aaa|#bbb", "#ccc|#ddd"]);
    expect(mgr.promote("#aaa|#bbb")).toBe(false);
    expect(mgr.getColors()).toEqual(["#aaa|#bbb", "#ccc|#ddd"]);
  });

  it("evicts the oldest color when at max capacity", () => {
    const mgr = new RecentColorManager(["#1", "#2", "#3"], 3);
    expect(mgr.promote("#4")).toBe(true);
    expect(mgr.getColors()).toEqual(["#4", "#1", "#2"]);
  });

  it("does not evict when promoting an existing color at capacity", () => {
    const mgr = new RecentColorManager(["#1", "#2", "#3"], 3);
    mgr.promote("#3");
    expect(mgr.getColors()).toEqual(["#3", "#1", "#2"]);
  });

  it("handles dual-hex string equality", () => {
    const mgr = new RecentColorManager(["#1a1a1a|#e8e8e8"]);
    expect(mgr.promote("#1a1a1a|#e8e8e8")).toBe(false);
    expect(mgr.promote("#1a1a1a|#ffffff")).toBe(true);
    expect(mgr.getColors()).toEqual(["#1a1a1a|#ffffff", "#1a1a1a|#e8e8e8"]);
  });

  // ─── remove ───────────────────────────────────────────────

  it("removes an existing color", () => {
    const mgr = new RecentColorManager(["#1", "#2", "#3"]);
    expect(mgr.remove("#2")).toBe(true);
    expect(mgr.getColors()).toEqual(["#1", "#3"]);
  });

  it("returns false when removing a color that does not exist", () => {
    const mgr = new RecentColorManager(["#1", "#2"]);
    expect(mgr.remove("#999")).toBe(false);
    expect(mgr.getColors()).toEqual(["#1", "#2"]);
  });

  it("returns false when removing from an empty list", () => {
    const mgr = new RecentColorManager([]);
    expect(mgr.remove("#1")).toBe(false);
  });

  // ─── constructor ──────────────────────────────────────────

  it("deduplicates initial list", () => {
    const mgr = new RecentColorManager(["#1", "#2", "#1", "#3", "#2"]);
    expect(mgr.getColors()).toEqual(["#1", "#2", "#3"]);
  });

  it("clamps initial list to max capacity", () => {
    const mgr = new RecentColorManager(["#1", "#2", "#3", "#4", "#5"], 3);
    expect(mgr.getColors()).toEqual(["#1", "#2", "#3"]);
  });

  // ─── toArray ──────────────────────────────────────────────

  it("returns a copy that does not mutate internal state", () => {
    const mgr = new RecentColorManager(["#1", "#2"]);
    const arr = mgr.toArray();
    arr.push("#3");
    expect(mgr.getColors()).toEqual(["#1", "#2"]);
  });
});
