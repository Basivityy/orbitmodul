import { decrypt, encrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { checkExistingLine } from "@/core/existingLine";
import { IMPORT_PACKAGE_NAME, placeholderEmail } from "@/core/importedCustomers";
import { maxPlayerClientFactory } from "./activationStore";
import { apiLogger } from "./audit";
import { db } from "./db";
import { assertCustomerCapacity, CheckoutError } from "./orders";

export class LineImportError extends Error {}

/** Hidden package that loaded lines are attached to until the customer buys a real one. */
export async function importPackage(resellerId: string, panelId: string, currency: string) {
  const name = IMPORT_PACKAGE_NAME;
  const existing = await db.package.findFirst({ where: { resellerId, panelId, name, active: false } });
  if (existing) return existing;
  return db.package.create({ data: { resellerId, panelId, name, description: "Lines that existed on the panel before billing. Not for sale.", priceCents: 0, currency, durationDays: 30, maxConnections: 1, active: false, sortOrder: 9999 } });
}

/**
 * "Load existing line": the reseller enters the line ID (from the panel), username and password.
 * The line is read from the panel (read-only), checked, and stored as customer + subscription so
 * the customer can extend on the store and the reseller can manage/delete it here.
 * MaxPlayer: only marked when an account with this username already exists — never created.
 */
export async function importExistingLine(
  resellerId: string,
  input: { panelId: string; lineId: string; username: string; password: string; email?: string | null; checkMaxPlayer: boolean },
): Promise<{ subscriptionId: string; maxPlayer: boolean; expiresAt: Date | null; active: boolean }> {
  const panel = await db.panelIntegration.findFirst({ where: { id: input.panelId, resellerId } });
  if (!panel) throw new LineImportError("Select your XUI panel.");
  const dup = await db.subscription.findFirst({ where: { resellerId, panelId: panel.id, OR: [{ xuiLineId: input.lineId }, { lineUsername: input.username }] } });
  if (dup) throw new LineImportError(`This line is already in your billing (${dup.lineUsername}).`);

  const adapter = createPanelAdapter(panel.type, { apiUrl: panel.apiUrl, apiKey: decrypt(panel.apiKeyEnc), extraParams: (panel.extraParams as Record<string, string>) ?? {}, lineOwnerId: panel.lineOwnerId }, { testMode: false, log: apiLogger(resellerId, "XUI") });
  let line;
  let owner: string | null = null;
  try {
    line = await adapter.getLine(input.lineId);
    // With a reseller key the owner is the key's account; with an admin key, the configured line owner (if any).
    owner = /reseller/i.test(new URL(panel.apiUrl).pathname) ? ((await adapter.testConnection()).memberId ?? null) : panel.lineOwnerId;
  } catch (e) {
    throw new LineImportError(`Could not read the line from the panel: ${(e as Error).message}`);
  }
  const problem = checkExistingLine(line, input, owner);
  if (problem || !line) throw new LineImportError(problem ?? "Line not found.");

  const now = new Date();
  const active = !!line.expiresAt && line.expiresAt > now && line.enabled !== false;
  const reseller = await db.reseller.findUniqueOrThrow({ where: { id: resellerId } });
  const email = (input.email?.trim().toLowerCase() || placeholderEmail(line.username));
  const customer = await db.customer.upsert({ where: { resellerId_email: { resellerId, email } }, create: { resellerId, email, notes: "Existing line loaded from the panel" }, update: {} });
  if (active) {
    try {
      await assertCustomerCapacity(resellerId, customer.id, "Your plan's active customer limit is reached. Upgrade your plan to add more customers.");
    } catch (e) {
      if (e instanceof CheckoutError) throw new LineImportError(e.message);
      throw e;
    }
  }

  let mpId: string | null = null;
  if (input.checkMaxPlayer) {
    const mp = await db.maxPlayerIntegration.findUnique({ where: { resellerId } });
    if (mp) {
      const hits = await maxPlayerClientFactory(resellerId)(decrypt(mp.apiKeyEnc)).searchByUsername(line.username).catch(() => []);
      const hit = hits.find((h) => h.username === line!.username || JSON.stringify(h.raw ?? {}).includes(`"${line!.username}"`));
      if (hit?.id) mpId = hit.id;
    }
  }

  const pkg = await importPackage(resellerId, panel.id, reseller.defaultCurrency);
  const sub = await db.subscription.create({
    data: {
      resellerId,
      customerId: customer.id,
      packageId: pkg.id,
      panelId: panel.id,
      status: active ? "ACTIVE" : "EXPIRED",
      priceCents: 0,
      currency: reseller.defaultCurrency,
      durationDays: 30,
      expiresAt: line.expiresAt,
      xuiLineId: line.id,
      lineUsername: line.username,
      linePasswordEnc: encrypt(line.password ?? input.password),
      maxConnections: line.maxConnections,
      panelNotes: line.notes ?? null,
      panelTrial: !!line.isTrial,
      panelKind: line.kind ?? "line",
      ...(mpId ? { maxPlayerStatus: "ACTIVE" as const, maxPlayerUserId: mpId } : {}),
    },
  });
  return { subscriptionId: sub.id, maxPlayer: !!mpId, expiresAt: line.expiresAt, active };
}

/** Store "I'm already a customer": lines that are in billing (created here or loaded by the reseller). */
export async function findLineForRenewal(resellerId: string, username: string) {
  return db.subscription.findFirst({ where: { resellerId, lineUsername: username, xuiLineId: { not: null } }, orderBy: { createdAt: "desc" } });
}
