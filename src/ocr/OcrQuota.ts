import type { PaperSettings } from "../settings/PaperSettings";

/** Current UTC "YYYY-MM" key, used to reset monthly counters. */
export function currentMonthKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Returns a settings patch that resets the OCR counter if a new month has begun.
 * Returns null if no reset needed.
 */
export function resetMonthlyCounterIfNeeded(
  settings: PaperSettings,
  now: Date = new Date(),
): Partial<PaperSettings> | null {
  const monthKey = currentMonthKey(now);
  if (settings.ocrMonthKey === monthKey) return null;
  return { ocrCallsThisMonth: 0, ocrMonthKey: monthKey };
}

export interface QuotaCheckResult {
  ok: boolean;
  reason?: string;
  remainingAfter?: number;
}

/**
 * Check whether `pageCount` more OCR pages fit within the monthly cap.
 * A cap of 0 (or negative) is treated as unlimited.
 */
export function checkQuota(
  settings: PaperSettings,
  pageCount: number,
): QuotaCheckResult {
  if (pageCount <= 0) return { ok: true, remainingAfter: capRemaining(settings) };
  if (settings.ocrMonthlyCap <= 0) return { ok: true };
  const after = settings.ocrCallsThisMonth + pageCount;
  if (after > settings.ocrMonthlyCap) {
    return {
      ok: false,
      reason: `Monthly OCR cap would be exceeded (${after}/${settings.ocrMonthlyCap} pages).`,
    };
  }
  return { ok: true, remainingAfter: settings.ocrMonthlyCap - after };
}

export function capRemaining(settings: PaperSettings): number {
  if (settings.ocrMonthlyCap <= 0) return Infinity;
  return Math.max(0, settings.ocrMonthlyCap - settings.ocrCallsThisMonth);
}

/** Increment the counter by `n`. Returns a settings patch to apply. */
export function incrementCounter(
  settings: PaperSettings,
  n: number,
): Partial<PaperSettings> {
  return { ocrCallsThisMonth: settings.ocrCallsThisMonth + n };
}
