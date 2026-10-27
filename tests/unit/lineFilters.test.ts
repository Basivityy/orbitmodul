import { test } from "node:test";
import assert from "node:assert/strict";
import { filterQuery, lineWhere, parseLineFilter, statusWhere } from "../../src/core/lineFilters";

test("line filters: parsing with safe defaults and old ?show= links", () => {
  assert.deepEqual(parseLineFilter({}), { kind: "line", status: "all", q: "", pkg: "", conn: null, sort: "expiry_desc" });
  const f = parseLineFilter({ kind: "mag", status: "active", q: " ernad ", conn: "2", sort: "username", pkg: "clx1234567890" });
  assert.equal(f.kind, "mag");
  assert.equal(f.status, "active");
  assert.equal(f.q, "ernad");
  assert.equal(f.conn, 2);
  assert.equal(f.pkg, "clx1234567890");
  assert.equal(parseLineFilter({ kind: "evil", status: "x", conn: "-1", pkg: "'; drop" }).kind, "line");
  assert.equal(parseLineFilter({ show: "devices" }).kind, "any");
  assert.equal(parseLineFilter({ show: "trial" }).status, "trial");
});

test("line filters: status meanings match the panel", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  assert.deepEqual(statusWhere("active", now), { status: "ACTIVE", panelTrial: false, expiresAt: { gt: now } });
  assert.deepEqual(statusWhere("unlimited", now), { status: "ACTIVE", panelTrial: false, expiresAt: null });
  assert.deepEqual(statusWhere("all", now), {});
  const w = lineWhere("r1", parseLineFilter({ kind: "any", conn: "2" }), now) as { AND: unknown[] };
  assert.equal(w.AND.length, 4, "base + kind + status + connections");
});

test("line filters: links keep the other filters", () => {
  const f = parseLineFilter({ kind: "mag", q: "adi" });
  assert.equal(filterQuery(f, { status: "inactive" }), "?kind=mag&status=inactive&q=adi");
  assert.equal(filterQuery(parseLineFilter({})), "");
});
