process.env.ALLOW_PRIVATE_PANEL_URLS = "true"; // mocks run on 127.0.0.1
import { test } from "node:test";
import assert from "node:assert/strict";
import { bornExpired, chooseTrial, createPanelAdapter, XuiOneAdapter } from "../../src/core/adapters/xui";
import { PanelApiError } from "../../src/core/adapters/types";
import { isRateLimitAnswer, maskApiKey, MaxPlayerClient, retryAfterMs } from "../../src/core/adapters/maxplayer";
import { startMaxPlayerMock, startServer, startXuiMock } from "../mocks/servers";

const KEY = "0000TESTKEY0000000000000000000000-test";

test("XUI adapter: connection, bouquets, packages, credits", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const logs: any[] = [];
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY }, (e) => logs.push(e));
    const info = await a.testConnection();
    assert.equal(info.ok, true);
    assert.equal(info.credits, "250");
    assert.deepEqual(await a.getBouquets(), [{ id: "1", name: "Sports" }, { id: "2", name: "Movies" }, { id: "3", name: "Kids" }]);
    assert.equal((await a.getPackages())[0].name, "1 Month");
    // request format: /adminapi/?api_key=..&action=..
    assert.equal(xui.calls[0].path, "/adminapi/");
    assert.equal(xui.calls[0].query.get("action"), "user_info");
    assert.ok(logs.every((l) => !JSON.stringify(l).includes(KEY)), "api key never logged");
  } finally {
    await xui.close();
  }
});

test("XUI adapter: wrong key gives non-retryable error", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: "WRONG" });
    await assert.rejects(a.testConnection(), (e: any) => e instanceof PanelApiError && e.retryable === false && /Invalid API key/.test(e.message));
  } finally {
    await xui.close();
  }
});

test("XUI adapter: create/extend in the format verified on the live panel", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl + "/", apiKey: KEY, lineOwnerId: "491" });
    const exp = new Date("2026-11-10T00:00:00Z");
    const line = await a.createLine({ username: "abc12345", password: "pw123456", maxConnections: 2, expiresAt: exp, bouquetIds: ["1", "3"] });
    assert.equal(line.lineId, "100");
    const call = xui.calls.find((c) => c.query.get("action") === "create_line")!;
    assert.equal(call.method, "POST");
    const form = new URLSearchParams(call.body);
    assert.equal(form.get("bouquets_selected"), "[1,3]", "JSON string, like the live panel expects");
    assert.equal(form.get("exp_date"), "2026-11-10 00:00", "date string, unix seconds are rejected by the panel");
    assert.equal(form.get("member_id"), "491", "line owner");
    assert.equal(form.get("allowed_outputs"), "[1,2,3]");
    assert.equal(form.get("max_connections"), "2");
    const stored = xui.lines.get("100");
    assert.equal(stored.bouquet, "[1,3]");
    assert.equal(stored.member_id, "491");

    // Extension re-sends the full state: bouquets, owner and outputs survive.
    const newExp = new Date("2026-12-10T00:00:00Z");
    await a.setLineExpiry("100", newExp);
    const after = xui.lines.get("100");
    assert.equal(after.bouquet, "[1,3]");
    assert.equal(after.member_id, "491");
    assert.equal(after.allowed_outputs, "[1,2,3]");
    assert.equal((await a.getLine("100"))?.expiresAt?.toISOString(), newExp.toISOString());

    await a.disableLine("100");
    assert.equal((await a.getLine("100"))?.enabled, false);
    await a.enableLine("100");
    assert.equal((await a.getLine("100"))?.enabled, true);
    assert.equal((await a.findLineByUsername("abc12345"))?.id, "100");
    assert.equal(await a.findLineByUsername("nobody"), null);
    assert.equal(await a.getLine("999"), null);
  } finally {
    await xui.close();
  }
});

test("XUI panel packages: duration, connections, credits, bouquets, trial", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY });
    assert.deepEqual(await a.getPanelPackages(), [
      { id: "5", name: "1 Month", durationDays: 31, credits: 1, maxConnections: 1, bouquetIds: ["1", "2"], isTrial: false },
      { id: "6", name: "2 Months 2con", durationDays: 60, credits: 2, maxConnections: 2, bouquetIds: ["1", "2", "3"], isTrial: false },
      { id: "7", name: "TEST 24H", durationDays: 1, credits: 0, maxConnections: 1, bouquetIds: ["1"], isTrial: true },
    ]);
  } finally {
    await xui.close();
  }
});

