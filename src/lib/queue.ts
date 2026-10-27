import { Queue } from "bullmq";
import { env } from "./env";
import { redis } from "./redis";

export const QUEUE_ACTIVATION = "activation";
export const QUEUE_MAXPLAYER = "maxplayer";
export const QUEUE_EMAIL = "email";
export const QUEUE_MAINTENANCE = "maintenance";
export const QUEUE_VOD = "vod";
export const QUEUE_LINEIMPORT = "lineimport";
export const QUEUE_WEBHOOK = "webhook";
export const QUEUE_LINESYNC = "linesync";

const g = globalThis as unknown as { queues?: Record<string, Queue> };

function queue(name: string): Queue {
  g.queues ??= {};
  if (!g.queues[name]) g.queues[name] = new Queue(name, { connection: redis() });
  return g.queues[name];
}

/**
 * Enqueue order activation. The deterministic jobId de-duplicates repeated webhooks;
 * admin retries pass a unique suffix. Even if a duplicate job ran, the activation engine's
 * DB lease + status checks make it a no-op.
 */
export async function enqueueActivation(orderId: string, opts: { retry?: boolean } = {}): Promise<void> {
  await queue(QUEUE_ACTIVATION).add(
    "activate",
    { orderId },
    {
      jobId: opts.retry ? `act-${orderId}-r${Date.now()}` : `act-${orderId}`,
      attempts: env.activationAttempts,
      backoff: { type: "exponential", delay: 15_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  );
}

/**
 * Enqueue creating/updating the MaxPlayer account of a subscription. At most one job per subscription
 * waits in the queue (deduplication), so clicking "Retry" / "Create them now" again or the sweeper
 * never multiplies the requests sent to MaxPlayer. The worker sends them at a steady pace.
 */
export async function enqueueMaxPlayer(subscriptionId: string, opts: { retry?: boolean } = {}): Promise<void> {
  await queue(QUEUE_MAXPLAYER).add(
    "maxplayer",
    { subscriptionId },
    {
      jobId: opts.retry ? `mp-${subscriptionId}-r${Date.now()}` : `mp-${subscriptionId}-${Math.floor(Date.now() / 60_000)}`,
      deduplication: { id: `mp-${subscriptionId}` },
      attempts: 6,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  );
}

/** MaxPlayer jobs still to run (waiting, paused by the request limit, retrying later, running). */
export async function maxPlayerQueueSize(): Promise<number> {
  const c = await queue(QUEUE_MAXPLAYER).getJobCounts("waiting", "prioritized", "delayed", "active", "paused");
  return Object.values(c as Record<string, number>).reduce((a, b) => a + (b || 0), 0);
}

export interface EmailJob {
  resellerId: string | null;
  template: string;
  to: string;
  vars: Record<string, string>;
  /** Extra block appended to the email (e.g. the app guide). */
  extra?: { text: string; html: string };
}

export async function enqueueEmail(job: EmailJob): Promise<void> {
  await queue(QUEUE_EMAIL).add("email", job, { attempts: 5, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 1000, removeOnFail: { age: 14 * 24 * 3600 } });
}

/** VOD library scan of one reseller — at most one waiting per reseller. */
export async function enqueueVodScan(resellerId: string): Promise<void> {
  await queue(QUEUE_VOD).add(
    "scan",
    { resellerId },
    { jobId: `vod-${resellerId}-${Date.now()}`, deduplication: { id: `vod-${resellerId}` }, attempts: 1, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 14 * 24 * 3600 } },
  );
}

/** Next chunk of an "Import all my lines" scan. */
export async function enqueueLineImport(importId: string, delayMs = 0): Promise<void> {
  // No deduplication: the running chunk queues the next one. Double runs are prevented by the
  // atomic QUEUED → RUNNING claim in runLineImportChunk.
  await queue(QUEUE_LINEIMPORT).add("chunk", { importId }, { jobId: `li-${importId}-${Date.now()}`, delay: delayMs, attempts: 1, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
}

/** Event for the reseller's website — retried with backoff (about 1 day in total). */
export async function enqueueWebhook(job: { resellerId: string; id: string; event: string; created: string; data: Record<string, unknown> }): Promise<void> {
  await queue(QUEUE_WEBHOOK).add("deliver", job, { jobId: job.id, attempts: 8, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: { age: 3 * 24 * 3600 }, removeOnFail: { age: 14 * 24 * 3600 } });
}

/** "Refresh from panel" for one reseller (at most one waiting per reseller). */
export async function enqueueLineSync(resellerId: string): Promise<void> {
  await queue(QUEUE_LINESYNC).add("sync", { resellerId }, { jobId: `ls-${resellerId}-${Date.now()}`, deduplication: { id: `ls-${resellerId}` }, attempts: 1, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
}

export function maintenanceQueue(): Queue {
  return queue(QUEUE_MAINTENANCE);
}
