import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { summarizeMissing, type Ep } from "@/core/vod";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, PageHeader, Pagination, Stat } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTmdbKey } from "@/lib/vod";
import { deleteVodLineAction, saveVodLineAction, scanVodNowAction, setVodTmdbAction, toggleVodIgnoreAction } from "../actions/vod";

export const metadata = { title: "VOD monitoring" };
export const dynamic = "force-dynamic";

const PAGE = 50;
const TABS = [
  { key: "problems", label: "Missing episodes", where: { ignored: false, status: { in: ["MISSING", "NEW_EPISODE"] } } },
  { key: "new", label: "New episode out", where: { ignored: false, status: "NEW_EPISODE" } },
  { key: "unmatched", label: "Not matched", where: { ignored: false, status: { in: ["NOT_MATCHED", "ERROR"] } } },
  { key: "complete", label: "Completed", where: { ignored: false, status: "COMPLETE" } },
  { key: "ignored", label: "Not monitored", where: { ignored: true } },
  { key: "all", label: "All", where: {} },
] as const;

const STATUS: Record<string, { label: string; cls: string }> = {
  COMPLETE: { label: "Completed", cls: "badge-green" },
  MISSING: { label: "Missing", cls: "badge-amber" },
  NEW_EPISODE: { label: "New episode out", cls: "badge-red" },
  NOT_MATCHED: { label: "Not matched", cls: "badge-gray" },
  ERROR: { label: "Error", cls: "badge-red" },
};

