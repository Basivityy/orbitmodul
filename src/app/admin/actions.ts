"use server";

import { isValidEmail } from "@/core/ids";
import { isSupportedCurrency, parseAmountToMinor } from "@/core/money";
import { hashPassword, passwordPolicyError } from "@/core/password";
import { getDefaultTemplate } from "@/core/emailTemplates";
import { act, bool, int, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueActivation, enqueueEmail, enqueueMaxPlayer } from "@/lib/queue";
import { startTrial } from "@/lib/saas";
import { TONES } from "@/lib/announcements";
import { clientIp } from "@/lib/ratelimit";
import { resellerPlansEnabled, SETTING_BILLING_ENABLED, SETTING_GLOBAL_NOTICE, SETTING_REGISTRATION_OPEN, SETTING_RESELLER_PLANS, SETTING_STORE_TEST_PAYMENTS, setSetting } from "@/lib/settings";
import { getPlatformSmtpSetting, sendPlainEmail, SETTING_PLATFORM_SMTP } from "@/lib/mailer";
import { encrypt } from "@/core/crypto";
import { smtpSettingsError } from "@/core/mailRules";
import { env } from "@/lib/env";
import { savePublicUrl } from "@/lib/publicUrl";
import { normalizePublicUrl } from "@/core/publicUrl";
import { panelHost, removeCatalogKey, saveCatalogSource, syncCatalog } from "@/lib/bouquetCatalog";
import { getAppGuide, ICON_MAX_BYTES, ICON_TYPES, PLATFORMS, saveAppGuide, setAppIcon } from "@/lib/appGuide";
import { saveTmdbKey } from "@/lib/vod";
import { TmdbClient } from "@/core/vod";

export async function setResellerStatusAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "resellerId", 40);
  return act(`/admin/resellers/${id}`, async () => {
    const status = str(fd, "status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    const r = await db.reseller.update({ where: { id }, data: { status } });
    // Sign the reseller out everywhere when suspending. Lines on their panel are NOT touched.
    if (status === "SUSPENDED") await db.session.deleteMany({ where: { userId: r.ownerUserId } });
    await audit({ actor: actorOf(admin), resellerId: id, action: status === "SUSPENDED" ? "admin.reseller_suspended" : "admin.reseller_activated", ip: await clientIp(), meta: { reason: str(fd, "reason", 300) || undefined } });
    return status === "SUSPENDED" ? "Reseller suspended. Their store is offline and automation is paused; existing customer lines were not changed." : "Reseller re-activated.";
  });
}

/** Where an approve/decline button should return to (list or the reseller's page). */
function approvalBack(fd: FormData, id: string): string {
  const back = str(fd, "back", 200);
  return back.startsWith("/admin/resellers") ? back : `/admin/resellers/${id}`;
}

export async function approveResellerAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "resellerId", 40);
  return act(approvalBack(fd, id), async () => {
    const r = await db.reseller.findUnique({ where: { id }, include: { owner: true } });
    if (!r) throw new UserError("Reseller not found.");
    if (r.approvalStatus === "APPROVED") return `${r.storeName} is already approved.`;
    await db.reseller.update({ where: { id }, data: { approvalStatus: "APPROVED", approvedAt: new Date(), approvalNote: null } });
    // The admin vouched for this account: an unconfirmed email must not keep the store from selling.
    if (!r.owner.emailVerifiedAt) await db.user.update({ where: { id: r.ownerUserId }, data: { emailVerifiedAt: new Date() } });
    // With paid plans switched on, the free trial starts now (not while the account was waiting).
    if (await resellerPlansEnabled()) await startTrial(id);
    await enqueueEmail({ resellerId: null, template: "reseller_approved", to: r.owner.email, vars: { name: r.owner.name, storeName: r.storeName, loginUrl: `${env.appUrl}/login` } }).catch((e) => console.error("[approve] email enqueue failed", e.message));
    await audit({ actor: actorOf(admin), resellerId: id, action: "admin.reseller_approved", ip: await clientIp() });
    return `${r.storeName} approved. ${r.owner.email} got an email and can sign in now.`;
  });
}

/** Confirms the reseller owner's email by hand (e.g. the confirmation email never arrived). */
export async function confirmResellerEmailAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "resellerId", 40);
  return act(`/admin/resellers/${id}`, async () => {
    const r = await db.reseller.findUnique({ where: { id }, include: { owner: true } });
    if (!r) throw new UserError("Reseller not found.");
    if (r.owner.emailVerifiedAt) return "Email is already confirmed.";
    await db.user.update({ where: { id: r.ownerUserId }, data: { emailVerifiedAt: new Date() } });
    await audit({ actor: actorOf(admin), resellerId: id, action: "admin.reseller_email_confirmed", ip: await clientIp() });
    return `${r.owner.email} confirmed — the store can sell now (if nothing else blocks it).`;
  });
}

