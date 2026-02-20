import type { TileKey } from "./TileTypes";
import { tileKeyString } from "./TileTypes";

/**
 * Priority-based async tile rendering scheduler.
 * Renders visible tiles first, then background/overscan tiles.
 * Processes tiles in batches per frame to keep frame time under budget.
 */
export class TileRenderScheduler {
  private pendingTiles: TileKey[] = [];
  private renderingInProgress = false;
  private rafId: number | null = null;

  /** Called per tile to perform the actual render. */
  private renderOneTile: (key: TileKey) => void;

  /** Called after a batch completes to trigger re-compositing. */
  private onBatchComplete: () => void;

  /** Maximum tiles to render per animation frame. */
  private batchSize: number;

  constructor(
    renderOneTile: (key: TileKey) => void,
    onBatchComplete: () => void,
    batchSize = 4,
  ) {
    this.renderOneTile = renderOneTile;
    this.onBatchComplete = onBatchComplete;
    this.batchSize = batchSize;
  }

  /**
   * Schedule tiles for rendering. Visible tiles are prioritized.
   * Cancels any previously pending schedule.
   */
  schedule(tiles: TileKey[], visibleSet: Set<string>): void {
    const visible: TileKey[] = [];
    const background: TileKey[] = [];
    for (const tile of tiles) {
      if (visibleSet.has(tileKeyString(tile))) {
        visible.push(tile);
      } else {
        background.push(tile);
      }
    }
    this.pendingTiles = [...visible, ...background];
    this.startProcessing();
  }

  get pending(): number {
    return this.pendingTiles.length;
  }

  get isActive(): boolean {
    return this.renderingInProgress;
  }

  private startProcessing(): void {
    if (this.renderingInProgress) return;
    this.renderingInProgress = true;
    this.processNext();
  }

  private processNext(): void {
    if (this.pendingTiles.length === 0) {
      this.renderingInProgress = false;
      return;
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;

      const batch = this.pendingTiles.splice(0, this.batchSize);
      for (const key of batch) {
        this.renderOneTile(key);
      }

      this.onBatchComplete();
      this.processNext();
    });
  }

  cancel(): void {
    this.pendingTiles = [];
    this.renderingInProgress = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  destroy(): void {
    this.cancel();
  }
}
