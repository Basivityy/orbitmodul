import type { Prisma, VodSeries } from "@prisma/client";
import { decrypt, encrypt } from "@/core/crypto";
import { assertPublicUrl } from "@/core/net";
import { cleanSeriesTitle, compareEpisodes, expectedFromTmdb, nextFromTmdb, type PanelSeries, type SeriesStatus, TmdbClient, VodSourceError, XtreamClient } from "@/core/vod";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";

/**
 * VOD monitoring for resellers the Super Admin enabled it for: reads the series library of the
 * panel with one monitoring line and compares every series with TMDB. Only reports — never changes
 * anything on the panel.
 */
export const SETTING_TMDB_KEY = "tmdb_api_key";
const TMDB_TTL_MS = 24 * 3600_000;
const PANEL_CONCURRENCY = 3;

export async function getTmdbKey(): Promise<string | null> {
  const enc = await getSetting<string | null>(SETTING_TMDB_KEY, null);
  if (enc) {
    try {
      return decrypt(enc);
    } catch {
      return null;
    }
  }
  return process.env.TMDB_API_KEY?.trim() || null;
}

export async function saveTmdbKey(key: string | null): Promise<void> {
  await setSetting(SETTING_TMDB_KEY, key ? encrypt(key) : null);
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const row = await db.tmdbCache.findUnique({ where: { key } });
  if (row && Date.now() - row.fetchedAt.getTime() < TMDB_TTL_MS) return (row.data as { v: T }).v;
  const v = await load();
  const data = { v } as unknown as Prisma.InputJsonValue;
  await db.tmdbCache.upsert({ where: { key }, create: { key, data }, update: { data, fetchedAt: new Date() } }).catch(() => undefined);
  return v;
}

/** Only what the comparison needs, so the cache stays small. */
async function tmdbTv(tmdb: TmdbClient, id: string): Promise<{ name: string; seasons: unknown; last_episode_to_air: unknown; next_episode_to_air: unknown } | null> {
  return cached(`tv2:${id}`, async () => {
    const tv = await tmdb.tv(id);
    return tv ? { name: String(tv.name ?? ""), seasons: tv.seasons ?? [], last_episode_to_air: tv.last_episode_to_air ?? null, next_episode_to_air: tv.next_episode_to_air ?? null } : null;
  });
}

async function tmdbSearch(tmdb: TmdbClient, name: string): Promise<{ id: string; name: string } | null> {
  const { title, year } = cleanSeriesTitle(name);
  return cached(`search:${title.toLowerCase()}:${year ?? ""}`, () => tmdb.searchTv(title, year));
}

interface Ctx {
  resellerId: string;
  panel: XtreamClient;
  tmdb: TmdbClient;
  categories: Map<string, string>;
  now: Date;
}

type Prev = Pick<VodSeries, "tmdbOverride" | "ignored"> | undefined;

/** Checks one series and stores the result. Errors of this series are stored, never thrown. */
async function checkSeries(ctx: Ctx, s: PanelSeries, prev: Prev): Promise<SeriesStatus> {
  const base = {
    name: s.name,
    category: s.categoryId ? ctx.categories.get(s.categoryId) ?? null : null,
    cover: s.cover,
    year: s.year,
    checkedAt: ctx.now,
  };
  let result: { status: SeriesStatus; [k: string]: unknown };
  try {
    const info = await ctx.panel.seriesInfo(s.seriesId);
    let tmdbId = prev?.tmdbOverride || s.tmdbId || info.tmdbId;
    let tmdbName: string | null = null;
    if (!tmdbId) {
      const hit = await tmdbSearch(ctx.tmdb, s.name);
      tmdbId = hit?.id ?? null;
      tmdbName = hit?.name ?? null;
    }
    const tv = tmdbId ? await tmdbTv(ctx.tmdb, tmdbId) : null;
    if (!tmdbId || !tv) {
      result = { status: "NOT_MATCHED", tmdbId: tmdbId ?? null, tmdbName, haveCount: info.episodes.length, expectedCount: 0, missingCount: 0, missing: [], seasons: {}, lastAired: null, nextAir: null, error: null };
    } else {
      const exp = expectedFromTmdb(tv);
      const cmp = compareEpisodes(info.episodes, exp, ctx.now);
      result = {
        status: cmp.status,
        tmdbId,
        tmdbName: tv.name || tmdbName,
        haveCount: cmp.haveCount,
        expectedCount: cmp.expectedCount,
        missingCount: cmp.missing.length,
        missing: cmp.missing as unknown as Prisma.InputJsonValue,
        seasons: exp.seasons,
        lastAired: exp.lastAired,
        nextAir: nextFromTmdb(tv)?.date ?? null,
        error: null,
      };
    }
  } catch (e) {
    result = { status: "ERROR", error: String((e as Error).message).slice(0, 300) };
  }
  await db.vodSeries.upsert({
    where: { resellerId_seriesId: { resellerId: ctx.resellerId, seriesId: s.seriesId } },
    create: { resellerId: ctx.resellerId, seriesId: s.seriesId, ...base, ...result } as unknown as Prisma.VodSeriesUncheckedCreateInput,
    update: { ...base, ...result } as unknown as Prisma.VodSeriesUncheckedUpdateInput,
  });
  return result.status;
}

