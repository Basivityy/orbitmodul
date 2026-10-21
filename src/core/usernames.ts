import { randomInt } from "crypto";

/**
 * Usernames chosen by customers at checkout: 8–30 characters, only letters and digits,
 * and a combination of both (at least one letter and one digit).
 */
export const CUSTOMER_USERNAME_RULE = "8–30 characters, letters and numbers only, with at least one letter and one number";

export function customerUsernameError(u: string): string | null {
  if (!u) return "Choose a username.";
  if (u.length < 8) return "The username must have at least 8 characters.";
  if (u.length > 30) return "The username can have at most 30 characters.";
  if (!/^[A-Za-z0-9]+$/.test(u)) return "Use only letters and numbers (no spaces or symbols).";
  if (!/[A-Za-z]/.test(u) || !/[0-9]/.test(u)) return "The username must combine letters and numbers (e.g. marko2026).";
  return null;
}

/** "billingtest3" → "bil•••st3": recognisable for the owner, not useful to others. */
export function maskUsername(u: string): string {
  if (u.length <= 4) return u[0] + "•••";
  const head = Math.min(3, Math.floor(u.length / 3));
  const tail = Math.min(3, Math.floor(u.length / 3));
  return `${u.slice(0, head)}•••${u.slice(u.length - tail)}`;
}

/** Alternative when the chosen username already exists on the panel: two random digits appended. */
export function alternativeUsername(u: string): string {
  return `${u.slice(0, 28)}${String(randomInt(10, 100))}`;
}

/** Panel answers that mean "this username is taken" (admin: "Username exists", reseller: STATUS_EXISTS_USERNAME). */
export function isUsernameTakenError(message: string): boolean {
  return /exist|taken|already|duplicate/i.test(message);
}
