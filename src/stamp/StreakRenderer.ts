/**
 * Streak particle type + Canvas2D rendering for the felt-tip pen.
 *
 * A streak is the felt pen's fibre: a CURVED CAPSULE — a thick circular arc
 * with round ends. `curvature` is signed (1/world-units); 0 makes it a straight
 * capsule. A curved fibre follows the stroke instead of chording it, so curved
 * strokes don't facet. See MarkerScatterRenderer for how fibres are scattered
 * and how curvature is derived from the path.
 *
 * `drawStreaks` renders the active (in-progress) stroke to a 2D context; baked
 * strokes go through the engine's `drawStampStreaks` (a thick-arc SDF on WebGL,
 * the same round-capped stroke on the Canvas2D engine).
 */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A single felt-tip fibre — a curved capsule (thick circular arc, round ends). */
export interface StreakParams {
  /** Capsule centre, world coords. */
  x: number;
  y: number;
  /** Half arc-length of the fibre, world units. */
  halfLength: number;
  /** Capsule cross-radius (half the fibre thickness), world units. */
  radius: number;
  /** Orientation of the fibre tangent at its centre, radians. */
  rotation: number;
  /** Signed curvature (1/world-units); 0 = straight. */
  curvature: number;
  /** Per-fibre alpha, 0-1. */
  opacity: number;
}

/** Fibres below this alpha are skipped (matches packStreaksToFloat32's cull). */
const MIN_ALPHA = 0.012;

/** Curvature magnitudes below this render as a straight capsule. */
const CURV_EPS = 1e-4;

/**
 * Stroke one fibre onto a 2D context whose transform is world→screen: a
 * round-capped line (straight) or circular arc (curved). A round-capped stroke
 * of the centreline IS the capsule. The caller sets strokeStyle + globalAlpha.
 *
 * The arc circle centre sits along the fibre's left-normal at the signed
 * radius `1/curvature` — the same convention the WebGL arc SDF uses, so the
 * active and baked paths describe one shape.
 */
export function strokeFibre(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  cos: number,
  sin: number,
  halfLength: number,
  radius: number,
  curvature: number,
): void {
  ctx.lineWidth = 2 * radius;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (Math.abs(curvature) < CURV_EPS) {
    ctx.moveTo(cx - cos * halfLength, cy - sin * halfLength);
    ctx.lineTo(cx + cos * halfLength, cy + sin * halfLength);
  } else {
    const rSigned = 1 / curvature;
    const arcCx = cx - rSigned * sin;
    const arcCy = cy + rSigned * cos;
    const arcR = Math.abs(rSigned);
    const phi0 = Math.atan2(cy - arcCy, cx - arcCx);
    const halfAperture = halfLength * Math.abs(curvature);
    ctx.arc(arcCx, arcCy, arcR, phi0 - halfAperture, phi0 + halfAperture);
  }
  ctx.stroke();
}

/**
 * Draw streak particles onto a 2D context (active-stroke rendering).
 * Each fibre is stroked in world units under `baseTransform`. `strokeOpacity`
 * is normally 1 — MarkerScatterRenderer folds stroke opacity into per-fibre
 * alpha so the active and baked paths agree.
 */
export function drawStreaks(
  ctx: Ctx2D,
  streaks: readonly StreakParams[],
  color: string,
  baseTransform: DOMMatrix,
  strokeOpacity: number = 1,
): void {
  if (streaks.length === 0) return;

  ctx.setTransform(baseTransform);
  ctx.strokeStyle = color;

  for (const s of streaks) {
    if (s.opacity < MIN_ALPHA) continue;
    const alpha = s.opacity * strokeOpacity;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    strokeFibre(
      ctx, s.x, s.y, Math.cos(s.rotation), Math.sin(s.rotation),
      s.halfLength, s.radius, s.curvature,
    );
  }

  ctx.globalAlpha = 1;
}
