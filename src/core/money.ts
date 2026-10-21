export const SUPPORTED_CURRENCIES = [
  "EUR", "USD", "GBP", "CHF", "BAM", "RSD", "HRK", "AED", "SAR", "TRY", "PLN", "CZK", "HUF", "RON", "BGN",
  "SEK", "NOK", "DKK", "CAD", "AUD", "NZD", "JPY",
] as const;

/** Currencies without minor units (amount stored as whole units). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"]);

export function minorUnits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function isSupportedCurrency(c: string): boolean {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(c.toUpperCase());
}

/** "10.50" -> 1050 (EUR), "1000" -> 1000 (JPY). Returns null for invalid input. */
export function parseAmountToMinor(input: string, currency: string): number | null {
  const s = String(input).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const digits = minorUnits(currency);
  if (digits === 0) return s.includes(".") ? null : parseInt(s, 10);
  const [whole, frac = ""] = s.split(".");
  return parseInt(whole, 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
}

/** 1050 EUR -> "10.50" (decimal string for provider APIs). */
export function minorToDecimalString(amount: number, currency: string): string {
  const digits = minorUnits(currency);
  if (digits === 0) return String(amount);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatMoney(amount: number, currency: string, locale = "en-GB"): string {
  const digits = minorUnits(currency);
  const value = digits === 0 ? amount : amount / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: digits }).format(value);
  } catch {
    return `${minorToDecimalString(amount, currency)} ${currency.toUpperCase()}`;
  }
}
