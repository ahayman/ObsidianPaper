/**
 * Manages the color strip: pinned/saved colors + MRU history.
 * Saved colors occupy the left side, history fills the remaining slots.
 * Pure logic — no DOM dependency.
 */
export class ColorStripManager {
  private saved: string[];
  private recent: string[];
  private maxTotal: number;
  private maxSaved: number;

  constructor(
    savedColors: string[] = [],
    recentColors: string[] = [],
    maxTotal = 16,
    maxSaved = 12
  ) {
    this.maxTotal = maxTotal;
    this.maxSaved = maxSaved;

    // Dedupe saved colors and clamp to max
    const seenSaved = new Set<string>();
    this.saved = [];
    for (const c of savedColors) {
      if (!seenSaved.has(c) && this.saved.length < this.maxSaved) {
        seenSaved.add(c);
        this.saved.push(c);
      }
    }

    // Dedupe recent colors, excluding any that are already saved
    const seenRecent = new Set<string>(seenSaved);
    this.recent = [];
    const maxHistory = this.maxTotal - this.saved.length;
    for (const c of recentColors) {
      if (!seenRecent.has(c) && this.recent.length < maxHistory) {
        seenRecent.add(c);
        this.recent.push(c);
      }
    }
  }

  // ─── Saved Color Operations ─────────────────────────────

  /**
   * Pin a color to the saved section. If already saved, no-op.
   * If at max saved capacity, returns false.
   * Removes it from history if present.
   */
  pinColor(colorId: string): boolean {
    if (this.saved.includes(colorId)) return false;
    if (this.saved.length >= this.maxSaved) return false;

    // Remove from history if present
    const histIdx = this.recent.indexOf(colorId);
    if (histIdx !== -1) this.recent.splice(histIdx, 1);

    this.saved.push(colorId);
    this.trimHistory();
    return true;
  }

  /**
   * Unpin a color from saved. Moves it to the front of history.
   */
  unpinColor(colorId: string): boolean {
    const idx = this.saved.indexOf(colorId);
    if (idx === -1) return false;
    this.saved.splice(idx, 1);
    // Move to front of history
    this.recent.unshift(colorId);
    this.trimHistory();
    return true;
  }

  /** Check if a color is in the saved section. */
  isSaved(colorId: string): boolean {
    return this.saved.includes(colorId);
  }

  // ─── History Operations ─────────────────────────────────

  /**
   * Promote a color to the front of the history list.
   * If the color is saved, this is a no-op (saved colors don't move).
   * Returns true if the list changed.
   */
  promote(colorId: string): boolean {
    // Saved colors are not affected by history promotion
    if (this.saved.includes(colorId)) return false;

    const idx = this.recent.indexOf(colorId);
    if (idx === 0) return false; // Already at front

    if (idx > 0) {
      this.recent.splice(idx, 1);
    }
    this.recent.unshift(colorId);
    this.trimHistory();
    return true;
  }

  /**
   * Remove a color from either saved or history.
   */
  remove(colorId: string): boolean {
    const savedIdx = this.saved.indexOf(colorId);
    if (savedIdx !== -1) {
      this.saved.splice(savedIdx, 1);
      return true;
    }
    const recentIdx = this.recent.indexOf(colorId);
    if (recentIdx !== -1) {
      this.recent.splice(recentIdx, 1);
      return true;
    }
    return false;
  }

  // ─── Accessors ──────────────────────────────────────────

  /** Get saved (pinned) colors in user-defined order. */
  getSavedColors(): readonly string[] {
    return this.saved;
  }

  /** Get history colors, limited to available slots. */
  getRecentColors(): readonly string[] {
    return this.recent;
  }

  /** Serialize saved colors for persistence. */
  toSavedArray(): string[] {
    return [...this.saved];
  }

  /** Serialize history for persistence. */
  toRecentArray(): string[] {
    return [...this.recent];
  }

  // ─── Internal ───────────────────────────────────────────

  /** Trim history to fit within maxTotal - saved.length. */
  private trimHistory(): void {
    const maxHistory = this.maxTotal - this.saved.length;
    if (this.recent.length > maxHistory) {
      this.recent.length = maxHistory;
    }
  }
}
