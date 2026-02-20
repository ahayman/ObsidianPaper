import type { Camera } from "../Camera";
import type { TileKey, TileGridConfig } from "./TileTypes";

export class TileGrid {
  private config: TileGridConfig;

  constructor(config: TileGridConfig) {
    this.config = config;
  }

  /** Fixed world-space size of a tile. */
  get tileWorldSize(): number {
    return this.config.tileWorldSize;
  }

  /** Convert a world-space point to tile coordinates. */
  worldToTile(wx: number, wy: number): { col: number; row: number } {
    const ws = this.config.tileWorldSize;
    return {
      col: Math.floor(wx / ws),
      row: Math.floor(wy / ws),
    };
  }

  /** Get the world-space bounding box for a tile. */
  tileBounds(col: number, row: number): [number, number, number, number] {
    const ws = this.config.tileWorldSize;
    return [
      col * ws,
      row * ws,
      (col + 1) * ws,
      (row + 1) * ws,
    ];
  }

  /**
   * Get all tile keys needed for the current viewport, plus overscan.
   * Returns tiles sorted by distance from viewport center (closest first).
   */
  getVisibleTiles(
    camera: Camera,
    screenWidth: number,
    screenHeight: number,
  ): TileKey[] {
    const ws = this.config.tileWorldSize;

    const visibleRect = camera.getVisibleRect(screenWidth, screenHeight);

    // Expand by overscan
    const overscanWorld = this.config.overscanTiles * ws;
    const expandedMinX = visibleRect[0] - overscanWorld;
    const expandedMinY = visibleRect[1] - overscanWorld;
    const expandedMaxX = visibleRect[2] + overscanWorld;
    const expandedMaxY = visibleRect[3] + overscanWorld;

    const minCol = Math.floor(expandedMinX / ws);
    const minRow = Math.floor(expandedMinY / ws);
    const maxCol = Math.floor(expandedMaxX / ws);
    const maxRow = Math.floor(expandedMaxY / ws);

    // Center for priority sorting
    const centerX = (visibleRect[0] + visibleRect[2]) / 2;
    const centerY = (visibleRect[1] + visibleRect[3]) / 2;
    const centerCol = centerX / ws;
    const centerRow = centerY / ws;

    const tiles: TileKey[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        tiles.push({ col, row });
      }
    }

    tiles.sort((a, b) => {
      const distA = Math.abs(a.col - centerCol) + Math.abs(a.row - centerRow);
      const distB = Math.abs(b.col - centerCol) + Math.abs(b.row - centerRow);
      return distA - distB;
    });

    return tiles;
  }

  /** Get tiles that intersect a world-space bounding box. */
  getTilesForWorldBBox(
    bbox: [number, number, number, number],
  ): TileKey[] {
    const ws = this.config.tileWorldSize;

    const minCol = Math.floor(bbox[0] / ws);
    const minRow = Math.floor(bbox[1] / ws);
    const maxCol = Math.floor(bbox[2] / ws);
    const maxRow = Math.floor(bbox[3] / ws);

    const tiles: TileKey[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        tiles.push({ col, row });
      }
    }
    return tiles;
  }
}
