"use server";

import { cookies } from "next/headers";
import { encrypt } from "@/core/crypto";
import { generateApiKey, NEW_KEY_COOKIE, newWebhookSecret } from "@/core/partnerApi";
import { assertPublicUrl } from "@/core/net";
import { act, bool, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { deliverWebhook } from "@/lib/webhooks";

const BACK = "/dashboard/website-api";

async function apiReseller() {
  const r = await requireReseller();
  if (!r.reseller.partnerApiEnabled) throw new UserError("The Website API is switched off for your account. Contact the platform administrator.");
  return r;
}

export async function createApiKeyAction(fd: FormData) {
  return act(BACK, async () => {
    const { user, reseller } = await apiReseller();
    if ((await db.resellerApiKey.count({ where: { resellerId: reseller.id, revokedAt: null } })) >= 10) throw new UserError("At most 10 active keys — delete one first.");
    const name = str(fd, "name", 60) || "Website";
    const k = generateApiKey();
    await db.resellerApiKey.create({ data: { resellerId: reseller.id, name, prefix: k.prefix, keyHash: k.hash } });
    (await cookies()).set(NEW_KEY_COOKIE, encrypt(k.key), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: BACK, maxAge: 120 });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "api_key.created", meta: { name, prefix: k.prefix } });
    return "Key created — copy it now, it is shown only once.";
  });
}

export async function revokeApiKeyAction(fd: FormData) {
  return act(BACK, async () => {
    const { user, reseller } = await requireReseller();
    const r = await db.resellerApiKey.updateMany({ where: { id: str(fd, "id", 40), resellerId: reseller.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new UserError("Key not found.");
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "api_key.revoked" });
    return "Key deleted — it stops working immediately.";
  });
}

export async function saveWebhookAction(fd: FormData) {
  return act(BACK, async () => {
    const { user, reseller } = await apiReseller();
    const url = str(fd, "url", 500);
    if (!url) {
      await db.resellerWebhook.deleteMany({ where: { resellerId: reseller.id } });
      return "Webhook removed.";
    }
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new UserError("Enter the full address, e.g. https://yoursite.com/orbitmodul-webhook.php");
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new UserError("The webhook address must start with https://");
    try {
      await assertPublicUrl(url);
    } catch (e) {
      throw new UserError((e as Error).message);
    }
    const existing = await db.resellerWebhook.findUnique({ where: { resellerId: reseller.id } });
    const data = { url, enabled: bool(fd, "enabled") };
    if (existing) await db.resellerWebhook.update({ where: { id: existing.id }, data });
    else await db.resellerWebhook.create({ data: { resellerId: reseller.id, ...data, secretEnc: encrypt(newWebhookSecret()) } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "webhook.saved", meta: { host: u.host } });
    return existing ? "Webhook saved." : "Webhook saved. Copy the signing secret below into your website.";
  });
}

export async function rotateWebhookSecretAction() {
  return act(BACK, async () => {
    const { reseller } = await apiReseller();
    const r = await db.resellerWebhook.updateMany({ where: { resellerId: reseller.id }, data: { secretEnc: encrypt(newWebhookSecret()) } });
    if (!r.count) throw new UserError("Save a webhook address first.");
    return "New signing secret created — update it on your website.";
  });
}

export async function testWebhookAction() {
  return act(BACK, async () => {
    const { reseller } = await apiReseller();
    if (!(await rateLimit(`wh-test:${reseller.id}`, 10, 600))) throw new UserError("Too many tests. Please wait a few minutes.");
    const w = await db.resellerWebhook.findUnique({ where: { resellerId: reseller.id } });
    if (!w?.enabled) throw new UserError("Save and enable the webhook first.");
    try {
      const r = await deliverWebhook({ resellerId: reseller.id, id: `evt_test_${Date.now().toString(36)}`, event: "ping", created: new Date().toISOString(), data: { message: "Test from OrbitModul", store: reseller.storeName } });
      return `Your website answered HTTP ${r.status} — the webhook works.`;
    } catch (e) {
      throw new UserError((e as Error).message);
    }
  });
}
