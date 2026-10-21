process.env.ALLOW_PRIVATE_PANEL_URLS = "true"; // mocks run on 127.0.0.1
import { test } from "node:test";
import assert from "node:assert/strict";
import { activateMaxPlayer, activateOrder, PackageSnapshot } from "../../src/core/activation/engine";
import { createPanelAdapter, XuiOneAdapter } from "../../src/core/adapters/xui";
import { MaxPlayerClient, MaxPlayerError } from "../../src/core/adapters/maxplayer";
import { startMaxPlayerMock, startXuiMock } from "../mocks/servers";
import { MemoryActivationStore, MemoryMaxPlayerStore } from "../mocks/memoryStore";

const KEY = "K-test";
const snap: PackageSnapshot = { packageId: "p1", name: "Basic", durationDays: 30, maxConnections: 1, bouquetIds: ["1", "2"], maxPlayerEnabled: true, priceMinor: 1000, currency: "EUR", billingType: "ONE_TIME" };
const factory = (p: any) => createPanelAdapter(p.type, p.config, { testMode: p.testMode });
const NOW = new Date("2026-10-11T10:00:00Z");

test("paid order → exactly one line with package bouquets and expiry", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "o1", snapshot: snap });
    const r = await activateOrder("o1", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "completed");
    assert.equal(xui.createCalls(), 1);
    const line = Array.from(xui.lines.values())[0];
    assert.equal(line.bouquet, "[1,2]");
    assert.equal(Number(line.exp_date), Math.floor(new Date("2026-11-10T10:00:00Z").getTime() / 1000));
    const sub = Array.from(store.subs.values())[0];
    assert.equal(sub.lineUsername, line.username);
    assert.equal(sub.linePassword, line.password);
    // Re-running (duplicate webhook / duplicate job) is a no-op
    assert.equal((await activateOrder("o1", { store, panelFactory: factory, now: () => NOW })).status, "already_completed");
    assert.equal(xui.createCalls(), 1);
  } finally {
    await xui.close();
  }
});

test("concurrent workers: lease prevents double activation", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "o2", snapshot: snap });
    const [a, b] = await Promise.all([
      activateOrder("o2", { store, panelFactory: factory, now: () => NOW }),
      activateOrder("o2", { store, panelFactory: factory, now: () => NOW }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["completed", "locked"]);
    assert.equal(xui.createCalls(), 1);
  } finally {
    await xui.close();
  }
});

test("panel outage: retryable failure, then success on retry with same credentials", async () => {
  const xui = await startXuiMock(KEY, { failCreateTimes: 2 });
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "o3", snapshot: snap });
    const r1 = await activateOrder("o3", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r1.status, "failed");
    assert.equal((r1 as any).retryable, true);
    const planned = store.orders.get("o3").lineUsername;
    assert.ok(planned);
    await activateOrder("o3", { store, panelFactory: factory, now: () => NOW });
    const r3 = await activateOrder("o3", { store, panelFactory: factory, now: () => new Date(NOW.getTime() + 60_000) });
    assert.equal(r3.status, "completed");
    const sub = Array.from(store.subs.values())[0];
    assert.equal(sub.lineUsername, planned, "retry reuses the planned username");
    assert.equal(sub.expiresAt.toISOString(), "2026-11-10T10:00:00.000Z", "retry reuses the planned expiry");
    assert.equal(xui.lines.size, 1);
  } finally {
    await xui.close();
  }
});

test("crash after panel created the line → retry finds it instead of creating a duplicate", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "o4", snapshot: snap });
    // Simulate: plan saved, line created on panel, then DB write crashed.
    const realComplete = store.completeNew.bind(store);
    store.completeNew = async () => { throw new Error("DB connection lost"); };
    const r1 = await activateOrder("o4", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r1.status, "failed");
    assert.equal(xui.lines.size, 1);
    store.completeNew = realComplete;
    const r2 = await activateOrder("o4", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r2.status, "completed");
    assert.equal(xui.createCalls(), 1, "no second create_line");
    assert.equal(xui.lines.size, 1);
  } finally {
    await xui.close();
  }
});

