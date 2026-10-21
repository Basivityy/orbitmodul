"use server";

import type { PaymentProvider } from "@prisma/client";
import { decrypt, encrypt, encryptJson, decryptJson, randomToken } from "@/core/crypto";
import { maskApiKey, MaxPlayerClient, MaxPlayerError } from "@/core/adapters/maxplayer";
import { getProvider, PROVIDER_ORDER } from "@/core/payments";
import { act, bool, int, optStr, str, UserError } from "@/lib/action";
import { apiLogger, audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueueMaxPlayer } from "@/lib/queue";
import { IMPORT_PACKAGE_NAME } from "@/core/importedCustomers";
import { loadResellerSaas, planLimits } from "@/lib/saas";

// ------------------------------------------------------------------ payment gateways

function parseProvider(v: string): PaymentProvider {
  if (!PROVIDER_ORDER.includes(v as PaymentProvider)) throw new UserError("Unknown payment provider.");
  return v as PaymentProvider;
}

export async function saveGatewayAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/payments", async () => {
    const provider = parseProvider(str(fd, "provider", 20));
    const impl = getProvider(provider);
    const existing = await db.paymentGateway.findUnique({ where: { resellerId_provider: { resellerId: reseller.id, provider } } });
    const prev = existing ? decryptJson<Record<string, string>>(existing.credentialsEnc) : {};
    const creds: Record<string, string> = {};
    for (const f of impl.credentialFields) {
      const v = str(fd, `cred_${f.key}`, 500);
      // Secret fields left blank keep their stored value (they are never sent back to the browser).
      creds[f.key] = v || prev[f.key] || "";
      if (f.required && !creds[f.key]) throw new UserError(`${f.label} is required.`);
    }
    const data = { credentialsEnc: encryptJson(creds), enabled: bool(fd, "enabled"), sandbox: bool(fd, "sandbox") };
    if (existing) await db.paymentGateway.update({ where: { id: existing.id }, data });
    else await db.paymentGateway.create({ data: { ...data, resellerId: reseller.id, provider, webhookToken: randomToken(24) } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "gateway.saved", target: provider, meta: { enabled: data.enabled, sandbox: data.sandbox } });
    return `${impl.label} saved.`;
  });
}

export async function testGatewayAction(fd: FormData) {
  const { reseller } = await requireReseller();
  return act("/dashboard/payments", async () => {
    const provider = parseProvider(str(fd, "provider", 20));
    const g = await db.paymentGateway.findUnique({ where: { resellerId_provider: { resellerId: reseller.id, provider } } });
    if (!g) throw new UserError("Save the gateway first.");
    const msg = await getProvider(provider).verifyCredentials(decryptJson(g.credentialsEnc), { sandbox: g.sandbox });
    return msg;
  });
}

export async function deleteGatewayAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/payments", async () => {
    const provider = parseProvider(str(fd, "provider", 20));
    await db.paymentGateway.deleteMany({ where: { resellerId: reseller.id, provider } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "gateway.deleted", target: provider });
    return "Gateway removed.";
  });
}

// ------------------------------------------------------------------ MaxPlayer

