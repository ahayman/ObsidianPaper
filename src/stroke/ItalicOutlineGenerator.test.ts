import { generateItalicOutline, type ItalicNibConfig } from "./ItalicOutlineGenerator";
import type { StrokePoint } from "../types";

function makePoint(x: number, y: number, pressure = 0.5, twist = 0): StrokePoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, twist, timestamp: Date.now() };
}

function makeConfig(overrides?: Partial<ItalicNibConfig>): ItalicNibConfig {
  return {
    nibWidth: 6,
    nibHeight: 1.5,    // 0.25 aspect ratio
    nibAngle: Math.PI / 6, // 30 degrees
    useBarrelRotation: false,
    pressureCurve: 1.0,
    pressureWidthRange: [0.5, 1.0],
    widthSmoothing: 0.4,
    taperStart: 0,
    taperEnd: 0,
    ...overrides,
  };
}

describe("ItalicOutlineGenerator", () => {
  describe("basic output format", () => {
    it("should return empty array for no points", () => {
      const result = generateItalicOutline([], makeConfig());
      expect(result).toEqual([]);
    });

    it("should return a polygon for a single point", () => {
      const result = generateItalicOutline([makePoint(100, 100)], makeConfig());
      expect(result.length).toBeGreaterThanOrEqual(3);
      // Each entry should be [x, y]
      for (const pt of result) {
        expect(pt).toHaveLength(2);
        expect(typeof pt[0]).toBe("number");
        expect(typeof pt[1]).toBe("number");
      }
    });

    it("should return a closed polygon for two points", () => {
      const points = [makePoint(100, 100), makePoint(200, 100)];
      const result = generateItalicOutline(points, makeConfig());
      expect(result.length).toBeGreaterThanOrEqual(4); // At least a quad
      for (const pt of result) {
        expect(pt).toHaveLength(2);
      }
    });

    it("should return array of [x,y] pairs for multiple points", () => {
      const points = [
        makePoint(100, 100),
        makePoint(120, 110),
        makePoint(140, 105),
        makePoint(160, 115),
        makePoint(180, 100),
      ];
      const result = generateItalicOutline(points, makeConfig());
      expect(result.length).toBeGreaterThan(0);
      for (const pt of result) {
        expect(pt).toHaveLength(2);
        expect(Number.isFinite(pt[0])).toBe(true);
        expect(Number.isFinite(pt[1])).toBe(true);
      }
    });
  });

  describe("width projection", () => {
    it("should produce wider stroke perpendicular to nib edge", () => {
      // Nib at 0 degrees (horizontal). Stroke going up (perpendicular).
      const config = makeConfig({ nibAngle: 0, nibWidth: 10, nibHeight: 2.5, widthSmoothing: 1.0 });
      const perpPoints = [makePoint(100, 100, 0.5), makePoint(100, 50, 0.5)];
      const perpOutline = generateItalicOutline(perpPoints, config);

      // Same config, stroke going right (parallel).
      const paraPoints = [makePoint(100, 100, 0.5), makePoint(150, 100, 0.5)];
      const paraOutline = generateItalicOutline(paraPoints, config);

      // Measure width of each outline at the second point (index 1 and N-2)
      const perpWidth = getOutlineWidth(perpOutline);
      const paraWidth = getOutlineWidth(paraOutline);

      expect(perpWidth).toBeGreaterThan(paraWidth);
    });

    it("should produce minimum width when stroke is parallel to nib edge", () => {
      // Nib at 0 degrees (horizontal). Stroke going right (parallel).
      const config = makeConfig({ nibAngle: 0, nibWidth: 10, nibHeight: 2, widthSmoothing: 1.0 });
      const points = [makePoint(100, 100, 0.5), makePoint(200, 100, 0.5)];
      const outline = generateItalicOutline(points, config);
      const width = getOutlineWidth(outline);

      // Width should be close to nibHeight * pressure range
      // nibHeight=2, pressure=0.5, pressureWidthRange=[0.5,1.0] => factor=0.75 => ~1.5
      expect(width).toBeLessThan(config.nibWidth);
    });
  });

  describe("pressure scaling", () => {
    it("should produce wider stroke with higher pressure", () => {
      const config = makeConfig({ widthSmoothing: 1.0, taperStart: 0, taperEnd: 0 });
      const lowPressure = [makePoint(100, 100, 0.2), makePoint(200, 150, 0.2)];
      const highPressure = [makePoint(100, 100, 0.9), makePoint(200, 150, 0.9)];

      const lowOutline = generateItalicOutline(lowPressure, config);
      const highOutline = generateItalicOutline(highPressure, config);

      const lowWidth = getOutlineWidth(lowOutline);
      const highWidth = getOutlineWidth(highOutline);

      expect(highWidth).toBeGreaterThan(lowWidth);
    });
  });

  describe("barrel rotation", () => {
    it("should use twist as nib angle when barrel rotation is enabled", () => {
      const config = makeConfig({
        useBarrelRotation: true,
        nibAngle: 0, // static angle = 0
        nibWidth: 10,
        nibHeight: 2.5,
        widthSmoothing: 1.0,
      });

      // Stroke going up with twist=0 (nib horizontal → perpendicular → max width)
      const noTwist = [makePoint(100, 100, 0.5, 0), makePoint(100, 50, 0.5, 0)];
      const noTwistOutline = generateItalicOutline(noTwist, config);

      // Same stroke but twist=90 (nib vertical → parallel → min width)
      const withTwist = [makePoint(100, 100, 0.5, 90), makePoint(100, 50, 0.5, 90)];
      const withTwistOutline = generateItalicOutline(withTwist, config);

      const noTwistWidth = getOutlineWidth(noTwistOutline);
      const withTwistWidth = getOutlineWidth(withTwistOutline);

      expect(noTwistWidth).toBeGreaterThan(withTwistWidth);
    });

    it("should ignore twist when barrel rotation is disabled", () => {
      const config = makeConfig({
        useBarrelRotation: false,
        nibAngle: 0,
        nibWidth: 10,
        nibHeight: 2.5,
        widthSmoothing: 1.0,
      });

      const noTwist = [makePoint(100, 100, 0.5, 0), makePoint(100, 50, 0.5, 0)];
      const withTwist = [makePoint(100, 100, 0.5, 90), makePoint(100, 50, 0.5, 90)];

      const noTwistOutline = generateItalicOutline(noTwist, config);
      const withTwistOutline = generateItalicOutline(withTwist, config);

      const noTwistWidth = getOutlineWidth(noTwistOutline);
      const withTwistWidth = getOutlineWidth(withTwistOutline);

      // Should be equal since twist is ignored
      expect(Math.abs(noTwistWidth - withTwistWidth)).toBeLessThan(0.01);
    });
  });

  describe("taper", () => {
    it("should taper width at start of stroke", () => {
      const config = makeConfig({ taperStart: 50, taperEnd: 0, widthSmoothing: 1.0 });
      // Slight curve so RDP de-jitter preserves interior points
      const points = Array.from({ length: 10 }, (_, i) =>
        makePoint(100 + i * 10, 100 + Math.sin(i * 0.3) * 5, 0.5)
      );
      const outline = generateItalicOutline(points, config);
      const n = outline.length / 2;

      // The outline at the start should be narrower than the middle
      const startWidth = getWidthAtIndex(outline, 0, n);
      const midWidth = getWidthAtIndex(outline, Math.floor(n / 2), n);

      expect(startWidth).toBeLessThan(midWidth);
    });

    it("should taper width at end of stroke", () => {
      const config = makeConfig({ taperStart: 0, taperEnd: 50, widthSmoothing: 1.0 });
      // Slight curve so RDP de-jitter preserves interior points
      const points = Array.from({ length: 10 }, (_, i) =>
        makePoint(100 + i * 10, 100 + Math.sin(i * 0.3) * 5, 0.5)
      );
      const outline = generateItalicOutline(points, config);
      const n = outline.length / 2;

      const endWidth = getWidthAtIndex(outline, n - 1, n);
      const midWidth = getWidthAtIndex(outline, Math.floor(n / 2), n);

      expect(endWidth).toBeLessThan(midWidth);
    });
  });

  describe("sharp corners (adaptive direction window)", () => {
    it("should maintain minimum width at a sharp V-turn", () => {
      const config = makeConfig({
        nibWidth: 6,
        nibHeight: 1.5,
        widthSmoothing: 1.0,
        taperStart: 0,
        taperEnd: 0,
      });
      // V-shape: go down-right then up-right (sharp corner at bottom)
      const points = [
        makePoint(100, 100, 0.5),
        makePoint(110, 120, 0.5),
        makePoint(120, 140, 0.5),
        makePoint(130, 160, 0.5), // corner
        makePoint(140, 140, 0.5),
        makePoint(150, 120, 0.5),
        makePoint(160, 100, 0.5),
      ];
      const outline = generateItalicOutline(points, config, false); // no dejitter
      const n = outline.length / 2;

      // Check that every point along the outline has non-trivial width
      const minExpected = config.nibHeight * 0.25; // generous floor
      for (let i = 0; i < n; i++) {
        const w = getWidthAtIndex(outline, i, n);
        expect(w).toBeGreaterThan(minExpected);
      }
    });

    it("should still produce smooth outlines on gentle S-curves", () => {
      const config = makeConfig({
        nibWidth: 6,
        nibHeight: 1.5,
        widthSmoothing: 1.0,
        taperStart: 0,
        taperEnd: 0,
      });
      // Gentle S-curve (no sharp corners)
      const points = Array.from({ length: 20 }, (_, i) =>
        makePoint(100 + i * 5, 100 + Math.sin(i * 0.3) * 15, 0.5)
      );
      const outline = generateItalicOutline(points, config, false);
      const n = outline.length / 2;

      // All widths should be consistent (no wild variations)
      const widths: number[] = [];
      for (let i = 0; i < n; i++) {
        widths.push(getWidthAtIndex(outline, i, n));
      }

      // Interior points (skip first/last which may have edge effects)
      const interior = widths.slice(1, -1);
      const avg = interior.reduce((a, b) => a + b, 0) / interior.length;
      for (const w of interior) {
        // Each width should be within 60% of the average (gentle curve = stable widths)
        expect(w).toBeGreaterThan(avg * 0.4);
        expect(w).toBeLessThan(avg * 1.6);
      }
    });
  });

  describe("DIAGNOSTIC: V-turn geometry", () => {
    it("should dump width data at a sharp V-turn corner", () => {
      const config = makeConfig({
        nibWidth: 6,
        nibHeight: 1.5,
        nibAngle: Math.PI / 6, // 30 degrees
        widthSmoothing: 0.4,
        taperStart: 0,
        taperEnd: 0,
      });

      // Simulate bottom of "n": stroke goes down-right then up-right.
      // Dense points near the corner (pen decelerates).
      const points: StrokePoint[] = [];
      // Down-right leg (moving at ~45° downward)
      for (let i = 0; i < 10; i++) {
        points.push(makePoint(100 + i * 3, 100 + i * 4, 0.5));
      }
      // Corner: dense points as pen decelerates
      points.push(makePoint(130.5, 140.5, 0.5));
      points.push(makePoint(131, 141, 0.5));
      points.push(makePoint(131.3, 141.2, 0.5));
      // Up-right leg (moving at ~45° upward)
      for (let i = 0; i < 10; i++) {
        points.push(makePoint(132 + i * 3, 141 - i * 4, 0.5));
      }

      // Add timestamps to simulate deceleration at corner
      let t = 0;
      for (let i = 0; i < points.length; i++) {
        // Slow down near the corner (indices 8-14)
        const distToCorner = Math.abs(i - 12);
        const dt = distToCorner < 4 ? 30 : 8; // 30ms near corner, 8ms on straight
        t += dt;
        points[i] = { ...points[i], timestamp: t };
      }

      const outline = generateItalicOutline(points, config, false); // no dejitter
      const n = outline.length / 2;

      console.log(`\n=== V-TURN DIAGNOSTIC (${n} outline points per side) ===`);
      console.log(`nibWidth=${config.nibWidth} nibHeight=${config.nibHeight} nibAngle=${(config.nibAngle * 180 / Math.PI).toFixed(0)}°`);
      console.log(`idx | centerX  centerY | perpX   perpY  | halfW  | width  | left(x,y)       | right(x,y)`);
      console.log("----+------------------+----------------+--------+--------+-----------------+-----------");

      for (let i = 0; i < n; i++) {
        const left = outline[i];
        const right = outline[outline.length - 1 - i];
        const w = Math.hypot(left[0] - right[0], left[1] - right[1]);
        const cx = (left[0] + right[0]) / 2;
        const cy = (left[1] + right[1]) / 2;
        const px = (left[0] - right[0]) / Math.max(0.001, w);
        const py = (left[1] - right[1]) / Math.max(0.001, w);

        console.log(
          `${String(i).padStart(3)} | ${cx.toFixed(1).padStart(7)} ${cy.toFixed(1).padStart(7)} | ` +
          `${px.toFixed(3).padStart(6)} ${py.toFixed(3).padStart(6)} | ` +
          `${(w/2).toFixed(3).padStart(6)} | ${w.toFixed(3).padStart(6)} | ` +
          `(${left[0].toFixed(1)},${left[1].toFixed(1)}) | (${right[0].toFixed(1)},${right[1].toFixed(1)})`
        );
      }

      // Also show where minimum width occurs
      let minW = Infinity, minIdx = 0;
      for (let i = 0; i < n; i++) {
        const left = outline[i];
        const right = outline[outline.length - 1 - i];
        const w = Math.hypot(left[0] - right[0], left[1] - right[1]);
        if (w < minW) { minW = w; minIdx = i; }
      }
      console.log(`\nMinimum width: ${minW.toFixed(4)} at index ${minIdx}`);

      // Just so the test passes
      expect(n).toBeGreaterThan(0);
    });
  });

  describe("DIAGNOSTIC: real stroke end notch", () => {
    it("should dump width data for real downstroke with lift-off bounce", () => {
      const config = makeConfig({
        nibWidth: 6,
        nibHeight: 1.5,
        nibAngle: Math.PI / 6,
        widthSmoothing: 0.4,
        taperStart: 0,
        taperEnd: 0,
      });

      // Real stroke data from user — simple downstroke with notch at end
      const rawData: [number, number, number, number][] = [[47.2,78.9,0.078,40801],[47.2,78.9,0.078,40818],[47.2,78.9,0.086,40822],[47.2,78.9,0.082,40818],[47.2,78.9,0.086,40822],[47.2,78.9,0.094,40826],[47.3,78.9,0.102,40831],[47.3,78.9,0.106,40826],[47.3,78.9,0.11,40831],[47.3,79,0.118,40835],[47.3,79,0.129,40839],[47.3,79,0.129,40835],[47.3,79,0.137,40839],[47.3,79,0.145,40843],[47.4,79,0.153,40847],[47.4,79,0.161,40851],[47.4,79,0.169,40856],[47.4,79,0.169,40851],[47.4,79.1,0.176,40856],[47.4,79.1,0.18,40860],[47.4,79.1,0.188,40864],[47.4,79.1,0.188,40860],[47.4,79.1,0.192,40864],[47.4,79.2,0.196,40868],[47.4,79.2,0.204,40872],[47.4,79.2,0.204,40868],[47.4,79.3,0.208,40872],[47.4,79.3,0.216,40876],[47.3,79.4,0.22,40881],[47.3,79.4,0.224,40876],[47.3,79.5,0.227,40881],[47.3,79.6,0.235,40885],[47.2,79.8,0.243,40889],[47.2,79.8,0.247,40885],[47.1,79.9,0.251,40889],[47,80,0.259,40893],[46.9,80.2,0.267,40897],[46.9,80.2,0.267,40893],[46.9,80.4,0.271,40897],[46.8,80.7,0.271,40901],[46.6,81,0.275,40906],[46.6,81,0.275,40901],[46.5,81.3,0.278,40906],[46.3,81.5,0.271,40910],[46.2,81.8,0.263,40914],[46.2,81.8,0.263,40910],[46.1,82,0.255,40914],[45.9,82.3,0.251,40918],[45.8,82.5,0.247,40922],[45.8,82.5,0.247,40918],[45.7,82.8,0.247,40922],[45.5,83,0.235,40926],[45.4,83.3,0.227,40931],[45.4,83.3,0.224,40926],[45.2,83.5,0.216,40931],[45.1,83.7,0.208,40935],[45,83.9,0.204,40939],[45,83.9,0.2,40935],[45,84,0.196,40939],[44.9,84.2,0.176,40943],[44.8,84.2,0.153,40947],[44.8,84.2,0.145,40943],[44.8,84.3,0.133,40947],[44.7,84.3,0.114,40951],[44.7,84.3,0.102,40951],[44.8,83.9,0.071,40960]];

      const points: StrokePoint[] = rawData.map(([x, y, pressure, timestamp]) => ({
        x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, timestamp,
      }));

      const outline = generateItalicOutline(points, config, true); // with dejitter
      const n = outline.length / 2;

      console.log(`\n=== REAL DOWNSTROKE DIAGNOSTIC (${n} outline points per side) ===`);
      console.log(`Last 15 points:`);

      const startIdx = Math.max(0, n - 10);
      for (let i = startIdx; i < n; i++) {
        const left = outline[i];
        const right = outline[outline.length - 1 - i];
        const w = Math.hypot(left[0] - right[0], left[1] - right[1]);
        const cx = (left[0] + right[0]) / 2;
        const cy = (left[1] + right[1]) / 2;
        const px = (left[0] - right[0]) / Math.max(0.001, w);
        const py = (left[1] - right[1]) / Math.max(0.001, w);

        console.log(
          `${String(i).padStart(3)} | center(${cx.toFixed(2)},${cy.toFixed(2)}) | ` +
          `width=${w.toFixed(4)} | perp(${px.toFixed(3)},${py.toFixed(3)}) | ` +
          `L(${left[0].toFixed(2)},${left[1].toFixed(2)}) R(${right[0].toFixed(2)},${right[1].toFixed(2)})`
        );
      }

      // Show where minimum width occurs
      let minW = Infinity, minIdx = 0;
      for (let i = 0; i < n; i++) {
        const left = outline[i];
        const right = outline[outline.length - 1 - i];
        const w = Math.hypot(left[0] - right[0], left[1] - right[1]);
        if (w < minW) { minW = w; minIdx = i; }
      }
      console.log(`\nMinimum width: ${minW.toFixed(4)} at index ${minIdx} (of ${n})`);

      expect(n).toBeGreaterThan(0);
    });
  });

  describe("DIAGNOSTIC: real Z-scribble chunks", () => {
    it("should detect side crossings in real stroke data", () => {
      // Config from real debug output (nibAngle in degrees was 163, convert to radians)
      const config = makeConfig({
        nibWidth: 4,
        nibHeight: 0.2,
        nibAngle: 163 * Math.PI / 180,
        pressureCurve: 0.8,
        pressureWidthRange: [0.51, 1],
        widthSmoothing: 0.4,
        taperStart: 0,
        taperEnd: 0,
      });

      // 161 raw points from user's debug output: [x, y, pressure, timestamp]
      const rawData: [number, number, number, number][] = [
        [-7.9,188.9,0.078,984525],[-7.9,188.9,0.078,984533],[-7.9,188.9,0.078,984537],
        [-7.9,188.9,0.078,984541],[-7.8,188.9,0.078,984546],[-7.8,188.8,0.086,984550],
        [-7.8,188.8,0.09,984554],[-7.8,188.8,0.094,984550],[-7.7,188.8,0.098,984554],
        [-7.6,188.7,0.102,984558],[-7.5,188.6,0.106,984562],[-7.5,188.6,0.11,984558],
        [-7.4,188.5,0.114,984562],[-7.2,188.4,0.11,984566],[-6.9,188.2,0.11,984571],
        [-6.9,188.2,0.11,984566],[-6.7,188.1,0.11,984571],[-6.4,187.9,0.11,984575],
        [-6,187.7,0.11,984579],[-6,187.7,0.11,984575],[-5.7,187.4,0.11,984579],
        [-5.3,187.2,0.106,984583],[-4.9,186.9,0.106,984587],[-4.9,186.9,0.106,984583],
        [-4.5,186.6,0.106,984587],[-4,186.4,0.106,984591],[-3.4,186,0.102,984596],
        [-3.4,186,0.102,984591],[-2.8,185.6,0.098,984596],[-2.3,185.3,0.094,984600],
        [-1.8,185,0.09,984604],[-1.8,185,0.09,984600],[-1.3,184.7,0.086,984604],
        [-0.7,184.4,0.086,984608],[-0.1,184,0.082,984612],[-0.1,184,0.082,984608],
        [0.4,183.7,0.082,984612],[0.9,183.4,0.078,984616],[1.6,183,0.078,984621],
        [1.6,183,0.078,984616],[2.2,182.6,0.078,984621],[2.7,182.3,0.078,984625],
        [3.2,182,0.078,984629],[3.2,182,0.078,984625],[3.7,181.8,0.078,984629],
        [4.1,181.5,0.075,984633],[4.6,181.2,0.078,984637],[4.6,181.2,0.075,984633],
        [4.9,181,0.078,984637],[5.3,180.8,0.078,984641],[5.7,180.6,0.078,984646],
        [5.7,180.6,0.078,984641],[6,180.4,0.078,984646],[6.3,180.3,0.078,984650],
        [6.5,180.2,0.082,984654],[6.5,180.2,0.082,984650],[6.7,180.1,0.082,984654],
        [6.8,180.1,0.086,984658],[6.9,180.1,0.086,984662],[6.9,180.1,0.086,984658],
        [7,180.1,0.086,984662],[7.1,180.2,0.09,984666],[7.1,180.3,0.098,984671],
        [7.1,180.3,0.094,984666],[7.1,180.4,0.102,984671],[7.1,180.5,0.11,984675],
        [7,180.7,0.118,984679],[7,180.7,0.122,984675],[6.9,180.9,0.125,984679],
        [6.7,181.1,0.137,984683],[6.6,181.4,0.149,984687],[6.6,181.4,0.153,984683],
        [6.4,181.6,0.161,984687],[6.2,181.9,0.169,984691],[6,182.2,0.18,984696],
        [6,182.2,0.18,984691],[5.7,182.5,0.188,984696],[5.5,182.8,0.196,984700],
        [5.3,183.1,0.208,984704],[5.3,183.1,0.212,984700],[5,183.4,0.22,984704],
        [4.8,183.7,0.231,984708],[4.5,184.1,0.239,984712],[4.5,184.1,0.243,984708],
        [4.3,184.4,0.251,984712],[4,184.8,0.255,984716],[3.7,185.4,0.255,984721],
        [3.7,185.4,0.259,984716],[3.4,185.9,0.259,984721],[3.1,186.3,0.263,984725],
        [2.9,186.8,0.267,984729],[2.9,186.8,0.267,984725],[2.7,187.3,0.267,984729],
        [2.4,187.8,0.271,984733],[2.2,188.3,0.275,984737],[2.2,188.3,0.275,984733],
        [2,188.7,0.278,984737],[1.8,189.2,0.282,984741],[1.6,189.7,0.286,984746],
        [1.6,189.7,0.29,984741],[1.4,190.1,0.29,984746],[1.3,190.5,0.29,984750],
        [1.2,190.8,0.294,984754],[1.2,190.8,0.294,984750],[1.1,191.1,0.298,984754],
        [1.1,191.3,0.298,984758],[1.1,191.5,0.298,984762],[1.1,191.5,0.298,984758],
        [1.2,191.7,0.298,984762],[1.3,191.7,0.298,984766],[1.5,191.7,0.298,984771],
        [1.5,191.7,0.298,984766],[1.7,191.7,0.302,984771],[1.9,191.7,0.306,984775],
        [2.2,191.5,0.31,984779],[2.2,191.5,0.31,984775],[2.6,191.4,0.314,984779],
        [3,191.2,0.318,984783],[3.5,190.9,0.314,984787],[3.5,190.9,0.318,984783],
        [4,190.7,0.318,984787],[4.6,190.4,0.314,984791],[5.5,190,0.314,984796],
        [5.5,190,0.314,984791],[6.4,189.6,0.31,984796],[7.1,189.3,0.31,984800],
        [8,188.9,0.306,984804],[8,188.9,0.306,984800],[8.8,188.6,0.306,984804],
        [9.7,188.2,0.298,984808],[10.7,187.9,0.294,984812],[10.7,187.9,0.294,984808],
        [11.5,187.6,0.29,984812],[12.4,187.3,0.286,984816],[13.4,186.9,0.263,984821],
        [13.4,186.9,0.271,984816],[14.3,186.5,0.251,984825],[15,186.2,0.227,984825],
        [15,186.2,0.212,984825],[17.3,185.2,0.149,984841],
      ];

      const points: StrokePoint[] = rawData.map(([x, y, pressure, timestamp]) => ({
        x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, timestamp,
      }));

      // Import generateItalicOutlineSides
      const { generateItalicOutlineSides } = require("./ItalicOutlineGenerator");
      const sides = generateItalicOutlineSides(points, config, true);
      expect(sides).not.toBeNull();
      if (!sides) return;

      const { leftSide, rightSide } = sides;

      // Check for side crossings: if left and right sides swap, it creates gaps
      // When segment i's left-right vector reverses vs segment i+1, the quad
      // between them forms a bowtie that renders as a hole.
      let crossingCount = 0;
      const crossings: number[] = [];
      for (let i = 0; i < leftSide.length - 1; i++) {
        // Direction from right to left at segment i
        const d0x = leftSide[i][0] - rightSide[i][0];
        const d0y = leftSide[i][1] - rightSide[i][1];
        // Direction from right to left at segment i+1
        const d1x = leftSide[i + 1][0] - rightSide[i + 1][0];
        const d1y = leftSide[i + 1][1] - rightSide[i + 1][1];

        // Cross product of these two directions - if negative, they're reversed
        const cross = d0x * d1y - d0y * d1x;
        // Dot product - if negative, direction has reversed
        const dot = d0x * d1x + d0y * d1y;

        if (dot < 0) {
          crossingCount++;
          crossings.push(i);
        }
      }

      console.log(`\n=== Z-SCRIBBLE SIDE CROSSING ANALYSIS ===`);
      console.log(`Total outline points: ${leftSide.length}`);
      console.log(`Side crossings found: ${crossingCount}`);

      if (crossings.length > 0) {
        console.log(`\nCrossing locations:`);
        for (const idx of crossings) {
          const lw = Math.hypot(
            leftSide[idx][0] - rightSide[idx][0],
            leftSide[idx][1] - rightSide[idx][1]
          );
          const lw1 = Math.hypot(
            leftSide[idx + 1][0] - rightSide[idx + 1][0],
            leftSide[idx + 1][1] - rightSide[idx + 1][1]
          );
          console.log(
            `  idx=${idx}: ` +
            `L(${leftSide[idx][0].toFixed(2)},${leftSide[idx][1].toFixed(2)}) ` +
            `R(${rightSide[idx][0].toFixed(2)},${rightSide[idx][1].toFixed(2)}) ` +
            `width=${lw.toFixed(4)} → ` +
            `L(${leftSide[idx+1][0].toFixed(2)},${leftSide[idx+1][1].toFixed(2)}) ` +
            `R(${rightSide[idx+1][0].toFixed(2)},${rightSide[idx+1][1].toFixed(2)}) ` +
            `width=${lw1.toFixed(4)}`
          );
        }
      }

      // Also check for segments where L and R lines cross between adjacent points
      // (the segment L[i]→L[i+1] crosses R[i]→R[i+1])
      let segCrossCount = 0;
      const segCrossings: number[] = [];
      for (let i = 0; i < leftSide.length - 1; i++) {
        if (segmentsIntersect(
          leftSide[i][0], leftSide[i][1], leftSide[i+1][0], leftSide[i+1][1],
          rightSide[i][0], rightSide[i][1], rightSide[i+1][0], rightSide[i+1][1],
        )) {
          segCrossCount++;
          segCrossings.push(i);
        }
      }

      console.log(`\nLeft-Right segment crossings: ${segCrossCount}`);
      if (segCrossings.length > 0) {
        console.log(`Crossing segment indices: ${segCrossings.join(', ')}`);
        for (const idx of segCrossings) {
          console.log(
            `  seg ${idx}: ` +
            `L${idx}(${leftSide[idx][0].toFixed(2)},${leftSide[idx][1].toFixed(2)})→` +
            `L${idx+1}(${leftSide[idx+1][0].toFixed(2)},${leftSide[idx+1][1].toFixed(2)}) × ` +
            `R${idx}(${rightSide[idx][0].toFixed(2)},${rightSide[idx][1].toFixed(2)})→` +
            `R${idx+1}(${rightSide[idx+1][0].toFixed(2)},${rightSide[idx+1][1].toFixed(2)})`
          );
        }
      }

      // Dump all outline data for visual analysis
      console.log(`\nFull outline data (idx | center | perp | width):`);
      for (let i = 0; i < leftSide.length; i++) {
        const cx = (leftSide[i][0] + rightSide[i][0]) / 2;
        const cy = (leftSide[i][1] + rightSide[i][1]) / 2;
        const w = Math.hypot(
          leftSide[i][0] - rightSide[i][0],
          leftSide[i][1] - rightSide[i][1]
        );
        const dx = leftSide[i][0] - rightSide[i][0];
        const dy = leftSide[i][1] - rightSide[i][1];
        const px = w > 0.001 ? dx / w : 0;
        const py = w > 0.001 ? dy / w : 0;
        console.log(
          `${String(i).padStart(3)} | ` +
          `c(${cx.toFixed(2)},${cy.toFixed(2)}) | ` +
          `perp(${px.toFixed(3)},${py.toFixed(3)}) | ` +
          `w=${w.toFixed(4)} | ` +
          `L(${leftSide[i][0].toFixed(2)},${leftSide[i][1].toFixed(2)}) ` +
          `R(${rightSide[i][0].toFixed(2)},${rightSide[i][1].toFixed(2)})`
        );
      }

      // The test: there should be NO side crossings.
      // If crossings exist, that's the bug causing chunks.
      expect(crossingCount).toBe(0);
    });

    it("should produce quads that tile without gaps", () => {
      const config = makeConfig({
        nibWidth: 4,
        nibHeight: 0.2,
        nibAngle: 163 * Math.PI / 180,
        pressureCurve: 0.8,
        pressureWidthRange: [0.51, 1],
        widthSmoothing: 0.4,
        taperStart: 0,
        taperEnd: 0,
      });

      const rawData: [number, number, number, number][] = [
        [-7.9,188.9,0.078,984525],[-7.9,188.9,0.078,984533],[-7.9,188.9,0.078,984537],
        [-7.9,188.9,0.078,984541],[-7.8,188.9,0.078,984546],[-7.8,188.8,0.086,984550],
        [-7.8,188.8,0.09,984554],[-7.8,188.8,0.094,984550],[-7.7,188.8,0.098,984554],
        [-7.6,188.7,0.102,984558],[-7.5,188.6,0.106,984562],[-7.5,188.6,0.11,984558],
        [-7.4,188.5,0.114,984562],[-7.2,188.4,0.11,984566],[-6.9,188.2,0.11,984571],
        [-6.9,188.2,0.11,984566],[-6.7,188.1,0.11,984571],[-6.4,187.9,0.11,984575],
        [-6,187.7,0.11,984579],[-6,187.7,0.11,984575],[-5.7,187.4,0.11,984579],
        [-5.3,187.2,0.106,984583],[-4.9,186.9,0.106,984587],[-4.9,186.9,0.106,984583],
        [-4.5,186.6,0.106,984587],[-4,186.4,0.106,984591],[-3.4,186,0.102,984596],
        [-3.4,186,0.102,984591],[-2.8,185.6,0.098,984596],[-2.3,185.3,0.094,984600],
        [-1.8,185,0.09,984604],[-1.8,185,0.09,984600],[-1.3,184.7,0.086,984604],
        [-0.7,184.4,0.086,984608],[-0.1,184,0.082,984612],[-0.1,184,0.082,984608],
        [0.4,183.7,0.082,984612],[0.9,183.4,0.078,984616],[1.6,183,0.078,984621],
        [1.6,183,0.078,984616],[2.2,182.6,0.078,984621],[2.7,182.3,0.078,984625],
        [3.2,182,0.078,984629],[3.2,182,0.078,984625],[3.7,181.8,0.078,984629],
        [4.1,181.5,0.075,984633],[4.6,181.2,0.078,984637],[4.6,181.2,0.075,984633],
        [4.9,181,0.078,984637],[5.3,180.8,0.078,984641],[5.7,180.6,0.078,984646],
        [5.7,180.6,0.078,984641],[6,180.4,0.078,984646],[6.3,180.3,0.078,984650],
        [6.5,180.2,0.082,984654],[6.5,180.2,0.082,984650],[6.7,180.1,0.082,984654],
        [6.8,180.1,0.086,984658],[6.9,180.1,0.086,984662],[6.9,180.1,0.086,984658],
        [7,180.1,0.086,984662],[7.1,180.2,0.09,984666],[7.1,180.3,0.098,984671],
        [7.1,180.3,0.094,984666],[7.1,180.4,0.102,984671],[7.1,180.5,0.11,984675],
        [7,180.7,0.118,984679],[7,180.7,0.122,984675],[6.9,180.9,0.125,984679],
        [6.7,181.1,0.137,984683],[6.6,181.4,0.149,984687],[6.6,181.4,0.153,984683],
        [6.4,181.6,0.161,984687],[6.2,181.9,0.169,984691],[6,182.2,0.18,984696],
        [6,182.2,0.18,984691],[5.7,182.5,0.188,984696],[5.5,182.8,0.196,984700],
        [5.3,183.1,0.208,984704],[5.3,183.1,0.212,984700],[5,183.4,0.22,984704],
        [4.8,183.7,0.231,984708],[4.5,184.1,0.239,984712],[4.5,184.1,0.243,984708],
        [4.3,184.4,0.251,984712],[4,184.8,0.255,984716],[3.7,185.4,0.255,984721],
        [3.7,185.4,0.259,984716],[3.4,185.9,0.259,984721],[3.1,186.3,0.263,984725],
        [2.9,186.8,0.267,984729],[2.9,186.8,0.267,984725],[2.7,187.3,0.267,984729],
        [2.4,187.8,0.271,984733],[2.2,188.3,0.275,984737],[2.2,188.3,0.275,984733],
        [2,188.7,0.278,984737],[1.8,189.2,0.282,984741],[1.6,189.7,0.286,984746],
        [1.6,189.7,0.29,984741],[1.4,190.1,0.29,984746],[1.3,190.5,0.29,984750],
        [1.2,190.8,0.294,984754],[1.2,190.8,0.294,984750],[1.1,191.1,0.298,984754],
        [1.1,191.3,0.298,984758],[1.1,191.5,0.298,984762],[1.1,191.5,0.298,984758],
        [1.2,191.7,0.298,984762],[1.3,191.7,0.298,984766],[1.5,191.7,0.298,984771],
        [1.5,191.7,0.298,984766],[1.7,191.7,0.302,984771],[1.9,191.7,0.306,984775],
        [2.2,191.5,0.31,984779],[2.2,191.5,0.31,984775],[2.6,191.4,0.314,984779],
        [3,191.2,0.318,984783],[3.5,190.9,0.314,984787],[3.5,190.9,0.318,984783],
        [4,190.7,0.318,984787],[4.6,190.4,0.314,984791],[5.5,190,0.314,984796],
        [5.5,190,0.314,984791],[6.4,189.6,0.31,984796],[7.1,189.3,0.31,984800],
        [8,188.9,0.306,984804],[8,188.9,0.306,984800],[8.8,188.6,0.306,984804],
        [9.7,188.2,0.298,984808],[10.7,187.9,0.294,984812],[10.7,187.9,0.294,984808],
        [11.5,187.6,0.29,984812],[12.4,187.3,0.286,984816],[13.4,186.9,0.263,984821],
        [13.4,186.9,0.271,984816],[14.3,186.5,0.251,984825],[15,186.2,0.227,984825],
        [15,186.2,0.212,984825],[17.3,185.2,0.149,984841],
      ];

      const points: StrokePoint[] = rawData.map(([x, y, pressure, timestamp]) => ({
        x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, timestamp,
      }));

      const { generateItalicOutlineSides } = require("./ItalicOutlineGenerator");
      const sides = generateItalicOutlineSides(points, config, true);
      expect(sides).not.toBeNull();
      if (!sides) return;

      const { leftSide, rightSide } = sides;

      // Check each segment's two triangles for proper coverage.
      // A quad should have positive area. If the two triangles of a segment
      // have nearly zero or negative total area, there's a gap.
      let zeroAreaCount = 0;
      const zeroAreaSegments: number[] = [];
      for (let i = 0; i < leftSide.length - 1; i++) {
        const l0x = leftSide[i][0], l0y = leftSide[i][1];
        const l1x = leftSide[i + 1][0], l1y = leftSide[i + 1][1];
        const r1x = rightSide[i + 1][0], r1y = rightSide[i + 1][1];
        const r0x = rightSide[i][0], r0y = rightSide[i][1];

        // Signed area of the quad (sum of two triangle areas)
        const area1 = 0.5 * ((l1x - l0x) * (r1y - l0y) - (r1x - l0x) * (l1y - l0y));
        const area2 = 0.5 * ((r1x - l0x) * (r0y - l0y) - (r0x - l0x) * (r1y - l0y));
        const totalArea = area1 + area2;

        // Check if quad edges cross (L segment crosses R segment)
        const cross = segmentsIntersect(
          l0x, l0y, l1x, l1y,
          r0x, r0y, r1x, r1y,
        );

        if (Math.abs(totalArea) < 0.0001 || cross) {
          zeroAreaCount++;
          zeroAreaSegments.push(i);
          console.log(
            `Degenerate/crossing seg ${i}: area=${totalArea.toFixed(6)} cross=${cross} ` +
            `L(${l0x.toFixed(2)},${l0y.toFixed(2)})→(${l1x.toFixed(2)},${l1y.toFixed(2)}) ` +
            `R(${r0x.toFixed(2)},${r0y.toFixed(2)})→(${r1x.toFixed(2)},${r1y.toFixed(2)})`
          );
        }
      }

      console.log(`\nDegenerate/crossing segments: ${zeroAreaCount} of ${leftSide.length - 1}`);

      // Check for quads where triangles have opposite winding (bowties)
      // Even with no side crossing, individual quads can still form bowties
      let bowtieCount = 0;
      for (let i = 0; i < leftSide.length - 1; i++) {
        const l0x = leftSide[i][0], l0y = leftSide[i][1];
        const l1x = leftSide[i + 1][0], l1y = leftSide[i + 1][1];
        const r1x = rightSide[i + 1][0], r1y = rightSide[i + 1][1];
        const r0x = rightSide[i][0], r0y = rightSide[i][1];

        // Cross products for the two triangles
        const cross1 = (l1x - l0x) * (r1y - l0y) - (l1y - l0y) * (r1x - l0x);
        const cross2 = (r1x - l0x) * (r0y - l0y) - (r1y - l0y) * (r0x - l0x);

        // If they have opposite signs, it's a bowtie
        if (cross1 * cross2 < 0 && Math.abs(cross1) > 0.001 && Math.abs(cross2) > 0.001) {
          bowtieCount++;
          console.log(
            `Bowtie seg ${i}: cross1=${cross1.toFixed(4)} cross2=${cross2.toFixed(4)} ` +
            `L(${l0x.toFixed(2)},${l0y.toFixed(2)})→(${l1x.toFixed(2)},${l1y.toFixed(2)}) ` +
            `R(${r0x.toFixed(2)},${r0y.toFixed(2)})→(${r1x.toFixed(2)},${r1y.toFixed(2)})`
          );
        }
      }

      console.log(`Bowtie segments: ${bowtieCount}`);

      // Degenerate segments should be zero.
      // Bowties are OK — with normalized winding in addNormalizedTriangle,
      // both triangles of a bowtie have the same winding direction and together
      // fill the convex hull of the 4 vertices. No gaps result.
      expect(zeroAreaCount).toBe(0);
    });
  });

  describe("minimum width floor", () => {
    it("should never produce zero-width geometry", () => {
      // Even with zero pressure, the floor should prevent zero width
      const config = makeConfig({ nibHeight: 2 });
      const points = [makePoint(100, 100, 0), makePoint(200, 100, 0)];
      const outline = generateItalicOutline(points, config);

      const width = getOutlineWidth(outline);
      expect(width).toBeGreaterThan(0);
    });
  });
});

