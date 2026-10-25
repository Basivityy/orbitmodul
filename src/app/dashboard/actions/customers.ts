"use server";
import { LineScanError, startLineImport, stopLineImport } from "@/lib/lineScanJob";

import { generateLineUsername, isValidEmail } from "@/core/ids";
import { placeholderEmail } from "@/core/importedCustomers";
import { act, bool, optStr, str, UserError } from "@/lib/action";
import { apiLogger, audit } from "@/lib/audit";
import { decrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { effectiveTestMode } from "@/lib/activationStore";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { CheckoutError, createManualOrder } from "@/lib/orders";
import { CustomerDeleteError, deleteCustomer } from "@/lib/customerDelete";
import { importExistingLine, LineImportError } from "@/lib/lineImport";

/**
 * Add a customer by hand: creates a MANUAL order and activates the line like an online sale.
 * Amount = the package price (set on the package); duration = the package duration.
 * Email is optional (recommended): without it the customer gets no emails and is listed by line username.
 */
export async function addCustomerManuallyAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/customers/new", async () => {
    const rawEmail = str(fd, "email", 254).trim().toLowerCase();
    if (rawEmail && !isValidEmail(rawEmail)) throw new UserError("Enter a valid customer email — or leave it empty.");
    const pkg = await db.package.findFirst({ where: { id: str(fd, "packageId", 40), resellerId: reseller.id } });
    if (!pkg) throw new UserError("Select a package.");
    if (bool(fd, "maxplayer")) {
      const mp = await db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id } });
      if (!mp?.enabled || !mp.domainId) throw new UserError("MaxPlayer is not set up yet: open the MaxPlayer page, save your token, choose the domain and enable it — or untick MaxPlayer.");
    }

    // The package price (0 for free/test packages) — set on the package, not here.
    const amountMinor = pkg.priceCents;

    const typedUsername = optStr(fd, "username", 40);
    let username = typedUsername;
    const password = optStr(fd, "password", 40);
    if (username && !/^[a-zA-Z0-9_.-]{4,40}$/.test(username)) throw new UserError("Username: 4–40 letters, numbers, dot, dash or underscore.");
    if (password && !/^[a-zA-Z0-9_.-]{4,40}$/.test(password)) throw new UserError("Password: 4–40 letters, numbers, dot, dash or underscore.");
    // No email: the line username is chosen now, so the customer is listed under it (placeholder address, never emailed).
    if (!rawEmail && !username) username = generateLineUsername(reseller.linePrefix);
    const email = rawEmail || placeholderEmail(username!);

    if (typedUsername) {
      // Refuse a username that already exists on the XUI panel (it belongs to another line).
      const panel = await db.panelIntegration.findUnique({ where: { id: pkg.panelId } });
      if (panel && !effectiveTestMode(panel.testMode)) {
        const adapter = createPanelAdapter(panel.type, { apiUrl: panel.apiUrl, apiKey: decrypt(panel.apiKeyEnc), extraParams: (panel.extraParams as Record<string, string>) ?? {}, lineOwnerId: panel.lineOwnerId }, { testMode: false, log: apiLogger(reseller.id, "XUI") });
        const taken = await adapter.findLineByUsername(typedUsername).catch(() => null);
        if (taken) throw new UserError(`Username "${typedUsername}" already exists on your XUI panel. Choose another one — or extend that customer from Subscriptions.`);
      }
    }

    try {
      const order = await createManualOrder({
        resellerId: reseller.id,
        email,
        name: optStr(fd, "name", 100) ?? undefined,
        packageId: pkg.id,
        amountMinor,
        username: username ?? undefined,
        password: password ?? undefined,
        notifyCustomer: !!rawEmail && bool(fd, "notify"),
        maxPlayer: bool(fd, "maxplayer"),
        note: optStr(fd, "note", 500) ?? undefined,
      });
      await audit({ actor: actorOf(user), resellerId: reseller.id, action: "customer.added_manually", target: email, meta: { orderId: order.id, amountMinor, currency: pkg.currency, noEmail: !rawEmail } });
      return { redirect: `/dashboard/orders/${order.id}`, message: "Customer added — the line is being created now." };
    } catch (e) {
      if (e instanceof CheckoutError) throw new UserError(e.message);
      throw e;
    }
  });
}

