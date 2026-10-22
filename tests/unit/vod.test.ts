import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSeriesTitle, compareEpisodes, expectedFromTmdb, nextFromTmdb, parseSeriesEpisodes, parseSeriesList, parseTmdbId, summarizeMissing, TmdbClient, VodSourceError, XtreamClient } from "../../src/core/vod";
import { startServer } from "../mocks/servers";

const TV = {
  id: 1396,
  name: "Breaking Bad",
  seasons: [
    { season_number: 0, episode_count: 9 },
    { season_number: 1, episode_count: 7 },
    { season_number: 2, episode_count: 13 },
    { season_number: 3, episode_count: 13 },
  ],
  last_episode_to_air: { season_number: 3, episode_number: 10, air_date: "2026-10-15" },
};

test("vod: aired episodes from TMDB skip specials and unaired episodes", () => {
  const x = expectedFromTmdb(TV);
  assert.equal(x.episodes.length, 7 + 13 + 10);
  assert.deepEqual(x.seasons, { "1": 7, "2": 13, "3": 10 });
  assert.deepEqual(x.lastAiredEp, { s: 3, e: 10 });
  assert.equal(x.lastAired?.toISOString().slice(0, 10), "2026-10-15");
  // nothing aired yet
  assert.equal(expectedFromTmdb({ seasons: [{ season_number: 1, episode_count: 8 }], last_episode_to_air: null }).episodes.length, 0);
});

test("vod: panel episodes are read from object and array shapes", () => {
  const obj = parseSeriesEpisodes({ info: { tmdb: "1396" }, episodes: { "1": [{ season: 1, episode_num: "1" }, { season: "1", episode_num: 2 }], "2": [{ episode_num: 1 }] } });
  assert.deepEqual(obj.episodes, [{ s: 1, e: 1 }, { s: 1, e: 2 }, { s: 2, e: 1 }]);
  assert.equal(obj.tmdbId, "1396");
  const arr = parseSeriesEpisodes({ episodes: [[{ season: 1, episode_num: 3 }, { season: 1, episode_num: 3 }], [{ season: 0, episode_num: 1 }]] });
  assert.deepEqual(arr.episodes, [{ s: 1, e: 3 }], "duplicates and specials ignored");
  assert.deepEqual(parseSeriesEpisodes(null).episodes, []);
});

test("vod: compare — complete, missing, new episode out", () => {
  const exp = expectedFromTmdb(TV);
  const all = exp.episodes;
  const now = new Date("2026-10-20T12:00:00Z");
  assert.equal(compareEpisodes(all, exp, now).status, "COMPLETE");
  const noLatest = all.filter((x) => !(x.s === 3 && x.e === 10));
  const r = compareEpisodes(noLatest, exp, now);
  assert.equal(r.status, "NEW_EPISODE");
  assert.deepEqual(r.missing, [{ s: 3, e: 10 }]);
  assert.equal(compareEpisodes(noLatest, exp, new Date("2026-12-01T00:00:00Z")).status, "MISSING", "older than 14 days");
  const holes = all.filter((x) => !(x.s === 2 && (x.e === 5 || x.e === 6)));
  const h = compareEpisodes(holes, exp, now);
  assert.equal(h.status, "MISSING");
  assert.equal(h.haveCount, 28);
  assert.equal(h.expectedCount, 30);
  // extra episodes on the panel never count as a problem
  assert.equal(compareEpisodes([...all, { s: 9, e: 1 }], exp, now).status, "COMPLETE");
});

test("vod: missing summary groups ranges and whole seasons", () => {
  const missing = [{ s: 3, e: 5 }, { s: 3, e: 6 }, { s: 3, e: 9 }, ...Array.from({ length: 10 }, (_, i) => ({ s: 5, e: i + 1 }))];
  assert.equal(summarizeMissing(missing, { "3": 13, "5": 10 }), "S03: E05–E06, E09 · S05: all 10");
  assert.equal(summarizeMissing([], {}), "");
});

test("vod: series titles are cleaned for the TMDB search", () => {
  assert.deepEqual(cleanSeriesTitle("EN - Breaking Bad (2008)"), { title: "Breaking Bad", year: "2008" });
  assert.deepEqual(cleanSeriesTitle("|EX| La Casa de Papel [4K]"), { title: "La Casa de Papel", year: null });
  assert.deepEqual(cleanSeriesTitle("Dark 2017"), { title: "Dark", year: "2017" });
  assert.equal(cleanSeriesTitle("Ezel").title, "Ezel");
  assert.equal(parseTmdbId("https://www.themoviedb.org/tv/1396-breaking-bad"), "1396");
  assert.equal(parseTmdbId(""), null);
  assert.equal(parseTmdbId("0"), null);
});

