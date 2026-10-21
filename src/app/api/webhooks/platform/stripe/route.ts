import { handlePlatformStripeWebhook } from "@/lib/platformBilling";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SaaS subscription webhooks from the PLATFORM Stripe account (resellers paying the platform). */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const r = await handlePlatformStripeWebhook(raw, req.headers.get("stripe-signature"));
    return r === "invalid" ? new Response("Invalid signature", { status: 400 }) : Response.json({ received: true });
  } catch (e) {
    console.error("[platform-stripe]", e);
    return new Response("Temporary error", { status: 500 });
  }
}