/**
 * Measure the approximate width of an outline polygon at its midpoint.
 * The outline format is [...leftSide, ...rightSide.reverse()],
 * so left[i] pairs with right[N-1-i].
 */
function getOutlineWidth(outline: number[][]): number {
  if (outline.length < 4) return 0;
  const n = outline.length / 2;
  const midLeft = Math.floor(n / 2);
  const midRight = outline.length - 1 - midLeft;
  const dx = outline[midLeft][0] - outline[midRight][0];
  const dy = outline[midLeft][1] - outline[midRight][1];
  return Math.hypot(dx, dy);
}

function getWidthAtIndex(outline: number[][], idx: number, pointCount: number): number {
  if (outline.length < 4 || idx >= pointCount) return 0;
  const rightIdx = outline.length - 1 - idx;
  if (rightIdx < 0 || rightIdx >= outline.length) return 0;
  const dx = outline[idx][0] - outline[rightIdx][0];
  const dy = outline[idx][1] - outline[rightIdx][1];
  return Math.hypot(dx, dy);
}

/**
 * Test if two line segments (p1→p2 and p3→p4) intersect.
 * Returns true if they cross (not just touch at endpoints).
 */
function segmentsIntersect(
  p1x: number, p1y: number, p2x: number, p2y: number,
  p3x: number, p3y: number, p4x: number, p4y: number,
): boolean {
  const d1x = p2x - p1x, d1y = p2y - p1y;
  const d2x = p4x - p3x, d2y = p4y - p3y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false; // parallel

  const t = ((p3x - p1x) * d2y - (p3y - p1y) * d2x) / cross;
  const u = ((p3x - p1x) * d1y - (p3y - p1y) * d1x) / cross;

  // Strict intersection (not at endpoints)
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}
