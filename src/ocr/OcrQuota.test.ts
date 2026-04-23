import { DEFAULT_SETTINGS } from "../settings/PaperSettings";
import {
  currentMonthKey,
  resetMonthlyCounterIfNeeded,
  checkQuota,
  incrementCounter,
  capRemaining,
} from "./OcrQuota";

describe("OcrQuota", () => {
  describe("currentMonthKey", () => {
    it("formats YYYY-MM with leading zero", () => {
      expect(currentMonthKey(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01");
      expect(currentMonthKey(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12");
    });
  });

  describe("resetMonthlyCounterIfNeeded", () => {
    it("returns null when month hasn't changed", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthKey: "2026-04", ocrCallsThisMonth: 100 };
      const now = new Date(Date.UTC(2026, 3, 15));
      expect(resetMonthlyCounterIfNeeded(s, now)).toBeNull();
    });

    it("returns reset patch when month has advanced", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthKey: "2026-03", ocrCallsThisMonth: 500 };
      const now = new Date(Date.UTC(2026, 3, 1));
      expect(resetMonthlyCounterIfNeeded(s, now)).toEqual({
        ocrCallsThisMonth: 0,
        ocrMonthKey: "2026-04",
      });
    });

    it("returns reset patch on first use (empty monthKey)", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthKey: "", ocrCallsThisMonth: 0 };
      const now = new Date(Date.UTC(2026, 3, 15));
      expect(resetMonthlyCounterIfNeeded(s, now)?.ocrMonthKey).toBe("2026-04");
    });
  });

  describe("checkQuota", () => {
    it("allows when well under cap", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthlyCap: 1000, ocrCallsThisMonth: 10 };
      expect(checkQuota(s, 5)).toEqual({ ok: true, remainingAfter: 985 });
    });

    it("denies when cap would be exceeded", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthlyCap: 100, ocrCallsThisMonth: 95 };
      const result = checkQuota(s, 10);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("cap");
    });

    it("treats cap=0 as unlimited", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthlyCap: 0, ocrCallsThisMonth: 10000 };
      expect(checkQuota(s, 5000).ok).toBe(true);
    });

    it("pageCount=0 is always allowed", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthlyCap: 100, ocrCallsThisMonth: 100 };
      expect(checkQuota(s, 0).ok).toBe(true);
    });

    it("allows exactly at cap boundary", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthlyCap: 100, ocrCallsThisMonth: 95 };
      expect(checkQuota(s, 5)).toEqual({ ok: true, remainingAfter: 0 });
    });
  });

  describe("incrementCounter", () => {
    it("returns patch with new count", () => {
      const s = { ...DEFAULT_SETTINGS, ocrCallsThisMonth: 10 };
      expect(incrementCounter(s, 3)).toEqual({ ocrCallsThisMonth: 13 });
    });
  });

  describe("capRemaining", () => {
    it("returns Infinity when cap is 0", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthlyCap: 0 };
      expect(capRemaining(s)).toBe(Infinity);
    });

    it("returns diff when counter under cap", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthlyCap: 100, ocrCallsThisMonth: 30 };
      expect(capRemaining(s)).toBe(70);
    });

    it("returns 0 (not negative) when over cap", () => {
      const s = { ...DEFAULT_SETTINGS, ocrMonthlyCap: 100, ocrCallsThisMonth: 200 };
      expect(capRemaining(s)).toBe(0);
    });
  });
});
