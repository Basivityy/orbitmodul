import type { Prisma } from "@prisma/client";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lineWhere, parseLineFilters } from "@/core/adminLines";

export const dynamic = "force-dynamic";

function csvCell(v: string): string {
  // Prevent CSV formula injection in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV of the admin "All customers & lines" view (same filters). No passwords. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN")) return new Response("Unauthorized", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const rows = await db.subscription.findMany({
    where: lineWhere(parseLineFilters(sp)) as Prisma.SubscriptionWhereInput,
    include: { customer: true, package: { select: { name: true } }, panel: { select: { name: true } }, reseller: { select: { storeName: true, owner: { select: { email: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 50_000,
  });
  const out = [["line_username", "customer_email", "customer_name", "owner_store", "owner_email", "package", "panel", "status", "expires_utc", "maxplayer", "maxplayer_id", "test_line", "created_utc"].join(",")];
  for (const s of rows) {
    out.push(
      [
        s.lineUsername ?? "",
        isPlaceholderEmail(s.customer.email) ? "" : s.customer.email,
        s.customer.name ?? "",
        s.reseller.storeName,
        s.reseller.owner.email,
        s.package.name,
        s.panel.name,
        s.status,
        s.expiresAt ? s.expiresAt.toISOString().slice(0, 16).replace("T", " ") : "",
        s.maxPlayerStatus,
        s.maxPlayerUserId ?? "",
        s.isTest ? "yes" : "no",
        s.createdAt.toISOString().slice(0, 16).replace("T", " "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return new Response(out.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="all-lines-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
