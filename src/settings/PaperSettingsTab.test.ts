import { App } from "obsidian";
import PaperPlugin from "../main";
import { PaperSettingsTab } from "./PaperSettingsTab";
import type { DeviceSettingsAccessor } from "./PaperSettingsTab";
import { DEFAULT_SETTINGS } from "./PaperSettings";
import type { PaperSettings } from "./PaperSettings";
import { DEFAULT_DEVICE_SETTINGS } from "./DeviceSettings";
import type { DeviceSettings } from "./DeviceSettings";

describe("PaperSettingsTab", () => {
  let app: App;
  let plugin: PaperPlugin;
  let settings: PaperSettings;
  let onChange: jest.Mock;
  let deviceAccess: DeviceSettingsAccessor;
  let deviceSettings: DeviceSettings;
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
    deviceSettings = { ...DEFAULT_DEVICE_SETTINGS };
    deviceAccess = {
      getDeviceSettings: () => deviceSettings,
      onDeviceSettingsChange: jest.fn((ds) => { deviceSettings = ds; }),
    };
    tab = new PaperSettingsTab(app, plugin, settings, onChange, deviceAccess);
  });

  it("should create without error", () => {
    expect(tab).toBeDefined();
  });

  it("should call display without error", () => {
    expect(() => tab.display()).not.toThrow();
  });

  it("should create setting elements in containerEl", () => {
    tab.display();
    const divs = tab.containerEl.querySelectorAll("div");
    expect(divs.length).toBeGreaterThanOrEqual(5);
  });

  it("should accept updated settings", () => {
    const newSettings = { ...DEFAULT_SETTINGS, defaultWidth: 5 };
    tab.updateSettings(newSettings);
    expect(() => tab.display()).not.toThrow();
  });

  it("should render without error when newNoteLocation is 'specified'", () => {
    settings.newNoteLocation = "specified";
    tab.updateSettings(settings);
    expect(() => tab.display()).not.toThrow();
  });

  it("should render without error when newNoteLocation is 'current'", () => {
    settings.newNoteLocation = "current";
    tab.updateSettings(settings);
    expect(() => tab.display()).not.toThrow();
  });

  it("should render without error when newNoteLocation is 'subfolder'", () => {
    settings.newNoteLocation = "subfolder";
    tab.updateSettings(settings);
    expect(() => tab.display()).not.toThrow();
  });

  it("should render 4 tab buttons", () => {
    tab.display();
    const buttons = tab.containerEl.querySelectorAll(".paper-settings-tabs__btn");
    expect(buttons.length).toBe(4);
    expect(buttons[0].textContent).toBe("Writing");
    expect(buttons[1].textContent).toBe("Page");
    expect(buttons[2].textContent).toBe("Device");
    expect(buttons[3].textContent).toBe("Files & Embeds");
  });

  it("should show writing tab content by default", () => {
    tab.display();
    const contents = tab.containerEl.querySelectorAll(".paper-settings-tab-content");
    expect(contents.length).toBe(4);
    expect(contents[0].classList.contains("is-active")).toBe(true);
    expect(contents[1].classList.contains("is-active")).toBe(false);
    expect(contents[2].classList.contains("is-active")).toBe(false);
    expect(contents[3].classList.contains("is-active")).toBe(false);
  });

  it("should switch tabs on click", () => {
    tab.display();
    const buttons = tab.containerEl.querySelectorAll(".paper-settings-tabs__btn");
    const contents = tab.containerEl.querySelectorAll(".paper-settings-tab-content");

    // Click "Page" tab
    (buttons[1] as HTMLElement).click();

    expect(buttons[0].classList.contains("is-active")).toBe(false);
    expect(buttons[1].classList.contains("is-active")).toBe(true);
    expect(contents[0].classList.contains("is-active")).toBe(false);
    expect(contents[1].classList.contains("is-active")).toBe(true);
  });

  it("should show device note in device tab", () => {
    tab.display();
    const note = tab.containerEl.querySelector(".paper-settings-device-note");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("stored locally");
  });
});
