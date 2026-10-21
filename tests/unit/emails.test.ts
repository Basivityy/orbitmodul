import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TEMPLATES, dropEmptyVariableLines, getDefaultTemplate, withRequiredCredentials } from "../../src/core/emailTemplates";
import { emailFooter, emailSenderName, renderEmail } from "../../src/core/emailLayout";
import { formatEmailDate } from "../../src/core/dates";

const VARS = {
  storeName: "Best TV",
  packageName: "1 Month",
  username: "demo4821",
  password: "Kp7xQ2mZ",
  serverUrl: "http://line.example.com:80",
  connections: "2",
  expiresAt: "13.11.2026",
  maxPlayerNote: "",
  maxPlayerNoteBhs: "",
  portalUrl: "https://orbit-modul.info/store/best/portal",
  contact: "help@best.tv",
};
const activated = getDefaultTemplate("subscription_activated");

test("recommended login-details email contains everything the customer needs", () => {
  const r = renderEmail({ key: activated.key, subject: activated.subject, body: activated.body, vars: VARS, title: "Best TV", brandColor: "#ffd400", footer: "Best TV" });
  assert.equal(r.subject, "Vaši pristupni podaci / Your login details — 1 Month");
  for (const v of ["demo4821", "Kp7xQ2mZ", "http://line.example.com:80", "13.11.2026", "Broj konekcija: 2", "Connections: 2", VARS.portalUrl, "help@best.tv"]) assert.ok(r.text.includes(v), v);
  // BHS first, English below, with a divider in the HTML
  assert.ok(r.text.indexOf("VAŠI PRISTUPNI PODACI") < r.text.indexOf("English version"));
  assert.ok(r.text.indexOf("English version") < r.text.indexOf("YOUR LOGIN DETAILS"));
  assert.ok(r.html.includes("border-top:1px solid #e5e7eb") && !r.html.includes("——— English version ———"));
  assert.ok(r.html.includes("demo4821") && r.html.includes("Kp7xQ2mZ"));
  // the empty MaxPlayer note leaves no blank placeholder line behind
  assert.ok(!r.text.includes("{{"));
  assert.ok(!/Connections: 2\n\n\n/.test(r.text));
});

test("username and password are always sent, even if the reseller removed them", () => {
  const body = "Hello,\n\nThanks for buying {{packageName}}!";
  const out = withRequiredCredentials(activated, body, VARS);
  assert.match(out, /Username: \{\{username\}\}/);
  assert.match(out, /Lozinka \/ Password: \{\{password\}\}/);
  const onlyPass = withRequiredCredentials(activated, "User: {{ username }}", VARS);
  assert.ok(!onlyPass.includes("Username: {{username}}"));
  assert.match(onlyPass, /Lozinka \/ Password: \{\{password\}\}/);
  const r = renderEmail({ key: activated.key, subject: "Hi", body, vars: VARS, title: "T", brandColor: "#000000", footer: "F" });
  assert.ok(r.text.includes("Username: demo4821") && r.text.includes("Lozinka / Password: Kp7xQ2mZ"));
});

test("credentials are not added to emails that do not carry them", () => {
  const renewed = getDefaultTemplate("subscription_renewed");
  assert.equal(withRequiredCredentials(renewed, renewed.body, VARS), renewed.body);
  assert.equal(withRequiredCredentials(undefined, "x", VARS), "x");
  // nothing to add when there are no credentials (e.g. renewal without a password)
  assert.equal(withRequiredCredentials(activated, "x", { username: "", password: "" }), "x");
});

test("lines that only hold an empty variable are dropped", () => {
  assert.equal(dropEmptyVariableLines("a\n{{maxPlayerNote}}\nb", { maxPlayerNote: "" }), "a\nb");
  assert.equal(dropEmptyVariableLines("a\n{{maxPlayerNote}}\nb", { maxPlayerNote: "Use MaxPlayer" }), "a\n{{maxPlayerNote}}\nb");
  assert.equal(dropEmptyVariableLines("Note: {{maxPlayerNote}}", {}), "Note: {{maxPlayerNote}}");
});

test("reseller values are escaped in HTML, template text keeps working", () => {
  const r = renderEmail({ key: "purchase_received", subject: "{{storeName}}", body: "Store: {{storeName}}", vars: { storeName: "<b>X</b>" }, title: "<T>", brandColor: "#ffffff", footer: "F" });
  assert.ok(r.html.includes("&lt;b&gt;X&lt;/b&gt;"));
  assert.ok(r.html.includes("&lt;T&gt;"));
  assert.equal(r.subject, "<b>X</b>");
});

test("every template only uses variables it declares", () => {
  for (const t of DEFAULT_TEMPLATES) {
    const used = Array.from(`${t.subject}\n${t.body}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((m) => m[1]);
    for (const u of used) assert.ok(t.variables.includes(u) || u === "platformName" || u === "storeName", `${t.key}: ${u}`);
  }
});

test("email dates are short and locale independent", () => {
  assert.equal(formatEmailDate(new Date("2026-11-13T23:30:00Z")), "13.11.2026");
  assert.equal(formatEmailDate(new Date("2027-01-01T00:00:00Z")), "01.01.2027");
});

test("sender name replaces the store name in emails, empty falls back to it", () => {
  assert.equal(emailSenderName({ storeName: "BillingModule Test", emailFromName: "Best TV" }), "Best TV");
  assert.equal(emailSenderName({ storeName: "BillingModule Test", emailFromName: "   " }), "BillingModule Test");
  assert.equal(emailSenderName({ storeName: "BillingModule Test", emailFromName: null }), "BillingModule Test");
  assert.equal(emailFooter({ storeName: "X", emailFromName: "Best TV", contactEmail: "help@best.tv" }), "Best TV · help@best.tv");
  assert.equal(emailFooter({ storeName: "X", emailFromName: "Best TV" }), "Best TV");
});
