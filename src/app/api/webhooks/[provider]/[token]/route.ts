import type { PaymentProvider } from "@prisma/client";
import { getProvider, WebhookVerificationError, PROVIDER_ORDER } from "@/core/payments";
import { db } from "@/lib/db";
import { gatewayCreds } from "@/lib/gateways";
import { handlePaymentEvents } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Payment provider webhooks for reseller gateways.
 * URL: /api/webhooks/{provider}/{webhookToken}. The unguessable token identifies the reseller's
 * gateway; authenticity is then verified with that reseller's own secret (signature or API re-fetch).
 * Responses: 200 processed/ignored · 400 forged · 404 unknown · 500 transient error (provider retries).
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string; token: string }> }) {
  const { provider: raw, token } = await ctx.params;
  const provider = raw.toUpperCase() as PaymentProvider;
  if (!PROVIDER_ORDER.includes(provider) || provider === "TEST") return new Response("Not found", { status: 404 });
  const gw = await db.paymentGateway.findUnique({ where: { webhookToken: token } });
  if (!gw || gw.provider !== provider) return new Response("Not found", { status: 404 });

  const rawBody = await req.text();
  if (rawBody.length > 512_000) return new Response("Payload too large", { status: 413 });
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const query = Object.fromEntries(new URL(req.url).searchParams.entries());

  try {
    const events = await getProvider(provider).parseWebhook(gatewayCreds(gw), { rawBody, headers, query }, { sandbox: gw.sandbox });
    await handlePaymentEvents(gw.resellerId, provider, events);
    return Response.json({ received: true });
  } catch (e) {
    if (e instanceof WebhookVerificationError) {
      await db.apiLog.create({ data: { resellerId: gw.resellerId, service: provider, action: "webhook", success: false, statusCode: 400, message: e.message } });
      return new Response("Invalid signature", { status: 400 });
    }
    await db.apiLog.create({ data: { resellerId: gw.resellerId, service: provider, action: "webhook", success: false, statusCode: 500, message: String((e as Error).message).slice(0, 500) } }).catch(() => {});
    console.error(`[webhook:${provider}]`, e);
    return new Response("Temporary error", { status: 500 });
  }
}