test("XUI adapter: 5xx is retryable, HTML response is reported", async () => {
  const s = await startServer(({ query }) => (query.get("action") === "user_info" ? { status: 502, text: "Bad gateway" } : { text: "<html>login</html>" }));
  try {
    const a = new XuiOneAdapter({ apiUrl: s.url, apiKey: KEY });
    await assert.rejects(a.testConnection(), (e: any) => e.retryable === true && e.statusCode === 502);
    await assert.rejects(a.getBouquets(), (e: any) => /non-JSON/.test(e.message));
  } finally {
    await s.close();
  }
});

test("Test mode: reads are real, writes are simulated", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const a = createPanelAdapter("XUI_ONE", { apiUrl: xui.apiUrl, apiKey: KEY }, { testMode: true });
    assert.equal((await a.getBouquets()).length, 3);
    const line = await a.createLine({ username: "u", password: "p", maxConnections: 1, expiresAt: new Date(), bouquetIds: [] });
    assert.ok(line.lineId.startsWith("TEST-"));
    assert.equal(xui.createCalls(), 0, "no real create_line call in test mode");
  } finally {
    await xui.close();
  }
});

test("MaxPlayer client: status, domains, idempotent ensureCustomer", async () => {
  const mp = await startMaxPlayerMock("tok");
  try {
    const c = new MaxPlayerClient("tok", mp.base);
    assert.equal((await c.status()).active, true);
    assert.deepEqual(await c.domains(), [{ id: "1", label: "Main" }]);
    const r1 = await c.ensureCustomer({ domainId: "1", iptvUser: "line1", iptvPass: "pw", email: "a@b.co" });
    assert.equal(r1.created, true);
    const r2 = await c.ensureCustomer({ domainId: "1", iptvUser: "line1", iptvPass: "pw2" });
    assert.equal(r2.created, false);
    assert.equal(r2.id, r1.id);
    assert.equal(mp.users.size, 1, "no duplicate MaxPlayer customers");
    const create = mp.calls.find((x) => x.method === "POST" && x.path.endsWith("/users"))!;
    assert.deepEqual(JSON.parse(create.body), { domain_id: "1", iptv_user: "line1", iptv_pass: "pw", user_email: "a@b.co" });
    assert.equal(create.headers["api-token"], "tok");
    assert.equal((await c.getCustomer(r1.id))?.id, r1.id);
    assert.equal(await c.getCustomer("999"), null);
    await assert.rejects(new MaxPlayerClient("bad", mp.base).status(), /HTTP 401/);
  } finally {
    await mp.close();
  }
});

test("XUI reseller API: bouquets come from `packages` when get_bouquets is not available", async () => {
  const xui = await startXuiMock(KEY, { resellerApi: true });
  try {
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY });
    const b = await a.getBouquets();
    assert.deepEqual(b.map((x) => x.id), ["1", "2", "3", "5", "142"]);
    assert.equal(b[0].placeholder, true);
    assert.equal(b[0].name, "Bouquet #1");
    assert.deepEqual(await a.getPackages(), [{ id: "2", name: "FULL 1M" }, { id: "3", name: "FULL 2M" }, { id: "7", name: "TEST 24H" }, { id: "8", name: "BROKEN 0H" }]);
  } finally {
    await xui.close();
  }
});

test("XUI admin API: bare-array get_bouquets with real names", async () => {
  const s = await startServer(({ query }) => (query.get("action") === "get_bouquets" ? { json: [{ id: "1", bouquet_name: "BIH - BOSNA I HERCEGOVINA", bouquet_channels: "[1,2]" }] } : { json: { status: "STATUS_FAILURE", error: "Invalid action." } }));
  try {
    const a = new XuiOneAdapter({ apiUrl: s.url + "/adminapi", apiKey: KEY });
    assert.deepEqual(await a.getBouquets(), [{ id: "1", name: "BIH - BOSNA I HERCEGOVINA" }]);
  } finally {
    await s.close();
  }
});

