import { detectInkPools, renderInkPools } from "./InkPooling";
import type { StrokePoint } from "../types";

function makePoint(
  x: number,
  y: number,
  pressure = 0.5,
  timestamp = 0
): StrokePoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, timestamp };
}

describe("InkPooling", () => {
  describe("detectInkPools", () => {
    it("should return empty for fewer than 2 points", () => {
      expect(detectInkPools([], 2)).toEqual([]);
      expect(detectInkPools([makePoint(0, 0)], 2)).toEqual([]);
    });

    it("should always include start and end pools", () => {
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(100, 0, 0.5, 100),
      ];
      const pools = detectInkPools(points, 2);
      expect(pools.length).toBeGreaterThanOrEqual(2);

      // First pool at start
      expect(pools[0].x).toBe(0);
      expect(pools[0].y).toBe(0);

      // Last pool at end
      const last = pools[pools.length - 1];
      expect(last.x).toBe(100);
      expect(last.y).toBe(0);
    });

    it("should detect pools at sharp direction changes with low velocity", () => {
      // Create a V-shape with low velocity at the corner
      const points = [
        makePoint(0, 0, 0.7, 0),
        makePoint(5, 0, 0.7, 100),    // slow approach
        makePoint(5.1, 0, 0.7, 200),  // near-zero velocity at corner
        makePoint(5, 5, 0.7, 300),    // sharp turn going down
        makePoint(10, 10, 0.7, 400),
      ];
      const pools = detectInkPools(points, 2);

      // Should have start, end, and at least one interior pool
      expect(pools.length).toBeGreaterThanOrEqual(3);
    });

    it("should not detect pools at fast-moving points", () => {
      // Straight, fast line — only start and end pools
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(100, 0, 0.5, 10),   // very fast (100px / 10ms)
        makePoint(200, 0, 0.5, 20),
        makePoint(300, 0, 0.5, 30),
      ];
      const pools = detectInkPools(points, 2);
      // Only start and end
      expect(pools).toHaveLength(2);
    });

    it("should scale pool radius with stroke width", () => {
      const points = [
        makePoint(0, 0, 0.8, 0),
        makePoint(10, 0, 0.8, 100),
      ];
      const thinPools = detectInkPools(points, 1);
      const thickPools = detectInkPools(points, 4);

      expect(thickPools[0].radius).toBeGreaterThan(thinPools[0].radius);
    });

    it("should scale pool with pressure", () => {
      const lowPressure = [
        makePoint(0, 0, 0.2, 0),
        makePoint(10, 0, 0.2, 100),
      ];
      const highPressure = [
        makePoint(0, 0, 0.9, 0),
        makePoint(10, 0, 0.9, 100),
      ];
      const lowPools = detectInkPools(lowPressure, 2);
      const highPools = detectInkPools(highPressure, 2);

      expect(highPools[0].radius).toBeGreaterThan(lowPools[0].radius);
      expect(highPools[0].opacity).toBeGreaterThan(lowPools[0].opacity);
    });

    it("should return pools with valid radius and opacity", () => {
      const points = [
        makePoint(0, 0, 0.5, 0),
        makePoint(1, 0, 0.5, 100),
        makePoint(1, 1, 0.5, 200),
        makePoint(10, 10, 0.5, 300),
      ];
      const pools = detectInkPools(points, 2);

      for (const pool of pools) {
        expect(pool.radius).toBeGreaterThan(0);
        expect(pool.opacity).toBeGreaterThanOrEqual(0);
        expect(pool.opacity).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("renderInkPools", () => {
    it("should render pools as radial gradients", () => {
      const pools = [
        { x: 10, y: 10, radius: 3, opacity: 0.1 },
        { x: 50, y: 50, radius: 5, opacity: 0.15 },
      ];

      const saves: number[] = [];
      const restores: number[] = [];
      const arcs: { x: number; y: number; r: number }[] = [];
      let fillCount = 0;

      const mockCtx = {
        createRadialGradient: jest.fn(() => ({
          addColorStop: jest.fn(),
        })),
        save: jest.fn(() => saves.push(1)),
        restore: jest.fn(() => restores.push(1)),
        globalAlpha: 1,
        fillStyle: "",
        beginPath: jest.fn(),
        arc: jest.fn((x: number, y: number, r: number) => arcs.push({ x, y, r })),
        fill: jest.fn(() => fillCount++),
      } as unknown as CanvasRenderingContext2D;

      renderInkPools(mockCtx, pools, "#1a1a1a");

      expect(mockCtx.createRadialGradient).toHaveBeenCalledTimes(2);
      expect(fillCount).toBe(2);
      expect(saves.length).toBe(2);
      expect(restores.length).toBe(2);
      expect(arcs[0].x).toBe(10);
      expect(arcs[1].x).toBe(50);
    });

    it("should skip pools with zero radius or opacity", () => {
      const pools = [
        { x: 10, y: 10, radius: 0.1, opacity: 0 },
        { x: 50, y: 50, radius: 0, opacity: 0.1 },
      ];

      const mockCtx = {
        createRadialGradient: jest.fn(() => ({
          addColorStop: jest.fn(),
        })),
        save: jest.fn(),
        restore: jest.fn(),
        globalAlpha: 1,
        fillStyle: "",
        beginPath: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
      } as unknown as CanvasRenderingContext2D;

      renderInkPools(mockCtx, pools, "#1a1a1a");

      expect(mockCtx.fill).not.toHaveBeenCalled();
    });
  });
});
