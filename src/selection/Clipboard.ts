/**
 * LIFO clipboard queue for lasso copy/cut/paste operations.
 * Lives at the plugin level so it's shared across all documents.
 * Paste pops from the queue; copy pushes onto it.
 */

import type { Stroke, PenStyle } from "../types";
import type { SelectionBBox } from "./SelectionState";
import { cloneStroke } from "./SelectionTransform";
import { generateStrokeId } from "../document/Document";
import { translateStroke } from "./SelectionTransform";
import { computeSelectionBBox } from "./SelectionState";
import { findPageAtPoint } from "../document/PageLayout";
import type { PageRect } from "../document/PageLayout";

export interface ClipboardEntry {
  strokes: Stroke[];
  styles: Record<string, PenStyle>;
  sourceBBox: SelectionBBox;
  sourcePageIndex: number;
  /** Tracks successive pastes of this entry for offset stacking */
  pasteCount: number;
}

export class ClipboardQueue {
  private queue: ClipboardEntry[] = [];
  maxSize: number;

  constructor(maxSize = 5) {
    this.maxSize = Math.max(1, Math.min(10, maxSize));
  }

  /**
   * Push a copy onto the queue.
   * Deep clones all data so the queue is independent of document mutations.
   */
  push(
    strokeIds: Set<string>,
    strokes: readonly Stroke[],
    styles: Record<string, PenStyle>,
    pageIndex: number
  ): void {
    const copied: Stroke[] = [];
    const usedStyles: Record<string, PenStyle> = {};

    for (const stroke of strokes) {
      if (!strokeIds.has(stroke.id)) continue;
      copied.push(cloneStroke(stroke));
      if (styles[stroke.style] && !usedStyles[stroke.style]) {
        usedStyles[stroke.style] = { ...styles[stroke.style] };
      }
    }

    if (copied.length === 0) return;

    this.queue.push({
      strokes: copied,
      styles: usedStyles,
      sourceBBox: computeSelectionBBox(strokeIds, strokes),
      sourcePageIndex: pageIndex,
      pasteCount: 0,
    });

    // Enforce max size (drop oldest entries)
    while (this.queue.length > this.maxSize) {
      this.queue.shift();
    }
  }

  /**
   * Paste from the top of the queue (most recent copy).
   * Pops the entry off the queue after pasting.
   * Returns null if the queue is empty.
   */
  paste(
    camera: { x: number; y: number; zoom: number },
    screenWidth: number,
    screenHeight: number,
    pageLayout: PageRect[],
    styles: Record<string, PenStyle>,
  ): { strokes: Stroke[]; pageIndex: number } | null {
    if (this.queue.length === 0) return null;

    const entry = this.queue.pop()!;
    entry.pasteCount++;
    const offset = entry.pasteCount * 20;

    // Determine which page the viewport center is on
    const centerWorldX = camera.x + screenWidth / (2 * camera.zoom);
    const centerWorldY = camera.y + screenHeight / (2 * camera.zoom);
    const viewportPageIndex = findPageAtPoint(centerWorldX, centerWorldY, pageLayout);
    const targetPageIndex = viewportPageIndex >= 0 ? viewportPageIndex : 0;

    // Ensure referenced styles exist in the target document
    for (const [name, style] of Object.entries(entry.styles)) {
      if (!styles[name]) {
        styles[name] = { ...style };
      }
    }

    // Compute translation
    const src = entry.sourceBBox;
    let dx: number;
    let dy: number;

    if (targetPageIndex === entry.sourcePageIndex) {
      dx = offset;
      dy = offset;
    } else {
      const targetPage = pageLayout[targetPageIndex];
      if (targetPage) {
        const targetCenterX = targetPage.x + targetPage.width / 2;
        const targetCenterY = targetPage.y + targetPage.height / 2;
        dx = targetCenterX - (src.x + src.width / 2);
        dy = targetCenterY - (src.y + src.height / 2);
      } else {
        dx = offset;
        dy = offset;
      }
    }

    const pasted: Stroke[] = [];
    for (const stroke of entry.strokes) {
      const moved = translateStroke(stroke, dx, dy);
      pasted.push({
        ...moved,
        id: generateStrokeId(),
        pageIndex: targetPageIndex,
      });
    }

    return { strokes: pasted, pageIndex: targetPageIndex };
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  get size(): number {
    return this.queue.length;
  }
}
