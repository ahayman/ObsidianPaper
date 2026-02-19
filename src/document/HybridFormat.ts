/**
 * Hybrid .paper.md format that combines markdown text with embedded paper data.
 *
 * Format:
 * ```
 * ---
 * cssclasses: [obsidian-paper]
 * paper-version: 1
 * ---
 * # Title
 * Transcription text for search. [[links]] and #tags work.
 * %%paper-data
 * {"v":1, "strokes":[...]}
 * %%
 * ```
 *
 * The paper data is stored in an Obsidian comment block (%%...%%)
 * so it's hidden in reading mode but preserved by Obsidian's parser.
 */

const PAPER_DATA_START = "%%paper-data";
const PAPER_DATA_END = "%%";
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Extract the paper JSON data from a .paper.md file.
 * Returns null if no paper data block is found.
 */
export function extractPaperData(markdown: string): string | null {
  const startIdx = markdown.indexOf(PAPER_DATA_START);
  if (startIdx === -1) return null;

  const dataStart = startIdx + PAPER_DATA_START.length;
  const endIdx = markdown.indexOf(PAPER_DATA_END, dataStart);
  if (endIdx === -1) return null;

  return markdown.substring(dataStart, endIdx).trim();
}

/**
 * Inject paper JSON data into a .paper.md file, replacing any existing data block.
 * If no data block exists, appends one at the end.
 */
export function injectPaperData(markdown: string, jsonData: string): string {
  const dataBlock = `${PAPER_DATA_START}\n${jsonData}\n${PAPER_DATA_END}`;

  const startIdx = markdown.indexOf(PAPER_DATA_START);
  if (startIdx !== -1) {
    // Find the closing %%
    const dataStart = startIdx + PAPER_DATA_START.length;
    const endIdx = markdown.indexOf(PAPER_DATA_END, dataStart);
    if (endIdx !== -1) {
      const before = markdown.substring(0, startIdx);
      const after = markdown.substring(endIdx + PAPER_DATA_END.length);
      return before + dataBlock + after;
    }
  }

  // No existing block — append
  const separator = markdown.endsWith("\n") ? "\n" : "\n\n";
  return markdown + separator + dataBlock + "\n";
}

/**
 * Extract the markdown text content (everything except frontmatter and paper data block).
 */
export function extractMarkdownText(markdown: string): string {
  let text = markdown;

  // Remove frontmatter
  text = text.replace(FRONTMATTER_REGEX, "");

  // Remove paper data block
  const startIdx = text.indexOf(PAPER_DATA_START);
  if (startIdx !== -1) {
    const dataStart = startIdx + PAPER_DATA_START.length;
    const endIdx = text.indexOf(PAPER_DATA_END, dataStart);
    if (endIdx !== -1) {
      const before = text.substring(0, startIdx);
      const after = text.substring(endIdx + PAPER_DATA_END.length);
      text = before + after;
    }
  }

  return text.trim();
}

/**
 * Create a new .paper.md file with default frontmatter.
 */
export function createHybridDocument(
  title: string,
  paperData: string,
  transcription = ""
): string {
  const lines: string[] = [
    "---",
    "cssclasses: [obsidian-paper]",
    "paper-version: 1",
    "---",
    "",
    `# ${title}`,
    "",
  ];

  if (transcription) {
    lines.push(transcription);
    lines.push("");
  }

  lines.push(PAPER_DATA_START);
  lines.push(paperData);
  lines.push(PAPER_DATA_END);
  lines.push("");

  return lines.join("\n");
}

/**
 * Check if a markdown string contains a paper data block.
 */
export function hasPaperData(markdown: string): boolean {
  return markdown.includes(PAPER_DATA_START);
}
