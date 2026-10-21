/**
 * Default email templates. Resellers can override customer-facing templates per store;
 * the super admin can override platform templates (resellerId = null).
 * Bodies are plain text with {{variables}}; values are HTML-escaped when rendered.
 */
export interface TemplateDef {
  key: string;
  audience: "platform" | "customer";
  label: string;
  /** Short explanation shown to the reseller: when this email is sent. */
  when?: string;
  subject: string;
  body: string;
  variables: string[];
  /** The email carries the customer's login details: username and password are always included. */
  credentials?: boolean;
}

/** What each variable means (shown next to the variable buttons in the editor). */
export const VARIABLE_HELP: Record<string, string> = {
  storeName: "Your sender name (Email texts → Sender name; empty = store name)",
  packageName: "Package the customer bought",
  username: "Line username",
  password: "Line password",
  serverUrl: "Server address for apps (DNS)",
  connections: "Number of connections",
  expiresAt: "Expiry date",
  maxPlayerNote: "MaxPlayer note in English (empty when not used)",
  maxPlayerNoteBhs: "MaxPlayer note in BHS (empty when not used)",
  portalUrl: "Customer portal link",
  contact: "Your contact details",
  orderNumber: "Order number",
  amount: "Amount paid",
  daysLeft: "Days until expiry",
  renewUrl: "Renewal link",
  reason: "Why the payment failed",
  retryUrl: "Try-again link",
  loginUrl: "Portal sign-in link",
};

/** Line between the BHS text and the English version (shown as a divider in the HTML email). */
export const EN_DIVIDER = "——— English version ———";

