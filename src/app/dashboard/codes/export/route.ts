import type { Prisma } from "@prisma/client";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { storeBaseUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

/** CSV of the reseller's codes (filtered like the list) — to paste into Sellix, WooCommerce, etc. */
export async function GET(req: Request) {
  const { reseller } = await requireReseller();
  const u = new URL(req.url);
  const status = u.searchParams.get("status");
  const where: Prisma.ActivationCodeWhereInput = { resellerId: reseller.id };
  if (u.searchParams.get("package")) where.packageId = u.searchParams.get("package")!;
  if (u.searchParams.get("batch")) where.batch = u.searchParams.get("batch")!;
  if (status === "UNUSED" || status === "USED" || status === "VOID") where.status = status;
  const rows = await db.activationCode.findMany({ where, include: { package: true }, orderBy: { createdAt: "desc" }, take: 20000 });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const link = `${storeBaseUrl(reseller)}/activate?code=`;
  const lines = ["code,activation_link,package,status,batch,created,used_at,line_username,email", ...rows.map((r) => [r.code, link + r.code, r.package.name, r.status, r.batch, r.createdAt.toISOString(), r.usedAt?.toISOString() ?? "", r.lineUsername, r.usedByEmail].map(esc).join(","))];
  return new Response(lines.join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="activation-codes.csv"` } });
}