test("vod: series list parsing keeps id, category, year and TMDB id", () => {
  const l = parseSeriesList([{ series_id: 7, name: " Dark ", category_id: "12", cover: "http://x/y.jpg", releaseDate: "2017-12-01", tmdb: "70523" }, { name: "no id" }]);
  assert.deepEqual(l, [{ seriesId: "7", name: "Dark", categoryId: "12", cover: "http://x/y.jpg", year: "2017", tmdbId: "70523" }]);
});

test("vod: Xtream client reads series and episodes; wrong line gives a clear error", async () => {
  const srv = await startServer((req) => {
    const q = req.query;
    if (req.path !== "/player_api.php") return { status: 404, text: "no" };
    if (q.get("username") !== "mon1" || q.get("password") !== "pw") return { json: { user_info: { auth: 0 } } };
    const action = q.get("action");
    if (!action) return { json: { user_info: { auth: 1, status: "Active", exp_date: "1893456000" } } };
    if (action === "get_series_categories") return { json: [{ category_id: "12", category_name: "Drama" }] };
    if (action === "get_series") return { json: [{ series_id: 7, name: "Dark", category_id: "12" }] };
    if (action === "get_series_info") return { json: { episodes: { "1": [{ season: 1, episode_num: 1 }] } } };
    return { json: [] };
  });
  try {
    const x = new XtreamClient(srv.url, "mon1", "pw");
    assert.equal((await x.check()).ok, true);
    assert.equal((await x.categories()).get("12"), "Drama");
    assert.equal((await x.series())[0].name, "Dark");
    assert.deepEqual((await x.seriesInfo("7")).episodes, [{ s: 1, e: 1 }]);
    await assert.rejects(new XtreamClient(srv.url, "mon1", "bad").check(), VodSourceError);
  } finally {
    await srv.close();
  }
});

test("vod: TMDB client — v3 key in the query, v4 token as bearer, 404 is null, search prefers exact title", async () => {
  const seen: any[] = [];
  const srv = await startServer((req) => {
    seen.push({ path: req.path, key: req.query.get("api_key"), auth: req.headers.authorization });
    if (req.path === "/3/tv/1396") return { json: TV };
    if (req.path === "/3/search/tv") return { json: { results: [{ id: 99, name: "Breaking Bad: The Movie" }, { id: 1396, name: "Breaking Bad" }] } };
    return { status: 404, json: { status_code: 34 } };
  });
  try {
    const t = new TmdbClient("k3y", undefined, `${srv.url}/3`);
    assert.equal((await t.tv("1396")).name, "Breaking Bad");
    assert.equal(await t.tv("5"), null);
    assert.deepEqual(await t.searchTv("Breaking Bad", "2008"), { id: "1396", name: "Breaking Bad" });
    assert.equal(seen[0].key, "k3y");
    const longToken = "x".repeat(120);
    await new TmdbClient(longToken, undefined, `${srv.url}/3`).tv("1396");
    assert.equal(seen.at(-1).auth, `Bearer ${longToken}`);
    assert.equal(seen.at(-1).key, null);
  } finally {
    await srv.close();
  }
});

test("vod: 3 seasons aired and on the panel = completed, even with season 4 announced", () => {
  const tv = {
    seasons: [1, 2, 3, 4].map((n) => ({ season_number: n, episode_count: 8 })),
    last_episode_to_air: { season_number: 3, episode_number: 8, air_date: "2025-05-01" },
    next_episode_to_air: { season_number: 4, episode_number: 1, air_date: "2026-11-03" },
  };
  const exp = expectedFromTmdb(tv);
  assert.deepEqual(Object.keys(exp.seasons), ["1", "2", "3"]);
  const have = [1, 2, 3].flatMap((s) => Array.from({ length: 8 }, (_, i) => ({ s, e: i + 1 })));
  assert.equal(compareEpisodes(have, exp, new Date("2026-10-22T00:00:00Z")).status, "COMPLETE");
  assert.equal(nextFromTmdb(tv)?.date.toISOString().slice(0, 10), "2026-11-03");
  assert.equal(nextFromTmdb({}), null);
});