/** Deletes a customer; optionally also deletes their XUI line(s) and MaxPlayer account. */
export async function deleteCustomerAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "customerId", 40);
  return act(`/dashboard/customers/${id}`, async () => {
    // One click + the browser confirm dialog on the button; no typing the username/email.
    const c = await db.customer.findFirst({ where: { id, resellerId: reseller.id }, select: { email: true } });
    if (!c) throw new UserError("Customer not found.");
    const removeRemote = bool(fd, "removeRemote");
    let r;
    try {
      r = await deleteCustomer(reseller.id, id, { removeRemote });
    } catch (e) {
      if (e instanceof CustomerDeleteError) throw new UserError(e.message);
      throw e;
    }
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "customer.deleted", target: c.email, meta: { removeRemote, ...r } });
    const remote = !removeRemote
      ? " The line on the XUI panel was not touched."
      : ` Deleted ${r.linesDeleted} XUI line(s) and ${r.maxPlayerDeleted} MaxPlayer account(s)${r.simulated ? " (test mode — simulated, nothing real was deleted)" : ""}.`;
    return { redirect: "/dashboard/customers", message: `Customer ${c.email} deleted.${remote}` };
  });
}

/** "Load existing line": brings a line that already exists on the panel into billing. */
export async function loadExistingLineAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/customers/existing", async () => {
    const lineId = str(fd, "lineId", 12).trim();
    const username = str(fd, "username", 60).trim();
    const password = str(fd, "password", 60).trim();
    const email = optStr(fd, "email", 254)?.trim().toLowerCase() || null;
    if (!/^\d{1,12}$/.test(lineId)) throw new UserError("Line ID must be a number (from the panel address bar, e.g. 73736).");
    if (!username || !password) throw new UserError("Enter the username and password of the line.");
    if (email && !isValidEmail(email)) throw new UserError("Enter a valid email or leave it empty.");
    let r;
    try {
      r = await importExistingLine(reseller.id, { panelId: str(fd, "panelId", 40), lineId, username, password, email, checkMaxPlayer: bool(fd, "checkMaxPlayer") });
    } catch (e) {
      if (e instanceof LineImportError) throw new UserError(e.message);
      throw e;
    }
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "customer.line_loaded", target: username, meta: { lineId, maxPlayer: r.maxPlayer } });
    return { redirect: `/dashboard/subscriptions/${r.subscriptionId}`, message: `Line ${username} loaded${r.active ? "" : " (expired)"}${r.maxPlayer ? " — uses MaxPlayer" : ""}. The customer can now extend it on your store with their username.` };
  });
}

/** "Import all my lines": start / check new / continue / stop the background scan. */
export async function lineImportAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/customers/existing", async () => {
    const panelId = str(fd, "panelId", 40);
    const op = str(fd, "op", 10);
    if (op === "stop") {
      await stopLineImport(reseller.id, panelId);
      return "Import stopped. Click “Continue” to go on from where it stopped.";
    }
    const raw = str(fd, "ceiling", 12).trim();
    const ceiling = raw ? Number(raw) : null;
    if (raw && (!Number.isInteger(ceiling) || ceiling! < 1 || ceiling! > 50_000_000)) throw new UserError("Highest line ID must be a number, e.g. 80000.");
    const mode = op === "new" ? "new" : op === "continue" ? "continue" : "full";
    try {
      await startLineImport(reseller.id, panelId, { mode, ceiling });
    } catch (e) {
      if (e instanceof LineScanError) throw new UserError(e.message);
      throw e;
    }
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "customer.line_import_started", meta: { mode, ceiling } });
    return mode === "new" ? "Looking for new lines on the panel…" : "Import started. It runs in the background — you can leave this page.";
  });
}
