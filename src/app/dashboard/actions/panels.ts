"use server";

import { decrypt, encrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { act, bool, str, UserError } from "@/lib/action";
import { apiLogger, audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { catalogNamesFor, isPlaceholderBouquetName } from "@/lib/bouquetCatalog";
import { loadResellerSaas, planLimits } from "@/lib/saas";

function parseExtraParams(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) throw new UserError(`Invalid extra setting "${t}". Use key=value per line.`);
    const k = t.slice(0, i).trim();
    if (!/^[a-zA-Z0-9_\[\]]{1,40}$/.test(k)) throw new UserError(`Invalid parameter name "${k}".`);
    if (["api_key", "action", "username", "password", "exp_date", "bouquets_selected[]"].includes(k)) throw new UserError(`"${k}" is set automatically and cannot be overridden.`);
    out[k] = t.slice(i + 1).trim();
  }
  return out;
}

function validateUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UserError("API URL is not a valid URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UserError("API URL must start with https://");
  if (u.search) throw new UserError("Do not include ?api_key or other query parameters in the API URL.");
  return u.toString().replace(/\/$/, "");
}

async function ownedPanel(resellerId: string, id: string) {
  const p = await db.panelIntegration.findFirst({ where: { id, resellerId } });
  if (!p) throw new UserError("Panel not found.");
  return p;
}

/** Create or update (CONNECT / SAVE SETTINGS). With intent=connect it also tests the connection. */
export async function savePanelAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  const intent = str(fd, "intent", 20);
  return act(id ? `/dashboard/panels/${id}` : "/dashboard/panels", async () => {
    const name = str(fd, "name", 80);
    const apiUrl = validateUrl(str(fd, "apiUrl", 500));
    const apiKey = str(fd, "apiKey", 300);
    const extraParams = parseExtraParams(str(fd, "extraParams", 2000));
    const testMode = bool(fd, "testMode");
    if (!name) throw new UserError("Panel name is required.");
    const namesUrlRaw = str(fd, "namesApiUrl", 500);
    const namesApiUrl = namesUrlRaw ? validateUrl(namesUrlRaw) : null;
    const namesApiKey = str(fd, "namesApiKey", 300);
    const lineOwnerId = str(fd, "lineOwnerId", 20) || null;
    if (lineOwnerId && !/^\d+$/.test(lineOwnerId)) throw new UserError("Line owner must be the numeric XUI user ID (e.g. 491).");
    const streamRaw = str(fd, "streamUrl", 300).trim();
    let streamUrl: string | null = null;
    if (streamRaw) {
      let su: URL;
      try {
        su = new URL(streamRaw);
      } catch {
        throw new UserError("Streaming URL must look like http://line.yourdomain.com:80");
      }
      if (su.protocol !== "http:" && su.protocol !== "https:") throw new UserError("Streaming URL must start with http:// or https://");
      streamUrl = `${su.protocol}//${su.host}`;
    }
    const namesData = { lineOwnerId, streamUrl, namesApiUrl, ...(namesApiKey ? { namesApiKeyEnc: encrypt(namesApiKey) } : {}), ...(namesApiUrl ? {} : { namesApiKeyEnc: null }) };

    let panelId = id;
    if (id) {
      await ownedPanel(reseller.id, id);
      await db.panelIntegration.update({
        where: { id },
        data: { name, apiUrl, extraParams, testMode, ...namesData, ...(apiKey ? { apiKeyEnc: encrypt(apiKey), status: "UNTESTED" } : {}) },
      });
    } else {
      if (!apiKey) throw new UserError("API key is required.");
      const limits = planLimits(await loadResellerSaas(reseller.id));
      const count = await db.panelIntegration.count({ where: { resellerId: reseller.id } });
      if (count >= limits.maxPanels) throw new UserError(`Your plan allows ${limits.maxPanels} panel(s). Upgrade to add more.`);
      const p = await db.panelIntegration.create({
        data: { resellerId: reseller.id, name, apiUrl, apiKeyEnc: encrypt(apiKey), extraParams, testMode, isDefault: count === 0, ...namesData },
      });
      panelId = p.id;
    }
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: id ? "panel.updated" : "panel.created", target: panelId, meta: { name, apiUrl, testMode, keyChanged: !!apiKey } });
    if (intent === "connect") {
      // Connect = test the API and immediately load all bouquets from the panel.
      const msg = await testPanel(reseller.id, panelId);
      const bq = await syncPanelBouquets(reseller.id, panelId);
      return { redirect: `/dashboard/panels/${panelId}`, message: `${msg} ${bq}` };
    }
    return { redirect: `/dashboard/panels/${panelId}`, message: "Settings saved." };
  });
}

