import type { PaperDocument, Stroke } from "../types";
import { createEmptyDocument } from "../document/Document";
import { pageFingerprint, documentPageFingerprints, dirtyPageIndices } from "./PageFingerprint";

function mkStroke(id: string, pageIndex: number): Stroke {
  return {
    id,
    pageIndex,
    style: "_default",
    bbox: [0, 0, 100, 100],
    pointCount: 2,
    pts: "0,0,128,128,128,0,0;10,10,0,0,0,0,16",
  };
}

function mkDoc(pageCount: number, strokes: Stroke[]): PaperDocument {
  const doc = createEmptyDocument();
  while (doc.pages.length < pageCount) {
    doc.pages.push({ ...doc.pages[0], id: `p${doc.pages.length}` });
  }
  doc.strokes = strokes;
  return doc;
}

describe("pageFingerprint", () => {
  it("returns empty string for a blank page", () => {
    const doc = mkDoc(2, [mkStroke("a", 0)]);
    expect(pageFingerprint(doc, 1)).toBe("");
  });

  it("is stable across stroke insertion order", () => {
    const doc1 = mkDoc(1, [mkStroke("a", 0), mkStroke("b", 0)]);
    const doc2 = mkDoc(1, [mkStroke("b", 0), mkStroke("a", 0)]);
    expect(pageFingerprint(doc1, 0)).toBe(pageFingerprint(doc2, 0));
  });

  it("changes when a stroke is added", () => {
    const before = mkDoc(1, [mkStroke("a", 0)]);
    const after = mkDoc(1, [mkStroke("a", 0), mkStroke("b", 0)]);
    expect(pageFingerprint(before, 0)).not.toBe(pageFingerprint(after, 0));
  });

  it("changes when a stroke is removed", () => {
    const before = mkDoc(1, [mkStroke("a", 0), mkStroke("b", 0)]);
    const after = mkDoc(1, [mkStroke("a", 0)]);
    expect(pageFingerprint(before, 0)).not.toBe(pageFingerprint(after, 0));
  });

  it("ignores strokes from other pages", () => {
    const docA = mkDoc(2, [mkStroke("a", 0)]);
    const docB = mkDoc(2, [mkStroke("a", 0), mkStroke("z", 1)]);
    expect(pageFingerprint(docA, 0)).toBe(pageFingerprint(docB, 0));
  });

  it("returns 8 hex chars for non-empty pages", () => {
    const doc = mkDoc(1, [mkStroke("a", 0)]);
    expect(pageFingerprint(doc, 0)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("documentPageFingerprints", () => {
  it("emits one entry per page in order", () => {
    const doc = mkDoc(3, [mkStroke("a", 0), mkStroke("b", 2)]);
    const fps = documentPageFingerprints(doc);
    expect(fps).toHaveLength(3);
    expect(fps[0]).not.toBe("");
    expect(fps[1]).toBe("");
    expect(fps[2]).not.toBe("");
  });
});

describe("dirtyPageIndices", () => {
  it("marks every non-empty page dirty when there's no previous record", () => {
    expect(dirtyPageIndices(["a", "", "c"], undefined)).toEqual([0, 2]);
  });

  it("marks pages with mismatched fp dirty", () => {
    expect(dirtyPageIndices(["a", "b", "c"], ["a", "X", "c"])).toEqual([1]);
  });

  it("marks new trailing pages dirty", () => {
    expect(dirtyPageIndices(["a", "b", "c"], ["a", "b"])).toEqual([2]);
  });

  it("never marks blank pages dirty", () => {
    expect(dirtyPageIndices(["", "", ""], undefined)).toEqual([]);
    expect(dirtyPageIndices(["a", "", "c"], ["a", "z", "c"])).toEqual([]);
  });

  it("returns [] when fps match exactly", () => {
    expect(dirtyPageIndices(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });
});
