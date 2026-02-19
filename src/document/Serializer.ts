import type {
  PaperDocument,
  PenStyle,
  Stroke,
  Page,
  SerializedDocument,
  SerializedStroke,
  SerializedPenStyle,
  SerializedPage,
  PaperType,
  PenType,
  PageOrientation,
  LayoutDirection,
} from "../types";
import { createEmptyDocument } from "./Document";
import {
  compressString,
  decompressString,
  estimateStrokeDataSize,
  COMPRESSION_THRESHOLD,
} from "./Compression";

const CURRENT_VERSION = 3;

/**
 * Cache of compressed pts strings per stroke.
 * Stroke pts are immutable after creation, so this is safe to cache indefinitely.
 * WeakMap auto-cleans entries when strokes are GC'd (after erase/undo).
 */
const compressedPtsCache = new WeakMap<Stroke, string>();

/**
 * Pre-compress a stroke's pts and cache the result.
 * Call after finalization so subsequent saves don't pay the deflateSync cost.
 */
export function precompressStroke(stroke: Stroke): void {
  if (!compressedPtsCache.has(stroke)) {
    compressedPtsCache.set(stroke, compressString(stroke.pts));
  }
}

/**
 * Serialize a PaperDocument to a JSON string for storage.
 * Uses v3 format with pages and optional compression.
 */
export function serializeDocument(doc: PaperDocument): string {
  const ptsStrings = doc.strokes.map((s) => s.pts);
  const dataSize = estimateStrokeDataSize(ptsStrings);
  const useCompression = dataSize >= COMPRESSION_THRESHOLD;

  const serialized: SerializedDocument = {
    v: CURRENT_VERSION,
    meta: {
      created: doc.meta.created,
      app: doc.meta.appVersion,
    },
    pages: doc.pages.map((p) => serializePage(p)),
    viewport: {
      x: doc.viewport.x,
      y: doc.viewport.y,
      zoom: doc.viewport.zoom,
    },
    channels: doc.channels,
    styles: serializeStyles(doc.styles),
    strokes: doc.strokes.map((s) => serializeStroke(s, useCompression)),
  };

  // Omit layout if default (vertical)
  if (doc.layoutDirection !== "vertical") {
    serialized.layout = doc.layoutDirection;
  }

  return JSON.stringify(serialized);
}

/**
 * Deserialize a JSON string to a PaperDocument.
 * Only handles v3 format. Returns a fresh empty document for older/invalid data.
 */
export function deserializeDocument(data: string): PaperDocument {
  if (!data || data.trim() === "") {
    return createEmptyDocument();
  }

  let parsed: SerializedDocument;
  try {
    parsed = JSON.parse(data) as SerializedDocument;
  } catch {
    return createEmptyDocument();
  }

  if (!parsed.v || parsed.v < 3 || parsed.v > CURRENT_VERSION) {
    return createEmptyDocument();
  }

  const useCompression = estimateStrokeDataSize(
    (parsed.strokes ?? []).map((s) => s.pts)
  ) >= COMPRESSION_THRESHOLD;

  return {
    version: parsed.v,
    meta: {
      created: parsed.meta?.created ?? Date.now(),
      modified: Date.now(),
      appVersion: parsed.meta?.app ?? "0.1.0",
    },
    pages: (parsed.pages ?? []).map((p) => deserializePage(p)),
    layoutDirection: (parsed.layout as LayoutDirection) ?? "vertical",
    viewport: {
      x: parsed.viewport?.x ?? 0,
      y: parsed.viewport?.y ?? 0,
      zoom: parsed.viewport?.zoom ?? 1.0,
    },
    channels: parsed.channels ?? ["x", "y", "p", "tx", "ty", "tw", "t"],
    styles: deserializeStyles(parsed.styles ?? {}),
    strokes: (parsed.strokes ?? []).map((s) => deserializeStroke(s, useCompression)),
  };
}

