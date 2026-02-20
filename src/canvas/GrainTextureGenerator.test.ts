import { GrainTextureGenerator } from "./GrainTextureGenerator";

// Mock canvas and context for jsdom (no real 2D canvas support)
function mockCreateElement() {
  const imageData = {
    data: new Uint8ClampedArray(256 * 256 * 4),
    width: 256,
    height: 256,
  };
  const mockCtx = {
    createImageData: jest.fn().mockReturnValue(imageData),
    putImageData: jest.fn(),
    createPattern: jest.fn().mockReturnValue({ setTransform: jest.fn() }),
  };
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: jest.fn().mockReturnValue(mockCtx),
  };
  jest.spyOn(document, "createElement").mockReturnValue(mockCanvas as unknown as HTMLCanvasElement);
  return { mockCanvas, mockCtx };
}

describe("GrainTextureGenerator", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates with default config", () => {
    const gen = new GrainTextureGenerator();
    expect(gen).toBeDefined();
    expect(gen.isInitialized()).toBe(false);
  });

  it("accepts custom config", () => {
    const gen = new GrainTextureGenerator({ tileSize: 128, scale: 2.0, octaves: 3 });
    expect(gen).toBeDefined();
  });

  it("initializes without error", () => {
    mockCreateElement();
    const gen = new GrainTextureGenerator();
    expect(() => gen.initialize()).not.toThrow();
    expect(gen.isInitialized()).toBe(true);
  });

  it("returns pattern from getPattern after initialize", () => {
    const { mockCtx } = mockCreateElement();
    const gen = new GrainTextureGenerator();
    gen.initialize();

    // Create a mock rendering context to pass to getPattern
    const renderCtx = {
      createPattern: jest.fn().mockReturnValue({ setTransform: jest.fn() }),
    } as unknown as CanvasRenderingContext2D;

    const pattern = gen.getPattern(renderCtx);
    expect(pattern).not.toBeNull();
    expect(renderCtx.createPattern).toHaveBeenCalled();
  });

  it("returns null from getPattern before initialize", () => {
    const gen = new GrainTextureGenerator();
    const renderCtx = {
      createPattern: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    const pattern = gen.getPattern(renderCtx);
    expect(pattern).toBeNull();
    expect(renderCtx.createPattern).not.toHaveBeenCalled();
  });

  it("cleans up on destroy", () => {
    mockCreateElement();
    const gen = new GrainTextureGenerator();
    gen.initialize();
    expect(gen.isInitialized()).toBe(true);

    gen.destroy();
    expect(gen.isInitialized()).toBe(false);

    const renderCtx = {
      createPattern: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    expect(gen.getPattern(renderCtx)).toBeNull();
  });
});
