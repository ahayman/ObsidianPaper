import { parseTranscriptSections, buildTranscriptSections, demoteMarkdownHeadings } from "./TranscriptSections";

describe("parseTranscriptSections", () => {
  it("returns an empty map for empty input", () => {
    expect(parseTranscriptSections("").size).toBe(0);
    expect(parseTranscriptSections("   \n\n").size).toBe(0);
  });

  it("splits a single page", () => {
    const t = "## Page 1\nhello world";
    const sections = parseTranscriptSections(t);
    expect(sections.size).toBe(1);
    expect(sections.get(0)).toBe("hello world");
  });

  it("splits multiple pages with blank lines between", () => {
    const t = "## Page 1\nfirst page\n\n## Page 2\nsecond page line one\nsecond page line two";
    const sections = parseTranscriptSections(t);
    expect(sections.get(0)).toBe("first page");
    expect(sections.get(1)).toBe("second page line one\nsecond page line two");
  });

  it("converts 1-indexed page numbers to 0-indexed map keys", () => {
    const t = "## Page 1\nA\n\n## Page 3\nC";
    const sections = parseTranscriptSections(t);
    expect(sections.has(0)).toBe(true);
    expect(sections.has(2)).toBe(true);
    expect(sections.has(1)).toBe(false);
  });

  it("drops sections with no body", () => {
    const t = "## Page 1\n\n## Page 2\nB";
    const sections = parseTranscriptSections(t);
    expect(sections.has(0)).toBe(false);
    expect(sections.get(1)).toBe("B");
  });

  it("drops content before the first heading", () => {
    const t = "stray prelude line\n## Page 1\nactual page";
    const sections = parseTranscriptSections(t);
    expect(sections.size).toBe(1);
    expect(sections.get(0)).toBe("actual page");
  });
});

describe("buildTranscriptSections", () => {
  it("emits empty string for an empty map", () => {
    expect(buildTranscriptSections(new Map())).toBe("");
  });

  it("emits 1-indexed Page N headings sorted by page index", () => {
    const sections = new Map<number, string>([
      [2, "third"],
      [0, "first"],
      [1, "second"],
    ]);
    const out = buildTranscriptSections(sections);
    expect(out).toBe("## Page 1\nfirst\n\n## Page 2\nsecond\n\n## Page 3\nthird");
  });

  it("skips empty/whitespace-only sections", () => {
    const sections = new Map<number, string>([
      [0, "real text"],
      [1, "   "],
      [2, "more text"],
    ]);
    const out = buildTranscriptSections(sections);
    expect(out).toContain("Page 1");
    expect(out).not.toContain("Page 2");
    expect(out).toContain("Page 3");
  });

  it("round-trips through parse → build → parse", () => {
    const original = "## Page 1\nfirst\n\n## Page 3\nthird";
    const sections = parseTranscriptSections(original);
    const rebuilt = buildTranscriptSections(sections);
    const reparsed = parseTranscriptSections(rebuilt);
    expect(reparsed).toEqual(sections);
  });
});

describe("demoteMarkdownHeadings", () => {
  it("demotes # to ### with 2 levels", () => {
    expect(demoteMarkdownHeadings("# Title\nbody", 2)).toBe("### Title\nbody");
  });

  it("demotes ## and ### similarly", () => {
    expect(demoteMarkdownHeadings("## Two", 2)).toBe("#### Two");
    expect(demoteMarkdownHeadings("### Three", 2)).toBe("##### Three");
  });

  it("caps at 6 hashes", () => {
    expect(demoteMarkdownHeadings("##### Five", 2)).toBe("###### Five");
    expect(demoteMarkdownHeadings("###### Six", 2)).toBe("###### Six");
  });

  it("leaves non-heading lines untouched", () => {
    const text = "regular paragraph\n# Heading\nanother line";
    expect(demoteMarkdownHeadings(text, 2)).toBe("regular paragraph\n### Heading\nanother line");
  });

  it("ignores hash-only lines (no space after — not a heading)", () => {
    expect(demoteMarkdownHeadings("#hashtag", 2)).toBe("#hashtag");
    expect(demoteMarkdownHeadings("#", 2)).toBe("#");
  });

  it("preserves leading whitespace before the hashes", () => {
    expect(demoteMarkdownHeadings("  # indented", 2)).toBe("  ### indented");
  });

  it("does not demote headings inside fenced code blocks", () => {
    const text = ["before # not yet", "```", "# this is code", "```", "# real heading"].join("\n");
    const out = demoteMarkdownHeadings(text, 2);
    expect(out).toContain("# this is code"); // unchanged
    expect(out).toContain("### real heading"); // demoted
  });

  it("returns input unchanged when levels is 0 or negative", () => {
    expect(demoteMarkdownHeadings("# foo", 0)).toBe("# foo");
    expect(demoteMarkdownHeadings("# foo", -1)).toBe("# foo");
  });

  it("the motivating case: OCR returning # heading no longer breaks transcript reads", () => {
    // After demotion, a `# Heading` line becomes `### Heading`, which won't
    // terminate the `# Transcript` section in PaperMdSerializer.
    const ocrText = "# My Title\nsome content\n# Another Heading";
    const demoted = demoteMarkdownHeadings(ocrText, 2);
    expect(demoted).not.toMatch(/^#\s+/m);
    expect(demoted).toContain("### My Title");
    expect(demoted).toContain("### Another Heading");
  });
});
