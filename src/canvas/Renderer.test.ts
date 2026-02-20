import { computeScreenBBox } from "./Renderer";

describe("computeScreenBBox", () => {
  // Helper: create a DOMMatrix-like object from scale + translate
  // computeScreenBBox only reads { a, b, c, d, e, f }
  function makeTransform(
    scale: number,
    tx: number,
    ty: number,
  ): DOMMatrix {
    return { a: scale, b: 0, c: 0, d: scale, e: tx, f: ty } as unknown as DOMMatrix;
  }

  it("returns correct region for a bbox fully within canvas", () => {
    // Canvas: 1000x800, identity transform (1:1 mapping)
    const transform = makeTransform(1, 0, 0);
    const bbox: [number, number, number, number] = [100, 200, 300, 400];
    const result = computeScreenBBox(bbox, transform, 1000, 800);

    expect(result).not.toBeNull();
    // With 2px margin: sx = 100-2 = 98, sy = 200-2 = 198
    // sx2 = 300+2 = 302, sy2 = 400+2 = 402
    expect(result!.sx).toBe(98);
    expect(result!.sy).toBe(198);
    expect(result!.sw).toBe(302 - 98);
    expect(result!.sh).toBe(402 - 198);
  });

  it("applies DPR scaling correctly", () => {
    // 2x DPR: canvas is 2000x1600 physical pixels
    const transform = makeTransform(2, 0, 0);
    const bbox: [number, number, number, number] = [50, 50, 150, 100];
    const result = computeScreenBBox(bbox, transform, 2000, 1600);

    expect(result).not.toBeNull();
    // Screen coords: (100, 100) to (300, 200), with 2px margin
    expect(result!.sx).toBe(98);
    expect(result!.sy).toBe(98);
    expect(result!.sw).toBe(302 - 98);
    expect(result!.sh).toBe(202 - 98);
  });

  it("clips to canvas bounds when bbox is partially off-screen", () => {
    const transform = makeTransform(1, 0, 0);
    // bbox extends beyond left and top edges
    const bbox: [number, number, number, number] = [-50, -30, 100, 100];
    const result = computeScreenBBox(bbox, transform, 500, 400);

    expect(result).not.toBeNull();
    // sx would be -52 -> clamped to 0, sy would be -32 -> clamped to 0
    expect(result!.sx).toBe(0);
    expect(result!.sy).toBe(0);
    expect(result!.sw).toBe(102); // ceil(100) + 2
    expect(result!.sh).toBe(102);
  });

  it("clips to canvas bounds when bbox extends past right/bottom", () => {
    const transform = makeTransform(1, 0, 0);
    const bbox: [number, number, number, number] = [400, 300, 600, 500];
    const result = computeScreenBBox(bbox, transform, 500, 400);

    expect(result).not.toBeNull();
    // sx = 398, sy = 298, sx2 = min(500, 602) = 500, sy2 = min(400, 502) = 400
    expect(result!.sx).toBe(398);
    expect(result!.sy).toBe(298);
    expect(result!.sw).toBe(500 - 398);
    expect(result!.sh).toBe(400 - 298);
  });

  it("returns null when bbox is fully off-screen (left)", () => {
    const transform = makeTransform(1, 0, 0);
    const bbox: [number, number, number, number] = [-200, -200, -100, -100];
    const result = computeScreenBBox(bbox, transform, 500, 400);

    expect(result).toBeNull();
  });

  it("returns null when bbox is fully off-screen (right/bottom)", () => {
    const transform = makeTransform(1, 0, 0);
    const bbox: [number, number, number, number] = [600, 500, 700, 600];
    const result = computeScreenBBox(bbox, transform, 500, 400);

    expect(result).toBeNull();
  });

  it("handles zero-area bbox (point)", () => {
    const transform = makeTransform(1, 0, 0);
    const bbox: [number, number, number, number] = [250, 200, 250, 200];
    const result = computeScreenBBox(bbox, transform, 500, 400);

    expect(result).not.toBeNull();
    // With 2px margin on each side: sw = 4, sh = 4
    expect(result!.sx).toBe(248);
    expect(result!.sy).toBe(198);
    expect(result!.sw).toBe(4);
    expect(result!.sh).toBe(4);
  });

  it("handles camera transform with offset", () => {
    // Simulates DPR=2, camera at (100, 50) with zoom=1.5
    // Combined transform: scale(2) then transform(1.5, 0, 0, 1.5, -150, -75)
    // = [3, 0, 0, 3, -300, -150]
    const dpr = 2;
    const zoom = 1.5;
    const camX = 100;
    const camY = 50;
    const transform = makeTransform(
      dpr * zoom,
      -camX * dpr * zoom,
      -camY * dpr * zoom,
    );
    const bbox: [number, number, number, number] = [110, 60, 210, 160];
    const result = computeScreenBBox(bbox, transform, 2000, 1600);

    expect(result).not.toBeNull();
    // Screen x: 3 * 110 - 300 = 30, 3 * 210 - 300 = 330
    // Screen y: 3 * 60 - 150 = 30, 3 * 160 - 150 = 330
    // With margin: sx = 28, sy = 28, sx2 = 332, sy2 = 332
    expect(result!.sx).toBe(28);
    expect(result!.sy).toBe(28);
    expect(result!.sw).toBe(332 - 28);
    expect(result!.sh).toBe(332 - 28);
  });
});
