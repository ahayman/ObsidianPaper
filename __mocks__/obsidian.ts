/**
 * Mock implementation of the Obsidian API for testing
 */

/**
 * Augment HTMLElement with Obsidian's DOM helper methods.
 * These are added to all elements in the real Obsidian environment.
 */
function augmentElement(el: HTMLElement): HTMLElement {
  if (!(el as any)._augmented) {
    (el as any)._augmented = true;
    (el as any).empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
    (el as any).createEl = function (
      tag: string,
      opts?: {
        cls?: string;
        text?: string;
        type?: string;
        value?: string;
        attr?: Record<string, string>;
      }
    ) {
      const child = document.createElement(tag);
      augmentElement(child);
      if (opts?.cls) {
        for (const c of opts.cls.split(" ")) child.classList.add(c);
      }
      if (opts?.text) child.textContent = opts.text;
      if (opts?.type) (child as HTMLInputElement).type = opts.type;
      if (opts?.value) (child as HTMLInputElement).value = opts.value;
      if (opts?.attr) {
        for (const [k, v] of Object.entries(opts.attr)) {
          child.setAttribute(k, v);
        }
      }
      this.appendChild(child);
      return child;
    };
    (el as any).createDiv = function (
      opts?: { cls?: string; text?: string; attr?: Record<string, string> }
    ) {
      return (this as any).createEl("div", opts);
    };
    (el as any).setText = function (text: string) {
      this.textContent = text;
    };
    (el as any).addClass = function (cls: string) {
      this.classList.add(cls);
    };
    (el as any).removeClass = function (cls: string) {
      this.classList.remove(cls);
    };
    (el as any).toggleClass = function (cls: string, force: boolean) {
      this.classList.toggle(cls, force);
    };
    (el as any).toggleVisibility = function (visible: boolean) {
      this.style.display = visible ? "" : "none";
    };
    (el as any).setCssProps = function (props: Record<string, string>) {
      for (const [k, v] of Object.entries(props)) {
        this.style.setProperty(k, v);
      }
    };
  }
  return el;
}

function createAugmentedDiv(): HTMLElement {
  return augmentElement(document.createElement("div"));
}

export class App {
  vault = new Vault();
  workspace = new Workspace();
  plugins = {
    getPlugin: jest.fn(),
  };
  private _localStorage: Record<string, string> = {};

  loadLocalStorage(key: string): string | null {
    return this._localStorage[key] ?? null;
  }

  saveLocalStorage(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete this._localStorage[key];
    } else {
      this._localStorage[key] = value;
    }
  }
}

export class Vault {
  getAbstractFileByPath = jest.fn();
  create = jest.fn();
  createFolder = jest.fn(() => Promise.resolve());
  read = jest.fn();
  modify = jest.fn();
  delete = jest.fn();
  rename = jest.fn();
  getMarkdownFiles = jest.fn(() => []);
  getAllLoadedFiles = jest.fn(() => []);
  getRoot = jest.fn(() => new TFolder("/"));
  on = jest.fn();
}

export class Workspace {
  getLeaf = jest.fn((_newLeaf?: boolean) => new WorkspaceLeaf());
  getActiveFile = jest.fn();
  getActiveViewOfType = jest.fn(() => null);
  on = jest.fn();
  onLayoutReady = jest.fn((cb: () => void) => cb());
}

export class WorkspaceLeaf {
  openFile = jest.fn();
}

export class Plugin {
  app: App;
  manifest: PluginManifest;

  constructor(app: App, manifest: PluginManifest) {
    this.app = app;
    this.manifest = manifest;
  }

  addCommand = jest.fn();
  addSettingTab = jest.fn();
  registerEvent = jest.fn();
  registerView = jest.fn();
  registerExtensions = jest.fn();
  registerMarkdownPostProcessor = jest.fn();
  registerEditorExtension = jest.fn();
  loadData = jest.fn(() => Promise.resolve(null));
  saveData = jest.fn(() => Promise.resolve());
}

export class TextFileView {
  app: App;
  file: TFile | null = null;
  contentEl: HTMLElement;
  data: string = "";

