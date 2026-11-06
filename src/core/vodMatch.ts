/**
 * Finding a panel series on TMDB. Panel titles are messy ("EX-YU | Sulejman Veličanstveni S01 (2011)
 * [SINH]", "TR: Kuzey Güney / Sjever Jug", Cyrillic titles…), so several search titles are tried in
 * turn, results are scored by title similarity (English, Croatian/Serbian and original names) and the
 * year, and the best confident hit wins. Pure logic — the caller supplies the TMDB search.
 */

export interface TmdbHit {
  id: string;
  name: string;
  /** Similarity 0..1 (1 = same title). */
  score: number;
  /** Search title that found it (shown to the reseller). */
  query: string;
}

export interface RawTv {
  id: number | string;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  popularity?: number;
}

export type TvSearch = (query: string, opts: { year: string | null; language: string }) => Promise<RawTv[]>;

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š",
  й: "j", ы: "y", э: "e", ю: "ju", я: "ja", ё: "jo", ъ: "", ь: "", щ: "šč",
};

/** Serbian / Russian Cyrillic → Latin. */
export function cyrToLatin(s: string): string {
  return s.replace(/[Ѐ-ӿ]/g, (ch) => {
    const low = ch.toLowerCase();
    const t = CYR[low];
    if (t === undefined) return ch;
    return ch === low ? t : t.charAt(0).toUpperCase() + t.slice(1);
  });
}

