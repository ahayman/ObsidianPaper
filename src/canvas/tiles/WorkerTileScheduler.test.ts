/**
 * Unit tests for WorkerTileScheduler — WebGL tile result path.
 *
 * Focuses on:
 * - onTileResult callback path (WebGL mode)
 * - cache.allocate skipped when onTileResult is set
 * - handleTileResult routing (WebGL vs Canvas2D)
 * - In-flight tracking and dispatch behavior
 */

import { WorkerTileScheduler } from "./WorkerTileScheduler";
import type { TileGridConfig, TileKey } from "./TileTypes";
import { tileKeyString } from "./TileTypes";

// ─── Mock tile-worker-code module ───────────────────────────────
jest.mock("tile-worker-code", () => "/* mock worker code */", { virtual: true });

// ─── Mock Worker ────────────────────────────────────────────────

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private messageLog: any[] = [];

  postMessage(msg: any): void {
    this.messageLog.push(msg);
  }

  terminate(): void {}

  /** Simulate a message from the worker. */
  simulateMessage(data: any): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  getMessages(): any[] {
    return this.messageLog;
  }
}

// Track all created workers
let createdWorkers: MockWorker[] = [];

beforeAll(() => {
  // Mock Worker constructor
  const origWorker = globalThis.Worker;
  (globalThis as any).Worker = class extends MockWorker {
    constructor(_url: string | URL) {
      super();
      createdWorkers.push(this);
    }
  };

  // Mock URL.createObjectURL / revokeObjectURL
  (globalThis as any).URL.createObjectURL = jest.fn(() => "blob:mock-url");
  (globalThis as any).URL.revokeObjectURL = jest.fn();

  // Mock requestAnimationFrame
  jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    setTimeout(cb, 0);
    return 1;
  });
  jest.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
});

// ─── Helpers ────────────────────────────────────────────────────

function makeConfig(): TileGridConfig {
  return {
    tileWorldSize: 512,
    dpr: 2,
    maxMemoryBytes: 200 * 1024 * 1024,
    overscanTiles: 1,
    maxTilePhysical: 2048,
    minTilePhysical: 256,
    resolutionScale: 1,
  };
}

function makeMockCache() {
  return {
    allocate: jest.fn(),
    getStale: jest.fn(() => null),
    markClean: jest.fn(),
  };
}

function makeMockGrid() {
  return {
    tileBounds: jest.fn((col: number, row: number): [number, number, number, number] =>
      [col * 512, row * 512, (col + 1) * 512, (row + 1) * 512]),
  };
}

