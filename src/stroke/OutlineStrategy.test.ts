import { getOutlineStrategy } from "./OutlineStrategy";
import type { OutlineResult } from "./OutlineStrategy";
import { generateOutline, isItalicStyle, buildItalicConfig } from "./OutlineGenerator";
import { generateItalicOutlineSides } from "./ItalicOutlineGenerator";
import type { PenStyle, StrokePoint } from "../types";

// ─── Test fixtures ──────────────────────────────────────────

function makeStraightLine(n = 30): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i < n; i++) {
    points.push({
      x: 100 + i * 3,
      y: 200 + Math.sin(i * 0.2) * 2,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      timestamp: i * 16,
    });
  }
  return points;
}

const ballpointStyle: PenStyle = {
  pen: "ballpoint",
  color: "#1a1a1a",
  width: 2,
  opacity: 1,
  smoothing: 0.5,
  pressureCurve: 1,
  tiltSensitivity: 0,
};

const pencilStyle: PenStyle = {
  pen: "pencil",
  color: "#2d2d2d",
  width: 3,
  opacity: 0.85,
  smoothing: 0.4,
  pressureCurve: 1,
  tiltSensitivity: 0,
  grain: 0.5,
};

const fountainItalicStyle: PenStyle = {
  pen: "fountain",
  color: "#000000",
  width: 6,
  opacity: 1,
  smoothing: 0.5,
  pressureCurve: 0.8,
  tiltSensitivity: 0,
  nibAngle: Math.PI / 6,
  nibThickness: 0.25,
};

// To test italic strategy's fallback to standard, use a pen type
// whose PenConfig has no nibAngle/nibThickness (e.g., ballpoint).
// isItalicStyle() falls back to PenConfig defaults for the pen type,
// so fountain pen always resolves as italic. A ballpoint run through
// the italic strategy exercises the fallback path.
const nonItalicStyleForFallback: PenStyle = {
  pen: "ballpoint",
  color: "#000000",
  width: 6,
  opacity: 1,
  smoothing: 0.5,
  pressureCurve: 1.0,
  tiltSensitivity: 0,
};

const highlighterStyle: PenStyle = {
  pen: "highlighter",
  color: "#FFD700",
  width: 24,
  opacity: 0.3,
  smoothing: 0.8,
  pressureCurve: 1,
  tiltSensitivity: 0,
};

// ─── Tests ──────────────────────────────────────────────────

describe("OutlineStrategy", () => {
  const points = makeStraightLine();

  describe("standard strategy", () => {
    const strategy = getOutlineStrategy("standard");

    it("produces a non-italic result for ballpoint", () => {
      const result = strategy.generateOutline(points, ballpointStyle);
      expect(result).not.toBeNull();
      expect(result!.italic).toBe(false);
      expect(result!.outline).not.toBeNull();
      expect(result!.italicSides).toBeNull();
    });

    it("produces a non-italic result for pencil", () => {
      const result = strategy.generateOutline(points, pencilStyle);
      expect(result).not.toBeNull();
      expect(result!.italic).toBe(false);
    });

    it("produces a non-italic result for highlighter", () => {
      const result = strategy.generateOutline(points, highlighterStyle);
      expect(result).not.toBeNull();
      expect(result!.italic).toBe(false);
    });

    it("output matches generateOutline() directly", () => {
      const result = strategy.generateOutline(points, ballpointStyle)!;
      const direct = generateOutline(points, ballpointStyle);
      expect(result.outline).toEqual(direct);
    });

    it("returns null for empty points", () => {
      const result = strategy.generateOutline([], ballpointStyle);
      expect(result).toBeNull();
    });
  });

  describe("italic strategy", () => {
    const strategy = getOutlineStrategy("italic");

    it("produces italic result when style has nibAngle", () => {
      const result = strategy.generateOutline(points, fountainItalicStyle);
      expect(result).not.toBeNull();
      expect(result!.italic).toBe(true);
      expect(result!.italicSides).not.toBeNull();
      expect(result!.outline).toBeNull();
    });

    it("falls back to standard when style lacks nibAngle", () => {
      const result = strategy.generateOutline(points, nonItalicStyleForFallback);
      expect(result).not.toBeNull();
      expect(result!.italic).toBe(false);
      expect(result!.outline).not.toBeNull();
      expect(result!.italicSides).toBeNull();
    });

    it("italic output matches generateItalicOutlineSides() directly", () => {
      const result = strategy.generateOutline(points, fountainItalicStyle)!;
      const config = buildItalicConfig(fountainItalicStyle);
      const direct = generateItalicOutlineSides(points, config);
      expect(result.italicSides).toEqual(direct);
    });

    it("non-italic fallback matches generateOutline() directly", () => {
      const result = strategy.generateOutline(points, nonItalicStyleForFallback)!;
      const direct = generateOutline(points, nonItalicStyleForFallback);
      expect(result.outline).toEqual(direct);
    });

    it("returns null for empty points", () => {
      const result = strategy.generateOutline([], fountainItalicStyle);
      expect(result).toBeNull();
    });
  });

  describe("isItalicStyle integration", () => {
    it("ballpoint is not italic", () => {
      expect(isItalicStyle(ballpointStyle)).toBe(false);
    });

    it("fountain with nibAngle is italic", () => {
      expect(isItalicStyle(fountainItalicStyle)).toBe(true);
    });

    it("fountain pen is always italic (PenConfig defaults have nibAngle)", () => {
      // Fountain pen PenConfig has nibAngle: Math.PI/6, nibThickness: 0.25
      // isItalicStyle() falls back to these defaults even without explicit style props
      const minimalFountain: PenStyle = {
        pen: "fountain", color: "#000", width: 6, opacity: 1,
        smoothing: 0.5, pressureCurve: 0.8, tiltSensitivity: 0,
      };
      expect(isItalicStyle(minimalFountain)).toBe(true);
    });

    it("ballpoint is not italic even through italic strategy", () => {
      expect(isItalicStyle(nonItalicStyleForFallback)).toBe(false);
    });
  });
});
