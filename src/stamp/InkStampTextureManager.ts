/**
 * Manages ink stamp texture caches keyed by preset ID.
 * Each preset produces a unique donut-profile alpha template,
 * then StampCache handles per-color recoloring.
 */

import { StampCache } from "./StampCache";
import { getInkPreset } from "./InkPresets";
import type { InkPresetId } from "./InkPresets";
import { generateInkStampTexture, generateInkStampImageData } from "./InkStampTexture";

export class InkStampTextureManager {
  private caches = new Map<string, StampCache>();

  /**
   * Get (or generate) a StampCache for the given ink preset.
   */
  getCache(presetId?: string): StampCache {
    const key = presetId ?? "standard";
    const existing = this.caches.get(key);
    if (existing) return existing;

    const preset = getInkPreset(presetId);
    const alphaTemplate = generateInkStampTexture({
      edgeDarkening: preset.edgeDarkening,
      grainInfluence: preset.grainInfluence,
    });
    const cache = new StampCache(alphaTemplate);
    this.caches.set(key, cache);
    return cache;
  }

  /**
   * Get ImageData for the given preset (for worker transfer).
   */
  getImageData(presetId?: string): ImageData {
    const preset = getInkPreset(presetId);
    return generateInkStampImageData({
      edgeDarkening: preset.edgeDarkening,
      grainInfluence: preset.grainInfluence,
    });
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
