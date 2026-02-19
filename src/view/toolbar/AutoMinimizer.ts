const EXPAND_DELAY_MS = 500;

/**
 * Pure state machine for auto-minimizing the toolbar during writing.
 */
export class AutoMinimizer {
  private minimized = false;
  private suspended = false;
  private expandTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange: (minimized: boolean) => void;

  constructor(onChange: (minimized: boolean) => void) {
    this.onChange = onChange;
  }

  notifyStrokeStart(): void {
    this.cancelTimer();
    if (!this.suspended) {
      this.setMinimized(true);
    }
  }

  notifyStrokeEnd(): void {
    if (this.suspended) return;
    this.cancelTimer();
    this.expandTimer = setTimeout(() => {
      this.expandTimer = null;
      this.setMinimized(false);
    }, EXPAND_DELAY_MS);
  }

  forceExpand(): void {
    this.cancelTimer();
    this.setMinimized(false);
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  /**
   * Suspend auto-minimize (e.g., when popover is open).
   */
  suspend(): void {
    this.suspended = true;
    this.cancelTimer();
    this.setMinimized(false);
  }

  /**
   * Resume auto-minimize behavior.
   */
  resume(): void {
    this.suspended = false;
  }

  destroy(): void {
    this.cancelTimer();
  }

  private setMinimized(value: boolean): void {
    if (this.minimized === value) return;
    this.minimized = value;
    this.onChange(value);
  }

  private cancelTimer(): void {
    if (this.expandTimer !== null) {
      clearTimeout(this.expandTimer);
      this.expandTimer = null;
    }
  }
}
