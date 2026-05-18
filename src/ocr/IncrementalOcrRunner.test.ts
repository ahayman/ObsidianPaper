import type { PaperDocument, Stroke } from "../types";
import { createEmptyDocument } from "../document/Document";
import { OCR_RESULT_VERSION, type OcrResult } from "./OcrBackend";
import { runIncrementalOcr, countDirtyPages, type PageRasterizer } from "./IncrementalOcrRunner";
import type { OcrBackend, OcrDocumentInput } from "./OcrBackend";
import { documentPageFingerprints } from "./PageFingerprint";

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
  while (doc.pages.length < pages) {
    doc.pages.push({ ...doc.pages[0], id: `p${doc.pages.length}` });
  }
  doc.strokes = strokes;
  return doc;
}

class FakeBackend implements OcrBackend {
  readonly id = "handwriting-ocr" as const;
  readonly inputType = "image" as const;
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

    const { transcript, pageFingerprints, pagesRecognized, pagesReused, pagesEmpty } =
      await runIncrementalOcr({ document: doc, backend, rasterize: fakeRasterize });

    expect(pagesRecognized).toBe(2);
    expect(pagesReused).toBe(0);
    expect(pagesEmpty).toBe(0);
    expect(transcript).toContain("## Page 1");
    expect(transcript).toContain("## Page 2");
    expect(pageFingerprints).toHaveLength(2);
    expect(backend.calls).toHaveLength(2);
  });

  it("skips pages with no strokes", async () => {
    const doc = mkDoc(3, [mkStroke("s1", 1)]);
    const backend = new FakeBackend();

    const { pagesRecognized, pagesEmpty, transcript } = await runIncrementalOcr({
      document: doc,
      backend,
      rasterize: fakeRasterize,
    });

    expect(pagesRecognized).toBe(1);
    expect(pagesEmpty).toBe(2);
    expect(transcript).toContain("## Page 2");
    expect(transcript).not.toContain("## Page 1");
    expect(transcript).not.toContain("## Page 3");
    expect(backend.calls).toHaveLength(1);
  });

  it("reuses pages with identical fingerprints", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0), mkStroke("s2", 1)]);
    const backend = new FakeBackend();
    const first = await runIncrementalOcr({ document: doc, backend, rasterize: fakeRasterize });

    backend.calls = [];
    const second = await runIncrementalOcr({
      document: doc,
      previousPageFingerprints: first.pageFingerprints,
      previousTranscript: first.transcript,
      backend,
    });

    expect(second.pagesRecognized).toBe(0);
    expect(second.pagesReused).toBe(2);
    expect(backend.calls).toHaveLength(0);
    // Reused text matches what the first run produced.
    expect(second.transcript).toBe(first.transcript);
  });

  it("re-recognizes only the page whose fingerprint changed", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0), mkStroke("s2", 1)]);
    const backend = new FakeBackend();
    const first = await runIncrementalOcr({ document: doc, backend, rasterize: fakeRasterize });
    backend.calls = [];

    // Add a stroke to page 1 — page 0's fp is unchanged.
    doc.strokes.push(mkStroke("s3", 1, 200, 220));

    const second = await runIncrementalOcr({
      document: doc,
      previousPageFingerprints: first.pageFingerprints,
      previousTranscript: first.transcript,
      backend,
      rasterize: fakeRasterize,
    });

    expect(second.pagesRecognized).toBe(1);
    expect(second.pagesReused).toBe(1);
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].pages[0].pageIndex).toBe(1);
  });

  it("force=true ignores fingerprints and re-recognizes everything", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0), mkStroke("s2", 1)]);
    const backend = new FakeBackend();
    const first = await runIncrementalOcr({ document: doc, backend, rasterize: fakeRasterize });
    backend.calls = [];

    const second = await runIncrementalOcr({
      document: doc,
      previousPageFingerprints: first.pageFingerprints,
      previousTranscript: first.transcript,
      backend,
      force: true,
      rasterize: fakeRasterize,
    });

    expect(second.pagesRecognized).toBe(2);
    expect(second.pagesReused).toBe(0);
    expect(backend.calls).toHaveLength(2);
  });

  it("recognizes a newly non-empty page (previously empty)", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0)]);
    const backend = new FakeBackend();
    const first = await runIncrementalOcr({ document: doc, backend, rasterize: fakeRasterize });
    backend.calls = [];

    doc.strokes.push(mkStroke("s2", 1));

    const second = await runIncrementalOcr({
      document: doc,
      previousPageFingerprints: first.pageFingerprints,
      previousTranscript: first.transcript,
      backend,
      rasterize: fakeRasterize,
    });

    expect(second.pagesRecognized).toBe(1);
    expect(second.pagesReused).toBe(1);
  });

  it("emits transcript sections sorted by page index", async () => {
    const doc = mkDoc(3, [mkStroke("s1", 0), mkStroke("s2", 2)]);
    const backend = new FakeBackend();
    backend.textPerPageIndex.set(0, ["zero text"]);
    backend.textPerPageIndex.set(2, ["two text"]);

    const { transcript } = await runIncrementalOcr({
      document: doc,
      backend,
      rasterize: fakeRasterize,
    });

    const idx1 = transcript.indexOf("## Page 1");
    const idx3 = transcript.indexOf("## Page 3");
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx3).toBeGreaterThan(idx1);
  });

  it("returns fingerprints aligned with documentPageFingerprints", async () => {
    const doc = mkDoc(2, [mkStroke("s1", 0)]);
    const backend = new FakeBackend();
    const { pageFingerprints } = await runIncrementalOcr({
      document: doc,
      backend,
      rasterize: fakeRasterize,
    });
    expect(pageFingerprints).toEqual(documentPageFingerprints(doc));
  });
});

describe("countDirtyPages", () => {
  it("counts every non-empty page when there's no previous record", () => {
    const doc = mkDoc(3, [mkStroke("a", 0), mkStroke("b", 2)]);
    expect(countDirtyPages(doc, undefined)).toBe(2);
  });

  it("returns 0 when fingerprints match exactly", () => {
    const doc = mkDoc(2, [mkStroke("a", 0), mkStroke("b", 1)]);
    const fps = documentPageFingerprints(doc);
    expect(countDirtyPages(doc, fps)).toBe(0);
  });

  it("counts only the pages whose fp differs", () => {
    const doc = mkDoc(2, [mkStroke("a", 0), mkStroke("b", 1)]);
    const fps = documentPageFingerprints(doc);
    expect(countDirtyPages(doc, [fps[0], "stale"])).toBe(1);
  });
});
