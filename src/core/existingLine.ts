import type { LineInfo } from "./adapters/types";

/**
 * Checks that the line a reseller wants to load really is the one they described and that it
 * belongs to them. Returns an error message for the reseller, or null when everything matches.
 */
export function checkExistingLine(line: LineInfo | null, input: { username: string; password: string }, ownerMemberId: string | null): string | null {
  if (!line) return "No line with this ID was found on your panel.";
  if (line.username !== input.username) return "The username does not match this line ID. Check both on the panel.";
  if (line.password !== undefined && line.password !== input.password) return "The password does not match this line.";
  if (ownerMemberId && line.memberId && line.memberId !== ownerMemberId) return "This line belongs to another reseller on the panel.";
  return null;
}
