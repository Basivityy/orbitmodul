import { notFound } from "next/navigation";
import { db } from "./db";
import { env } from "./env";
import { loadResellerSaas, sellBlockers } from "./saas";

/**
 * Resolves the store for a `[slug]` route param. "@host" means the request came in on a
 * reseller's custom domain (see middleware). Returns the link base used inside store pages.
 */
export async function resolveStore(slugParam: string) {
  const slug = decodeURIComponent(slugParam);
  const byDomain = slug.startsWith("@");
  const reseller = byDomain
    ? await db.reseller.findFirst({ where: { customDomain: slug.slice(1), customDomainVerified: true } })
    : await db.reseller.findUnique({ where: { slug } });
  if (!reseller || reseller.status !== "ACTIVE") notFound();
  const full = await loadResellerSaas(reseller.id);
  const owner = await db.user.findUniqueOrThrow({ where: { id: reseller.ownerUserId } });
  const blockers = await sellBlockers(full, !!owner.emailVerifiedAt);
  const base = byDomain ? "" : `/store/${reseller.slug}`;
  const absoluteBase = byDomain ? `https://${reseller.customDomain}` : `${env.appUrl}/store/${reseller.slug}`;
  return { reseller: full, base, absoluteBase, canSell: blockers.length === 0, blockers };
}
