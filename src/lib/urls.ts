import type { Reseller } from "@prisma/client";
import { env } from "./env";

/** Public base URL of a reseller store (custom domain when verified). */
export function storeBaseUrl(r: Pick<Reseller, "slug" | "customDomain" | "customDomainVerified">): string {
  if (r.customDomain && r.customDomainVerified) return `https://${r.customDomain}`;
  return `${env.appUrl}/store/${r.slug}`;
}

export function webhookUrl(provider: string, webhookToken: string): string {
  return `${env.appUrl}/api/webhooks/${provider.toLowerCase()}/${webhookToken}`;
}

/**
 * Path prefix used for links inside store pages. When a store is served on its own domain
 * the middleware rewrites "/" to "/store/@<host>", and links must stay root-relative.
 */
export function storeLinkBase(slugParam: string): string {
  return slugParam.startsWith("%40") || slugParam.startsWith("@") ? "" : `/store/${slugParam}`;
}
