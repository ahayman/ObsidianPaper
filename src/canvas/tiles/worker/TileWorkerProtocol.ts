/**
 * Shared type definitions for main↔worker communication.
 * No runtime code — just interfaces and discriminated union types.
 */

import type { Stroke, PenStyle, Page, LayoutDirection } from "../../../types";
import type { PageRect } from "../../../document/PageLayout";

// ─── Main → Worker Messages ──────────────────────────────────

export interface WorkerInitMessage {
  type: "init";
  /** Grain texture pixel data (256x256 RGBA). Transferred, not cloned. */
  grainImageData: ImageData | null;
}

export interface WorkerDocUpdateMessage {
  type: "doc-update";
  strokes: Stroke[];
  styles: Record<string, PenStyle>;
  pages: Page[];
  pageLayout: PageRect[];
  layoutDirection: LayoutDirection;
}

export interface WorkerGrainUpdateMessage {
  type: "grain-update";
  grainImageData: ImageData | null;
  /** Per-pen-type strength overrides. Serialized as entries since Map isn't structured-cloneable. */
  strengthOverrides: [string, number][];
}

export interface WorkerRenderTileMessage {
  type: "render-tile";
  tileKey: string;            // "col,row"
  worldBounds: [number, number, number, number];
  zoomBand: number;
  tilePhysical: number;       // Canvas pixel size for this tile
  tileWorldSize: number;      // World-space tile size (from config)
  strokeIds: string[];        // Pre-queried from spatial index on main thread
  isDarkMode: boolean;
}

export interface WorkerCancelMessage {
  type: "cancel";
  tileKey?: string;           // Cancel specific tile, or all if omitted
}

export interface WorkerDestroyMessage {
  type: "destroy";
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerDocUpdateMessage
  | WorkerGrainUpdateMessage
  | WorkerRenderTileMessage
  | WorkerCancelMessage
  | WorkerDestroyMessage;

// ─── Worker → Main Messages ──────────────────────────────────

export interface WorkerTileResultMessage {
  type: "tile-result";
  tileKey: string;
  /** Rendered tile as transferable ImageBitmap (zero-copy). */
  bitmap: ImageBitmap;
  /** Stroke IDs that were actually rendered into this tile. */
  strokeIds: string[];
}

export interface WorkerErrorMessage {
  type: "tile-error";
  tileKey: string;
  error: string;
}

export interface WorkerReadyMessage {
  type: "ready";
}

export type WorkerToMainMessage =
  | WorkerTileResultMessage
  | WorkerErrorMessage
  | WorkerReadyMessage;
