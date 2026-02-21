import { StampCache } from "./StampCache";
import { generateStampTexture } from "./StampTexture";
import { grainSliderToConfig, grainConfigKey } from "./GrainMapping";

/**
 * Multi-texture cache keyed by grain slider value.
 * Each unique grain value maps to its own StampCache with a distinct alpha template.
 */
export class StampTextureManager {
  private caches = new Map<string, StampCache>();

  /**
   * Get (or generate) a StampCache for the given grain slider value.
   */
  getCache(grainValue: number): StampCache {
    const config = grainSliderToConfig(grainValue);
    const key = grainConfigKey(config);

    const existing = this.caches.get(key);
    if (existing) return existing;

    const alphaTemplate = generateStampTexture(config);
    const cache = new StampCache(alphaTemplate);
    this.caches.set(key, cache);
    return cache;
  }

  /**
   * Invalidate all cached textures.
   */
  clear(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    this.caches.clear();
  }
}
