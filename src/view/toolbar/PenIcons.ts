import type { PenType } from "../../types";
import type { PenPreset } from "./ToolbarTypes";

const SVG_NS = "http://www.w3.org/2000/svg";

interface IconShape {
  type: "path" | "line" | "circle" | "rect";
  d?: string;
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number;
  x?: number; y?: number; width?: number; height?: number; rx?: number;
  fill?: string;
  fillOpacity?: string;
  stroke?: string;
  strokeWidth?: string;
}

/**
 * Shape definitions for each pen type icon.
 * Fills the full 24x24 viewBox. White silhouettes over color background.
 */
const PEN_ICON_SHAPES: Record<PenType, IconShape[]> = {
  // Ballpoint: tapered body, round ball tip
  ballpoint: [
    { type: "path", d: "M5 1 L19 1 L17 18 L14 22 L10 22 L7 18 Z", fill: "white", fillOpacity: "0.85" },
    { type: "circle", cx: 12, cy: 22.5, r: 2, fill: "white", fillOpacity: "0.85" },
  ],

  // Felt tip: rectangular marker body, flat chisel end
  "felt-tip": [
    { type: "path", d: "M5 1 L19 1 L20 14 L4 14 Z", fill: "white", fillOpacity: "0.85" },
    { type: "rect", x: 3, y: 14, width: 18, height: 5, rx: 1, fill: "white", fillOpacity: "0.85" },
    { type: "path", d: "M4 19 L20 19 L17 24 L7 24 Z", fill: "white", fillOpacity: "0.85" },
  ],

  // Pencil: eraser band, hex body, sharpened tip
  pencil: [
    { type: "rect", x: 5, y: 0, width: 14, height: 4, rx: 1.5, fill: "white", fillOpacity: "0.6" },
    { type: "path", d: "M5 4 L19 4 L18 17 L6 17 Z", fill: "white", fillOpacity: "0.85" },
    { type: "path", d: "M6 17 L18 17 L12 24 Z", fill: "white", fillOpacity: "0.85" },
  ],

  // Fountain: elegant body narrowing to split nib
  fountain: [
    { type: "path", d: "M6 1 L18 1 L19 10 L20 15 L12 12 L4 15 L5 10 Z", fill: "white", fillOpacity: "0.85" },
    { type: "path", d: "M4 15 L20 15 L12 24 Z", fill: "white", fillOpacity: "0.85" },
    { type: "line", x1: 12, y1: 16, x2: 12, y2: 22, stroke: "rgba(0,0,0,0.35)", strokeWidth: "1" },
  ],

  // Highlighter: wide chunky body, broad flat tip
  highlighter: [
    { type: "rect", x: 3, y: 0, width: 18, height: 5, rx: 2, fill: "white", fillOpacity: "0.6" },
    { type: "rect", x: 2, y: 5, width: 20, height: 13, rx: 1, fill: "white", fillOpacity: "0.85" },
    { type: "path", d: "M3 18 L21 18 L18 24 L6 24 Z", fill: "white", fillOpacity: "0.85" },
  ],
};

/**
 * Create an SVG DOM element for a pen type icon.
 * Returns a white silhouette suitable for overlaying on a colored background.
 */
export function createPenIconElement(penType: PenType): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  // Pad the viewBox so shapes (drawn in 0-24 space) render at ~21/24 scale
  svg.setAttribute("viewBox", "-2 -2 28 28");

  const shapes = PEN_ICON_SHAPES[penType];
  for (const shape of shapes) {
    let el: SVGElement;
    switch (shape.type) {
      case "path":
        el = document.createElementNS(SVG_NS, "path");
        el.setAttribute("d", shape.d!);
        break;
      case "circle":
        el = document.createElementNS(SVG_NS, "circle");
        el.setAttribute("cx", String(shape.cx));
        el.setAttribute("cy", String(shape.cy));
        el.setAttribute("r", String(shape.r));
        break;
      case "rect":
        el = document.createElementNS(SVG_NS, "rect");
        el.setAttribute("x", String(shape.x));
        el.setAttribute("y", String(shape.y));
        el.setAttribute("width", String(shape.width));
        el.setAttribute("height", String(shape.height));
        if (shape.rx) el.setAttribute("rx", String(shape.rx));
        break;
      case "line":
        el = document.createElementNS(SVG_NS, "line");
        el.setAttribute("x1", String(shape.x1));
        el.setAttribute("y1", String(shape.y1));
        el.setAttribute("x2", String(shape.x2));
        el.setAttribute("y2", String(shape.y2));
        break;
      default:
        continue;
    }
    if (shape.fill) el.setAttribute("fill", shape.fill);
    if (shape.fillOpacity) el.setAttribute("fill-opacity", shape.fillOpacity);
    if (shape.stroke) el.setAttribute("stroke", shape.stroke);
    if (shape.strokeWidth) el.setAttribute("stroke-width", shape.strokeWidth);
    svg.appendChild(el);
  }

  return svg;
}

// ─── Nib Shape Icon (for preset buttons) ────────────────────

