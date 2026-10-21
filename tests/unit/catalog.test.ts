import { test } from "node:test";
import assert from "node:assert/strict";
import { displayBouquetName, isPlaceholderBouquetName, isResellerApiUrl, packageSellable, panelHost, pickCatalogHost } from "../../src/core/catalog";
import { defaultGuide, guideDevices, guideEmailBlocks, guideLinks, normalizeGuide } from "../../src/core/appGuide";

test("catalog: reseller and admin API URLs of one panel map to the same host", () => {
  assert.equal(panelHost("http://televizija.tel/resellerapi"), "televizija.tel");
  assert.equal(panelHost("http://www.Televizija.tel/adminapi/"), "televizija.tel");
  assert.equal(panelHost("http://1.2.3.4:8080/adminapi"), "1.2.3.4:8080");
  assert.notEqual(panelHost("http://1.2.3.4:8080/x"), panelHost("http://1.2.3.4:9090/x"));
});

test("catalog: only generated names count as placeholders", () => {
  assert.equal(isPlaceholderBouquetName("Bouquet #12"), true);
  assert.equal(isPlaceholderBouquetName("BIH - BOSNA I HERCEGOVINA"), false);
  assert.equal(isPlaceholderBouquetName("Bouquet #12 sport"), false);
});

test("app guide email: credentials, devices, Hisense not supported, icon; HTML is escaped", () => {
  const g = defaultGuide();
  g.platforms.android.url = "https://play.example/app";
  g.platforms.lg.url = "javascript:alert(1)";
  g.extraNote = "<b>hi</b>";
  assert.deepEqual(guideLinks(g).map((l) => l.url), ["https://play.example/app"], "only http(s) links become buttons");
  const devices = guideDevices(g).map((d) => d.key);
  assert.deepEqual(devices, ["android", "ios", "androidtv", "firetv", "samsung", "lg", "appletv"], "all TVs and phones by default, PC off");
  assert.equal(guideDevices(g).find((d) => d.key === "lg")!.note, "LG Content Store on your TV: search for “MaxPlayer”.");
  const b = guideEmailBlocks(g, { username: "user<1>", password: "p&ss" }, "http://1.2.3.4/api/public/app-icon?v=1");
  assert.match(b.text, /Username: user<1>/);
  assert.match(b.text, /Password: p&ss/);
  assert.match(b.text, /Samsung Smart TV \(Tizen\)/);
  assert.match(b.text, /LG Smart TV \(webOS\)/);
  assert.match(b.text, /Not supported: Nije dostupno na Hisense televizorima \(VIDAA\)\. \/ Not available on Hisense TVs \(VIDAA\)/);
  // bilingual: BHS step first, English right below it
  assert.ok(b.text.indexOf("Instalirajte aplikaciju MaxPlayer") < b.text.indexOf("Install the MaxPlayer app"));
  assert.match(b.text, /LG Content Store na televizoru: potražite „MaxPlayer”\. — LG Content Store on your TV/);
  assert.match(b.text, /Android telefon i tablet \/ Android phone & tablet/);
  assert.match(b.html, /Preuzmi \/ Download/);
  assert.match(b.html, /Gledajte uz MaxPlayer/);
  assert.match(b.html, /user&lt;1&gt;/);
  assert.match(b.html, /p&amp;ss/);
  assert.match(b.html, /<img src="http:\/\/1\.2\.3\.4\/api\/public\/app-icon\?v=1"/);
  assert.match(b.html, /Hisense/);
  assert.ok(!b.html.includes("<b>hi</b>"));
  assert.ok(!b.html.includes("javascript:"));
  assert.ok(!guideEmailBlocks(g, { username: "u", password: "p" }, null).html.includes("<img"));
  g.platforms.samsung.enabled = false;
  assert.ok(!guideEmailBlocks(g, { username: "u", password: "p" }, null).text.includes("Samsung"));
});

test("app guide: settings saved by the first version are migrated", () => {
  const g = normalizeGuide({ enabled: true, appName: "MaxPlayer", androidUrl: "https://play.example/a", iosUrl: "https://apps.example/i", extraNote: "" } as any);
  assert.equal(g.platforms.android.url, "https://play.example/a");
  assert.equal(g.platforms.ios.url, "https://apps.example/i");
  assert.equal(g.platforms.samsung.enabled, true);
  assert.equal(g.unsupportedNote, "Not available on Hisense TVs (VIDAA).");
  assert.equal(normalizeGuide({ ...defaultGuide(), unsupportedNote: "" }).unsupportedNote, "", "admin can clear it");
});

import { displayCustomer, isPlaceholderEmail, placeholderEmail } from "../../src/core/importedCustomers";
import { makeRenewToken, verifyRenewToken } from "../../src/core/renewToken";

