/**
 * Customer engagement helpers: Telegram bot client for reseller notifications, WhatsApp/Viber
 * reminder texts and links. Pure logic + a tiny HTTP client, no database.
 */
import { httpRequest } from "./http";

export class TelegramError extends Error {}

/** Telegram Bot API (the reseller's own bot from @BotFather). */
export class TelegramClient {
  constructor(private token: string, private http: typeof httpRequest = httpRequest, private base = "https://api.telegram.org") {}

  static validToken(token: string): boolean {
    return /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token.trim());
  }

  private async call(method: string, body?: Record<string, unknown>): Promise<any> {
    const url = `${this.base}/bot${this.token}/${method}`;
    let r;
    try {
      r = await this.http(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 15_000 } : { timeoutMs: 15_000 });
    } catch (e) {
      throw new TelegramError(`Telegram could not be reached: ${(e as Error).message}`);
    }
    const j = r.json;
    if (!j?.ok) {
      const d = String(j?.description ?? `HTTP ${r.status}`);
      if (r.status === 401) throw new TelegramError("Telegram rejected the bot token — copy it again from @BotFather.");
      if (/chat not found/i.test(d)) throw new TelegramError("Chat not found — open your bot in Telegram and press Start first.");
      if (/blocked by the user/i.test(d)) throw new TelegramError("You blocked the bot in Telegram — unblock it and press Start.");
      throw new TelegramError(`Telegram: ${d}`);
    }
    return j.result;
  }

  async me(): Promise<{ username: string }> {
    const r = await this.call("getMe");
    return { username: String(r?.username ?? "") };
  }

  /** The chat of whoever last wrote to the bot (the reseller presses Start, then we read it). */
  async latestChat(): Promise<{ id: string; name: string } | null> {
    const updates = await this.call("getUpdates", { limit: 50, allowed_updates: ["message"] });
    const msgs = (Array.isArray(updates) ? updates : []).map((u: any) => u?.message ?? u?.channel_post).filter((m: any) => m?.chat?.id);
    const last = msgs.at(-1);
    if (!last) return null;
    const c = last.chat;
    return { id: String(c.id), name: String(c.title ?? [c.first_name, c.last_name].filter(Boolean).join(" ") ?? c.username ?? c.id) };
  }

  async send(chatId: string, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true });
  }
}

/** Escapes text for Telegram HTML messages. */
export function tgEscape(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "+387 61 234 567", "0038761234567", "061/234-567" (with default country code) → "38761234567". */
export function normalizePhone(raw: string, defaultCountry = "387"): string | null {
  let d = raw.trim();
  if (!d) return null;
  const plus = d.startsWith("+");
  d = d.replace(/[^\d]/g, "");
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.startsWith("0")) d = defaultCountry + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export interface ReminderVars {
  storeName: string;
  username: string | null;
  packageName: string;
  expiresAt: Date;
  renewUrl: string;
}

/** Short reminder for WhatsApp / Viber / SMS, in BHS and English. */
export function reminderText(v: ReminderVars, now = new Date()): string {
  const date = `${String(v.expiresAt.getUTCDate()).padStart(2, "0")}.${String(v.expiresAt.getUTCMonth() + 1).padStart(2, "0")}.${v.expiresAt.getUTCFullYear()}`;
  const days = Math.ceil((v.expiresAt.getTime() - now.getTime()) / 86_400_000);
  const user = v.username ? ` (${v.username})` : "";
  const bhs = days > 0
    ? `Pozdrav! Vaša pretplata${user} ističe ${date} (za ${days} ${days === 1 ? "dan" : "dana"}). Produžite ovdje: ${v.renewUrl}`
    : `Pozdrav! Vaša pretplata${user} je istekla ${date}. Produžite ovdje: ${v.renewUrl}`;
  const en = days > 0 ? `Your subscription${user} expires on ${date}. Renew: ${v.renewUrl}` : `Your subscription${user} expired on ${date}. Renew: ${v.renewUrl}`;
  return `${bhs}\n\n${en}\n— ${v.storeName}`;
}

export function whatsappLink(phone: string | null, text: string): string {
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(text)}`;
}

/** Opens Viber's "forward" screen with the text — the reseller picks the contact. */
export function viberLink(text: string): string {
  return `viber://forward?text=${encodeURIComponent(text)}`;
}