/** "Veličanstveni" → "Velicanstveni", "Đorđe" → "Djordje". */
export function stripDiacritics(s: string): string {
  return s.replace(/đ/g, "dj").replace(/Đ/g, "Dj").replace(/ß/g, "ss").replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Comparison key: lower case, no accents, letters and digits only, no leading article. */
export function normTitle(s: string): string {
  return stripDiacritics(cyrToLatin(s))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^\s*(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice similarity of two titles (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let both = 0;
  for (const [g, n] of bx) both += Math.min(n, by.get(g) ?? 0);
  let d = (2 * both) / (x.length - 1 + (y.length - 1));
  // "Dark" vs "Dark Matter": containment is a decent, not a perfect, match
  if (d < 0.75 && (x.includes(y) || y.includes(x)) && Math.min(x.length, y.length) >= 5) d = 0.75;
  return d;
}

// Tags panels put around titles: languages / regions, providers, quality, dub / subtitles.
const TAG_WORDS = [
  "EX[- ]?YU", "YU", "BALKAN", "REGION", "DOMACE?", "DOMAĆE?", "SRB?", "SRB", "HRV?", "CRO", "BIH", "BOS", "BS", "MNE", "MKD?", "SLO", "SI", "AL", "ALB",
  "EN", "ENG", "UK", "US", "USA", "DE", "GER", "AT", "CH", "FR", "IT", "ES", "PT", "BR", "NL", "PL", "RU", "TR", "TUR", "AR", "IN", "HU", "RO", "BG", "GR", "CZ", "SK", "SE", "NO", "DK", "FI", "KR", "JP", "LAT", "LATAM", "MULTI",
  "NETFLIX", "NF", "HBO(?: ?MAX)?", "MAX", "AMAZON", "PRIME", "AMZN", "DISNEY\\+?", "DSNP", "APPLE ?TV\\+?", "ATVP", "HULU", "PARAMOUNT\\+?", "SKY", "STAR",
  "4K", "UHD", "FHD", "HD", "SD", "HEVC", "H\\.?26[45]", "X26[45]", "1080P?", "720P?", "2160P?",
  "SUB(?:S|BED)?", "TITL(?:OVANO)?", "PREVOD", "SA PREVODOM", "SINH(?:RONIZOVANO|RONIZIRANO|RO)?", "SINKRO(?:NIZOVANO|NIZIRANO)?", "DUB(?:BED)?", "VOSTFR", "NOVO", "NEW",
];
const TAG_RE = new RegExp(`^(?:${TAG_WORDS.join("|")})$`, "i");
/** Only tags (loose: any 2–3 capital letters like "EN", "EXY" also count — used in front of titles). */
const isTag = (s: string, loose = false) => {
  const t = s.trim();
  if (!t) return true;
  return t.split(/[\s/,+]+/).every((w) => !w || TAG_RE.test(w) || (loose && /^[A-Z]{2,3}$/.test(w)));
};
// Bare tag words at the end that are written in capitals ("… HR SUB", "… HD"); providers excluded.
const TRAIL_RE = /\s+(?:EX-?YU|SRB?|HRV?|CRO|BIH|BOS|BS|EN|ENG|TR|SUB|SUBS|TITL|PREVOD|SINH|SINHRO|DUB|HD|FHD|UHD|4K|SD|MULTI|NOVO|NEW)\s*$/;

const SEASON_RE = /\s*(?:[-–|:,]\s*)?(?:\b(?:S|Season|Sezona|Sez\.?|Staffel|Saison|Temporada|Sezon|Сезона)\s*\d{1,2}(?:\s*[-–]\s*(?:S\s*)?\d{1,2})?\b|\b\d{1,2}\.?\s*(?:sezona|season|sezon|staffel)\b|\bS\d{1,2}(?:E\d{1,3})?\b)/gi;
const GENRE_SRC = String.raw`\s*(?:[-–|:]\s*)?\b(?:(?:domaća|domaca|turska|tursk[ai]|španska|spanska|indijska|korejska|meksička|meksicka|strana|animirana|crtana|dokumentarna|mini)\s+serij[ae]|serij[ae]|tv\s*series|tv\s*show|mini[- ]?series|telenovel[ae]|dizi|docu(?:mentary)?)\b`;
const GENRE_RE = new RegExp(GENRE_SRC, "gi");
const GENRE_ONE = new RegExp(GENRE_SRC, "i");

/** Year in the title ("(2008)", "[2008]", "… 2008"). */
export function titleYear(name: string): string | null {
  return name.match(/[([]\s*((?:19|20)\d{2})\s*[)\]]/)?.[1] ?? name.match(/\b((?:19|20)\d{2})\s*$/)?.[1] ?? null;
}

/** Main title with tags, year, season and quality removed. */
export function cleanTitle(name: string): string {
  let t = name.replace(/[★☆●•✪⭐🔥|]+/g, (m) => (m.includes("|") ? "|" : " "));
  // bracketed tags anywhere: [4K], (SINH), {EX-YU}, (2008)
  t = t.replace(/[([{]([^)\]}]{0,30})[)\]}]/g, (m, inner: string) => (isTag(inner) || /^\s*(?:19|20)\d{2}\s*$/.test(inner) || GENRE_ONE.test(inner) ? " " : m));
  // leading tags: "EX-YU | ", "EN - ", "TR: ", "|EX| ", "NETFLIX: "
  for (let i = 0; i < 3; i++) {
    const m = t.match(/^\s*\|?\s*([^|:]{1,24}?)\s*(?:\||:|\s[-–]\s|\b-\s)\s*/);
    if (m && isTag(m[1], true) && t.length - m[0].length >= 2) t = t.slice(m[0].length);
    else break;
  }
  // trailing tags: " | EX-YU", " - SINH"
  for (let i = 0; i < 3; i++) {
    const m = t.match(/\s*(?:\||\s[-–]\s|:)\s*([^|:]{1,24})\s*$/);
    if (m && isTag(m[1]) && t.length - m[0].length >= 2) t = t.slice(0, t.length - m[0].length);
    else break;
  }
  for (let i = 0; i < 3 && TRAIL_RE.test(t); i++) t = t.replace(TRAIL_RE, "");
  t = t
    .replace(SEASON_RE, " ")
    .replace(GENRE_RE, " ")
    .replace(/[([]\s*(?:19|20)\d{2}\s*[)\]]/g, " ")
    .replace(/\b(?:4K|UHD|FHD|HEVC|H\.?26[45]|x26[45]|1080p|720p|2160p|MULTI|SUB(?:S|BED)?|DUBBED|VOSTFR)\b/gi, " ")
    .replace(/[([{]\s*[)\]}]/g, " ")
    .replace(/^\s*[|:\-–]+|[|:\-–,]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const y = titleYear(name);
  if (y) t = t.replace(new RegExp(`\\s*\\b${y}\\s*$`), "").trim();
  return t.replace(/^\s*[|:\-–]+|[|:\-–,]+\s*$/g, "").trim() || name.trim();
}

/**
 * Search titles to try, best first: the clean title, its parts ("Kuzey Güney / Sjever Jug",
 * "Title: Subtitle", "Title aka Other"), Latin for Cyrillic, without accents, "&" ↔ "and".
 */
export function titleCandidates(name: string, extra: string[] = []): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    const v = (s ?? "").replace(/\s{2,}/g, " ").trim();
    if (v.length < 2 || !/[\p{L}\p{N}]/u.test(v)) return;
    if (!out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  for (const raw of [name, ...extra]) {
    const c = cleanTitle(raw);
    add(c);
    if (/[Ѐ-ӿ]/.test(c)) add(cyrToLatin(c));
    for (const part of c.split(/\s+\/\s+|\s+\|\s+|\s+(?:aka|a\.k\.a\.)\s+/i)) add(cleanTitle(part));
    // "Igra prijestolja (Game of Thrones)": both titles
    const inner = c.match(/^(.+?)\s*[([]([^)\]]{2,60})[)\]]\s*$/);
    if (inner) {
      add(inner[1]);
      add(inner[2]);
    }
    const main = c.split(/\s*:\s+|\s+[-–]\s+/)[0];
    add(main);
    const strip = stripDiacritics(cyrToLatin(c));
    add(strip);
    if (/&/.test(c)) add(c.replace(/\s*&\s*/g, " and "));
    else if (/\band\b/i.test(c)) add(c.replace(/\s+and\s+/gi, " & "));
    add(c.replace(/^(the|a|an)\s+/i, ""));
  }
  return out.slice(0, 8);
}