/** Minimum minor axis for ellipses to remain visible. */
const MIN_MINOR_AXIS = 0.5;

/**
 * Map pen width (0.5–30) to icon units using split logic:
 *  - width ≤ 12 → 1:1 mapping (0.5–12 icon units)
 *  - width > 12 → compressed linear (12–19.2 icon units)
 */
export function computeNibSize(width: number): number {
  if (width <= 12) return width;
  return 12 + ((width - 12) / 18) * 7.2;
}

/**
 * Append the pen-type silhouette shapes into a <g> group, using a given CSS class
 * for fill instead of the original white/opacity values.
 */
function appendPenShapes(parent: SVGElement, penType: PenType, cls: string): void {
  const shapes = PEN_ICON_SHAPES[penType];
  for (const shape of shapes) {
    let el: SVGElement;
    switch (shape.type) {
      case "path":
        el = document.createElementNS(SVG_NS, "path");
        el.setAttribute("d", shape.d!);
        break;
      case "circle":
        el = document.createElementNS(SVG_NS, "circle");
        el.setAttribute("cx", String(shape.cx));
        el.setAttribute("cy", String(shape.cy));
        el.setAttribute("r", String(shape.r));
        break;
      case "rect":
        el = document.createElementNS(SVG_NS, "rect");
        el.setAttribute("x", String(shape.x));
        el.setAttribute("y", String(shape.y));
        el.setAttribute("width", String(shape.width));
        el.setAttribute("height", String(shape.height));
        if (shape.rx) el.setAttribute("rx", String(shape.rx));
        break;
      case "line":
        el = document.createElementNS(SVG_NS, "line");
        el.setAttribute("x1", String(shape.x1));
        el.setAttribute("y1", String(shape.y1));
        el.setAttribute("x2", String(shape.x2));
        el.setAttribute("y2", String(shape.y2));
        break;
      default:
        continue;
    }
    el.setAttribute("class", cls);
    parent.appendChild(el);
  }
}

/**
 * Create an SVG showing a pen-type icon above a nib/tip shape for a preset.
 * Upper portion: small pen silhouette identifying the pen type.
 * Lower portion: nib footprint sized by width (circle, ellipse, rectangle).
 */
export function createPresetNibIcon(preset: PenPreset): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "-2 -2 28 28");
  svg.setAttribute("class", "preset-nib-svg");

  // Background circle
  const bg = document.createElementNS(SVG_NS, "circle");
  bg.setAttribute("cx", "12");
  bg.setAttribute("cy", "12");
  bg.setAttribute("r", "12");
  bg.setAttribute("class", "preset-nib-bg");
  svg.appendChild(bg);

  // Pen-type silhouette in the upper portion
  // Original icons are 24×24; scale to 55% and center horizontally
  const penGroup = document.createElementNS(SVG_NS, "g");
  penGroup.setAttribute("transform", "translate(5.4, -0.5) scale(0.55)");
  appendPenShapes(penGroup, preset.penType, "preset-pen-icon");
  svg.appendChild(penGroup);

  // Nib shape in the lower portion (pushed down; clipping is acceptable)
  const nibSize = computeNibSize(preset.width);
  const nibCY = 18;

  switch (preset.penType) {
    case "ballpoint":
    case "pencil": {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", "12");
      circle.setAttribute("cy", String(nibCY));
      circle.setAttribute("r", String(nibSize / 2));
      circle.setAttribute("class", "preset-nib-shape");
      svg.appendChild(circle);
      break;
    }
    case "fountain": {
      const rx = nibSize / 2;
      const ry = Math.max(MIN_MINOR_AXIS, rx * (preset.nibThickness ?? 0.25));
      const angleDeg = ((preset.nibAngle ?? Math.PI / 6) * 180) / Math.PI;
      const ellipse = document.createElementNS(SVG_NS, "ellipse");
      ellipse.setAttribute("cx", "12");
      ellipse.setAttribute("cy", String(nibCY));
      ellipse.setAttribute("rx", String(rx));
      ellipse.setAttribute("ry", String(ry));
      ellipse.setAttribute("transform", `rotate(${angleDeg} 12 ${nibCY})`);
      ellipse.setAttribute("class", "preset-nib-shape");
      svg.appendChild(ellipse);
      break;
    }
    case "felt-tip": {
      const w = nibSize;
      const h = nibSize * 0.55;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(12 - w / 2));
      rect.setAttribute("y", String(nibCY - h / 2));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(h));
      rect.setAttribute("rx", String(Math.min(h / 4, 1)));
      rect.setAttribute("class", "preset-nib-shape");
      svg.appendChild(rect);
      break;
    }
    case "highlighter": {
      const w = nibSize;
      const h = nibSize * 0.35;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(12 - w / 2));
      rect.setAttribute("y", String(nibCY - h / 2));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(h));
      rect.setAttribute("rx", "1");
      rect.setAttribute("class", "preset-nib-shape");
      svg.appendChild(rect);
      break;
    }
  }

  return svg;
}
