/**
 * Background worker: run with `npm run worker` (Docker service "worker").
 * Queues: activation, maxplayer, email, maintenance (repeatable sweeps).
 */
import { Job, Worker } from "bullmq";
import { activateMaxPlayer, activateOrder, PackageSnapshot } from "@/core/activation/engine";
import { daysUntil, formatEmailDate } from "@/core/dates";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { redis } from "@/lib/redis";
import { sendTemplatedEmail } from "@/lib/mailer";
import { audit } from "@/lib/audit";
import { accessDetailsEmail } from "@/lib/customerEmails";
import { refreshPublicUrl } from "@/lib/publicUrl";
import { maxPlayerClientFactory, PrismaActivationStore, PrismaMaxPlayerStore, prismaPanelFactory } from "@/lib/activationStore";
import { EmailJob, enqueueActivation, enqueueEmail, enqueueMaxPlayer, enqueueVodScan, maintenanceQueue, maxPlayerQueueSize, QUEUE_ACTIVATION, QUEUE_EMAIL, QUEUE_MAINTENANCE, QUEUE_MAXPLAYER, QUEUE_VOD } from "@/lib/queue";
import { scanReseller } from "@/lib/vod";
import { dailySummary, notifyActivation, notifyReseller } from "@/lib/telegram";
import { storeBaseUrl } from "@/lib/urls";
import { platformBillingEnabled } from "@/lib/settings";

const connection = redis();
const activationStore = new PrismaActivationStore();
const mpStore = new PrismaMaxPlayerStore();

async function sendActivationEmail(orderId: string) {
  await refreshPublicUrl();
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { subscription: true, customer: true, reseller: { include: { maxPlayer: true } } } });
  const sub = o.subscription;
  if (!sub?.expiresAt || !o.notifyCustomer) return;
  const snap = o.packageSnapshot as unknown as PackageSnapshot;
  const portalUrl = `${storeBaseUrl(o.reseller)}/portal`;
  if (o.kind === "RENEWAL" && sub.createdAt < o.createdAt) {
    await sendTemplatedEmail({ resellerId: o.resellerId, template: "subscription_renewed", to: o.customer.email, vars: { packageName: snap.name, expiresAt: formatEmailDate(sub.expiresAt), portalUrl } });
    return;
  }
  // Credentials are rendered here (never stored in Redis job payloads).
  const mail = await accessDetailsEmail(sub.id, { packageName: snap.name, maxPlayerEnabled: snap.maxPlayerEnabled, connections: snap.maxConnections });
  await sendTemplatedEmail({ resellerId: o.resellerId, template: "subscription_activated", to: o.customer.email, vars: mail.vars, extra: mail.extra });
}

const activationWorker = new Worker(
  QUEUE_ACTIVATION,
  async (job: Job<{ orderId: string }>) => {
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const r = await activateOrder(job.data.orderId, { store: activationStore, panelFactory: prismaPanelFactory, isFinalAttempt });
    if (r.status === "failed") {
      if (r.final) {
        await audit({ action: "activation.failed", target: job.data.orderId, meta: { error: r.error } });
        await notifyActivation(job.data.orderId, r);
        return r; // stays ACTIVATION_FAILED, visible for manual retry
      }
      throw new Error(r.error); // BullMQ retries with exponential backoff
    }
    if (r.status === "completed") {
      if (r.maxPlayer) await enqueueMaxPlayer(r.subscriptionId);
      await sendActivationEmail(job.data.orderId).catch((e) => console.error("[worker] activation email failed", e.message));
      if (!r.test) await notifyActivation(job.data.orderId, r);
    }
    return r;
  },
  { connection, concurrency: 5 },
);

/** BullMQ's "rate limited" signal: the job goes back to the queue without using up an attempt. */
function rateLimitError(): Error {
  const W = Worker as unknown as { RateLimitError?: () => Error };
  return typeof W.RateLimitError === "function" ? W.RateLimitError() : new Error("bullmq:rateLimitExceeded");
}

// One account at a time, at most MAXPLAYER_ACCOUNTS_PER_MINUTE per minute, so a big batch ("Create them
// now") never floods MaxPlayer. If MaxPlayer still answers "too many requests", the whole queue pauses
// (Retry-After or 90 s) and the job is tried again without counting as a failed attempt.
const maxPlayerWorker: Worker = new Worker(
  QUEUE_MAXPLAYER,
  async (job: Job<{ subscriptionId: string }>) => {
    const sub = await db.subscription.findUnique({ where: { id: job.data.subscriptionId }, select: { resellerId: true } });
    if (!sub) return { status: "skipped" };
    const r = await activateMaxPlayer(job.data.subscriptionId, { store: mpStore, client: maxPlayerClientFactory(sub.resellerId) });
    if (r.status === "rate_limited") {
      console.warn(`[maxplayer] request limit reached — pausing ${Math.round(r.retryAfterMs / 1000)} s`);
      await maxPlayerWorker.rateLimit(r.retryAfterMs);
      throw rateLimitError();
    }
    if (r.status === "failed" && r.retryable) throw new Error(r.error);
    return r;
  },
  { connection, concurrency: 1, limiter: { max: env.maxPlayerPerMinute, duration: 60_000 } },
);

const emailWorker = new Worker(QUEUE_EMAIL, async (job: Job<EmailJob>) => sendTemplatedEmail(job.data), { connection, concurrency: 5 });

// VOD monitoring: one library scan at a time (each scan reads the panel slowly, 3 requests in parallel).
const vodWorker = new Worker(QUEUE_VOD, async (job: Job<{ resellerId: string }>) => scanReseller(job.data.resellerId), { connection, concurrency: 1, lockDuration: 120_000 });

