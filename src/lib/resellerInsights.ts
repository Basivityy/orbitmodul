import { db } from "./db";

/** Statistics page: months, packages, renewal rate. Test lines are left out everywhere. */
export interface MonthRow {
  month: string; // "2026-10"
  newLines: number;
  renewals: number;
  revenue: Record<string, number>;
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export async function insights(resellerId: string, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const [orders, money, renewals90, churned90, active, perPkg] = await Promise.all([
    db.$queryRaw<Array<{ m: Date; kind: string; n: bigint }>>`SELECT date_trunc('month', o."updatedAt") AS m, o."kind"::text AS kind, COUNT(*) AS n FROM "Order" o LEFT JOIN "Subscription" s ON s."id" = o."subscriptionId" WHERE o."resellerId" = ${resellerId} AND o."status" = 'COMPLETED' AND o."updatedAt" >= ${since} AND COALESCE(s."isTest", false) = false GROUP BY 1, 2`,
    db.$queryRaw<Array<{ m: Date; currency: string; s: bigint | number | null }>>`SELECT date_trunc('month', "createdAt") AS m, "currency", SUM("amountCents") AS s FROM "Transaction" WHERE "resellerId" = ${resellerId} AND "status" = 'SUCCEEDED' AND "createdAt" >= ${since} GROUP BY 1, 2`,
    db.order.count({ where: { resellerId, kind: "RENEWAL", status: "COMPLETED", updatedAt: { gte: d90 }, subscription: { isTest: false } } }),
    db.subscription.count({ where: { resellerId, isTest: false, status: "EXPIRED", expiresAt: { gte: d90, lt: now } } }),
    db.subscription.count({ where: { resellerId, isTest: false, status: "ACTIVE" } }),
    db.order.groupBy({ by: ["packageId", "currency"], where: { resellerId, status: "COMPLETED", updatedAt: { gte: d90 } }, _count: { _all: true }, _sum: { amountCents: true } }),
  ]);
  const months: MonthRow[] = [];
  for (let i = 0; i < 12; i++) months.push({ month: monthKey(new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1))), newLines: 0, renewals: 0, revenue: {} });
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const o of orders) {
    const row = byMonth.get(monthKey(new Date(o.m)));
    if (!row) continue;
    if (o.kind === "RENEWAL") row.renewals += Number(o.n);
    else row.newLines += Number(o.n);
  }
  for (const t of money) {
    const row = byMonth.get(monthKey(new Date(t.m)));
    if (row) row.revenue[t.currency] = (row.revenue[t.currency] ?? 0) + Number(t.s ?? 0);
  }
  const names = new Map((await db.package.findMany({ where: { id: { in: perPkg.map((p) => p.packageId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const packages = perPkg
    .map((p) => ({ name: names.get(p.packageId) ?? "—", currency: p.currency, orders: p._count._all, revenue: p._sum.amountCents ?? 0 }))
    .sort((a, b) => b.orders - a.orders);
  const decided = renewals90 + churned90;
  return { months, packages, active, renewals90, churned90, renewalRate: decided ? Math.round((renewals90 / decided) * 100) : null };
}
