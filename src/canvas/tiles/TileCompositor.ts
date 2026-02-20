import type { Camera } from "../Camera";
import type { TileCache } from "./TileCache";
import type { TileGridConfig } from "./TileTypes";
import { TileGrid } from "./TileGrid";

/**
 * Composites visible tiles onto the display canvas each frame.
 *
 * Single-pass: for each visible grid position, draws whatever tile is
 * cached (at any resolution). Tile screen size is fixed at
 * tileWorldSize * camera.zoom since all tiles cover the same world area.
 */
export class TileCompositor {
  private grid: TileGrid;
  private config: TileGridConfig;

  constructor(grid: TileGrid, config: TileGridConfig) {
    this.grid = grid;
    this.config = config;
  }

  /**
   * Composite all visible tiles onto the target canvas context.
   * Source rect adapts to the tile's actual canvas size (which varies by
   * rendering resolution), while destination size is always tileWorldSize * zoom.
   */
  composite(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camera: Camera,
    screenWidth: number,
    screenHeight: number,
    tileCache: TileCache,
  ): void {
    const dpr = this.config.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const tileScreenSize = this.config.tileWorldSize * camera.zoom;
    const visibleTiles = this.grid.getVisibleTiles(camera, screenWidth, screenHeight);

    for (const key of visibleTiles) {
      const entry = tileCache.getStale(key);
      if (!entry) continue;

      const screenX = (key.col * this.config.tileWorldSize - camera.x) * camera.zoom;
      const screenY = (key.row * this.config.tileWorldSize - camera.y) * camera.zoom;

      ctx.drawImage(
        entry.canvas,
        0, 0, entry.canvas.width, entry.canvas.height,
        screenX, screenY, tileScreenSize, tileScreenSize,
      );
    }
  }
}
