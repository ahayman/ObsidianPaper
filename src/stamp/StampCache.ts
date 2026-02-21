/**
 * Color-keyed stamp texture cache.
 * Recolors the alpha template to match stroke color on demand.
 * Caches by hex color string.
 *
 * Memory: ~9KB per color entry (48x48x4). With ~5 colors = ~46KB total.
 */
export class StampCache {
  private alphaTemplate: OffscreenCanvas;
  private colorCache = new Map<string, OffscreenCanvas>();

  constructor(alphaTemplate: OffscreenCanvas) {
    this.alphaTemplate = alphaTemplate;
  }

  /**
   * Get a colored version of the stamp texture.
   * Uses source-in compositing to replace white with the target color.
   */
  getColored(color: string): OffscreenCanvas {
    const cached = this.colorCache.get(color);
    if (cached) return cached;

    const size = this.alphaTemplate.width;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return this.alphaTemplate;

    // Draw the alpha template
    ctx.drawImage(this.alphaTemplate, 0, 0);

    // Recolor: source-in keeps alpha from destination, takes color from source
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);

    this.colorCache.set(color, canvas);
    return canvas;
  }

  /**
   * Get the raw alpha template ImageData for transferring to workers.
   */
  getImageData(): ImageData {
    const ctx = this.alphaTemplate.getContext("2d");
    if (!ctx) throw new Error("Failed to get context for stamp alpha template");
    return ctx.getImageData(0, 0, this.alphaTemplate.width, this.alphaTemplate.height);
  }

  /**
   * Invalidate all cached colored stamps (e.g. on config change).
   */
  clear(): void {
    this.colorCache.clear();
  }
}
