import { TileGrid } from "./TileGrid";
import { Camera } from "../Camera";
import type { TileGridConfig } from "./TileTypes";

function makeConfig(overrides?: Partial<TileGridConfig>): TileGridConfig {
  return {
    tileWorldSize: 512,
    dpr: 2,
    maxMemoryBytes: 200 * 1024 * 1024,
    overscanTiles: 1,
    maxTilePhysical: 2048,
    minTilePhysical: 256,
    resolutionScale: 1,
    ...overrides,
  };
}

describe("TileGrid", () => {
  describe("tileWorldSize", () => {
    it("returns the configured world size", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      expect(grid.tileWorldSize).toBe(512);
    });

    it("returns custom world size", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 256 }));
      expect(grid.tileWorldSize).toBe(256);
    });
  });

  describe("worldToTile", () => {
    it("maps origin to tile (0, 0)", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const result = grid.worldToTile(100, 100);
      expect(result.col).toBe(0);
      expect(result.row).toBe(0);
    });

    it("maps negative coords to negative tiles", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const result = grid.worldToTile(-1, -1);
      expect(result.col).toBe(-1);
      expect(result.row).toBe(-1);
    });

    it("maps coords past one tile to tile 1", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const result = grid.worldToTile(600, 600);
      expect(result.col).toBe(1);
      expect(result.row).toBe(1);
    });
  });

  describe("tileBounds", () => {
    it("returns correct world rect for tile (0, 0)", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const bounds = grid.tileBounds(0, 0);
      expect(bounds).toEqual([0, 0, 512, 512]);
    });

    it("returns correct world rect for tile (1, 2)", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const bounds = grid.tileBounds(1, 2);
      expect(bounds).toEqual([512, 1024, 1024, 1536]);
    });

    it("handles negative tile indices", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const bounds = grid.tileBounds(-1, -1);
      expect(bounds).toEqual([-512, -512, 0, 0]);
    });
  });

  describe("getVisibleTiles", () => {
    it("returns tiles covering the viewport", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512, overscanTiles: 0 }));
      const camera = new Camera({ x: 0, y: 0, zoom: 1.0 });
      // Viewport: 0..1024 x 0..768 world units at zoom 1
      // Tile size = 512 world units (fixed)
      // Cols: floor(0/512)=0 to floor(1024/512)=2 → 3 cols
      // Rows: floor(0/512)=0 to floor(768/512)=1 → 2 rows
      // Total: 6 tiles
      const tiles = grid.getVisibleTiles(camera, 1024, 768);

      expect(tiles.length).toBe(6);
      // No zoomBand in keys
      for (const tile of tiles) {
        expect(tile).toEqual(expect.objectContaining({ col: expect.any(Number), row: expect.any(Number) }));
        expect(tile).not.toHaveProperty("zoomBand");
      }
    });

    it("tile count is independent of zoom level", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512, overscanTiles: 0 }));
      // At zoom 2.0, viewport covers 512x384 world units
      // Cols: floor(0/512)=0 to floor(512/512)=1 → 2 cols
      // Rows: floor(0/512)=0 to floor(384/512)=0 → 1 row
      // Total: 2 tiles
      const camera2 = new Camera({ x: 0, y: 0, zoom: 2.0 });
      const tiles2 = grid.getVisibleTiles(camera2, 1024, 768);
      expect(tiles2.length).toBe(2);

      // At zoom 0.5, viewport covers 2048x1536 world units
      // Cols: floor(0/512)=0 to floor(2048/512)=4 → 5 cols
      // Rows: floor(0/512)=0 to floor(1536/512)=3 → 4 rows
      // Total: 20 tiles
      const camera05 = new Camera({ x: 0, y: 0, zoom: 0.5 });
      const tiles05 = grid.getVisibleTiles(camera05, 1024, 768);
      expect(tiles05.length).toBe(20);
    });

    it("includes overscan tiles", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512, overscanTiles: 1 }));
      const camera = new Camera({ x: 0, y: 0, zoom: 1.0 });
      const tiles = grid.getVisibleTiles(camera, 1024, 768);

      // Without overscan: 6 tiles. With 1 tile overscan: more tiles
      expect(tiles.length).toBeGreaterThan(6);
    });

    it("sorts tiles by distance from center (closest first)", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512, overscanTiles: 1 }));
      const camera = new Camera({ x: 0, y: 0, zoom: 1.0 });
      const tiles = grid.getVisibleTiles(camera, 1024, 768);

      expect(tiles.length).toBeGreaterThan(0);

      const ws = grid.tileWorldSize;
      const centerCol = 512 / ws;
      const centerRow = 384 / ws;

      for (let i = 1; i < tiles.length; i++) {
        const distPrev = Math.abs(tiles[i - 1].col - centerCol) + Math.abs(tiles[i - 1].row - centerRow);
        const distCurr = Math.abs(tiles[i].col - centerCol) + Math.abs(tiles[i].row - centerRow);
        expect(distCurr).toBeGreaterThanOrEqual(distPrev - 0.001);
      }
    });
  });

  describe("getTilesForWorldBBox", () => {
    it("returns tiles covering the bbox", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const bbox: [number, number, number, number] = [100, 100, 600, 600];
      const tiles = grid.getTilesForWorldBBox(bbox);

      // bbox spans cols 0-1, rows 0-1 → 4 tiles
      expect(tiles.length).toBe(4);
    });

    it("returns a single tile for a point-sized bbox", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const bbox: [number, number, number, number] = [100, 100, 100, 100];
      const tiles = grid.getTilesForWorldBBox(bbox);

      expect(tiles.length).toBe(1);
      expect(tiles[0].col).toBe(0);
      expect(tiles[0].row).toBe(0);
    });

    it("handles negative coordinates", () => {
      const grid = new TileGrid(makeConfig({ tileWorldSize: 512 }));
      const bbox: [number, number, number, number] = [-100, -100, 100, 100];
      const tiles = grid.getTilesForWorldBBox(bbox);

      // Spans cols -1 to 0, rows -1 to 0 → 4 tiles
      expect(tiles.length).toBe(4);
    });
  });
});
