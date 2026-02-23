import { packStampsToFloat32, packInkStampsToFloat32 } from "./StampPacking";
import type { StampParams } from "./StampRenderer";
import type { InkStampParams } from "./InkStampRenderer";

describe("StampPacking", () => {
  describe("packStampsToFloat32", () => {
    it("should return empty Float32Array for empty input", () => {
      const result = packStampsToFloat32([]);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(0);
    });

    it("should pack stamps into [x, y, size, opacity] layout", () => {
      const stamps: StampParams[] = [
        { x: 10, y: 20, size: 3, opacity: 0.5, rotation: 0, scaleX: 1, scaleY: 1, tiltAngle: 0 },
        { x: 30, y: 40, size: 5, opacity: 0.8, rotation: 1, scaleX: 2, scaleY: 3, tiltAngle: 0.5 },
      ];
      const result = packStampsToFloat32(stamps);
      expect(result.length).toBe(8);
      // First stamp
      expect(result[0]).toBe(10);
      expect(result[1]).toBe(20);
      expect(result[2]).toBe(3);
      expect(result[3]).toBe(0.5);
      // Second stamp
      expect(result[4]).toBe(30);
      expect(result[5]).toBe(40);
      expect(result[6]).toBe(5);
      expect(result[7]).toBeCloseTo(0.8);
    });

    it("should ignore rotation, scale, and tilt fields", () => {
      const stamps: StampParams[] = [
        { x: 1, y: 2, size: 3, opacity: 0.4, rotation: Math.PI, scaleX: 0.5, scaleY: 2, tiltAngle: 1.5 },
      ];
      const result = packStampsToFloat32(stamps);
      expect(result.length).toBe(4);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(2);
      expect(result[2]).toBe(3);
      expect(result[3]).toBeCloseTo(0.4);
    });
  });

  describe("packInkStampsToFloat32", () => {
    it("should return empty Float32Array for empty input", () => {
      const result = packInkStampsToFloat32([]);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(0);
    });

    it("should pack ink stamps into [x, y, size, opacity] layout", () => {
      const stamps: InkStampParams[] = [
        { x: 5, y: 15, size: 8, opacity: 0.9, rotation: 0, scaleX: 1, scaleY: 1 },
      ];
      const result = packInkStampsToFloat32(stamps);
      expect(result.length).toBe(4);
      expect(result[0]).toBe(5);
      expect(result[1]).toBe(15);
      expect(result[2]).toBe(8);
      expect(result[3]).toBeCloseTo(0.9);
    });
  });
});