test("XUI adapter: delete line (missing line counts as deleted); test mode never deletes", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY, lineOwnerId: "491" });
    const line = await a.createLine({ username: "todelete1", password: "pw123456", maxConnections: 1, expiresAt: new Date("2026-11-10T00:00:00Z"), bouquetIds: ["1"] });
    const sim = createPanelAdapter("XUI_ONE", { apiUrl: xui.apiUrl, apiKey: KEY }, { testMode: true });
    await sim.deleteLine(line.lineId);
    assert.ok(xui.lines.has(line.lineId), "test mode must not delete");
    await a.deleteLine(line.lineId);
    assert.equal(xui.lines.has(line.lineId), false);
    const call = xui.calls.find((c) => c.query.get("action") === "delete_line")!;
    assert.equal(call.method, "POST");
    assert.equal(new URLSearchParams(call.body).get("id"), line.lineId);
    await a.deleteLine(line.lineId); // already gone → no error
  } finally {
    await xui.close();
  }
});

test("MaxPlayer client: delete customer, 404 counts as deleted", async () => {
  const mp = await startMaxPlayerMock("tok");
  try {
    const c = new MaxPlayerClient("tok", mp.base);
    const r = await c.ensureCustomer({ domainId: "1", iptvUser: "del1", iptvPass: "pw" });
    await c.deleteCustomer(r.id);
    assert.equal(mp.users.size, 0);
    await c.deleteCustomer(r.id);
    assert.ok(mp.calls.some((x) => x.method === "DELETE" && x.path.endsWith(`/users/${r.id}`)));
  } finally {
    await mp.close();
  }
});

test("XUI reseller API: line is created from the panel package (package=), username kept", async () => {
  const xui = await startXuiMock(KEY, { resellerApi: true });
  try {
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY });
    assert.equal(a.isResellerApi, true);
    // Without a linked panel package: clear, non-retryable error, no panel call.
    await assert.rejects(a.createLine({ username: "marko123", password: "pw123456", maxConnections: 1, expiresAt: new Date(), bouquetIds: ["1"] }), (e: any) => e instanceof PanelApiError && !e.retryable && /not linked to a package/.test(e.message));
    assert.equal(xui.createCalls(), 0);
    // Wrong package id → the panel's STATUS_INVALID_PACKAGE is reported.
    await assert.rejects(a.createLine({ username: "marko123", password: "pw123456", maxConnections: 1, expiresAt: new Date(), bouquetIds: [], panelPackageId: "99" }), /INVALID_PACKAGE/);
    const line = await a.createLine({ username: "marko123", password: "pw123456", maxConnections: 1, expiresAt: new Date(), bouquetIds: [], panelPackageId: "2" });
    const form = new URLSearchParams(xui.calls.filter((c) => c.query.get("action") === "create_line").pop()!.body);
    assert.equal(form.get("package"), "2");
    assert.equal(form.get("username"), "marko123");
    assert.equal(form.get("exp_date"), null, "reseller API: duration comes from the package");
    assert.equal(form.get("member_id"), null);
    assert.equal(xui.lines.get(line.lineId).username, "marko123", "custom username is created on the panel");
    assert.equal(xui.lines.get(line.lineId).bouquet, "[1,2,3,142]");
    assert.equal(new XuiOneAdapter({ apiUrl: "http://x.tel/adminapi", apiKey: KEY }).isResellerApi, false);
  } finally {
    await xui.close();
  }
});

test("XUI: listLines walks all pages (panel returns max 50 per call); findLineByUsername finds line #120", async () => {
  const xui = await startXuiMock(KEY);
  try {
    for (let i = 1; i <= 120; i++) xui.lines.set(String(1000 + i), { id: String(1000 + i), username: `user${i}`, password: `pw${i}`, exp_date: "1893456000", enabled: "1", max_connections: "1" });
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY });
    const r = await a.listLines();
    assert.equal(r.lines.length, 120);
    assert.equal(r.complete, true);
    assert.equal((await a.findLineByUsername("user120"))?.id, "1120");
    assert.equal((await a.findLineByUsername("user12"))?.id, "1012", "exact match, not substring");
  } finally {
    await xui.close();
  }
});

test("XUI: a panel that ignores paging is reported as incomplete", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), username: `u${i}` }));
  const s = await startServer(() => ({ json: { status: "STATUS_SUCCESS", data: rows } }));
  try {
    const r = await new XuiOneAdapter({ apiUrl: s.url + "/adminapi", apiKey: KEY }).listLines();
    assert.equal(r.lines.length, 50);
    assert.equal(r.complete, false);
  } finally {
    await s.close();
  }
});

