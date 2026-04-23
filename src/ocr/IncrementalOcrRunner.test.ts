import type { PaperDocument, Stroke } from "../types";
import { createEmptyDocument } from "../document/Document";
import { OCR_RESULT_VERSION, type OcrResult } from "../document/PaperMdSerializer";
import { runIncrementalOcr, attachStrokeIdsToLines, type PageRasterizer } from "./IncrementalOcrRunner";
import type { OcrBackend, OcrDocumentInput } from "./OcrBackend";

/** Stub rasterizer — returns a 1x1 PNG blob. Lets us skip jsdom canvas. */
const fakeRasterize: PageRasterizer = async (doc, pageIndex) => {
  const strokes = doc.strokes.filter((s) => s.pageIndex === pageIndex);
  if (strokes.length === 0) return null;
  return { pageIndex, blob: new Blob([new Uint8Array([0x89])], { type: "image/png" }) };
};

function mkStroke(id: string, pageIndex: number, minY: number = 100, maxY: number = 120): Stroke {
  return {
    id,
    pageIndex,
    style: "_default",
    bbox: [0, minY, 500, maxY],
    pointCount: 1,
    pts: "0,0,128,128,128,0,0",
  };
}

function mkDoc(pages: number, strokes: Stroke[]): PaperDocument {
  const doc = createEmptyDocument();
  // Ensure `pages` pages exist
  while (doc.pages.length < pages) {
    doc.pages.push({
      ...doc.pages[0],
      id: `p${doc.pages.length}`,
    });
  }
  doc.strokes = strokes;
  return doc;
}

class FakeBackend implements OcrBackend {
  readonly id = "handwriting-ocr" as const;
  calls: OcrDocumentInput[] = [];
  textPerPageIndex = new Map<number, string[]>();

  isConfigured(): boolean {
    return true;
  }
  testConnection(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }
  async recognizeDocument(input: OcrDocumentInput): Promise<OcrResult> {
    this.calls.push(input);
    return {
      v: OCR_RESULT_VERSION,
      backend: this.id,
      pages: input.pages.map((p) => ({
        pageIndex: p.pageIndex,
        lines: (this.textPerPageIndex.get(p.pageIndex) ?? [`page ${p.pageIndex} text`]).map(
          (text, i) => ({ id: `L-${p.pageIndex}-${i}`, text }),
        ),
      })),
    };
  }
}

describe("runIncrementalOcr", () => {
  it("recognizes every non-empty page on first run", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0), mkStroke("s2", 1)]);
    const backend = new FakeBackend();

    const { ocr, pagesRecognized, pagesReused, pagesEmpty } = await runIncrementalOcr({
      document: doc,
      previous: null,
      backend,
      rasterize: fakeRasterize,
    });

    expect(pagesRecognized).toBe(2);
    expect(pagesReused).toBe(0);
    expect(pagesEmpty).toBe(0);
    expect(ocr.pages).toHaveLength(2);
    expect(ocr.pages[0].pageStrokeIds).toEqual(["s1"]);
    expect(ocr.pages[1].pageStrokeIds).toEqual(["s2"]);
    expect(backend.calls).toHaveLength(2);
  });

  it("skips pages with no strokes", async () => {
    const doc = mkDoc(3, [mkStroke("s1", 1)]);
    const backend = new FakeBackend();

    const { pagesRecognized, pagesEmpty } = await runIncrementalOcr({
      document: doc,
      previous: null,
      backend,
      rasterize: fakeRasterize,
    });

    expect(pagesRecognized).toBe(1);
    expect(pagesEmpty).toBe(2);
    expect(backend.calls).toHaveLength(1);
  });

  it("reuses pages with identical stroke sets", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0), mkStroke("s2", 1)]);
    const backend = new FakeBackend();
    const firstRun = await runIncrementalOcr({ document: doc, previous: null, backend, rasterize: fakeRasterize });

    backend.calls = [];

    // Run again with no changes.
    const secondRun = await runIncrementalOcr({
      document: doc,
      previous: firstRun.ocr,
      backend,
    });

    expect(secondRun.pagesRecognized).toBe(0);
    expect(secondRun.pagesReused).toBe(2);
    expect(backend.calls).toHaveLength(0);
    // Text should match what the first run produced.
    expect(secondRun.ocr.pages[0].lines[0].text).toBe(firstRun.ocr.pages[0].lines[0].text);
  });

  it("re-recognizes pages with changed stroke sets", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0), mkStroke("s2", 1)]);
    const backend = new FakeBackend();
    const firstRun = await runIncrementalOcr({ document: doc, previous: null, backend, rasterize: fakeRasterize });
    backend.calls = [];

    // Add a stroke to page 1.
    doc.strokes.push(mkStroke("s3", 1, 200, 220));

    const secondRun = await runIncrementalOcr({
      document: doc,
      previous: firstRun.ocr,
      backend,
      rasterize: fakeRasterize,
    });

    expect(secondRun.pagesRecognized).toBe(1);
    expect(secondRun.pagesReused).toBe(1);
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].pages[0].pageIndex).toBe(1);
    // Page 1's stroke IDs should now include s3.
    const page1 = secondRun.ocr.pages.find((p) => p.pageIndex === 1);
    expect(page1?.pageStrokeIds).toEqual(["s2", "s3"]);
  });

  it("recognizes a newly non-empty page (previously empty)", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0)]);
    const backend = new FakeBackend();
    const firstRun = await runIncrementalOcr({ document: doc, previous: null, backend, rasterize: fakeRasterize });
    backend.calls = [];

    doc.strokes.push(mkStroke("s2", 1));

    const secondRun = await runIncrementalOcr({
      document: doc,
      previous: firstRun.ocr,
      backend,
      rasterize: fakeRasterize,
    });

    expect(secondRun.pagesRecognized).toBe(1);
    expect(secondRun.pagesReused).toBe(1);
  });

  it("orders output pages by pageIndex", async () => {
    // Force out-of-order by recognizing page 1 fresh while page 0 is reused.
    const doc = mkDoc(2, [mkStroke("s1", 0), mkStroke("s2", 1)]);
    const backend = new FakeBackend();
    const first = await runIncrementalOcr({ document: doc, previous: null, backend, rasterize: fakeRasterize });

    doc.strokes = [mkStroke("s1", 0), mkStroke("s3", 1, 400, 420)];
    const second = await runIncrementalOcr({ document: doc, previous: first.ocr, backend, rasterize: fakeRasterize });

    expect(second.ocr.pages.map((p) => p.pageIndex)).toEqual([0, 1]);
  });
});

describe("attachStrokeIdsToLines", () => {
  it("zips strokeIds per line when counts match", () => {
    const strokes = [mkStroke("a", 0, 100, 120), mkStroke("b", 0, 200, 220)];
    const lines = [
      { id: "L-0-0", text: "line one" },
      { id: "L-0-1", text: "line two" },
    ];
    const result = attachStrokeIdsToLines(lines, strokes);
    expect(result[0].strokeIds).toEqual(["a"]);
    expect(result[1].strokeIds).toEqual(["b"]);
  });

  it("leaves strokeIds undefined when cluster count doesn't match line count", () => {
    const strokes = [mkStroke("a", 0, 100, 120)];
    const lines = [
      { id: "L-0-0", text: "one" },
      { id: "L-0-1", text: "two" },
    ];
    const result = attachStrokeIdsToLines(lines, strokes);
    expect(result[0].strokeIds).toBeUndefined();
    expect(result[1].strokeIds).toBeUndefined();
  });
});