test("final attempt marks ACTIVATION_FAILED; non-retryable errors fail fast", async () => {
  const store = new MemoryActivationStore({ apiUrl: "http://127.0.0.1:1/resellerapi", apiKey: KEY });
  store.addOrder({ id: "o5", snapshot: snap });
  const r = await activateOrder("o5", { store, panelFactory: factory, now: () => NOW, isFinalAttempt: true });
  assert.equal(r.status, "failed");
  assert.equal(store.orders.get("o5").status, "ACTIVATION_FAILED");
  // admin retry later works on ACTIVATION_FAILED orders (claimable)
  assert.equal(await store.claim("o5", 1000, NOW), true);
});

test("renewal extends from current expiry and re-enables the line", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "o6", snapshot: snap });
    await activateOrder("o6", { store, panelFactory: factory, now: () => NOW });
    const subId = store.orders.get("o6").subscriptionId;
    const lineId = store.subs.get(subId).xuiLineId;
    xui.lines.get(lineId).enabled = 0;
    store.addOrder({ id: "o7", kind: "RENEWAL", subscriptionId: subId, snapshot: snap });
    const later = new Date("2026-10-20T10:00:00Z");
    const r = await activateOrder("o7", { store, panelFactory: factory, now: () => later });
    assert.equal(r.status, "completed");
    assert.equal(store.subs.get(subId).expiresAt.toISOString(), "2026-12-10T10:00:00.000Z", "30 days added to remaining time");
    assert.equal(Number(xui.lines.get(lineId).exp_date), Math.floor(new Date("2026-12-10T10:00:00Z").getTime() / 1000));
    assert.equal(xui.lines.get(lineId).enabled, 1);
    assert.equal(xui.createCalls(), 1);
  } finally {
    await xui.close();
  }
});

test("suspended reseller / global pause → ON_HOLD without any panel call", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.reseller.active = false;
    store.addOrder({ id: "o8", snapshot: snap });
    const r = await activateOrder("o8", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "on_hold");
    assert.equal(xui.calls.length, 0);
    store.reseller.active = true;
    store.platformBillingEnabled = false;
    assert.equal((await activateOrder("o8", { store, panelFactory: factory, now: () => NOW })).status, "on_hold");
    store.platformBillingEnabled = true;
    assert.equal((await activateOrder("o8", { store, panelFactory: factory, now: () => NOW })).status, "completed", "released after re-enable");
  } finally {
    await xui.close();
  }
});

test("unpaid order is never activated", async () => {
  const store = new MemoryActivationStore({ apiUrl: "http://x", apiKey: KEY });
  store.addOrder({ id: "o9", status: "PENDING", snapshot: snap });
  assert.equal((await activateOrder("o9", { store, panelFactory: factory })).status, "not_paid");
});

test("test mode: full flow without touching real lines", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY }, true);
    store.addOrder({ id: "o10", snapshot: snap });
    const r = await activateOrder("o10", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "completed");
    assert.equal((r as any).test, true);
    assert.equal(xui.createCalls(), 0);
  } finally {
    await xui.close();
  }
});

test("MaxPlayer activation: create, idempotent re-run, failure keeps line", async () => {
  const mp = await startMaxPlayerMock("tok");
  try {
    const subs = new Map<string, any>([["s1", { lineUsername: "line1", linePassword: "pw", maxPlayerUserId: null, maxPlayerStatus: "NONE" }]]);
    const store = new MemoryMaxPlayerStore(subs);
    const client = (k: string) => new MaxPlayerClient(k, mp.base);
    assert.equal((await activateMaxPlayer("s1", { store, client })).status, "skipped", "skipped when not connected");
    assert.equal(subs.get("s1").maxPlayerStatus, "FAILED", "the reason is visible to the reseller");
    assert.match(subs.get("s1").maxPlayerError, /not connected/);
    store.integration = { apiKey: "tok", domainId: "1", enabled: false, testMode: false, maxDevices: 2, maxProfiles: null };
    assert.equal((await activateMaxPlayer("s1", { store, client })).status, "skipped", "skipped when switched off");
    assert.match(subs.get("s1").maxPlayerError, /switched off/);
    store.integration = { apiKey: "tok", domainId: "1", enabled: true, testMode: false, maxDevices: 2, maxProfiles: null };
    const r = await activateMaxPlayer("s1", { store, client });
    assert.equal(r.status, "active");
    assert.equal(subs.get("s1").maxPlayerStatus, "ACTIVE");
    const r2 = await activateMaxPlayer("s1", { store, client });
    assert.equal(r2.status, "active");
    assert.equal(mp.users.size, 1);
    // failure path
    subs.set("s2", { lineUsername: "line2", linePassword: "pw", maxPlayerUserId: null });
    store.integration = { ...store.integration!, apiKey: "bad" };
    const r3 = await activateMaxPlayer("s2", { store, client });
    assert.equal(r3.status, "failed");
    assert.equal(subs.get("s2").maxPlayerStatus, "FAILED");
    assert.match(subs.get("s2").maxPlayerError, /401/);
  } finally {
    await mp.close();
  }
});

