import { packStamps } from "./StampPacking";
import { packStampsToFloat32, packInkStampsToFloat32 } from "../../stamp/StampPacking";
import type { StampParams } from "../../stamp/StampRenderer";
import type { InkStampParams } from "../../stamp/InkStampRenderer";

// ─── Fixtures ───────────────────────────────────────────────

function makeStamp(x: number, y: number, size: number, opacity: number): StampParams {
  return { x, y, size, opacity, rotation: 0, scaleX: 1, scaleY: 1, tiltAngle: 0 };
}

function makeInkStamp(x: number, y: number, size: number, opacity: number): InkStampParams {
  return { x, y, size, opacity, rotation: 0, scaleX: 1, scaleY: 1 };
}

// ─── Tests ──────────────────────────────────────────────────

describe("packStamps (unified)", () => {
  it("packs empty array", () => {
    const result = packStamps([]);
    expect(result.count).toBe(0);
    expect(result.data.length).toBe(0);
  });

  it("packs all stamps when no minOpacity", () => {
    const stamps = [
      makeStamp(1, 2, 3, 0.5),
      makeStamp(4, 5, 6, 0.01),
    ];
    const result = packStamps(stamps);
    expect(result.count).toBe(2);
    expect(result.data.length).toBe(8);
    expect(result.data[0]).toBe(1);
    expect(result.data[3]).toBe(0.5);
    expect(result.data[4]).toBe(4);
    expect(result.data[7]).toBeCloseTo(0.01, 5);
  });

  it("filters stamps below minOpacity", () => {
    const stamps = [
      makeStamp(1, 2, 3, 0.5),
      makeStamp(4, 5, 6, 0.02),
      makeStamp(7, 8, 9, 0.1),
    ];
    const result = packStamps(stamps, 0.05);
    expect(result.count).toBe(2);
    expect(result.data.length).toBe(8);
    expect(result.data[0]).toBe(1);
    expect(result.data[4]).toBe(7);
  });

  it("keeps stamps at exactly minOpacity", () => {
    const stamps = [makeStamp(1, 2, 3, 0.05)];
    const result = packStamps(stamps, 0.05);
    expect(result.count).toBe(1);
  });

  it("matches packStampsToFloat32 output for pencil stamps", () => {
    const stamps: StampParams[] = [
      makeStamp(10, 20, 0.8, 0.7),
      makeStamp(30, 40, 0.6, 0.03),
      makeStamp(50, 60, 0.9, 0.5),
    ];

    const oldPacked = packStampsToFloat32(stamps);
    const newResult = packStamps(stamps, 0.05);

    expect(newResult.data).toEqual(oldPacked);
  });

  it("matches packInkStampsToFloat32 output for ink stamps", () => {
    const stamps: InkStampParams[] = [
      makeInkStamp(10, 20, 5, 0.22),
      makeInkStamp(30, 40, 6, 0.15),
      makeInkStamp(50, 60, 4, 0.01),
    ];

    const oldPacked = packInkStampsToFloat32(stamps);
    const newResult = packStamps(stamps);

    expect(newResult.data).toEqual(oldPacked);
    expect(newResult.count).toBe(stamps.length);
  });

  it("packs [x, y, size, opacity] in correct order", () => {
    const result = packStamps([makeStamp(11, 22, 33, 0.44)]);
    expect(result.data[0]).toBe(11);
    expect(result.data[1]).toBe(22);
    expect(result.data[2]).toBe(33);
    expect(result.data[3]).toBeCloseTo(0.44);
  });

  it("handles large stamp arrays efficiently", () => {
    const stamps = Array.from({ length: 10000 }, (_, i) =>
      makeStamp(i, i * 2, 1, Math.random()),
    );
    const result = packStamps(stamps);
    expect(result.count).toBe(10000);
    expect(result.data.length).toBe(40000);
  });
});
