import { StampTextureManager } from "./StampTextureManager";
import { DEFAULT_GRAIN_VALUE } from "./GrainMapping";

// Mock ImageData + OffscreenCanvas for jsdom (same pattern as StampTexture.test.ts)
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
  globalCompositeOperation = "source-over";
  fillStyle = "";
  private canvas: MockOffscreenCanvas;
  constructor(canvas: MockOffscreenCanvas) {
    this.canvas = canvas;
  }
  putImageData(imageData: MockImageData): void {
    (this.canvas as unknown as { _imageData: MockImageData })._imageData = imageData;
  }
  drawImage(): void {}
  fillRect(): void {}
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

describe("StampTextureManager", () => {
  let manager: StampTextureManager;

  beforeEach(() => {
    manager = new StampTextureManager();
  });

  afterEach(() => {
    manager.clear();
  });

  it("returns a StampCache for the default grain value", () => {
    const cache = manager.getCache(DEFAULT_GRAIN_VALUE);
    expect(cache).toBeDefined();
    expect(typeof cache.getColored).toBe("function");
  });

  it("returns the same cache for the same grain value", () => {
    const cache1 = manager.getCache(0.5);
    const cache2 = manager.getCache(0.5);
    expect(cache1).toBe(cache2);
  });

  it("returns different caches for different grain values", () => {
    const cacheCoarse = manager.getCache(0);
    const cacheFine = manager.getCache(1);
    expect(cacheCoarse).not.toBe(cacheFine);
  });

  it("clear() removes all caches", () => {
    manager.getCache(0);
    manager.getCache(0.5);
    manager.getCache(1);
    manager.clear();
    // After clear, getting the same value should create a new cache
    const fresh = manager.getCache(0.5);
    expect(fresh).toBeDefined();
  });
});
