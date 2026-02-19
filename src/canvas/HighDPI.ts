/**
 * Get the effective device pixel ratio, capped at 2x on mobile
 * to conserve GPU memory.
 */
export function getEffectiveDPR(isMobile: boolean): number {
  const dpr = window.devicePixelRatio || 1;
  return isMobile ? Math.min(dpr, 2) : dpr;
}

/**
 * Configure a canvas element for high-DPI rendering.
 * Sets the backing store size and applies CSS scaling so that
 * drawing coordinates remain in CSS pixels.
 */
export function setupHighDPICanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  isMobile: boolean
): number {
  const dpr = getEffectiveDPR(isMobile);

  // Set backing store size
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  // Set CSS display size
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  // Scale context so drawing uses CSS pixel coordinates
  ctx.scale(dpr, dpr);

  return dpr;
}

/**
 * Resize an existing high-DPI canvas. Clears the canvas content.
 */
export function resizeHighDPICanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  isMobile: boolean
): number {
  // Reset transform before resizing
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return setupHighDPICanvas(canvas, ctx, cssWidth, cssHeight, isMobile);
}
