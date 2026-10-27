/**
 * Filters of the reseller's Customers list (shared by the page and its CSV export).
 * Plain objects in Prisma's where-shape, no Prisma import, so they can be unit-tested.
 */
export const KINDS = ["line", "mag", "enigma", "restreamer", "any"] as const;
export const STATUSES = ["all", "active", "unlimited", "trial", "expiring", "inactive"] as const;
export const SORTS = ["expiry_desc", "expiry_asc", "newest", "username"] as const;

export type Kind = (typeof KINDS)[number];
export type LineStatus = (typeof STATUSES)[number];
export type Sort = (typeof SORTS)[number];

export interface LineFilter {
  kind: Kind;
  status: LineStatus;
  q: string;
  pkg: string;
  conn: number | null;
  sort: Sort;
}

const pick = <T extends readonly string[]>(list: T, v: string | undefined, fallback: T[number]): T[number] => ((list as readonly string[]).includes(v ?? "") ? (v as T[number]) : fallback);

export function parseLineFilter(sp: Record<string, string | undefined>): LineFilter {
  const conn = Number(sp.conn);
  // Old links (?show=…) keep working.
  const legacy = sp.show === "devices" ? { kind: "any" } : sp.show && sp.show !== "all" ? { status: sp.show } : {};
  return {
    kind: pick(KINDS, sp.kind ?? (legacy as { kind?: string }).kind, "line"),
    status: pick(STATUSES, sp.status ?? (legacy as { status?: string }).status, "all"),
    q: (sp.q ?? "").trim().slice(0, 100),
    pkg: /^[a-z0-9]{10,40}$/i.test(sp.pkg ?? "") ? sp.pkg! : "",
    conn: Number.isInteger(conn) && conn > 0 && conn < 100 ? conn : null,
    sort: pick(SORTS, sp.sort, "expiry_desc"),
  };
}

type W = Record<string, unknown>;

/** Lines of the reseller (deleted-on-panel and test lines never listed). */
export function baseWhere(resellerId: string): W {
  return { resellerId, isTest: false, status: { not: "CANCELED" } };
}

export function kindWhere(kind: Kind): W {
  return kind === "any" ? {} : { panelKind: kind };
}

/** Same meaning as the panel: active = on and a future expiry; no expiry, trial and inactive apart. */
export function statusWhere(status: LineStatus, now = new Date()): W {
  const day = 86_400_000;
  switch (status) {
    case "active":
      return { status: "ACTIVE", panelTrial: false, expiresAt: { gt: now } };
    case "unlimited":
      return { status: "ACTIVE", panelTrial: false, expiresAt: null };
    case "trial":
      return { status: "ACTIVE", panelTrial: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    case "expiring":
      return { status: "ACTIVE", expiresAt: { gt: now, lte: new Date(now.getTime() + 7 * day) } };
    case "inactive":
      return { NOT: { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } };
    default:
      return {};
  }
}

export function extraWhere(f: Pick<LineFilter, "q" | "pkg" | "conn">): W[] {
  const out: W[] = [];
  if (f.q) out.push({ OR: [{ lineUsername: { contains: f.q, mode: "insensitive" } }, { customer: { email: { contains: f.q, mode: "insensitive" } } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }, { panelNotes: { contains: f.q, mode: "insensitive" } }] });
  if (f.pkg) out.push({ packageId: f.pkg });
  if (f.conn) out.push({ OR: [{ maxConnections: f.conn }, { maxConnections: null, package: { maxConnections: f.conn } }] });
  return out;
}

export function lineWhere(resellerId: string, f: LineFilter, now = new Date()): W {
  return { AND: [baseWhere(resellerId), kindWhere(f.kind), statusWhere(f.status, now), ...extraWhere(f)] };
}

export function lineOrderBy(sort: Sort): W[] {
  switch (sort) {
    case "expiry_asc":
      return [{ expiresAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
    case "newest":
      return [{ createdAt: "desc" }];
    case "username":
      return [{ lineUsername: "asc" }];
    default:
      return [{ expiresAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
  }
}

/** Query string for links that change one filter and keep the others. */
export function filterQuery(f: LineFilter, change: Partial<LineFilter> = {}): string {
  const n = { ...f, ...change };
  const p = new URLSearchParams();
  if (n.kind !== "line") p.set("kind", n.kind);
  if (n.status !== "all") p.set("status", n.status);
  if (n.q) p.set("q", n.q);
  if (n.pkg) p.set("pkg", n.pkg);
  if (n.conn) p.set("conn", String(n.conn));
  if (n.sort !== "expiry_desc") p.set("sort", n.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}