test("XUI reseller API: renewal applies the panel package once — a retry never extends twice", async () => {
  const NOW = Date.parse("2026-10-12T10:00:00Z");
  const xui = await startXuiMock(KEY, { resellerApi: true, now: () => NOW });
  try {
    const exp = Math.floor(Date.parse("2026-10-20T10:00:00Z") / 1000);
    xui.lines.set("500", { id: "500", username: "olduser", password: "oldpw", exp_date: String(exp), enabled: "1" });
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY });
    const target = new Date("2026-11-19T10:00:00Z"); // current expiry + 30 days
    await assert.rejects(a.setLineExpiry("500", target, {}), /not linked to a package/);
    const actual = await a.setLineExpiry("500", target, { panelPackageId: "2" });
    assert.equal(xui.extendCalls(), 1);
    assert.equal((actual as Date).toISOString(), "2026-11-20T10:00:00.000Z", "panel added 31 days — the real date is returned");
    const form = new URLSearchParams(xui.calls.filter((c) => c.query.get("action") === "edit_line").pop()!.body);
    assert.equal(form.get("package"), "2");
    assert.equal(form.get("username"), "olduser");
    // Retry after a crash: expiry already reached → no second extension (no double credits).
    await a.setLineExpiry("500", target, { panelPackageId: "2" });
    assert.equal(xui.extendCalls(), 1);
  } finally {
    await xui.close();
  }
});

test("MaxPlayer: iptvUsernames reads all pages (100 per page)", async () => {
  const mp = await startMaxPlayerMock("tok");
  try {
    for (let i = 1; i <= 230; i++) mp.users.set(String(i), { id: String(i), username: `acc${i}`, lists: [{ domain_id: "1", iptv_username: `line${i}` }] });
    const m = await new MaxPlayerClient("tok", mp.base).iptvUsernames();
    assert.equal(m.get("line1"), "1");
    assert.equal(m.get("line230"), "230");
    assert.equal(m.get("acc5"), "5");
    assert.equal(m.has("line231"), false);
    assert.equal(mp.calls.filter((c) => c.method === "GET" && c.path.endsWith("/users")).length, 3);
  } finally {
    await mp.close();
  }
});

test("XUI reseller API: short (1-day) packages are still extended", async () => {
  const NOW = Date.parse("2026-10-12T10:00:00Z");
  const xui = await startXuiMock(KEY, { resellerApi: true, now: () => NOW });
  try {
    xui.lines.set("501", { id: "501", username: "short1", password: "pw", exp_date: String(Math.floor(Date.parse("2026-10-13T10:00:00Z") / 1000)), enabled: "1" });
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY });
    await a.setLineExpiry("501", new Date("2026-10-14T10:00:00Z"), { panelPackageId: "2" });
    assert.equal(xui.extendCalls(), 1);
  } finally {
    await xui.close();
  }
});

test("XUI reseller API (live formats): owner id from user_info, member_id/enabled from get_line, delete_line", async () => {
  const xui = await startXuiMock(KEY, { resellerApi: true });
  try {
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY });
    assert.equal((await a.testConnection()).memberId, "7");
    // Live panel answers enabled as 0 (number) after disable and "1" (string) after enable.
    xui.lines.set("73736", { id: "73736", member_id: "7", username: "billingtest3", password: "Xy7TestPw01", exp_date: "1797146265", enabled: 0 });
    let l = await a.getLine("73736");
    assert.equal(l?.memberId, "7");
    assert.equal(l?.enabled, false);
    assert.equal(l?.expiresAt?.toISOString(), "2026-12-13T07:17:45.000Z");
    xui.lines.get("73736").enabled = "1";
    l = await a.getLine("73736");
    assert.equal(l?.enabled, true);
    await a.deleteLine("73736");
    assert.equal(xui.lines.has("73736"), false);
  } finally {
    await xui.close();
  }
});

