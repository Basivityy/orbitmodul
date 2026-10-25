import { decrypt, encrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import type { LineInfo } from "@/core/adapters/types";
import { PanelApiError } from "@/core/adapters/types";
import { placeholderEmail } from "@/core/importedCustomers";
import { AdaptiveThrottle, defaultCeiling, isPanelBusy, SCAN_CHUNK, scanEnd, scanRange } from "@/core/lineScan";
import { panelHost } from "@/core/catalog";
import { db } from "./db";
import { importPackage } from "./lineImport";
import { assertCustomerCapacity, CheckoutError } from "./orders";
import { enqueueLineImport } from "./queue";

export class LineScanError extends Error {}
class PanelBusyError extends Error {}

type Panel = { id: string; type: string; apiUrl: string; apiKeyEnc: string; extraParams: unknown; lineOwnerId: string | null };

function adapterFor(p: Panel) {
  // No API log per request: a scan makes tens of thousands of read calls.
  return createPanelAdapter(p.type, { apiUrl: p.apiUrl, apiKey: decrypt(p.apiKeyEnc), extraParams: (p.extraParams as Record<string, string>) ?? {}, lineOwnerId: p.lineOwnerId }, { testMode: false, log: () => undefined });
}

/** Highest line id known on this panel (all resellers that use the same panel). */
async function knownCeiling(apiUrl: string): Promise<number> {
  const host = panelHost(apiUrl);
  const panels = (await db.panelIntegration.findMany({ select: { id: true, apiUrl: true } })).filter((p) => panelHost(p.apiUrl) === host).map((p) => p.id);
  const subs = await db.subscription.findMany({ where: { panelId: { in: panels }, xuiLineId: { not: null }, isTest: false }, select: { xuiLineId: true }, orderBy: { createdAt: "desc" }, take: 2000 });
  return defaultCeiling(subs.map((s) => s.xuiLineId));
}

/** Starts (or continues) the scan. mode "new" only looks at ids after the previous scan. */
export async function startLineImport(resellerId: string, panelId: string, opts: { mode: "full" | "new" | "continue"; ceiling?: number | null }) {
  const panel = await db.panelIntegration.findFirst({ where: { id: panelId, resellerId } });
  if (!panel) throw new LineScanError("Select your XUI panel.");
  const existing = await db.lineImport.findUnique({ where: { resellerId_panelId: { resellerId, panelId } } });
  if (existing && (existing.status === "RUNNING" || existing.status === "QUEUED")) throw new LineScanError("The import is already running.");
  let memberId: string | null;
  try {
    memberId = (await adapterFor(panel).testConnection()).memberId ?? null;
  } catch (e) {
    throw new LineScanError(`Could not connect to the panel: ${(e as Error).message}`);
  }
  if (!memberId) throw new LineScanError("The panel did not tell which account this API key belongs to — the import cannot tell your lines from others.");
  const ceiling = Math.max(opts.ceiling ?? 0, await knownCeiling(panel.apiUrl), existing?.ceiling ?? 0);
  const startId = opts.mode === "full" || !existing ? 1 : opts.mode === "new" ? Math.max(1, Math.max(existing.nextId, existing.lastHitId) - 2000) : existing.nextId;
  const fresh = opts.mode !== "continue" || !existing;
  const data = {
    status: "QUEUED",
    memberId,
    nextId: startId,
    ceiling,
    lastError: null,
    finishedAt: null,
    ...(fresh ? { scanned: 0, found: 0, imported: 0, updated: 0, startedAt: new Date(), ...(opts.mode === "full" ? { lastHitId: 0 } : {}) } : {}),
  };
  const row = await db.lineImport.upsert({ where: { resellerId_panelId: { resellerId, panelId } }, create: { resellerId, panelId, ...data, lastHitId: 0, startedAt: new Date() }, update: data });
  await enqueueLineImport(row.id);
  return row;
}

export async function stopLineImport(resellerId: string, panelId: string) {
  await db.lineImport.updateMany({ where: { resellerId, panelId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "STOPPED" } });
}

/** Creates or refreshes the billing record of one of the reseller's panel lines. */
async function upsertPanelLine(resellerId: string, panel: Panel, line: LineInfo, ctx: { pkgId: string; currency: string; now: Date }): Promise<"imported" | "updated" | "skipped"> {
  const active = !!line.expiresAt && line.expiresAt > ctx.now && line.enabled !== false;
  const sub = await db.subscription.findFirst({ where: { resellerId, panelId: panel.id, xuiLineId: line.id } });
  if (sub) {
    await db.subscription.update({
      where: { id: sub.id },
      data: {
        expiresAt: line.expiresAt,
        lineUsername: line.username || sub.lineUsername,
        ...(line.password ? { linePasswordEnc: encrypt(line.password) } : {}),
        ...(sub.status === "ACTIVE" || sub.status === "EXPIRED" ? { status: active ? "ACTIVE" : "EXPIRED" } : {}),
      },
    });
    return "updated";
  }
  if (!line.username || !line.password) return "skipped";
  // Same username already in billing on this panel (e.g. an old record without line id): leave it alone.
  if (await db.subscription.findFirst({ where: { resellerId, panelId: panel.id, lineUsername: line.username }, select: { id: true } })) return "skipped";
  const email = placeholderEmail(line.username);
  const customer = await db.customer.upsert({ where: { resellerId_email: { resellerId, email } }, create: { resellerId, email, notes: "Imported from the panel" }, update: {} });
  if (active) await assertCustomerCapacity(resellerId, customer.id, "Your plan's active customer limit is reached — the import stopped.");
  await db.subscription.create({
    data: {
      resellerId,
      customerId: customer.id,
      packageId: ctx.pkgId,
      panelId: panel.id,
      status: active ? "ACTIVE" : "EXPIRED",
      priceCents: 0,
      currency: ctx.currency,
      durationDays: 30,
      expiresAt: line.expiresAt,
      xuiLineId: line.id,
      lineUsername: line.username,
      linePasswordEnc: encrypt(line.password),
    },
  });
  return "imported";
}

/** One worker job: scans the next chunk of ids, then queues the next job until done. */
export async function runLineImportChunk(importId: string): Promise<void> {
  // Atomic claim: only one job runs a scan at a time (a duplicate job finds it RUNNING and leaves).
  const claimed = await db.lineImport.updateMany({ where: { id: importId, status: "QUEUED" }, data: { status: "RUNNING" } });
  if (claimed.count !== 1) return;
  const job = await db.lineImport.findUnique({ where: { id: importId }, include: { panel: true, reseller: { select: { status: true, defaultCurrency: true } } } });
  if (!job) return;
  if (job.reseller.status !== "ACTIVE" || !job.memberId) {
    await db.lineImport.update({ where: { id: job.id }, data: { status: "STOPPED", lastError: "Reseller is not active." } });
    return;
  }
  const adapter = adapterFor(job.panel);
  const pkg = await importPackage(job.resellerId, job.panelId, job.reseller.defaultCurrency);
  const end = scanEnd(job);
  const to = Math.min(job.nextId + SCAN_CHUNK - 1, end);
  // The panel's nginx answers 503 when asked too fast: every parallel request then slows down
  // together (shared throttle) and retries; it speeds up again while the panel answers normally.
  const throttle = new AdaptiveThrottle();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const getLine = async (id: string) => {
    for (let attempt = 0; ; attempt++) {
      const wait = throttle.waitMs();
      if (wait > 0) await sleep(wait);
      try {
        const line = await adapter.getLine(id);
        throttle.ok();
        return line;
      } catch (e) {
        if (isPanelBusy(e)) {
          if (attempt >= 7) throw new PanelBusyError();
          throttle.busy(attempt);
          continue;
        }
        if (attempt >= 2 || !(e instanceof PanelApiError && e.retryable)) throw e;
        await sleep(2000 * (attempt + 1));
      }
    }
  };
  let res;
  try {
    res = await scanRange({
      from: job.nextId,
      to,
      memberId: job.memberId,
      // 4 light get_line calls at a time; slower automatically when the panel says it is busy.
      concurrency: 4,
      getLine,
      onMine: (line) => upsertPanelLine(job.resellerId, job.panel, line, { pkgId: pkg.id, currency: job.reseller.defaultCurrency, now: new Date() }),
      shouldStop: async () => (await db.lineImport.findUnique({ where: { id: job.id }, select: { status: true } }))?.status === "STOPPED",
      // Live progress (absolute values: base of this job + what this chunk did so far).
      onProgress: async (p) => {
        await db.lineImport.update({
          where: { id: job.id },
          data: { nextId: p.nextId, lastHitId: Math.max(job.lastHitId, p.lastHitId), scanned: job.scanned + p.scanned, found: job.found + p.found, imported: job.imported + p.imported, updated: job.updated + p.updated },
        });
      },
    });
  } catch (e) {
    if (e instanceof PanelBusyError) {
      // Panel still overloaded after several minutes of waiting: pause and continue by itself.
      await db.lineImport.update({ where: { id: job.id }, data: { status: "QUEUED", lastError: "The panel is busy (503) — the import pauses and continues automatically in 2 minutes." } });
      await enqueueLineImport(job.id, 120_000);
      return;
    }
    const msg = e instanceof CheckoutError ? e.message : `Panel error: ${String((e as Error).message).slice(0, 300)}. Click “Continue” to resume where it stopped.`;
    await db.lineImport.update({ where: { id: job.id }, data: { status: "ERROR", lastError: msg } });
    return;
  }
  const lastHitId = Math.max(job.lastHitId, res.lastHitId);
  const newEnd = scanEnd({ ceiling: job.ceiling, lastHitId });
  const stoppedByUser = (await db.lineImport.findUnique({ where: { id: job.id }, select: { status: true } }))?.status === "STOPPED";
  const done = !stoppedByUser && res.nextId > newEnd;
  await db.lineImport.update({
    where: { id: job.id },
    data: {
      nextId: res.nextId,
      lastHitId,
      scanned: job.scanned + res.scanned,
      found: job.found + res.found,
      imported: job.imported + res.imported,
      updated: job.updated + res.updated,
      ...(stoppedByUser ? {} : done ? { status: "DONE", finishedAt: new Date(), lastError: null } : { status: "QUEUED", lastError: null }),
    },
  });
  if (!stoppedByUser && !done) await enqueueLineImport(job.id);
}
