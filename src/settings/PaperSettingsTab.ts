import { PluginSettingTab, App, Setting } from "obsidian";
import type { Plugin } from "obsidian";
import type { PaperSettings, PaperFormat } from "./PaperSettings";
import type { PenType, PaperType } from "../types";

const PEN_TYPE_OPTIONS: Record<PenType, string> = {
  ballpoint: "Ballpoint",
  brush: "Brush",
  "felt-tip": "Felt tip",
  pencil: "Pencil",
  fountain: "Fountain",
  highlighter: "Highlighter",
};

const PAPER_TYPE_OPTIONS: Record<PaperType, string> = {
  blank: "Blank",
  lined: "Lined",
  grid: "Grid",
  "dot-grid": "Dot grid",
};

export class PaperSettingsTab extends PluginSettingTab {
  private settings: PaperSettings;
  private onSettingsChange: (settings: PaperSettings) => void;

  constructor(
    app: App,
    plugin: Plugin,
    settings: PaperSettings,
    onSettingsChange: (settings: PaperSettings) => void
  ) {
    super(app, plugin);
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Pen Section ---
    new Setting(containerEl).setName("Pen defaults").setHeading();

    new Setting(containerEl)
      .setName("Default pen type")
      .setDesc("Pen type selected when opening a new paper")
      .addDropdown((dropdown) => {
        for (const [value, display] of Object.entries(PEN_TYPE_OPTIONS)) {
          dropdown.addOption(value, display);
        }
        dropdown.setValue(this.settings.defaultPenType);
        dropdown.onChange((value: string) => {
          this.settings.defaultPenType = value as PenType;
          this.notifyChange();
        });
      });

    new Setting(containerEl)
      .setName("Default width")
      .setDesc("Default stroke width (0.5 - 30)")
      .addText((text) => {
        text.setValue(String(this.settings.defaultWidth));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0.5 && num <= 30) {
            this.settings.defaultWidth = num;
            this.notifyChange();
          }
        });
      });

    new Setting(containerEl)
      .setName("Pressure sensitivity")
      .setDesc("Adjusts how pressure affects stroke width (0 = none, 1 = full)")
      .addText((text) => {
        text.setValue(String(this.settings.pressureSensitivity));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            this.settings.pressureSensitivity = num;
            this.notifyChange();
          }
        });
      });

    // --- Canvas Section ---
    new Setting(containerEl).setName("Canvas").setHeading();

    new Setting(containerEl)
      .setName("Default paper type")
      .setDesc("Background pattern for new papers")
      .addDropdown((dropdown) => {
        for (const [value, display] of Object.entries(PAPER_TYPE_OPTIONS)) {
          dropdown.addOption(value, display);
        }
        dropdown.setValue(this.settings.defaultPaperType);
        dropdown.onChange((value: string) => {
          this.settings.defaultPaperType = value as PaperType;
          this.notifyChange();
        });
      });

    new Setting(containerEl)
      .setName("Show grid")
      .setDesc("Show grid/lines on the canvas background")
      .addToggle((toggle) => {
        toggle.setValue(this.settings.showGrid);
        toggle.onChange((value: boolean) => {
          this.settings.showGrid = value;
          this.notifyChange();
        });
      });

    new Setting(containerEl)
      .setName("Grid size")
      .setDesc("Size of grid squares in world units")
      .addText((text) => {
        text.setValue(String(this.settings.gridSize));
        text.onChange((value: string) => {
          const num = parseInt(value);
          if (!isNaN(num) && num >= 10 && num <= 200) {
            this.settings.gridSize = num;
            this.notifyChange();
          }
        });
      });

    new Setting(containerEl)
      .setName("Line spacing")
      .setDesc("Spacing between ruled lines in world units")
      .addText((text) => {
        text.setValue(String(this.settings.lineSpacing));
        text.onChange((value: string) => {
          const num = parseInt(value);
          if (!isNaN(num) && num >= 10 && num <= 200) {
            this.settings.lineSpacing = num;
            this.notifyChange();
          }
        });
      });

    // --- Input Section ---
    new Setting(containerEl).setName("Input").setHeading();

    new Setting(containerEl)
      .setName("Palm rejection")
      .setDesc("Ignore touch input while pen is active")
      .addToggle((toggle) => {
        toggle.setValue(this.settings.palmRejection);
        toggle.onChange((value: boolean) => {
          this.settings.palmRejection = value;
          this.notifyChange();
        });
      });

    new Setting(containerEl)
      .setName("Finger action")
      .setDesc("What finger touch does on the canvas")
      .addDropdown((dropdown) => {
        dropdown.addOption("pan", "Pan & zoom");
        dropdown.addOption("draw", "Draw");
        dropdown.setValue(this.settings.fingerAction);
        dropdown.onChange((value: string) => {
          this.settings.fingerAction = value as "pan" | "draw";
          this.notifyChange();
        });
      });

    // --- Smoothing Section ---
    new Setting(containerEl).setName("Smoothing").setHeading();

    new Setting(containerEl)
      .setName("Default smoothing")
      .setDesc("Stroke smoothing level (0 = none, 1 = maximum)")
      .addText((text) => {
        text.setValue(String(this.settings.defaultSmoothing));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            this.settings.defaultSmoothing = num;
            this.notifyChange();
          }
        });
      });

    // --- File Section ---
    new Setting(containerEl).setName("File").setHeading();

    new Setting(containerEl)
      .setName("Default folder")
      .setDesc("Folder for new paper notes (empty = vault root)")
      .addText((text) => {
        text.setPlaceholder("e.g. Papers/");
        text.setValue(this.settings.defaultFolder);
        text.onChange((value: string) => {
          this.settings.defaultFolder = value;
          this.notifyChange();
        });
      });

    new Setting(containerEl)
      .setName("File name template")
      .setDesc("Default name for new paper notes")
      .addText((text) => {
        text.setPlaceholder("Untitled paper");
        text.setValue(this.settings.fileNameTemplate);
        text.onChange((value: string) => {
          this.settings.fileNameTemplate = value || "Untitled Paper";
          this.notifyChange();
        });
      });

    new Setting(containerEl)
      .setName("Default format")
      .setDesc("File format for new paper notes")
      .addDropdown((dropdown) => {
        dropdown.addOption("paper", ".paper");
        dropdown.addOption("paper.md", ".paper.md");
        dropdown.setValue(this.settings.defaultFormat);
        dropdown.onChange((value: string) => {
          this.settings.defaultFormat = value as PaperFormat;
          this.notifyChange();
        });
      });
  }

  updateSettings(settings: PaperSettings): void {
    this.settings = settings;
  }

  private notifyChange(): void {
    this.onSettingsChange({ ...this.settings });
  }
}
