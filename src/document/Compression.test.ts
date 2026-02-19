import {
  compressString,
  decompressString,
  estimateStrokeDataSize,
  COMPRESSION_THRESHOLD,
} from "./Compression";

describe("Compression", () => {
  it("should round-trip compress and decompress a string", () => {
    const input = "Hello, this is a test string for compression!";
    const compressed = compressString(input);
    const decompressed = decompressString(compressed);
    expect(decompressed).toBe(input);
  });

  it("should handle empty string", () => {
    const compressed = compressString("");
    const decompressed = decompressString(compressed);
    expect(decompressed).toBe("");
  });

  it("should handle large repetitive data efficiently", () => {
    const input = "0,0,128,0,0,0,0;".repeat(1000);
    const compressed = compressString(input);

    // Compressed should be significantly smaller than original
    expect(compressed.length).toBeLessThan(input.length);

    const decompressed = decompressString(compressed);
    expect(decompressed).toBe(input);
  });

  it("should handle unicode characters", () => {
    const input = "x:10,y:20,\u00e9\u00e8\u00ea";
    const compressed = compressString(input);
    const decompressed = decompressString(compressed);
    expect(decompressed).toBe(input);
  });

  it("should produce Base64 output", () => {
    const input = "test data";
    const compressed = compressString(input);
    // Base64 only contains A-Z, a-z, 0-9, +, /, =
    expect(compressed).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("should handle typical stroke pts data", () => {
    // Simulate delta-encoded stroke points
    const segments: string[] = [];
    for (let i = 0; i < 500; i++) {
      segments.push(`${i},${i * 2},128,0,0,0,${i * 16}`);
    }
    const input = segments.join(";");
    const compressed = compressString(input);
    const decompressed = decompressString(compressed);
    expect(decompressed).toBe(input);
  });

  describe("estimateStrokeDataSize", () => {
    it("should return 0 for empty array", () => {
      expect(estimateStrokeDataSize([])).toBe(0);
    });

    it("should sum the lengths of all pts strings", () => {
      const pts = ["abc", "defgh", "ij"];
      expect(estimateStrokeDataSize(pts)).toBe(10);
    });

    it("should handle single-element array", () => {
      expect(estimateStrokeDataSize(["hello"])).toBe(5);
    });
  });

  it("should export COMPRESSION_THRESHOLD as a positive number", () => {
    expect(COMPRESSION_THRESHOLD).toBeGreaterThan(0);
  });
});
