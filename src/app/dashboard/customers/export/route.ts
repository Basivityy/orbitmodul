import type { Prisma } from "@prisma/client";
import { decrypt } from "@/core/crypto";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { lineOrderBy, lineWhere, parseLineFilter } from "@/core/lineFilters";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** CSV of the Customers list with the same filters (type, status, package, connections, search). */
export async function GET(req: Request) {
  const { reseller } = await requireReseller();
  const f = parseLineFilter(Object.fromEntries(new URL(req.url).searchParams));
  const now = new Date();
  const rows = await db.subscription.findMany({
    where: lineWhere(reseller.id, f, now) as Prisma.SubscriptionWhereInput,
    orderBy: lineOrderBy(f.sort) as Prisma.SubscriptionOrderByWithRelationInput[],
    include: { customer: { select: { email: true, name: true, phone: true } }, package: { select: { name: true, maxConnections: true } } },
    take: 50_000,
  });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    "username,password,type,status,trial,expires,connections,package,email,name,phone,notes,panel_line_id",
    ...rows.map((s) => {
      const active = s.status === "ACTIVE" && (!s.expiresAt || s.expiresAt > now);
      return [s.lineUsername, s.linePasswordEnc ? decrypt(s.linePasswordEnc) : "", s.panelKind, active ? (s.expiresAt ? "active" : "no expiry") : "inactive", s.panelTrial ? "yes" : "", s.expiresAt?.toISOString().slice(0, 10) ?? "", s.maxConnections ?? s.package.maxConnections, s.package.name, isPlaceholderEmail(s.customer.email) ? "" : s.customer.email, s.customer.name, s.customer.phone ? `+${s.customer.phone}` : "", s.panelNotes, s.xuiLineId]
        .map(esc)
        .join(",");
    }),
  ];
  return new Response("﻿" + lines.join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lines-${f.kind}-${f.status}.csv"` } });
}
