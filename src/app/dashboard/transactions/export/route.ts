import { minorToDecimalString } from "@/core/money";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function csvCell(v: string): string {
  // Prevent CSV formula injection in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "RESELLER") return new Response("Unauthorized", { status: 401 });
  const reseller = await db.reseller.findUnique({ where: { ownerUserId: user.id } });
  if (!reseller || reseller.status !== "ACTIVE") return new Response("Forbidden", { status: 403 });
  const rows = await db.transaction.findMany({ where: { resellerId: reseller.id }, include: { order: { include: { customer: true } } }, orderBy: { createdAt: "desc" }, take: 50_000 });
  const lines = [["date", "order", "customer", "type", "gateway", "reference", "amount", "currency"].join(",")];
  for (const t of rows) {
    lines.push([t.createdAt.toISOString(), t.order?.number ?? "", t.order?.customer.email ?? "", t.type, t.provider, t.providerRef ?? "", minorToDecimalString(t.amountCents, t.currency), t.currency].map(csvCell).join(","));
  }
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
