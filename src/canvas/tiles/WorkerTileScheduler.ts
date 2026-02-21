/**
 * Main-thread Web Worker pool manager for tile rendering.
 *
 * Dispatches render jobs to a pool of workers, receives ImageBitmap results,
 * draws them onto TileEntry canvases, and triggers compositing.
 *
 * Falls back to the existing TileRenderScheduler if Worker creation fails.
 */

import type { TileKey, TileEntry, TileGridConfig } from "./TileTypes";
import { tileKeyString, tileSizePhysicalForBand } from "./TileTypes";
import type { TileCache } from "./TileCache";
import type { TileGrid } from "./TileGrid";
import type { SpatialIndex } from "../../spatial/SpatialIndex";
import type { PaperDocument, PenType } from "../../types";
import type { PageRect } from "../../document/PageLayout";
import type { GrainTextureGenerator } from "../GrainTextureGenerator";
import type {
  WorkerToMainMessage,
  WorkerDocUpdateMessage,
  WorkerGrainUpdateMessage,
  WorkerInitMessage,
  WorkerRenderTileMessage,
} from "./worker/TileWorkerProtocol";

// Virtual module injected by esbuild plugin at build time
import tileWorkerCode from "tile-worker-code";

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  /** Key of the tile currently being rendered, or null if idle. */
  currentTileKey: string | null;
}

export class WorkerTileScheduler {
  private pool: WorkerSlot[] = [];
  private pendingQueue: WorkerRenderTileMessage[] = [];
  private config: TileGridConfig;
  private cache: TileCache;
  private grid: TileGrid;

  /** True if Worker creation failed — caller should use main-thread fallback. */
  fallbackToMainThread = false;

  /** Callback invoked when one or more tile results arrive (batched per RAF). */
  private onBatchComplete: (() => void) | null = null;

  /** RAF id for coalescing multiple results into one composite. */
  private compositeRafId: number | null = null;

  /** In-flight render jobs: tileKey → zoom band dispatched at. */
  private inFlight = new Map<string, number>();

  constructor(
    config: TileGridConfig,
    cache: TileCache,
    grid: TileGrid,
    onBatchComplete: () => void,
  ) {
    this.config = config;
    this.cache = cache;
    this.grid = grid;
    this.onBatchComplete = onBatchComplete;

    this.initPool();
  }

