import { NextRequest, NextResponse } from "next/server";

/**
 * Custom reseller domains: any Host that is not the platform host is rewritten to the
 * store route `/store/@<host>/...`. The store page resolves the reseller by verified domain.
 * Platform-only paths (dashboard, admin, api) are not reachable on custom domains.
 */
// Platform domain set in the admin panel (read from the app itself, cached for a minute).
let extraHosts: { hosts: string[]; at: number } = { hosts: [], at: 0 };
async function platformDomains(): Promise<string[]> {
  if (Date.now() - extraHosts.at < 60_000) return extraHosts.hosts;
  try {
    const port = process.env.PORT || "3000";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const r = await fetch(`http://127.0.0.1:${port}/api/public/platform-hosts`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const j = (await r.json()) as { hosts?: string[] };
    extraHosts = { hosts: Array.isArray(j.hosts) ? j.hosts : [], at: Date.now() };
  } catch {
    extraHosts = { hosts: extraHosts.hosts, at: Date.now() - 50_000 }; // retry in ~10 s
  }
  return extraHosts.hosts;
}

export async function middleware(req: NextRequest) {
  const platformHost = (() => {
    try {
      return new URL(process.env.APP_URL || "http://localhost:3000").host;
    } catch {
      return "localhost:3000";
    }
  })();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  const bare = host.replace(/:\d+$/, "");
  const platformBare = platformHost.replace(/:\d+$/, "");
  if (!host || host === platformHost || bare === "localhost" || bare === "127.0.0.1" || bare === platformBare || bare === `www.${platformBare}`) {
    return NextResponse.next();
  }
  const domains = await platformDomains();
  if (domains.some((d) => d === host || d.replace(/:\d+$/, "") === bare)) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") return NextResponse.next();
  if (pathname.startsWith("/api/") || pathname.startsWith("/dashboard") || pathname.startsWith("/admin") || pathname.startsWith("/store/")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const url = req.nextUrl.clone();
  url.pathname = `/store/@${bare}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
