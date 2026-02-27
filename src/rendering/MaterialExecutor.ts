/**
 * Material Executor
 *
 * Interprets a StrokeMaterial + StrokeRenderData through a DrawingBackend,
 * producing the same method call sequences as StrokeRenderCore's
 * renderStrokeToEngine() and renderStrokeToContext().
 *
 * The execution flow:
 * 1. If isolation: compute screen bbox → get offscreen → begin → clear → set offset transform
 * 2. If multiply blend: save → setAlpha → setBlendMode
 * 3. Render body (fill / stampDiscs / inkShading)
 * 4. Apply effects in order (outlineMask, grain)
 * 5. Close blend (restore)
 * 6. If isolation: end offscreen → composite back → restore transform
 * 7. Post-composite effects (inkPooling — Canvas2D only, skipped for now)
 */

import type { DrawingBackend, TextureRef, OffscreenRef } from "./DrawingBackend";
import type { StrokeMaterial, MaterialEffect } from "./StrokeMaterial";
import { computeScreenBBox } from "../canvas/StrokeRenderCore";

// ─── Render Data ────────────────────────────────────────────

/** All pre-computed data needed to execute a material. */
export interface StrokeRenderData {
  /** Outline vertices for fill body and masking. Null when body is stampDiscs without mask. */
  vertices: Float32Array | null;
  /** Whether vertices represent italic triangles (fillTriangles) vs standard path (fillPath). */
  italic: boolean;
  /** Resolved hex color. */
  color: string;
  /** World-space bounding box [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];

  // ── Stamp data (populated when body is stampDiscs or inkShading) ──
  /** Packed stamp data: Float32Array of [x, y, size, opacity] tuples. */
  stampData?: Float32Array;

  // ── Grain data (populated when effects include grain) ──
  /** Grain texture anchor point [x, y] in world space. */
  grainAnchor?: [number, number];
  /** Computed grain texture strength. */
  grainStrength?: number;

  // ── Stroke dimensions (for offscreen bbox expansion) ──
  /** Stroke width for bbox expansion in ink shading. */
  strokeWidth?: number;
}

/** Resources the executor needs from the host. */
export interface ExecutorResources {
  /** Grain texture for applyGrain(). Null if grain not available. */
  grainTexture: TextureRef | null;
  /** Ink stamp texture for drawStamps() in ink shading body. Null if not available. */
  inkStampTexture: TextureRef | null;
  /** Canvas width in physical pixels (for screen bbox computation). */
  canvasWidth: number;
  /** Canvas height in physical pixels (for screen bbox computation). */
  canvasHeight: number;
}

// ─── Executor ───────────────────────────────────────────────

/**
 * Execute a stroke material through a drawing backend.
 *
 * Produces the same method call sequence as the corresponding
 * renderStrokeToEngine() / renderStrokeToContext() code path.
 */
export function executeMaterial(
  backend: DrawingBackend,
  material: StrokeMaterial,
  data: StrokeRenderData,
  resources: ExecutorResources,
): void {
  const { body, blending, bodyOpacity, isolation, effects } = material;

  // ── Offscreen isolation setup ──────────────────────────
  let offscreen: OffscreenRef | null = null;
  let savedTransform: DOMMatrix | null = null;
  let screenBBox: { sx: number; sy: number; sw: number; sh: number } | null = null;

  if (isolation) {
    savedTransform = backend.getTransform();
    const expandedBbox = expandBBox(data.bbox, data.strokeWidth);
    screenBBox = computeScreenBBox(
      expandedBbox, savedTransform, resources.canvasWidth, resources.canvasHeight,
    );
    if (!screenBBox) return; // Fully off-screen

    const offscreenId = body.type === "inkShading" ? "inkShading" : "grainIsolation";
    offscreen = backend.getOffscreen(offscreenId, screenBBox.sw, screenBBox.sh);
    backend.beginOffscreen(offscreen);
    backend.clear();
    backend.setTransform(
      savedTransform.a, savedTransform.b,
      savedTransform.c, savedTransform.d,
      savedTransform.e - screenBBox.sx,
      savedTransform.f - screenBBox.sy,
    );
  }

  // ── Render body ────────────────────────────────────────
  switch (body.type) {
    case "fill":
      renderFillBody(backend, data, bodyOpacity, blending);
      break;
    case "stampDiscs":
      renderStampDiscsBody(backend, data, bodyOpacity);
      break;
    case "inkShading":
      renderInkShadingBody(backend, data, bodyOpacity, resources);
      break;
    default:
      assertNever(body);
  }

  // ── Apply effects ──────────────────────────────────────
  for (const effect of effects) {
    applyEffect(backend, effect, data, resources);
  }

  // ── Close isolation ────────────────────────────────────
  if (isolation && offscreen && screenBBox && savedTransform) {
    backend.endOffscreen();

    backend.save();
    backend.setTransform(1, 0, 0, 1, 0, 0);
    backend.drawOffscreen(offscreen, screenBBox.sx, screenBBox.sy, screenBBox.sw, screenBBox.sh);
    backend.restore();

    // Restore original transform (endOffscreen doesn't restore transforms)
    backend.setTransform(
      savedTransform.a, savedTransform.b,
      savedTransform.c, savedTransform.d,
      savedTransform.e, savedTransform.f,
    );
  }
}