function scoreHit(tv: RawTv, query: string, names: string[], year: string | null): number {
  const titles = [tv.name, tv.original_name].filter(Boolean) as string[];
  let s = 0;
  for (const t of titles) for (const n of [query, ...names]) s = Math.max(s, titleSimilarity(t, n));
  const y = tv.first_air_date?.slice(0, 4);
  if (year && y) {
    const diff = Math.abs(Number(y) - Number(year));
    if (diff === 0) s += 0.08;
    else if (diff > 2) s -= 0.12;
  }
  return Math.max(0, Math.min(1, s));
}

/** Confident enough to stop searching. */
export const SURE = 0.9;
/** Good enough to take as the match. */
export const GOOD = 0.6;

/**
 * Tries the search titles in turn (with the year, then without; English names, then
 * Croatian / Serbian names when English does not look like the title) and returns the best hit.
 */
export async function findTv(name: string, opts: { year: string | null; search: TvSearch; extraNames?: string[]; maxRequests?: number }): Promise<TmdbHit | null> {
  const year = opts.year ?? titleYear(name);
  const candidates = titleCandidates(name, opts.extraNames ?? []);
  const langs = ["en-US", "hr-HR", "sr-RS"];
  let budget = opts.maxRequests ?? 16;
  let best: TmdbHit | null = null;
  let fallback: TmdbHit | null = null;
  let fallbackOnly = false;
  const seen = new Set<string>();

  const run = async (query: string, y: string | null, language: string): Promise<RawTv[]> => {
    const key = `${query.toLowerCase()}|${y ?? ""}|${language}`;
    if (seen.has(key) || budget <= 0) return [];
    seen.add(key);
    budget--;
    return opts.search(query, { year: y, language });
  };

  for (const q of candidates) {
    for (const language of langs) {
      let results = year ? await run(q, year, language) : [];
      if (!results.length) results = await run(q, null, language);
      if (!results.length) break; // other languages find the same shows, only the names differ
      for (const tv of results.slice(0, 10)) {
        const hit: TmdbHit = { id: String(tv.id), name: String(tv.name || tv.original_name || q), score: scoreHit(tv, q, candidates, year), query: q };
        if (!best || hit.score > best.score) best = hit;
      }
      if (!fallback) {
        const top = results[0];
        fallback = { id: String(top.id), name: String(top.name || top.original_name || q), score: scoreHit(top, q, candidates, year), query: q };
        fallbackOnly = results.length === 1;
      }
      if (best && best.score >= SURE) return best;
    }
    if (budget <= 0) break;
  }
  if (best && best.score >= GOOD) return best;
  // Nothing looks like the title in any language: the first result of the clean title (TMDB also
  // matches translated and "also known as" titles, which it does not return), if it is not far off.
  if (fallback && (fallback.score >= 0.35 || fallbackOnly)) return fallback;
  return null;
}
