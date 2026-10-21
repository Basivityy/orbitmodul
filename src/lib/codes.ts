import type { Prisma } from "@prisma/client";
import { generateCode } from "@/core/codes";
import { randomToken } from "@/core/crypto";
import { orderNumber } from "@/core/ids";
import { customerUsernameError } from "@/core/usernames";
import { appCustomerEmail } from "@/core/appApi";
import { db } from "./db";
import { assertCustomerCapacity, CheckoutError, createInvoice, snapshotPackage, usernameTaken } from "./orders";
import { enqueueActivation } from "./queue";

export const MAX_CODES_PER_BATCH = 500;

export async function createCodes(resellerId: string, packageId: string, count: number, batch: string | null): Promise<string[]> {
  const pkg = await db.package.findFirst({ where: { id: packageId, resellerId } });
  if (!pkg) throw new CheckoutError("Package not found.");
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateCode());
  await db.activationCode.createMany({ data: Array.from(codes).map((code) => ({ resellerId, packageId, code, batch })), skipDuplicates: true });
  return Array.from(codes);
}

export type RedeemInput =
  | { mode: "new"; code: string; email: string; username: string; device?: string }
  /** From the customer app: username and password are generated, no email. */
  | { mode: "app"; code: string }
  | { mode: "extend"; code: string; subscriptionId: string; email?: string | null };

/**
 * Redeems a code exactly once and creates a paid order (provider MANUAL, amount 0 — the money
 * was taken by the reseller elsewhere). The normal activation engine then creates or extends the
 * line, runs MaxPlayer and emails the customer.
 */
export async function redeemCode(resellerId: string, input: RedeemInput): Promise<{ accessToken: string }> {
  const row = await db.activationCode.findFirst({ where: { code: input.code, resellerId }, include: { package: true } });
  if (!row || row.status === "VOID") throw new CheckoutError("This code is not valid. Check it and try again.");
  if (row.status === "USED") throw new CheckoutError("This code was already used.");
  const pkg = row.package;

  let customerId: string;
  let subscriptionId: string | null = null;
  let lineUsername: string | null = null;
  let email: string;
  if (input.mode === "app") {
    email = appCustomerEmail(input.code);
    const customer = await db.customer.upsert({ where: { resellerId_email: { resellerId, email } }, create: { resellerId, email, notes: "Created from the app" }, update: {} });
    await assertCustomerCapacity(resellerId, customer.id, "This store has reached its customer limit. Please contact the store.");
    customerId = customer.id;
  } else if (input.mode === "new") {
    const err = customerUsernameError(input.username);
    if (err) throw new CheckoutError(err);
    if (await usernameTaken(resellerId, input.username)) throw new CheckoutError(`The username "${input.username}" is already taken. Please choose another one.`);
    email = input.email.trim().toLowerCase();
    // The device chosen on the activation link is kept as a note for the reseller's support.
    const customer = await db.customer.upsert({ where: { resellerId_email: { resellerId, email } }, create: { resellerId, email, notes: input.device ? `Device: ${input.device}` : null }, update: {} });
    await assertCustomerCapacity(resellerId, customer.id, "This store has reached its customer limit. Please contact the store.");
    customerId = customer.id;
    lineUsername = input.username;
  } else {
    const sub = await db.subscription.findFirst({ where: { id: input.subscriptionId, resellerId, xuiLineId: { not: null } }, include: { customer: true } });
    if (!sub) throw new CheckoutError("Line not found.");
    if (sub.panelId !== pkg.panelId) throw new CheckoutError("This code cannot be used for this line. Please contact the store.");
    customerId = sub.customerId;
    subscriptionId = sub.id;
    email = sub.customer.email;
  }

  const snap = await snapshotPackage(pkg.id, resellerId, 0, pkg.currency);
  const token = randomToken(24);
  const order = await db.$transaction(async (tx) => {
    // Atomic one-time use: only one request can flip UNUSED → USED.
    const claimed = await tx.activationCode.updateMany({ where: { id: row.id, status: "UNUSED" }, data: { status: "USED", usedAt: new Date(), usedByEmail: email, subscriptionId, lineUsername } });
    if (claimed.count !== 1) throw new CheckoutError("This code was already used.");
    const o = await tx.order.create({
      data: {
        number: orderNumber("COD"),
        resellerId,
        customerId,
        packageId: pkg.id,
        subscriptionId,
        kind: subscriptionId ? "RENEWAL" : "NEW",
        status: "PAID",
        paidAt: new Date(),
        amountCents: 0,
        currency: pkg.currency,
        provider: "MANUAL",
        providerPaymentId: `code-${row.id}`,
        packageSnapshot: snap as unknown as Prisma.InputJsonValue,
        accessToken: token,
        idempotencyKey: `code-${row.id}`,
        notifyCustomer: true,
        lineUsername,
      },
    });
    await tx.activationCode.update({ where: { id: row.id }, data: { orderId: o.id } });
    return o;
  });
  await createInvoice(order.id).catch(() => undefined);
  await enqueueActivation(order.id).catch((e) => console.error("[queue] activation enqueue failed; sweeper will retry", e.message));
  return { accessToken: order.accessToken };
}