export async function rejectResellerAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "resellerId", 40);
  return act(approvalBack(fd, id), async () => {
    const r = await db.reseller.findUnique({ where: { id }, include: { owner: true } });
    if (!r) throw new UserError("Reseller not found.");
    const reason = str(fd, "reason", 500);
    await db.reseller.update({ where: { id }, data: { approvalStatus: "REJECTED", approvalNote: reason || null } });
    await db.session.deleteMany({ where: { userId: r.ownerUserId } });
    if (str(fd, "notify") !== "no") {
      await enqueueEmail({ resellerId: null, template: "reseller_rejected", to: r.owner.email, vars: { name: r.owner.name, reason } }).catch((e) => console.error("[reject] email enqueue failed", e.message));
    }
    await audit({ actor: actorOf(admin), resellerId: id, action: "admin.reseller_rejected", ip: await clientIp(), meta: { reason: reason || undefined } });
    return `${r.storeName} declined.`;
  });
}

export async function setResellerBillingAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "resellerId", 40);
  return act(`/admin/resellers/${id}`, async () => {
    const enabled = str(fd, "enabled") === "true";
    await db.reseller.update({ where: { id }, data: { billingEnabled: enabled } });
    await audit({ actor: actorOf(admin), resellerId: id, action: enabled ? "admin.billing_enabled" : "admin.billing_disabled", ip: await clientIp() });
    return enabled ? "Billing module enabled for this reseller." : "Billing module disabled for this reseller — no new checkouts or activations.";
  });
}

export async function setResellerVodAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "resellerId", 40);
  return act(`/admin/resellers/${id}`, async () => {
    const enabled = str(fd, "enabled") === "true";
    await db.reseller.update({ where: { id }, data: { vodMonitorEnabled: enabled } });
    if (!enabled) await db.vodMonitor.updateMany({ where: { resellerId: id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "IDLE" } });
    await audit({ actor: actorOf(admin), resellerId: id, action: enabled ? "admin.vod_enabled" : "admin.vod_disabled", ip: await clientIp() });
    return enabled ? "VOD monitoring enabled — the reseller now sees “VOD monitoring” in the menu." : "VOD monitoring disabled for this reseller (their results are kept).";
  });
}

export async function setResellerApiAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "resellerId", 40);
  return act(`/admin/resellers/${id}`, async () => {
    const enabled = str(fd, "enabled") === "true";
    await db.reseller.update({ where: { id }, data: { partnerApiEnabled: enabled } });
    await audit({ actor: actorOf(admin), resellerId: id, action: enabled ? "admin.website_api_enabled" : "admin.website_api_disabled", ip: await clientIp() });
    return enabled ? "Website API and widget enabled for this reseller." : "Website API, webhooks and widget disabled for this reseller (keys stop working at once).";
  });
}

export async function saveTmdbKeyAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/settings", async () => {
    if (str(fd, "remove") === "1") {
      await saveTmdbKey(null);
      await audit({ actor: actorOf(admin), action: "admin.tmdb_key_removed", ip: await clientIp() });
      return "TMDB key removed — VOD scans stop until a key is entered.";
    }
    const key = str(fd, "tmdbKey", 1000).replace(/^Bearer\s+/i, "");
    if (key.length < 16) throw new UserError("Paste the TMDB “API Key” or “API Read Access Token” (themoviedb.org → Settings → API).");
    try {
      const tv = await new TmdbClient(key).tv("1396");
      if (!tv) throw new Error("unexpected answer");
    } catch (e) {
      throw new UserError(`TMDB did not accept this key: ${(e as Error).message}`);
    }
    await saveTmdbKey(key);
    await audit({ actor: actorOf(admin), action: "admin.tmdb_key_saved", ip: await clientIp() });
    return "TMDB key works and is saved (encrypted).";
  });
}

