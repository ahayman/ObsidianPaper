import { OneEuroFilter, EMAFilter } from "./OneEuroFilter";

describe("OneEuroFilter", () => {
  it("should return the first value unfiltered", () => {
    const filter = new OneEuroFilter();
    expect(filter.filter(100, 0)).toBe(100);
  });

  it("should smooth jittery input at low speed", () => {
    const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007 });

    // Simulate slow movement with jitter
    const timestamps = [0, 8, 16, 24, 32, 40, 48, 56]; // ~120Hz
    const values = [100, 101, 99, 100.5, 99.5, 100.2, 99.8, 100.1];

    const filtered: number[] = [];
    for (let i = 0; i < values.length; i++) {
      filtered.push(filter.filter(values[i], timestamps[i]));
    }

    // Filtered values should have less variance than input
    const inputVariance = variance(values);
    const filteredVariance = variance(filtered);
    expect(filteredVariance).toBeLessThan(inputVariance);
  });

  it("should have less lag at high speed", () => {
    const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 0.1 });

    // Fast movement: large deltas
    let filteredFast = 0;
    for (let i = 0; i < 20; i++) {
      filteredFast = filter.filter(i * 50, i * 8);
    }

    // The filtered value should track reasonably close to the actual value
    const actual = 19 * 50; // 950
    const lag = Math.abs(actual - filteredFast);
    expect(lag).toBeLessThan(actual * 0.3); // Within 30% of target
  });

  it("should reset properly", () => {
    const filter = new OneEuroFilter();
    filter.filter(100, 0);
    filter.filter(200, 16);

    filter.reset();

    // After reset, should behave like fresh filter
    const result = filter.filter(500, 100);
    expect(result).toBe(500);
  });

  it("should handle same timestamp gracefully", () => {
    const filter = new OneEuroFilter();
    filter.filter(100, 0);
    const result = filter.filter(200, 0); // Same timestamp
    // Should return last filtered value, not crash
    expect(typeof result).toBe("number");
    expect(isFinite(result)).toBe(true);
  });
});

describe("EMAFilter", () => {
  it("should return first value unfiltered", () => {
    const filter = new EMAFilter(0.3);
    expect(filter.filter(0.5)).toBe(0.5);
  });

  it("should smooth values over time", () => {
    const filter = new EMAFilter(0.3);
    filter.filter(1.0);
    const result = filter.filter(0.0);

    // EMA: alpha * 0.0 + (1-alpha) * 1.0 = 0.7
    expect(result).toBeCloseTo(0.7, 5);
  });

  it("should converge to constant input", () => {
    const filter = new EMAFilter(0.3);
    let result = 0;
    for (let i = 0; i < 50; i++) {
      result = filter.filter(1.0);
    }
    expect(result).toBeCloseTo(1.0, 3);
  });

  it("should reset properly", () => {
    const filter = new EMAFilter(0.3);
    filter.filter(100);
    filter.filter(200);

    filter.reset();

    expect(filter.filter(500)).toBe(500);
  });
});

function variance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  );
}
