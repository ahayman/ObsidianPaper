import RBush from "rbush";
import type { Stroke } from "../types";

interface StrokeItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  index: number;
  strokeId: string;
}

/**
 * R-tree spatial index for fast stroke lookup.
 * Used for viewport culling (render only visible strokes)
 * and eraser hit testing (find strokes near a point).
 */
export class SpatialIndex {
  private tree = new RBush<StrokeItem>();
  private items = new Map<string, StrokeItem>();

  /**
   * Build the index from an array of strokes.
   * Replaces any existing index.
   */
  buildFromStrokes(strokes: readonly Stroke[]): void {
    this.tree.clear();
    this.items.clear();

    const items: StrokeItem[] = [];
    for (let i = 0; i < strokes.length; i++) {
      const stroke = strokes[i];
      const item: StrokeItem = {
        minX: stroke.bbox[0],
        minY: stroke.bbox[1],
        maxX: stroke.bbox[2],
        maxY: stroke.bbox[3],
        index: i,
        strokeId: stroke.id,
      };
      items.push(item);
      this.items.set(stroke.id, item);
    }

    this.tree.load(items);
  }

  /**
   * Insert a single stroke at the given index.
   */
  insert(stroke: Stroke, index: number): void {
    const item: StrokeItem = {
      minX: stroke.bbox[0],
      minY: stroke.bbox[1],
      maxX: stroke.bbox[2],
      maxY: stroke.bbox[3],
      index,
      strokeId: stroke.id,
    };
    this.tree.insert(item);
    this.items.set(stroke.id, item);
  }

  /**
   * Remove a stroke by ID.
   */
  remove(strokeId: string): void {
    const item = this.items.get(strokeId);
    if (item) {
      this.tree.remove(item);
      this.items.delete(strokeId);
    }
  }

  /**
   * Query all strokes whose bounding boxes intersect the given rectangle.
   * Returns stroke IDs.
   */
  queryRect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): string[] {
    const results = this.tree.search({ minX, minY, maxX, maxY });
    return results.map((r) => r.strokeId);
  }

  /**
   * Query all strokes whose bounding boxes are within radius of a point.
   * Returns stroke IDs. This is a bbox-level test only — callers should
   * do detailed point-to-segment testing afterward.
   */
  queryPoint(x: number, y: number, radius: number): string[] {
    return this.queryRect(
      x - radius,
      y - radius,
      x + radius,
      y + radius
    );
  }

  /**
   * Return the number of items in the index.
   */
  get size(): number {
    return this.items.size;
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.tree.clear();
    this.items.clear();
  }
}