export async function setResellerPlanAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "resellerId", 40);
  return act(`/admin/resellers/${id}`, async () => {
    const planId = str(fd, "planId", 40);
    const plan = await db.saasPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new UserError("Plan not found.");
    const status = str(fd, "status", 20) as "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
    if (!["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"].includes(status)) throw new UserError("Invalid status.");
    const untilRaw = str(fd, "until", 30);
    const until = untilRaw ? new Date(untilRaw) : null;
    if (until && isNaN(until.getTime())) throw new UserError("Invalid date.");
    const data = { planId, status, ...(status === "TRIALING" ? { trialEndsAt: until } : { currentPeriodEnd: until }) };
    await db.saasSubscription.upsert({ where: { resellerId: id }, create: { resellerId: id, ...data }, update: data });
    await audit({ actor: actorOf(admin), resellerId: id, action: "admin.saas_changed", meta: { plan: plan.code, status, until: untilRaw }, ip: await clientIp() });
    return "Platform subscription updated.";
  });
}

export async function adminRetryActivationAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "orderId", 40);
  return act("/admin/activations", async () => {
    const o = await db.order.findUnique({ where: { id } });
    if (!o || !["ACTIVATION_FAILED", "ON_HOLD", "PAID", "ACTIVATING"].includes(o.status)) throw new UserError("Order cannot be retried.");
    await db.order.update({ where: { id }, data: { lockedUntil: null } });
    await enqueueActivation(id, { retry: true });
    await audit({ actor: actorOf(admin), resellerId: o.resellerId, action: "admin.activation_retry", target: id });
    return "Activation queued.";
  });
}

/** Admin: (re)create the MaxPlayer account of one line — same queue as the reseller's "Retry". */
export async function adminRetryMaxPlayerAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "subscriptionId", 40);
  return act(`/admin/customers/${id}`, async () => {
    const s = await db.subscription.findUnique({ where: { id }, include: { reseller: { include: { maxPlayer: true } } } });
    if (!s) throw new UserError("Line not found.");
    if (s.isTest) throw new UserError("This is a test-mode line — nothing is created on MaxPlayer.");
    if (!s.lineUsername) throw new UserError("The line has no username yet.");
    if (!s.reseller.maxPlayer?.enabled) throw new UserError("This reseller has MaxPlayer switched off.");
    await db.subscription.update({ where: { id }, data: { maxPlayerStatus: "PENDING", maxPlayerError: null } });
    await enqueueMaxPlayer(id, { retry: true });
    await audit({ actor: actorOf(admin), resellerId: s.resellerId, action: "admin.maxplayer_retry", target: id });
    return "MaxPlayer account queued — refresh in a minute.";
  });
}

export async function savePlatformSettingsAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/settings", async () => {
    const billing = bool(fd, "billingEnabled");
    const registration = bool(fd, "registrationOpen");
    await setSetting(SETTING_BILLING_ENABLED, billing);
    await setSetting(SETTING_REGISTRATION_OPEN, registration);
    await setSetting(SETTING_GLOBAL_NOTICE, str(fd, "notice", 500));
    await setSetting(SETTING_STORE_TEST_PAYMENTS, bool(fd, "storeTestPayments"));
    await setSetting(SETTING_RESELLER_PLANS, bool(fd, "resellerPlans"));
    await audit({ actor: actorOf(admin), action: "admin.settings_changed", meta: { billingEnabled: billing, registrationOpen: registration }, ip: await clientIp() });
    return billing ? "Settings saved." : "Settings saved. The billing service is now PAUSED for all resellers.";
  });
}

export async function savePlanAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  const id = str(fd, "id", 40);
  return act("/admin/plans", async () => {
    const currency = str(fd, "currency", 3).toUpperCase();
    if (!isSupportedCurrency(currency)) throw new UserError("Unsupported currency.");
    const priceCents = parseAmountToMinor(str(fd, "price", 20), currency);
    if (priceCents === null) throw new UserError("Invalid price.");
    const code = str(fd, "code", 30).toUpperCase().replace(/[^A-Z0-9_]/g, "");
    if (!code) throw new UserError("Plan code is required.");
    const data = {
      code,
      name: str(fd, "name", 60) || code,
      priceCents,
      currency,
      interval: str(fd, "interval") === "YEAR" ? ("YEAR" as const) : ("MONTH" as const),
      maxPackages: int(fd, "maxPackages", { min: 0, max: 100000 }),
      maxPanels: int(fd, "maxPanels", { min: 0, max: 1000 }),
      maxActiveCustomers: int(fd, "maxActiveCustomers", { min: 0, max: 10_000_000 }),
      allowCustomDomain: bool(fd, "allowCustomDomain"),
      allowMaxPlayer: bool(fd, "allowMaxPlayer"),
      active: bool(fd, "active"),
      isDefault: bool(fd, "isDefault"),
      sortOrder: int(fd, "sortOrder", { fallback: 0 }),
      features: str(fd, "features", 2000).split("\n").map((s) => s.trim()).filter(Boolean),
    };
    if (data.isDefault) await db.saasPlan.updateMany({ where: { isDefault: true, NOT: id ? { id } : undefined }, data: { isDefault: false } });
    if (id) await db.saasPlan.update({ where: { id }, data });
    else await db.saasPlan.create({ data });
    await audit({ actor: actorOf(admin), action: id ? "admin.plan_updated" : "admin.plan_created", target: code, meta: { priceCents, currency } });
    return `Plan ${code} saved. Existing paid subscriptions keep their current Stripe price until renewal through a new checkout.`;
  });
}