test("manual customer: reseller-chosen username/password are used on the panel", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "m1", lineUsername: "marko2026", linePassword: "pass1234", snapshot: { ...snap, durationDays: 45 } });
    const r = await activateOrder("m1", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "completed");
    const line = Array.from(xui.lines.values())[0];
    assert.equal(line.username, "marko2026");
    assert.equal(line.password, "pass1234");
    assert.equal(Number(line.exp_date), Math.floor(new Date("2026-11-25T10:00:00Z").getTime() / 1000), "custom 45-day duration");
  } finally {
    await xui.close();
  }
});

test("manual customer: duplicate username on the panel fails without creating anything", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "m2", lineUsername: "taken", linePassword: "pw", snapshot: snap });
    store.addOrder({ id: "m3", lineUsername: "taken", linePassword: "pw", snapshot: snap });
    assert.equal((await activateOrder("m2", { store, panelFactory: factory, now: () => NOW })).status, "completed");
    const r = await activateOrder("m3", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "failed");
    assert.equal((r as any).retryable, false);
    assert.equal(store.orders.get("m3").status, "ACTIVATION_FAILED");
    assert.equal(xui.lines.size, 1);
  } finally {
    await xui.close();
  }
});

test("custom username: retry never takes over another customer's line with the same username", async () => {
  const xui = await startXuiMock(KEY);
  try {
    // Somebody else already owns "marko123" on the panel.
    const other = new XuiOneAdapter({ apiUrl: xui.apiUrl, apiKey: KEY });
    await other.createLine({ username: "marko123", password: "otherpass", maxConnections: 1, expiresAt: new Date("2027-01-01T00:00:00Z"), bouquetIds: ["1"] });
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "oc1", snapshot: snap, lineUsername: "marko123", linePassword: "mypass12", plannedExpiresAt: new Date("2026-11-10T10:00:00Z") });
    const r = await activateOrder("oc1", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "failed");
    assert.match((r as any).error, /already used by another line/);
    const line = Array.from(xui.lines.values())[0];
    assert.equal(line.password, "otherpass");
    assert.equal(line.exp_date, String(Date.parse("2027-01-01T00:00:00Z") / 1000), "other customer's line untouched");
  } finally {
    await xui.close();
  }
});

test("reseller API panel: paid order creates the line from the linked panel package", async () => {
  const xui = await startXuiMock(KEY, { resellerApi: true });
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "or1", snapshot: { ...snap, panelPackageId: "3" }, lineUsername: "ana2026", linePassword: null });
    const r = await activateOrder("or1", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "completed");
    const line = Array.from(xui.lines.values())[0];
    assert.equal(line.username, "ana2026");
    assert.equal(line.package_id, "3");
  } finally {
    await xui.close();
  }
});

test("existing panel customer (imported, no MaxPlayer) renews via reseller API: same line extended, no MaxPlayer account", async () => {
  const xui = await startXuiMock(KEY, { resellerApi: true, now: () => NOW.getTime() });
  try {
    xui.lines.set("777", { id: "777", username: "staricustomer", password: "starapw", exp_date: String(Math.floor(Date.parse("2026-10-15T10:00:00Z") / 1000)), enabled: "1" });
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.subs.set("imp1", { id: "imp1", status: "ACTIVE", xuiLineId: "777", lineUsername: "staricustomer", expiresAt: new Date("2026-10-15T10:00:00Z"), maxPlayerStatus: "NONE", maxPlayerUserId: null });
    store.addOrder({ id: "or2", kind: "RENEWAL", subscriptionId: "imp1", snapshot: { ...snap, panelPackageId: "2", maxPlayerEnabled: true } });
    const r = await activateOrder("or2", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "completed");
    assert.equal((r as any).maxPlayer, false, "no MaxPlayer account is created for a line that never had one");
    assert.equal(xui.createCalls(), 0, "no new line");
    assert.equal(xui.extendCalls(), 1);
    assert.equal(xui.lines.get("777").exp_date, String(Math.floor(Date.parse("2026-11-15T10:00:00Z") / 1000)), "panel package (31 days) added to the remaining time");
    assert.equal(store.subs.get("imp1").expiresAt.toISOString(), "2026-11-15T10:00:00.000Z", "billing stores the real panel expiry");
    // Duplicate job → already completed, no second extension.
    await activateOrder("or2", { store, panelFactory: factory, now: () => NOW });
    assert.equal(xui.extendCalls(), 1);
  } finally {
    await xui.close();
  }
});

