import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, reminderText, TelegramClient, TelegramError, tgEscape, viberLink, whatsappLink } from "../../src/core/engage";
import { startServer } from "../mocks/servers";

test("engage: phone numbers are normalised for WhatsApp", () => {
  assert.equal(normalizePhone("+387 61 234 567"), "38761234567");
  assert.equal(normalizePhone("0038761234567"), "38761234567");
  assert.equal(normalizePhone("061/234-567"), "38761234567");
  assert.equal(normalizePhone("0171 2345678", "49"), "491712345678");
  assert.equal(normalizePhone("12"), null);
  assert.equal(normalizePhone(""), null);
});

test("engage: reminder text in BHS + EN, before and after expiry", () => {
  const now = new Date("2026-10-25T10:00:00Z");
  const t = reminderText({ storeName: "Balkan", username: "marko2026", packageName: "1M", expiresAt: new Date("2026-10-28T09:00:00Z"), renewUrl: "https://x/renew" }, now);
  assert.match(t, /ističe 28\.10\.2026 \(za 3 dana\)/);
  assert.match(t, /\(marko2026\)/);
  assert.match(t, /Renew: https:\/\/x\/renew/);
  const e = reminderText({ storeName: "B", username: null, packageName: "1M", expiresAt: new Date("2026-10-20T09:00:00Z"), renewUrl: "u" }, now);
  assert.match(e, /je istekla 20\.10\.2026/);
  assert.ok(whatsappLink("38761234567", "a b").startsWith("https://wa.me/38761234567?text=a%20b"));
  assert.ok(viberLink("hi").startsWith("viber://forward?text=hi"));
  assert.equal(tgEscape("<b>&"), "&lt;b&gt;&amp;");
});

test("engage: Telegram client — token check, latest chat, send, clear errors", async () => {
  const sent: any[] = [];
  const srv = await startServer((req) => {
    if (!req.path.startsWith("/bot123456:")) return { status: 404, json: { ok: false } };
    if (req.path.includes("BAD")) return { status: 401, json: { ok: false, description: "Unauthorized" } };
    if (req.path.endsWith("/getMe")) return { json: { ok: true, result: { username: "my_store_bot" } } };
    if (req.path.endsWith("/getUpdates")) return { json: { ok: true, result: [{ message: { chat: { id: 111, first_name: "Old" } } }, { message: { chat: { id: 987654, first_name: "Alen", last_name: "M" } } }] } };
    if (req.path.endsWith("/sendMessage")) {
      const b = JSON.parse(req.body);
      if (b.chat_id === "404") return { status: 400, json: { ok: false, description: "Bad Request: chat not found" } };
      sent.push(b);
      return { json: { ok: true, result: {} } };
    }
    return { status: 404, json: { ok: false } };
  });
  try {
    const token = "123456:" + "A".repeat(35);
    assert.equal(TelegramClient.validToken(token), true);
    assert.equal(TelegramClient.validToken("nope"), false);
    const t = new TelegramClient(token, undefined, srv.url);
    assert.equal((await t.me()).username, "my_store_bot");
    assert.deepEqual(await t.latestChat(), { id: "987654", name: "Alen M" });
    await t.send("987654", "<b>New sale</b>");
    assert.equal(sent[0].parse_mode, "HTML");
    await assert.rejects(t.send("404", "x"), (e: Error) => e instanceof TelegramError && /press Start/.test(e.message));
    await assert.rejects(new TelegramClient("123456:BAD" + "A".repeat(32), undefined, srv.url).me(), /rejected the bot token/);
  } finally {
    await srv.close();
  }
});
