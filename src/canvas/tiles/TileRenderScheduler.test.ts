import { TileRenderScheduler } from "./TileRenderScheduler";
import { tileKeyString } from "./TileTypes";
import type { TileKey } from "./TileTypes";

describe("TileRenderScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("processes tiles via requestAnimationFrame", () => {
    const rendered: TileKey[] = [];
    let batchCount = 0;

    const scheduler = new TileRenderScheduler(
      (key) => rendered.push(key),
      () => batchCount++,
      2, // batch size
    );

    const tiles: TileKey[] = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ];

    scheduler.schedule(tiles, new Set());

    expect(rendered.length).toBe(0);
    expect(scheduler.isActive).toBe(true);

    // First RAF: renders batch of 2
    jest.runOnlyPendingTimers();
    expect(rendered.length).toBe(2);
    expect(batchCount).toBe(1);

    // Second RAF: renders remaining 1
    jest.runOnlyPendingTimers();
    expect(rendered.length).toBe(3);
    expect(batchCount).toBe(2);

    // No more pending
    jest.runOnlyPendingTimers();
    expect(scheduler.isActive).toBe(false);

    scheduler.destroy();
  });

  it("prioritizes visible tiles before background tiles", () => {
    const rendered: TileKey[] = [];

    const scheduler = new TileRenderScheduler(
      (key) => rendered.push(key),
      () => {},
      10, // large batch to get all in one frame
    );

    const visible: TileKey = { col: 1, row: 0 };
    const background1: TileKey = { col: 0, row: 0 };
    const background2: TileKey = { col: 2, row: 0 };

    // background tiles are listed first, but visible set determines priority
    const tiles = [background1, visible, background2];
    const visibleSet = new Set([tileKeyString(visible)]);

    scheduler.schedule(tiles, visibleSet);
    jest.runOnlyPendingTimers();

    // Visible tile should be rendered first
    expect(rendered[0]).toEqual(visible);
    expect(rendered.length).toBe(3);

    scheduler.destroy();
  });

  it("cancel stops all pending renders", () => {
    const rendered: TileKey[] = [];

    const scheduler = new TileRenderScheduler(
      (key) => rendered.push(key),
      () => {},
      1,
    );

    const tiles: TileKey[] = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ];

    scheduler.schedule(tiles, new Set());

    // Render first tile
    jest.runOnlyPendingTimers();
    expect(rendered.length).toBe(1);

    // Cancel before remaining tiles
    scheduler.cancel();
    expect(scheduler.isActive).toBe(false);
    expect(scheduler.pending).toBe(0);

    // Subsequent RAF should not render anything
    jest.runAllTimers();
    expect(rendered.length).toBe(1);

    scheduler.destroy();
  });

  it("reports pending count correctly", () => {
    const scheduler = new TileRenderScheduler(
      () => {},
      () => {},
      2,
    );

    const tiles: TileKey[] = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ];

    scheduler.schedule(tiles, new Set());
    expect(scheduler.pending).toBe(3);

    jest.runOnlyPendingTimers();
    expect(scheduler.pending).toBe(1);

    jest.runOnlyPendingTimers();
    expect(scheduler.pending).toBe(0);

    scheduler.destroy();
  });
});