test("imported customers: placeholder email is never a real address", () => {
  const e = placeholderEmail("Marko 123!");
  assert.equal(e, "marko_123_@imported.invalid");
  assert.equal(isPlaceholderEmail(e), true);
  assert.equal(isPlaceholderEmail("marko@gmail.com"), false);
  assert.equal(displayCustomer(e, "Marko 123!"), "Marko 123! (no email)");
  assert.equal(displayCustomer("a@b.co"), "a@b.co");
});

test("renew link token: bound to the subscription, expires, cannot be forged", () => {
  const KEY = Buffer.alloc(32, 7).toString("base64");
  const now = Date.parse("2026-10-12T10:00:00Z");
  const t = makeRenewToken("sub1", now, KEY);
  assert.equal(verifyRenewToken("sub1", t, now + 60_000, KEY), true);
  assert.equal(verifyRenewToken("sub2", t, now + 60_000, KEY), false, "other subscription");
  assert.equal(verifyRenewToken("sub1", t, now + 3 * 3600_000, KEY), false, "expired");
  assert.equal(verifyRenewToken("sub1", t.replace(/.$/, (c) => (c === "a" ? "b" : "a")), now, KEY), false, "tampered");
  assert.equal(verifyRenewToken("sub1", `${now + 9e9}.abc`, now, KEY), false);
  assert.equal(verifyRenewToken("sub1", "", now, KEY), false);
});

import { checkExistingLine } from "../../src/core/existingLine";

test("load existing line: id + username + password must match and the line must be the reseller's", () => {
  const line = { id: "73736", username: "billingtest3", password: "Xy7TestPw01", expiresAt: new Date(), enabled: true, maxConnections: 1, memberId: "491" };
  assert.equal(checkExistingLine(line, { username: "billingtest3", password: "Xy7TestPw01" }, "491"), null);
  assert.match(checkExistingLine(null, { username: "x", password: "y" }, "491")!, /No line/);
  assert.match(checkExistingLine(line, { username: "other", password: "Xy7TestPw01" }, "491")!, /username does not match/);
  assert.match(checkExistingLine(line, { username: "billingtest3", password: "wrong" }, "491")!, /password does not match/);
  assert.match(checkExistingLine(line, { username: "billingtest3", password: "Xy7TestPw01" }, "500")!, /another reseller/);
  assert.equal(checkExistingLine({ ...line, password: undefined }, { username: "billingtest3", password: "anything" }, null), null, "panel that hides passwords: username + owner decide");
});

import { alternativeUsername, customerUsernameError, isUsernameTakenError, maskUsername } from "../../src/core/usernames";

test("customer-chosen username: min 8, letters + numbers combined, nothing else", () => {
  assert.equal(customerUsernameError("marko2026"), null);
  assert.equal(customerUsernameError("A1b2c3d4"), null);
  assert.match(customerUsernameError("marko26")!, /at least 8/);
  assert.match(customerUsernameError("markomarko")!, /combine letters and numbers/);
  assert.match(customerUsernameError("12345678")!, /combine letters and numbers/);
  assert.match(customerUsernameError("marko 2026")!, /only letters and numbers/);
  assert.match(customerUsernameError("marko_2026")!, /only letters and numbers/);
  assert.match(customerUsernameError("a1".repeat(16))!, /at most 30/);
  assert.match(customerUsernameError("")!, /Choose/);
});

test("masked usernames and taken-username helpers", () => {
  assert.equal(maskUsername("billingtest3"), "bil•••st3");
  assert.equal(maskUsername("marko2026"), "mar•••026");
  assert.equal(maskUsername("abc"), "a•••");
  const alt = alternativeUsername("marko2026");
  assert.match(alt, /^marko2026\d{2}$/);
  assert.equal(customerUsernameError(alt), null);
  assert.equal(isUsernameTakenError("STATUS_EXISTS_USERNAME"), true);
  assert.equal(isUsernameTakenError("Username exists"), true);
  assert.equal(isUsernameTakenError("STATUS_INVALID_PACKAGE"), false);
});

import { generateCode, normalizeCode } from "../../src/core/codes";

test("activation codes: format, no look-alike characters, forgiving input", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = generateCode();
    assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(!/[01OIL8]/.test(c), "no 0/O, 1/I/L, 8/B confusion");
    seen.add(c);
  }
  assert.equal(seen.size, 2000, "no duplicates");
  const c = generateCode();
  assert.equal(normalizeCode(c.toLowerCase().replace(/-/g, " ")), c);
  assert.equal(normalizeCode(` ${c.replace(/-/g, "")} `), c);
  assert.equal(normalizeCode("ABCD-EFGH-123"), null, "too short");
  assert.equal(normalizeCode("ABCD-EFGH-0000"), null, "invalid characters");
});

