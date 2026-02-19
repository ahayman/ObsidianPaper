import type { PenType } from "../../types";

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

  // Brush: handle widening to splayed bristle tip
  brush: [
    { type: "path", d: "M8 1 L16 1 L17 10 L21 16 Q22 21 17 23 L12 24 L7 23 Q2 21 3 16 L7 10 Z", fill: "white", fillOpacity: "0.85" },
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
