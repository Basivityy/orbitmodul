import { Queue } from "bullmq";
import { env } from "./env";
import { redis } from "./redis";

export const QUEUE_ACTIVATION = "activation";
export const QUEUE_MAXPLAYER = "maxplayer";
export const QUEUE_EMAIL = "email";
export const QUEUE_MAINTENANCE = "maintenance";

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

export function maintenanceQueue(): Queue {
  return queue(QUEUE_MAINTENANCE);
}