export async function createAdminAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/admins", async () => {
    const email = str(fd, "email", 254).toLowerCase();
    if (!isValidEmail(email)) throw new UserError("Invalid email.");
    const password = str(fd, "password", 200);
    const err = passwordPolicyError(password);
    if (err) throw new UserError(err);
    if (await db.user.findUnique({ where: { email } })) throw new UserError("A user with this email exists.");
    const role = str(fd, "role") === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";
    await db.user.create({ data: { email, name: str(fd, "name", 100) || email, passwordHash: await hashPassword(password), role, emailVerifiedAt: new Date() } });
    await audit({ actor: actorOf(admin), action: "admin.admin_created", target: email, meta: { role }, ip: await clientIp() });
    return "Administrator created. Ask them to enable 2FA after the first sign-in.";
  });
}

export async function setAdminStatusAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/admins", async () => {
    const id = str(fd, "userId", 40);
    if (id === admin.id) throw new UserError("You cannot change your own status.");
    const u = await db.user.findUnique({ where: { id } });
    if (!u || u.role === "RESELLER") throw new UserError("Not an administrator.");
    const status = u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    await db.user.update({ where: { id }, data: { status } });
    if (status === "SUSPENDED") await db.session.deleteMany({ where: { userId: id } });
    await audit({ actor: actorOf(admin), action: status === "SUSPENDED" ? "admin.admin_disabled" : "admin.admin_enabled", target: u.email });
    return status === "SUSPENDED" ? "Administrator disabled." : "Administrator enabled.";
  });
}

export async function savePlatformTemplateAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/emails", async () => {
    const key = str(fd, "key", 60);
    const def = getDefaultTemplate(key);
    if (str(fd, "op") === "reset") {
      await db.emailTemplate.deleteMany({ where: { resellerId: null, key } });
      return "Template reset.";
    }
    const subject = str(fd, "subject", 200);
    const body = str(fd, "body", 10000);
    if (!subject || !body) throw new UserError("Subject and body are required.");
    const existing = await db.emailTemplate.findFirst({ where: { resellerId: null, key } });
    if (existing) await db.emailTemplate.update({ where: { id: existing.id }, data: { subject, body } });
    else await db.emailTemplate.create({ data: { resellerId: null, key, subject, body } });
    await audit({ actor: actorOf(admin), action: "admin.template_saved", target: def.key });
    return "Template saved.";
  });
}

// ── Central bouquet names ────────────────────────────────────────────────────

export async function saveCatalogSourceAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/bouquets", async () => {
    const raw = str(fd, "apiUrl", 500);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UserError("Enter the admin API URL, e.g. http://your-panel.com/adminapi");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new UserError("The URL must start with http:// or https://");
    if (url.search) throw new UserError("Do not include ?api_key in the URL — paste the key in the key field.");
    const apiUrl = url.toString().replace(/\/$/, "");
    const apiKey = str(fd, "apiKey", 300) || null;
    await saveCatalogSource(apiUrl, apiKey);
    await audit({ actor: actorOf(admin), action: "admin.bouquet_source_saved", meta: { host: panelHost(apiUrl), keyChanged: Boolean(apiKey) }, ip: await clientIp() });
    if (str(fd, "intent") !== "sync") return "Saved.";
    const r = await syncCatalog().catch((e: Error) => {
      throw new UserError(e.message);
    });
    await audit({ actor: actorOf(admin), action: "admin.bouquets_synced", meta: r });
    return `Synced ${r.count} bouquet names for ${r.host}. ${r.updatedResellerBouquets} reseller bouquet name(s) updated. You can now remove the admin key — the names stay.`;
  });
}

