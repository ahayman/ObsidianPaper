import { StampCache } from "./StampCache";

// Mock OffscreenCanvas + ImageData for jsdom
class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
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
  globalCompositeOperation = "source-over";
  fillStyle = "";
  private canvas: MockOffscreenCanvas;
  constructor(canvas: MockOffscreenCanvas) {
    this.canvas = canvas;
  }
  drawImage(): void {}
  fillRect(): void {}
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
  (globalThis as any).OffscreenCanvas = MockOffscreenCanvas;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ImageData = MockImageData;
});

function createMockAlphaTemplate(size = 8): OffscreenCanvas {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  const imageData = new ImageData(size, size);
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = 255;
    imageData.data[i + 1] = 255;
    imageData.data[i + 2] = 255;
    imageData.data[i + 3] = 128;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any).putImageData(imageData, 0, 0);
  return canvas;
}

describe("StampCache", () => {
  it("should create from alpha template", () => {
    const template = createMockAlphaTemplate();
    const cache = new StampCache(template);
    expect(cache).toBeDefined();
  });

  it("should return colored stamp", () => {
    const template = createMockAlphaTemplate();
    const cache = new StampCache(template);
    const colored = cache.getColored("#ff0000");
    expect(colored).toBeInstanceOf(MockOffscreenCanvas);
    expect(colored.width).toBe(8);
    expect(colored.height).toBe(8);
  });

  it("should cache colored stamps by color", () => {
    const template = createMockAlphaTemplate();
    const cache = new StampCache(template);
    const first = cache.getColored("#ff0000");
    const second = cache.getColored("#ff0000");
    expect(first).toBe(second);
  });

  it("should create different stamps for different colors", () => {
    const template = createMockAlphaTemplate();
    const cache = new StampCache(template);
    const red = cache.getColored("#ff0000");
    const blue = cache.getColored("#0000ff");
    expect(red).not.toBe(blue);
  });

  it("should return ImageData for transfer", () => {
    const template = createMockAlphaTemplate(16);
    const cache = new StampCache(template);
    const imageData = cache.getImageData();
    expect(imageData).toBeInstanceOf(MockImageData);
    expect(imageData.width).toBe(16);
    expect(imageData.height).toBe(16);
  });

  it("should clear cache", () => {
    const template = createMockAlphaTemplate();
    const cache = new StampCache(template);
    const first = cache.getColored("#ff0000");
    cache.clear();
    const second = cache.getColored("#ff0000");
    expect(first).not.toBe(second);
  });
});