  private initPool(): void {
    const poolSize = this.getPoolSize();

    try {
      const blob = new Blob([tileWorkerCode], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);

      for (let i = 0; i < poolSize; i++) {
        const worker = new Worker(url);
        const slot: WorkerSlot = { worker, busy: false, currentTileKey: null };
        worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
          this.handleWorkerMessage(slot, e.data);
        };
        worker.onerror = (e) => {
          console.error("[WorkerTileScheduler] Worker error:", e.message);
          slot.busy = false;
          slot.currentTileKey = null;
          // Try to dispatch the next job
          this.dispatchNext(slot);
        };
        this.pool.push(slot);
      }

      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn(
        "[WorkerTileScheduler] Worker creation failed, falling back to main thread:",
        e,
      );
      this.fallbackToMainThread = true;
    }
  }

  private getPoolSize(): number {
    const cores =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;
    return Math.min(Math.max(cores - 1, 2), 4);
  }

  // ─── Initialization ──────────────────────────────────────────

  /**
   * Send grain texture to all workers. Call once after initGrain()
   * and again whenever grain settings change.
   */
  initGrain(grainGenerator: GrainTextureGenerator | null): void {
    if (this.fallbackToMainThread) return;

    const imageData = grainGenerator?.getImageData() ?? null;
    const msg: WorkerInitMessage = {
      type: "init",
      grainImageData: imageData,
    };

    for (const slot of this.pool) {
      slot.worker.postMessage(msg);
    }
  }

  /**
   * Send grain settings update (new texture + strength overrides).
   */
  updateGrain(
    grainGenerator: GrainTextureGenerator | null,
    strengthOverrides: Map<PenType, number>,
  ): void {
    if (this.fallbackToMainThread) return;

    const msg: WorkerGrainUpdateMessage = {
      type: "grain-update",
      grainImageData: grainGenerator?.getImageData() ?? null,
      strengthOverrides: Array.from(strengthOverrides.entries()),
    };

    for (const slot of this.pool) {
      slot.worker.postMessage(msg);
    }
  }

  /**
   * Send document state to all workers. Call on mutation (add/remove/undo).
   */
  updateDocument(doc: PaperDocument, pageLayout: PageRect[]): void {
    if (this.fallbackToMainThread) return;

    const msg: WorkerDocUpdateMessage = {
      type: "doc-update",
      strokes: doc.strokes,
      styles: doc.styles,
      pages: doc.pages,
      pageLayout: pageLayout,
      layoutDirection: doc.layoutDirection,
    };

    for (const slot of this.pool) {
      slot.worker.postMessage(msg);
    }
  }

  // ─── Scheduling ──────────────────────────────────────────────

  /**
   * Schedule tiles for worker-based rendering.
   * Pre-queries the spatial index on main thread and dispatches
   * render messages to idle workers.
   */
  schedule(
    tiles: TileKey[],
    visibleSet: Set<string>,
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
    zoomBand: number,
  ): void {
    if (this.fallbackToMainThread) return;

    // Prioritize visible tiles first
    const visible: TileKey[] = [];
    const background: TileKey[] = [];
    for (const tile of tiles) {
      const key = tileKeyString(tile);
      // Skip if already in-flight at this zoom band
      if (this.inFlight.has(key)) continue;
      if (visibleSet.has(key)) {
        visible.push(tile);
      } else {
        background.push(tile);
      }
    }
    const sorted = [...visible, ...background];

    const tilePhysical = tileSizePhysicalForBand(this.config, zoomBand);

    for (const tile of sorted) {
      const tileKey = tileKeyString(tile);
      const worldBounds = this.grid.tileBounds(tile.col, tile.row);

      // Only allocate entries that don't exist yet. Tiles with stale content
      // (wrong zoom band) keep their old pixels visible until the worker
      // result arrives — handleTileResult() re-allocates at that point.
      if (!this.cache.getStale(tile)) {
        this.cache.allocate(tile, worldBounds, zoomBand);
      }

      // Pre-query spatial index on main thread
      const strokeIds = spatialIndex.queryRect(
        worldBounds[0], worldBounds[1],
        worldBounds[2], worldBounds[3],
      );

      const msg: WorkerRenderTileMessage = {
        type: "render-tile",
        tileKey,
        worldBounds,
        zoomBand,
        tilePhysical,
        tileWorldSize: this.config.tileWorldSize,
        strokeIds,
        isDarkMode,
      };

      this.inFlight.set(tileKey, zoomBand);
      this.pendingQueue.push(msg);
    }

    // Dispatch to idle workers
    this.dispatchAll();
  }

  get pending(): number {
    return this.pendingQueue.length + this.pool.filter((s) => s.busy).length;
  }

  get isActive(): boolean {
    return this.pending > 0;
  }

  // ─── Dispatching ─────────────────────────────────────────────

  private dispatchAll(): void {
    for (const slot of this.pool) {
      if (!slot.busy && this.pendingQueue.length > 0) {
        this.dispatchNext(slot);
      }
    }
  }

  private dispatchNext(slot: WorkerSlot): void {
    if (this.pendingQueue.length === 0) {
      slot.busy = false;
      slot.currentTileKey = null;
      return;
    }

    const msg = this.pendingQueue.shift()!;
    slot.busy = true;
    slot.currentTileKey = msg.tileKey;
    slot.worker.postMessage(msg);
  }

  // ─── Result Handling ─────────────────────────────────────────

  private handleWorkerMessage(slot: WorkerSlot, msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case "tile-result":
        this.handleTileResult(msg.tileKey, msg.bitmap, msg.strokeIds);
        break;
      case "tile-error":
        console.warn(`[WorkerTileScheduler] Tile ${msg.tileKey} error: ${msg.error}`);
        this.inFlight.delete(msg.tileKey);
        break;
      case "ready":
        // Worker initialized, nothing else to do
        break;
    }

    // Worker is now free — dispatch next job
    slot.busy = false;
    slot.currentTileKey = null;
    this.dispatchNext(slot);
  }

  private handleTileResult(
    tileKey: string,
    bitmap: ImageBitmap,
    strokeIds: string[],
  ): void {
    // Retrieve the zoom band this job was dispatched at
    const dispatchBand = this.inFlight.get(tileKey);
    this.inFlight.delete(tileKey);

    // Find the matching tile entry in cache
    const entry = this.findEntryByKey(tileKey);
    if (!entry) {
      // Tile was evicted from cache before result arrived — discard
      bitmap.close();
      return;
    }

    // If the entry canvas doesn't match the bitmap size (stale zoom band
    // from before the worker was dispatched), re-allocate now. This is
    // deferred from schedule() to preserve old content until the new
    // pixels are ready, avoiding a blank flash.
    if (entry.canvas.width !== bitmap.width || entry.canvas.height !== bitmap.height) {
      if (dispatchBand !== undefined) {
        this.cache.allocate(entry.key, entry.worldBounds, dispatchBand);
      } else {
        // No band info — discard, will be re-scheduled
        bitmap.close();
        return;
      }
    }

    // Re-fetch entry after potential re-allocation (allocate creates new ctx)
    const current = this.findEntryByKey(tileKey);
    if (!current || current.canvas.width !== bitmap.width) {
      bitmap.close();
      return;
    }

    // Draw the ImageBitmap onto the TileEntry's OffscreenCanvas
    const ctx = current.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, current.canvas.width, current.canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    // Update stroke ID tracking
    current.strokeIds.clear();
    for (const id of strokeIds) {
      current.strokeIds.add(id);
    }

    // Mark tile as clean
    this.cache.markClean(current.key);

    // Schedule a batched composite
    this.scheduleComposite();
  }

  private findEntryByKey(tileKey: string): TileEntry | null {
    // Parse "col,row" back to TileKey
    const parts = tileKey.split(",");
    if (parts.length !== 2) return null;
    const col = parseInt(parts[0], 10);
    const row = parseInt(parts[1], 10);
    if (isNaN(col) || isNaN(row)) return null;
    return this.cache.getStale({ col, row }) ?? null;
  }

  private scheduleComposite(): void {
    if (this.compositeRafId !== null) return;
    this.compositeRafId = requestAnimationFrame(() => {
      this.compositeRafId = null;
      this.onBatchComplete?.();
    });
  }

  // ─── Cancellation & Cleanup ──────────────────────────────────

  /**
   * Cancel all pending and in-flight render jobs.
   */
  cancel(): void {
    this.pendingQueue = [];
    this.inFlight.clear();

    if (this.compositeRafId !== null) {
      cancelAnimationFrame(this.compositeRafId);
      this.compositeRafId = null;
    }

    // Tell workers to cancel current work
    for (const slot of this.pool) {
      if (slot.busy) {
        slot.worker.postMessage({ type: "cancel" });
        slot.busy = false;
        slot.currentTileKey = null;
      }
    }
  }

  destroy(): void {
    this.cancel();

    for (const slot of this.pool) {
      slot.worker.postMessage({ type: "destroy" });
      slot.worker.terminate();
    }
    this.pool = [];
    this.onBatchComplete = null;
  }
}