export async function syncCatalogAction() {
  const admin = await requireSuperAdmin();
  return act("/admin/bouquets", async () => {
    const r = await syncCatalog().catch((e: Error) => {
      throw new UserError(e.message);
    });
    await audit({ actor: actorOf(admin), action: "admin.bouquets_synced", meta: r });
    return `Synced ${r.count} bouquet names for ${r.host}. ${r.updatedResellerBouquets} reseller bouquet name(s) updated.`;
  });
}

export async function removeCatalogKeyAction() {
  const admin = await requireSuperAdmin();
  return act("/admin/bouquets", async () => {
    await removeCatalogKey();
    await audit({ actor: actorOf(admin), action: "admin.bouquet_source_key_removed", ip: await clientIp() });
    return "Admin API key removed. The synced bouquet names stay and resellers keep getting them.";
  });
}

// ── Customer app guide (MaxPlayer) ───────────────────────────────────────────

export async function saveAppGuideAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/app-guide", async () => {
    const cur = await getAppGuide();
    const platforms = { ...cur.platforms };
    for (const p of PLATFORMS) {
      const link = str(fd, `url_${p.key}`, 500).trim();
      if (link && !/^https?:\/\/\S+$/.test(link)) throw new UserError(`${p.label}: “${link}” is not a valid link (must start with https://).`);
      platforms[p.key] = { enabled: bool(fd, `on_${p.key}`), url: link, note: str(fd, `note_${p.key}`, 200).trim() };
    }
    const g = {
      ...cur,
      enabled: bool(fd, "enabled"),
      appName: str(fd, "appName", 40).trim() || "MaxPlayer",
      platforms,
      unsupportedNote: str(fd, "unsupportedNote", 200).trim(),
      extraNote: str(fd, "extraNote", 500).trim(),
    };
    await saveAppGuide(g);
    const file = fd.get("icon");
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
      const f = file as File;
      if (!ICON_TYPES.includes(f.type)) throw new UserError("Icon must be a PNG, JPG, WEBP or GIF image.");
      if (f.size > ICON_MAX_BYTES) throw new UserError("Icon is too large (max 300 KB). A 256×256 PNG is ideal.");
      await setAppIcon({ type: f.type, b64: Buffer.from(await f.arrayBuffer()).toString("base64") });
    } else if (bool(fd, "removeIcon")) {
      await setAppIcon(null);
    }
    await audit({ actor: actorOf(admin), action: "admin.app_guide_saved", ip: await clientIp() });
    return "Customer app guide saved.";
  });
}

export async function sendTestEmailAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/settings#smtp", async () => {
    const to = (str(fd, "to", 254) || admin.email).toLowerCase();
    if (!isValidEmail(to)) throw new UserError("Enter a valid email address for the test.");
    try {
      await sendPlainEmail(to, `${env.platformName}: test email`, "If you can read this, outgoing email works. Resellers and customers will receive their emails this way.");
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "SMTP is not configured") throw new UserError("Email sending is not set up yet: fill in the SMTP settings above and click Save.");
      throw new UserError(`Sending failed: ${msg}`);
    }
    return `Test email sent to ${to}. Check the inbox (and the spam folder).`;
  });
}

/** Platform mailbox (SMTP) used for platform emails and for stores without their own mailbox. */
export async function savePlatformSmtpAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/settings#smtp", async () => {
    if (str(fd, "op") === "remove") {
      await setSetting(SETTING_PLATFORM_SMTP, {}); // empty = not set (Json column cannot hold a plain null)
      await audit({ actor: actorOf(admin), action: "admin.smtp_removed", ip: await clientIp() });
      return env.smtp.host ? "Removed. Emails use the SMTP settings from .env again." : "Removed. Emails are not sent until SMTP is set up.";
    }
    const data = {
      host: str(fd, "host", 200).trim().toLowerCase(),
      port: int(fd, "port", { fallback: 587, min: 1, max: 65535 }),
      secure: bool(fd, "secure"),
      user: str(fd, "username", 200).trim(),
      fromEmail: str(fd, "fromEmail", 200).trim().toLowerCase(),
      fromName: str(fd, "fromName", 80).trim(),
    };
    const err = smtpSettingsError({ host: data.host, port: data.port, username: data.user, fromEmail: data.fromEmail });
    if (err) throw new UserError(err);
    const pass = str(fd, "password", 300);
    const existing = await getPlatformSmtpSetting();
    if (!pass && !existing) throw new UserError("Enter the SMTP password (or app password / SMTP key).");
    await setSetting(SETTING_PLATFORM_SMTP, { ...data, passEnc: pass ? encrypt(pass) : existing!.passEnc });
    await audit({ actor: actorOf(admin), action: "admin.smtp_saved", meta: { host: data.host, port: data.port }, ip: await clientIp() });
    return "Email settings saved. Send a test email below to check them.";
  });
}