async function testPanel(resellerId: string, panelId: string): Promise<string> {
  const p = await ownedPanel(resellerId, panelId);
  const adapter = createPanelAdapter(p.type, { apiUrl: p.apiUrl, apiKey: decrypt(p.apiKeyEnc), extraParams: p.extraParams as Record<string, string> }, { testMode: false, log: apiLogger(resellerId, "XUI") });
  try {
    const info = await adapter.testConnection();
    await db.panelIntegration.update({ where: { id: p.id }, data: { status: "CONNECTED", lastCheckedAt: new Date(), lastError: null, credits: info.credits } });
    return `Connection OK — ${info.message}${info.credits !== null ? `, credits: ${info.credits}` : ""}.`;
  } catch (e) {
    await db.panelIntegration.update({ where: { id: p.id }, data: { status: "ERROR", lastCheckedAt: new Date(), lastError: String((e as Error).message).slice(0, 500) } });
    throw e;
  }
}

export async function testPanelAction(fd: FormData) {
  const { reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  return act(`/dashboard/panels/${id}`, () => testPanel(reseller.id, id));
}

/** Loads all bouquets from the panel API (get_bouquets) and stores them. */
async function syncPanelBouquets(resellerId: string, panelId: string): Promise<string> {
  const p = await ownedPanel(resellerId, panelId);
  const log = apiLogger(resellerId, "XUI");
  const adapter = createPanelAdapter(p.type, { apiUrl: p.apiUrl, apiKey: decrypt(p.apiKeyEnc) }, { testMode: false, log });
  const list = await adapter.getBouquets();
  // Optional names source (e.g. XUI admin API) when the main (reseller) API returns ids only.
  let namesNote = "";
  if (p.namesApiUrl && p.namesApiKeyEnc && list.some((b) => b.placeholder)) {
    try {
      const named = await createPanelAdapter(p.type, { apiUrl: p.namesApiUrl, apiKey: decrypt(p.namesApiKeyEnc) }, { testMode: false, log }).getBouquets();
      const names = new Map(named.filter((b) => !b.placeholder).map((b) => [b.id, b.name]));
      for (const b of list) {
        const n = names.get(b.id);
        if (n) {
          b.name = n;
          b.placeholder = false;
        }
      }
    } catch (e) {
      namesNote = ` Bouquet names could not be loaded from the names API: ${(e as Error).message}`;
    }
  }
  // Names synced centrally by the platform admin (works even after the admin key was removed).
  const fromCatalog = new Set<string>();
  if (list.some((b) => b.placeholder)) {
    const catalog = await catalogNamesFor(p.apiUrl);
    for (const b of list) {
      const n = b.placeholder ? catalog.get(b.id) : undefined;
      if (n) {
        b.name = n;
        b.placeholder = false;
        fromCatalog.add(b.id);
      }
    }
  }
  const now = new Date();
  for (const b of list) {
    const existing = await db.bouquet.findUnique({ where: { panelId_externalId: { panelId: p.id, externalId: b.id } } });
    if (!existing) {
      await db.bouquet.create({ data: { resellerId, panelId: p.id, externalId: b.id, name: b.name, syncedAt: now } });
      continue;
    }
    // Placeholder and catalog names never overwrite a name the reseller typed in.
    const keepOwn = b.placeholder || (fromCatalog.has(b.id) && !isPlaceholderBouquetName(existing.name));
    await db.bouquet.update({ where: { id: existing.id }, data: keepOwn ? { syncedAt: now } : { name: b.name, syncedAt: now } });
  }
  // Bouquets removed on the panel: keep them if packages still use them (shown as stale), otherwise delete.
  const stale = await db.bouquet.findMany({ where: { panelId: p.id, syncedAt: { lt: now } }, include: { _count: { select: { packages: true } } } });
  const unused = stale.filter((b) => b._count.packages === 0).map((b) => b.id);
  if (unused.length) await db.bouquet.deleteMany({ where: { id: { in: unused }, resellerId } });
  await db.panelIntegration.update({ where: { id: p.id }, data: { status: "CONNECTED", lastCheckedAt: now, lastError: null } });
  const staleInUse = stale.length - unused.length;
  const unnamed = list.filter((b) => b.placeholder).length;
  return `Loaded ${list.length} bouquet(s) from the panel.${unnamed ? ` ${unnamed} have no name yet — the platform admin can sync bouquet names (Admin → Bouquet names), or rename them on the Bouquets page.` : ""}${staleInUse ? ` ${staleInUse} bouquet(s) no longer exist on the panel but are still used by packages — please review.` : ""}${namesNote}`;
}

export async function syncBouquetsAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  const back = str(fd, "back", 200) || `/dashboard/panels/${id}`;
  return act(back.startsWith("/dashboard") ? back : "/dashboard/bouquets", async () => {
    const msg = await syncPanelBouquets(reseller.id, id);
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "panel.bouquets_synced", target: id });
    return msg;
  });
}

