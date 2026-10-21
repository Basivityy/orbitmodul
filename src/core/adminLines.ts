/**
 * Admin overview of every customer line on the platform (all resellers). Read-only filters shared by
 * the "All customers & lines" page and its CSV export, so both always show the same rows.
 */
export const LINE_STATUSES = ["ACTIVE", "EXPIRED", "SUSPENDED", "PENDING", "CANCELED"] as const;
export const MP_FILTERS = ["ACTIVE", "FAILED", "PENDING", "NONE", "SIMULATED"] as const;

export interface LineFilters {
  q: string;
  reseller: string;
  status: (typeof LINE_STATUSES)[number] | "EXPIRING" | "";
  mp: (typeof MP_FILTERS)[number] | "";
  test: "hide" | "only" | "";
}

export function parseLineFilters(sp: Record<string, string | undefined>): LineFilters {
  const status = sp.status === "EXPIRING" ? "EXPIRING" : LINE_STATUSES.find((s) => s === sp.status) ?? "";
  return {
    q: (sp.q ?? "").trim().slice(0, 100),
    reseller: /^[a-z0-9]{10,40}$/i.test(sp.reseller ?? "") ? sp.reseller! : "",
    status,
    mp: MP_FILTERS.find((m) => m === sp.mp) ?? "",
    test: sp.test === "only" ? "only" : sp.test === "show" ? "" : "hide",
  };
}

/** Prisma `where` for subscriptions (kept free of the Prisma import so it can be unit-tested). */
export type LineWhere = Record<string, any>;

export function lineWhere(f: LineFilters, now = new Date()): LineWhere {
  const and: LineWhere[] = [];
  if (f.q) {
    const c = { contains: f.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { lineUsername: c },
        { customer: { email: c } },
        { customer: { name: c } },
        { reseller: { storeName: c } },
        { reseller: { owner: { email: c } } },
        { maxPlayerUserId: { contains: f.q } },
      ],
    });
  }
  if (f.reseller) and.push({ resellerId: f.reseller });
  if (f.status === "EXPIRING") and.push({ status: "ACTIVE", expiresAt: { gt: now, lt: new Date(now.getTime() + 7 * 86_400_000) } });
  else if (f.status) and.push({ status: f.status });
  if (f.mp === "SIMULATED") and.push({ maxPlayerUserId: { startsWith: "TEST-" } });
  else if (f.mp) and.push({ maxPlayerStatus: f.mp });
  if (f.test === "hide") and.push({ isTest: false });
  if (f.test === "only") and.push({ isTest: true });
  return and.length ? { AND: and } : {};
}

/** Query string of the active filters (for pagination and the export link). */
export function filterQuery(f: LineFilters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.reseller) p.set("reseller", f.reseller);
  if (f.status) p.set("status", f.status);
  if (f.mp) p.set("mp", f.mp);
  if (f.test === "only") p.set("test", "only");
  if (f.test === "") p.set("test", "show");
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
