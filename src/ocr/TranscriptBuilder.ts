import type { OcrResult } from "../document/PaperMdSerializer";

/**
 * Render an OcrResult as the markdown body of the `# Transcript` section.
 * One `## Page N` heading per page (1-indexed), followed by its lines.
 * Empty pages are omitted.
 */
export function buildTranscript(result: OcrResult | null): string {
  if (!result) return "";
  const sections: string[] = [];
  for (const page of result.pages) {
    if (page.lines.length === 0) continue;
    const lines = page.lines.map((l) => l.text.trim()).filter((t) => t.length > 0);
    if (lines.length === 0) continue;
    sections.push(`## Page ${page.pageIndex + 1}\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}
