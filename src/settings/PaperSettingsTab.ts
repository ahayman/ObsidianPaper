import { PluginSettingTab, App, Setting } from "obsidian";
import type { Plugin } from "obsidian";
import type { PaperSettings, PaperFormat } from "./PaperSettings";
import { formatSpacingDisplay, displayToWorldUnits } from "./PaperSettings";
import type { PenType, PaperType, PageSizePreset, PageOrientation, LayoutDirection, PageUnit, SpacingUnit } from "../types";

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

    const spacingUnitLabel = this.settings.spacingUnit === "wu" ? "world units"
      : this.settings.spacingUnit === "in" ? "inches" : "centimeters";

    new Setting(containerEl)
      .setName("Spacing unit")
      .setDesc("Unit for grid size and line spacing")
      .addDropdown((dropdown) => {
        dropdown.addOption("in", "Inches");
        dropdown.addOption("cm", "Centimeters");
        dropdown.addOption("wu", "World units");
        dropdown.setValue(this.settings.spacingUnit);
        dropdown.onChange((value: string) => {
          this.settings.spacingUnit = value as SpacingUnit;
          this.notifyChange();
          this.display(); // Refresh to update displayed values
        });
      });

    new Setting(containerEl)
      .setName("Grid size")
      .setDesc(`Size of grid squares (${spacingUnitLabel})`)
      .addText((text) => {
        text.setValue(formatSpacingDisplay(this.settings.gridSize, this.settings.spacingUnit));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num > 0) {
            const wu = Math.round(displayToWorldUnits(num, this.settings.spacingUnit));
            if (wu >= 5 && wu <= 500) {
              this.settings.gridSize = wu;
              this.notifyChange();
            }
          }
        });
      });

    new Setting(containerEl)
      .setName("Line spacing")
      .setDesc(`Spacing between ruled lines (${spacingUnitLabel})`)
      .addText((text) => {
        text.setValue(formatSpacingDisplay(this.settings.lineSpacing, this.settings.spacingUnit));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num > 0) {
            const wu = Math.round(displayToWorldUnits(num, this.settings.spacingUnit));
            if (wu >= 5 && wu <= 500) {
              this.settings.lineSpacing = wu;
              this.notifyChange();
            }
          }
        });
      });

    // --- Margins Section ---
    new Setting(containerEl).setName("Margins").setHeading();

    const marginUnitLabel = spacingUnitLabel;

    new Setting(containerEl)
      .setName("Top margin")
      .setDesc(`Space above the first line (${marginUnitLabel})`)
      .addText((text) => {
        text.setValue(formatSpacingDisplay(this.settings.marginTop, this.settings.spacingUnit));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0) {
            this.settings.marginTop = Math.round(displayToWorldUnits(num, this.settings.spacingUnit));
            this.notifyChange();
          }
        });
      });

    new Setting(containerEl)
      .setName("Bottom margin")
      .setDesc(`Space below the last line (${marginUnitLabel})`)
      .addText((text) => {
        text.setValue(formatSpacingDisplay(this.settings.marginBottom, this.settings.spacingUnit));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0) {
            this.settings.marginBottom = Math.round(displayToWorldUnits(num, this.settings.spacingUnit));
            this.notifyChange();
          }
        });
      });

    new Setting(containerEl)
      .setName("Side margins")
      .setDesc(`Space on left and right edges (${marginUnitLabel})`)
      .addText((text) => {
        text.setValue(formatSpacingDisplay(this.settings.marginLeft, this.settings.spacingUnit));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0) {
            const wu = Math.round(displayToWorldUnits(num, this.settings.spacingUnit));
            this.settings.marginLeft = wu;
            this.settings.marginRight = wu;
            this.notifyChange();
          }
        });
      });

    // --- Page Section ---
    new Setting(containerEl).setName("Page").setHeading();

    const PAGE_SIZE_OPTIONS: Record<PageSizePreset, string> = {
      "us-letter": "US Letter",
      "us-legal": "US Legal",
      "a4": "A4",
      "a5": "A5",
      "a3": "A3",
      "custom": "Custom",
    };

    new Setting(containerEl)
      .setName("Default page size")
      .setDesc("Page size for new documents")
      .addDropdown((dropdown) => {
        for (const [value, display] of Object.entries(PAGE_SIZE_OPTIONS)) {
          dropdown.addOption(value, display);
        }
        dropdown.setValue(this.settings.defaultPageSize);
        dropdown.onChange((value: string) => {
          this.settings.defaultPageSize = value as PageSizePreset;
          this.notifyChange();
          this.display(); // Refresh to show/hide custom fields
        });
      });

    new Setting(containerEl)
      .setName("Default orientation")
      .setDesc("Page orientation for new documents")
      .addDropdown((dropdown) => {
        dropdown.addOption("portrait", "Portrait");
        dropdown.addOption("landscape", "Landscape");
        dropdown.setValue(this.settings.defaultOrientation);
        dropdown.onChange((value: string) => {
          this.settings.defaultOrientation = value as PageOrientation;
          this.notifyChange();
        });
      });

    new Setting(containerEl)
      .setName("Default layout direction")
      .setDesc("How pages are arranged in new documents")
      .addDropdown((dropdown) => {
        dropdown.addOption("vertical", "Vertical");
        dropdown.addOption("horizontal", "Horizontal");
        dropdown.setValue(this.settings.defaultLayoutDirection);
        dropdown.onChange((value: string) => {
          this.settings.defaultLayoutDirection = value as LayoutDirection;
          this.notifyChange();
        });
      });

    if (this.settings.defaultPageSize === "custom") {
      new Setting(containerEl)
        .setName("Unit")
        .setDesc("Measurement unit for custom page size")
        .addDropdown((dropdown) => {
          dropdown.addOption("in", "Inches");
          dropdown.addOption("cm", "Centimeters");
          dropdown.setValue(this.settings.customPageUnit);
          dropdown.onChange((value: string) => {
            this.settings.customPageUnit = value as PageUnit;
            this.notifyChange();
          });
        });

      new Setting(containerEl)
        .setName("Width")
        .setDesc(`Page width in ${this.settings.customPageUnit === "in" ? "inches" : "centimeters"}`)
        .addText((text) => {
          text.setValue(String(this.settings.customPageWidth));
          text.onChange((value: string) => {
            const num = parseFloat(value);
            if (!isNaN(num) && num > 0 && num <= 100) {
              this.settings.customPageWidth = num;
              this.notifyChange();
            }
          });
        });

      new Setting(containerEl)
        .setName("Height")
        .setDesc(`Page height in ${this.settings.customPageUnit === "in" ? "inches" : "centimeters"}`)
        .addText((text) => {
          text.setValue(String(this.settings.customPageHeight));
          text.onChange((value: string) => {
            const num = parseFloat(value);
            if (!isNaN(num) && num > 0 && num <= 100) {
              this.settings.customPageHeight = num;
              this.notifyChange();
            }
          });
        });
    }

    // --- Fountain Pen Section ---
    new Setting(containerEl).setName("Fountain pen").setHeading();

    new Setting(containerEl)
      .setName("Default nib angle")
      .setDesc("Angle of the italic nib in degrees (0° = horizontal, 90° = vertical)")
      .addText((text) => {
        text.setValue(String(Math.round(this.settings.defaultNibAngle * 180 / Math.PI)));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0 && num <= 180) {
            this.settings.defaultNibAngle = num * Math.PI / 180;
            this.notifyChange();
          }
        });
      });

    new Setting(containerEl)
      .setName("Default nib thickness")
      .setDesc("Aspect ratio of the nib (0.1 = very flat italic, 1.0 = square)")
      .addText((text) => {
        text.setValue(String(this.settings.defaultNibThickness));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0.05 && num <= 1) {
            this.settings.defaultNibThickness = num;
            this.notifyChange();
          }
        });
      });

    new Setting(containerEl)
      .setName("Default nib pressure")
      .setDesc("How much pressure affects stroke width (0 = none, 1 = maximum)")
      .addText((text) => {
        text.setValue(String(this.settings.defaultNibPressure));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            this.settings.defaultNibPressure = num;
            this.notifyChange();
          }
        });
      });

    new Setting(containerEl)
      .setName("Use barrel rotation")
      .setDesc("Twist the pencil to change nib angle dynamically")
      .addToggle((toggle) => {
        toggle.setValue(this.settings.useBarrelRotation);
        toggle.onChange((value: boolean) => {
          this.settings.useBarrelRotation = value;
          this.notifyChange();
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
