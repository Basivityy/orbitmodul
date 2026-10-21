import http from "http";
import { AddressInfo } from "net";

export interface MockServer {
  url: string;
  close(): Promise<void>;
  calls: Array<{ method: string; path: string; query: URLSearchParams; body: string; headers: http.IncomingHttpHeaders }>;
}

export function startServer(handler: (req: { method: string; path: string; query: URLSearchParams; body: string; headers: http.IncomingHttpHeaders }) => { status?: number; json?: any; text?: string } | Promise<{ status?: number; json?: any; text?: string }>): Promise<MockServer> {
  const calls: MockServer["calls"] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const u = new URL(req.url ?? "/", "http://x");
      const r = { method: req.method ?? "GET", path: u.pathname, query: u.searchParams, body, headers: req.headers };
      calls.push(r);
      try {
        const out = await handler(r);
        res.writeHead(out.status ?? 200, { "Content-Type": out.text !== undefined ? "text/plain" : "application/json" });
        res.end(out.text !== undefined ? out.text : JSON.stringify(out.json ?? {}));
      } catch (e: any) {
        res.writeHead(500);
        res.end(String(e?.message));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** In-memory XUI One API implementing the documented actions used by the adapter. */
export async function startXuiMock(apiKey: string, opts: { failCreateTimes?: number; resellerApi?: boolean; now?: () => number; trialIgnoresExpiry?: "create" | "always"; misparsesDate?: boolean } = {}) {
  const lines = new Map<string, any>();
  let extendCalls = 0;
  let nextId = 100;
  let createFailures = opts.failCreateTimes ?? 0;
  const bouquets = [
    { id: 1, bouquet_name: "Sports" },
    { id: 2, bouquet_name: "Movies" },
    { id: 3, bouquet_name: "Kids" },
  ];
  const server = await startServer(({ path, query, body, method }) => {
    if (!path.startsWith(opts.resellerApi ? "/resellerapi" : "/adminapi")) return { status: 404, text: "not found" };
    if (query.get("api_key") !== apiKey) return { json: { status: "STATUS_FAILURE", error: "Invalid API key" } };
    const form = new URLSearchParams(body);
    const action = query.get("action");
    if (opts.resellerApi) {
      // Behaves like the real XUI One reseller API: no bouquet/get_packages actions.
      if (action === "get_bouquets" || action === "get_packages") return { json: { status: "STATUS_FAILURE", error: "Invalid action." } };
      if (action === "packages") return { json: { status: "STATUS_SUCCESS", data: [{ id: "2", package_name: "FULL 1M", bouquets: "[1,2,3,142]" }, { id: "3", package_name: "FULL 2M", bouquets: "[3,5]" }, { id: "7", package_name: "TEST 24H", official_duration: 0, official_duration_in: "hours", trial_duration: "24", trial_duration_in: "hours", bouquets: "[1]", is_trial: 0 }, { id: "8", package_name: "BROKEN 0H", official_duration: 0, official_duration_in: "hours", trial_duration: 0, trial_duration_in: "hours", bouquets: "[1]", is_trial: 0 }] } };
      if (action === "edit_line") {
        // Reseller API: applying a package adds its duration to the line (from now if expired).
        const l = lines.get(form.get("id") ?? "");
        if (!l) return { json: { status: "STATUS_FAILURE", error: "Line not found" } };
        const isTrial = query.get("trial") === "1" || form.get("trial") === "1"; // live reseller API: `trial`, not `is_trial`
        const days: Record<string, number> = { "2": 31, "3": 60, "7": isTrial ? 1 : 0 }; // live: package 2 adds 31 days
        const pk = form.get("package") ?? "";
        if (days[pk] === undefined) return { json: { status: "STATUS_INVALID_PACKAGE" } };
        const base = Math.max(Number(l.exp_date) * 1000, opts.now?.() ?? Date.now());
        l.exp_date = String(Math.floor((base + days[pk] * 86400_000) / 1000));
        l.package_id = pk;
        extendCalls++;
        return { json: { status: "STATUS_SUCCESS", data: l } };
      }
      if (action === "create_line") {
        // Live reseller API: lines come from a panel package; without a valid one → STATUS_INVALID_PACKAGE.
        const pkgs: Record<string, string> = { "2": "[1,2,3,142]", "3": "[3,5]", "7": "[1]", "8": "[1]" };
        const pk = form.get("package") ?? "";
        if (!pkgs[pk]) return { json: { status: "STATUS_INVALID_PACKAGE", data: Object.fromEntries(form) } };
        const username = form.get("username");
        if (Array.from(lines.values()).some((l) => l.username === username)) return { json: { status: "STATUS_EXISTS_USERNAME" } };
        const id = String(nextId++);
        // Package 7 (TEST 24H) has only a trial duration: as a normal line it would be born expired.
        // Like the live reseller API, only `trial=1` makes a trial line (`is_trial` is ignored).
        const isTrial = query.get("trial") === "1" || form.get("trial") === "1";
        const secs = pk === "8" ? 0 : pk === "7" ? (isTrial ? 86400 : 0) : 30 * 86400;
        lines.set(id, { id, member_id: "7", username, password: form.get("password"), exp_date: String(Math.floor(Date.now() / 1000) + secs), max_connections: "1", bouquet: pkgs[pk], allowed_outputs: "[1,2,3]", is_trial: isTrial ? 1 : 0, enabled: "1", package_id: pk, reseller_notes: form.get("reseller_notes") ?? "" });
        return { json: { status: "STATUS_SUCCESS", data: { id } } };
      }
    }
    switch (action) {
      case "user_info":
        return { json: { status: "STATUS_SUCCESS", data: { id: 7, username: "reseller1", credits: "250" } } };
      case "get_bouquets":
        return { json: { status: "STATUS_SUCCESS", data: bouquets } };
      case "get_packages":
        return { json: [
          { id: "5", package_name: "1 Month", official_duration: "31", official_duration_in: "days", official_credits: 1, max_connections: "1", bouquets: "[1,2]", is_trial: 0 },
          { id: "6", package_name: "2 Months 2con", official_duration: "2", official_duration_in: "months", official_credits: 2, max_connections: "2", bouquets: "[1,2,3]", is_trial: 0 },
          { id: "7", package_name: "TEST 24H", official_duration: 0, official_duration_in: "hours", trial_duration: "24", trial_duration_in: "hours", official_credits: 0, max_connections: "1", bouquets: "[1]", is_trial: 0 },
        ] };
      case "get_lines": {
        // Like the live panel: max 50 rows per call, paged with start/limit, optional search.
        const search = query.get("search");
        const all = Array.from(lines.values()).filter((l) => !search || String(l.username).includes(search));
        const start = Number(query.get("start") ?? 0);
        const limit = Math.min(Number(query.get("limit") ?? 50), 50);
        return { json: { status: "STATUS_SUCCESS", data: all.slice(start, start + limit) } };
      }
      case "get_line": {
        const l = lines.get(query.get("id") ?? "");
        return l ? { json: { status: "STATUS_SUCCESS", data: l } } : { json: { status: "STATUS_FAILURE", error: "Line not found" } };
      }
      case "create_line": {
        if (method !== "POST") return { json: { status: "STATUS_FAILURE", error: "POST required" } };
        if (createFailures > 0) {
          createFailures--;
          return { status: 503, text: "Service Unavailable" };
        }
        // Live panel behaviour: exp_date must be "YYYY-MM-DD HH:MM", bouquets_selected a JSON string.
        const exp = form.get("exp_date") ?? "";
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(exp)) return { json: { status: "STATUS_INVALID_DATE", data: Object.fromEntries(form) } };
        const username = form.get("username");
        if (Array.from(lines.values()).some((l) => l.username === username)) return { json: { status: "STATUS_FAILURE", error: "Username exists" } };
        const id = String(nextId++);
        const line = {
          id,
          member_id: form.get("member_id") ?? "1",
          username,
          password: form.get("password"),
          // Some panels ignore exp_date for trial lines and make them already expired.
          exp_date: opts.misparsesDate ? "2026" : opts.trialIgnoresExpiry && form.get("is_trial") === "1" ? String(Math.floor(Date.now() / 1000)) : String(Date.parse(exp.replace(" ", "T") + ":00Z") / 1000),
          max_connections: form.get("max_connections"),
          bouquet: form.get("bouquets_selected") ?? "[]",
          allowed_outputs: form.get("allowed_outputs") ?? "[]",
          is_trial: Number(form.get("is_trial") ?? 0),
          enabled: "1",
        };
        lines.set(id, line);
        return { json: { status: "STATUS_SUCCESS", data: line } };
      }
      case "edit_line": {
        const l = lines.get(form.get("id") ?? "");
        if (!l) return { json: { status: "STATUS_FAILURE", error: "Line not found" } };
        const exp = form.get("exp_date");
        if (opts.misparsesDate && exp) {
          // Panel that reads exp_date as a number: "2026-10-15 10:00" → 2026 (1970 = expired), unix seconds work.
          l.exp_date = /^\d+$/.test(exp) ? exp : "2026";
          return { json: { status: "STATUS_SUCCESS", data: l } };
        }
        if (exp && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(exp)) return { json: { status: "STATUS_INVALID_DATE" } };
        // Emulate panels that reset omitted selectors on edit.
        l.bouquet = form.get("bouquets_selected") ?? "[]";
        l.allowed_outputs = form.get("allowed_outputs") ?? "[]";
        l.member_id = form.get("member_id") ?? "1";
        if (exp) l.exp_date = opts.trialIgnoresExpiry === "always" && form.get("is_trial") === "1" ? String(Math.floor(Date.now() / 1000)) : String(Date.parse(exp.replace(" ", "T") + ":00Z") / 1000);
        if (form.get("is_trial") !== null) l.is_trial = Number(form.get("is_trial"));
        if (form.get("max_connections")) l.max_connections = form.get("max_connections");
        return { json: { status: "STATUS_SUCCESS", data: l } };
      }
      case "delete_line": {
        const id = form.get("id") ?? query.get("id") ?? "";
        if (!lines.has(id)) return { json: { status: "STATUS_FAILURE", error: "Line not found" } };
        lines.delete(id);
        return { json: { status: "STATUS_SUCCESS" } };
      }
      case "enable_line":
      case "disable_line": {
        const l = lines.get(form.get("id") ?? "");
        if (!l) return { json: { status: "STATUS_FAILURE", error: "Line not found" } };
        l.enabled = action === "enable_line" ? 1 : 0;
        return { json: { status: "STATUS_SUCCESS" } };
      }
      default:
        return { json: { status: "STATUS_FAILURE", error: "Invalid action" } };
    }
  });
  return { ...server, apiUrl: server.url + (opts.resellerApi ? "/resellerapi" : "/adminapi"), lines, extendCalls: () => extendCalls, createCalls: () => server.calls.filter((c) => c.query.get("action") === "create_line").length };
}

/** In-memory MaxPlayer public API (documented endpoints). */
export async function startMaxPlayerMock(token: string, opts: { bearerOnly?: boolean } = {}) {
  const users = new Map<string, any>();
  let nextId = 5000;
  const server = await startServer(({ method, path, body, headers, query }) => {
    const ok = opts.bearerOnly ? headers["authorization"] === `Bearer ${token}` : headers["api-token"] === token;
    if (!ok) return { status: 401, json: { error: "Invalid token" } };
    const p = path.replace(/^\/v3\/api\/public/, "");
    const b = body ? JSON.parse(body) : {};
    if (method === "GET" && p === "/status") return { json: { active: true, expires_at: "2027-01-01" } };
    if (method === "GET" && p === "/users") {
      // Paged like the real API: limit + after_id.
      const limit = Number(query.get("limit") ?? 100);
      const after = Number(query.get("after_id") ?? 0);
      const all = Array.from(users.values()).sort((a, b) => Number(a.id) - Number(b.id)).filter((u) => Number(u.id) > after);
      return { json: all.slice(0, limit) };
    }
    if (method === "GET" && p === "/domains") return { json: [{ id: 1, domain: "line.example.com", label: "Main" }] };
    if (method === "POST" && p === "/users/search") return { json: { data: Array.from(users.values()).filter((u) => !b.username || u.username.includes(b.username)), has_more: false } };
    if (method === "POST" && p === "/users") {
      if (!b.domain_id || !b.iptv_user || !b.iptv_pass) return { status: 400, json: { error: "missing fields" } };
      const id = String(nextId++);
      users.set(id, { id, username: b.username ?? b.iptv_user, email: b.user_email, lists: [{ domain_id: b.domain_id, iptv_username: b.iptv_user }] });
      return { status: 201, json: { id, username: b.username ?? b.iptv_user } };
    }
    if (method === "PUT" && p === "/users/list") {
      const u = users.get(String(b.user_id));
      if (!u) return { status: 404, json: { error: "not found" } };
      u.lists = [{ domain_id: b.domain_id, iptv_username: b.iptv_username }];
      return { json: { ok: true } };
    }
    const d = p.match(/^\/users\/(\w+)$/);
    if (method === "DELETE" && d) {
      if (!users.has(d[1])) return { status: 404, json: { error: "not found" } };
      users.delete(d[1]);
      return { json: { ok: true } };
    }
    const m = p.match(/^\/customers\/(\w+)$/);
    if (method === "GET" && m) {
      const u = users.get(m[1]);
      return u ? { json: u } : { status: 404, json: { error: "not found" } };
    }
    return { status: 404, json: { error: "unknown route" } };
  });
  return { ...server, base: server.url + "/v3/api/public", users };
}
