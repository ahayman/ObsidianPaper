import type {
  PaperDocument,
  PenStyle,
  Stroke,
  SerializedDocument,
  SerializedStroke,
  SerializedPenStyle,
  PaperType,
  PenType,
} from "../types";
import { createEmptyDocument } from "./Document";
import {
  compressString,
  decompressString,
  estimateStrokeDataSize,
  COMPRESSION_THRESHOLD,
} from "./Compression";

const CURRENT_VERSION = 2;

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
 * Auto-selects v1 (plain) or v2 (compressed pts) based on data size.
 */
export function serializeDocument(doc: PaperDocument): string {
  const ptsStrings = doc.strokes.map((s) => s.pts);
  const dataSize = estimateStrokeDataSize(ptsStrings);
  const useCompression = dataSize >= COMPRESSION_THRESHOLD;

  const serialized: SerializedDocument = {
    v: useCompression ? 2 : 1,
    meta: {
      created: doc.meta.created,
      app: doc.meta.appVersion,
    },
    canvas: {
      w: doc.canvas.width,
      h: doc.canvas.height,
      bg: doc.canvas.backgroundColor,
      paper: doc.canvas.paperType,
      ls: doc.canvas.lineSpacing,
      gs: doc.canvas.gridSize,
    },
    viewport: {
      x: doc.viewport.x,
      y: doc.viewport.y,
      zoom: doc.viewport.zoom,
    },
    channels: doc.channels,
    styles: serializeStyles(doc.styles),
    strokes: doc.strokes.map((s) => serializeStroke(s, useCompression)),
  };

  return JSON.stringify(serialized);
}

/**
 * Deserialize a JSON string to a PaperDocument.
 * Returns a fresh empty document if the data is empty or invalid.
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

  if (!parsed.v || parsed.v > CURRENT_VERSION) {
    return createEmptyDocument();
  }

  const isCompressed = parsed.v >= 2;

  return {
    version: parsed.v,
    meta: {
      created: parsed.meta?.created ?? Date.now(),
      modified: Date.now(),
      appVersion: parsed.meta?.app ?? "0.1.0",
    },
    canvas: {
      width: parsed.canvas?.w ?? 2048,
      height: parsed.canvas?.h ?? 2732,
      backgroundColor: parsed.canvas?.bg ?? "#fffff8",
      paperType: (parsed.canvas?.paper as PaperType) ?? "blank",
      lineSpacing: parsed.canvas?.ls ?? 32,
      gridSize: parsed.canvas?.gs ?? 40,
    },
    viewport: {
      x: parsed.viewport?.x ?? 0,
      y: parsed.viewport?.y ?? 0,
      zoom: parsed.viewport?.zoom ?? 1.0,
    },
    channels: parsed.channels ?? ["x", "y", "p", "tx", "ty", "tw", "t"],
    styles: deserializeStyles(parsed.styles ?? {}),
    strokes: (parsed.strokes ?? []).map((s) => deserializeStroke(s, isCompressed)),
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
