import type { Page, LayoutDirection } from "../types";

export const PAGE_GAP = 40; // World units between pages

export interface PageRect {
  pageIndex: number;
  x: number;      // World X (left edge)
  y: number;      // World Y (top edge)
  width: number;  // Effective width (after orientation swap)
  height: number; // Effective height (after orientation swap)
}

/**
 * Get effective dimensions for a page (applies orientation swap).
 */
export function getEffectiveSize(page: Page): { width: number; height: number } {
  if (page.orientation === "landscape") {
    return { width: page.size.height, height: page.size.width };
  }
  return { width: page.size.width, height: page.size.height };
}

/**
 * Compute world-space rectangles for all pages.
 * Vertical: stacked top-to-bottom, centered on X=0.
 * Horizontal: stacked left-to-right, centered on Y=0.
 */
export function computePageLayout(pages: Page[], direction: LayoutDirection): PageRect[] {
  const rects: PageRect[] = [];

  if (direction === "horizontal") {
    let xCursor = 0;
    for (let i = 0; i < pages.length; i++) {
      const { width, height } = getEffectiveSize(pages[i]);
      rects.push({
        pageIndex: i,
        x: xCursor,
        y: -height / 2,
        width,
        height,
      });
      xCursor += width + PAGE_GAP;
    }
  } else {
    // vertical (default)
    let yCursor = 0;
    for (let i = 0; i < pages.length; i++) {
      const { width, height } = getEffectiveSize(pages[i]);
      rects.push({
        pageIndex: i,
        x: -width / 2,
        y: yCursor,
        width,
        height,
      });
      yCursor += height + PAGE_GAP;
    }
  }

  return rects;
}

/**
 * Find which page a world-space point falls within.
 * Returns -1 if the point is outside all pages.
 */
export function findPageAtPoint(x: number, y: number, layout: PageRect[]): number {
  for (const rect of layout) {
    if (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    ) {
      return rect.pageIndex;
    }
  }
  return -1;
}

/**
 * Get the total bounding box encompassing all pages.
 */
export function getDocumentBounds(layout: PageRect[]): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  if (layout.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rect of layout) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return { minX, minY, maxX, maxY };
}
