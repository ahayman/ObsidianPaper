import type { Stroke } from "../types";
import { createEmptyDocument } from "../document/Document";
import {
  firstPageHash,
  thumbnailPathFor,
  thumbnailFrontmatterValue,
  shortHash,
} from "./ThumbnailGenerator";

function mkStroke(id: string, pageIndex: number, bbox: [number, number, number, number]): Stroke {
  return {
    id,
    pageIndex,
    style: "_default",
    bbox,
    pointCount: 3,
    pts: "0,0,0,0,0,0,0",
  };
}

describe("firstPageHash", () => {
  it("returns 'blank' when the first page has no strokes", () => {
    const doc = createEmptyDocument();
    expect(firstPageHash(doc)).toBe("blank");
  });

  it("returns 'empty' when the doc has no pages", () => {
    const doc = createEmptyDocument();
    doc.pages = [];
    expect(firstPageHash(doc)).toBe("empty");
  });

  it("produces stable hash regardless of stroke order", () => {
    const doc = createEmptyDocument();
    doc.strokes.push(mkStroke("a", 0, [0, 0, 10, 10]));
    doc.strokes.push(mkStroke("b", 0, [20, 20, 30, 30]));
    const hashA = firstPageHash(doc);

    doc.strokes.reverse();
    const hashB = firstPageHash(doc);
    expect(hashA).toBe(hashB);
  });

  it("hash changes when a stroke's bbox changes", () => {
    const doc = createEmptyDocument();
    doc.strokes.push(mkStroke("a", 0, [0, 0, 10, 10]));
    const h1 = firstPageHash(doc);

    doc.strokes[0].bbox = [5, 5, 15, 15];
    const h2 = firstPageHash(doc);
    expect(h1).not.toBe(h2);
  });

  it("ignores strokes on later pages", () => {
    const doc = createEmptyDocument();
    doc.strokes.push(mkStroke("a", 0, [0, 0, 10, 10]));
    const hashWithoutPage2 = firstPageHash(doc);

    doc.strokes.push(mkStroke("b", 1, [0, 0, 10, 10]));
    const hashWithPage2 = firstPageHash(doc);

    expect(hashWithoutPage2).toBe(hashWithPage2);
  });
});

describe("thumbnailPathFor", () => {
  it("puts the thumbnail in <folder>/<sub>/<name>.paper.png for a nested file", () => {
    expect(thumbnailPathFor("notes/journal/today.paper.md", "attachments"))
      .toBe("notes/journal/attachments/today.paper.png");
  });

  it("puts the thumbnail at the vault root when source is root and sub is empty", () => {
    expect(thumbnailPathFor("today.paper.md", "")).toBe("today.paper.png");
  });

  it("handles root-level file with subfolder", () => {
    expect(thumbnailPathFor("today.paper.md", "attachments"))
      .toBe("attachments/today.paper.png");
  });

  it("strips leading/trailing slashes from the subfolder", () => {
    expect(thumbnailPathFor("notes/foo.paper.md", "/assets/"))
      .toBe("notes/assets/foo.paper.png");
  });

  it("is case insensitive on the .paper.md suffix", () => {
    expect(thumbnailPathFor("notes/Foo.PAPER.MD", "att"))
      .toBe("notes/att/Foo.paper.png");
  });
});

describe("thumbnailFrontmatterValue", () => {
  it("produces a single-item list with a wikilink string", () => {
    expect(thumbnailFrontmatterValue("attachments/foo.paper.png"))
      .toEqual(["[[attachments/foo.paper.png]]"]);
  });
});

describe("shortHash", () => {
  it("returns 8 hex chars", () => {
    expect(shortHash("hello")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic", () => {
    expect(shortHash("same input")).toBe(shortHash("same input"));
  });

  it("different inputs yield different hashes (usually)", () => {
    expect(shortHash("a")).not.toBe(shortHash("b"));
  });
});
