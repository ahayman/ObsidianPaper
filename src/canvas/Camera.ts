import type { CameraState } from "../types";
import type { RenderEngine } from "./engine/RenderEngine";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10.0;

const PAN_MARGIN = 20; // world units that must remain visible

/** Snap tolerance for rotation in radians (~5°). */
const ROTATION_SNAP_TOLERANCE = 5 * Math.PI / 180;

/** Angles to snap to during rotation (radians). */
const SNAP_ANGLES = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

export class Camera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;

  /** Viewport size in CSS pixels, used for rotation center. */
  private vpWidth = 0;
  private vpHeight = 0;

  private minZoom = MIN_ZOOM;
  private maxZoom = MAX_ZOOM;
  private docBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  constructor(state?: Partial<CameraState>) {
    this.x = state?.x ?? 0;
    this.y = state?.y ?? 0;
    this.zoom = this.clampZoom(state?.zoom ?? 1.0);
    this.rotation = state?.rotation ?? 0;
  }

  /**
   * Set the viewport size (CSS pixels). Required for rotation transforms.
   */
  setViewportSize(width: number, height: number): void {
    this.vpWidth = width;
    this.vpHeight = height;
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

    // When rotated, the visible world rect is an AABB of the rotated viewport,
    // which is larger than the unrotated viewport. Use the expanded rect for clamping.
    const [vMinX, vMinY, vMaxX, vMaxY] = this.getVisibleRect(screenWidth, screenHeight);
    const viewWidth = vMaxX - vMinX;
    const viewHeight = vMaxY - vMinY;

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
   * When rotation is non-zero, inverse-rotates the screen point around the
   * viewport center before applying zoom + pan.
   */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    let rx = sx, ry = sy;
    if (this.rotation !== 0 && this.vpWidth > 0) {
      const cx = this.vpWidth / 2;
      const cy = this.vpHeight / 2;
      const cos = Math.cos(-this.rotation);
      const sin = Math.sin(-this.rotation);
      rx = cos * (sx - cx) - sin * (sy - cy) + cx;
      ry = sin * (sx - cx) + cos * (sy - cy) + cy;
    }
    return {
      x: rx / this.zoom + this.x,
      y: ry / this.zoom + this.y,
    };
  }

  /**
   * Convert world coordinates to screen coordinates.
   * When rotation is non-zero, rotates the result around the viewport center.
   */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const sx = (wx - this.x) * this.zoom;
    const sy = (wy - this.y) * this.zoom;
    if (this.rotation !== 0 && this.vpWidth > 0) {
      const cx = this.vpWidth / 2;
      const cy = this.vpHeight / 2;
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      return {
        x: cos * (sx - cx) - sin * (sy - cy) + cx,
        y: sin * (sx - cx) + cos * (sy - cy) + cy,
      };
    }
    return { x: sx, y: sy };
  }

  /**
   * Pan the camera by a screen-space delta.
   * When rotated, the pan direction is inverse-rotated to match world space.
   */
  pan(dxScreen: number, dyScreen: number): void {
    if (this.rotation !== 0) {
      const cos = Math.cos(-this.rotation);
      const sin = Math.sin(-this.rotation);
      const rdx = cos * dxScreen - sin * dyScreen;
      const rdy = sin * dxScreen + cos * dyScreen;
      this.x -= rdx / this.zoom;
      this.y -= rdy / this.zoom;
    } else {
      this.x -= dxScreen / this.zoom;
      this.y -= dyScreen / this.zoom;
    }
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
   * Rotate the camera centered on a screen-space point.
   * Keeps the world point under the screen position stationary.
   */
  rotateAt(screenX: number, screenY: number, newRotation: number): void {
    // Normalize to [0, 2π)
    newRotation = ((newRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    const worldBefore = this.screenToWorld(screenX, screenY);

    this.rotation = newRotation;

    const worldAfter = this.screenToWorld(screenX, screenY);

    this.x += worldBefore.x - worldAfter.x;
    this.y += worldBefore.y - worldAfter.y;
  }

  /**
   * Snap rotation to nearest cardinal angle if within tolerance.
   * Returns the snapped rotation value.
   */
  static snapRotation(angle: number): number {
    const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    for (const snap of SNAP_ANGLES) {
      let diff = Math.abs(normalized - snap);
      // Handle wrap-around (e.g., 359° vs 0°)
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < ROTATION_SNAP_TOLERANCE) return snap;
    }
    return normalized;
  }

  /**
   * Apply camera transform to a canvas 2D context.
   * Uses save() + transform() to compose with existing transforms (e.g., DPR scaling)
   * rather than replacing them. Call resetContext() when done.
   */
  applyToContext(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    if (this.rotation !== 0 && this.vpWidth > 0) {
      // Pre-multiply rotation around viewport center with zoom+pan.
      // Transform: T(cx,cy) * R(r) * T(-cx,-cy) * Scale(z) * T(-cam.x, -cam.y)
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      const z = this.zoom;
      const cx = this.vpWidth / 2;
      const cy = this.vpHeight / 2;
      // Zoom+pan translation
      const tx = -this.x * z;
      const ty = -this.y * z;
      // Rotate the zoom+pan result around (cx, cy):
      // x' = cos*(z*wx + tx - cx) - sin*(z*wy + ty - cy) + cx
      // y' = sin*(z*wx + tx - cx) + cos*(z*wy + ty - cy) + cy
      // As a 2D affine: [a, b, c, d, e, f]
      ctx.transform(
        cos * z,
        sin * z,
        -sin * z,
        cos * z,
        cos * (tx - cx) - sin * (ty - cy) + cx,
        sin * (tx - cx) + cos * (ty - cy) + cy,
      );
    } else {
      ctx.transform(this.zoom, 0, 0, this.zoom, -this.x * this.zoom, -this.y * this.zoom);
    }
  }

  /**
   * Restore the canvas context to the state before applyToContext().
   */
  resetContext(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  /**
   * Apply camera transform to a RenderEngine.
   * Uses save() + transform() to compose with existing transforms.
   * Call engine.restore() when done.
   */
  applyToEngine(engine: RenderEngine): void {
    engine.save();
    if (this.rotation !== 0 && this.vpWidth > 0) {
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      const z = this.zoom;
      const cx = this.vpWidth / 2;
      const cy = this.vpHeight / 2;
      const tx = -this.x * z;
      const ty = -this.y * z;
      engine.transform(
        cos * z,
        sin * z,
        -sin * z,
        cos * z,
        cos * (tx - cx) - sin * (ty - cy) + cx,
        sin * (tx - cx) + cos * (ty - cy) + cy,
      );
    } else {
      engine.transform(this.zoom, 0, 0, this.zoom, -this.x * this.zoom, -this.y * this.zoom);
    }
  }

  /**
   * Get the visible world-space rectangle for a given screen size.
   * Returns [minX, minY, maxX, maxY].
   * When rotated, returns the AABB of all four rotated screen corners.
   */
  getVisibleRect(
    screenWidth: number,
    screenHeight: number
  ): [number, number, number, number] {
    if (this.rotation !== 0 && this.vpWidth > 0) {
      const c0 = this.screenToWorld(0, 0);
      const c1 = this.screenToWorld(screenWidth, 0);
      const c2 = this.screenToWorld(screenWidth, screenHeight);
      const c3 = this.screenToWorld(0, screenHeight);
      return [
        Math.min(c0.x, c1.x, c2.x, c3.x),
        Math.min(c0.y, c1.y, c2.y, c3.y),
        Math.max(c0.x, c1.x, c2.x, c3.x),
        Math.max(c0.y, c1.y, c2.y, c3.y),
      ];
    }
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
    if (this.rotation !== 0 && this.vpWidth > 0) {
      const c0 = this.screenToWorld(overscanOffsetX, overscanOffsetY);
      const c1 = this.screenToWorld(overscanOffsetX + overscanCssWidth, overscanOffsetY);
      const c2 = this.screenToWorld(overscanOffsetX + overscanCssWidth, overscanOffsetY + overscanCssHeight);
      const c3 = this.screenToWorld(overscanOffsetX, overscanOffsetY + overscanCssHeight);
      return [
        Math.min(c0.x, c1.x, c2.x, c3.x),
        Math.min(c0.y, c1.y, c2.y, c3.y),
        Math.max(c0.x, c1.x, c2.x, c3.x),
        Math.max(c0.y, c1.y, c2.y, c3.y),
      ];
    }
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
    return { x: this.x, y: this.y, zoom: this.zoom, rotation: this.rotation };
  }

  setState(state: CameraState): void {
    this.x = state.x;
    this.y = state.y;
    this.zoom = this.clampZoom(state.zoom);
    this.rotation = state.rotation ?? 0;
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
