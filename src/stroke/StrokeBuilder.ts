import type { StrokePoint, Stroke, PenStyle } from "../types";
import { OneEuroFilter, EMAFilter } from "../input/OneEuroFilter";
import { encodePoints, computeBBox } from "../document/PointEncoder";
import { generateStrokeId } from "../document/Document";

export interface StrokeBuilderConfig {
  /** Smoothing level 0-1. Maps to 1-Euro filter minCutoff. */
  smoothing: number;
}

const DEFAULT_BUILDER_CONFIG: StrokeBuilderConfig = {
  smoothing: 0.5,
};

/**
 * Accumulates points during active drawing, applies input smoothing,
 * and finalizes into a Stroke object on completion.
 */
export class StrokeBuilder {
  private points: StrokePoint[] = [];
  private xFilter: OneEuroFilter;
  private yFilter: OneEuroFilter;
  private pressureFilter: EMAFilter;
  private tiltXFilter: EMAFilter;
  private tiltYFilter: EMAFilter;
  private style: string;
  private pageIndex: number;
  private styleOverrides?: Partial<PenStyle>;

  constructor(
    style: string,
    pageIndex: number,
    config?: Partial<StrokeBuilderConfig>,
    styleOverrides?: Partial<PenStyle>
  ) {
    this.style = style;
    this.pageIndex = pageIndex;
    this.styleOverrides = styleOverrides;

    const cfg = { ...DEFAULT_BUILDER_CONFIG, ...config };

    // Map smoothing 0-1 to minCutoff: higher smoothing = lower cutoff = more filtering
    // smoothing 0 → minCutoff 5.0 (minimal filtering)
    // smoothing 1 → minCutoff 0.1 (maximum filtering)
    const minCutoff = 5.0 - cfg.smoothing * 4.9;

    this.xFilter = new OneEuroFilter({ minCutoff, beta: 0.007 });
    this.yFilter = new OneEuroFilter({ minCutoff, beta: 0.007 });
    this.pressureFilter = new EMAFilter(0.3);
    this.tiltXFilter = new EMAFilter(0.4);
    this.tiltYFilter = new EMAFilter(0.4);
  }

  /**
   * Add a raw point from input. Applies smoothing filters.
   * Returns the smoothed point.
   */
  addPoint(point: StrokePoint): StrokePoint {
    const smoothed: StrokePoint = {
      x: this.xFilter.filter(point.x, point.timestamp),
      y: this.yFilter.filter(point.y, point.timestamp),
      pressure: this.pressureFilter.filter(point.pressure),
      tiltX: this.tiltXFilter.filter(point.tiltX),
      tiltY: this.tiltYFilter.filter(point.tiltY),
      twist: point.twist,
      timestamp: point.timestamp,
    };

    this.points.push(smoothed);
    return smoothed;
  }

  /**
   * Get all accumulated points (smoothed).
   */
  getPoints(): readonly StrokePoint[] {
    return this.points;
  }

  /**
   * Get point count.
   */
  get pointCount(): number {
    return this.points.length;
  }

  /**
   * Returns true if this builder has any points.
   */
  get hasPoints(): boolean {
    return this.points.length > 0;
  }

  /**
   * Finalize the stroke: encode points, compute bbox, return Stroke object.
   * @param bboxMargin Extra margin (world units) to expand the bbox by on all sides.
   *   Use this for stamp-based pens where particles scatter beyond center points.
   */
  finalize(bboxMargin: number = 0): Stroke {
    const pts = encodePoints(this.points);
    const raw = computeBBox(this.points);
    const bbox: [number, number, number, number] = [
      raw[0] - bboxMargin, raw[1] - bboxMargin,
      raw[2] + bboxMargin, raw[3] + bboxMargin,
    ];

    const stroke: Stroke = {
      id: generateStrokeId(),
      pageIndex: this.pageIndex,
      style: this.style,
      bbox,
      grainAnchor: this.points.length > 0 ? [this.points[0].x, this.points[0].y] : undefined,
      pointCount: this.points.length,
      pts,
    };

    if (this.styleOverrides) {
      stroke.styleOverrides = this.styleOverrides;
    }

    return stroke;
  }

  /**
   * Discard all accumulated data.
   */
  discard(): void {
    this.points = [];
    this.xFilter.reset();
    this.yFilter.reset();
    this.pressureFilter.reset();
    this.tiltXFilter.reset();
    this.tiltYFilter.reset();
  }
}
