import { SubmitButton } from "@/components/client";
import { Card, Flash, PageHeader, Toggle } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { connectTelegramChatAction, removeTelegramAction, saveTelegramBotAction, saveTelegramOptionsAction, sendTelegramTestAction } from "../actions/telegram";

export const metadata = { title: "Telegram alerts" };
export const dynamic = "force-dynamic";

export default async function TelegramPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const t = await db.resellerTelegram.findUnique({ where: { resellerId: reseller.id } });
  return (
    <>
      <PageHeader title="Telegram alerts" description="Every sale, renewal and failed activation on your phone right away — plus a short summary every morning. Uses your own Telegram bot (free)." />
      <Flash sp={sp} />
      {t?.lastError && <p className="mb-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">Last message failed: {t.lastError}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="1. Your bot">
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
            <li>In Telegram open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> and send <span className="font-mono">/newbot</span>.</li>
            <li>Choose a name, e.g. “{reseller.storeName} alerts”, and a username ending in <span className="font-mono">bot</span>.</li>
            <li>Copy the token BotFather sends and paste it here.</li>
          </ol>
          <form action={saveTelegramBotAction} className="space-y-3">
            <input className="input font-mono" name="token" type="password" autoComplete="off" required placeholder={t ? "•••••• saved — paste a new token to replace" : "123456789:AAH…"} />
            <SubmitButton>{t ? "Replace bot" : "Save bot"}</SubmitButton>
          </form>
        </Card>
        <Card title="2. Connect your chat">
          {!t ? (
            <p className="muted text-sm">Save your bot first.</p>
          ) : (
            <>
              <p className="mb-4 text-sm">Open your bot in Telegram, press <b>Start</b> (or send “hi”), then click the button. To get alerts in a group, add the bot to the group, write a message there, then click the button.</p>
              <div className="flex flex-wrap items-center gap-3">
                <form action={connectTelegramChatAction}><SubmitButton className={t.chatId ? "btn-secondary" : "btn-primary"}>{t.chatId ? "Connect again" : "Connect my chat"}</SubmitButton></form>
                {t.chatId && <span className="badge-green">connected</span>}
              </div>
            </>
          )}
        </Card>
        {t?.chatId && (
          <Card title="3. What to send">
            <form action={saveTelegramOptionsAction} className="space-y-4">
              <Toggle name="enabled" label="Telegram alerts on" defaultChecked={t.enabled} />
              <Toggle name="notifySales" label="New lines and renewals" defaultChecked={t.notifySales} hint="Username, package, amount — the moment the line is active." />
              <Toggle name="notifyFailures" label="Failed activations" defaultChecked={t.notifyFailures} hint="A customer paid but the line could not be created — so you can fix it fast." />
              <Toggle name="dailySummary" label="Daily summary (morning)" defaultChecked={t.dailySummary} hint="Sales of the last 24h, lines expiring in 3 days, VOD news." />
              <SubmitButton>Save</SubmitButton>
            </form>
            <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <form action={sendTelegramTestAction}><SubmitButton className="btn-secondary">Send a test summary</SubmitButton></form>
              <form action={removeTelegramAction}><SubmitButton className="btn-ghost text-rose-600" confirm="Remove Telegram alerts?">Remove</SubmitButton></form>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