function makeSpatialIndex() {
  return {
    queryRect: jest.fn(() => ["stroke-1"]),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("WorkerTileScheduler", () => {
  beforeEach(() => {
    createdWorkers = [];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("initialization", () => {
    it("creates a worker pool", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      expect(createdWorkers.length).toBeGreaterThanOrEqual(2);
      expect(scheduler.fallbackToMainThread).toBe(false);

      scheduler.destroy();
    });
  });

  describe("WebGL mode (onTileResult callback)", () => {
    it("calls onTileResult instead of Canvas2D path when provided", () => {
      const onBatchComplete = jest.fn();
      const onTileResult = jest.fn();
      const cache = makeMockCache();
      const grid = makeMockGrid();
      const spatial = makeSpatialIndex();

      const scheduler = new WorkerTileScheduler(
        makeConfig(), cache as any, grid as any,
        onBatchComplete, onTileResult,
      );

      // Schedule a tile
      const tiles: TileKey[] = [{ col: 0, row: 0 }];
      const visibleSet = new Set([tileKeyString(tiles[0])]);
      scheduler.schedule(tiles, visibleSet, spatial as any, false, 0);

      // Simulate worker completing the tile
      const worker = createdWorkers.find(w => w.getMessages().some(m => m.type === "render-tile"));
      expect(worker).toBeDefined();

      const bitmap = { width: 1024, height: 1024, close: jest.fn() } as unknown as ImageBitmap;
      worker!.simulateMessage({
        type: "tile-result",
        tileKey: "0,0",
        bitmap,
        strokeIds: ["stroke-1"],
      });

      // onTileResult should have been called
      expect(onTileResult).toHaveBeenCalledWith("0,0", bitmap, ["stroke-1"], 0);

      // Canvas2D cache.markClean should NOT have been called
      expect(cache.markClean).not.toHaveBeenCalled();

      scheduler.destroy();
    });

    it("skips cache.allocate when onTileResult is set", () => {
      const onBatchComplete = jest.fn();
      const onTileResult = jest.fn();
      const cache = makeMockCache();
      const grid = makeMockGrid();
      const spatial = makeSpatialIndex();

      const scheduler = new WorkerTileScheduler(
        makeConfig(), cache as any, grid as any,
        onBatchComplete, onTileResult,
      );

      const tiles: TileKey[] = [{ col: 0, row: 0 }];
      const visibleSet = new Set([tileKeyString(tiles[0])]);
      scheduler.schedule(tiles, visibleSet, spatial as any, false, 0);

      // cache.allocate should NOT be called in WebGL mode
      expect(cache.allocate).not.toHaveBeenCalled();

      scheduler.destroy();
    });

    it("calls cache.allocate when onTileResult is NOT set (Canvas2D mode)", () => {
      const onBatchComplete = jest.fn();
      const cache = makeMockCache();
      const grid = makeMockGrid();
      const spatial = makeSpatialIndex();

      const scheduler = new WorkerTileScheduler(
        makeConfig(), cache as any, grid as any,
        onBatchComplete,
        // No onTileResult → Canvas2D mode
      );

      const tiles: TileKey[] = [{ col: 0, row: 0 }];
      const visibleSet = new Set([tileKeyString(tiles[0])]);
      scheduler.schedule(tiles, visibleSet, spatial as any, false, 0);

      // cache.allocate SHOULD be called in Canvas2D mode
      expect(cache.allocate).toHaveBeenCalled();

      scheduler.destroy();
    });
  });

  describe("scheduling and dispatch", () => {
    it("sends render messages to idle workers", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      const spatial = makeSpatialIndex();
      const tiles: TileKey[] = [{ col: 0, row: 0 }];
      scheduler.schedule(tiles, new Set([tileKeyString(tiles[0])]), spatial as any, false, 0);

      // At least one worker should have received a render-tile message
      const hasRenderMsg = createdWorkers.some(w =>
        w.getMessages().some(m => m.type === "render-tile"),
      );
      expect(hasRenderMsg).toBe(true);

      scheduler.destroy();
    });

    it("does not dispatch duplicate tiles for same key", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      const spatial = makeSpatialIndex();
      const tile: TileKey = { col: 0, row: 0 };
      const visibleSet = new Set([tileKeyString(tile)]);

      // Schedule same tile twice
      scheduler.schedule([tile], visibleSet, spatial as any, false, 0);
      scheduler.schedule([tile], visibleSet, spatial as any, false, 0);

      // Count render-tile messages across all workers
      const renderMsgs = createdWorkers.flatMap(w =>
        w.getMessages().filter(m => m.type === "render-tile"),
      );
      expect(renderMsgs.length).toBe(1); // Only dispatched once

      scheduler.destroy();
    });

    it("prioritizes visible tiles before background tiles", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      const spatial = makeSpatialIndex();
      const bg: TileKey = { col: 5, row: 5 };
      const visible: TileKey = { col: 0, row: 0 };

      // bg listed first, but visible in visible set
      scheduler.schedule([bg, visible], new Set([tileKeyString(visible)]), spatial as any, false, 0);

      // First dispatched tile should be the visible one
      const firstRenderMsg = createdWorkers
        .flatMap(w => w.getMessages())
        .find(m => m.type === "render-tile");

      expect(firstRenderMsg?.tileKey).toBe(tileKeyString(visible));

      scheduler.destroy();
    });

    it("reports correct pending count", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      expect(scheduler.pending).toBe(0);
      expect(scheduler.isActive).toBe(false);

      const spatial = makeSpatialIndex();
      scheduler.schedule(
        [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }],
        new Set(),
        spatial as any, false, 0,
      );

      expect(scheduler.pending).toBeGreaterThan(0);
      expect(scheduler.isActive).toBe(true);

      scheduler.destroy();
    });
  });

  describe("cancellation", () => {
    it("cancel clears pending queue and in-flight map", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      const spatial = makeSpatialIndex();
      scheduler.schedule(
        [{ col: 0, row: 0 }, { col: 1, row: 0 }],
        new Set(), spatial as any, false, 0,
      );

      scheduler.cancel();

      expect(scheduler.pending).toBe(0);
      expect(scheduler.isActive).toBe(false);

      scheduler.destroy();
    });

    it("sends cancel message to busy workers", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      const spatial = makeSpatialIndex();
      scheduler.schedule(
        [{ col: 0, row: 0 }],
        new Set(), spatial as any, false, 0,
      );

      scheduler.cancel();

      // At least one worker should have received a cancel message
      const hasCancelMsg = createdWorkers.some(w =>
        w.getMessages().some(m => m.type === "cancel"),
      );
      expect(hasCancelMsg).toBe(true);

      scheduler.destroy();
    });
  });

  describe("error handling", () => {
    it("handles tile-error messages gracefully", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      const spatial = makeSpatialIndex();
      scheduler.schedule(
        [{ col: 0, row: 0 }],
        new Set([tileKeyString({ col: 0, row: 0 })]),
        spatial as any, false, 0,
      );

      const worker = createdWorkers.find(w =>
        w.getMessages().some(m => m.type === "render-tile"),
      );

      // Simulate error response — should not throw
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      worker!.simulateMessage({
        type: "tile-error",
        tileKey: "0,0",
        error: "test error",
      });
      consoleSpy.mockRestore();

      scheduler.destroy();
    });

    it("worker onerror cleans up in-flight map, allowing tile to be re-scheduled", () => {
      const onBatchComplete = jest.fn();
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        onBatchComplete,
      );

      const spatial = makeSpatialIndex();
      const tile: TileKey = { col: 0, row: 0 };
      scheduler.schedule([tile], new Set([tileKeyString(tile)]), spatial as any, false, 0);

      // Find the worker that got the tile
      const busyWorker = createdWorkers.find(w =>
        w.getMessages().some(m => m.type === "render-tile" && m.tileKey === "0,0"),
      );
      expect(busyWorker).toBeDefined();

      // Simulate worker onerror
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      busyWorker!.onerror?.({ message: "Worker crashed" } as ErrorEvent);
      consoleSpy.mockRestore();

      // The tile should be re-schedulable (not stuck in in-flight)
      // Re-scheduling the same tile should dispatch it again
      scheduler.schedule([tile], new Set([tileKeyString(tile)]), spatial as any, false, 0);

      // Count render-tile messages for this key
      const renderMsgs = createdWorkers.flatMap(w =>
        w.getMessages().filter(m => m.type === "render-tile" && m.tileKey === "0,0"),
      );
      // Should have 2 dispatches: original + re-schedule after error
      expect(renderMsgs.length).toBe(2);

      scheduler.destroy();
    });
  });

  describe("destroy", () => {
    it("terminates all workers", () => {
      const scheduler = new WorkerTileScheduler(
        makeConfig(), makeMockCache() as any, makeMockGrid() as any,
        jest.fn(),
      );

      const terminateSpies = createdWorkers.map(w => jest.spyOn(w, "terminate"));

      scheduler.destroy();

      for (const spy of terminateSpies) {
        expect(spy).toHaveBeenCalled();
      }
    });
  });
});
