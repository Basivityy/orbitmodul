/**
 * VOD monitoring: which episodes of a series are on the panel (Xtream player API) and which
 * aired episodes are missing (compared with TMDB). Pure logic + small HTTP clients, no database.
 */
import { httpRequest, HttpError, type HttpResult } from "./http";

export type Http = (url: string, init?: { headers?: Record<string, string>; timeoutMs?: number }) => Promise<HttpResult>;

export interface PanelSeries {
  seriesId: string;
  name: string;
  categoryId: string | null;
  cover: string | null;
  year: string | null;
  tmdbId: string | null;
}

export interface Ep {
  s: number;
  e: number;
}

export type SeriesStatus = "COMPLETE" | "MISSING" | "NEW_EPISODE" | "NOT_MATCHED" | "ERROR";

/** Episodes missing on the panel that aired at most this many days ago count as "new episode out". */
export const NEW_EPISODE_DAYS = 14;

const toInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
};

/** TMDB id written by XUI ("12345", 12345, "tv/12345", a themoviedb URL…), or null. */
export function parseTmdbId(v: unknown): string | null {
  const m = String(v ?? "").match(/(\d{1,9})/);
  return m && m[1] !== "0" ? m[1] : null;
}

/** `get_series` answer → series list. */
export function parseSeriesList(json: unknown): PanelSeries[] {
  const list = Array.isArray(json) ? json : json && typeof json === "object" ? Object.values(json as object) : [];
  const out: PanelSeries[] = [];
  for (const r of list as any[]) {
    const seriesId = r?.series_id ?? r?.id;
    if (seriesId === undefined || seriesId === null || !r?.name) continue;
    const year = String(r.year ?? r.releaseDate ?? r.release_date ?? "").match(/(19|20)\d{2}/)?.[0] ?? null;
    out.push({
      seriesId: String(seriesId),
      name: String(r.name).trim(),
      categoryId: r.category_id !== undefined && r.category_id !== null ? String(r.category_id) : null,
      cover: typeof r.cover === "string" && /^https?:\/\//.test(r.cover) ? r.cover : null,
      year,
      tmdbId: parseTmdbId(r.tmdb ?? r.tmdb_id),
    });
  }
  return out;
}

/** `get_series_info` answer → episodes on the panel (season > 0), plus a TMDB id if the info has one. */
export function parseSeriesEpisodes(json: any): { episodes: Ep[]; tmdbId: string | null } {
  const eps = new Map<string, Ep>();
  const groups = json?.episodes;
  const lists: any[] = Array.isArray(groups) ? groups : groups && typeof groups === "object" ? Object.entries(groups).map(([k, v]) => (Array.isArray(v) ? v.map((x: any) => ({ ...x, __season: k })) : [])) : [];
  for (const list of lists) {
    for (const ep of Array.isArray(list) ? list : [list]) {
      const s = toInt(ep?.season ?? ep?.__season);
      const e = toInt(ep?.episode_num ?? ep?.episode);
      if (s === null || e === null || s < 1 || e < 1) continue;
      eps.set(`${s}:${e}`, { s, e });
    }
  }
  return { episodes: [...eps.values()].sort(epSort), tmdbId: parseTmdbId(json?.info?.tmdb ?? json?.info?.tmdb_id) };
}

/** Next announced episode (TMDB `next_episode_to_air`), e.g. the first episode of a coming season. */
export function nextFromTmdb(tv: any): { date: Date; ep: Ep } | null {
  const n = tv?.next_episode_to_air;
  const s = toInt(n?.season_number);
  const e = toInt(n?.episode_number);
  const d = n?.air_date ? new Date(`${n.air_date}T00:00:00Z`) : null;
  return s !== null && e !== null && d && !isNaN(d.getTime()) ? { date: d, ep: { s, e } } : null;
}

export const epSort = (a: Ep, b: Ep) => a.s - b.s || a.e - b.e;

/**
 * Aired episodes according to TMDB `/tv/{id}` (one request per series): every episode of the
 * seasons before the last aired one, and in that season up to the last aired episode.
 * Specials (season 0) and seasons that have not started are skipped.
 */