/** BHS text first, the English version below. */
function bi(bhs: string, en: string): string {
  return `${bhs}\n\n${EN_DIVIDER}\n\n${en}`;
}

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    key: "reseller_welcome",
    audience: "platform",
    label: "Reseller: request received (waiting for approval)",
    subject: "Vaš zahtjev čeka odobrenje / Your reseller request is waiting for approval — {{platformName}}",
    body: bi(
      "Zdravo {{name}},\n\nHvala na zahtjevu da postanete reseller na {{platformName}}.\n\nVaš račun sada čeka odobrenje. Pregledamo svaki zahtjev i dobit ćete novi email čim vaš račun bude odobren.\n\nU međuvremenu potvrdite svoju email adresu:\n{{verifyUrl}}\n\n— {{platformName}}",
      "Hi {{name}},\n\nThank you for your request to become a reseller on {{platformName}}.\n\nYour account is now waiting for approval. We review every request and you will get another email as soon as your account is approved.\n\nIn the meantime, please confirm your email address:\n{{verifyUrl}}\n\n— {{platformName}}",
    ),
    variables: ["name", "platformName", "verifyUrl"],
  },
  {
    key: "verify_email",
    audience: "platform",
    label: "Reseller: confirm email",
    subject: "Potvrdite email adresu / Confirm your email address",
    body: bi(
      "Zdravo {{name}},\n\nPotvrdite svoju email adresu otvaranjem ovog linka (važi 24 sata):\n{{verifyUrl}}\n\n— {{platformName}}",
      "Hi {{name}},\n\nConfirm your email address by opening this link (valid for 24 hours):\n{{verifyUrl}}\n\n— {{platformName}}",
    ),
    variables: ["name", "platformName", "verifyUrl"],
  },
  {
    key: "password_reset",
    audience: "platform",
    label: "Reseller: password reset",
    subject: "Nova lozinka / Reset your password",
    body: bi(
      "Zdravo {{name}},\n\nNeko je zatražio novu lozinku za vaš račun. Otvorite ovaj link u roku od 1 sata i izaberite novu lozinku:\n{{resetUrl}}\n\nAko to niste bili vi, zanemarite ovaj email.\n\n— {{platformName}}",
      "Hi {{name}},\n\nSomeone requested a password reset for your account. Open this link within 1 hour to choose a new password:\n{{resetUrl}}\n\nIf this wasn't you, ignore this email.\n\n— {{platformName}}",
    ),
    variables: ["name", "platformName", "resetUrl"],
  },
  {
    key: "reseller_approved",
    audience: "platform",
    label: "Reseller: account approved",
    subject: "Vaš račun je odobren / Your reseller account is approved — {{platformName}}",
    body: bi(
      "Zdravo {{name}},\n\nDobre vijesti: vaš zahtjev za {{storeName}} je odobren i vaš račun je sada aktivan.\n\nPrijavite se ovdje:\n{{loginUrl}}\n\nSljedeći koraci: povežite svoj XUI One panel, sinhronizujte bukete, napravite pakete i povežite plaćanje.\n\n— {{platformName}}",
      "Hi {{name}},\n\nGood news: your reseller request for {{storeName}} has been approved and your account is now active.\n\nSign in here:\n{{loginUrl}}\n\nNext steps: connect your XUI One panel, sync bouquets, create packages and connect a payment gateway.\n\n— {{platformName}}",
    ),
    variables: ["name", "storeName", "platformName", "loginUrl"],
  },
  {
    key: "reseller_rejected",
    audience: "platform",
    label: "Reseller: application declined",
    subject: "Vaš zahtjev za reseller račun / Your reseller application — {{platformName}}",
    body: bi(
      "Zdravo {{name}},\n\nHvala na interesovanju za {{platformName}}. Nažalost, trenutno ne možemo odobriti vaš reseller račun.\n\n{{reason}}\n\nAko mislite da je došlo do greške, odgovorite na ovaj email.\n\n— {{platformName}}",
      "Hi {{name}},\n\nThank you for your interest in {{platformName}}. Unfortunately we cannot approve your reseller account at this time.\n\n{{reason}}\n\nIf you think this is a mistake, reply to this email.\n\n— {{platformName}}",
    ),
    variables: ["name", "platformName", "reason"],
  },
  {
    key: "reseller_announcement",
    audience: "platform",
    label: "Reseller: notification from the platform",
    subject: "{{title}} — {{platformName}}",
    body: "Zdravo / Hi {{name}},\n\n{{message}}\n\nOvu poruku vidite i na svom dashboardu / You can also see this message in your dashboard:\n{{dashboardUrl}}\n\n— {{platformName}}",
    variables: ["name", "title", "message", "dashboardUrl", "platformName"],
  },
  {
    key: "admin_new_reseller",
    audience: "platform",
    label: "Admin: new reseller waiting for approval",
    subject: "Novi reseller čeka odobrenje / New reseller waiting for approval: {{storeName}}",
    body: bi(
      "Novi reseller se registrovao i čeka vaše odobrenje.\n\nIme: {{name}}\nEmail: {{email}}\nProdavnica: {{storeName}}\n\nOdobrite ili odbijte ovdje:\n{{reviewUrl}}\n\n— {{platformName}}",
      "A new reseller registered and is waiting for your approval.\n\nName: {{name}}\nEmail: {{email}}\nStore: {{storeName}}\n\nApprove or decline here:\n{{reviewUrl}}\n\n— {{platformName}}",
    ),
    variables: ["name", "email", "storeName", "reviewUrl", "platformName"],
  },
  {
    key: "purchase_received",
    audience: "customer",
    label: "Payment received",
    when: "Right after the customer pays, before the line is ready.",
    subject: "Uplata primljena / Payment received — {{orderNumber}}",
    body: bi(
      "Zdravo,\n\nHvala na kupovini u {{storeName}}.\n\nNarudžba: {{orderNumber}}\nPaket: {{packageName}}\nIznos: {{amount}}\n\nVašu pretplatu upravo aktiviramo. Za koji trenutak dobit ćete poseban email s pristupnim podacima.\n\nVaš korisnički portal: {{portalUrl}}\n\n— {{storeName}}",
      "Hello,\n\nThank you for your purchase from {{storeName}}.\n\nOrder: {{orderNumber}}\nPackage: {{packageName}}\nAmount: {{amount}}\n\nWe are activating your subscription now. You will receive your login details in a separate email in a moment.\n\nYour customer portal: {{portalUrl}}\n\n— {{storeName}}",
    ),
    variables: ["storeName", "orderNumber", "packageName", "amount", "portalUrl"],
  },
  {
    key: "subscription_activated",
    audience: "customer",
    label: "Login details (after purchase)",
    when: "When the line is created after a purchase, an activation code or when you add a customer. Username and password are always included.",
    subject: "Vaši pristupni podaci / Your login details — {{packageName}}",
    body: bi(
      "Zdravo,\n\nHvala na kupovini! Vaša pretplata {{packageName}} je aktivna.\n\nVAŠI PRISTUPNI PODACI\nUsername: {{username}}\nLozinka: {{password}}\nServer: {{serverUrl}}\n\nVaži do: {{expiresAt}}\nBroj konekcija: {{connections}}\n{{maxPlayerNoteBhs}}\n\nČuvajte ove podatke i ne dijelite ih s drugima.\n\nSvoje podatke uvijek možete vidjeti u korisničkom portalu:\n{{portalUrl}}\n\nTrebate pomoć? Kontaktirajte nas: {{contact}}\n\nUgodno gledanje!\n{{storeName}}",
      "Hello,\n\nThank you for your purchase! Your {{packageName}} subscription is active.\n\nYOUR LOGIN DETAILS\nUsername: {{username}}\nPassword: {{password}}\nServer: {{serverUrl}}\n\nValid until: {{expiresAt}}\nConnections: {{connections}}\n{{maxPlayerNote}}\n\nPlease keep these details private and do not share them.\n\nYou can see your details any time in your customer portal:\n{{portalUrl}}\n\nNeed help? Contact us: {{contact}}\n\nEnjoy watching!\n{{storeName}}",
    ),
    variables: ["storeName", "packageName", "username", "password", "serverUrl", "expiresAt", "connections", "maxPlayerNoteBhs", "maxPlayerNote", "portalUrl", "contact"],
    credentials: true,
  },
  {
    key: "subscription_renewed",
    audience: "customer",
    label: "Subscription extended",
    when: "When a subscription is renewed or extended. The login details stay the same.",
    subject: "Pretplata produžena / Subscription extended",
    body: bi(
      "Zdravo,\n\nVaša pretplata {{packageName}} je produžena.\n\nNovi datum isteka: {{expiresAt}}\n\nPristupni podaci ostaju isti.\n\nKorisnički portal: {{portalUrl}}\n\n— {{storeName}}",
      "Hello,\n\nYour {{packageName}} subscription has been extended.\n\nNew expiry date: {{expiresAt}}\n\nYour login details stay the same.\n\nCustomer portal: {{portalUrl}}\n\n— {{storeName}}",
    ),
    variables: ["storeName", "packageName", "expiresAt", "portalUrl"],
  },
  {
    key: "subscription_expiring",
    audience: "customer",
    label: "Expiry reminder",
    when: "3 days before a subscription expires (not for automatic renewals).",
    subject: "Pretplata ističe za {{daysLeft}} dana / Your subscription expires in {{daysLeft}} days",
    body: bi(
      "Zdravo,\n\nVaša pretplata {{packageName}} ističe {{expiresAt}}.\n\nProdužite je sada da ne bude prekida:\n{{renewUrl}}\n\n— {{storeName}}",
      "Hello,\n\nYour {{packageName}} subscription expires on {{expiresAt}}.\n\nRenew now to avoid interruption:\n{{renewUrl}}\n\n— {{storeName}}",
    ),
    variables: ["storeName", "packageName", "expiresAt", "daysLeft", "renewUrl"],
  },
  {
    key: "payment_failed",
    audience: "customer",
    label: "Payment failed",
    when: "When a payment or an automatic renewal fails.",
    subject: "Plaćanje nije uspjelo / Payment was not completed",
    body: bi(
      "Zdravo,\n\nPlaćanje za {{packageName}} nije uspjelo ({{reason}}).\n\nPokušajte ponovo ovdje: {{retryUrl}}\n\n— {{storeName}}",
      "Hello,\n\nWe could not complete the payment for {{packageName}} ({{reason}}).\n\nYou can try again here: {{retryUrl}}\n\n— {{storeName}}",
    ),
    variables: ["storeName", "packageName", "reason", "retryUrl"],
  },
  {
    key: "customer_login",
    audience: "customer",
    label: "Portal login link",
    when: "When a customer asks for a sign-in link to the customer portal.",
    subject: "Link za prijavu / Your login link — {{storeName}}",
    body: bi(
      "Zdravo,\n\nOvim linkom se prijavljujete u svoj korisnički portal (važi 30 minuta):\n{{loginUrl}}\n\nAko niste tražili ovaj link, zanemarite ovaj email.\n\n— {{storeName}}",
      "Hello,\n\nUse this link to sign in to your customer portal (valid for 30 minutes):\n{{loginUrl}}\n\nIf you didn't request it, ignore this email.\n\n— {{storeName}}",
    ),
    variables: ["storeName", "loginUrl"],
  },
];