export async function saveMaxPlayerAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/maxplayer", async () => {
    if (!planLimits(await loadResellerSaas(reseller.id)).allowMaxPlayer) throw new UserError("MaxPlayer integration is not included in your plan.");
    // Keys are copied from the MaxPlayer site; spaces or line breaks around them are removed.
    const apiKey = str(fd, "apiKey", 300).replace(/\s+/g, "");
    const existing = await db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id } });
    if (!existing && !apiKey) throw new UserError("Enter your MaxPlayer API token.");
    let keyChecked = false;
    if (apiKey) {
      // Check a new key before it replaces the working one: a refused key is not saved.
      try {
        await new MaxPlayerClient(apiKey, process.env.MAXPLAYER_API_BASE || undefined, apiLogger(reseller.id, "MAXPLAYER")).status();
        keyChecked = true;
      } catch (e) {
        if (e instanceof MaxPlayerError && (e.statusCode === 401 || e.statusCode === 403) && !e.rateLimited) {
          throw new UserError(`MaxPlayer refused this API key (${e.message}). Nothing was changed${existing ? " — the previous key is still used" : ""}. Copy the whole key again from MaxPlayer → API keys.`);
        }
        // Network problem or rate limit: save it anyway, "Test connection" can be used later.
      }
    }
    const maxDevicesRaw = str(fd, "maxDevices", 5);
    const maxProfilesRaw = str(fd, "maxProfiles", 5);
    const data = {
      domainId: optStr(fd, "domainId", 40),
      enabled: bool(fd, "enabled"),
      testMode: bool(fd, "testMode"),
      maxDevices: maxDevicesRaw ? int(fd, "maxDevices", { min: 1, max: 100 }) : null,
      maxProfiles: maxProfilesRaw ? int(fd, "maxProfiles", { min: 1, max: 100 }) : null,
      ...(apiKey ? { apiKeyEnc: encrypt(apiKey), status: keyChecked ? ("CONNECTED" as const) : ("UNTESTED" as const), lastError: null, ...(keyChecked ? { lastCheckedAt: new Date() } : {}) } : {}),
    };
    if (data.enabled && !data.domainId) throw new UserError("Select the MaxPlayer domain to use for new customers.");
    if (existing) await db.maxPlayerIntegration.update({ where: { id: existing.id }, data });
    else await db.maxPlayerIntegration.create({ data: { ...data, resellerId: reseller.id, apiKeyEnc: encrypt(apiKey) } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "maxplayer.saved", meta: { enabled: data.enabled, testMode: data.testMode, keyChanged: !!apiKey } });
    return apiKey ? `MaxPlayer settings saved — the module now uses the key ${maskApiKey(apiKey)}${keyChecked ? " (checked, it works)" : ""}.` : "MaxPlayer settings saved.";
  });
}

export async function testMaxPlayerAction() {
  const { reseller } = await requireReseller();
  return act("/dashboard/maxplayer", async () => {
    const mp = await db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id } });
    if (!mp) throw new UserError("Save your API token first.");
    const client = new MaxPlayerClient(decrypt(mp.apiKeyEnc), process.env.MAXPLAYER_API_BASE || undefined, apiLogger(reseller.id, "MAXPLAYER"));
    try {
      const status = await client.status();
      const domains = await client.domains();
      await db.maxPlayerIntegration.update({ where: { id: mp.id }, data: { status: "CONNECTED", lastError: null, lastCheckedAt: new Date() } });
      const exp = status?.expires_at ?? status?.expiration ?? status?.service_expiration;
      return `Connected to MaxPlayer with key ${maskApiKey(decrypt(mp.apiKeyEnc))}${exp ? ` — service valid until ${exp}` : ""}. ${domains.length} domain(s) available.`;
    } catch (e) {
      await db.maxPlayerIntegration.update({ where: { id: mp.id }, data: { status: "ERROR", lastError: String((e as Error).message).slice(0, 500), lastCheckedAt: new Date() } });
      throw e;
    }
  });
}

export async function retryMaxPlayerAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "subscriptionId", 40);
  return act(str(fd, "back", 200).startsWith("/dashboard") ? str(fd, "back", 200) : "/dashboard/maxplayer", async () => {
    const s = await db.subscription.findFirst({ where: { id, resellerId: reseller.id } });
    if (!s) throw new UserError("Subscription not found.");
    await db.subscription.update({ where: { id }, data: { maxPlayerStatus: "PENDING", maxPlayerError: null } });
    await enqueueMaxPlayer(id, { retry: true });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "maxplayer.retry", target: id });
    return "MaxPlayer activation queued.";
  });
}

