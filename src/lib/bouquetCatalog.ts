import { decrypt, encrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { displayBouquetName, isPlaceholderBouquetName, panelHost, pickCatalogHost } from "@/core/catalog";
import { apiLogger } from "./audit";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";

export { displayBouquetName, panelHost, isPlaceholderBouquetName };

/**
 * Central bouquet names, managed by the Super Admin.
 *
 * The admin connects a panel API that returns bouquet names (XUI admin API), syncs once,
 * and the names are stored in BouquetCatalog keyed by the panel host. Resellers that connect
 * the same panel with their reseller key get the names automatically. The admin key is only
 * needed during a sync and can be removed afterwards — the stored names stay.
 */
export const SETTING_CATALOG_SOURCE = "bouquet_catalog_source";

export interface CatalogSource {
  apiUrl: string;
  apiKeyEnc: string | null;
  lastSyncedAt?: string;
  lastCount?: number;
}

export async function getCatalogSource(): Promise<CatalogSource | null> {
  return getSetting<CatalogSource | null>(SETTING_CATALOG_SOURCE, null);
}

export async function saveCatalogSource(apiUrl: string, apiKey: string | null): Promise<void> {
  const cur = await getCatalogSource();
  await setSetting(SETTING_CATALOG_SOURCE, { ...cur, apiUrl, apiKeyEnc: apiKey ? encrypt(apiKey) : cur?.apiUrl === apiUrl ? cur.apiKeyEnc : null });
}

export async function removeCatalogKey(): Promise<void> {
  const cur = await getCatalogSource();
  if (cur) await setSetting(SETTING_CATALOG_SOURCE, { ...cur, apiKeyEnc: null });
}

/** Reads all bouquets from the admin API and stores their names. Returns the number stored. */
export async function syncCatalog(): Promise<{ host: string; count: number; updatedResellerBouquets: number }> {
  const src = await getCatalogSource();
  if (!src?.apiUrl) throw new Error("Enter the panel admin API URL first.");
  if (!src.apiKeyEnc) throw new Error("The admin API key was removed. Enter it again to sync (you can remove it after the sync).");
  const adapter = createPanelAdapter("XUI_ONE", { apiUrl: src.apiUrl, apiKey: decrypt(src.apiKeyEnc) }, { testMode: false, log: apiLogger(null, "XUI") });
  const list = (await adapter.getBouquets()).filter((b) => !b.placeholder && b.name.trim());
  if (!list.length) throw new Error("This API returned no bouquet names. Use the XUI admin API (e.g. http://your-panel/adminapi) with an admin API key.");
  const host = panelHost(src.apiUrl);
  const now = new Date();
  for (const b of list) {
    await db.bouquetCatalog.upsert({
      where: { host_externalId: { host, externalId: b.id } },
      create: { host, externalId: b.id, name: b.name, syncedAt: now },
      update: { name: b.name, syncedAt: now },
    });
  }
  // Bouquets deleted on the panel disappear from the catalog.
  await db.bouquetCatalog.deleteMany({ where: { host, syncedAt: { lt: now } } });
  const updated = await applyCatalogToResellers(host);
  await setSetting(SETTING_CATALOG_SOURCE, { ...src, lastSyncedAt: now.toISOString(), lastCount: list.length });
  return { host, count: list.length, updatedResellerBouquets: updated };
}

/** Names by external bouquet id for a panel URL (empty map when the admin has not synced that panel). */
export async function catalogNamesFor(apiUrl: string): Promise<Map<string, string>> {
  const hosts = (await db.bouquetCatalog.findMany({ distinct: ["host"], select: { host: true } })).map((r) => r.host);
  const host = pickCatalogHost(apiUrl, hosts);
  if (!host) return new Map();
  const rows = await db.bouquetCatalog.findMany({ where: { host } });
  return new Map(rows.map((r) => [r.externalId, r.name]));
}

/**
 * Bouquet names to show customers for a package: placeholders ("Bouquet #12") are replaced by the
 * catalog names; ones still unknown are counted instead of shown.
 */
export async function packageBouquetNames(panelApiUrl: string, bouquets: { name: string; externalId: string }[]): Promise<{ names: string[]; unnamed: number }> {
  const needCatalog = bouquets.some((b) => isPlaceholderBouquetName(b.name));
  const catalog = needCatalog ? await catalogNamesFor(panelApiUrl) : new Map<string, string>();
  const names: string[] = [];
  let unnamed = 0;
  for (const b of bouquets) {
    const n = displayBouquetName(b.name, b.externalId, catalog);
    if (n) names.push(n);
    else unnamed++;
  }
  return { names, unnamed };
}

/**
 * Gives reseller bouquets on this panel host the catalog names. Only placeholder names
 * ("Bouquet #12") are replaced — a name the reseller typed in is never overwritten.
 */
export async function applyCatalogToResellers(host: string): Promise<number> {
  const names = new Map((await db.bouquetCatalog.findMany({ where: { host } })).map((r) => [r.externalId, r.name]));
  if (!names.size) return 0;
  const hosts = (await db.bouquetCatalog.findMany({ distinct: ["host"], select: { host: true } })).map((r) => r.host);
  const panels = (await db.panelIntegration.findMany({ select: { id: true, apiUrl: true } })).filter((p) => pickCatalogHost(p.apiUrl, hosts) === host);
  let updated = 0;
  for (const p of panels) {
    const rows = await db.bouquet.findMany({ where: { panelId: p.id } });
    for (const b of rows) {
      const n = names.get(b.externalId);
      if (n && n !== b.name && isPlaceholderBouquetName(b.name)) {
        await db.bouquet.update({ where: { id: b.id }, data: { name: n } });
        updated++;
      }
    }
  }
  return updated;
}
