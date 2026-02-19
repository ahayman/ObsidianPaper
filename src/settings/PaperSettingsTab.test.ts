import { App } from "obsidian";
import PaperPlugin from "../main";
import { PaperSettingsTab } from "./PaperSettingsTab";
import { DEFAULT_SETTINGS } from "./PaperSettings";
import type { PaperSettings } from "./PaperSettings";

describe("PaperSettingsTab", () => {
  let app: App;
  let plugin: PaperPlugin;
  let settings: PaperSettings;
  let onChange: jest.Mock;
  let tab: PaperSettingsTab;

  beforeEach(() => {
    app = new App();
    plugin = new PaperPlugin(app, {
      id: "paper",
      name: "Paper",
      version: "0.1.0",
      minAppVersion: "0.15.0",
      description: "test",
      author: "test",
    });
    settings = { ...DEFAULT_SETTINGS };
    onChange = jest.fn();
    tab = new PaperSettingsTab(app, plugin, settings, onChange);
  });

  it("should create without error", () => {
    expect(tab).toBeDefined();
  });

  it("should call display without error", () => {
    expect(() => tab.display()).not.toThrow();
  });

  it("should create setting elements in containerEl", () => {
    tab.display();
    // Each Setting creates a div child — 5 headings + 12 settings = 17 divs
    const divs = tab.containerEl.querySelectorAll("div");
    expect(divs.length).toBeGreaterThanOrEqual(5);
  });

  it("should accept updated settings", () => {
    const newSettings = { ...DEFAULT_SETTINGS, defaultWidth: 5 };
    tab.updateSettings(newSettings);
    // Should not throw
    expect(() => tab.display()).not.toThrow();
  });
});
