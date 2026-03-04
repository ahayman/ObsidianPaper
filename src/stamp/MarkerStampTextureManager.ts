/**
 * Manages marker stamp texture cache.
 * Generates the alpha template once, then StampCache handles per-color recoloring.
 */

import { StampCache } from "./StampCache";
import { generateMarkerStampTexture } from "./MarkerStampTexture";
import type { MarkerStampConfig } from "../stroke/PenConfigs";

export class MarkerStampTextureManager {
  private cache: StampCache | null = null;

  /**
   * Get (or generate) the StampCache for marker stamps.
   * Unlike ink stamps, there's only one template (no presets).
   */
  getCache(config?: MarkerStampConfig): StampCache {
    if (this.cache) return this.cache;

    const alphaTemplate = generateMarkerStampTexture(
      config
        ? {
            size: config.textureSize,
            aspectRatio: config.aspectRatio,
            cornerRadius: config.cornerRadius,
            fiberDensity: config.fiberDensity,
            edgeFuzziness: config.edgeFuzziness,
          }
        : undefined,
    );
    this.cache = new StampCache(alphaTemplate);
    return this.cache;
  }

  /**
   * Invalidate the cached texture (e.g. on config change).
   */
  clear(): void {
    this.cache?.clear();
    this.cache = null;
  }
}