test("MaxPlayer: errors sent with HTTP 200 and odd create answers are reported, not swallowed", async () => {
  const srv = await startServer(({ method, path, body }) => {
    const b = body ? JSON.parse(body) : {};
    if (method === "POST" && path.endsWith("/users/search")) return { json: { data: [] } };
    if (method === "POST" && path.endsWith("/users") && b.iptv_user === "bad") return { json: { success: false, message: "Domain not allowed for this reseller" } };
    if (method === "POST" && path.endsWith("/users") && b.iptv_user === "wrapped") return { json: { success: true, data: { user: { id: 77, username: "wrapped" } } } };
    if (method === "POST" && path.endsWith("/users") && b.iptv_user === "list") return { json: { data: [{ id: 78, username: "list" }] } };
    if (method === "POST" && path.endsWith("/users")) return { json: { ok: true } };
    return { status: 404, json: { error: "unknown" } };
  });
  try {
    const c = new MaxPlayerClient("tok-123", srv.url);
    await assert.rejects(c.ensureCustomer({ domainId: "1", iptvUser: "bad", iptvPass: "p" }), /Domain not allowed/);
    assert.deepEqual(await c.ensureCustomer({ domainId: "1", iptvUser: "wrapped", iptvPass: "p" }), { id: "77", created: true });
    assert.deepEqual(await c.ensureCustomer({ domainId: "1", iptvUser: "list", iptvPass: "p" }), { id: "78", created: true });
    await assert.rejects(c.ensureCustomer({ domainId: "1", iptvUser: "noid", iptvPass: "secretpass" }), (e: Error) => /did not return the new account id/.test(e.message) && !e.message.includes("secretpass"));
  } finally {
    await srv.close();
  }
});

test("MaxPlayer: request-limit answers are recognised, plan limits are not", async () => {
  assert.equal(isRateLimitAnswer(429, ""), true);
  assert.equal(isRateLimitAnswer(200, "Rate limit reached, try again later"), true);
  assert.equal(isRateLimitAnswer(403, "Too many requests"), true);
  assert.equal(isRateLimitAnswer(200, "User limit reached for your plan"), false);
  assert.equal(isRateLimitAnswer(400, "missing fields"), false);
  assert.equal(retryAfterMs({ "retry-after": "30" }), 30_000);
  assert.equal(retryAfterMs({ "retry-after": "99999" }), 15 * 60_000, "capped");
  assert.equal(retryAfterMs({}), undefined);
});

test("MaxPlayer: new-style keys work with either auth header, pasted spaces are ignored", async () => {
  const key = "mpk_61e54c72aaaabbbbccccdddd3a28";
  const mp = await startMaxPlayerMock(key, { bearerOnly: true });
  try {
    const c = new MaxPlayerClient(`  ${key}\n`, mp.base);
    assert.deepEqual((await c.domains()).length, 1, "falls back to Authorization: Bearer");
    await c.status();
    const bearerCalls = mp.calls.filter((x) => x.headers["authorization"] === `Bearer ${key}`).length;
    assert.equal(bearerCalls, 2, "the working header is remembered (no second fallback)");
    assert.equal(mp.calls.length, 3);
  } finally {
    await mp.close();
  }
  assert.equal(maskApiKey("mpk_61e54c72aaaabbbbccccdddd3a28"), "mpk_61e54c72…3a28");
  assert.equal(maskApiKey("short-key"), "sho…ey");
});

test("XUI: a 24h test package never creates an already expired line", async () => {
  const day = 86_400_000;
  // Admin API: panel ignores exp_date for the trial line on create → expiry is set again.
  for (const mode of ["create", "always"] as const) {
    const xui = await startXuiMock("k", { trialIgnoresExpiry: mode });
    try {
      const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: "k" });
      const planned = new Date(Date.now() + day);
      const r = await a.createLine({ username: `test${mode}`, password: "pw123456", maxConnections: 1, expiresAt: planned, bouquetIds: ["1"], isTrial: true });
      const line = await a.getLine(r.lineId);
      assert.ok(line!.expiresAt!.getTime() > Date.now() + 23 * 3600_000, `admin/${mode}: line lives ~24h`);
      assert.ok(!bornExpired(line!.expiresAt));
    } finally {
      await xui.close();
    }
  }
  // Reseller API: package 7 has only a trial duration → created as trial even if not marked as trial here.
  const rx = await startXuiMock("k", { resellerApi: true });
  try {
    const a = new XuiOneAdapter({ apiUrl: rx.apiUrl, apiKey: "k" });
    const r = await a.createLine({ username: "trial24h", password: "pw123456", maxConnections: 1, expiresAt: new Date(Date.now() + day), bouquetIds: [], isTrial: false, panelPackageId: "7" });
    assert.ok(r.expiresAt && r.expiresAt.getTime() > Date.now() + 23 * 3600_000, "reseller: 24h line, panel expiry returned");
    const create = rx.calls.find((c) => c.query.get("action") === "create_line")!;
    assert.equal(create.query.get("trial"), "1", "reseller API trial flag is `trial`");
    assert.equal(new URLSearchParams(create.body).get("trial"), "1");
    // a test package marked as trial in billing (the live case: TEST FULL 24H)
    const t = await a.createLine({ username: "trialmarked", password: "pw123456", maxConnections: 1, expiresAt: new Date(Date.now() + day), bouquetIds: [], isTrial: true, panelPackageId: "7" });
    assert.ok(t.expiresAt && t.expiresAt.getTime() > Date.now() + 23 * 3600_000);
    // normal packages stay normal lines
    const n = await a.createLine({ username: "normal31", password: "pw123456", maxConnections: 1, expiresAt: new Date(Date.now() + 30 * day), bouquetIds: [], isTrial: false, panelPackageId: "2" });
    assert.ok(n.expiresAt && n.expiresAt.getTime() > Date.now() + 29 * day);
  } finally {
    await rx.close();
  }
});