export function expectedFromTmdb(tv: any): { episodes: Ep[]; seasons: Record<string, number>; lastAired: Date | null; lastAiredEp: Ep | null } {
  const last = tv?.last_episode_to_air;
  const lastS = toInt(last?.season_number);
  const lastE = toInt(last?.episode_number);
  const seasons: Record<string, number> = {};
  const episodes: Ep[] = [];
  if (lastS === null || lastE === null || lastS < 1) return { episodes, seasons, lastAired: null, lastAiredEp: null };
  for (const se of Array.isArray(tv?.seasons) ? tv.seasons : []) {
    const s = toInt(se?.season_number);
    const count = toInt(se?.episode_count) ?? 0;
    if (s === null || s < 1 || s > lastS) continue;
    const upto = s === lastS ? Math.min(lastE, Math.max(count, lastE)) : count;
    if (upto < 1) continue;
    seasons[String(s)] = upto;
    for (let e = 1; e <= upto; e++) episodes.push({ s, e });
  }
  const d = last?.air_date ? new Date(`${last.air_date}T00:00:00Z`) : null;
  return { episodes, seasons, lastAired: d && !isNaN(d.getTime()) ? d : null, lastAiredEp: { s: lastS, e: lastE } };
}

export interface Comparison {
  status: SeriesStatus;
  missing: Ep[];
  haveCount: number;
  expectedCount: number;
}

