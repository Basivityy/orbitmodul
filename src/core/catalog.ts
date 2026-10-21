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
