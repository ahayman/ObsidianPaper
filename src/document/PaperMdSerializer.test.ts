import type { PaperDocument, PenStyle, Stroke } from "../types";
import { createEmptyDocument } from "./Document";
import {
  deserializePaperMd,
  serializePaperMd,
  PAPER_MD_VERSION,
} from "./PaperMdSerializer";

function makeStroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    id: "s12345",
    pageIndex: 0,
    style: "_default",
    bbox: [100, 200, 350, 280],
    pointCount: 3,
    pts: "1000,2000,128,128,128,0,1000;18,25,25,0,1,16;-5,30,7,-1,1,17",
    ...overrides,
  };
}

describe("PaperMdSerializer", () => {
  describe("round-trip", () => {
    it("round-trips an empty document", () => {
      const doc = createEmptyDocument("0.1.0");
      const md = serializePaperMd({ document: doc });
      const parsed = deserializePaperMd(md);

      expect(parsed.document.pages[0].size.width).toBe(doc.pages[0].size.width);
      expect(parsed.document.pages[0].size.height).toBe(doc.pages[0].size.height);
      expect(parsed.document.strokes).toEqual([]);
      expect(parsed.transcript).toBe("");
      expect(parsed.prelude).toBe("");
      expect(parsed.frontmatter["paper-version"]).toBe(PAPER_MD_VERSION);
    });

    it("round-trips a document with strokes", () => {
      const doc = createEmptyDocument();
      doc.strokes.push(makeStroke());

      const md = serializePaperMd({ document: doc });
      const parsed = deserializePaperMd(md);

      expect(parsed.document.strokes).toHaveLength(1);
      expect(parsed.document.strokes[0].id).toBe("s12345");
      expect(parsed.document.strokes[0].pts).toBe(doc.strokes[0].pts);
      expect(parsed.document.strokes[0].bbox).toEqual([100, 200, 350, 280]);
    });

    it("round-trips custom pen styles", () => {
      const doc = createEmptyDocument();
      const blue: PenStyle = {
        pen: "felt-tip",
        color: "#2563eb|#60a5fa",
        width: 8,
        opacity: 1,
        smoothing: 0.6,
        pressureCurve: 1,
        tiltSensitivity: 0,
      };
      doc.styles["my-blue"] = blue;

      const md = serializePaperMd({ document: doc });
      const parsed = deserializePaperMd(md);

      expect(parsed.document.styles["my-blue"]).toBeDefined();
      expect(parsed.document.styles["my-blue"].pen).toBe("felt-tip");
      expect(parsed.document.styles["my-blue"].width).toBe(8);
    });

    it("round-trips per-page OCR fingerprints in frontmatter", () => {
      const doc = createEmptyDocument();
      doc.strokes.push(makeStroke());

      const md = serializePaperMd({
        document: doc,
        frontmatter: {
          "paper-ocr-pages-fp": ["a1b2c3d4", "", "9c0d1e2f"],
          "paper-ocr": { backend: "handwriting-ocr", "last-run": "2026-04-24T12:00:00.000Z" },
        },
      });
      const parsed = deserializePaperMd(md);

      expect(parsed.frontmatter["paper-ocr-pages-fp"]).toEqual(["a1b2c3d4", "", "9c0d1e2f"]);
      expect(parsed.frontmatter["paper-ocr"]?.backend).toBe("handwriting-ocr");
    });

    it("round-trips the thumbnail page-1 fingerprint", () => {
      const doc = createEmptyDocument();
      const md = serializePaperMd({
        document: doc,
        frontmatter: { "paper-thumbnail-page-1-fp": "deadbeef" },
      });
      const parsed = deserializePaperMd(md);
      expect(parsed.frontmatter["paper-thumbnail-page-1-fp"]).toBe("deadbeef");
    });

    it("round-trips transcript text", () => {
      const doc = createEmptyDocument();
      const transcript = "## Page 1\nFirst paragraph of handwriting.\nSecond line.\n\n## Page 2\nNext page content.";

      const md = serializePaperMd({ document: doc, transcript });
      const parsed = deserializePaperMd(md);

      expect(parsed.transcript).toBe(transcript.trim());
    });

    it("round-trips unicode in transcript", () => {
      const doc = createEmptyDocument();
      const transcript = "Café — naïve résumé. 日本語. 🖋️ ∫ ℝ²";

      const md = serializePaperMd({ document: doc, transcript });
      const parsed = deserializePaperMd(md);

      expect(parsed.transcript).toBe(transcript);
    });

    it("preserves user-added frontmatter fields", () => {
      const doc = createEmptyDocument();

      const md = serializePaperMd({
        document: doc,
        frontmatter: {
          tags: ["journal", "meeting"],
          aliases: ["my note"],
          cssclasses: ["wide"],
        },
      });
      const parsed = deserializePaperMd(md);

      expect(parsed.frontmatter.tags).toEqual(["journal", "meeting"]);
      expect(parsed.frontmatter.aliases).toEqual(["my note"]);
      expect(parsed.frontmatter.cssclasses).toEqual(["wide"]);
      expect(parsed.frontmatter["paper-version"]).toBe(PAPER_MD_VERSION);
    });

    it("preserves a user-authored prelude", () => {
      const doc = createEmptyDocument();
      const prelude = "Context before the transcript.\n\nThis markdown is user-authored.";

      const md = serializePaperMd({ document: doc, prelude });
      const parsed = deserializePaperMd(md);

      expect(parsed.prelude).toBe(prelude);
    });

    it("round-trips timestamps via frontmatter", () => {
      const doc = createEmptyDocument();
      const created = Date.UTC(2026, 0, 15, 12, 30, 0);
      doc.meta.created = created;

      const md = serializePaperMd({ document: doc });
      const parsed = deserializePaperMd(md);

      expect(parsed.document.meta.created).toBe(created);
      expect(typeof parsed.frontmatter["paper-created"]).toBe("string");
      expect(parsed.frontmatter["paper-created"]).toBe(new Date(created).toISOString());
    });

  });

  describe("decoder resilience", () => {
    it("returns an empty document for empty input", () => {
      const parsed = deserializePaperMd("");
      expect(parsed.document.strokes).toEqual([]);
      expect(parsed.transcript).toBe("");
    });

    it("returns an empty document when the paper code block is missing", () => {
      const md = `---\npaper-version: 4\n---\n\n# Transcript\nSome text.\n`;
      const parsed = deserializePaperMd(md);
      expect(parsed.document.strokes).toEqual([]);
      expect(parsed.transcript).toBe("Some text.");
    });

    it("tolerates missing frontmatter (no --- block)", () => {
      const doc = createEmptyDocument();
      doc.strokes.push(makeStroke());
      const md = serializePaperMd({ document: doc });
      // Strip the frontmatter block
      const stripped = md.replace(/^---[\s\S]*?---\n/, "");

      const parsed = deserializePaperMd(stripped);

      expect(parsed.document.strokes).toHaveLength(1);
      expect(parsed.frontmatter["paper-version"]).toBe(PAPER_MD_VERSION);
    });

    it("tolerates malformed frontmatter YAML", () => {
      const md = `---\nthis: : : broken\n  indent: [unclosed\n---\n\n# Transcript\n`;
      const parsed = deserializePaperMd(md);
      expect(parsed.document.strokes).toEqual([]);
      expect(parsed.frontmatter["paper-version"]).toBe(PAPER_MD_VERSION);
    });

    it("returns null OCR when the paper-ocr block is absent", () => {
      const doc = createEmptyDocument();
      const md = serializePaperMd({ document: doc });
      const parsed = deserializePaperMd(md);
      expect(parsed.frontmatter["paper-ocr-pages-fp"]).toBeUndefined();
    });

    it("strips a legacy paper-ocr block from the body", () => {
      const legacy = [
        "---",
        "paper-version: 4",
        "---",
        "",
        "# Transcript",
        "",
        "actual transcript text",
        "",
        "```paper-ocr",
        '{"v":1,"backend":"handwriting-ocr","pages":[]}',
        "```",
        "",
      ].join("\n");
      const parsed = deserializePaperMd(legacy);
      expect(parsed.transcript).toBe("actual transcript text");
    });

    it("ignores unclosed code fences gracefully", () => {
      const broken = `---\npaper-version: 4\n---\n\n# Transcript\nHi\n\n\`\`\`paper\nnever-closed\n`;
      expect(() => deserializePaperMd(broken)).not.toThrow();
      const parsed = deserializePaperMd(broken);
      // The paper content was lost — we get an empty document — but no crash.
      expect(parsed.document.strokes).toEqual([]);
    });
  });

  describe("structure invariants", () => {
    it("always writes paper-version=4", () => {
      const md = serializePaperMd({ document: createEmptyDocument() });
      expect(md).toMatch(/paper-version:\s*4/);
    });

    it("always emits a # Transcript heading", () => {
      const md = serializePaperMd({ document: createEmptyDocument() });
      expect(md).toContain("# Transcript");
    });

    it("always emits a paper code block", () => {
      const md = serializePaperMd({ document: createEmptyDocument() });
      expect(md).toContain("```paper\n");
    });

    it("never emits a paper-ocr block (the JSON sidecar was retired)", () => {
      const md = serializePaperMd({
        document: createEmptyDocument(),
        frontmatter: { "paper-ocr-pages-fp": ["a1b2c3d4"] },
      });
      expect(md).not.toContain("```paper-ocr");
    });

    it("writes the paper code block as raw JSON, not base64", () => {
      const doc = createEmptyDocument();
      doc.strokes.push(makeStroke());
      const md = serializePaperMd({ document: doc });

      const codeBlockMatch = /```paper\n([\s\S]*?)\n```/.exec(md);
      expect(codeBlockMatch).not.toBeNull();
      const content = codeBlockMatch![1].trim();
      // Raw JSON always starts with `{`; base64 never does.
      expect(content.startsWith("{")).toBe(true);
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });

  describe("backward compatibility", () => {
    it("decodes legacy deflate+base64 code block content", async () => {
      // Construct a .paper.md file by hand with a base64-encoded paper block,
      // as an earlier version of the serializer would have written.
      const doc = createEmptyDocument();
      doc.strokes.push(makeStroke());

      const { compressString } = await import("./Compression");
      const { serializeDocument: sd } = await import("./Serializer");
      const legacyMd =
        `---\npaper-version: 4\npaper-default-view: paper\n---\n\n# Transcript\n\n` +
        "```paper\n" + compressString(sd(doc)) + "\n```\n";

      const parsed = deserializePaperMd(legacyMd);
      expect(parsed.document.strokes).toHaveLength(1);
      expect(parsed.document.strokes[0].id).toBe("s12345");
    });
  });
});
