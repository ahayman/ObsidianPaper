import type { PaperDocument, PenStyle, Stroke } from "../types";
import { createEmptyDocument } from "./Document";
import { serializeDocument, deserializeDocument } from "./Serializer";

describe("Serializer", () => {
  describe("round-trip serialize/deserialize", () => {
    it("should round-trip an empty document", () => {
      const doc = createEmptyDocument("0.1.0");
      const json = serializeDocument(doc);
      const restored = deserializeDocument(json);

      expect(restored.version).toBe(3);
      expect(restored.pages[0].size.width).toBe(doc.pages[0].size.width);
      expect(restored.pages[0].size.height).toBe(doc.pages[0].size.height);
      expect(restored.pages[0].paperType).toBe(doc.pages[0].paperType);
      expect(restored.channels).toEqual(doc.channels);
      expect(restored.strokes).toEqual([]);
      expect(restored.styles._default).toBeDefined();
    });

    it("should round-trip a document with strokes", () => {
      const doc = createEmptyDocument();
      const stroke: Stroke = {
        id: "s12345",
        pageIndex: 0,
        style: "_default",
        bbox: [100, 200, 350, 280],
        pointCount: 3,
        pts: "1000,2000,128,128,128,0,1000;18,25,25,0,1,16;-5,30,7,-1,1,17",
      };
      doc.strokes.push(stroke);

      const json = serializeDocument(doc);
      const restored = deserializeDocument(json);

      expect(restored.strokes).toHaveLength(1);
      expect(restored.strokes[0].id).toBe("s12345");
      expect(restored.strokes[0].style).toBe("_default");
      expect(restored.strokes[0].bbox).toEqual([100, 200, 350, 280]);
      expect(restored.strokes[0].pointCount).toBe(3);
      expect(restored.strokes[0].pts).toBe(stroke.pts);
    });

    it("should round-trip style overrides", () => {
      const doc = createEmptyDocument();
      const stroke: Stroke = {
        id: "s1",
        pageIndex: 0,
        style: "_default",
        styleOverrides: { width: 5.0 },
        bbox: [0, 0, 100, 100],
        pointCount: 1,
        pts: "0,0,128,128,128,0,0",
      };
      doc.strokes.push(stroke);

      const json = serializeDocument(doc);
      const restored = deserializeDocument(json);

      expect(restored.strokes[0].styleOverrides).toEqual({ width: 5.0 });
    });

    it("should round-trip transforms", () => {
      const doc = createEmptyDocument();
      const stroke: Stroke = {
        id: "s1",
        pageIndex: 0,
        style: "_default",
        bbox: [0, 0, 100, 100],
        pointCount: 1,
        pts: "0,0,128,128,128,0,0",
        transform: [1, 0, 0, 1, 10, 20],
      };
      doc.strokes.push(stroke);

      const json = serializeDocument(doc);
      const restored = deserializeDocument(json);

      expect(restored.strokes[0].transform).toEqual([1, 0, 0, 1, 10, 20]);
    });

    it("should round-trip custom styles", () => {
      const doc = createEmptyDocument();
      const blueStyle: PenStyle = {
        pen: "brush",
        color: "#2563eb|#60a5fa",
        colorDark: "#60a5fa",
        width: 8,
        opacity: 1,
        smoothing: 0.6,
        pressureCurve: 1,
        tiltSensitivity: 0,
      };
      doc.styles["my-blue"] = blueStyle;

      const json = serializeDocument(doc);
      const restored = deserializeDocument(json);

      expect(restored.styles["my-blue"]).toBeDefined();
      expect(restored.styles["my-blue"].pen).toBe("brush");
      expect(restored.styles["my-blue"].color).toBe("#2563eb|#60a5fa");
      expect(restored.styles["my-blue"].colorDark).toBe("#60a5fa");
      expect(restored.styles["my-blue"].width).toBe(8);
    });

    it("should preserve viewport state", () => {
      const doc = createEmptyDocument();
      doc.viewport = { x: 100, y: 200, zoom: 1.5 };

      const json = serializeDocument(doc);
      const restored = deserializeDocument(json);

      expect(restored.viewport.x).toBe(100);
      expect(restored.viewport.y).toBe(200);
      expect(restored.viewport.zoom).toBe(1.5);
    });
  });

  describe("deserialize edge cases", () => {
    it("should return empty document for empty string", () => {
      const doc = deserializeDocument("");
      expect(doc.version).toBe(3);
      expect(doc.strokes).toEqual([]);
    });

    it("should return empty document for invalid JSON", () => {
      const doc = deserializeDocument("not json {{{");
      expect(doc.version).toBe(3);
      expect(doc.strokes).toEqual([]);
    });

    it("should return empty document for future version", () => {
      const doc = deserializeDocument(JSON.stringify({ v: 999 }));
      expect(doc.version).toBe(3);
      expect(doc.strokes).toEqual([]);
    });

    it("should handle missing optional fields gracefully", () => {
      // v1 data is rejected (< 3), so we get an empty document back
      const minimal = JSON.stringify({
        v: 1,
        meta: { created: 1000, app: "0.1.0" },
      });
      const doc = deserializeDocument(minimal);
      // Returns fresh empty document since v1 < 3
      expect(doc.version).toBe(3);
      expect(doc.strokes).toEqual([]);
      expect(doc.pages).toHaveLength(1);
      expect(doc.channels).toEqual(["x", "y", "p", "tx", "ty", "tw", "t"]);
    });
  });

  describe("serialized format", () => {
    it("should use compact keys in JSON output", () => {
      const doc = createEmptyDocument();
      const json = serializeDocument(doc);
      const parsed = JSON.parse(json);

      // Top-level compact keys
      expect(parsed.v).toBe(3);
      // Pages array with compact keys
      expect(parsed.pages).toHaveLength(1);
      expect(parsed.pages[0].w).toBe(612);   // US letter width
      expect(parsed.pages[0].h).toBe(792);   // US letter height
    });

    it("should use compact stroke keys", () => {
      const doc = createEmptyDocument();
      doc.strokes.push({
        id: "s1",
        pageIndex: 0,
        style: "_default",
        bbox: [0, 0, 100, 100],
        pointCount: 1,
        pts: "0,0,0,0,0,0,0",
      });
      const json = serializeDocument(doc);
      const parsed = JSON.parse(json);

      expect(parsed.strokes[0].st).toBe("_default");
      expect(parsed.strokes[0].pg).toBe(0);
      expect(parsed.strokes[0].bb).toEqual([0, 0, 100, 100]);
      expect(parsed.strokes[0].n).toBe(1);
    });
  });
});