export default async function VodPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  if (!reseller.vodMonitorEnabled) {
    return (
      <>
        <PageHeader title="VOD monitoring" />
        <Card><Empty title="Not enabled for your account">VOD monitoring shows which episodes of your series are missing on the panel. Ask the platform administrator to enable it for you.</Empty></Card>
      </>
    );
  }
  const [m, tmdbReady, panel] = await Promise.all([
    db.vodMonitor.findUnique({ where: { resellerId: reseller.id } }),
    getTmdbKey().then(Boolean),
    db.panelIntegration.findFirst({ where: { resellerId: reseller.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { streamUrl: true, apiUrl: true } }),
  ]);
  const suggestedServer = panel?.streamUrl || (panel ? (() => { try { const u = new URL(panel.apiUrl); return `${u.protocol}//${u.host}`; } catch { return ""; } })() : "");
  const running = m?.status === "RUNNING" || m?.status === "QUEUED";

  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const cat = (sp.cat ?? "").slice(0, 200);
  const where: Prisma.VodSeriesWhereInput = { resellerId: reseller.id, ...(tab.where as Prisma.VodSeriesWhereInput) };
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (cat) where.category = cat;
  const [rows, counts, cats] = m
    ? await Promise.all([
        db.vodSeries.findMany({ where, orderBy: [{ status: "desc" }, { lastAired: { sort: "desc", nulls: "last" } }, { name: "asc" }], skip: (page - 1) * PAGE, take: PAGE + 1 }),
        Promise.all(TABS.map((t) => db.vodSeries.count({ where: { resellerId: reseller.id, ...(t.where as Prisma.VodSeriesWhereInput) } }))),
        db.vodSeries.findMany({ where: { resellerId: reseller.id, category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" }, take: 300 }),
      ])
    : [[], TABS.map(() => 0), []];
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ tab: tab.key, ...(q ? { q } : {}), ...(cat ? { cat } : {}), ...extra });
    return `/dashboard/vod?${p.toString()}`;
  };
  const here = qs(page > 1 ? { page: String(page) } : {});
  const newCount = counts[1];

  return (
    <>
      <AutoRefresh active={running} intervalMs={5000} />
      <PageHeader
        title="VOD monitoring"
        description="Which aired episodes of your series are missing on the panel — compared with TMDB every day. Only reports, never changes the panel."
        actions={m ? (
          <>
            <a className="btn-secondary" href={`/dashboard/vod/export?tab=${tab.key}${cat ? `&cat=${encodeURIComponent(cat)}` : ""}`}>⇩ CSV</a>
            <form action={scanVodNowAction}><SubmitButton className="btn-primary" >{running ? "Scanning…" : "Scan now"}</SubmitButton></form>
          </>
        ) : undefined}
      />
      <Flash sp={sp} />
      {!tmdbReady && <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">The platform has not finished setting up VOD monitoring yet (TMDB key). You can already enter your line — scans start once it is set up.</p>}

      {m && (
        <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Series on the panel" value={m.seriesCount || "—"} />
          <Stat label="With missing episodes" value={m.lastScanAt ? m.missingCount : "—"} tone={m.missingCount ? "red" : undefined} />
          <Stat label="New episode out" value={m.lastScanAt ? newCount : "—"} tone={newCount ? "red" : undefined} hint={`aired in the last 14 days`} />
          <Stat
            label="Last scan"
            value={running ? `${m.status === "QUEUED" ? "Waiting…" : `${m.progress}/${m.total || "?"}`}` : m.lastScanAt ? <DateTime value={m.lastScanAt} /> : "never"}
            hint={m.status === "ERROR" ? <span className="text-rose-600">{m.lastError}</span> : m.autoScan ? "runs automatically every day" : "automatic scan off"}
          />
        </section>
      )}

      {m && (
        <Card pad={false} className="mb-6">
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
            {TABS.map((t, i) => (
              <Link key={t.key} href={`/dashboard/vod?tab=${t.key}${cat ? `&cat=${encodeURIComponent(cat)}` : ""}`} className={t.key === tab.key ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
                {t.label} <span className="ml-1 opacity-70">{counts[i]}</span>
              </Link>
            ))}
          </div>
          <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800" action="/dashboard/vod">
            <input type="hidden" name="tab" value={tab.key} />
            <input className="input max-w-xs flex-1" name="q" defaultValue={q} placeholder="Search series" />
            <select className="input max-w-xs" name="cat" defaultValue={cat}>
              <option value="">All categories</option>
              {cats.map((c) => c.category && <option key={c.category} value={c.category}>{c.category}</option>)}
            </select>
            <button className="btn-secondary" type="submit">Filter</button>
          </form>
          {rows.length === 0 ? (
            <Empty title={m.lastScanAt ? "Nothing here" : "No scan yet"}>{m.lastScanAt ? (tab.key === "problems" ? "No series with missing episodes. 🎉" : "No series in this list.") : "Click “Scan now” — the first scan of a big library takes a few minutes."}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Series</th><th>Status</th><th>On panel</th><th>Missing</th><th className="w-64">TMDB</th><th /></tr>
                </thead>
                <tbody>
                  {rows.slice(0, PAGE).map((r) => {
                    const st = STATUS[r.status] ?? STATUS.ERROR;
                    const missing = (r.missing as unknown as Ep[]) ?? [];
                    const seasons = (r.seasons as unknown as Record<string, number>) ?? {};
                    const tmdb = r.tmdbOverride || r.tmdbId;
                    return (
                      <tr key={r.id} className={r.ignored ? "opacity-60" : undefined}>
                        <td className="min-w-48">
                          <div className="font-medium">{r.name}</div>
                          <div className="muted text-xs">{[r.category, r.year, r.tmdbName && r.tmdbName !== r.name ? `TMDB: ${r.tmdbName}` : null].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td><span className={st.cls}>{st.label}</span>{r.status === "NEW_EPISODE" && r.lastAired && <div className="muted text-xs">aired <DateTime value={r.lastAired} dateOnly /></div>}{r.status === "COMPLETE" && <div className="muted text-xs">all aired seasons ({Object.keys((r.seasons as object) ?? {}).length}){r.nextAir ? <> · next episode <DateTime value={r.nextAir} dateOnly /></> : ""}</div>}</td>
                        <td className="tabular-nums">{r.expectedCount ? `${r.haveCount}/${r.expectedCount}` : r.haveCount ? `${r.haveCount} ep.` : "—"}</td>
                        <td className="max-w-md text-sm">
                          {r.status === "ERROR" ? <span className="text-rose-600">{r.error}</span> : r.status === "NOT_MATCHED" ? <span className="muted">Not found on TMDB — enter the TMDB number →</span> : missing.length ? <span className="font-mono text-xs">{summarizeMissing(missing, seasons)}</span> : <span className="muted">—</span>}
                        </td>
                        <td>
                          <form action={setVodTmdbAction} className="flex gap-1">
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="back" value={here} />
                            <input className="input w-28 py-1 font-mono text-sm" name="tmdb" defaultValue={r.tmdbOverride ?? ""} placeholder={r.tmdbId ?? "TMDB id"} aria-label="TMDB id" inputMode="numeric" />
                            <SubmitButton className="btn-secondary btn-sm">Check</SubmitButton>
                          </form>
                          {tmdb && <a className="text-xs" href={`https://www.themoviedb.org/tv/${tmdb}`} target="_blank" rel="noreferrer">themoviedb.org/tv/{tmdb} ↗</a>}
                        </td>
                        <td>
                          <form action={toggleVodIgnoreAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="back" value={here} />
                            <SubmitButton className="btn-ghost btn-sm whitespace-nowrap">{r.ignored ? "Monitor" : "Don't monitor"}</SubmitButton>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} hasMore={rows.length > PAGE} baseHref={qs({})} />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={m ? "Monitoring line" : "1. Enter a monitoring line"} description="A line on your panel that has your series bouquets. It is only used to read the series list — create a separate line for this and keep it active.">
          <form action={saveVodLineAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="serverUrl">Server address (DNS)</label>
              <input className="input font-mono" id="serverUrl" name="serverUrl" required defaultValue={m?.serverUrl ?? suggestedServer} placeholder="http://line.example.com:80" />
              <p className="hint">The address the apps connect to (the same as in your M3U links).</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="username">Username</label>
                <input className="input font-mono" id="username" name="username" required defaultValue={m?.username ?? ""} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input className="input font-mono" id="password" name="password" type="password" autoComplete="new-password" required={!m} placeholder={m ? "•••••• (unchanged)" : ""} />
              </div>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="autoScan" defaultChecked={m?.autoScan ?? true} className="checkbox" />
              Scan automatically every day
            </label>
            <SubmitButton>{m ? "Test & save" : "Test & save line"}</SubmitButton>
          </form>
          {m && (
            <form action={deleteVodLineAction} className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
              <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Remove the monitoring line and all results?">Remove line and results</SubmitButton>
            </form>
          )}
        </Card>
        <Card title="How it works">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Every series on the panel is compared with <b>TMDB</b> (The Movie Database). Only <b>aired</b> episodes count — upcoming ones never show as missing.</li>
            <li><b>Completed</b>: every season and episode that has <b>aired</b> is on the panel. Seasons that are announced but not out yet do not count — they show as “next episode” with the date.</li>
            <li><b>New episode out</b>: the newest episode aired in the last 14 days and is not on the panel yet.</li>
            <li><b>Not matched</b>: TMDB did not recognise the title. Open themoviedb.org, find the series and enter its number (from the link, e.g. <span className="font-mono">themoviedb.org/tv/<b>1396</b></span>), then click Check.</li>
            <li>Shows, sports or local series without TMDB entries: click <b>Don&apos;t monitor</b>.</li>
            <li><b>CSV</b> exports the current list — send it to whoever adds the content.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
