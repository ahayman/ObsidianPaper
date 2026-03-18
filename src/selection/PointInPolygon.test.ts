import { isPointInPolygon, polygonBBox } from "./PointInPolygon";
import type { Point2D } from "./PointInPolygon";

describe("isPointInPolygon", () => {
  // Simple square: (0,0), (10,0), (10,10), (0,10)
  const square: Point2D[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("should return true for a point inside a square", () => {
    expect(isPointInPolygon(5, 5, square)).toBe(true);
  });

  it("should return false for a point outside a square", () => {
    expect(isPointInPolygon(15, 5, square)).toBe(false);
    expect(isPointInPolygon(-1, 5, square)).toBe(false);
    expect(isPointInPolygon(5, -1, square)).toBe(false);
    expect(isPointInPolygon(5, 11, square)).toBe(false);
  });

  it("should return true for a point near the center", () => {
    expect(isPointInPolygon(1, 1, square)).toBe(true);
    expect(isPointInPolygon(9, 9, square)).toBe(true);
  });

  it("should return false for fewer than 3 vertices", () => {
    expect(isPointInPolygon(0, 0, [])).toBe(false);
    expect(isPointInPolygon(0, 0, [{ x: 0, y: 0 }])).toBe(false);
    expect(isPointInPolygon(0, 0, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });

  // Concave L-shape polygon
  const lShape: Point2D[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 10 },
  ];

  it("should handle concave polygons correctly", () => {
    // Inside the bottom part of the L
    expect(isPointInPolygon(2, 2, lShape)).toBe(true);
    // Inside the left part of the L
    expect(isPointInPolygon(2, 8, lShape)).toBe(true);
    // Outside — in the notch of the L
    expect(isPointInPolygon(8, 8, lShape)).toBe(false);
    // Inside the right arm
    expect(isPointInPolygon(8, 2, lShape)).toBe(true);
  });

  // Triangle
  const triangle: Point2D[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 10, y: 20 },
  ];

  it("should work with triangles", () => {
    expect(isPointInPolygon(10, 5, triangle)).toBe(true);
    expect(isPointInPolygon(0, 20, triangle)).toBe(false);
    expect(isPointInPolygon(20, 20, triangle)).toBe(false);
  });

  it("should handle points far outside", () => {
    expect(isPointInPolygon(1000, 1000, square)).toBe(false);
    expect(isPointInPolygon(-1000, -1000, square)).toBe(false);
  });
});

describe("polygonBBox", () => {
  it("should compute bounding box of a square", () => {
    const square: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonBBox(square)).toEqual([0, 0, 10, 10]);
  });

  it("should handle negative coordinates", () => {
    const poly: Point2D[] = [
      { x: -5, y: -3 },
      { x: 5, y: -3 },
      { x: 5, y: 7 },
      { x: -5, y: 7 },
    ];
    expect(polygonBBox(poly)).toEqual([-5, -3, 5, 7]);
  });

  it("should handle empty polygon", () => {
    expect(polygonBBox([])).toEqual([0, 0, 0, 0]);
  });

  it("should handle single point", () => {
    expect(polygonBBox([{ x: 3, y: 4 }])).toEqual([3, 4, 3, 4]);
  });
});
