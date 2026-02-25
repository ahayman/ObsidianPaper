import { PluginSettingTab, App, Setting } from "obsidian";
import type { Plugin } from "obsidian";
import type { PaperSettings, PaperFormat, NewNoteLocation } from "./PaperSettings";
import { formatSpacingDisplay, displayToWorldUnits } from "./PaperSettings";
import type { PenType, PaperType, PageSizePreset, PageOrientation, LayoutDirection, PageUnit, SpacingUnit, RenderPipeline, RenderEngineType } from "../types";
import type { DeviceSettings } from "./DeviceSettings";
import type { ToolbarPosition } from "../view/toolbar/ToolbarTypes";
import { isWebGL2Available } from "../canvas/engine/EngineFactory";

const PEN_TYPE_OPTIONS: Record<PenType, string> = {
  ballpoint: "Ballpoint",
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

type SettingsTabId = "writing" | "page" | "device" | "files";

const TAB_LABELS: Record<SettingsTabId, string> = {
  writing: "Writing",
  page: "Page",
  device: "Device",
  files: "Files & Embeds",
};

export interface DeviceSettingsAccessor {
  getDeviceSettings(): DeviceSettings;
  onDeviceSettingsChange(ds: DeviceSettings): void;
}

export class PaperSettingsTab extends PluginSettingTab {
  private settings: PaperSettings;
  private onSettingsChange: (settings: PaperSettings) => void;
  private deviceAccess: DeviceSettingsAccessor;
  private activeTab: SettingsTabId = "writing";

  constructor(
    app: App,
    plugin: Plugin,
    settings: PaperSettings,
    onSettingsChange: (settings: PaperSettings) => void,
    deviceAccess: DeviceSettingsAccessor,
  ) {
    super(app, plugin);
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
    this.deviceAccess = deviceAccess;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Tab bar ---
    const tabBar = containerEl.createDiv({ cls: "paper-settings-tabs" });
    const tabContents: Record<SettingsTabId, HTMLElement> = {} as Record<SettingsTabId, HTMLElement>;
    const tabButtons: Record<SettingsTabId, HTMLElement> = {} as Record<SettingsTabId, HTMLElement>;

    for (const id of Object.keys(TAB_LABELS) as SettingsTabId[]) {
      const btn = tabBar.createEl("button", {
        cls: "paper-settings-tabs__btn",
        text: TAB_LABELS[id],
      });
      btn.dataset.tab = id;
      if (id === this.activeTab) btn.addClass("is-active");
      tabButtons[id] = btn;

      btn.addEventListener("click", () => {
        this.activeTab = id;
        for (const tabId of Object.keys(TAB_LABELS) as SettingsTabId[]) {
          tabButtons[tabId].toggleClass("is-active", tabId === id);
          tabContents[tabId].toggleClass("is-active", tabId === id);
        }
      });
    }

    // --- Tab content containers ---
    for (const id of Object.keys(TAB_LABELS) as SettingsTabId[]) {
      const content = containerEl.createDiv({ cls: "paper-settings-tab-content" });
      content.dataset.tab = id;
      if (id === this.activeTab) content.addClass("is-active");
      tabContents[id] = content;
    }

    // --- Build tabs ---
    this.buildWritingTab(tabContents.writing);
    this.buildPageTab(tabContents.page);
    this.buildDeviceTab(tabContents.device);
    this.buildFilesTab(tabContents.files);
  }

  private buildWritingTab(container: HTMLElement): void {
    // --- Pen Defaults ---
    new Setting(container).setName("Pen defaults").setHeading();

    new Setting(container)
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

    new Setting(container)
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

    new Setting(container)
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

    // --- Smoothing ---
    new Setting(container).setName("Smoothing").setHeading();

    new Setting(container)
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

    // --- Grain Texture ---
    new Setting(container).setName("Grain texture").setHeading();

    new Setting(container)
      .setName("Pencil grain strength")
      .setDesc("Amount of paper grain visible on pencil strokes (0 = none, 1 = maximum)")
      .addText((text) => {
        text.setValue(String(this.settings.pencilGrainStrength));
        text.onChange((value: string) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            this.settings.pencilGrainStrength = num;
            this.notifyChange();
          }
        });
      });

    // --- Fountain Pen ---
    new Setting(container).setName("Fountain pen").setHeading();

    new Setting(container)
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

    new Setting(container)
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

    new Setting(container)
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

  }

  private buildPageTab(container: HTMLElement): void {
    // --- Canvas ---
    new Setting(container).setName("Canvas").setHeading();

    new Setting(container)
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

    new Setting(container)
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

    new Setting(container)
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

    new Setting(container)
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

    new Setting(container)
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

    // --- Margins ---
    new Setting(container).setName("Margins").setHeading();

    const marginUnitLabel = spacingUnitLabel;

    new Setting(container)
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

    new Setting(container)
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

    new Setting(container)
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

    // --- Page ---
    new Setting(container).setName("Page").setHeading();

    const PAGE_SIZE_OPTIONS: Record<PageSizePreset, string> = {
      "us-letter": "US Letter",
      "us-legal": "US Legal",
      "a4": "A4",
      "a5": "A5",
      "a3": "A3",
      "custom": "Custom",
    };

    new Setting(container)
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

    new Setting(container)
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

    new Setting(container)
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
      new Setting(container)
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

      new Setting(container)
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

      new Setting(container)
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
  }

  private buildDeviceTab(container: HTMLElement): void {
    // Info note
    const note = container.createDiv({ cls: "paper-settings-device-note" });
    note.setText("These settings are stored locally and won't sync across devices.");

    // --- Input ---
    new Setting(container).setName("Input").setHeading();

    const ds = this.deviceAccess.getDeviceSettings();

    new Setting(container)
      .setName("Palm rejection")
      .setDesc("Ignore touch input while pen is active")
      .addToggle((toggle) => {
        toggle.setValue(ds.palmRejection);
        toggle.onChange((value: boolean) => {
          const updated = { ...this.deviceAccess.getDeviceSettings(), palmRejection: value };
          this.deviceAccess.onDeviceSettingsChange(updated);
        });
      });

    new Setting(container)
      .setName("Finger action")
      .setDesc("What finger touch does on the canvas")
      .addDropdown((dropdown) => {
        dropdown.addOption("pan", "Pan & zoom");
        dropdown.addOption("draw", "Draw");
        dropdown.setValue(ds.fingerAction);
        dropdown.onChange((value: string) => {
          const updated = { ...this.deviceAccess.getDeviceSettings(), fingerAction: value as "pan" | "draw" };
          this.deviceAccess.onDeviceSettingsChange(updated);
        });
      });

    // --- Rendering ---
    new Setting(container).setName("Rendering").setHeading();

    new Setting(container)
      .setName("Default render pipeline")
      .setDesc("Controls stroke rendering quality and performance")
      .addDropdown((dropdown) => {
        dropdown.addOption("basic", "Basic (default)");
        dropdown.addOption("advanced", "Advanced");
        dropdown.setValue(ds.defaultRenderPipeline);
        dropdown.onChange((value: string) => {
          const updated = { ...this.deviceAccess.getDeviceSettings(), defaultRenderPipeline: value as RenderPipeline };
          this.deviceAccess.onDeviceSettingsChange(updated);
        });
      });

    const webglAvailable = isWebGL2Available();

    new Setting(container)
      .setName("Rendering engine")
      .setDesc("Canvas 2D works everywhere. WebGL uses the GPU for better performance. Requires reopening the note.")
      .addDropdown((dropdown) => {
        dropdown.addOption("canvas2d", "Canvas 2D");
        dropdown.addOption("webgl", webglAvailable ? "WebGL (GPU)" : "WebGL (GPU) (not supported)");
        dropdown.setValue(ds.defaultRenderEngine);
        dropdown.onChange((value: string) => {
          const updated = { ...this.deviceAccess.getDeviceSettings(), defaultRenderEngine: value as RenderEngineType };
          this.deviceAccess.onDeviceSettingsChange(updated);
        });
      });

    // --- Toolbar ---
    new Setting(container).setName("Toolbar").setHeading();

    new Setting(container)
      .setName("Toolbar position")
      .setDesc("Position of the toolbar on the canvas")
      .addDropdown((dropdown) => {
        dropdown.addOption("top", "Top");
        dropdown.addOption("bottom", "Bottom");
        dropdown.addOption("left", "Left");
        dropdown.addOption("right", "Right");
        dropdown.setValue(ds.toolbarPosition);
        dropdown.onChange((value: string) => {
          const updated = { ...this.deviceAccess.getDeviceSettings(), toolbarPosition: value as ToolbarPosition };
          this.deviceAccess.onDeviceSettingsChange(updated);
        });
      });
  }

  private buildFilesTab(container: HTMLElement): void {
    // --- File ---
    new Setting(container).setName("File").setHeading();

    new Setting(container)
      .setName("Default location for new notes")
      .setDesc("Where new paper documents are created")
      .addDropdown((dropdown) => {
        dropdown.addOption("specified", "In specified folder");
        dropdown.addOption("current", "In current folder");
        dropdown.addOption("subfolder", "In subfolder of current folder");
        dropdown.setValue(this.settings.newNoteLocation);
        dropdown.onChange((value: string) => {
          this.settings.newNoteLocation = value as NewNoteLocation;
          this.notifyChange();
          this.display();
        });
      });

    if (this.settings.newNoteLocation === "specified") {
      new Setting(container)
        .setName("Folder path")
        .setDesc("Folder for new paper notes (empty = vault root)")
        .addText((text) => {
          text.setPlaceholder("e.g. Papers/");
          text.setValue(this.settings.defaultFolder);
          text.onChange((value: string) => {
            this.settings.defaultFolder = value;
            this.notifyChange();
          });
        });
    }

    if (this.settings.newNoteLocation === "subfolder") {
      new Setting(container)
        .setName("Subfolder name")
        .setDesc("Subfolder created inside the current folder")
        .addText((text) => {
          text.setPlaceholder("e.g. Papers");
          text.setValue(this.settings.newNoteSubfolder);
          text.onChange((value: string) => {
            this.settings.newNoteSubfolder = value;
            this.notifyChange();
          });
        });
    }

    new Setting(container)
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

    new Setting(container)
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

    // --- Embeds ---
    new Setting(container).setName("Embeds").setHeading();

    new Setting(container)
      .setName("Max width")
      .setDesc("Maximum width of embedded previews in pixels (0 = fill container)")
      .addText((text) => {
        text.setValue(String(this.settings.embedMaxWidth));
        text.onChange((value: string) => {
          const num = parseInt(value);
          if (!isNaN(num) && num >= 0 && num <= 2000) {
            this.settings.embedMaxWidth = num;
            this.notifyChange();
          }
        });
      });

    new Setting(container)
      .setName("Max height")
      .setDesc("Maximum height of embedded previews in pixels (0 = no limit)")
      .addText((text) => {
        text.setValue(String(this.settings.embedMaxHeight));
        text.onChange((value: string) => {
          const num = parseInt(value);
          if (!isNaN(num) && num >= 0 && num <= 2000) {
            this.settings.embedMaxHeight = num;
            this.notifyChange();
          }
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
