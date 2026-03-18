/**
 * Selection overlay: renders selected strokes + bounding box + corner handles
 * on a dedicated canvas layer above the drawing canvases.
 *
 * During move/resize, a CSS transform is applied to this canvas for
 * GPU-accelerated preview (strokes and handles move together).
 */

import type { Camera } from "../canvas/Camera";
import type { SelectionBBox, HandleCorner } from "./SelectionState";
import { getHandlePositions, ROTATION_HANDLE_OFFSET } from "./SelectionState";

/** Handle radius in screen pixels */
const HANDLE_RADIUS = 6;
/** Handle border width in screen pixels */
const HANDLE_BORDER = 1.5;

const BBOX_STROKE_COLOR = "rgba(66, 133, 244, 0.8)";
const BBOX_FILL_COLOR = "rgba(66, 133, 244, 0.04)";
const HANDLE_FILL_COLOR = "#ffffff";
const HANDLE_STROKE_COLOR = "rgba(66, 133, 244, 0.9)";

/**
 * Callback that renders selected strokes in world space to a given context.
 * The context already has the camera transform applied when this is called.
 */
export type StrokeRenderFn = (ctx: CanvasRenderingContext2D) => void;

export class SelectionOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(container: HTMLElement) {
    this.canvas = container.createEl("canvas", {
      cls: "paper-canvas paper-selection-canvas",
    });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context for selection overlay");
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /**
   * Render selected strokes + bounding box + corner handles.
   *
   * @param bbox - Selection bounding box in world space
   * @param camera - Camera for world→screen conversion
   * @param renderStrokes - Optional callback to render strokes in world space
   */
  render(bbox: SelectionBBox, camera: Camera, renderStrokes?: StrokeRenderFn): void {
    const ctx = this.ctx;
    const dpr = this.dpr;

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. Render strokes in world space (if provided)
    if (renderStrokes) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      camera.applyToContext(ctx);
      renderStrokes(ctx);
      camera.resetContext(ctx);
    }

    // 2. Render bounding box and handles in screen space
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Convert bbox corners to screen space
    const tl = camera.worldToScreen(bbox.x, bbox.y);
    const br = camera.worldToScreen(bbox.x + bbox.width, bbox.y + bbox.height);
    const screenW = br.x - tl.x;
    const screenH = br.y - tl.y;

    // Draw bounding box
    ctx.strokeStyle = BBOX_STROKE_COLOR;
    ctx.fillStyle = BBOX_FILL_COLOR;
    ctx.lineWidth = 1;

    const r = 2;
    this.roundRect(ctx, tl.x, tl.y, screenW, screenH, r);
    ctx.fill();
    ctx.stroke();

    // Draw corner handles
    const handles = getHandlePositions(bbox);
    const corners: HandleCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

    for (const corner of corners) {
      const pos = handles[corner];
      const screen = camera.worldToScreen(pos.x, pos.y);
      this.drawHandle(ctx, screen.x, screen.y);
    }

    // Draw rotation handle (above top-center, connected by a line)
    const topCenter = camera.worldToScreen(bbox.x + bbox.width / 2, bbox.y);
    const rotY = topCenter.y - ROTATION_HANDLE_OFFSET;

    ctx.beginPath();
    ctx.moveTo(topCenter.x, topCenter.y);
    ctx.lineTo(topCenter.x, rotY);
    ctx.strokeStyle = HANDLE_STROKE_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();
    this.drawHandle(ctx, topCenter.x, rotY);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Apply a CSS transform (for gesture preview during move/resize).
   */
  setTransform(tx: number, ty: number, scale: number): void {
    this.canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  /**
   * Apply a CSS rotation around a screen-space center point.
   */
  setRotateTransform(centerX: number, centerY: number, angle: number): void {
    const deg = angle * (180 / Math.PI);
    this.canvas.style.transformOrigin = `${centerX}px ${centerY}px`;
    this.canvas.style.transform = `rotate(${deg}deg)`;
  }

  clearTransform(): void {
    this.canvas.style.transform = "";
    this.canvas.style.transformOrigin = "0 0";
  }

  destroy(): void {
    this.canvas.remove();
  }

  private drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = HANDLE_FILL_COLOR;
    ctx.fill();
    ctx.strokeStyle = HANDLE_STROKE_COLOR;
    ctx.lineWidth = HANDLE_BORDER;
    ctx.stroke();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
