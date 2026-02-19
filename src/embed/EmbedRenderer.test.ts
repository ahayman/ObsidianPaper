import { renderEmbed, getDocumentAspectRatio } from "./EmbedRenderer";
import { createEmptyDocument } from "../document/Document";
import { serializeDocument } from "../document/Serializer";
import { encodePoints } from "../document/PointEncoder";
import type { StrokePoint, PaperDocument } from "../types";

// Path2D polyfill for jsdom
if (typeof globalThis.Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    moveTo() {}
    lineTo() {}
    closePath() {}
  };
}

function createMockCtx(): CanvasRenderingContext2D {
  return {
    setTransform: jest.fn(),
    scale: jest.fn(),
    translate: jest.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillRect: jest.fn(),
    fill: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    clearRect: jest.fn(),
    beginPath: jest.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = createMockCtx();
  canvas.getContext = jest.fn().mockReturnValue(ctx);
  return canvas;
}

function makePoint(x: number, y: number): StrokePoint {
  return { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, timestamp: 0 };
}

function makeDocWithStrokes(): string {
  const doc = createEmptyDocument();
  const points = [makePoint(100, 100), makePoint(200, 100), makePoint(200, 200)];
  doc.strokes.push({
    id: "s1",
    style: "_default",
    bbox: [100, 100, 200, 200],
    pointCount: 3,
    pts: encodePoints(points),
  });
  return serializeDocument(doc);
}

describe("EmbedRenderer", () => {
  describe("renderEmbed", () => {
    it("should render empty document without error", () => {
      const canvas = createMockCanvas();
      const data = serializeDocument(createEmptyDocument());

      expect(() => renderEmbed(canvas, data, false, 400)).not.toThrow();
    });

    it("should render dark mode without error", () => {
      const canvas = createMockCanvas();
      const data = serializeDocument(createEmptyDocument());

      expect(() => renderEmbed(canvas, data, true, 400)).not.toThrow();
    });

    it("should render document with strokes without error", () => {
      const canvas = createMockCanvas();
      const data = makeDocWithStrokes();

      expect(() => renderEmbed(canvas, data, false, 600)).not.toThrow();
    });

    it("should set canvas dimensions", () => {
      const canvas = createMockCanvas();
      const data = serializeDocument(createEmptyDocument());

      renderEmbed(canvas, data, false, 400);

      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
    });

    it("should set canvas dimensions for document with strokes", () => {
      const canvas = createMockCanvas();
      const data = makeDocWithStrokes();

      renderEmbed(canvas, data, false, 600);

      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
      expect(canvas.width).toBeLessThanOrEqual(600);
    });

    it("should handle invalid data gracefully", () => {
      const canvas = createMockCanvas();
      expect(() => renderEmbed(canvas, "", false, 400)).not.toThrow();
      expect(() => renderEmbed(canvas, "invalid json", false, 400)).not.toThrow();
    });
  });

  describe("getDocumentAspectRatio", () => {
    it("should return canvas aspect ratio for empty document", () => {
      const data = serializeDocument(createEmptyDocument());
      const ratio = getDocumentAspectRatio(data);
      // Default canvas is 2048x2732
      expect(ratio).toBeCloseTo(2048 / 2732, 2);
    });

    it("should return content aspect ratio for document with strokes", () => {
      const data = makeDocWithStrokes();
      const ratio = getDocumentAspectRatio(data);
      // Content is 100x100 (100,100 to 200,200)
      expect(ratio).toBeCloseTo(1, 1);
    });
  });
});
