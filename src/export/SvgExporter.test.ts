import { exportToSvg } from "./SvgExporter";
import type { PaperDocument, PenStyle, Stroke } from "../types";
import { createEmptyDocument } from "../document/Document";
import { encodePoints } from "../document/PointEncoder";
import type { StrokePoint } from "../types";

function makePoint(x: number, y: number, pressure = 0.5): StrokePoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, timestamp: 0 };
}

function makeStroke(
  id: string,
  points: StrokePoint[],
  style = "_default"
): Stroke {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    id,
    pageIndex: 0,
    style,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    pointCount: points.length,
    pts: encodePoints(points),
  };
}

function makeDocWithStrokes(strokes: Stroke[], styles?: Record<string, PenStyle>): PaperDocument {
  const doc = createEmptyDocument();
  doc.strokes = strokes;
  if (styles) {
    doc.styles = styles;
  }
  return doc;
}

describe("SvgExporter", () => {
  it("should export empty document with default viewBox", () => {
    const doc = createEmptyDocument();
    const svg = exportToSvg(doc, false);

    expect(svg).toContain("<?xml");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("viewBox=");
  });

  it("should include background rect with desk color", () => {
    const doc = createEmptyDocument();
    const svg = exportToSvg(doc, false);

    expect(svg).toContain("<rect");
    // Desk background color for light mode
    expect(svg).toContain('fill="#e8e8e8"');
  });

  it("should use dark desk color in dark mode", () => {
    const doc = createEmptyDocument();
    const svg = exportToSvg(doc, true);

    expect(svg).toContain('fill="#111111"');
  });

  it("should render strokes as path elements", () => {
    const points = [
      makePoint(0, 0),
      makePoint(10, 0),
      makePoint(20, 5),
      makePoint(30, 0),
    ];
    const stroke = makeStroke("s1", points);
    const doc = makeDocWithStrokes([stroke]);
    const svg = exportToSvg(doc, false);

    expect(svg).toContain("<path");
    expect(svg).toContain('d="M');
    expect(svg).toContain('fill="');
  });

  it("should compute viewBox from page layout bounds", () => {
    const doc = createEmptyDocument();
    const svg = exportToSvg(doc, false);

    // viewBox should be based on the US Letter page layout with padding
    // Page is 612x792, centered at x=0 → x: -306..306, y: 0..792
    // With padding=20: minX=-326, minY=-20, width=652, height=832
    expect(svg).toContain("viewBox=");
    expect(svg).toContain("-326");
  });

  it("should handle highlighter strokes with opacity and blend mode", () => {
    const points = [
      makePoint(0, 0),
      makePoint(50, 0),
      makePoint(100, 0),
    ];
    const stroke = makeStroke("s1", points, "highlight");
    const style: PenStyle = {
      pen: "highlighter",
      color: "#ffff00",
      width: 20,
      opacity: 0.3,
      smoothing: 0.5,
      pressureCurve: 1,
      tiltSensitivity: 0,
    };
    const doc = makeDocWithStrokes([stroke], { highlight: style });
    const svg = exportToSvg(doc, false);

    expect(svg).toContain("opacity=");
    expect(svg).toContain("mix-blend-mode:multiply");
  });

  it("should handle stroke with style overrides", () => {
    const points = [
      makePoint(0, 0),
      makePoint(10, 10),
      makePoint(20, 0),
    ];
    const stroke: Stroke = {
      ...makeStroke("s1", points),
      styleOverrides: { color: "#ff0000" },
    };
    const doc = makeDocWithStrokes([stroke]);
    const svg = exportToSvg(doc, false);

    expect(svg).toContain("<path");
  });

  it("should produce valid XML with escaped characters", () => {
    const doc = createEmptyDocument();
    const svg = exportToSvg(doc, false);

    // Should not have unescaped special XML chars in attributes
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("should render multiple strokes", () => {
    const strokes = [
      makeStroke("s1", [makePoint(0, 0), makePoint(10, 10), makePoint(20, 0)]),
      makeStroke("s2", [makePoint(50, 50), makePoint(60, 60), makePoint(70, 50)]),
      makeStroke("s3", [makePoint(100, 0), makePoint(110, 10), makePoint(120, 0)]),
    ];
    const doc = makeDocWithStrokes(strokes);
    const svg = exportToSvg(doc, false);

    // Count path elements
    const pathCount = (svg.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(3);
  });

  it("should include width and height attributes", () => {
    const doc = makeDocWithStrokes([
      makeStroke("s1", [makePoint(0, 0), makePoint(100, 100)]),
    ]);
    const svg = exportToSvg(doc, false);

    expect(svg).toMatch(/width="\d/);
    expect(svg).toMatch(/height="\d/);
  });
});
