import { formEncode, httpRequest } from "@/core/http";
import { verifyStripeSignature } from "@/core/signatures";
import { db, isUniqueViolation } from "./db";
import { env } from "./env";

/**
 * SaaS billing: resellers pay the platform owner through the PLATFORM's Stripe account.
 * Completely separate from resellers' own gateways used to sell to their customers.
 */
async function stripe(method: string, path: string, form?: Record<string, any>) {
  const key = env.platformStripe.secretKey;
  if (!key) throw new Error("Platform Stripe is not configured (PLATFORM_STRIPE_SECRET_KEY).");
  const res = await httpRequest(`${process.env.PLATFORM_STRIPE_API_BASE || "https://api.stripe.com"}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form ? formEncode(form) : undefined,
  });
  if (!res.ok) throw new Error(`Stripe: ${res.json?.error?.message ?? `HTTP ${res.status}`}`);
  return res.json;
}

export function platformBillingConfigured(): boolean {
  return !!env.platformStripe.secretKey;
}

export async function createPlanCheckout(resellerId: string, planId: string, email: string): Promise<string> {
  const plan = await db.saasPlan.findFirst({ where: { id: planId, active: true } });
  if (!plan) throw new Error("Plan not available.");
  const session = await stripe("POST", "/v1/checkout/sessions", {
    mode: "subscription",
    success_url: `${env.appUrl}/dashboard/billing?ok=${encodeURIComponent("Thank you! Your plan will be active in a moment.")}`,
    cancel_url: `${env.appUrl}/dashboard/billing`,
    customer_email: email,
    client_reference_id: resellerId,
    "metadata[resellerId]": resellerId,
    "metadata[planId]": plan.id,
    "subscription_data[metadata][resellerId]": resellerId,
    "subscription_data[metadata][planId]": plan.id,
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": plan.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": plan.priceCents,
    "line_items[0][price_data][product_data][name]": `${env.platformName} — ${plan.name} plan`,
    "line_items[0][price_data][recurring][interval]": plan.interval === "YEAR" ? "year" : "month",
  });
  return session.url as string;
}

export async function cancelPlan(resellerId: string): Promise<void> {
  const s = await db.saasSubscription.findUnique({ where: { resellerId } });
  if (!s?.stripeSubscriptionId) throw new Error("No paid subscription to cancel.");
  await stripe("POST", `/v1/subscriptions/${encodeURIComponent(s.stripeSubscriptionId)}`, { cancel_at_period_end: "true" });
  await db.saasSubscription.update({ where: { resellerId }, data: { cancelAtPeriodEnd: true } });
}

export async function handlePlatformStripeWebhook(rawBody: string, signature: string | null): Promise<"ok" | "invalid"> {
  if (!verifyStripeSignature(rawBody, signature, env.platformStripe.webhookSecret)) return "invalid";
  const evt = JSON.parse(rawBody);
  try {
    await db.webhookEvent.create({ data: { provider: "STRIPE", scope: "platform", eventId: String(evt.id), type: evt.type } });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const prev = await db.webhookEvent.findUnique({ where: { provider_scope_eventId: { provider: "STRIPE", scope: "platform", eventId: String(evt.id) } } });
      if (prev?.processedAt) return "ok";
    } else throw e;
  }
  const o = evt.data?.object ?? {};
  const periodEndOf = (inv: any): Date | null => {
    const end = inv?.lines?.data?.[0]?.period?.end ?? inv?.period_end;
    return end ? new Date(end * 1000) : null;
  };
  switch (evt.type) {
    case "checkout.session.completed": {
      const resellerId = o.metadata?.resellerId;
      const planId = o.metadata?.planId;
      if (o.mode === "subscription" && resellerId && planId && o.payment_status === "paid") {
        await db.saasSubscription.upsert({
          where: { resellerId },
          create: { resellerId, planId, status: "ACTIVE", stripeCustomerId: o.customer, stripeSubscriptionId: o.subscription, currentPeriodEnd: new Date(Date.now() + 31 * 86_400_000) },
          update: { planId, status: "ACTIVE", stripeCustomerId: o.customer, stripeSubscriptionId: o.subscription, cancelAtPeriodEnd: false, currentPeriodEnd: new Date(Date.now() + 31 * 86_400_000) },
        });
      }
      break;
    }
    case "invoice.paid": {
      const subId = o.subscription ?? o.parent?.subscription_details?.subscription;
      const s = subId ? await db.saasSubscription.findUnique({ where: { stripeSubscriptionId: String(subId) } }) : null;
      if (s) {
        const periodEnd = periodEndOf(o);
        await db.saasSubscription.update({ where: { id: s.id }, data: { status: "ACTIVE", ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}) } });
        try {
          await db.saasInvoice.create({ data: { resellerId: s.resellerId, number: `SAAS-${String(o.number ?? o.id)}`, amountCents: o.amount_paid ?? 0, currency: String(o.currency ?? "eur").toUpperCase(), status: "PAID", providerRef: String(o.id), periodEnd, paidAt: new Date() } });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
        }
      }
      break;
    }
    case "invoice.payment_failed": {
      const subId = o.subscription ?? o.parent?.subscription_details?.subscription;
      if (subId) await db.saasSubscription.updateMany({ where: { stripeSubscriptionId: String(subId) }, data: { status: "PAST_DUE" } });
      break;
    }
    case "customer.subscription.deleted":
      await db.saasSubscription.updateMany({ where: { stripeSubscriptionId: String(o.id) }, data: { status: "CANCELED" } });
      break;
    case "customer.subscription.updated":
      await db.saasSubscription.updateMany({ where: { stripeSubscriptionId: String(o.id) }, data: { cancelAtPeriodEnd: !!o.cancel_at_period_end } });
      break;
  }
  await db.webhookEvent.update({ where: { provider_scope_eventId: { provider: "STRIPE", scope: "platform", eventId: String(evt.id) } }, data: { processedAt: new Date() } });
  return "ok";
}
