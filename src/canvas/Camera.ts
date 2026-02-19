import type { CameraState } from "../types";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5.0;

export class Camera {
  x: number;
  y: number;
  zoom: number;

  constructor(state?: Partial<CameraState>) {
    this.x = state?.x ?? 0;
    this.y = state?.y ?? 0;
    this.zoom = Camera.clampZoom(state?.zoom ?? 1.0);
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
    newZoom = Camera.clampZoom(newZoom);

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
    this.zoom = Camera.clampZoom(state.zoom);
  }

  static clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }
}
