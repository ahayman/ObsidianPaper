import { Plugin } from "obsidian";

export default class PaperPlugin extends Plugin {
  async onload(): Promise<void> {
    console.debug("Loading Paper plugin");
  }

  onunload(): void {
    console.debug("Unloading Paper plugin");
  }
}