import { maskSecrets, smtpSettingsError } from "../../src/core/mailRules";

test("reseller SMTP settings: only real mail servers and mail ports", () => {
  const ok = { host: "smtp.gmail.com", port: 587, username: "a@gmail.com", fromEmail: "a@gmail.com" };
  assert.equal(smtpSettingsError(ok), null);
  assert.match(smtpSettingsError({ ...ok, port: 22 })!, /Port must be one of/);
  assert.match(smtpSettingsError({ ...ok, port: 6379 })!, /Port must be one of/);
  assert.match(smtpSettingsError({ ...ok, host: "localhost" })!, /SMTP server name/);
  assert.match(smtpSettingsError({ ...ok, host: "http://x.com" })!, /SMTP server name/);
  assert.match(smtpSettingsError({ ...ok, fromEmail: "nope" })!, /sender email/);
  assert.equal(smtpSettingsError({ ...ok, port: 465 }), null);
});

test("sent-email log never stores the line password", () => {
  const text = "Username: marko2026\nPassword: Xk92hdA1\n...\n   Password: Xk92hdA1";
  const masked = maskSecrets(text, ["Xk92hdA1"]);
  assert.ok(!masked.includes("Xk92hdA1"));
  assert.match(masked, /Username: marko2026/);
  assert.equal(maskSecrets("abc", [null, undefined, ""]), "abc");
});

import { appCustomerEmail, deviceLimit, streamServer, validDeviceId } from "../../src/core/appApi";

test("app API helpers: server address, device limit, device ids, app customer email", () => {
  assert.equal(streamServer({ streamUrl: "http://line.example.com:80/", apiUrl: "http://televizija.tel/resellerapi" }), "http://line.example.com:80");
  assert.equal(streamServer({ streamUrl: null, apiUrl: "http://televizija.tel/resellerapi" }), "http://televizija.tel");
  assert.equal(streamServer({ streamUrl: "", apiUrl: "https://p.example.com:8443/adminapi" }), "https://p.example.com:8443");
  assert.equal(deviceLimit(2), 2);
  assert.equal(deviceLimit(0), 1);
  assert.equal(deviceLimit(null), 1);
  assert.equal(validDeviceId("android-3f9c2a7d41b0"), true);
  assert.equal(validDeviceId("AA:BB:CC:DD:EE:FF"), true);
  assert.equal(validDeviceId("abc"), false);
  assert.equal(validDeviceId("x".repeat(129)), false);
  assert.equal(validDeviceId("bad id with spaces"), false);
  assert.equal(validDeviceId(123), false);
  assert.equal(appCustomerEmail("A7K2-9QXM-4TPL"), "app-a7k29qxm4tpl@imported.invalid");
  assert.equal(isPlaceholderEmail(appCustomerEmail("A7K2-9QXM-4TPL")), true, "no emails are sent to app-only customers");
});

import { normalizePublicUrl } from "../../src/core/publicUrl";

test("platform domain set in the admin panel: clean origin only", () => {
  assert.deepEqual(normalizePublicUrl("https://Billing.Example.com/"), { url: "https://billing.example.com" });
  assert.deepEqual(normalizePublicUrl("billing.example.com"), { url: "https://billing.example.com" }, "https added when missing");
  assert.deepEqual(normalizePublicUrl("http://billing.example.com:8080"), { url: "http://billing.example.com:8080" });
  assert.deepEqual(normalizePublicUrl(""), { url: null }, "empty = back to the server address");
  assert.ok(normalizePublicUrl("https://billing.example.com/store/main").error);
  assert.ok(normalizePublicUrl("ftp://billing.example.com").error);
  assert.ok(normalizePublicUrl("https://localhost").error);
});

import { inkFor } from "../../src/core/color";

test("readable text on brand colours", () => {
  assert.equal(inkFor("#ffd400"), "#000000", "black on yellow");
  assert.equal(inkFor("#000000"), "#ffffff");
  assert.equal(inkFor("#3b63f6"), "#ffffff");
  assert.equal(inkFor("#fff"), "#000000");
  assert.equal(inkFor("nonsense"), "#ffffff");
});

import { pickLang, t, translateError, deviceNote, unsupportedNote } from "../../src/core/i18n/codeFlow";

