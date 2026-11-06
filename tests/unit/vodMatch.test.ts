import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, cyrToLatin, findTv, titleCandidates, titleSimilarity, type RawTv } from "../../src/core/vodMatch";

test("vod match: panel tags, seasons, genres and years are removed", () => {
  assert.equal(cleanTitle("EX-YU | Sulejman Veličanstveni S01 (2011) [SINH]"), "Sulejman Veličanstveni");
  assert.equal(cleanTitle("NETFLIX: Stranger Things"), "Stranger Things");
  assert.equal(cleanTitle("Grey's Anatomy - Season 19"), "Grey's Anatomy");
  assert.equal(cleanTitle("Kafana na Balkanu - Domaća serija"), "Kafana na Balkanu");
  assert.equal(cleanTitle("Sjene prošlosti - Turska serija HR SUB"), "Sjene prošlosti");
  assert.equal(cleanTitle("Vreme zla 1. sezona"), "Vreme zla");
  assert.equal(cleanTitle("Law & Order: SVU"), "Law & Order: SVU", "real capitals in a title stay");
  assert.equal(cleanTitle("Mad Max"), "Mad Max");
  assert.equal(cleanTitle("24"), "24");
});

test("vod match: several search titles — parts, Cyrillic, without accents", () => {
  assert.deepEqual(titleCandidates("TR: Kuzey Güney / Sjever Jug").slice(0, 3), ["Kuzey Güney / Sjever Jug", "Kuzey Güney", "Sjever Jug"]);
  assert.ok(titleCandidates("Igra prijestolja (Game of Thrones)").includes("Game of Thrones"));
  assert.ok(titleCandidates("Сјенке над Балканом").includes("Sjenke nad Balkanom"));
  assert.ok(titleCandidates("Sulejman Veličanstveni").includes("Sulejman Velicanstveni"));
  assert.equal(cyrToLatin("Љубав"), "Ljubav");
  assert.equal(titleSimilarity("The Office", "Office"), 1);
  assert.ok(titleSimilarity("Dark", "Dark Matter") < 0.6);
});

test("vod match: tries the next title / language until a show looks like the title", async () => {
  const calls: string[] = [];
  const db: Record<string, RawTv[]> = {
    "Sjever Jug|en-US": [{ id: 1, name: "North South", original_name: "Kuzey Güney", first_air_date: "2011-09-01" }],
    "Kuzey Güney|en-US": [{ id: 1, name: "North South", original_name: "Kuzey Güney", first_air_date: "2011-09-01" }],
  };
  const search = async (q: string, o: { year: string | null; language: string }) => {
    calls.push(`${q}|${o.year ?? ""}|${o.language}`);
    return db[`${q}|${o.language}`] ?? [];
  };
  const hit = await findTv("TR: Kuzey Güney / Sjever Jug", { year: null, search });
  assert.equal(hit?.id, "1");
  assert.ok(hit!.score >= 0.9, "original name matches");

  // English name differs: the Croatian names are asked for and match
  const hr: Record<string, RawTv[]> = {
    "en-US": [{ id: 7, name: "Magnificent Century", original_name: "Muhteşem Yüzyıl", first_air_date: "2011-01-05" }],
    "hr-HR": [{ id: 7, name: "Sulejman Veličanstveni", original_name: "Muhteşem Yüzyıl", first_air_date: "2011-01-05" }],
  };
  const h2 = await findTv("EX-YU | Sulejman Velicanstveni (2011)", { year: null, search: async (q, o) => (q.startsWith("Sulejman") ? hr[o.language] ?? [] : []) });
  assert.equal(h2?.id, "7");
  assert.equal(h2?.name, "Sulejman Veličanstveni");

  // nothing similar and many results → no wrong match
  const none = await findTv("Moja serija", { year: null, search: async () => [{ id: 1, name: "Completely Different" }, { id: 2, name: "Other" }] });
  assert.equal(none, null);
  // the right year wins between remakes
  const yr = await findTv("Shameless (2011)", { year: null, search: async () => [{ id: 1, name: "Shameless", first_air_date: "2004-01-13" }, { id: 2, name: "Shameless", first_air_date: "2011-01-09" }] });
  assert.equal(yr?.id, "2");
});

test("vod: panel 'busy' (503) is retried instead of marking the series as an error", async () => {
  const { XtreamClient } = await import("../../src/core/vod.js");
  let n = 0;
  const http = async () => {
    n++;
    return n < 3 ? { status: 503, ok: false, text: "busy", json: null, headers: {}, durationMs: 1 } : { status: 200, ok: true, text: "", json: { episodes: { "1": [{ season: 1, episode_num: 2 }] }, info: { name: "Dark", o_name: "Dark", releaseDate: "2017-12-01" } }, headers: {}, durationMs: 1 };
  };
  const x = new XtreamClient("http://p.example", "u", "p", http, async () => undefined);
  const info = await x.seriesInfo("7");
  assert.equal(n, 3);
  assert.deepEqual(info.episodes, [{ s: 1, e: 2 }]);
  assert.equal(info.year, "2017");
  assert.deepEqual(info.names, ["Dark"]);
});
