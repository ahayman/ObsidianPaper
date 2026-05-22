import { computeAllMarkerScatter, computeMarkerGrain } from "./MarkerScatterRenderer";
import { getPenConfig } from "../stroke/PenConfigs";
import type { StrokePoint, PenStyle } from "../types";

const penConfig = getPenConfig("felt-tip");
const config = penConfig.markerScatter!;

const style: PenStyle = {
  pen: "felt-tip",
  color: "#1a1a1a",
  width: 6,
  opacity: 1,
  smoothing: 0.5,
  pressureCurve: 1,
  tiltSensitivity: 0,
};

function pt(x: number, y: number, pressure = 0.6): StrokePoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, timestamp: 0 };
}

function line(): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= 20; i++) pts.push(pt(i * 10, 100));
  return pts;
}

describe("computeMarkerGrain", () => {
  it("is a pure function of world position", () => {
    expect(computeMarkerGrain(123, 456, config)).toBe(computeMarkerGrain(123, 456, config));
  });

  it("returns values within [1 - grainStrength, 1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = computeMarkerGrain(i * 7.3, i * 3.1 - 40, config);
      expect(v).toBeGreaterThanOrEqual(1 - config.grainStrength - 1e-6);
      expect(v).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe("computeAllMarkerScatter", () => {
  it("returns an empty array for no points", () => {
    expect(computeAllMarkerScatter([], style, penConfig, config)).toEqual([]);
  });

  it("produces particles for a stroke", () => {
    expect(computeAllMarkerScatter(line(), style, penConfig, config).length).toBeGreaterThan(0);
  });

  it("produces particles for a single-point tap", () => {
    expect(computeAllMarkerScatter([pt(50, 50)], style, penConfig, config).length).toBeGreaterThan(0);
  });

  it("is deterministic — identical input yields identical output", () => {
    // Texture lives in the per-particle data, so the active and baked paths
    // (which both call this) cannot disagree.
    const a = computeAllMarkerScatter(line(), style, penConfig, config);
    const b = computeAllMarkerScatter(line(), style, penConfig, config);
    expect(a).toEqual(b);
  });

  it("every fibre has opacity within (0, 1] and positive dimensions", () => {
    for (const s of computeAllMarkerScatter(line(), style, penConfig, config)) {
      expect(s.opacity).toBeGreaterThan(0);
      expect(s.opacity).toBeLessThanOrEqual(1);
      expect(s.radius).toBeGreaterThan(0);
      expect(s.halfLength).toBeGreaterThan(0);
      expect(Number.isFinite(s.rotation)).toBe(true);
      expect(Number.isFinite(s.curvature)).toBe(true);
    }
  });

  it("folds stroke opacity into per-particle alpha", () => {
    const avg = (s: { opacity: number }[]) =>
      s.reduce((t, p) => t + p.opacity, 0) / Math.max(1, s.length);
    const full = computeAllMarkerScatter(line(), style, penConfig, config);
    const half = computeAllMarkerScatter(line(), { ...style, opacity: 0.5 }, penConfig, config);
    expect(avg(half)).toBeLessThan(avg(full));
  });

  it("keeps neighbouring fibre angles near-parallel on a tremor-heavy stroke", () => {
    // A slow, near-horizontal stroke with closely-spaced, vertically-noisy
    // points — the case that produced the criss-cross pattern. The windowed
    // tangent + world-anchored wobble must keep consecutive fibres near-parallel.
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 60; i++) {
      const y = 100 + Math.sin(i * 1.9) * 0.9 + Math.cos(i * 0.7) * 0.6;
      pts.push(pt(i * 3, y));
    }
    const streaks = computeAllMarkerScatter(pts, style, penConfig, config);
    expect(streaks.length).toBeGreaterThan(20);

    let maxDelta = 0;
    for (let i = 1; i < streaks.length; i++) {
      // Orientation is mod π (a fibre is an undirected line).
      let d = Math.abs(streaks[i].rotation - streaks[i - 1].rotation) % Math.PI;
      d = Math.min(d, Math.PI - d);
      maxDelta = Math.max(maxDelta, d);
    }
    // Raw per-segment tangents on this stroke swing by ~0.5+ rad; smoothing
    // must collapse neighbour-to-neighbour angle change far below that.
    expect(maxDelta).toBeLessThan(0.4);
  });

  it("no criss-cross X's when a stroke smoothly reverses direction", () => {
    // Back-and-forth shading: a rightward leg, a smooth U-turn, a leftward leg.
    // A directed-vector tangent average straddling the turn would point across
    // both legs (the X's); doubled-angle averaging treats it as a non-event.
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 30; i++) pts.push(pt(i * 5, 100));            // leg 1 →
    for (let i = 1; i <= 20; i++) {                                    // U-turn
      const t = (i / 20) * Math.PI;
      pts.push(pt(150 + 10 * Math.sin(t), 110 - 10 * Math.cos(t)));
    }
    for (let i = 1; i <= 30; i++) pts.push(pt(150 - i * 5, 120));      // leg 2 ←
    const streaks = computeAllMarkerScatter(pts, style, penConfig, config);
    expect(streaks.length).toBeGreaterThan(20);

    // Fibres whose footprint is on a horizontal leg (away from the U-turn at
    // x > 130) must stay horizontal — no fibre pointing across the stroke.
    let legFibres = 0;
    for (const s of streaks) {
      if (s.x > 130) continue;
      legFibres++;
      let h = Math.abs(s.rotation) % Math.PI;
      h = Math.min(h, Math.PI - h);
      expect(h).toBeLessThan(0.45);
    }
    expect(legFibres).toBeGreaterThan(10);
  });

  it("a straight stroke yields ~zero fibre curvature", () => {
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 40; i++) pts.push(pt(i * 5, 100));
    const streaks = computeAllMarkerScatter(pts, style, penConfig, config);
    expect(streaks.length).toBeGreaterThan(10);
    for (const s of streaks) {
      expect(Math.abs(s.curvature)).toBeLessThan(1e-6);
    }
  });

  it("an arc stroke yields fibre curvature magnitude ≈ 1/radius", () => {
    const R = 60;
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = 0.3 + (i / 60) * (Math.PI - 0.6);
      pts.push(pt(200 + R * Math.cos(t), 200 + R * Math.sin(t)));
    }
    const streaks = computeAllMarkerScatter(pts, style, penConfig, config);
    expect(streaks.length).toBeGreaterThan(20);

    // Middle fibres only — endpoints have truncated windows → less accurate.
    const mid = streaks.slice(
      Math.floor(streaks.length / 4),
      Math.floor((3 * streaks.length) / 4),
    );
    const meanAbs =
      mid.reduce((acc, s) => acc + Math.abs(s.curvature), 0) / mid.length;
    expect(meanAbs).toBeGreaterThan((1 / R) * 0.6);
    expect(meanAbs).toBeLessThan((1 / R) * 1.5);
    // A circular arc curves consistently — every fibre bends the same way.
    expect(
      mid.every((s) => s.curvature > 0) || mid.every((s) => s.curvature < 0),
    ).toBe(true);
  });

  it("clamps curvature so every fibre arc stays within the aperture limit", () => {
    // A loop far tighter than the fibre wants curvature above the SDF limit.
    const R = 2.5;
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 1.8;
      pts.push(pt(100 + R * Math.cos(t), 100 + R * Math.sin(t)));
    }
    const streaks = computeAllMarkerScatter(pts, style, penConfig, config);
    expect(streaks.length).toBeGreaterThan(0);
    for (const s of streaks) {
      // halfLength × |curvature| is the arc half-aperture — must stay bounded.
      expect(s.halfLength * Math.abs(s.curvature)).toBeLessThanOrEqual(1.4 + 1e-6);
    }
  });

  it("orients fibres around a tight loop instead of freezing them", () => {
    // A tight circle — the comb-teeth bug froze fibre orientation so every
    // fibre pointed one way; correct behaviour sweeps them around the loop.
    const R = 6;
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 90; i++) {
      const t = (i / 90) * Math.PI * 2;
      pts.push(pt(300 + R * Math.cos(t), 300 + R * Math.sin(t)));
    }
    const streaks = computeAllMarkerScatter(pts, style, penConfig, config);
    expect(streaks.length).toBeGreaterThan(20);

    // Doubled-angle resultant of all fibre orientations: ~1 if they are all
    // parallel (frozen — the bug), ~0 if they sweep around the loop.
    let sc = 0;
    let ss = 0;
    for (const s of streaks) {
      sc += Math.cos(2 * s.rotation);
      ss += Math.sin(2 * s.rotation);
    }
    const resultant = Math.sqrt(sc * sc + ss * ss) / streaks.length;
    expect(resultant).toBeLessThan(0.5);
  });

  it("shortens fibres on a sharp bend so they do not become hooks", () => {
    // A straight leg, then a sharp ~140° V-bend. The fibres at the bend must
    // be markedly shorter than fibres on the straight legs — a long arc at a
    // sharp bend reads as a hook.
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 25; i++) pts.push(pt(i * 6, 100));               // → leg
    for (let i = 1; i <= 40; i++) pts.push(pt(150 - i * 4, 100 + i * 3)); // ↙ leg
    const streaks = computeAllMarkerScatter(pts, style, penConfig, config);

    const leg = streaks.filter((s) => s.x < 60);
    expect(leg.length).toBeGreaterThan(5);
    const legMean = leg.reduce((acc, s) => acc + s.halfLength, 0) / leg.length;

    // The shortest fibres (at the sharp bend) are well under the straight-leg
    // length; without shortening even the jitter minimum stays near the legs'.
    const minHalf = Math.min(...streaks.map((s) => s.halfLength));
    expect(minHalf).toBeLessThan(legMean * 0.6);
  });

  it("thickens fibres at a sharp bend so the shorter fibres still overlap", () => {
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 25; i++) pts.push(pt(i * 6, 100));               // → leg
    for (let i = 1; i <= 40; i++) pts.push(pt(150 - i * 4, 100 + i * 3)); // ↙ leg
    const streaks = computeAllMarkerScatter(pts, style, penConfig, config);

    const leg = streaks.filter((s) => s.x < 60);
    expect(leg.length).toBeGreaterThan(5);
    // Straight-leg fibres are unshortened, so unthickened (base radius);
    // shortened corner fibres are thicker to keep their overlap.
    const legRadius = Math.min(...leg.map((s) => s.radius));
    const maxRadius = Math.max(...streaks.map((s) => s.radius));
    expect(maxRadius).toBeGreaterThan(legRadius * 1.2);
  });
});
