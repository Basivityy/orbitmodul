/**
 * Texts of the activation-code flow (activate page, order page after activation, app guide).
 * BHS (Bosnian/Croatian/Serbian) is the default, then English and German.
 */
export const LANGS = ["bhs", "en", "de"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_LABEL: Record<Lang, string> = { bhs: "BHS", en: "EN", de: "DE" };
export const DEFAULT_LANG: Lang = "bhs";

export function pickLang(...candidates: Array<string | null | undefined>): Lang {
  for (const c of candidates) {
    const v = (c ?? "").toLowerCase();
    if ((LANGS as readonly string[]).includes(v)) return v as Lang;
  }
  return DEFAULT_LANG;
}

const T = {
  bhs: {
    title: "Aktivirajte pretplatu",
    subtitle: "Hvala na uplati! Izaberite šta želite uraditi sa svojim kodom.",
    code: "Vaš kod",
    newLine: "Nova linija",
    newLineSub: "Prvi put ste ovdje? Napravite svoju liniju.",
    chooseUsername: "Izaberite korisničko ime (username)",
    usernameRule: "8–30 znakova, samo slova i brojevi, najmanje jedno slovo i jedan broj",
    usernameHint: "Zapamtite ga — s njim se prijavljujete u aplikaciju. Lozinka se pravi automatski.",
    email: "Email",
    emailHint: "Ovdje vam šaljemo pristupne podatke.",
    create: "Napravi moju liniju",
    extend: "Produži moju liniju",
    extendSub: "Već imate liniju? Vrijeme se dodaje na vašu liniju — username i lozinka ostaju isti.",
    account: "Vaš username ili email",
    accountPh: "username ili email",
    noCode: "Nemate kod?",
    buy: "Kupite pretplatu",
    language: "Jezik",
    deviceQ: "Na kojem uređaju ćete gledati?",
    deviceSub: "Izaberite uređaj — pokazat ćemo vam šta dalje.",
    device: "Uređaj",
    changeDevice: "Promijeni uređaj",
    blockedTitle: "Na ovom uređaju ne možete sami aktivirati liniju",
    blockedText: "Za Hisense televizore (VIDAA) aktivaciju radi naša podrška. Kontaktirajte nas i pošaljite svoj kod — sve ćemo podesiti za vas.",
    contactSupport: "Kontaktirajte podršku",
    noContact: "Javite se prodavcu od kojeg ste dobili kod.",
    // order page
    activating: "Aktiviramo vašu liniju…",
    activatingSub: "Obično traje nekoliko sekundi. Stranica se sama osvježava.",
    active: "Vaša pretplata je aktivna",
    extended: "Pretplata je produžena",
    manual: "Kod je primljen",
    manualSub: "Aktivaciju mora provjeriti prodavac. Dobit ćete email čim bude spremno. Broj:",
    order: "Narudžba",
    package: "Paket",
    paidWith: "Plaćeno",
    activationCode: "aktivacioni kod",
    validUntil: "Važi do",
    yourAccess: "Vaši pristupni podaci",
    username: "Username",
    password: "Lozinka",
    emailed: "Ove podatke smo vam poslali i na email. Uvijek ih možete vidjeti u",
    yourAccount: "svom nalogu",
    emailedOnly: "Pristupni podaci su vam poslani na email i nalaze se u",
    // app guide
    watchWith: "Gledajte uz",
    availableOn: "Dostupno na",
    download: "Preuzmi",
    step1: "Instalirajte aplikaciju {app} na telefon, tablet ili TV (lista ispod).",
    step2: "Otvorite {app} i prijavite se svojim usernameom i lozinkom.",
    step3: "Kanali se učitavaju automatski — uživajte!",
  },
  en: {
    title: "Activate your subscription",
    subtitle: "Thank you for your payment! Choose what you want to do with your code.",
    code: "Your code",
    newLine: "New line",
    newLineSub: "First time here? Create your line.",
    chooseUsername: "Choose your username",
    usernameRule: "8–30 characters, letters and numbers only, with at least one letter and one number",
    usernameHint: "Remember it — you sign in to the app with it. Your password is created automatically.",
    email: "Email",
    emailHint: "Your access details are sent here.",
    create: "Create my line",
    extend: "Extend my line",
    extendSub: "Already a customer? The time is added to your line — username and password stay the same.",
    account: "Your username or email",
    accountPh: "username or email",
    noCode: "No code yet?",
    buy: "Buy a subscription",
    language: "Language",
    deviceQ: "Which device will you watch on?",
    deviceSub: "Choose your device and we will show you the next step.",
    device: "Device",
    changeDevice: "Change device",
    blockedTitle: "You cannot activate the line yourself on this device",
    blockedText: "For Hisense TVs (VIDAA) the activation is done by our support. Contact us and send your code — we will set everything up for you.",
    contactSupport: "Contact support",
    noContact: "Please contact the seller who gave you the code.",
    activating: "Activating your line…",
    activatingSub: "This usually takes a few seconds. This page updates automatically.",
    active: "Your subscription is active",
    extended: "Subscription extended",
    manual: "We received your code",
    manualSub: "Your activation needs a manual check by the store. You will receive an email as soon as it is ready. Reference:",
    order: "Order",
    package: "Package",
    paidWith: "Paid with",
    activationCode: "activation code",
    validUntil: "Valid until",
    yourAccess: "Your access details",
    username: "Username",
    password: "Password",
    emailed: "We also emailed these to you. You can view them any time in",
    yourAccount: "your account",
    emailedOnly: "Your access details were emailed to you and are available in",
    watchWith: "Watch with",
    availableOn: "Available on",
    download: "Download",
    step1: "Install the {app} app on your phone, tablet or TV (see the list below).",
    step2: "Open {app} and sign in with your username and password.",
    step3: "Your channels load automatically — enjoy!",
  },
  de: {
    title: "Abonnement aktivieren",
    subtitle: "Danke für Ihre Zahlung! Wählen Sie, was Sie mit Ihrem Code tun möchten.",
    code: "Ihr Code",
    newLine: "Neuer Zugang",
    newLineSub: "Zum ersten Mal hier? Erstellen Sie Ihren Zugang.",
    chooseUsername: "Benutzernamen wählen",
    usernameRule: "8–30 Zeichen, nur Buchstaben und Zahlen, mindestens ein Buchstabe und eine Zahl",
    usernameHint: "Merken Sie ihn sich — damit melden Sie sich in der App an. Das Passwort wird automatisch erstellt.",
    email: "E-Mail",
    emailHint: "Ihre Zugangsdaten werden an diese Adresse gesendet.",
    create: "Zugang erstellen",
    extend: "Zugang verlängern",
    extendSub: "Schon Kunde? Die Zeit wird Ihrem Zugang hinzugefügt — Benutzername und Passwort bleiben gleich.",
    account: "Ihr Benutzername oder Ihre E-Mail",
    accountPh: "Benutzername oder E-Mail",
    noCode: "Noch keinen Code?",
    buy: "Abonnement kaufen",
    language: "Sprache",
    deviceQ: "Auf welchem Gerät schauen Sie?",
    deviceSub: "Wählen Sie Ihr Gerät — wir zeigen Ihnen den nächsten Schritt.",
    device: "Gerät",
    changeDevice: "Gerät ändern",
    blockedTitle: "Auf diesem Gerät können Sie den Zugang nicht selbst aktivieren",
    blockedText: "Bei Hisense-Fernsehern (VIDAA) übernimmt unser Support die Aktivierung. Kontaktieren Sie uns und senden Sie Ihren Code — wir richten alles für Sie ein.",
    contactSupport: "Support kontaktieren",
    noContact: "Bitte wenden Sie sich an den Verkäufer, von dem Sie den Code haben.",
    activating: "Ihr Zugang wird aktiviert…",
    activatingSub: "Das dauert meist nur wenige Sekunden. Die Seite aktualisiert sich automatisch.",
    active: "Ihr Abonnement ist aktiv",
    extended: "Abonnement verlängert",
    manual: "Code erhalten",
    manualSub: "Die Aktivierung wird vom Shop geprüft. Sie erhalten eine E-Mail, sobald sie bereit ist. Referenz:",
    order: "Bestellung",
    package: "Paket",
    paidWith: "Bezahlt mit",
    activationCode: "Aktivierungscode",
    validUntil: "Gültig bis",
    yourAccess: "Ihre Zugangsdaten",
    username: "Benutzername",
    password: "Passwort",
    emailed: "Wir haben sie Ihnen auch per E-Mail geschickt. Sie finden sie jederzeit in",
    yourAccount: "Ihrem Konto",
    emailedOnly: "Ihre Zugangsdaten wurden per E-Mail gesendet und sind verfügbar in",
    watchWith: "Ansehen mit",
    availableOn: "Verfügbar auf",
    download: "Herunterladen",
    step1: "Installieren Sie die App {app} auf Handy, Tablet oder TV (Liste unten).",
    step2: "Öffnen Sie {app} und melden Sie sich mit Benutzername und Passwort an.",
    step3: "Die Sender werden automatisch geladen — viel Spaß!",
  },
} as const;

export type CodeKey = keyof (typeof T)["en"];

export function t(lang: Lang, key: CodeKey, vars: Record<string, string> = {}): string {
  return (T[lang][key] as string).replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");
}

/** Device names and default store instructions of the app guide. */
const DEVICES: Record<Lang, Record<string, string>> = {
  bhs: {
    android: "Android telefon i tablet", ios: "iPhone i iPad", androidtv: "Android TV / Google TV (Sony, Philips, TCL, Xiaomi…)", firetv: "Amazon Fire TV / Fire TV Stick",
    samsung: "Samsung Smart TV (Tizen)", lg: "LG Smart TV (webOS)", appletv: "Apple TV", pc: "Windows / Mac / web preglednik", hisense: "Hisense TV (VIDAA)",
  },
  en: {},
  de: {
    android: "Android-Handy & Tablet", ios: "iPhone & iPad", androidtv: "Android TV / Google TV (Sony, Philips, TCL, Xiaomi…)", firetv: "Amazon Fire TV / Fire TV Stick",
    samsung: "Samsung Smart TV (Tizen)", lg: "LG Smart TV (webOS)", appletv: "Apple TV", pc: "Windows / Mac / Webbrowser", hisense: "Hisense-TV (VIDAA)",
  },
};
const NOTES: Record<Lang, Record<string, string>> = {
  bhs: {
    android: "Google Play: potražite „{app}”.", ios: "App Store: potražite „{app}”.", androidtv: "Google Play na televizoru: potražite „{app}”.",
    firetv: "Fire TV početna → Pretraga → „{app}”.", samsung: "Samsung Apps na televizoru: potražite „{app}”.", lg: "LG Content Store na televizoru: potražite „{app}”.",
    appletv: "App Store na Apple TV-u: potražite „{app}”.", pc: "",
  },
  en: {},
  de: {
    android: "Google Play: nach „{app}“ suchen.", ios: "App Store: nach „{app}“ suchen.", androidtv: "Google Play auf dem TV: nach „{app}“ suchen.",
    firetv: "Fire TV Startseite → Suchen → „{app}“.", samsung: "Samsung Apps auf dem TV: nach „{app}“ suchen.", lg: "LG Content Store auf dem TV: nach „{app}“ suchen.",
    appletv: "App Store auf Apple TV: nach „{app}“ suchen.", pc: "",
  },
};
const HISENSE: Record<Lang, string> = { bhs: "Nije dostupno na Hisense televizorima (VIDAA).", en: "Not available on Hisense TVs (VIDAA).", de: "Nicht verfügbar auf Hisense-Fernsehern (VIDAA)." };

/**
 * Devices offered on the activation link. `blocked`: the customer cannot activate the line
 * themselves on this device and is asked to contact support instead.
 */
export const ACTIVATION_DEVICES: Array<{ key: string; icon: string; en: string; blocked?: boolean }> = [
  { key: "android", icon: "📱", en: "Android phone & tablet" },
  { key: "ios", icon: "📱", en: "iPhone & iPad" },
  { key: "androidtv", icon: "📺", en: "Android TV / Google TV (Sony, Philips, TCL, Xiaomi…)" },
  { key: "firetv", icon: "📺", en: "Amazon Fire TV / Fire TV Stick" },
  { key: "samsung", icon: "📺", en: "Samsung Smart TV (Tizen)" },
  { key: "lg", icon: "📺", en: "LG Smart TV (webOS)" },
  { key: "hisense", icon: "📺", en: "Hisense TV (VIDAA)", blocked: true },
  { key: "appletv", icon: "📺", en: "Apple TV" },
  { key: "pc", icon: "💻", en: "Windows / Mac / web browser" },
];

export function findActivationDevice(key: string | null | undefined) {
  return ACTIVATION_DEVICES.find((d) => d.key === key) ?? null;
}

export function deviceLabel(lang: Lang, key: string, fallback: string): string {
  return DEVICES[lang][key] ?? fallback;
}

/** Translates the built-in default instruction; an instruction the admin wrote stays as written. */
export function deviceNote(lang: Lang, key: string, note: string, englishDefault: string, app: string): string {
  if (lang !== "en" && note === englishDefault && NOTES[lang][key] !== undefined) return NOTES[lang][key].replace(/\{app\}/g, app);
  return note.replace(/\{app\}/g, app);
}

export function unsupportedNote(lang: Lang, note: string): string {
  return note === HISENSE.en ? HISENSE[lang] : note;
}

/** Messages shown in the code flow, translated from the English text the server produces. */
const ERRORS: Array<{ en: RegExp; bhs: string; de: string }> = [
  { en: /^This store is not active right now/, bhs: "Prodavnica trenutno nije aktivna. Kontaktirajte prodavca.", de: "Der Shop ist derzeit nicht aktiv. Bitte kontaktieren Sie den Shop." },
  { en: /^Too many attempts/, bhs: "Previše pokušaja. Pričekajte nekoliko minuta.", de: "Zu viele Versuche. Bitte warten Sie einige Minuten." },
  { en: /^Enter the 12-character code/, bhs: "Upišite kod od 12 znakova, npr. A7K2-9QXM-4TPL.", de: "Geben Sie den 12-stelligen Code ein, z. B. A7K2-9QXM-4TPL." },
  { en: /^Enter a valid email address/, bhs: "Upišite ispravan email — tamo šaljemo pristupne podatke.", de: "Geben Sie eine gültige E-Mail-Adresse ein — dorthin senden wir die Zugangsdaten." },
  { en: /^We found no line for this email/, bhs: "Za ovaj email nismo našli liniju. Upišite username ili kontaktirajte prodavca.", de: "Zu dieser E-Mail wurde kein Zugang gefunden. Geben Sie Ihren Benutzernamen ein oder kontaktieren Sie den Shop." },
  { en: /^You have (\d+) lines \((.*)\)\./, bhs: "Imate $1 linije ($2). Upišite username linije koju želite produžiti.", de: "Sie haben $1 Zugänge ($2). Geben Sie den Benutzernamen des Zugangs ein, den Sie verlängern möchten." },
  { en: /^Enter your username \(as in the app\)/, bhs: "Upišite svoj username (kao u aplikaciji) ili email.", de: "Geben Sie Ihren Benutzernamen (wie in der App) oder Ihre E-Mail ein." },
  { en: /^We could not find this username/, bhs: "Nismo pronašli ovaj username. Ako ste liniju kupili ranije, zamolite prodavca da je doda — pa pokušajte ponovo.", de: "Dieser Benutzername wurde nicht gefunden. Wenn Sie den Zugang früher gekauft haben, bitten Sie den Shop, ihn hinzuzufügen." },
  { en: /^This code is not valid/, bhs: "Ovaj kod nije ispravan. Provjerite ga i pokušajte ponovo.", de: "Dieser Code ist ungültig. Bitte prüfen und erneut versuchen." },
  { en: /^This code was already used/, bhs: "Ovaj kod je već iskorišten.", de: "Dieser Code wurde bereits verwendet." },
  { en: /^The username "(.*)" is already taken/, bhs: "Username „$1” je zauzet. Izaberite drugi.", de: "Der Benutzername „$1“ ist vergeben. Bitte wählen Sie einen anderen." },
  { en: /^This store has reached its customer limit/, bhs: "Prodavnica je dostigla limit kupaca. Kontaktirajte prodavca.", de: "Der Shop hat sein Kundenlimit erreicht. Bitte kontaktieren Sie den Shop." },
  { en: /^Line not found/, bhs: "Linija nije pronađena.", de: "Zugang nicht gefunden." },
  { en: /^This code cannot be used for this line/, bhs: "Ovaj kod se ne može koristiti za ovu liniju. Kontaktirajte prodavca.", de: "Dieser Code kann für diesen Zugang nicht verwendet werden. Bitte kontaktieren Sie den Shop." },
  { en: /^Choose a username/, bhs: "Izaberite username.", de: "Bitte wählen Sie einen Benutzernamen." },
  { en: /^The username must have at least 8/, bhs: "Username mora imati najmanje 8 znakova.", de: "Der Benutzername muss mindestens 8 Zeichen haben." },
  { en: /^The username can have at most 30/, bhs: "Username može imati najviše 30 znakova.", de: "Der Benutzername darf höchstens 30 Zeichen haben." },
  { en: /^Use only letters and numbers/, bhs: "Koristite samo slova i brojeve (bez razmaka i znakova).", de: "Nur Buchstaben und Zahlen verwenden (keine Leerzeichen oder Sonderzeichen)." },
  { en: /^The username must combine letters and numbers/, bhs: "Username mora sadržavati i slova i brojeve (npr. marko2026).", de: "Der Benutzername muss Buchstaben und Zahlen enthalten (z. B. marko2026)." },
];

export function translateError(lang: Lang, message: string): string {
  if (lang === "en") return message;
  for (const e of ERRORS) {
    const m = e.en.exec(message);
    if (m) return e[lang].replace(/\$(\d)/g, (_x, i: string) => m[Number(i)] ?? "");
  }
  return message;
}
