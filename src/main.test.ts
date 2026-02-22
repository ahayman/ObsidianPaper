import { App, PluginManifest, TFolder, TFile } from "obsidian";
import PaperPlugin from "./main";

describe("PaperPlugin", () => {
  let app: App;
  let plugin: PaperPlugin;

  beforeEach(() => {
    app = new App();
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

  it("should register the paper view on load", async () => {
    await plugin.onload();
    expect(plugin.registerView).toHaveBeenCalledWith(
      "paper-view",
      expect.any(Function)
    );
  });

  it("should register .paper extension on load", async () => {
    await plugin.onload();
    expect(plugin.registerExtensions).toHaveBeenCalledWith(
      ["paper"],
      "paper-view"
    );
  });

  it("should add create-paper command on load", async () => {
    await plugin.onload();
    expect(plugin.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-paper",
        name: "Create new handwriting note",
      })
    );
  });

  it("should register file-menu event for folder context menu", async () => {
    await plugin.onload();
    expect(plugin.registerEvent).toHaveBeenCalled();
    // The workspace.on should have been called with "file-menu"
    expect(app.workspace.on).toHaveBeenCalledWith(
      "file-menu",
      expect.any(Function)
    );
  });
});
