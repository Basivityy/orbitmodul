import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultCeiling, ownership, scanEnd, scanRange, SCAN_TAIL } from "../../src/core/lineScan";
import type { LineInfo } from "../../src/core/adapters/types";

const line = (id: number, member: string | null): LineInfo => ({ id: String(id), username: `u${id}`, password: "p", expiresAt: null, enabled: true, maxConnections: 1, memberId: member });

test("line scan: bounds", () => {
  assert.equal(defaultCeiling(["73736", "100", null, "abc"]), 75736);
  assert.equal(defaultCeiling([]), 0);
  assert.equal(scanEnd({ ceiling: 80000, lastHitId: 10 }), 80000);
  assert.equal(scanEnd({ ceiling: 0, lastHitId: 90000 }), 90000 + SCAN_TAIL);
});

test("line scan: only the reseller's own lines are imported, never unknown owners", () => {
  assert.equal(ownership(line(1, "491"), "491"), "mine");
  assert.equal(ownership(line(1, "7"), "491"), "other");
  assert.equal(ownership(line(1, null), "491"), "unknown");
});

test("line scan: walks the range, imports own lines, resume point and stop", async () => {
  // panel: ids 1..300, every 10th line belongs to 491, ids 50-59 do not exist, others belong to someone else
  const panel = new Map<number, LineInfo>();
  for (let i = 1; i <= 300; i++) if (i < 50 || i > 59) panel.set(i, line(i, i % 10 === 0 ? "491" : "7"));
  const imported: string[] = [];
  const progress: number[] = [];
  const r = await scanRange({
    from: 1, to: 300, memberId: "491", concurrency: 4,
    onProgress: (p) => { progress.push(p.scanned); },
    getLine: async (id) => panel.get(Number(id)) ?? null,
    onMine: async (l) => { imported.push(l.id); return l.id === "100" ? "updated" : "imported"; },
  });
  assert.equal(r.scanned, 300);
  assert.equal(r.found, 29, "30 own ids minus id 50 that does not exist");
  assert.equal(r.updated, 1);
  assert.equal(r.imported, 28);
  assert.equal(r.lastHitId, 300);
  assert.equal(r.nextId, 301);
  assert.ok(!imported.includes("55"));
  assert.deepEqual(progress, [50, 100, 150, 200, 250, 300], "live progress every 50 ids");

  let calls = 0;
  const s = await scanRange({ from: 1, to: 1000, memberId: "491", concurrency: 2, getLine: async () => null, onMine: async () => "skipped", shouldStop: () => ++calls >= 2 });
  assert.equal(s.stopped, true);
  assert.ok(s.scanned >= 100 && s.scanned < 1000);
  assert.equal(s.nextId, s.scanned + 1, "resume exactly after the last finished id");
});