test("renewal of a line that has MaxPlayer keeps the MaxPlayer step", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "om1", snapshot: snap });
    await activateOrder("om1", { store, panelFactory: factory, now: () => NOW });
    const subId = store.orders.get("om1").subscriptionId;
    store.subs.get(subId).maxPlayerStatus = "ACTIVE";
    store.addOrder({ id: "om2", kind: "RENEWAL", subscriptionId: subId, snapshot: snap });
    const r = await activateOrder("om2", { store, panelFactory: factory, now: () => NOW });
    assert.equal((r as any).maxPlayer, true);
  } finally {
    await xui.close();
  }
});

test("customer-chosen username already exists on the panel (first attempt): line created as username+2 digits, paid order not lost", async () => {
  const xui = await startXuiMock(KEY, { resellerApi: true });
  try {
    xui.lines.set("900", { id: "900", username: "marko2026", password: "someoneelse", exp_date: "1893456000", enabled: "1" });
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "ou1", snapshot: { ...snap, panelPackageId: "2" }, lineUsername: "marko2026", autoRename: true });
    const r = await activateOrder("ou1", { store, panelFactory: factory, now: () => NOW });
    assert.equal(r.status, "completed");
    const sub = Array.from(store.subs.values())[0];
    assert.match(sub.lineUsername, /^marko2026\d{2}$/);
    assert.equal(xui.lines.get("900").password, "someoneelse", "the other customer's line is untouched");
    assert.equal(xui.createCalls(), 2);
  } finally {
    await xui.close();
  }
});

test("manual customer note is written to the line's notes on the panel (reseller API)", async () => {
  const xui = await startXuiMock(KEY, { resellerApi: true });
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    store.addOrder({ id: "on1", snapshot: { ...snap, panelPackageId: "2", panelNote: "paid cash, Samsung TV" }, lineUsername: "note2026x" });
    assert.equal((await activateOrder("on1", { store, panelFactory: factory, now: () => NOW })).status, "completed");
    const line = Array.from(xui.lines.values())[0];
    assert.equal(line.reseller_notes, "paid cash, Samsung TV (ORD-on1)");
  } finally {
    await xui.close();
  }
});

test("MaxPlayer: lines without a real email (codes from the app, loaded lines) are created without the internal placeholder", async () => {
  const mp = await startMaxPlayerMock("tok");
  try {
    const subs = new Map<string, any>([["sx", { lineUsername: "app7k2q9", linePassword: "pw", maxPlayerUserId: null, maxPlayerStatus: "NONE", customerEmail: "app-a7k29qxm4tpl@imported.invalid" }]]);
    const store = new MemoryMaxPlayerStore(subs);
    store.integration = { apiKey: "tok", domainId: "1", enabled: true, testMode: false, maxDevices: null, maxProfiles: null };
    const r = await activateMaxPlayer("sx", { store, client: (k) => new MaxPlayerClient(k, mp.base) });
    assert.equal(r.status, "active");
    const create = mp.calls.find((x) => x.method === "POST" && x.path.endsWith("/users"))!;
    assert.equal(JSON.parse(create.body).user_email, undefined);
  } finally {
    await mp.close();
  }
});

