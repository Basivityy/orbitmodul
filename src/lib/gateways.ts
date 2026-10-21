import type { PaymentGateway, PaymentProvider } from "@prisma/client";
import { decryptJson } from "@/core/crypto";
import { getProvider } from "@/core/payments";
import { db } from "./db";

export async function enabledGateways(resellerId: string, opts: { includeTest?: boolean } = {}): Promise<PaymentGateway[]> {
  const rows = await db.paymentGateway.findMany({ where: { resellerId, enabled: true }, orderBy: { createdAt: "asc" } });
  return rows.filter((g) => opts.includeTest || g.provider !== "TEST");
}

export function gatewayCreds(g: PaymentGateway): Record<string, string> {
  return decryptJson<Record<string, string>>(g.credentialsEnc);
}

export async function loadGateway(resellerId: string, provider: PaymentProvider) {
  const g = await db.paymentGateway.findUnique({ where: { resellerId_provider: { resellerId, provider } } });
  if (!g) return null;
  return { row: g, impl: getProvider(provider), creds: gatewayCreds(g), opts: { sandbox: g.sandbox } };
}
