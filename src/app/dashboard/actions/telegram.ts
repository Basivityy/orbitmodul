"use server";

import { decrypt, encrypt } from "@/core/crypto";
import { TelegramClient, TelegramError } from "@/core/engage";
import { act, bool, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { dailySummary } from "@/lib/telegram";

const BACK = "/dashboard/telegram";
const tgError = (e: unknown) => (e instanceof TelegramError ? new UserError(e.message) : e);

export async function saveTelegramBotAction(fd: FormData) {
  return act(BACK, async () => {
    const { user, reseller } = await requireReseller();
    const token = str(fd, "token", 200).replace(/\s+/g, "");
    if (!TelegramClient.validToken(token)) throw new UserError("That is not a bot token. In Telegram open @BotFather, send /newbot and copy the token it gives you (looks like 123456789:AAH…).");
    if (!(await rateLimit(`tg:${reseller.id}`, 15, 600))) throw new UserError("Too many attempts. Please wait a few minutes.");
    let name: string;
    try {
      name = (await new TelegramClient(token).me()).username;
    } catch (e) {
      throw tgError(e);
    }
    const data = { botTokenEnc: encrypt(token), chatId: null, lastError: null };
    await db.resellerTelegram.upsert({ where: { resellerId: reseller.id }, create: { resellerId: reseller.id, ...data }, update: data });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "telegram.bot_saved", meta: { bot: name } });
    return `Bot @${name} saved. Now open it in Telegram, press Start, then click “Connect my chat”.`;
  });
}

export async function connectTelegramChatAction() {
  return act(BACK, async () => {
    const { user, reseller } = await requireReseller();
    const t = await db.resellerTelegram.findUnique({ where: { resellerId: reseller.id } });
    if (!t) throw new UserError("Save your bot token first.");
    if (!(await rateLimit(`tg:${reseller.id}`, 15, 600))) throw new UserError("Too many attempts. Please wait a few minutes.");
    const bot = new TelegramClient(decrypt(t.botTokenEnc));
    try {
      const chat = await bot.latestChat();
      if (!chat) throw new UserError("No message found. Open your bot in Telegram, press Start (or send “hi”), then click “Connect my chat” again.");
      await bot.send(chat.id, `✅ Connected to <b>${reseller.storeName.replace(/[<>&]/g, "")}</b>. You will get your sales and alerts here.`);
      await db.resellerTelegram.update({ where: { id: t.id }, data: { chatId: chat.id, lastError: null, enabled: true } });
      await audit({ actor: actorOf(user), resellerId: reseller.id, action: "telegram.chat_connected" });
      return `Connected to ${chat.name}. A test message was sent.`;
    } catch (e) {
      throw tgError(e);
    }
  });
}

export async function saveTelegramOptionsAction(fd: FormData) {
  return act(BACK, async () => {
    const { reseller } = await requireReseller();
    const t = await db.resellerTelegram.findUnique({ where: { resellerId: reseller.id } });
    if (!t) throw new UserError("Save your bot token first.");
    await db.resellerTelegram.update({ where: { id: t.id }, data: { enabled: bool(fd, "enabled"), notifySales: bool(fd, "notifySales"), notifyFailures: bool(fd, "notifyFailures"), dailySummary: bool(fd, "dailySummary") } });
    return "Saved.";
  });
}

export async function sendTelegramTestAction() {
  return act(BACK, async () => {
    const { reseller } = await requireReseller();
    const t = await db.resellerTelegram.findUnique({ where: { resellerId: reseller.id } });
    if (!t?.chatId) throw new UserError("Connect your chat first.");
    if (!(await rateLimit(`tg:${reseller.id}`, 15, 600))) throw new UserError("Too many attempts. Please wait a few minutes.");
    try {
      await new TelegramClient(decrypt(t.botTokenEnc)).send(t.chatId, await dailySummary(reseller.id));
    } catch (e) {
      throw tgError(e);
    }
    return "Sent — check Telegram (this is how the daily summary looks).";
  });
}

export async function removeTelegramAction() {
  return act(BACK, async () => {
    const { user, reseller } = await requireReseller();
    await db.resellerTelegram.deleteMany({ where: { resellerId: reseller.id } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "telegram.removed" });
    return "Telegram notifications removed.";
  });
}