export function getDefaultTemplate(key: string): TemplateDef {
  const t = DEFAULT_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown email template ${key}`);
  return t;
}

export function findTemplate(key: string): TemplateDef | undefined {
  return DEFAULT_TEMPLATES.find((x) => x.key === key);
}

function usesVar(text: string, name: string): boolean {
  return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(text);
}

/**
 * Login details must always reach the customer: if the reseller removed {{username}} or {{password}}
 * from a credentials email, the missing lines are added at the end.
 */
export function withRequiredCredentials(def: TemplateDef | undefined, body: string, vars: Record<string, string | null | undefined>): string {
  if (!def?.credentials) return body;
  const missing: string[] = [];
  if (vars.username && !usesVar(body, "username")) missing.push("Username: {{username}}");
  if (vars.password && !usesVar(body, "password")) missing.push("Lozinka / Password: {{password}}");
  return missing.length ? `${body.trimEnd()}\n\nVaši pristupni podaci / Your login details:\n${missing.join("\n")}` : body;
}

/** Lines that only contained an empty variable (e.g. "{{maxPlayerNote}}" when unused) are removed. */
export function dropEmptyVariableLines(body: string, vars: Record<string, string | null | undefined>): string {
  return body
    .split("\n")
    .filter((line) => {
      const m = /^\s*\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\s*$/.exec(line);
      return !m || !!(vars[m[1]] ?? "").toString().trim();
    })
    .join("\n");
}
