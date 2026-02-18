import { App, PluginManifest } from "obsidian";
import PaperPlugin from "./main";

describe("PaperPlugin", () => {
  let plugin: PaperPlugin;

  beforeEach(() => {
    const app = new App();
    const manifest: PluginManifest = {
      id: "obsidian-paper",
      name: "Paper",
      version: "0.1.0",
      minAppVersion: "1.0.0",
      description: "Handwrite notes with Apple Pencil",
      author: "Aaron Hayman",
    };
    plugin = new PaperPlugin(app, manifest);
  });

  it("should load without error", async () => {
    await expect(plugin.onload()).resolves.not.toThrow();
  });

  it("should unload without error", () => {
    expect(() => plugin.onunload()).not.toThrow();
  });
});
