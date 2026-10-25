import { decrypt } from "@/core/crypto";
import { TelegramClient, tgEscape } from "@/core/engage";
import { formatMoney } from "@/core/money";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { db } from "./db";

/**
 * Telegram notifications for resellers (their own bot): sale / renewal / failed activation right
 * away, and a short daily summary. Never throws — a Telegram problem must not affect billing.
 */
async function target(resellerId: string, kind: "sales" | "failures" | "summary") {
  const t = await db.resellerTelegram.findUnique({ where: { resellerId } });
  if (!t || !t.enabled || !t.chatId) return null;
  if (kind === "sales" && !t.notifySales) return null;
  if (kind === "failures" && !t.notifyFailures) return null;
  if (kind === "summary" && !t.dailySummary) return null;
  return t;
}

export async function notifyReseller(resellerId: string, kind: "sales" | "failures" | "summary", html: string): Promise<boolean> {
  try {
    const t = await target(resellerId, kind);
    if (!t) return false;
    await new TelegramClient(decrypt(t.botTokenEnc)).send(t.chatId!, html);
    if (t.lastError) await db.resellerTelegram.update({ where: { id: t.id }, data: { lastError: null } });
    return true;
  } catch (e) {
    await db.resellerTelegram.updateMany({ where: { resellerId }, data: { lastError: String((e as Error).message).slice(0, 300) } }).catch(() => undefined);
    return false;
  }
}

/** After an activation job: new line, renewal, or a final failure. */
export async function notifyActivation(orderId: string, outcome: { status: string; final?: boolean; error?: string }): Promise<void> {
  try {
    if (outcome.status !== "completed" && !(outcome.status === "failed" && outcome.final)) return;
    const o = await db.order.findUnique({ where: { id: orderId }, include: { customer: true, subscription: true, package: true } });
    if (!o) return;
    const who = isPlaceholderEmail(o.customer.email) ? "" : ` · ${tgEscape(o.customer.email)}`;
    const user = o.subscription?.lineUsername ?? o.lineUsername ?? "";
    const paid = o.provider === "MANUAL" ? (o.idempotencyKey?.startsWith("code-") ? "activation code" : "added by you") : formatMoney(o.amountCents, o.currency);
    if (outcome.status === "completed") {
      const until = o.subscription?.expiresAt ? o.subscription.expiresAt.toISOString().slice(0, 10) : "";
      const head = o.kind === "RENEWAL" ? "🔁 <b>Renewed</b>" : "🟢 <b>New line</b>";
      await notifyReseller(o.resellerId, "sales", `${head}: <code>${tgEscape(user)}</code>\n${tgEscape(o.package.name)} · ${tgEscape(paid)}${who}${until ? `\nValid until ${until}` : ""}`);
    } else {
      await notifyReseller(o.resellerId, "failures", `🔴 <b>Activation failed</b> — order ${tgEscape(o.number)}${user ? ` (<code>${tgEscape(user)}</code>)` : ""}\n${tgEscape((outcome.error ?? "").slice(0, 300))}\nOpen Orders &amp; activations and click Retry.`);
    }
  } catch {
    /* never affects billing */
  }
}

/** One short message per day: what expires soon, yesterday's sales, VOD news. */
export async function dailySummary(resellerId: string, now = new Date()): Promise<string> {
  const day = 86_400_000;
  const [expiring3, expired1, sales, vod] = await Promise.all([
    db.subscription.count({ where: { resellerId, status: "ACTIVE", isTest: false, expiresAt: { gte: now, lte: new Date(now.getTime() + 3 * day) } } }),
    db.subscription.count({ where: { resellerId, isTest: false, expiresAt: { gte: new Date(now.getTime() - day), lt: now } } }),
    db.order.findMany({ where: { resellerId, status: "COMPLETED", updatedAt: { gte: new Date(now.getTime() - day) } }, select: { kind: true, amountCents: true, currency: true } }),
    db.vodSeries.count({ where: { resellerId, ignored: false, status: "NEW_EPISODE" } }),
  ]);
  const totals = new Map<string, number>();
  for (const s of sales) totals.set(s.currency, (totals.get(s.currency) ?? 0) + s.amountCents);
  const money = [...totals].filter(([, v]) => v > 0).map(([c, v]) => formatMoney(v, c)).join(" + ") || "—";
  const lines = [
    "☀️ <b>Daily summary</b>",
    `Last 24h: ${sales.filter((s) => s.kind === "NEW").length} new, ${sales.filter((s) => s.kind === "RENEWAL").length} renewed · ${tgEscape(money)}`,
    `Expiring in 3 days: <b>${expiring3}</b>${expired1 ? ` · expired yesterday: ${expired1}` : ""}`,
  ];
  if (vod) lines.push(`VOD: ${vod} series have a new episode that is not on the panel`);
  if (expiring3 || expired1) lines.push("Open “Expiring lines” to send reminders.");
  return lines.join("\n");
}
