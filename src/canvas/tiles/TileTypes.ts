/** Identifies a unique tile in the cache by its grid position. */
export interface TileKey {
  col: number;
  row: number;
}

export function tileKeyString(key: TileKey): string {
  return `${key.col},${key.row}`;
}

/** A cached tile with its rendered content and metadata. */
export interface TileEntry {
  key: TileKey;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  worldBounds: [number, number, number, number];
  strokeIds: Set<string>;
  dirty: boolean;
  lastAccess: number;
  memoryBytes: number;
  /** The zoom band this tile was last rendered at (determines canvas resolution). */
  renderedAtBand: number;
}

/**
 * Zoom bands map continuous zoom levels to discrete rendering resolutions.
 *
 * Sub-bands at sqrt(2) intervals (~1.414x) limit scaling artifacts.
 * Tiles rendered at a band's base zoom are scaled by at most ~1.41x
 * before the next band triggers a re-render.
 */
export function zoomToZoomBand(zoom: number): number {
  return Math.floor(Math.log2(zoom) * 2);
}

export function zoomBandBaseZoom(band: number): number {
  return Math.pow(2, band / 2);
}

export interface TileGridConfig {
  tileWorldSize: number;     // Fixed world-space tile size (default: 512)
  dpr: number;
  maxMemoryBytes: number;    // Default: 200 * 1024 * 1024 (200MB)
  overscanTiles: number;     // Default: 1
  maxTilePhysical: number;   // Max canvas size in pixels (default: 2048)
  minTilePhysical: number;   // Min canvas size in pixels (default: 256)
}

/**
 * Compute the physical canvas size (in pixels) for a tile at the given zoom band.
 * Clamped between minTilePhysical and maxTilePhysical.
 */
export function tileSizePhysicalForBand(config: TileGridConfig, zoomBand: number): number {
  const ideal = config.tileWorldSize * zoomBandBaseZoom(zoomBand) * config.dpr;
  return Math.min(Math.max(Math.ceil(ideal), config.minTilePhysical), config.maxTilePhysical);
}

export const DEFAULT_TILE_CONFIG: TileGridConfig = {
  tileWorldSize: 512,
  dpr: 2,
  maxMemoryBytes: 200 * 1024 * 1024,
  overscanTiles: 1,
  maxTilePhysical: 2048,
  minTilePhysical: 256,
};