test("code pages: BHS default, EN and DE, translated errors", () => {
  assert.equal(pickLang(undefined, null), "bhs");
  assert.equal(pickLang("DE"), "de");
  assert.equal(pickLang("xx", "en"), "en");
  assert.equal(t("bhs", "newLine"), "Nova linija");
  assert.equal(t("de", "extend"), "Zugang verlängern");
  assert.equal(t("bhs", "step2", { app: "MaxPlayer" }), "Otvorite MaxPlayer i prijavite se svojim usernameom i lozinkom.");
  assert.equal(translateError("bhs", "This code was already used."), "Ovaj kod je već iskorišten.");
  assert.equal(translateError("de", 'The username "marko2026" is already taken. Please choose another one.'), "Der Benutzername „marko2026“ ist vergeben. Bitte wählen Sie einen anderen.");
  assert.equal(translateError("bhs", "You have 2 lines (mar•••026, tes•••abc). Enter the username of the line you want to extend."), "Imate 2 linije (mar•••026, tes•••abc). Upišite username linije koju želite produžiti.");
  assert.equal(translateError("en", "This code was already used."), "This code was already used.");
  assert.equal(translateError("bhs", "Something unknown"), "Something unknown", "unknown text stays");
  assert.equal(deviceNote("bhs", "lg", "LG Content Store on your TV: search for “{app}”.", "LG Content Store on your TV: search for “{app}”.", "MaxPlayer"), "LG Content Store na televizoru: potražite „MaxPlayer”.");
  assert.equal(deviceNote("bhs", "lg", "Custom text", "LG Content Store on your TV: search for “{app}”.", "MaxPlayer"), "Custom text", "admin text is kept");
  assert.equal(unsupportedNote("de", "Not available on Hisense TVs (VIDAA)."), "Nicht verfügbar auf Hisense-Fernsehern (VIDAA).");
});

test("catalog: reseller panel finds the admin catalog even under another port or domain", () => {
  assert.equal(pickCatalogHost("http://panel.tv/resellerapi", ["panel.tv"]), "panel.tv");
  assert.equal(pickCatalogHost("http://panel.tv:8080/resellerapi", ["panel.tv", "other.tv"]), "panel.tv");
  // one synced panel on the platform: used for every reseller panel
  assert.equal(pickCatalogHost("http://1.2.3.4/resellerapi", ["panel.tv"]), "panel.tv");
  // several panels and no match: no guessing
  assert.equal(pickCatalogHost("http://1.2.3.4/resellerapi", ["panel.tv", "other.tv"]), null);
  assert.equal(pickCatalogHost("http://1.2.3.4/resellerapi", []), null);
});

test("catalog: placeholders get catalog names, own names stay, unknown placeholders are hidden", () => {
  const cat = new Map([["12", "BIH - BOSNA I HERCEGOVINA"]]);
  assert.equal(displayBouquetName("Bouquet #12", "12", cat), "BIH - BOSNA I HERCEGOVINA");
  assert.equal(displayBouquetName("Moj sport", "12", cat), "Moj sport");
  assert.equal(displayBouquetName("Bouquet #99", "99", cat), null);
});

import { filterQuery, lineWhere, parseLineFilters } from "../../src/core/adminLines";

test("admin lines overview: filters are parsed safely and round-trip", () => {
  const f = parseLineFilters({ q: "  marko ", reseller: "cm1234567890abcdefghijklm", status: "EXPIRING", mp: "SIMULATED", test: "only" });
  assert.equal(f.q, "marko");
  assert.equal(f.status, "EXPIRING");
  assert.equal(f.test, "only");
  assert.equal(filterQuery(f), "?q=marko&reseller=cm1234567890abcdefghijklm&status=EXPIRING&mp=SIMULATED&test=only");
  const bad = parseLineFilters({ reseller: "x'; drop", status: "HACKED", mp: "nope" });
  assert.deepEqual([bad.reseller, bad.status, bad.mp, bad.test], ["", "", "", "hide"], "unknown values are ignored, test lines hidden by default");
  const now = new Date("2026-10-14T00:00:00Z");
  const w = lineWhere(f, now) as any;
  assert.ok(w.AND.some((c: any) => c.status === "ACTIVE" && c.expiresAt?.lt?.getTime() === now.getTime() + 7 * 86_400_000));
  assert.ok(w.AND.some((c: any) => c.maxPlayerUserId?.startsWith === "TEST-"));
  assert.ok(w.AND.some((c: any) => c.isTest === true));
  assert.deepEqual(lineWhere(parseLineFilters({ test: "show" })), {}, "no filters → everything");
});

test("store: a reseller-API package is only sold when linked to a panel package", () => {
  assert.equal(isResellerApiUrl("http://panel.tv/resellerapi"), true);
  assert.equal(isResellerApiUrl("http://panel.tv/adminapi"), false);
  assert.equal(packageSellable({ externalPackageId: null, panel: { apiUrl: "http://panel.tv/resellerapi" } }), false);
  assert.equal(packageSellable({ externalPackageId: "2", panel: { apiUrl: "http://panel.tv/resellerapi" } }), true);
  assert.equal(packageSellable({ externalPackageId: null, panel: { apiUrl: "http://panel.tv/adminapi" } }), true);
});