export async function deletePanelAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  return act(`/dashboard/panels/${id}`, async () => {
    await ownedPanel(reseller.id, id);
    const used = (await db.package.count({ where: { panelId: id } })) + (await db.subscription.count({ where: { panelId: id } }));
    if (used) throw new UserError("This panel is used by packages or subscriptions and cannot be deleted. Deactivate those packages instead.");
    await db.panelIntegration.delete({ where: { id } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "panel.deleted", target: id });
    return { redirect: "/dashboard/panels", message: "Panel removed." };
  });
}

/** Lists the packages defined on the XUI panel (if the API supports get_packages). */
export async function loadPanelPackagesAction(fd: FormData) {
  const { reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  return act(`/dashboard/panels/${id}`, async () => {
    const p = await ownedPanel(reseller.id, id);
    const adapter = createPanelAdapter(p.type, { apiUrl: p.apiUrl, apiKey: decrypt(p.apiKeyEnc) }, { testMode: false, log: apiLogger(reseller.id, "XUI") });
    const list = await adapter.getPackages();
    if (!list.length) return "The panel returned no packages.";
    return `Panel packages: ${list.slice(0, 30).map((x) => `${x.name} (#${x.id})`).join(", ")}${list.length > 30 ? ` … +${list.length - 30} more` : ""}. Your store packages are defined here with your own prices; bouquets are assigned per package.`;
  });
}

export async function renameBouquetAction(fd: FormData) {
  const { reseller } = await requireReseller();
  return act("/dashboard/bouquets", async () => {
    const b = await db.bouquet.findFirst({ where: { id: str(fd, "id", 40), resellerId: reseller.id } });
    if (!b) throw new UserError("Bouquet not found.");
    const name = str(fd, "name", 100);
    if (!name) throw new UserError("Name is required.");
    await db.bouquet.update({ where: { id: b.id }, data: { name } });
    return `Bouquet #${b.externalId} renamed.`;
  });
}

/**
 * Imports the packages defined on the XUI panel as billing packages: name, duration,
 * connections and bouquets come from the panel. New packages are created hidden with
 * price 0 — the reseller sets the price and activates them. Re-importing updates duration,
 * connections and bouquets but never the price, name or on-sale status.
 */
export async function importPanelPackagesAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  return act("/dashboard/packages", async () => {
    const p = await ownedPanel(reseller.id, id);
    const bouquetMsg = await syncPanelBouquets(reseller.id, p.id);
    const adapter = createPanelAdapter(p.type, { apiUrl: p.apiUrl, apiKey: decrypt(p.apiKeyEnc) }, { testMode: false, log: apiLogger(reseller.id, "XUI") });
    const remote = await adapter.getPanelPackages();
    const bouquets = await db.bouquet.findMany({ where: { panelId: p.id } });
    const byExt = new Map(bouquets.map((b) => [b.externalId, b.id]));
    const limits = planLimits(await loadResellerSaas(reseller.id));
    // MaxPlayer connected and enabled → imported packages create MaxPlayer accounts by default.
    const mpOn = limits.allowMaxPlayer && !!(await db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id }, select: { enabled: true } }))?.enabled;
    let count = await db.package.count({ where: { resellerId: reseller.id } });
    let created = 0, updated = 0, skipped = 0;
    for (const rp of remote) {
      const bouquetIds = rp.bouquetIds.map((x) => byExt.get(x)).filter((x): x is string => !!x);
      const existing = await db.package.findFirst({ where: { resellerId: reseller.id, panelId: p.id, externalPackageId: rp.id } });
      if (existing) {
        await db.$transaction([
          db.package.update({ where: { id: existing.id }, data: { durationDays: rp.durationDays, maxConnections: rp.maxConnections, isTrial: rp.isTrial } }),
          db.packageBouquet.deleteMany({ where: { packageId: existing.id } }),
          db.packageBouquet.createMany({ data: bouquetIds.map((b) => ({ packageId: existing.id, bouquetId: b })) }),
        ]);
        updated++;
        continue;
      }
      if (count >= limits.maxPackages) {
        skipped++;
        continue;
      }
      await db.package.create({
        data: {
          resellerId: reseller.id,
          panelId: p.id,
          externalPackageId: rp.id,
          name: rp.name,
          priceCents: 0,
          currency: reseller.defaultCurrency,
          durationDays: rp.durationDays,
          maxConnections: rp.maxConnections,
          isTrial: rp.isTrial,
          maxPlayerEnabled: mpOn,
          active: false,
          description: `${rp.durationDays} days · ${rp.maxConnections} connection${rp.maxConnections > 1 ? "s" : ""} · ${rp.bouquetIds.length} bouquets`,
          bouquets: { create: bouquetIds.map((b) => ({ bouquetId: b })) },
        },
      });
      count++;
      created++;
    }
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "panel.packages_imported", target: p.id, meta: { created, updated, skipped } });
    return `${bouquetMsg} Packages from the panel: ${created} imported, ${updated} updated${skipped ? `, ${skipped} skipped (plan limit)` : ""}. New packages are hidden with price 0 — set your price and switch them on.`;
  });
}
