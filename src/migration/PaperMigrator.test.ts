import { App, TFile } from "obsidian";

function makeTFile(path: string): TFile {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (TFile as any)(path) as TFile;
}
import type { Stroke } from "../types";
import { createEmptyDocument } from "../document/Document";
import { serializeDocument } from "../document/Serializer";
import { deserializePaperMd } from "../document/PaperMdSerializer";
import {
  convertV3ToPaperMd,
  rewriteEmbedsInMarkdown,
  planMigration,
  runMigration,
  listBackups,
  deleteBackups,
} from "./PaperMigrator";

function makeStroke(id: string): Stroke {
  return {
    id,
    pageIndex: 0,
    style: "_default",
    bbox: [0, 0, 100, 100],
    pointCount: 2,
    pts: "0,0,128,128,128,0,0;10,10,0,0,0,0,1",
  };
}

function makeV3(strokes: string[]): string {
  const doc = createEmptyDocument();
  for (const id of strokes) doc.strokes.push(makeStroke(id));
  return serializeDocument(doc);
}

describe("PaperMigrator — pure functions", () => {
  describe("convertV3ToPaperMd", () => {
    it("produces valid v4 markdown that round-trips", () => {
      const v3 = makeV3(["s1", "s2", "s3"]);
      const v4 = convertV3ToPaperMd(v3, "0.2.0");

      expect(v4).toContain("paper-version: 4");
      expect(v4).toContain("paper-default-view: paper");
      expect(v4).toContain("```paper");

      const parsed = deserializePaperMd(v4);
      expect(parsed.document.strokes).toHaveLength(3);
      expect(parsed.document.strokes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
      expect(parsed.document.meta.appVersion).toBe("0.2.0");
    });

    it("preserves the original creation timestamp", () => {
      const doc = createEmptyDocument();
      doc.meta.created = Date.UTC(2024, 5, 10, 12, 0, 0);
      const v3 = serializeDocument(doc);

      const v4 = convertV3ToPaperMd(v3, "0.1.0");
      const parsed = deserializePaperMd(v4);

      expect(parsed.document.meta.created).toBe(doc.meta.created);
    });
  });

  describe("rewriteEmbedsInMarkdown", () => {
    it("rewrites a plain .paper embed", () => {
      const { content, replacements } = rewriteEmbedsInMarkdown("![[foo.paper]]");
      expect(content).toBe("![[foo.paper.md]]");
      expect(replacements).toBe(1);
    });

    it("preserves width suffix", () => {
      const { content } = rewriteEmbedsInMarkdown("![[foo.paper|600]]");
      expect(content).toBe("![[foo.paper.md|600]]");
    });

    it("preserves width x height suffix", () => {
      const { content } = rewriteEmbedsInMarkdown("![[foo.paper|600x300]]");
      expect(content).toBe("![[foo.paper.md|600x300]]");
    });

    it("preserves folder path", () => {
      const { content } = rewriteEmbedsInMarkdown("![[notes/2024/foo.paper]]");
      expect(content).toBe("![[notes/2024/foo.paper.md]]");
    });

    it("does not touch .paper.md references", () => {
      const { content, replacements } = rewriteEmbedsInMarkdown("![[foo.paper.md]]");
      expect(content).toBe("![[foo.paper.md]]");
      expect(replacements).toBe(0);
    });

    it("handles multiple embeds in one document", () => {
      const input = "See ![[a.paper]] and ![[b.paper|400]] and ![[c.md]]";
      const { content, replacements } = rewriteEmbedsInMarkdown(input);
      expect(content).toBe("See ![[a.paper.md]] and ![[b.paper.md|400]] and ![[c.md]]");
      expect(replacements).toBe(2);
    });

    it("leaves documents without .paper refs unchanged", () => {
      const input = "No paper here. ![[image.png]] ![[note.md]]";
      const { content, replacements } = rewriteEmbedsInMarkdown(input);
      expect(content).toBe(input);
      expect(replacements).toBe(0);
    });

    it("is case insensitive on the extension", () => {
      const { content } = rewriteEmbedsInMarkdown("![[FOO.PAPER]]");
      expect(content).toBe("![[FOO.PAPER.md]]");
    });
  });
});

describe("PaperMigrator — plan and run", () => {
  function setupVaultWithPaperFiles(opts: {
    paperFiles: { path: string; content: string }[];
    mdFiles?: { path: string; content: string }[];
    existingTargets?: string[];
  }): { app: App; readCalls: Map<string, string>; modifyCalls: Map<string, string>; createCalls: Map<string, string> } {
    const app = new App();
    const readMap = new Map<string, string>();
    const modifyCalls = new Map<string, string>();
    const createCalls = new Map<string, string>();
    const pathToFile = new Map<string, TFile>();

    const paperTFiles: TFile[] = [];
    for (const pf of opts.paperFiles) {
      const file = makeTFile(pf.path);
      readMap.set(pf.path, pf.content);
      pathToFile.set(pf.path, file);
      paperTFiles.push(file);
    }

    const mdTFiles: TFile[] = [];
    for (const mdf of opts.mdFiles ?? []) {
      const file = makeTFile(mdf.path);
      readMap.set(mdf.path, mdf.content);
      pathToFile.set(mdf.path, file);
      mdTFiles.push(file);
    }

    const existingTargets = new Set(opts.existingTargets ?? []);

    (app.vault.getAllLoadedFiles as jest.Mock).mockReturnValue([...paperTFiles, ...mdTFiles]);
    (app.vault.getMarkdownFiles as jest.Mock).mockReturnValue(mdTFiles);
    (app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((p: string) => {
      if (pathToFile.has(p)) return pathToFile.get(p);
      if (existingTargets.has(p)) return makeTFile(p);
      if (createCalls.has(p)) return makeTFile(p);
      return null;
    });
    (app.vault.read as jest.Mock).mockImplementation((f: TFile) => {
      const data = readMap.get(f.path);
      if (data === undefined) return Promise.reject(new Error(`not found: ${f.path}`));
      return Promise.resolve(data);
    });
    (app.vault.create as jest.Mock).mockImplementation((path: string, content: string) => {
      if (existingTargets.has(path)) return Promise.reject(new Error("exists"));
      if (createCalls.has(path)) return Promise.reject(new Error("exists"));
      createCalls.set(path, content);
      readMap.set(path, content);
      const newFile = makeTFile(path);
      pathToFile.set(path, newFile);
      return Promise.resolve(newFile);
    });
    (app.vault.modify as jest.Mock).mockImplementation((file: TFile, content: string) => {
      modifyCalls.set(file.path, content);
      readMap.set(file.path, content);
      return Promise.resolve();
    });
    (app.vault.delete as jest.Mock).mockImplementation((file: TFile) => {
      readMap.delete(file.path);
      pathToFile.delete(file.path);
      createCalls.delete(file.path);
      return Promise.resolve();
    });

    return { app, readCalls: readMap, modifyCalls, createCalls };
  }

  it("plans: discovers paper files and embeds", async () => {
    const { app } = setupVaultWithPaperFiles({
      paperFiles: [
        { path: "a.paper", content: makeV3(["s1"]) },
        { path: "sub/b.paper", content: makeV3(["s2", "s3"]) },
      ],
      mdFiles: [
        { path: "notes.md", content: "See ![[a.paper]] and ![[sub/b.paper|500]]." },
        { path: "other.md", content: "Nothing here." },
      ],
    });

    const plan = await planMigration(app);
    expect(plan.paperFiles).toHaveLength(2);
    expect(plan.paperFiles.map((p) => p.targetPath).sort()).toEqual(["a.paper.md", "sub/b.paper.md"]);
    expect(plan.markdownRewrites).toHaveLength(1);
    expect(plan.markdownRewrites[0].file.path).toBe("notes.md");
    expect(plan.markdownRewrites[0].replacements).toBe(2);
    expect(plan.skipped).toEqual([]);
  });

  it("plans: skips paper files whose .paper.md target already exists", async () => {
    const { app } = setupVaultWithPaperFiles({
      paperFiles: [{ path: "a.paper", content: makeV3(["s1"]) }],
      existingTargets: ["a.paper.md"],
    });

    const plan = await planMigration(app);
    expect(plan.paperFiles).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].path).toBe("a.paper");
  });

  it("runs: creates .paper.md, keeps original, rewrites embeds", async () => {
    const v3 = makeV3(["s1", "s2"]);
    const { app, createCalls, modifyCalls } = setupVaultWithPaperFiles({
      paperFiles: [{ path: "a.paper", content: v3 }],
      mdFiles: [{ path: "notes.md", content: "![[a.paper]]" }],
    });

    const plan = await planMigration(app);
    const result = await runMigration(app, plan, "0.1.0");

    expect(result.migrated).toBe(1);
    expect(result.rewritten).toBe(1);
    expect(result.failed).toEqual([]);
    expect(createCalls.has("a.paper.md")).toBe(true);
    expect(modifyCalls.get("notes.md")).toBe("![[a.paper.md]]");

    // Original .paper was NOT deleted.
    expect(app.vault.delete).not.toHaveBeenCalled();
  });

  it("runs: records failure and cleans up partial output on stroke-count mismatch", async () => {
    // Simulate a read-back that parses to fewer strokes than source. We do this
    // by stubbing vault.read to return empty content on the second read.
    const v3 = makeV3(["s1", "s2", "s3"]);
    const { app } = setupVaultWithPaperFiles({
      paperFiles: [{ path: "a.paper", content: v3 }],
    });

    let callCount = 0;
    (app.vault.read as jest.Mock).mockImplementation((f: TFile) => {
      callCount++;
      if (f.path === "a.paper.md" && callCount >= 2) {
        // Return a v4 file with zero strokes (simulating corruption)
        return Promise.resolve(convertV3ToPaperMd(makeV3([]), "0.1.0"));
      }
      if (f.path === "a.paper") return Promise.resolve(v3);
      return Promise.reject(new Error("not found"));
    });

    const plan = await planMigration(app);
    const result = await runMigration(app, plan, "0.1.0");

    expect(result.migrated).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("stroke count mismatch");
    expect(app.vault.delete).toHaveBeenCalled();
  });
});

