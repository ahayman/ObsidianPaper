/**
 * Pure logic class for managing an MRU (most-recently-used) color list.
 * No DOM dependency — just array manipulation.
 */
export class RecentColorManager {
  private colors: string[];
  private maxColors: number;

  constructor(initial: string[], maxColors = 16) {
    this.maxColors = maxColors;
    // Dedupe and clamp to max on init
    const seen = new Set<string>();
    this.colors = [];
    for (const c of initial) {
      if (!seen.has(c)) {
        seen.add(c);
        this.colors.push(c);
      }
      if (this.colors.length >= this.maxColors) break;
    }
  }

  /**
   * Push/promote a color to the front of the list.
   * If already present, moves it to index 0.
   * If new, inserts at index 0 and evicts the oldest if at capacity.
   * Returns true if the list changed.
   */
  promote(colorId: string): boolean {
    const idx = this.colors.indexOf(colorId);
    if (idx === 0) return false; // Already at front

    if (idx > 0) {
      this.colors.splice(idx, 1);
    }
    this.colors.unshift(colorId);

    if (this.colors.length > this.maxColors) {
      this.colors.pop();
    }
    return true;
  }

  /**
   * Remove a color from the list.
   * Returns true if the color was present and removed.
   */
  remove(colorId: string): boolean {
    const idx = this.colors.indexOf(colorId);
    if (idx === -1) return false;
    this.colors.splice(idx, 1);
    return true;
  }

  /** Get the current MRU list (front = most recent). */
  getColors(): readonly string[] {
    return this.colors;
  }

  /** Serialize for settings persistence. */
  toArray(): string[] {
    return [...this.colors];
  }
}
