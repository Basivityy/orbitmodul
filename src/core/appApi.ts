/** Pure helpers for the customer app API (activation-code login). */

/** Address the player connects to: the panel's streaming URL (DNS), else the API host. */
export function streamServer(panel: { streamUrl: string | null; apiUrl: string }): string {
  const raw = (panel.streamUrl ?? "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  try {
    const u = new URL(panel.apiUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return panel.apiUrl;
  }
}

/** Devices one code may be used on = connections of the package (at least 1). */
export function deviceLimit(maxConnections: number | null | undefined): number {
  return Math.max(1, Math.floor(maxConnections ?? 1));
}

/** Device ids sent by apps: 6–128 safe characters (Android ID, UUID, MAC…). */
export function validDeviceId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9:._-]{6,128}$/.test(id);
}

/** Placeholder customer email for lines created from the app (no email is asked). */
export function appCustomerEmail(code: string): string {
  return `app-${code.replace(/-/g, "").toLowerCase()}@imported.invalid`;
}
