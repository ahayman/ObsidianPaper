import { generateMarkerStampImageData, DEFAULT_MARKER_STAMP_CONFIG } from "./MarkerStampTexture";

// Mock ImageData for jsdom
class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(sw: number, sh: number);
  constructor(data: Uint8ClampedArray, sw: number, sh?: number);
  constructor(swOrData: number | Uint8ClampedArray, shOrSw: number, sh?: number) {
    if (typeof swOrData === "number") {
      this.width = swOrData;
      this.height = shOrSw;
      this.data = new Uint8ClampedArray(swOrData * shOrSw * 4);
    } else {
      this.data = swOrData;
      this.width = shOrSw;
      this.height = sh ?? (swOrData.length / 4 / shOrSw);
    }
  }
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ImageData = MockImageData;
});

describe("MarkerStampTexture", () => {
  it("generates ImageData with correct dimensions", () => {
    const imageData = generateMarkerStampImageData();
    expect(imageData.width).toBe(DEFAULT_MARKER_STAMP_CONFIG.size);
    expect(imageData.height).toBe(DEFAULT_MARKER_STAMP_CONFIG.size);
    expect(imageData.data.length).toBe(
      DEFAULT_MARKER_STAMP_CONFIG.size * DEFAULT_MARKER_STAMP_CONFIG.size * 4,
    );
  });

  it("generates ImageData with custom size", () => {
    const imageData = generateMarkerStampImageData({ size: 32 });
    expect(imageData.width).toBe(32);
    expect(imageData.height).toBe(32);
  });

  it("has opaque center pixels (inside the rounded rectangle)", () => {
    const imageData = generateMarkerStampImageData();
    const center = Math.floor(imageData.width / 2);
    const idx = (center * imageData.width + center) * 4;
    // Center should be nearly opaque (alpha > 200)
    expect(imageData.data[idx + 3]).toBeGreaterThan(200);
  });

  it("has transparent corner pixels (outside the rounded rectangle)", () => {
    const imageData = generateMarkerStampImageData();
    // Top-left corner should be transparent (outside the rounded rect)
    const idx = 0; // pixel (0, 0)
    expect(imageData.data[idx + 3]).toBe(0);
  });

  it("uses white RGB with alpha channel", () => {
    const imageData = generateMarkerStampImageData();
    const center = Math.floor(imageData.width / 2);
    const idx = (center * imageData.width + center) * 4;
    // RGB should be 255 (white)
    expect(imageData.data[idx]).toBe(255);
    expect(imageData.data[idx + 1]).toBe(255);
    expect(imageData.data[idx + 2]).toBe(255);
  });

  it("has wider shape than tall (aspect ratio > 1)", () => {
    const size = 64;
    const imageData = generateMarkerStampImageData({ size, aspectRatio: 3.0 });
    const center = size / 2;
    const data = imageData.data;

    // Check that the shape is wider than tall by comparing alpha at horizontal
    // and vertical extremes. At the horizontal midline, far-right pixels should
    // still be opaque, while at vertical extreme, far-top pixels should be transparent.
    const farRightIdx = (Math.floor(center) * size + (size - 4)) * 4;
    const farTopIdx = (2 * size + Math.floor(center)) * 4;

    // Horizontal extent should have alpha > 0 (inside shape)
    expect(data[farRightIdx + 3]).toBeGreaterThan(0);
    // Vertical extent near top should be transparent (outside shape)
    expect(data[farTopIdx + 3]).toBe(0);
  });
});
