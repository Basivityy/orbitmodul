import type { Prisma } from "@prisma/client";
import { summarizeMissing, type Ep } from "@/core/vod";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** CSV of the VOD report (same tabs as the page) — to send to whoever adds the content. */
export async function GET(req: Request) {
  const { reseller } = await requireReseller();
  if (!reseller.vodMonitorEnabled) return new Response("Not enabled", { status: 403 });
  const u = new URL(req.url);
  const tab = u.searchParams.get("tab") ?? "problems";
  const where: Prisma.VodSeriesWhereInput = { resellerId: reseller.id };
  if (tab === "problems") Object.assign(where, { ignored: false, status: { in: ["MISSING", "NEW_EPISODE"] } });
  else if (tab === "new") Object.assign(where, { ignored: false, status: "NEW_EPISODE" });
  else if (tab === "unmatched") Object.assign(where, { ignored: false, status: { in: ["NOT_MATCHED", "ERROR"] } });
  else if (tab === "complete") Object.assign(where, { ignored: false, status: "COMPLETE" });
  else if (tab === "ignored") where.ignored = true;
  const cat = u.searchParams.get("cat");
  if (cat) where.category = cat;
  const rows = await db.vodSeries.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }], take: 50000 });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lines = [
    "series,category,status,on_panel,aired,missing_count,missing_summary,missing_episodes,last_aired,tmdb_id,panel_series_id",
    ...rows.map((r) => {
      const missing = (r.missing as unknown as Ep[]) ?? [];
      return [r.name, r.category, r.status, r.haveCount, r.expectedCount, r.missingCount, summarizeMissing(missing, (r.seasons as unknown as Record<string, number>) ?? {}, 100), missing.map((m) => `S${pad(m.s)}E${pad(m.e)}`).join(" "), r.lastAired?.toISOString().slice(0, 10) ?? "", r.tmdbOverride || r.tmdbId, r.seriesId].map(esc).join(",");
    }),
  ];
  return new Response("﻿" + lines.join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vod-missing-${tab}.csv"` } });
}
