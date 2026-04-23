import { buildTranscript } from "./TranscriptBuilder";
import { OCR_RESULT_VERSION } from "../document/PaperMdSerializer";

describe("buildTranscript", () => {
  it("returns empty string for null", () => {
    expect(buildTranscript(null)).toBe("");
  });

  it("renders one section per non-empty page", () => {
    const out = buildTranscript({
      v: OCR_RESULT_VERSION,
      backend: "handwriting-ocr",
      pages: [
        {
          pageIndex: 0,
          lines: [
            { id: "L-0-0", text: "hello" },
            { id: "L-0-1", text: "world" },
          ],
        },
        {
          pageIndex: 1,
          lines: [{ id: "L-1-0", text: "second page" }],
        },
      ],
    });
    expect(out).toBe("## Page 1\nhello\nworld\n\n## Page 2\nsecond page");
  });

  it("skips pages with no non-empty lines", () => {
    const out = buildTranscript({
      v: OCR_RESULT_VERSION,
      backend: "handwriting-ocr",
      pages: [
        { pageIndex: 0, lines: [] },
        { pageIndex: 1, lines: [{ id: "L-1-0", text: "   " }] },
        { pageIndex: 2, lines: [{ id: "L-2-0", text: "actual" }] },
      ],
    });
    expect(out).toBe("## Page 3\nactual");
  });
});
