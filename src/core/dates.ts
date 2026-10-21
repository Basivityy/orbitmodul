export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Renewal rule: extend from the current expiry if still active, otherwise from now.
 * A customer who renews early never loses remaining days.
 */
export function computeRenewalExpiry(currentExpiry: Date | null | undefined, now: Date, durationDays: number): Date {
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  return addDays(base, durationDays);
}

export function daysUntil(date: Date, now = new Date()): number {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Pick a Stripe-compatible recurring interval for a duration in days. */
export function recurringInterval(durationDays: number): { interval: "day" | "week" | "month" | "year"; count: number } {
  if (durationDays % 365 === 0 && durationDays / 365 <= 3) return { interval: "year", count: durationDays / 365 };
  if (durationDays % 30 === 0 && durationDays / 30 <= 36) return { interval: "month", count: durationDays / 30 };
  if (durationDays % 7 === 0 && durationDays / 7 <= 156) return { interval: "week", count: durationDays / 7 };
  return { interval: "day", count: Math.min(durationDays, 365) };
}

/** Date for customer emails, e.g. "13.11.2026" — reads the same in BHS and English (UTC, locale independent). */
export function formatEmailDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getUTCDate())}.${p(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}