test("MaxPlayer: an account simulated in test mode is created for real once live", async () => {
  const mp = await startMaxPlayerMock("tok");
  try {
    const subs = new Map<string, any>([["t1", { lineUsername: "line9", linePassword: "pw9", maxPlayerUserId: null, maxPlayerStatus: "PENDING" }]]);
    const store = new MemoryMaxPlayerStore(subs);
    const client = (k: string) => new MaxPlayerClient(k, mp.base);
    store.integration = { apiKey: "tok", domainId: "1", enabled: true, testMode: true, maxDevices: null, maxProfiles: null };
    const sim = await activateMaxPlayer("t1", { store, client });
    assert.equal(sim.status, "active");
    assert.match(subs.get("t1").maxPlayerUserId, /^TEST-MP-/);
    assert.equal(mp.users.size, 0, "nothing is created in test mode");
    store.integration = { ...store.integration!, testMode: false };
    const real = await activateMaxPlayer("t1", { store, client });
    assert.equal(real.status, "active");
    assert.equal((real as any).created, true);
    assert.equal(mp.users.size, 1, "the real account exists now");
    assert.doesNotMatch(subs.get("t1").maxPlayerUserId, /^TEST-/);
  } finally {
    await mp.close();
  }
});

test("MaxPlayer: an account deleted on MaxPlayer is created again on retry", async () => {
  const mp = await startMaxPlayerMock("tok");
  try {
    const subs = new Map<string, any>([["d1", { lineUsername: "line5", linePassword: "pw5", maxPlayerUserId: "4999", maxPlayerStatus: "FAILED" }]]);
    const store = new MemoryMaxPlayerStore(subs);
    store.integration = { apiKey: "tok", domainId: "1", enabled: true, testMode: false, maxDevices: null, maxProfiles: null };
    const r = await activateMaxPlayer("d1", { store, client: (k) => new MaxPlayerClient(k, mp.base) });
    assert.equal(r.status, "active");
    assert.equal(mp.users.size, 1);
    assert.notEqual(subs.get("d1").maxPlayerUserId, "4999");
  } finally {
    await mp.close();
  }
});

test("MaxPlayer: a 'too many requests' answer waits instead of failing", async () => {
  const subs = new Map<string, any>([["r1", { lineUsername: "line77", linePassword: "pw", maxPlayerUserId: null, maxPlayerStatus: "PENDING" }]]);
  const store = new MemoryMaxPlayerStore(subs);
  store.integration = { apiKey: "tok", domainId: "1", enabled: true, testMode: false, maxDevices: null, maxProfiles: null };
  const limited = { ensureCustomer: async () => { throw new MaxPlayerError("HTTP 429: Too Many Requests", true, 429, true, 120_000); }, updateList: async () => {} };
  const r = await activateMaxPlayer("r1", { store, client: () => limited });
  assert.equal(r.status, "rate_limited");
  assert.equal((r as any).retryAfterMs, 120_000);
  assert.equal(subs.get("r1").maxPlayerStatus, "PENDING", "stays waiting, not failed");
  assert.match(subs.get("r1").maxPlayerError, /^MaxPlayer request limit reached — waiting 2 min/);
  // a real refusal (not a request limit) still fails
  const refused = { ensureCustomer: async () => { throw new MaxPlayerError("MaxPlayer: user limit reached for your plan", false, 200); }, updateList: async () => {} };
  const f = await activateMaxPlayer("r1", { store, client: () => refused });
  assert.equal(f.status, "failed");
  assert.equal(subs.get("r1").maxPlayerStatus, "FAILED");
});

test("retry long after the first attempt: a new line still gets the full package duration (never born expired)", async () => {
  const xui = await startXuiMock(KEY);
  try {
    const store = new MemoryActivationStore({ apiUrl: xui.apiUrl, apiKey: KEY });
    const now = new Date();
    // First attempt two days ago planned a 1-day line (now over); the line was never created.
    store.addOrder({ id: "late", snapshot: { ...snap, durationDays: 1 }, lineUsername: "late1234", linePassword: "pw123456", plannedExpiresAt: new Date(now.getTime() - 86_400_000) });
    const r = await activateOrder("late", { store, panelFactory: factory, now: () => now });
    assert.equal(r.status, "completed");
    const line = Array.from(xui.lines.values())[0];
    assert.ok(Number(line.exp_date) * 1000 > now.getTime() + 23 * 3600_000, "line lives a full day on the panel");
    assert.ok(store.orders.get("late").plannedExpiresAt.getTime() > now.getTime() + 23 * 3600_000, "plan updated");
  } finally {
    await xui.close();
  }
});
