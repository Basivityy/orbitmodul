/** Panel identity for the shared bouquet catalog: the API host without "www." (port kept). */
export function panelHost(apiUrl: string): string {
  try {
    return new URL(apiUrl).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return apiUrl.trim().toLowerCase();
  }
}

/** Names generated when a panel API returns ids only. */
export function isPlaceholderBouquetName(name: string): boolean {
  return /^Bouquet #\S+$/.test(name.trim());
}

/**
 * Which catalog host serves a panel: exact host, then the same host name on another port, then —
 * when the Super Admin synced exactly one panel — that one (the platform serves one XUI panel;
 * resellers often connect it under another domain/IP than the admin used).
 */
export function pickCatalogHost(panelApiUrl: string, catalogHosts: string[]): string | null {
  const hosts = [...new Set(catalogHosts)];
  const h = panelHost(panelApiUrl);
  if (hosts.includes(h)) return h;
  const name = h.replace(/:\d+$/, "");
  const sameName = hosts.filter((x) => x.replace(/:\d+$/, "") === name);
  if (sameName.length === 1) return sameName[0];
  return hosts.length === 1 ? hosts[0] : null;
}

/** Display name for a bouquet: the stored name, or the catalog name when it is still a placeholder. */
export function displayBouquetName(name: string, externalId: string, catalog: Map<string, string>): string | null {
  if (!isPlaceholderBouquetName(name)) return name;
  return catalog.get(externalId) ?? null;
}

/** XUI reseller API (…/resellerapi): lines can only be created and extended from a panel package. */
export function isResellerApiUrl(apiUrl: string): boolean {
  try {
    return /reseller/i.test(new URL(apiUrl).pathname);
  } catch {
    return /reseller/i.test(apiUrl);
  }
}

/** Whether a package can be activated on its panel (a reseller-API panel needs a linked panel package). */
export function packageSellable(pkg: { externalPackageId: string | null; panel: { apiUrl: string } }): boolean {
  return !!pkg.externalPackageId || !isResellerApiUrl(pkg.panel.apiUrl);
}