test("XUI: trial/normal line type follows the package duration that is set", () => {
  const trialOnly = { official_duration: 0, official_duration_in: "hours", trial_duration: "24", trial_duration_in: "hours" };
  const officialOnly = { official_duration: "24", official_duration_in: "hours", trial_duration: 0, trial_duration_in: "hours" };
  const both = { official_duration: "1", official_duration_in: "months", trial_duration: "24", trial_duration_in: "hours" };
  assert.equal(chooseTrial(false, trialOnly), true);
  assert.equal(chooseTrial(true, officialOnly), false);
  assert.equal(chooseTrial(true, both), true);
  assert.equal(chooseTrial(false, both), false);
  assert.equal(chooseTrial(true, null), true, "unknown package: keep the setting");
  assert.equal(bornExpired(null), false, "no expiry = unlimited");
  assert.equal(bornExpired(new Date(Date.now() - 1000)), true);
});

test("XUI admin API: a panel that misreads the date format still gets a living line (unix time fallback)", async () => {
  const xui = await startXuiMock("k", { misparsesDate: true });
  try {
    const logs: any[] = [];
    const a = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: "k" }, (l) => logs.push(l));
    const r = await a.createLine({ username: "fmt12345", password: "pw123456", maxConnections: 1, expiresAt: new Date(Date.now() + 86_400_000), bouquetIds: ["1"], isTrial: false });
    const line = await a.getLine(r.lineId);
    assert.ok(line!.expiresAt!.getTime() > Date.now() + 23 * 3600_000);
    assert.ok(logs.some((l) => l.action === "check_new_line" && /fixed \(unix time/.test(l.message)), "the fix is visible in the API log");
  } finally {
    await xui.close();
  }
});

test("XUI reseller API: a line the panel makes expired is never left behind", async () => {
  const rx = await startXuiMock("k", { resellerApi: true });
  try {
    const a = new XuiOneAdapter({ apiUrl: rx.apiUrl, apiKey: "k" });
    await assert.rejects(
      a.createLine({ username: "broken01", password: "pw123456", maxConnections: 1, expiresAt: new Date(Date.now() + 86_400_000), bouquetIds: [], isTrial: true, panelPackageId: "8" }),
      /already expired .*removed again/,
    );
    assert.equal(Array.from(rx.lines.values()).filter((l) => l.username === "broken01").length, 0, "dead line deleted, so Retry can use the username again");
  } finally {
    await rx.close();
  }
});

test("XUI adapter: a line switched off by the admin (admin_enabled=0) is not enabled", async () => {
  const srv = await startServer((req) => {
    const id = req.query.get("id");
    const base = { id, username: "u" + id, password: "p", exp_date: "1893456000", max_connections: 1, member_id: 491 };
    if (id === "1") return { json: { status: "STATUS_SUCCESS", data: { ...base, enabled: 1, admin_enabled: 0 } } };
    if (id === "2") return { json: { status: "STATUS_SUCCESS", data: { ...base, enabled: 1, admin_enabled: 1 } } };
    if (id === "3") return { json: { status: "STATUS_SUCCESS", data: { ...base, enabled: 0 } } };
    return { json: { status: "STATUS_SUCCESS", data: { ...base } } };
  });
  try {
    const a = new XuiOneAdapter({ apiUrl: `${srv.url}/resellerapi`, apiKey: KEY });
    assert.equal((await a.getLine("1"))?.enabled, false);
    assert.equal((await a.getLine("2"))?.enabled, true);
    assert.equal((await a.getLine("3"))?.enabled, false);
    assert.equal((await a.getLine("4"))?.enabled, null);
  } finally {
    await srv.close();
  }
});
