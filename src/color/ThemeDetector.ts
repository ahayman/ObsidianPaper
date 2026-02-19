/**
 * Detects Obsidian's dark/light mode and emits callbacks on theme change.
 * Uses MutationObserver on document.body class list.
 */
export class ThemeDetector {
  private isDark = false;
  private observer: MutationObserver | null = null;
  private listeners: ((isDark: boolean) => void)[] = [];

  constructor() {
    this.isDark = this.detectTheme();
  }

  /**
   * Start observing theme changes.
   */
  start(): void {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          const newIsDark = this.detectTheme();
          if (newIsDark !== this.isDark) {
            this.isDark = newIsDark;
            this.notifyListeners();
          }
        }
      }
    });

    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  /**
   * Stop observing theme changes.
   */
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * Register a callback for theme changes.
   */
  onChange(callback: (isDark: boolean) => void): void {
    this.listeners.push(callback);
  }

  /**
   * Remove a theme change callback.
   */
  offChange(callback: (isDark: boolean) => void): void {
    this.listeners = this.listeners.filter((l) => l !== callback);
  }

  /**
   * Get current dark mode state.
   */
  get isDarkMode(): boolean {
    return this.isDark;
  }

  /**
   * Force re-detect the current theme.
   */
  refresh(): void {
    const newIsDark = this.detectTheme();
    if (newIsDark !== this.isDark) {
      this.isDark = newIsDark;
      this.notifyListeners();
    }
  }

  private detectTheme(): boolean {
    return document.body.classList.contains("theme-dark");
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.isDark);
    }
  }
}