describe("PaperMigrator — backups", () => {
  it("listBackups: only returns .paper files that have a .paper.md sibling", () => {
    const app = new App();
    const filesInVault = [
      makeTFile("a.paper"),          // has .paper.md
      makeTFile("a.paper.md"),
      makeTFile("b.paper"),          // no sibling
      makeTFile("c.md"),             // plain md, ignored
    ];
    (app.vault.getAllLoadedFiles as jest.Mock).mockReturnValue(filesInVault);
    (app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((p: string) => {
      if (p === "a.paper.md") return filesInVault[1];
      return null;
    });

    const { files, total } = listBackups(app);
    expect(total).toBe(1);
    expect(files[0].path).toBe("a.paper");
  });

  it("deleteBackups: removes only paper files with siblings", async () => {
    const app = new App();
    const a = makeTFile("a.paper");
    const aMd = makeTFile("a.paper.md");
    const b = makeTFile("b.paper");
    (app.vault.getAllLoadedFiles as jest.Mock).mockReturnValue([a, aMd, b]);
    (app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((p: string) => {
      if (p === "a.paper.md") return aMd;
      return null;
    });
    (app.vault.delete as jest.Mock).mockResolvedValue(undefined);

    const result = await deleteBackups(app);
    expect(result.deleted).toBe(1);
    expect(result.failed).toEqual([]);
    expect(app.vault.delete).toHaveBeenCalledWith(a);
    expect(app.vault.delete).not.toHaveBeenCalledWith(b);
  });
});
