import {
  extractPaperData,
  injectPaperData,
  extractMarkdownText,
  createHybridDocument,
  hasPaperData,
} from "./HybridFormat";

const SAMPLE_MD = `---
cssclasses: [obsidian-paper]
paper-version: 1
---

# My Note

Some text with [[links]] and #tags.

%%paper-data
{"v":1,"strokes":[]}
%%
`;

describe("HybridFormat", () => {
  describe("extractPaperData", () => {
    it("should extract JSON from paper data block", () => {
      const data = extractPaperData(SAMPLE_MD);
      expect(data).toBe('{"v":1,"strokes":[]}');
    });

    it("should return null if no paper data block", () => {
      const md = "# Just markdown\nNo paper data here.";
      expect(extractPaperData(md)).toBeNull();
    });

    it("should return null for incomplete block (no closing %%)", () => {
      const md = "%%paper-data\n{\"v\":1}";
      expect(extractPaperData(md)).toBeNull();
    });

    it("should handle multiline JSON data", () => {
      const md = `%%paper-data\n{\n  "v": 1,\n  "strokes": []\n}\n%%`;
      const data = extractPaperData(md);
      expect(data).toBe('{\n  "v": 1,\n  "strokes": []\n}');
    });
  });

  describe("injectPaperData", () => {
    it("should replace existing paper data block", () => {
      const newData = '{"v":2,"strokes":["test"]}';
      const result = injectPaperData(SAMPLE_MD, newData);

      expect(result).toContain(newData);
      expect(result).not.toContain('{"v":1,"strokes":[]}');
      // Should preserve the rest of the markdown
      expect(result).toContain("# My Note");
      expect(result).toContain("[[links]]");
    });

    it("should append data block if none exists", () => {
      const md = "# Just markdown\n";
      const data = '{"v":1,"strokes":[]}';
      const result = injectPaperData(md, data);

      expect(result).toContain("%%paper-data");
      expect(result).toContain(data);
      expect(result).toContain("# Just markdown");
    });

    it("should handle markdown without trailing newline", () => {
      const md = "# No trailing newline";
      const data = '{"v":1}';
      const result = injectPaperData(md, data);

      expect(result).toContain("%%paper-data");
      expect(result).toContain(data);
    });
  });

  describe("extractMarkdownText", () => {
    it("should extract text without frontmatter and data block", () => {
      const text = extractMarkdownText(SAMPLE_MD);
      expect(text).toContain("# My Note");
      expect(text).toContain("[[links]]");
      expect(text).not.toContain("cssclasses");
      expect(text).not.toContain("paper-data");
      expect(text).not.toContain('"v":1');
    });

    it("should handle markdown without frontmatter", () => {
      const md = "# Title\nSome text\n%%paper-data\n{}\n%%\n";
      const text = extractMarkdownText(md);
      expect(text).toBe("# Title\nSome text");
    });

    it("should handle markdown without data block", () => {
      const md = "---\nkey: value\n---\n# Title";
      const text = extractMarkdownText(md);
      expect(text).toBe("# Title");
    });
  });

  describe("createHybridDocument", () => {
    it("should create document with frontmatter and data block", () => {
      const result = createHybridDocument("Test Note", '{"v":1}');

      expect(result).toContain("---");
      expect(result).toContain("cssclasses: [obsidian-paper]");
      expect(result).toContain("paper-version: 1");
      expect(result).toContain("# Test Note");
      expect(result).toContain("%%paper-data");
      expect(result).toContain('{"v":1}');
    });

    it("should include transcription text when provided", () => {
      const result = createHybridDocument(
        "My Note",
        '{"v":1}',
        "This is a transcription of handwriting."
      );

      expect(result).toContain("This is a transcription of handwriting.");
    });

    it("should not include transcription section when empty", () => {
      const result = createHybridDocument("My Note", '{"v":1}');
      const lines = result.split("\n");
      // Should not have an extra blank line where transcription would be
      const titleIdx = lines.indexOf("# My Note");
      const dataIdx = lines.indexOf("%%paper-data");
      // Only one blank line between title and data
      expect(dataIdx - titleIdx).toBe(2);
    });
  });

  describe("hasPaperData", () => {
    it("should return true when paper data block exists", () => {
      expect(hasPaperData(SAMPLE_MD)).toBe(true);
    });

    it("should return false when no paper data block", () => {
      expect(hasPaperData("# Just markdown")).toBe(false);
    });
  });
});
