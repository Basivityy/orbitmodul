import { decrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { effectiveTestMode, maxPlayerClientFactory } from "./activationStore";
import { apiLogger } from "./audit";
import { db } from "./db";

export class CustomerDeleteError extends Error {}

const BUSY = ["PAID", "ACTIVATING"] as const;

/**
 * Deletes a customer of one reseller.
 *
 * With `removeRemote`, every line of the customer is deleted on the XUI panel and the MaxPlayer
 * account is deleted too (simulated while the panel / MaxPlayer is in test mode). If a remote
 * delete fails nothing is removed here, so it can be retried — or repeated with removeRemote=false
 * to remove the customer from billing only.
 *
 * Revenue records (transactions) are kept for the reports; orders, invoices and subscriptions go.
 */
export async function deleteCustomer(resellerId: string, customerId: string, opts: { removeRemote: boolean }): Promise<{ linesDeleted: number; maxPlayerDeleted: number; simulated: boolean }> {
  const c = await db.customer.findFirst({
    where: { id: customerId, resellerId },
    include: { subscriptions: { include: { panel: true } }, orders: { select: { id: true, status: true } } },
  });
  if (!c) throw new CustomerDeleteError("Customer not found.");
  if (c.orders.some((o) => (BUSY as readonly string[]).includes(o.status))) throw new CustomerDeleteError("A line for this customer is being activated right now. Wait a minute and try again.");
  const autoRenew = c.subscriptions.find((s) => s.autoRenew && s.providerSubscriptionId);
  if (autoRenew) throw new CustomerDeleteError("This customer has an automatic card renewal. Open the subscription, click “Cancel auto-renew” first, then delete the customer.");

  let linesDeleted = 0;
  let maxPlayerDeleted = 0;
  let simulated = false;
  if (opts.removeRemote) {
    const mp = await db.maxPlayerIntegration.findUnique({ where: { resellerId } });
    for (const s of c.subscriptions) {
      if (s.xuiLineId && !s.xuiLineId.startsWith("TEST-")) {
        const testMode = effectiveTestMode(s.panel.testMode) || s.isTest;
        simulated ||= testMode;
        const adapter = createPanelAdapter(s.panel.type, { apiUrl: s.panel.apiUrl, apiKey: decrypt(s.panel.apiKeyEnc), extraParams: (s.panel.extraParams as Record<string, string>) ?? {}, lineOwnerId: s.panel.lineOwnerId }, { testMode, log: apiLogger(resellerId, "XUI") });
        try {
          await adapter.deleteLine(s.xuiLineId);
        } catch (e) {
          throw new CustomerDeleteError(`Could not delete line ${s.lineUsername ?? s.xuiLineId} on the XUI panel: ${(e as Error).message}. Nothing was deleted. Untick “Also delete on XUI panel and MaxPlayer” to remove the customer from billing only.`);
        }
        linesDeleted++;
      }
      if (s.maxPlayerUserId && mp) {
        const testMode = effectiveTestMode(mp.testMode) || s.isTest;
        simulated ||= testMode;
        if (!testMode) {
          try {
            await maxPlayerClientFactory(resellerId)(decrypt(mp.apiKeyEnc)).deleteCustomer(s.maxPlayerUserId);
          } catch (e) {
            throw new CustomerDeleteError(`Could not delete the MaxPlayer account of ${s.lineUsername ?? "this customer"}: ${(e as Error).message}. The XUI line was already deleted; try again or untick the option.`);
          }
        }
        maxPlayerDeleted++;
      }
    }
  }

  const subIds = c.subscriptions.map((s) => s.id);
  const orderIds = c.orders.map((o) => o.id);
  await db.$transaction([
    // Keep revenue history, detached from the deleted records.
    db.transaction.updateMany({ where: { resellerId, OR: [{ orderId: { in: orderIds } }, { subscriptionId: { in: subIds } }] }, data: { orderId: null, subscriptionId: null } }),
    db.invoice.deleteMany({ where: { customerId: c.id } }),
    db.order.deleteMany({ where: { customerId: c.id } }),
    db.subscription.deleteMany({ where: { customerId: c.id } }),
    db.customer.delete({ where: { id: c.id } }),
  ]);
  return { linesDeleted, maxPlayerDeleted, simulated };
}
