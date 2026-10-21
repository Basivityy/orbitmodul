import { db } from "./db";

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

function startOfDayUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfMonthUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

async function revenueByCurrency(where: { resellerId?: string; since?: Date }): Promise<CurrencyTotal[]> {
  const rows = await db.transaction.groupBy({
    by: ["currency"],
    where: { status: "SUCCEEDED", ...(where.resellerId ? { resellerId: where.resellerId } : {}), ...(where.since ? { createdAt: { gte: where.since } } : {}) },
    _sum: { amountCents: true },
  });
  return rows.map((r) => ({ currency: r.currency, amount: r._sum.amountCents ?? 0 })).sort((a, b) => b.amount - a.amount);
}

/** Daily revenue for the last `days` days in one currency (zero-filled). */
export async function dailyRevenue(currency: string, days: number, resellerId?: string): Promise<Array<{ label: string; value: number }>> {
  const since = new Date(startOfDayUTC().getTime() - (days - 1) * 86_400_000);
  const rows: Array<{ d: Date; s: bigint | number | null }> = resellerId
    ? await db.$queryRaw`SELECT date_trunc('day', "createdAt") AS d, SUM("amountCents") AS s FROM "Transaction" WHERE "resellerId" = ${resellerId} AND "currency" = ${currency} AND "status" = 'SUCCEEDED' AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`
    : await db.$queryRaw`SELECT date_trunc('day', "createdAt") AS d, SUM("amountCents") AS s FROM "Transaction" WHERE "currency" = ${currency} AND "status" = 'SUCCEEDED' AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`;
  const map = new Map(rows.map((r) => [new Date(r.d).toISOString().slice(0, 10), Number(r.s ?? 0)]));
  const out: Array<{ label: string; value: number }> = [];
  for (let i = 0; i < days; i++) {
    const key = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ label: key.slice(5), value: map.get(key) ?? 0 });
  }
  return out;
}

export async function resellerStats(resellerId: string) {
  const now = new Date();
  const [total, today, month, activeSubs, activeCustomerRows, expiring, failedPayments, failedActivations, top] = await Promise.all([
    revenueByCurrency({ resellerId }),
    revenueByCurrency({ resellerId, since: startOfDayUTC(now) }),
    revenueByCurrency({ resellerId, since: startOfMonthUTC(now) }),
    db.subscription.count({ where: { resellerId, status: "ACTIVE" } }),
    db.subscription.findMany({ where: { resellerId, status: "ACTIVE" }, distinct: ["customerId"], select: { customerId: true } }),
    db.subscription.findMany({
      where: { resellerId, status: "ACTIVE", expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) } },
      include: { customer: true, package: true },
      orderBy: { expiresAt: "asc" },
      take: 8,
    }),
    db.order.count({ where: { resellerId, status: "FAILED", createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
    db.order.count({ where: { resellerId, status: { in: ["ACTIVATION_FAILED", "ON_HOLD"] } } }),
    db.order.groupBy({ by: ["packageId"], where: { resellerId, status: "COMPLETED" }, _count: { _all: true }, _sum: { amountCents: true }, orderBy: { _count: { packageId: "desc" } }, take: 5 }),
  ]);
  const pkgNames = await db.package.findMany({ where: { id: { in: top.map((t) => t.packageId) } }, select: { id: true, name: true, currency: true } });
  return {
    total,
    today,
    month,
    activeSubs,
    activeCustomers: activeCustomerRows.length,
    expiring,
    expiringCount: await db.subscription.count({ where: { resellerId, status: "ACTIVE", expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) } } }),
    failedPayments,
    failedActivations,
    topPackages: top.map((t) => ({ name: pkgNames.find((p) => p.id === t.packageId)?.name ?? "—", currency: pkgNames.find((p) => p.id === t.packageId)?.currency ?? "EUR", count: t._count._all, revenue: t._sum.amountCents ?? 0 })),
  };
}

export async function platformStats() {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const [resellers, suspended, activeSubs, gmv30, failedActivations, apiErrors24h, saas] = await Promise.all([
    db.reseller.count(),
    db.reseller.count({ where: { status: "SUSPENDED" } }),
    db.subscription.count({ where: { status: "ACTIVE" } }),
    revenueByCurrency({ since: since30 }),
    db.order.count({ where: { status: { in: ["ACTIVATION_FAILED", "ON_HOLD"] } } }),
    db.apiLog.count({ where: { success: false, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    db.saasSubscription.findMany({ where: { status: { in: ["ACTIVE", "PAST_DUE"] } }, include: { plan: true } }),
  ]);
  const mrr = new Map<string, number>();
  for (const s of saas) {
    const monthly = s.plan.interval === "YEAR" ? Math.round(s.plan.priceCents / 12) : s.plan.priceCents;
    mrr.set(s.plan.currency, (mrr.get(s.plan.currency) ?? 0) + monthly);
  }
  const trialing = await db.saasSubscription.count({ where: { status: "TRIALING", trialEndsAt: { gt: now } } });
  return {
    resellers,
    suspended,
    activeSubs,
    gmv30,
    failedActivations,
    apiErrors24h,
    payingResellers: saas.length,
    trialing,
    mrr: Array.from(mrr.entries()).map(([currency, amount]) => ({ currency, amount })),
  };
}
