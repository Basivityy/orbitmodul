import { randomBytes } from "crypto";
import { decrypt } from "@/core/crypto";
import { httpRequest } from "@/core/http";
import { assertPublicUrl } from "@/core/net";
import { signWebhook, type WebhookEvent } from "@/core/partnerApi";
import { db } from "./db";
import { enqueueWebhook } from "./queue";
import { serializeLine } from "./partnerApi";

/**
 * Webhooks to the reseller's website: a JSON POST signed with their secret
 * (header X-OrbitModul-Signature: t=…,v1=hmac-sha256("t.body")). Retried by the queue.
 */
export interface WebhookJob {
  resellerId: string;
  id: string;
  event: WebhookEvent;
  created: string;
  data: Record<string, unknown>;
}

/** Queues an event if the reseller has an active webhook. Never throws. */
export async function emitWebhook(resellerId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    const w = await db.resellerWebhook.findUnique({ where: { resellerId }, select: { enabled: true, reseller: { select: { partnerApiEnabled: true } } } });
    if (!w?.enabled || !w.reseller.partnerApiEnabled) return;
    await enqueueWebhook({ resellerId, id: `evt_${randomBytes(10).toString("hex")}`, event, created: new Date().toISOString(), data });
  } catch (e) {
    console.error("[webhook] enqueue failed", (e as Error).message);
  }
}

/** Sends one event (worker job, or "Send test event" from the dashboard). Throws on failure → retry. */
export async function deliverWebhook(job: WebhookJob): Promise<{ status: number }> {
  const w = await db.resellerWebhook.findUnique({ where: { resellerId: job.resellerId } });
  if (!w?.enabled) return { status: 0 };
  // Line details (incl. password) are read now — never kept in the queue (Redis).
  let data = job.data;
  if (typeof data.line_id === "string") {
    const sub = await db.subscription.findUnique({ where: { id: data.line_id } });
    data = { ...data, line: sub && sub.resellerId === job.resellerId ? await serializeLine(sub) : null };
  }
  const body = JSON.stringify({ id: job.id, event: job.event, created: job.created, data });
  let status = 0;
  let error: string | null = null;
  try {
    await assertPublicUrl(w.url);
    const r = await httpRequest(w.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "OrbitModul-Webhook/1.0", "X-OrbitModul-Event": job.event, "X-OrbitModul-Delivery": job.id, "X-OrbitModul-Signature": signWebhook(decrypt(w.secretEnc), body) },
      body,
      timeoutMs: 10_000,
    });
    status = r.status;
    if (!r.ok) error = `HTTP ${r.status}`;
  } catch (e) {
    error = (e as Error).message;
  }
  await db.resellerWebhook.update({ where: { id: w.id }, data: { lastSentAt: new Date(), lastStatus: `${job.event}: ${error ?? `OK (${status})`}`.slice(0, 200) } }).catch(() => undefined);
  if (error) throw new Error(`Webhook ${job.event} to ${new URL(w.url).host} failed: ${error}`);
  return { status };
}

/** After an activation job: line.created / line.extended, or activation.failed (final). */
export async function emitActivationWebhook(orderId: string, outcome: { status: string; final?: boolean; error?: string; subscriptionId?: string }): Promise<void> {
  try {
    if (outcome.status !== "completed" && !(outcome.status === "failed" && outcome.final)) return;
    const o = await db.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, kind: true, resellerId: true, subscriptionId: true, idempotencyKey: true, errorMessage: true } });
    if (!o) return;
    const prefix = `api:${o.resellerId}:`;
    const base = { order_id: o.id, order_number: o.number, external_ref: o.idempotencyKey.startsWith(prefix) ? o.idempotencyKey.slice(prefix.length) : null };
    if (outcome.status === "completed") {
      await emitWebhook(o.resellerId, o.kind === "RENEWAL" ? "line.extended" : "line.created", { ...base, line_id: outcome.subscriptionId ?? o.subscriptionId });
    } else {
      await emitWebhook(o.resellerId, "activation.failed", { ...base, error: outcome.error ?? o.errorMessage });
    }
  } catch (e) {
    console.error("[webhook] activation event failed", (e as Error).message);
  }
}