/** Retries every MaxPlayer account that failed (overview "Retry all"). */
export async function retryAllMaxPlayerAction() {
  const { user, reseller } = await requireReseller();
  return act("/dashboard", async () => {
    const failed = await db.subscription.findMany({ where: { resellerId: reseller.id, maxPlayerStatus: "FAILED" }, select: { id: true }, take: 200 });
    if (!failed.length) return "Nothing to retry.";
    await db.subscription.updateMany({ where: { id: { in: failed.map((f) => f.id) } }, data: { maxPlayerStatus: "PENDING", maxPlayerError: null } });
    for (const f of failed) await enqueueMaxPlayer(f.id, { retry: true });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "maxplayer.retry_all", meta: { count: failed.length } });
    return `${failed.length} MaxPlayer account(s) queued again.`;
  });
}

/**
 * Creates the MaxPlayer accounts that are missing: failed, still waiting, or only simulated in test
 * mode (id TEST-…). Lines that are themselves test lines are skipped.
 */
/**
 * Lines that should have a real MaxPlayer account but do not: failed, still waiting, only simulated in
 * test mode — or made while their package still had "Activate MaxPlayer" off (status NONE).
 * Kept in sync with the count on the MaxPlayer page.
 */
function missingMaxPlayerWhere(resellerId: string) {
  return {
    resellerId,
    isTest: false,
    lineUsername: { not: null },
    OR: [
      { maxPlayerStatus: { in: ["PENDING" as const, "FAILED" as const] } },
      { maxPlayerUserId: { startsWith: "TEST-" } },
      { maxPlayerStatus: "NONE" as const, status: "ACTIVE" as const, linePasswordEnc: { not: null }, package: { maxPlayerEnabled: true, name: { not: IMPORT_PACKAGE_NAME } } },
    ],
  };
}

/** Ticks "Activate MaxPlayer" on every package of the reseller in one go. */
export async function enableMaxPlayerAllPackagesAction() {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/maxplayer", async () => {
    if (!planLimits(await loadResellerSaas(reseller.id)).allowMaxPlayer) throw new UserError("MaxPlayer integration is not included in your plan.");
    // Not the hidden package of lines loaded from the panel: those customers keep MaxPlayer only if they already had it.
    const r = await db.package.updateMany({ where: { resellerId: reseller.id, maxPlayerEnabled: false, name: { not: IMPORT_PACKAGE_NAME } }, data: { maxPlayerEnabled: true } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "maxplayer.enable_all_packages", meta: { count: r.count } });
    return r.count ? `MaxPlayer is now on for ${r.count} package(s). New customers of these packages get a MaxPlayer account automatically.` : "All packages already have MaxPlayer.";
  });
}

export async function createMissingMaxPlayerAction() {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/maxplayer", async () => {
    const mp = await db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id } });
    if (!mp?.enabled || !mp.domainId) throw new UserError("Set up MaxPlayer first: token, domain, Enabled.");
    if (mp.testMode || !env.liveOperationsAllowed) throw new UserError("MaxPlayer is in test mode, so nothing would be created. Untick “Test mode” and save first.");
    const missing = await db.subscription.findMany({ where: missingMaxPlayerWhere(reseller.id), select: { id: true }, take: 500 });
    if (!missing.length) return "No missing MaxPlayer accounts.";
    await db.subscription.updateMany({ where: { id: { in: missing.map((m) => m.id) } }, data: { maxPlayerStatus: "PENDING", maxPlayerError: null } });
    for (const m of missing) await enqueueMaxPlayer(m.id, { retry: true });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "maxplayer.create_missing", meta: { count: missing.length } });
    const minutes = Math.max(1, Math.ceil(missing.length / env.maxPlayerPerMinute));
    return `${missing.length} MaxPlayer account(s) are being created, about ${env.maxPlayerPerMinute} per minute (≈ ${minutes} min) so MaxPlayer's request limit is not hit. You can leave this page.`;
  });
}
