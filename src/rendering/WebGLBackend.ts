/**
 * WebGL implementation of DrawingBackend.
 *
 * Thin delegation layer over the existing RenderEngine interface.
 * Each DrawingBackend method maps 1:1 to a RenderEngine method,
 * with TextureRef = TextureHandle and OffscreenRef = OffscreenTarget.
 */

import type {
  DrawingBackend,
  TextureRef,
  OffscreenRef,
  BackendBlendMode,
} from "./DrawingBackend";
import type {
  RenderEngine,
  TextureHandle,
  OffscreenTarget,
  BlendMode,
} from "../canvas/engine/RenderEngine";

export class WebGLBackend implements DrawingBackend {
  private engine: RenderEngine;

  constructor(engine: RenderEngine) {
    this.engine = engine;
  }

  get width(): number {
    return this.engine.width;
  }

  get height(): number {
    return this.engine.height;
  }

  // ── State stack ──────────────────────────────────────────

  save(): void {
    this.engine.save();
  }

  restore(): void {
    this.engine.restore();
  }

  // ── Transform ────────────────────────────────────────────

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.engine.setTransform(a, b, c, d, e, f);
  }

  getTransform(): DOMMatrix {
    return this.engine.getTransform();
  }

  // ── Style ────────────────────────────────────────────────

  setFillColor(color: string): void {
    this.engine.setFillColor(color);
  }

  setAlpha(alpha: number): void {
    this.engine.setAlpha(alpha);
  }

  setBlendMode(mode: BackendBlendMode): void {
    this.engine.setBlendMode(mode as BlendMode);
  }

  // ── Geometry fill ────────────────────────────────────────

  fillPath(vertices: Float32Array): void {
    this.engine.fillPath(vertices);
  }

  fillTriangles(vertices: Float32Array): void {
    this.engine.fillTriangles(vertices);
  }

  // ── Stamps ───────────────────────────────────────────────

  drawStampDiscs(color: string, data: Float32Array): void {
    this.engine.drawStampDiscs(color, data);
  }

  drawStamps(texture: TextureRef, data: Float32Array): void {
    this.engine.drawStamps(texture as TextureHandle, data);
  }

  // ── Grain texture ────────────────────────────────────────

  applyGrain(
    texture: TextureRef,
    offsetX: number,
    offsetY: number,
    strength: number,
  ): void {
    this.engine.applyGrain(texture as TextureHandle, offsetX, offsetY, strength);
  }

  // ── Masking ──────────────────────────────────────────────

  maskToPath(vertices: Float32Array): void {
    this.engine.maskToPath(vertices);
  }

  maskToTriangles(vertices: Float32Array): void {
    this.engine.maskToTriangles(vertices);
  }

  // ── Clipping ─────────────────────────────────────────────

  clipPath(vertices: Float32Array): void {
    this.engine.clipPath(vertices);
  }

  clipRect(x: number, y: number, w: number, h: number): void {
    this.engine.clipRect(x, y, w, h);
  }

  // ── Offscreen rendering ──────────────────────────────────

  getOffscreen(id: string, width: number, height: number): OffscreenRef {
    return this.engine.getOffscreen(id, width, height);
  }

  beginOffscreen(target: OffscreenRef): void {
    this.engine.beginOffscreen(target as OffscreenTarget);
  }

  endOffscreen(): void {
    this.engine.endOffscreen();
  }

  drawOffscreen(
    target: OffscreenRef,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.engine.drawOffscreen(target as OffscreenTarget, dx, dy, dw, dh);
  }

  clear(): void {
    this.engine.clear();
  }

  // ── Image drawing ────────────────────────────────────────

  fillRect(x: number, y: number, w: number, h: number): void {
    this.engine.fillRect(x, y, w, h);
  }
}
