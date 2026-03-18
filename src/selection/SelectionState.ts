/**
 * Selection state for lasso-selected strokes.
 */

import type { Stroke } from "../types";

export interface SelectionBBox {
  x: number;      // World-space left edge
  y: number;      // World-space top edge
  width: number;  // World-space width
  height: number; // World-space height
}

export interface SelectionState {
  strokeIds: Set<string>;
  boundingBox: SelectionBBox;
  pageIndex: number;
}

/** Padding in world units around the stroke bounding boxes */
const BBOX_PADDING = 4;

/**
 * Compute the union bounding box of the given strokes, with padding.
 */
export function computeSelectionBBox(
  strokeIds: Set<string>,
  strokes: readonly Stroke[]
): SelectionBBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    if (!strokeIds.has(stroke.id)) continue;
    const [sMinX, sMinY, sMaxX, sMaxY] = stroke.bbox;
    if (sMinX < minX) minX = sMinX;
    if (sMinY < minY) minY = sMinY;
    if (sMaxX > maxX) maxX = sMaxX;
    if (sMaxY > maxY) maxY = sMaxY;
  }

  if (minX === Infinity) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: minX - BBOX_PADDING,
    y: minY - BBOX_PADDING,
    width: maxX - minX + BBOX_PADDING * 2,
    height: maxY - minY + BBOX_PADDING * 2,
  };
}

/** Corner handle identifiers */
export type HandleCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Midpoint handle identifiers */
export type HandleMidpoint = "top" | "bottom" | "left" | "right";

/** Result of hit-testing the selection UI */
export type SelectionHitResult =
  | { type: "handle"; corner: HandleCorner }
  | { type: "midpoint"; edge: HandleMidpoint }
  | { type: "rotation" }  // Rotation handle above top-center
  | { type: "inside" }    // Inside bbox but not on handle → move
  | { type: "outside" };  // Outside bbox → deselect

/** Screen-space offset of the rotation handle above the bbox top edge */
export const ROTATION_HANDLE_OFFSET = 30;

/**
 * Get the world-space positions of the 4 corner handles.
 */
export function getHandlePositions(bbox: SelectionBBox): Record<HandleCorner, { x: number; y: number }> {
  return {
    "top-left": { x: bbox.x, y: bbox.y },
    "top-right": { x: bbox.x + bbox.width, y: bbox.y },
    "bottom-left": { x: bbox.x, y: bbox.y + bbox.height },
    "bottom-right": { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
  };
}

/**
 * Get the world-space positions of the 4 midpoint handles.
 */
export function getMidpointPositions(bbox: SelectionBBox): Record<HandleMidpoint, { x: number; y: number }> {
  return {
    "top": { x: bbox.x + bbox.width / 2, y: bbox.y },
    "bottom": { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height },
    "left": { x: bbox.x, y: bbox.y + bbox.height / 2 },
    "right": { x: bbox.x + bbox.width, y: bbox.y + bbox.height / 2 },
  };
}

/**
 * Hit-test a screen-space point against the selection UI.
 *
 * @param screenX - Screen-space X
 * @param screenY - Screen-space Y
 * @param bbox - Selection bounding box in world space
 * @param camera - Object with worldToScreen and zoom
 * @param handleRadiusScreen - Hit radius for handles in screen pixels
 */
export function hitTestSelection(
  screenX: number,
  screenY: number,
  bbox: SelectionBBox,
  camera: { worldToScreen: (wx: number, wy: number) => { x: number; y: number }; zoom: number },
  handleRadiusScreen = 22
): SelectionHitResult {
  // Test rotation handle first (above top-center)
  const topCenterWorld = { x: bbox.x + bbox.width / 2, y: bbox.y };
  const topCenterScreen = camera.worldToScreen(topCenterWorld.x, topCenterWorld.y);
  const rotHandleX = topCenterScreen.x;
  const rotHandleY = topCenterScreen.y - ROTATION_HANDLE_OFFSET;
  const rdx = screenX - rotHandleX;
  const rdy = screenY - rotHandleY;
  if (rdx * rdx + rdy * rdy <= handleRadiusScreen * handleRadiusScreen) {
    return { type: "rotation" };
  }

  // Test corner handles (they extend beyond the bbox)
  const handles = getHandlePositions(bbox);
  const corners: HandleCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

  for (const corner of corners) {
    const pos = handles[corner];
    const screen = camera.worldToScreen(pos.x, pos.y);
    const dx = screenX - screen.x;
    const dy = screenY - screen.y;
    if (dx * dx + dy * dy <= handleRadiusScreen * handleRadiusScreen) {
      return { type: "handle", corner };
    }
  }

  // Test midpoint handles
  const midpoints = getMidpointPositions(bbox);
  const edges: HandleMidpoint[] = ["top", "bottom", "left", "right"];

  for (const edge of edges) {
    const pos = midpoints[edge];
    const screen = camera.worldToScreen(pos.x, pos.y);
    const dx = screenX - screen.x;
    const dy = screenY - screen.y;
    if (dx * dx + dy * dy <= handleRadiusScreen * handleRadiusScreen) {
      return { type: "midpoint", edge };
    }
  }

  // Test inside bounding box
  const topLeft = camera.worldToScreen(bbox.x, bbox.y);
  const bottomRight = camera.worldToScreen(bbox.x + bbox.width, bbox.y + bbox.height);

  if (
    screenX >= topLeft.x &&
    screenX <= bottomRight.x &&
    screenY >= topLeft.y &&
    screenY <= bottomRight.y
  ) {
    return { type: "inside" };
  }

  return { type: "outside" };
}
