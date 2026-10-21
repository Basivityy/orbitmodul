/**
 * Lines imported from a panel (or added by hand without an email) have no email. Their customer gets a placeholder address on the
 * reserved `.invalid` domain (RFC 2606): never deliverable, never shown as a real email, and
 * replaced by the real email the first time the customer pays on the store.
 */
export const IMPORTED_EMAIL_DOMAIN = "imported.invalid";

export function placeholderEmail(lineUsername: string): string {
  const local = lineUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "_").slice(0, 60) || "line";
  return `${local}@${IMPORTED_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${IMPORTED_EMAIL_DOMAIN}`);
}

/** What the reseller sees instead of a placeholder email. */
export function displayCustomer(email: string, lineUsername?: string | null): string {
  return isPlaceholderEmail(email) ? `${lineUsername ?? email.split("@")[0]} (no email)` : email;
}

/** Hidden package that lines loaded from the panel are attached to ("Load existing line"). Not for sale. */
export const IMPORT_PACKAGE_NAME = "Existing line (loaded from panel)";
