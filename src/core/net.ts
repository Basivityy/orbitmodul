import { lookup } from "dns/promises";
import { isIP } from "net";

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

/**
 * Guards outbound requests to reseller-supplied URLs (SSRF protection): the host must
 * resolve only to public addresses. Set ALLOW_PRIVATE_PANEL_URLS=true for LAN panels.
 */
// Hosts already checked recently: an import makes tens of thousands of calls to the same panel,
// one DNS lookup every few minutes is enough.
const publicHostCache = new Map<string, number>();
const PUBLIC_HOST_TTL_MS = 5 * 60_000;

export async function assertPublicUrl(url: string, allowPrivate = process.env.ALLOW_PRIVATE_PANEL_URLS === "true"): Promise<void> {
  if (allowPrivate) return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if ((publicHostCache.get(host) ?? 0) > Date.now()) return;
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => {
    throw new Error(`Cannot resolve host ${host}`);
  });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error(`The address ${host} points to a private or internal network and is not allowed.`);
  }
  if (publicHostCache.size > 500) publicHostCache.clear();
  publicHostCache.set(host, Date.now() + PUBLIC_HOST_TTL_MS);
}
