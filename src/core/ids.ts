import { randomInt } from "crypto";

const LOWER = "abcdefghjkmnpqrstuvwxyz";
const ALNUM = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function pick(alphabet: string, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

/** XUI-safe username: optional prefix + letters/digits, no ambiguous characters. */
export function generateLineUsername(prefix = ""): string {
  const p = prefix.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
  return p + pick(LOWER, 2) + pick("23456789" + LOWER, 8);
}

export function generateLinePassword(len = 10): string {
  return pick(ALNUM, len);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const RESERVED_SLUGS = new Set(["admin", "api", "dashboard", "login", "register", "store", "static", "www", "app", "billing", "support", "help"]);

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Human-friendly unique order number, e.g. ORD-20261011-K7M2Q9 */
export function orderNumber(prefix = "ORD", now = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${d}-${pick("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6)}`;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}
