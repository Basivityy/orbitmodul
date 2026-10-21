import { getSetting, setSetting } from "./settings";

/**
 * Public address of the platform (e.g. https://billing.yourdomain.com), set by the Super Admin.
 * It replaces APP_URL (often the server IP) in every generated link: store, activation links,
 * emails, webhooks, app API. Kept in a process-wide cache so env.appUrl can stay synchronous.
 */
export const SETTING_PUBLIC_URL = "public_url";
const g = globalThis as unknown as { __publicUrl?: string | null; __publicUrlAt?: number };

export function cachedPublicUrl(): string | null {
  return g.__publicUrl ?? null;
}

export async function refreshPublicUrl(maxAgeMs = 30_000): Promise<string | null> {
  // No database while `next build` prerenders pages — keep APP_URL.
  if (process.env.NEXT_PHASE === "phase-production-build" || !process.env.DATABASE_URL) return g.__publicUrl ?? null;
  if (g.__publicUrlAt && Date.now() - g.__publicUrlAt < maxAgeMs) return g.__publicUrl ?? null;
  try {
    const v = await getSetting<string | null>(SETTING_PUBLIC_URL, null);
    g.__publicUrl = v || null;
    g.__publicUrlAt = Date.now();
  } catch {
    /* database not ready — keep the previous value */
  }
  return g.__publicUrl ?? null;
}

export async function savePublicUrl(url: string | null): Promise<void> {
  await setSetting(SETTING_PUBLIC_URL, url);
  g.__publicUrl = url;
  g.__publicUrlAt = Date.now();
}