  constructor(leaf: WorkspaceLeaf) {
    this.app = new App();
    this.contentEl = createAugmentedDiv();
  }

  getViewType(): string {
    return "";
  }

  getDisplayText(): string {
    return "";
  }

  getIcon(): string {
    return "document";
  }

  getViewData(): string {
    return this.data;
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
  }

  clear(): void {
    this.data = "";
  }

  requestSave(): void {}

  onOpen(): Promise<void> {
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    return Promise.resolve();
  }

  onResize(): void {}
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
}

export class PluginSettingTab {
  app: App;
  containerEl: HTMLElement;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.containerEl = createAugmentedDiv();
  }

  display(): void {}
  hide(): void {}
}

export class Modal {
  app: App;
  contentEl: HTMLElement;
  modalEl: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement("div");
    this.modalEl = document.createElement("div");
  }

  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.infoEl = document.createElement("div");
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.controlEl = document.createElement("div");
    containerEl.appendChild(this.settingEl);
  }

  setName(name: string): this {
    return this;
  }

  setDesc(desc: string): this {
    return this;
  }

  setHeading(): this {
    return this;
  }

  addText(cb: (text: TextComponent) => void): this {
    cb(new TextComponent(this.controlEl));
    return this;
  }

  addToggle(cb: (toggle: ToggleComponent) => void): this {
    cb(new ToggleComponent(this.controlEl));
    return this;
  }

  addDropdown(cb: (dropdown: DropdownComponent) => void): this {
    cb(new DropdownComponent(this.controlEl));
    return this;
  }

  addButton(cb: (button: ButtonComponent) => void): this {
    cb(new ButtonComponent(this.controlEl));
    return this;
  }
}

export class TextComponent {
  inputEl: HTMLInputElement;

  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement("input");
    containerEl.appendChild(this.inputEl);
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    return this;
  }
}

export class ToggleComponent {
  toggleEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.toggleEl = document.createElement("div");
    containerEl.appendChild(this.toggleEl);
  }

  setValue(value: boolean): this {
    return this;
  }

  onChange(callback: (value: boolean) => void): this {
    return this;
  }
}

export class DropdownComponent {
  selectEl: HTMLSelectElement;

  constructor(containerEl: HTMLElement) {
    this.selectEl = document.createElement("select");
    containerEl.appendChild(this.selectEl);
  }

  addOption(value: string, display: string): this {
    return this;
  }

  setValue(value: string): this {
    return this;
  }

  onChange(callback: (value: string) => void): this {
    return this;
  }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    this.buttonEl = document.createElement("button");
    containerEl.appendChild(this.buttonEl);
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  setIcon(icon: string): this {
    return this;
  }

  setCta(): this {
    return this;
  }

  onClick(callback: () => void): this {
    return this;
  }
}

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  parent: TFolder | null;

  constructor(path: string = "") {
    this.path = path;
    this.name = path.split("/").pop() || "";
    this.basename = this.name.replace(/\.[^/.]+$/, "");
    this.extension = this.name.split(".").pop() || "";
    this.parent = null;
  }
}

export class TFolder {
  path: string;
  name: string;
  parent: TFolder | null;
  children: (TFile | TFolder)[];

  constructor(path: string = "") {
    this.path = path;
    this.name = path.split("/").pop() || "";
    this.parent = null;
    this.children = [];
  }
}

export type TAbstractFile = TFile | TFolder;

export class Notice {
  constructor(message: string, timeout?: number) {}
}

export class Menu {
  addItem(cb: (item: MenuItem) => void): this {
    cb(new MenuItem());
    return this;
  }

  addSeparator(): this {
    return this;
  }
}

export class MenuItem {
  setTitle(title: string): this {
    return this;
  }

  setIcon(icon: string): this {
    return this;
  }

  onClick(callback: () => void): this {
    return this;
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export const Platform = {
  isMobile: false,
  isDesktop: true,
  isMacOS: false,
  isWin: false,
  isLinux: false,
  isIosApp: false,
  isAndroidApp: false,
};
