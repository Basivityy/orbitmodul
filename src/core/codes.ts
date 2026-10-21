import { randomInt } from "crypto";

/**
 * Activation codes: 12 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
 * shown as XXXX-XXXX-XXXX. 30^12 ≈ 5·10^17 combinations — not guessable, and redeem
 * attempts are rate-limited on top.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ2345679";

export function generateCode(): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** Accepts what customers type: lower case, spaces, missing or extra dashes. */
export function normalizeCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 12) return null;
  if ([...raw].some((c) => !ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