function serializePage(page: Page): SerializedPage {
  const result: SerializedPage = {
    id: page.id,
    w: page.size.width,
    h: page.size.height,
  };

  if (page.orientation !== "portrait") {
    result.o = page.orientation;
  }
  if (page.paperType !== "blank") {
    result.paper = page.paperType;
  }
  if (page.lineSpacing !== undefined) {
    result.ls = page.lineSpacing;
  }
  if (page.gridSize !== undefined) {
    result.gs = page.gridSize;
  }

  // Margins — only serialize if non-default
  if (page.margins) {
    if (page.margins.top !== 72) result.mt = page.margins.top;
    if (page.margins.bottom !== 36) result.mb = page.margins.bottom;
    if (page.margins.left !== 36) result.ml = page.margins.left;
    if (page.margins.right !== 36) result.mr = page.margins.right;
  }

  return result;
}

function deserializePage(s: SerializedPage): Page {
  return {
    id: s.id,
    size: { width: s.w, height: s.h },
    orientation: (s.o as PageOrientation) ?? "portrait",
    paperType: (s.paper as PaperType) ?? "blank",
    lineSpacing: s.ls ?? 32,
    gridSize: s.gs ?? 40,
    margins: {
      top: s.mt ?? 72,
      bottom: s.mb ?? 36,
      left: s.ml ?? 36,
      right: s.mr ?? 36,
    },
  };
}

function serializeStyles(
  styles: Record<string, PenStyle>
): Record<string, SerializedPenStyle> {
  const result: Record<string, SerializedPenStyle> = {};
  for (const [name, style] of Object.entries(styles)) {
    result[name] = {
      pen: style.pen,
      color: style.color,
      ...(style.colorDark != null ? { colorDark: style.colorDark } : {}),
      width: style.width,
      opacity: style.opacity,
      smoothing: style.smoothing,
      pressureCurve: style.pressureCurve,
      tiltSensitivity: style.tiltSensitivity,
    };
  }
  return result;
}

function deserializeStyles(
  styles: Record<string, SerializedPenStyle>
): Record<string, PenStyle> {
  const result: Record<string, PenStyle> = {};
  for (const [name, s] of Object.entries(styles)) {
    result[name] = {
      pen: s.pen as PenType,
      color: s.color,
      ...(s.colorDark != null ? { colorDark: s.colorDark } : {}),
      width: s.width,
      opacity: s.opacity,
      smoothing: s.smoothing,
      pressureCurve: s.pressureCurve,
      tiltSensitivity: s.tiltSensitivity,
    };
  }
  return result;
}

function serializeStroke(stroke: Stroke, compress: boolean): SerializedStroke {
  let pts: string;
  if (!compress) {
    pts = stroke.pts;
  } else {
    // Use cached compressed form if available, otherwise compress and cache
    const cached = compressedPtsCache.get(stroke);
    if (cached) {
      pts = cached;
    } else {
      pts = compressString(stroke.pts);
      compressedPtsCache.set(stroke, pts);
    }
  }

  const result: SerializedStroke = {
    id: stroke.id,
    pg: stroke.pageIndex,
    st: stroke.style,
    bb: stroke.bbox,
    n: stroke.pointCount,
    pts,
  };

  if (stroke.styleOverrides) {
    result.so = stroke.styleOverrides as Partial<SerializedPenStyle>;
  }

  if (stroke.transform) {
    result.tf = stroke.transform;
  }

  return result;
}

function deserializeStroke(s: SerializedStroke, compressed: boolean): Stroke {
  const result: Stroke = {
    id: s.id,
    pageIndex: s.pg ?? 0,
    style: s.st,
    bbox: s.bb,
    pointCount: s.n,
    pts: compressed ? decompressString(s.pts) : s.pts,
  };

  if (s.so) {
    result.styleOverrides = s.so as Partial<PenStyle>;
  }

  if (s.tf) {
    result.transform = s.tf;
  }

  return result;
}
