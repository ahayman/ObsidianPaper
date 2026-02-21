import {
  generateStampImageData,
  stampFromImageData,
  generateStampTexture,
  DEFAULT_STAMP_CONFIG,
} from "./StampTexture";

// Mock ImageData + OffscreenCanvas for jsdom
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

class MockOffscreenCanvas {
  width: number;
  height: number;
  private _imageData: MockImageData | null = null;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): MockCtx {
    return new MockCtx(this);
  }
}

class MockCtx {
  private canvas: MockOffscreenCanvas;
  constructor(canvas: MockOffscreenCanvas) {
    this.canvas = canvas;
  }
  putImageData(imageData: MockImageData): void {
    (this.canvas as unknown as { _imageData: MockImageData })._imageData = imageData;
  }
  getImageData(_sx: number, _sy: number, sw: number, sh: number): MockImageData {
    const stored = (this.canvas as unknown as { _imageData: MockImageData | null })._imageData;
    if (stored) return stored;
    return new MockImageData(sw, sh);
  }
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ImageData = MockImageData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).OffscreenCanvas = MockOffscreenCanvas;
});

describe("StampTexture", () => {
  describe("generateStampImageData", () => {
    it("should generate ImageData of correct size", () => {
      const imageData = generateStampImageData();
      expect(imageData.width).toBe(DEFAULT_STAMP_CONFIG.size);
      expect(imageData.height).toBe(DEFAULT_STAMP_CONFIG.size);
      expect(imageData.data.length).toBe(48 * 48 * 4);
    });

    it("should respect custom size", () => {
      const imageData = generateStampImageData({ size: 32 });
      expect(imageData.width).toBe(32);
      expect(imageData.height).toBe(32);
    });

    it("should have white RGB channels", () => {
      const imageData = generateStampImageData({ size: 8 });
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i]).toBe(255);     // R
        expect(data[i + 1]).toBe(255); // G
        expect(data[i + 2]).toBe(255); // B
      }
    });

    it("should have zero alpha at corners (outside radius)", () => {
      const imageData = generateStampImageData({ size: 48 });
      const data = imageData.data;
      expect(data[3]).toBe(0);
      expect(data[(47) * 4 + 3]).toBe(0);
    });

    it("should have non-zero alpha near center", () => {
      const imageData = generateStampImageData({ size: 48 });
      const data = imageData.data;
      const centerIdx = (24 * 48 + 24) * 4;
      expect(data[centerIdx + 3]).toBeGreaterThan(0);
    });

    it("should produce alpha values in 0-255 range", () => {
      const imageData = generateStampImageData();
      const data = imageData.data;
      for (let i = 3; i < data.length; i += 4) {
        expect(data[i]).toBeGreaterThanOrEqual(0);
        expect(data[i]).toBeLessThanOrEqual(255);
      }
    });
  });

  describe("stampFromImageData", () => {
    it("should create OffscreenCanvas from ImageData", () => {
      const imageData = generateStampImageData({ size: 16 });
      const canvas = stampFromImageData(imageData);
      expect(canvas.width).toBe(16);
      expect(canvas.height).toBe(16);
    });
  });

  describe("generateStampTexture", () => {
    it("should return OffscreenCanvas of correct size", () => {
      const canvas = generateStampTexture();
      expect(canvas.width).toBe(DEFAULT_STAMP_CONFIG.size);
      expect(canvas.height).toBe(DEFAULT_STAMP_CONFIG.size);
    });

    it("should accept custom config", () => {
      const canvas = generateStampTexture({ size: 64, grainScale: 4 });
      expect(canvas.width).toBe(64);
      expect(canvas.height).toBe(64);
    });
  });
});