async function sweep() {
  await refreshPublicUrl(0);
  const now = new Date();
  // 1) Paid orders whose activation job was lost (e.g. Redis was down during the webhook)
  const stuck = await db.order.findMany({
    where: {
      OR: [
        { status: "PAID", paidAt: { lt: new Date(now.getTime() - 3 * 60_000) } },
        { status: "ACTIVATING", lockedUntil: { lt: new Date(now.getTime() - 10 * 60_000) } },
      ],
    },
    select: { id: true },
    take: 100,
  });
  for (const o of stuck) await enqueueActivation(o.id, { retry: true });

  // 1b) Orders held while a reseller was suspended / billing paused, now released
  if (await platformBillingEnabled()) {
    const held = await db.order.findMany({ where: { status: "ON_HOLD", reseller: { status: "ACTIVE", billingEnabled: true } }, select: { id: true }, take: 100 });
    for (const o of held) await enqueueActivation(o.id, { retry: true });
  }

  // 2) Expire subscriptions
  await db.subscription.updateMany({ where: { status: "ACTIVE", expiresAt: { lt: now } }, data: { status: "EXPIRED" } });

  // 3) Expiry reminders (3 days before, once per period; skipped for auto-renewing subscriptions)
  const soon = await db.subscription.findMany({
    where: { status: "ACTIVE", autoRenew: false, reminderSentAt: null, expiresAt: { gt: now, lt: new Date(now.getTime() + 3 * 86_400_000) }, reseller: { status: "ACTIVE" } },
    include: { customer: true, package: true, reseller: true },
    take: 200,
  });
  for (const s of soon) {
    await enqueueEmail({
      resellerId: s.resellerId,
      template: "subscription_expiring",
      to: s.customer.email,
      vars: { packageName: s.package.name, expiresAt: formatEmailDate(s.expiresAt!), daysLeft: String(Math.max(daysUntil(s.expiresAt!, now), 1)), renewUrl: `${storeBaseUrl(s.reseller)}/renew` },
    });
    await db.subscription.update({ where: { id: s.id }, data: { reminderSentAt: now } });
  }

  // 3b) MaxPlayer accounts whose job was lost (e.g. Redis restart) — waiting longer than 10 minutes.
  // Only when the MaxPlayer queue is empty: jobs that are just waiting their turn are not lost.
  if ((await maxPlayerQueueSize().catch(() => 1)) === 0) {
    const mpStuck = await db.subscription.findMany({
      where: { maxPlayerStatus: "PENDING", isTest: false, updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) }, reseller: { status: "ACTIVE", billingEnabled: true } },
      select: { id: true },
      take: 50,
    });
    for (const s of mpStuck) await enqueueMaxPlayer(s.id, { retry: true });
  }

  // 3c) VOD monitoring: daily automatic scan; scans interrupted by a restart are released.
  await db.vodMonitor.updateMany({ where: { status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - 30 * 60_000) } }, data: { status: "ERROR", lastError: "The scan was interrupted (server restart). It runs again automatically." } });
  const vodDue = await db.vodMonitor.findMany({
    where: {
      autoScan: true,
      reseller: { vodMonitorEnabled: true, status: "ACTIVE" },
      OR: [
        { status: { in: ["IDLE", "DONE", "ERROR"] }, OR: [{ lastScanAt: null }, { lastScanAt: { lt: new Date(now.getTime() - 24 * 3600_000) } }] },
        { status: "QUEUED", updatedAt: { lt: new Date(now.getTime() - 6 * 3600_000) } },
      ],
    },
    select: { resellerId: true },
    take: 20,
  });
  for (const v of vodDue) {
    await db.vodMonitor.update({ where: { resellerId: v.resellerId }, data: { status: "QUEUED" } });
    await enqueueVodScan(v.resellerId);
  }

  // 3d) Telegram daily summary for resellers, once a day after 07:00 UTC.
  if (now.getUTCHours() >= 7) {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const due = await db.resellerTelegram.findMany({
      where: { enabled: true, dailySummary: true, chatId: { not: null }, reseller: { status: "ACTIVE" }, OR: [{ lastSummaryAt: null }, { lastSummaryAt: { lt: dayStart } }] },
      select: { id: true, resellerId: true },
      take: 50,
    });
    for (const t of due) {
      await db.resellerTelegram.update({ where: { id: t.id }, data: { lastSummaryAt: now } });
      await notifyReseller(t.resellerId, "summary", await dailySummary(t.resellerId, now)).catch(() => false);
    }
  }

  // 4) SaaS trials / lapsed periods
  await db.saasSubscription.updateMany({ where: { status: "TRIALING", trialEndsAt: { lt: now } }, data: { status: "EXPIRED" } });

  // 5) Housekeeping
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.token.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  await db.apiLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } });
  // Sent-email contents are kept 180 days for the reseller's overview, then only the metadata stays.
  await db.emailLog.updateMany({ where: { createdAt: { lt: new Date(now.getTime() - 180 * 86_400_000) }, body: { not: null } }, data: { body: null } });
}

const maintenanceWorker = new Worker(QUEUE_MAINTENANCE, async () => sweep(), { connection, concurrency: 1 });

for (const w of [activationWorker, maxPlayerWorker, emailWorker, maintenanceWorker, vodWorker]) {
  w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
  w.on("error", (err) => console.error(`[${w.name}]`, err.message));
}

async function main() {
  await maintenanceQueue().upsertJobScheduler("sweep", { every: 2 * 60_000 }, { name: "sweep" });
  console.log(`[worker] started — live panel operations ${env.liveOperationsAllowed ? "ENABLED" : "DISABLED (test mode forced)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function shutdown() {
  console.log("[worker] shutting down");
  await Promise.allSettled([activationWorker.close(), maxPlayerWorker.close(), emailWorker.close(), maintenanceWorker.close(), vodWorker.close()]);
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