// ─── Body Renderers ─────────────────────────────────────────

function renderFillBody(
  backend: DrawingBackend,
  data: StrokeRenderData,
  opacity: number,
  blending: "source-over" | "multiply",
): void {
  if (!data.vertices) return;

  if (blending === "multiply") {
    // Highlighter path: save → alpha → blend → fill → restore
    backend.save();
    backend.setAlpha(opacity);
    backend.setBlendMode("multiply");
    backend.setFillColor(data.color);
    fillVertices(backend, data.vertices, data.italic);
    backend.restore();
  } else {
    // Standard path: color → alpha → fill → reset alpha
    backend.setFillColor(data.color);
    backend.setAlpha(opacity);
    fillVertices(backend, data.vertices, data.italic);
    backend.setAlpha(1);
  }
}

function renderStampDiscsBody(
  backend: DrawingBackend,
  data: StrokeRenderData,
  opacity: number,
): void {
  if (!data.stampData) return;
  backend.setAlpha(opacity);
  backend.drawStampDiscs(data.color, data.stampData);
  backend.setAlpha(1);
}

function renderInkShadingBody(
  backend: DrawingBackend,
  data: StrokeRenderData,
  opacity: number,
  resources: ExecutorResources,
): void {
  if (!data.stampData || !resources.inkStampTexture) return;
  backend.setAlpha(opacity);
  backend.drawStamps(resources.inkStampTexture, data.stampData);
}

// ─── Effect Applicators ─────────────────────────────────────

function applyEffect(
  backend: DrawingBackend,
  effect: MaterialEffect,
  data: StrokeRenderData,
  resources: ExecutorResources,
): void {
  switch (effect.type) {
    case "outlineMask":
      applyOutlineMask(backend, data);
      break;
    case "grain":
      applyGrain(backend, data, resources);
      break;
    case "inkPooling":
      // Ink pooling uses raw Canvas2D radial gradients.
      // Skipped in the engine path (same as current StrokeRenderCore).
      // Will be handled via direct ctx access in Phase 6 integration.
      break;
    default:
      assertNever(effect);
  }
}

function applyOutlineMask(backend: DrawingBackend, data: StrokeRenderData): void {
  if (!data.vertices) return;
  if (data.italic) {
    backend.maskToTriangles(data.vertices);
  } else {
    backend.maskToPath(data.vertices);
  }
}

function applyGrain(
  backend: DrawingBackend,
  data: StrokeRenderData,
  resources: ExecutorResources,
): void {
  if (!data.vertices || !resources.grainTexture || !data.grainAnchor || !data.grainStrength) return;

  backend.save();
  backend.clipPath(data.vertices);
  backend.applyGrain(
    resources.grainTexture,
    data.grainAnchor[0],
    data.grainAnchor[1],
    data.grainStrength,
  );
  backend.restore();
}

// ─── Helpers ────────────────────────────────────────────────

function fillVertices(backend: DrawingBackend, vertices: Float32Array, italic: boolean): void {
  if (italic) {
    backend.fillTriangles(vertices);
  } else {
    backend.fillPath(vertices);
  }
}

function expandBBox(
  bbox: [number, number, number, number],
  strokeWidth?: number,
): [number, number, number, number] {
  const wm = (strokeWidth ?? 0) * 1.5;
  if (wm <= 0) return bbox;
  return [bbox[0] - wm, bbox[1] - wm, bbox[2] + wm, bbox[3] + wm];
}

function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
