/** Validates the platform address entered by the Super Admin: http(s)://host[:port], no path. */
export function normalizePublicUrl(input: string): { url: string | null; error?: string } {
  const raw = input.trim();
  if (!raw) return { url: null };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { url: null, error: "Enter an address like https://billing.yourdomain.com" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { url: null, error: "The address must start with http:// or https://" };
  if (u.pathname !== "/" || u.search || u.hash) return { url: null, error: "Enter only the domain, without a path (e.g. https://billing.yourdomain.com)." };
  if (!/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes(".")) return { url: null, error: "Enter a valid domain." };
  return { url: `${u.protocol}//${u.host.toLowerCase()}` };
}
