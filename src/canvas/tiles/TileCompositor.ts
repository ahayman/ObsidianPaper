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

    // Work in physical pixel space (identity transform) to ensure
    // tile edges align exactly to device pixels. Using a DPR scale
    // transform can cause Chromium on macOS to anti-alias drawImage
    // destination rect edges, creating visible seams between tiles.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const tileWorldSize = this.config.tileWorldSize;
    const visibleTiles = this.grid.getVisibleTiles(camera, screenWidth, screenHeight);

    for (const key of visibleTiles) {
      const entry = tileCache.getStale(key);
      if (!entry) continue;

      // Compute destination rect in physical pixels, rounded to integers
      const px0 = Math.round((key.col * tileWorldSize - camera.x) * camera.zoom * dpr);
      const py0 = Math.round((key.row * tileWorldSize - camera.y) * camera.zoom * dpr);
      const px1 = Math.round(((key.col + 1) * tileWorldSize - camera.x) * camera.zoom * dpr);
      const py1 = Math.round(((key.row + 1) * tileWorldSize - camera.y) * camera.zoom * dpr);

      ctx.drawImage(
        entry.canvas,
        0, 0, entry.canvas.width, entry.canvas.height,
        px0, py0, px1 - px0, py1 - py0,
      );
    }

    ctx.imageSmoothingEnabled = true;
  }
}