/** Panel episodes vs aired episodes. Extra episodes on the panel are fine. */
export function compareEpisodes(have: Ep[], expected: ReturnType<typeof expectedFromTmdb>, now = new Date()): Comparison {
  const got = new Set(have.map((x) => `${x.s}:${x.e}`));
  const missing = expected.episodes.filter((x) => !got.has(`${x.s}:${x.e}`));
  const haveCount = expected.episodes.length - missing.length;
  if (missing.length === 0) return { status: "COMPLETE", missing, haveCount, expectedCount: expected.episodes.length };
  const le = expected.lastAiredEp;
  const recent = !!expected.lastAired && now.getTime() - expected.lastAired.getTime() <= NEW_EPISODE_DAYS * 86_400_000;
  const latestMissing = !!le && missing.some((m) => m.s === le.s && m.e === le.e);
  return { status: recent && latestMissing ? "NEW_EPISODE" : "MISSING", missing, haveCount, expectedCount: expected.episodes.length };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "S03: E05–E06, E09 · S05: all 10" */
export function summarizeMissing(missing: Ep[], seasons: Record<string, number>, max = 6): string {
  const bySeason = new Map<number, number[]>();
  for (const m of [...missing].sort(epSort)) bySeason.set(m.s, [...(bySeason.get(m.s) ?? []), m.e]);
  const parts: string[] = [];
  for (const [s, eps] of bySeason) {
    const total = seasons[String(s)];
    if (total && eps.length === total) {
      parts.push(`S${pad(s)}: all ${total}`);
      continue;
    }
    const ranges: string[] = [];
    let start = eps[0];
    let prev = eps[0];
    for (const e of [...eps.slice(1), NaN]) {
      if (e === prev + 1) {
        prev = e;
        continue;
      }
      ranges.push(start === prev ? `E${pad(start)}` : `E${pad(start)}–E${pad(prev)}`);
      start = e;
      prev = e;
    }
    parts.push(`S${pad(s)}: ${ranges.join(", ")}`);
  }
  return parts.length > max ? `${parts.slice(0, max).join(" · ")} · +${parts.length - max} seasons` : parts.join(" · ");
}

/** Title for a TMDB search: provider tags, quality, language prefixes and the year removed. */
export function cleanSeriesTitle(name: string): { title: string; year: string | null } {
  let t = name;
  const year = t.match(/[([]\s*((?:19|20)\d{2})\s*[)\]]/)?.[1] ?? t.match(/\b((?:19|20)\d{2})\s*$/)?.[1] ?? null;
  t = t
    .replace(/^\s*(?:[|[(]?\s*[A-Z]{2,3}\s*[|\])]\s*|[A-Z]{2,3}\s*[-:|]\s+)+/, "") // "EN - ", "|EX| ", "[DE] "
    .replace(/[([]\s*(?:19|20)\d{2}\s*[)\]]/g, "")
    .replace(/\b(?:4K|UHD|FHD|HD|SD|HEVC|H\.?26[45]|MULTI|SUB(?:S|BED)?|DUBBED|VOSTFR)\b/gi, "")
    .replace(/[([]\s*[)\]]/g, "")
    .replace(/\s+[-|:]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (year) t = t.replace(new RegExp(`\\s*${year}\\s*$`), "").trim();
  return { title: t || name.trim(), year };
}

// ── HTTP clients ─────────────────────────────────────────────────────────────

export class VodSourceError extends Error {}

/** Xtream Codes player API of the panel, read with one (monitoring) line. */
export class XtreamClient {
  constructor(private serverUrl: string, private username: string, private password: string, private http: Http = httpRequest) {}

  private url(params: Record<string, string>): string {
    const u = new URL("player_api.php", this.serverUrl.replace(/\/+$/, "") + "/");
    u.searchParams.set("username", this.username);
    u.searchParams.set("password", this.password);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async get(params: Record<string, string>, timeoutMs = 60_000): Promise<any> {
    let r: HttpResult;
    try {
      r = await this.http(this.url(params), { timeoutMs, headers: { "User-Agent": "OrbitModul-VOD/1.0" } });
    } catch (e) {
      throw new VodSourceError(`The panel could not be reached: ${(e as Error).message}`);
    }
    if (r.status === 401 || r.status === 403) throw new VodSourceError("The panel refused the line (wrong username/password, expired or blocked line).");
    if (!r.ok) throw new VodSourceError(`The panel answered HTTP ${r.status}.`);
    if (r.json === null) throw new VodSourceError("The panel did not answer with JSON — check the server address (e.g. http://line.example.com:80).");
    return r.json;
  }

  /** Line works and is active. */
  async check(): Promise<{ ok: true; expires: Date | null }> {
    const j = await this.get({}, 20_000);
    const ui = j?.user_info;
    if (!ui || String(ui.auth) !== "1") throw new VodSourceError("The panel refused the line (wrong username/password).");
    if (ui.status && String(ui.status).toLowerCase() !== "active") throw new VodSourceError(`The line is not active on the panel (status: ${ui.status}).`);
    const exp = toInt(ui.exp_date);
    return { ok: true, expires: exp ? new Date(exp * 1000) : null };
  }

  async categories(): Promise<Map<string, string>> {
    const j = await this.get({ action: "get_series_categories" });
    const m = new Map<string, string>();
    for (const c of Array.isArray(j) ? j : []) if (c?.category_id !== undefined) m.set(String(c.category_id), String(c.category_name ?? "").trim());
    return m;
  }

  async series(): Promise<PanelSeries[]> {
    return parseSeriesList(await this.get({ action: "get_series" }, 120_000));
  }

  async seriesInfo(seriesId: string): Promise<{ episodes: Ep[]; tmdbId: string | null }> {
    return parseSeriesEpisodes(await this.get({ action: "get_series_info", series_id: seriesId }));
  }
}

/** TMDB API — accepts a v3 API key or a v4 read access token. */
export class TmdbClient {
  constructor(private key: string, private http: Http = httpRequest, private base = "https://api.themoviedb.org/3") {}

  private async get(path: string, params: Record<string, string> = {}): Promise<any | null> {
    const u = new URL(this.base + path);
    const bearer = this.key.length > 60;
    if (!bearer) u.searchParams.set("api_key", this.key);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (bearer) headers.Authorization = `Bearer ${this.key}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this.http(u.toString(), { headers, timeoutMs: 20_000 });
      if (r.status === 429) {
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
        continue;
      }
      if (r.status === 404) return null;
      if (r.status === 401) throw new HttpError("TMDB rejected the API key — check it in Admin → Settings.", 401);
      if (!r.ok) throw new HttpError(`TMDB answered HTTP ${r.status}`, r.status);
      return r.json;
    }
    throw new HttpError("TMDB rate limit — try again later.", 429);
  }

  async tv(id: string): Promise<any | null> {
    return this.get(`/tv/${encodeURIComponent(id)}`, { language: "en-US" });
  }

  /** Best match for a series title (year preferred when known). */
  async searchTv(title: string, year: string | null): Promise<{ id: string; name: string } | null> {
    const run = async (y: string | null) => {
      const j = await this.get("/search/tv", { query: title, include_adult: "false", ...(y ? { first_air_date_year: y } : {}) });
      const r = Array.isArray(j?.results) ? j.results : [];
      if (!r.length) return null;
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const exact = r.find((x: any) => norm(x.name ?? "") === norm(title) || norm(x.original_name ?? "") === norm(title));
      const best = exact ?? r[0];
      return { id: String(best.id), name: String(best.name ?? best.original_name ?? title) };
    };
    return (year ? await run(year) : null) ?? (await run(null));
  }
}