async function context(resellerId: string): Promise<Ctx> {
  const m = await db.vodMonitor.findUnique({ where: { resellerId } });
  if (!m) throw new VodSourceError("Enter the monitoring line first.");
  const key = await getTmdbKey();
  if (!key) throw new VodSourceError("VOD monitoring is not set up on the platform yet (TMDB key missing). Contact the platform administrator.");
  await assertPublicUrl(m.serverUrl);
  return { resellerId, panel: new XtreamClient(m.serverUrl, m.username, decrypt(m.passwordEnc)), tmdb: new TmdbClient(key), categories: new Map(), now: new Date() };
}

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

/** Full scan of one reseller's series library (worker job). */
export async function scanReseller(resellerId: string): Promise<{ series: number; missing: number }> {
  const r = await db.reseller.findUnique({ where: { id: resellerId }, select: { vodMonitorEnabled: true, status: true } });
  const m = await db.vodMonitor.findUnique({ where: { resellerId } });
  if (!r?.vodMonitorEnabled || r.status !== "ACTIVE" || !m) {
    if (m) await db.vodMonitor.update({ where: { resellerId }, data: { status: "IDLE" } });
    return { series: 0, missing: 0 };
  }
  await db.vodMonitor.update({ where: { resellerId }, data: { status: "RUNNING", progress: 0, total: 0, lastError: null } });
  try {
    const ctx = await context(resellerId);
    ctx.categories = await ctx.panel.categories().catch(() => new Map());
    const list = await ctx.panel.series();
    await db.vodMonitor.update({ where: { resellerId }, data: { total: list.length } });
    const prevRows = await db.vodSeries.findMany({ where: { resellerId }, select: { seriesId: true, tmdbOverride: true, ignored: true } });
    const prev = new Map(prevRows.map((p) => [p.seriesId, p]));
    let done = 0;
    await pool(list, PANEL_CONCURRENCY, async (s) => {
      const p = prev.get(s.seriesId);
      if (p?.ignored) {
        await db.vodSeries.update({ where: { resellerId_seriesId: { resellerId, seriesId: s.seriesId } }, data: { name: s.name, checkedAt: ctx.now } });
      } else {
        await checkSeries(ctx, s, p);
      }
      done++;
      if (done % 10 === 0) await db.vodMonitor.update({ where: { resellerId }, data: { progress: done } });
    });
    // Series removed from the panel disappear from the report.
    await db.vodSeries.deleteMany({ where: { resellerId, checkedAt: { lt: ctx.now } } });
    const missing = await db.vodSeries.count({ where: { resellerId, ignored: false, status: { in: ["MISSING", "NEW_EPISODE"] } } });
    await db.vodMonitor.update({ where: { resellerId }, data: { status: "DONE", progress: list.length, lastScanAt: new Date(), seriesCount: list.length, missingCount: missing } });
    return { series: list.length, missing };
  } catch (e) {
    await db.vodMonitor.update({ where: { resellerId }, data: { status: "ERROR", lastError: String((e as Error).message).slice(0, 500), lastScanAt: new Date() } });
    if (e instanceof VodSourceError) return { series: 0, missing: 0 };
    throw e;
  }
}

/** Re-checks one series right away (after the reseller typed a TMDB id). */
export async function recheckSeries(resellerId: string, rowId: string): Promise<SeriesStatus> {
  const row = await db.vodSeries.findFirst({ where: { id: rowId, resellerId } });
  if (!row) throw new VodSourceError("Series not found.");
  const ctx = await context(resellerId);
  const status = await checkSeries(ctx, { seriesId: row.seriesId, name: row.name, categoryId: null, cover: row.cover, year: row.year, tmdbId: null }, row);
  // keep the category name from the full scan
  if (row.category) await db.vodSeries.update({ where: { id: row.id }, data: { category: row.category } });
  const missing = await db.vodSeries.count({ where: { resellerId, ignored: false, status: { in: ["MISSING", "NEW_EPISODE"] } } });
  await db.vodMonitor.update({ where: { resellerId }, data: { missingCount: missing } });
  return status;
}

/** Checks the monitoring line before saving it. */
export async function testMonitoringLine(serverUrl: string, username: string, password: string): Promise<{ series: number; expires: Date | null }> {
  await assertPublicUrl(serverUrl);
  const x = new XtreamClient(serverUrl, username, password);
  const { expires } = await x.check();
  const series = await x.series();
  return { series: series.length, expires };
}