export async function savePublicUrlAction(fd: FormData) {
  const admin = await requireSuperAdmin();
  return act("/admin/settings", async () => {
    const r = normalizePublicUrl(str(fd, "publicUrl", 300));
    if (r.error) throw new UserError(r.error);
    await savePublicUrl(r.url);
    await audit({ actor: actorOf(admin), action: "admin.public_url_changed", meta: { url: r.url }, ip: await clientIp() });
    return r.url ? `All links now use ${r.url}. Open the platform there once to check it works.` : `Links use the server address again (${env.installUrl}).`;
  });
}

// ── Notifications on reseller dashboards ─────────────────────────────────────

export async function saveAnnouncementAction(fd: FormData) {
  const admin = await requireAdmin();
  return act("/admin/announcements", async () => {
    const id = str(fd, "id", 40);
    const title = str(fd, "title", 120);
    const body = str(fd, "body", 2000);
    if (!title || !body) throw new UserError("Title and message are required.");
    const tone = TONES.find((t) => t === str(fd, "tone")) ?? "INFO";
    const target = str(fd, "target", 40);
    let resellerId: string | null = null;
    if (target && target !== "all") {
      const r = await db.reseller.findUnique({ where: { id: target } });
      if (!r) throw new UserError("Reseller not found.");
      resellerId = r.id;
    }
    const daysRaw = str(fd, "days", 10);
    const now = new Date();
    const endsAt = daysRaw === "keep" ? undefined : Number(daysRaw) > 0 ? new Date(now.getTime() + Math.min(Number(daysRaw), 365) * 86_400_000) : null;
    const data = { title, body, tone, resellerId, dismissible: bool(fd, "dismissible"), active: true, ...(endsAt !== undefined ? { endsAt } : {}) };
    let annId = id;
    if (id) {
      await db.announcement.update({ where: { id }, data });
      // Show it again to resellers who had already closed it.
      if (bool(fd, "showAgain")) await db.announcementDismissal.deleteMany({ where: { announcementId: id } });
    } else {
      annId = (await db.announcement.create({ data: { ...data, startsAt: now, createdBy: admin.email } })).id;
    }
    let emailed = 0;
    if (bool(fd, "sendEmail")) {
      const recipients = await db.reseller.findMany({ where: { approvalStatus: "APPROVED", status: "ACTIVE", ...(resellerId ? { id: resellerId } : {}) }, include: { owner: true }, take: 2000 });
      for (const r of recipients) {
        await enqueueEmail({ resellerId: null, template: "reseller_announcement", to: r.owner.email, vars: { name: r.owner.name, title, message: body, dashboardUrl: `${env.appUrl}/dashboard` } }).catch((e) => console.error("[announcement] email enqueue failed", e.message));
        emailed++;
      }
    }
    await audit({ actor: actorOf(admin), resellerId, action: id ? "admin.announcement_updated" : "admin.announcement_published", target: annId, meta: { tone, emailed } });
    const who = resellerId ? "this reseller" : "all resellers";
    return `${id ? "Notification updated" : "Notification published"} for ${who}${emailed ? ` and emailed to ${emailed} reseller(s)` : ""}.`;
  });
}

export async function toggleAnnouncementAction(fd: FormData) {
  const admin = await requireAdmin();
  return act("/admin/announcements", async () => {
    const id = str(fd, "id", 40);
    const a = await db.announcement.findUnique({ where: { id } });
    if (!a) throw new UserError("Notification not found.");
    await db.announcement.update({ where: { id }, data: { active: !a.active } });
    await audit({ actor: actorOf(admin), resellerId: a.resellerId, action: a.active ? "admin.announcement_off" : "admin.announcement_on", target: id });
    return a.active ? "Notification hidden." : "Notification shown again.";
  });
}

export async function deleteAnnouncementAction(fd: FormData) {
  const admin = await requireAdmin();
  return act("/admin/announcements", async () => {
    const id = str(fd, "id", 40);
    const a = await db.announcement.findUnique({ where: { id } });
    if (!a) return "Already deleted.";
    await db.announcement.delete({ where: { id } });
    await audit({ actor: actorOf(admin), resellerId: a.resellerId, action: "admin.announcement_deleted", target: id, meta: { title: a.title } });
    return "Notification deleted.";
  });
}
