import type { CameraState } from "../types";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5.0;

const PAN_MARGIN = 20; // world units that must remain visible

export class Camera {
  x: number;
  y: number;
  zoom: number;

  private minZoom = MIN_ZOOM;
  private maxZoom = MAX_ZOOM;
  private docBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  constructor(state?: Partial<CameraState>) {
    this.x = state?.x ?? 0;
    this.y = state?.y ?? 0;
    this.zoom = this.clampZoom(state?.zoom ?? 1.0);
  }

  /**
   * Set dynamic zoom limits (recalculated on resize / page size change).
   */
  setZoomLimits(min: number, max: number): void {
    this.minZoom = min;
    this.maxZoom = max;
    this.zoom = this.clampZoom(this.zoom);
  }

  /**
   * Store the document bounding box for pan clamping.
   */
  setDocumentBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void {
    this.docBounds = bounds;
  }

  /**
   * Clamp camera position so at least PAN_MARGIN world units of document bounds
   * remain visible on screen.
   */
  clampPan(screenWidth: number, screenHeight: number): void {
    if (!this.docBounds) return;

    const viewWidth = screenWidth / this.zoom;
    const viewHeight = screenHeight / this.zoom;

    // Camera x,y is the top-left corner in world space
    // Visible world rect: [x, y, x + viewWidth, y + viewHeight]
    //
    // Constraint: document right edge must be at least PAN_MARGIN past screen left edge
    //   docBounds.maxX >= x + PAN_MARGIN  →  x <= docBounds.maxX - PAN_MARGIN
    // Constraint: document left edge must be at least PAN_MARGIN before screen right edge
    //   docBounds.minX <= x + viewWidth - PAN_MARGIN  →  x >= docBounds.minX - viewWidth + PAN_MARGIN

    const minX = this.docBounds.minX - viewWidth + PAN_MARGIN;
    const maxX = this.docBounds.maxX - PAN_MARGIN;
    const minY = this.docBounds.minY - viewHeight + PAN_MARGIN;
    const maxY = this.docBounds.maxY - PAN_MARGIN;

    if (minX <= maxX) {
      this.x = Math.min(maxX, Math.max(minX, this.x));
    }
    if (minY <= maxY) {
      this.y = Math.min(maxY, Math.max(minY, this.y));
    }
  }

  /**
   * Convert screen coordinates to world coordinates.
   */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: sx / this.zoom + this.x,
      y: sy / this.zoom + this.y,
    };
  }

  /**
   * Convert world coordinates to screen coordinates.
   */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom,
      y: (wy - this.y) * this.zoom,
    };
  }

  /**
   * Pan the camera by a screen-space delta.
   */
  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  /**
   * Zoom the camera centered on a screen-space point.
   * This keeps the world point under the cursor/finger stationary.
   */
  zoomAt(screenX: number, screenY: number, newZoom: number): void {
    newZoom = this.clampZoom(newZoom);

    // World point under the screen position before zoom
    const worldBefore = this.screenToWorld(screenX, screenY);

    this.zoom = newZoom;

    // World point under the same screen position after zoom
    const worldAfter = this.screenToWorld(screenX, screenY);

    // Adjust camera so the world point stays at the same screen position
    this.x += worldBefore.x - worldAfter.x;
    this.y += worldBefore.y - worldAfter.y;
  }

  /**
   * Apply camera transform to a canvas 2D context.
   * Uses save() + transform() to compose with existing transforms (e.g., DPR scaling)
   * rather than replacing them. Call resetContext() when done.
   */
  applyToContext(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.transform(this.zoom, 0, 0, this.zoom, -this.x * this.zoom, -this.y * this.zoom);
  }

  /**
   * Restore the canvas context to the state before applyToContext().
   */
  resetContext(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  /**
   * Get the visible world-space rectangle for a given screen size.
   * Returns [minX, minY, maxX, maxY].
   */
  getVisibleRect(
    screenWidth: number,
    screenHeight: number
  ): [number, number, number, number] {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(screenWidth, screenHeight);
    return [topLeft.x, topLeft.y, bottomRight.x, bottomRight.y];
  }

  /**
   * Get the visible world-space rectangle for an overscan canvas.
   * The overscan canvas covers screen-space from (offsetX, offsetY)
   * to (offsetX + overscanWidth, offsetY + overscanHeight),
   * where offsetX/offsetY are negative.
   */
  getOverscanVisibleRect(
    overscanCssWidth: number,
    overscanCssHeight: number,
    overscanOffsetX: number,
    overscanOffsetY: number,
  ): [number, number, number, number] {
    const topLeft = this.screenToWorld(overscanOffsetX, overscanOffsetY);
    const bottomRight = this.screenToWorld(
      overscanOffsetX + overscanCssWidth,
      overscanOffsetY + overscanCssHeight,
    );
    return [topLeft.x, topLeft.y, bottomRight.x, bottomRight.y];
  }

  /**
   * Check if a bounding box overlaps the current viewport.
   */
  isVisible(
    bbox: [number, number, number, number],
    screenWidth: number,
    screenHeight: number
  ): boolean {
    const [vMinX, vMinY, vMaxX, vMaxY] = this.getVisibleRect(
      screenWidth,
      screenHeight
    );
    const [bMinX, bMinY, bMaxX, bMaxY] = bbox;

    return bMaxX >= vMinX && bMinX <= vMaxX && bMaxY >= vMinY && bMinY <= vMaxY;
  }

  getState(): CameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  setState(state: CameraState): void {
    this.x = state.x;
    this.y = state.y;
    this.zoom = this.clampZoom(state.zoom);
  }

  getMinZoom(): number {
    return this.minZoom;
  }

  getMaxZoom(): number {
    return this.maxZoom;
  }

  clampZoom(zoom: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  static clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }
}
