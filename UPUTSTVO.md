# Uputstvo za instalaciju — PuTTY + FileZilla → Ubuntu 24.04 (pristup preko IP-a, folder /root)

Trebaš:
- VPS sa **Ubuntu 24.04** (min. 2 GB RAM, 2 vCPU), njegov **IP** i **root lozinku**
- na računaru: **PuTTY** i **FileZilla**
- fajl `xui-billing.zip`

U uputstvu je `IP_SERVERA` primjer — svugdje upiši pravi IP svog servera (npr. `185.12.34.56`).

> **PuTTY:** tekst lijepiš **desnim klikom miša** (ne Ctrl+V). Komandu zalijepiš i pritisneš **Enter**.

---

## 1. Spoji se na server (PuTTY)

1. Otvori **PuTTY**.
2. **Host Name (or IP address):** `IP_SERVERA` · **Port:** `22` · **Connection type:** SSH.
3. (Opcionalno) u **Saved Sessions** upiši `billing` → **Save**.
4. Klikni **Open** → ako iskoči upozorenje → **Accept**.
5. `login as:` → `root` → Enter → upiši lozinku (ne vidi se dok kucaš) → Enter.

## 2. Instaliraj Docker i otvori portove

Zalijepi redom, svaku liniju posebno + Enter:

```bash
apt update && apt -y upgrade
apt -y install unzip nano
curl -fsSL https://get.docker.com | sh
docker compose version
```
Zadnja komanda treba ispisati `Docker Compose version v2...`.

Firewall (SSH i web):
```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw --force enable
```

## 3. Prebaci ZIP u /root (FileZilla)

1. Otvori **FileZilla** i gore upiši:
   - **Host:** `sftp://IP_SERVERA`
   - **Username:** `root`
   - **Password:** root lozinka
   - **Port:** `22`
   → **Quickconnect** (ako pita za ključ → **OK**).
2. **Desna strana** (server): u *Remote site* upiši `/root` → Enter.
3. **Lijeva strana** (tvoj računar): nađi `xui-billing.zip`.
4. **Prevuci** `xui-billing.zip` na desnu stranu u `/root`. Sačekaj *Successful transfers: 1*.

> ZIP **ne raspakuj na Windowsu** — šalji cijeli fajl.

## 4. Raspakuj (PuTTY)

```bash
cd /root
unzip -o xui-billing.zip
cd /root/xui-billing
chmod +x docker/entrypoint.sh scripts/*.sh
ls
```
Trebaš vidjeti `docker-compose.yml`, `Dockerfile`, `README.md`…

## 5. Podesi `.env`

1. ```bash
   cp .env.example .env
   ```
2. Generiši ključ za enkripciju:
   ```bash
   openssl rand -base64 32
   ```
   Označi dobijeni red mišem (u PuTTY-ju označeno = kopirano) i **sačuvaj ga i kod sebe** (npr. Notepad / password manager).
3. ```bash
   nano .env
   ```
   Strelicama idi do reda i izmijeni:
   - `APP_URL=http://IP_SERVERA` ← pravi IP, bez `/` na kraju
   - `NGINX_MODE=http` ← ostavi ovako
   - `ENCRYPTION_KEY=` ← zalijepi ključ (desni klik)
   - `POSTGRES_PASSWORD=` ← izmisli lozinku (samo slova i brojevi)
   - u redu `DATABASE_URL=` zamijeni `change-me-strong-password` **istom** lozinkom
   - `SUPER_ADMIN_EMAIL=` tvoj email
   - `SUPER_ADMIN_PASSWORD=` min. 10 znakova, slova i brojevi
   - SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) — može i kasnije; bez toga se emailovi samo upisuju u log
4. Na dnu fajla — tvoja trgovina i početni ključevi:
   ```
   OWNER_RESELLER_EMAIL=ti@email.com
   OWNER_RESELLER_PASSWORD=NekaJakaLozinka123
   INITIAL_XUI_API_URL=https://televizija.tel/resellerapi
   INITIAL_XUI_API_KEY=tvoj_XUI_kljuc
   INITIAL_MAXPLAYER_API_KEY=tvoj_MaxPlayer_kljuc
   ```
   Ključevi se pri prvom pokretanju upisuju u bazu **enkriptovani**, u test režimu.
5. Sačuvaj i izađi: **Ctrl+O** → **Enter** → **Ctrl+X**.

> `ALLOW_LIVE_PANEL_OPERATIONS=false` **ostavi tako** dok ne završiš testiranje — sistem tada ne pravi stvarne linije.
>
> `.env` uređuj u **nano** na serveru, ne u Notepadu preko FileZille.

## 6. Pokreni

```bash
cd /root/xui-billing
docker compose up -d --build
```
Prvi put traje **5–10 minuta**. Zatim:
```bash
docker compose logs -f app worker
```
Kad vidiš `→ starting web` i `[worker] started` → **Ctrl+C** (sistem radi dalje u pozadini).

Provjera u browseru: `http://IP_SERVERA/api/health` → treba pisati `"status":"ok"`.

> Ako javi grešku:
> ```bash
> cd /root/xui-billing && docker compose logs app > greska.txt
> ```
> FileZillom preuzmi `/root/xui-billing/greska.txt` i pošalji mi ga.

## 7. Prva prijava (Super Admin)

1. Browser: `http://IP_SERVERA/login` → prijavi se sa `SUPER_ADMIN_EMAIL`.
2. Lijevo **My security** → **Set up 2FA** → skeniraj QR (Google Authenticator) → upiši kod → **Enable 2FA**.
3. **Global settings** → prekidač za globalno pauziranje billinga. Naplata resellerima
   (**Charge resellers for the platform**) je **isključena**: odobreni reseller koristi sve besplatno,
   bez planova i limita. Ako je jednom uključiš, pojavi se meni **SaaS plans**.
4. **Global settings** → **Email sending (SMTP)** → podesi slanje mailova (vidi 8c).

## 8. Testna kupovina (bez stvarnih linija)

1. **Sign out** → prijavi se sa `OWNER_RESELLER_EMAIL`.
2. **XUI One panels** → **Manage** → **Test connection** (pokaže kredite) → **Sync bouquets**.
3. **Packages & prices** → **New package** → naziv, cijena, valuta, trajanje, buketi → **Save package**.
4. **Payment gateways** → **Test gateway** → **Connect**.
5. Otvori paket → **Start test purchase** → **Simulate successful payment**.
6. Narudžba ide u *Completed*; u *Activation log* pozivi su označeni „simulated".

Tvoja prodajna stranica je na: `http://IP_SERVERA/store/main`

## 8b. Test mod za plaćanja (bez Stripe-a)

1. Super Admin → **Global settings** → uključi **Test mode for payments (all stores)** → **Save**.
2. Na svakoj prodavnici gore piše *TEST MODE*, a na checkoutu se pojavi **Test payment**.
3. Kupac: **Buy a new line** → username → email → **Test payment** → **Pay** na lažnoj stranici za plaćanje.
4. Sve poslije plaćanja radi stvarno: linija na panelu (ako panel nije u test modu i `ALLOW_LIVE_PANEL_OPERATIONS=true`),
   MaxPlayer, prikaz username/password + uputstvo za aplikaciju, email.
5. **Prije prave prodaje test mod isključi.**

## 8c. Email kupcima (SMTP)

Treba ti servis za slanje emaila. Preporuka: **Brevo** (besplatno 300 mailova/dan). Može i
Microsoft 365 (poslovni Outlook) ili Gmail. Najbolje radi s vlastitom domenom (SPF/DKIM zapisi
koje ti servis da dodaješ u DNS domene, npr. u Cloudflareu).

Super Admin → **Global settings** → **Email sending (SMTP)**:

| Servis | SMTP server | Port | Korisnik / lozinka |
|---|---|---|---|
| Brevo | `smtp-relay.brevo.com` | 587 | login i **SMTP ključ** iz Brevo → SMTP & API |
| Microsoft 365 (Outlook) | `smtp.office365.com` | 587 | cijela email adresa + lozinka (ili app password) |
| Gmail | `smtp.gmail.com` | 587 | Gmail adresa + **App password** |

Upiši **Sender email (From)** i ime → **Save email settings** → desno upiši adresu → **Send test**.
Lozinka se čuva šifrovano. (Stari način preko `SMTP_*` u `.env` i dalje radi; podešavanje u panelu ima prednost.)

**Microsoft 365:** u admin.microsoft.com → Users → Active users → klikni korisnika → **Mail** →
**Manage email apps** → uključi **Authenticated SMTP** → Save. Ako test javi grešku *5.7.139* ili
*security defaults*, Microsoft blokira prijavu lozinkom iz aplikacija — tada koristi Brevo.
Microsoft od kraja decembra 2026. ovu prijavu po defaultu gasi, pa je Brevo dugoročno sigurniji izbor.

Šta kupac dobije emailom nakon plaćanja: username, password, datum isteka i (ako paket ima MaxPlayer)
blok **Watch with MaxPlayer** s ikonicom, koracima i dugmadima za preuzimanje (podešava se u
**Customer app guide**). Tekst emaila mijenjaš u **Platform emails** (admin, za sve) ili **Email templates** (reseller).

## 8d. Reseller šalje mailove sa svoje adrese (opcionalno)

1. Reseller → lijevo **Email sending**.
2. Upiše svoj SMTP (desno su gotova podešavanja za Gmail, Brevo, Zoho, Outlook) → štikliraj
   **Send my customers' emails through this mailbox** → **Save** → **Send test email to me**.
3. Od tada svi mailovi njegovim kupcima (pristupni podaci, produženje, podsjetnik) idu s **njegove adrese**.
   Ako njegov mail zakaže, mail ide preko platforme (kupac ga ipak dobije), a greška se vidi u listi.
4. Ispod je **Sent emails**: kome, kada, koji mail, da li je poslan, s koje adrese — klik otvara sadržaj
   (password je sakriven). Tekst mailova se mijenja u **Email texts**.
5. Test mail može poslati na bilo koju adresu (polje pored **Send test email**).

## 8d2. Admin: svi kupci, linije i nalozi

- **All customers & lines** — sve linije svih resellera na jednom mjestu: username linije, kupac,
  **vlasnik (reseller i njegov email)**, paket, panel, status, datum isteka i MaxPlayer.
  Pretraga (username, email kupca, reseller), filteri (reseller, status, „ističe za 7 dana“, MaxPlayer),
  **Export CSV**. Klik na liniju → detalji (vlasnik, kupac, narudžbe, MaxPlayer greška) i dugme
  **Create MaxPlayer account**. Test linije su skrivene dok ne izabereš „Real + test“. Lozinke se ne prikazuju.
- **All accounts** — svi nalozi za prijavu: admini i reselleri, njihova prodavnica, broj kupaca i aktivnih
  linija, 2FA, potvrđen email, zadnja prijava.

## 8e. Odobravanje novih resellera

1. Novi reseller na `/register` popuni formu i klikne **Submit request** → dobije mail da čeka odobrenje, a račun je **na čekanju** (vidi stranicu „Waiting for approval“
   i ne može ništa koristiti, a njegova prodavnica ne prodaje).
2. Ti dobiješ email „New reseller waiting for approval“, a u adminu gore se pojavi žuta traka.
3. Admin → **Resellers** → **Waiting for approval** → **✓ Approve** ili **✕ Decline** (razlog je opcionalan
   i šalje mu se mailom).
4. Reseller dobije mail i nakon odobrenja odmah koristi platformu. Postojeći reselleri su automatski odobreni.

## 8f. Tekstovi mailova kupcima + test mail (reseller)

Reseller → **Email texts**:
- **Sender name** (gore na stranici): ime koje kupac vidi u svakom mailu — u inboxu (od koga je mail),
  u obojenom zaglavlju i u potpisu. Prazno = naziv prodavnice (**Store settings → Store name**).
- Svaki mail ima **preporučeni tekst** (odmah spreman za korištenje). Reseller ga mijenja kako hoće
  i klikne **Save**. **Use recommended text** / **Reset to recommended** vraća preporučeni tekst.
- Dugmad `{{username}}`, `{{password}}`, `{{serverUrl}}`, `{{expiresAt}}`… ubacuju podatke kupca na mjesto kursora.
- Desno je **Preview** — tačno kako mail izgleda kupcu (s primjer-podacima).
- **Username i password kupac uvijek dobije**: ako ih reseller izbriše iz teksta, sistem ih sam doda na kraj maila.
- **Svi mailovi su dvojezični**: prvo na BHS, ispod linija **English version** pa isti tekst na engleskom
  (i naslov: „Vaši pristupni podaci / Your login details“). Reseller može mijenjati oba dijela; red
  `——— English version ———` ostavi u tekstu — on se u mailu prikaže kao uredna linija razdvajanja.
- **Send a test email**: upiše bilo koju adresu → **Send test** → stiže mail s primjer-podacima
  (naslov počinje sa [TEST]). Šalje se i nesnimljeni tekst, pa se može probati prije snimanja.

## 8g. Obavještenja resellerima (na njihovom dashboardu)

Admin → lijevo **Notifications to resellers**:
1. **Title** i **Message** (linkovi `https://…` postanu klikabilni).
2. **Type**: Info (plavo), Good news (zeleno), Warning (žuto), Urgent (crveno).
3. **Who sees it**: svi reselleri ili jedan reseller. (Do istog dolaziš i sa stranice resellera →
   **Send a dashboard notification**.)
4. **Show for**: dok ne isključiš ili 1/3/7/14/30 dana.
5. **Resellers can close it**: reseller klikne „Got it“ i poruka mu nestane. Isključi za poruke koje moraju ostati.
6. **Also send by email**: poruka ode i mailom (treba podešen SMTP).
7. **Publish notification**.

Reseller vidi poruku na vrhu svake stranice dashboarda, a sve poruke i kasnije u **Notifications**.
U listi ispod možeš poruku urediti (**Edit**), sakriti (**Hide**) ili obrisati.

## 9. Važno za rad bez domene

- **Bez domene nema HTTPS-a.** Za testiranje je to u redu, ali lozinke i podaci idu nešifrovano.
- **Stripe (live) i PayPal webhookovi traže HTTPS** — za stvarne uplate preko njih trebat će domena.
  Test gateway i testiranje rade bez domene.
- Kad budeš htio domenu: dodaj A zapis na IP, stavi certifikat u `nginx/certs/fullchain.pem` i
  `nginx/certs/privkey.pem`, u `.env` postavi `NGINX_MODE=https`, `APP_DOMAIN=tvoja.domena`,
  `APP_URL=https://tvoja.domena`, pa `ufw allow 443/tcp` i `docker compose up -d --build`.

## 10. Prelazak na stvarnu prodaju

1. **Payment gateways** → svoji ključevi → **Connect** → kopiraj **Webhook URL** u dashboard providera.
2. ```bash
   nano /root/xui-billing/.env
   ```
   → `ALLOW_LIVE_PANEL_OPERATIONS=true` → Ctrl+O, Enter, Ctrl+X →
   ```bash
   cd /root/xui-billing && docker compose up -d
   ```
3. **XUI One panels** → panel → isključi **Test mode** → **Save settings**.
4. **MaxPlayer** → **Test connection** → izaberi domenu (MaxPlayer domain) → **Enabled** uključi, **Test mode** isključi → **Save**. Na paketima uključi **Activate MaxPlayer**
   (ili na MaxPlayer stranici jednim klikom **Turn on MaxPlayer for all packages**). Kartica **Diagnosis** pokazuje
   crvenim šta još fali; **Create them now** napravi MaxPlayer naloge za linije koje ga nemaju.
   Nalozi se prave polako, najviše 15 u minuti (MaxPlayer ima limit zahtjeva). Ako MaxPlayer ipak
   javi „too many requests“, red se sam pauzira pa nastavi — ništa ne treba klikati ponovo.
   Brzina se mijenja u `.env`: `MAXPLAYER_ACCOUNTS_PER_MINUTE=15`.
   Za modul napravi **poseban MaxPlayer API ključ** (MaxPlayer → API keys → novi ključ) i upiši ga samo
   na MaxPlayer stranici modula (**API token** → Save → Test connection).
5. Kad sve radi: iz `.env` obriši tri reda `INITIAL_...` i u panelima zamijeni API ključeve novim.

## 10b. Povezivanje XUI panela i uvoz paketa (preporučeno: admin API)

1. **XUI One panels** → **Manage** (ili *Add a panel*):
   - **API URL:** `http://televizija.tel/adminapi` (http, bez s)
   - **API key:** admin API ključ
   - **Line owner — XUI user ID:** `491` (reseller BillingModule; lista se ponudi dok kucaš)
   - **Test mode:** isključi kad želiš prave linije
2. **Connect & test** — učitaju se svi buketi s pravim nazivima.
3. **Packages & prices** → **Import packages from …** — svi XUI paketi (1/2/3/6/12 mjeseci,
   2con, TEST 24H…) uđu s trajanjem, konekcijama i buketima. Uvezeni su **sakriveni s cijenom 0**.
4. Otvori svaki paket → upiši **svoju cijenu** → uključi **On sale** → **Save package**.
5. Za stvarne linije u `.env` mora biti `ALLOW_LIVE_PANEL_OPERATIONS=true` (pa `docker compose up -d`).

## 10c. Panel povezan RESELLER ključem (resellerapi)

Reseller API pravi liniju **iz paketa na panelu** (trajanje, konekcije i buketi dolaze iz tog paketa).
Zato svaki paket u billingu mora biti vezan za paket na panelu:

1. **Packages & prices** → **Import packages from …** → paketi s panela uđu već povezani.
2. Za pakete koje si ranije pravio ručno: otvori paket → polje **Panel package** → izaberi paket s panela
   (npr. *FULL 1M (#2 · 30 days)*) → **Save package**.
3. Ako paket nije povezan, aktivacija javi: *This package is not linked to a package on your XUI panel*.

**Svoj username:** u **Add customer** upiši **Username on the panel** (i po želji **Password**) — linija na
XUI panelu se pravi tačno s tim imenom. Ako taj username već postoji na panelu, sistem to odbije
(nikad ne preuzima tuđu liniju).

## 10d. Postojeći kupci s panela (Load existing line) i produženje preko sajta

Reseller API na panelu ne daje listu svih linija, pa se postojeće linije dodaju jedna po jedna:

1. Na panelu otvori liniju kupca → u adresi piše `line?id=73736` → to je **ID linije**.
2. Billing → lijevo **Load existing line** → upiši **Line ID**, **Username**, **Password**
   (email kupca nije obavezan) → **Load line**.
3. Sistem pročita liniju s panela, provjeri da se username i password poklapaju i da je linija tvoja,
   i prepiše datum isteka. Na panelu se ništa ne mijenja.
4. **Check if this customer already uses MaxPlayer**: ako kupac već ima MaxPlayer nalog, poveže se.
   Ako nema — ostaje bez MaxPlayer-a i sistem mu ga **nikad** ne pravi, ni kad produži.

**Prodavnica — dvije opcije:**
- **Buy a new line** → kupac **sam bira username** (min. 8 znakova, slova + brojevi, npr. `marko2026`);
  password se pravi automatski i prikaže nakon plaćanja (i pošalje emailom). Ako je username zauzet
  u billingu, odmah mu kaže da izabere drugi; ako je zauzet samo na panelu, dobije `username` + 2 cifre.
- **Extend my line** → kupac upiše **email** (s kojim je kupovao) **ili username** → vidi svoje linije
  (username djelimično skriven, npr. `mar•••026`) → **Extend** → izabere paket → plati →
  ista linija (isti username i password) se produži (dani se dodaju na preostalo vrijeme).

**Brisanje:** Customers → **Delete** → linija se briše i na panelu i na MaxPlayer-u
(skini kvačicu ako želiš obrisati samo iz billinga).

## 10e. Aktivacioni kodovi + univerzalni link (plaćanje na reseller-ovom sajtu)

Reseller naplaćuje kako hoće (svoj sajt, Sellix, PayPal, kripto, keš), a billing radi samo automatizaciju.

1. **Activation codes** → izaberi paket (npr. 1 mjesec) → broj kodova → **Create codes**.
   Kodovi izgledaju ovako: `A7K2-9QXM-4TPL`. **Download CSV** → ubaci ih u svoju prodavnicu
   (Sellix/WooCommerce ih šalju kupcu automatski nakon plaćanja) ili ih šalji ručno.
2. **Univerzalni link** (gore na stranici) stavi kao „poslije plaćanja preusmjeri na“ / thank-you stranicu:
   `.../store/main/activate` — ili sa kodom: `.../store/main/activate?code=A7K2-9QXM-4TPL`.
3. Kupac na tom linku **prvo bira uređaj** (Android, iPhone, Android TV, Fire TV, Samsung, LG, Hisense,
   Apple TV, PC). Ako izabere **Hisense (VIDAA)**, dobije poruku da liniju ne može sam aktivirati i
   dugmad za kontakt (WhatsApp / Telegram / email / telefon iz **Store settings**). Izabrani uređaj se
   upiše u bilješku kupca („Device: …“).
4. Zatim bira:
   - **New line** → kod + svoj username (8+ znakova, slova i brojevi) + email → dobije liniju, password i MaxPlayer uputstvo;
   - **Extend my line** → kod + username ili email → ista linija dobije trajanje paketa.
5. Svaki kod radi **samo jednom**. Iskorištene vidiš u listi (kad, koja linija, koji email). Neiskorišten kod
   možeš poništiti (**Void**).
6. Paket kodova mora imati **Panel package** (za reseller ključ) i uključen **Activate MaxPlayer**
   (inače kupac dobije samo XUI liniju). Stare linije koje nisu u billingu prvo učitaj preko **Load existing line**.
7. Email s pristupnim podacima stiže samo ako je podešeno slanje (Admin → **Global settings → Email sending (SMTP)**).
   Bez toga se mail samo zapiše u **Sent emails** (status LOGGED) — kupac i dalje vidi podatke na ekranu.

## 10f. Vlastita aplikacija — prijava samo kodom (App API)

Kupac u aplikaciju ukuca **samo kod**; aplikacija od platforme dobije server, username i password i sama se prijavi.

1. **XUI One panels** → panel → **Streaming URL / DNS** (npr. `http://line.tvojadomena.com:80`) → **Save settings**.
   To je adresa na koju se aplikacija spaja.
2. **App API** (lijevo) — svi pozivi, primjeri, greške i dugme **Download app template** (gotova aplikacija u
   jednom HTML fajlu: unos koda, produženje, odjava — osnova za Android/iOS, Samsung Tizen i LG webOS).
3. Kod radi na onoliko uređaja koliko paket ima konekcija. Na stranici pretplate (**App login**) vidiš kod i
   uređaje, i možeš ih **resetovati**. Za linije kupljene na sajtu ili dodane ručno klikni **Create app code**.
4. Produženje: kupac u aplikaciji ukuca novi kod → ista linija se produži.

**Test curl-om** (zamijeni kod neiskorištenim kodom iz *Activation codes*):
```bash
curl -s -X POST http://167.86.92.80/api/app/v1/activate -H "Content-Type: application/json" -d '{"code":"XXXX-XXXX-XXXX","deviceId":"test-device-001","store":"main"}'; echo
```
Prvi odgovor je `"activating"`; ponovi istu komandu nakon 5 sekundi → `"active"` sa serverom, usernameom i passwordom.

## 11. Ručno dodavanje kupaca

Za kupce koji plate keš ili preko banke, ili dobiju besplatnu liniju:

1. U dashboardu lijevo klikni **Add customer** (ili **Customers → + Add customer**).
2. **Email kupca** — nije obavezan, ali je preporučen (kupac dobije podatke mailom i može u portal).
   Bez emaila kupac se vodi pod username-om linije i ne dobija mailove — podatke mu daješ ti.
3. Izaberi **paket**. Trajanje i cijena su uvijek iz paketa (besplatni / test paket = cijena 0).
4. (Opcionalno) vlastiti **username/password** za liniju i interna napomena.
5. Ostavi uključeno **Also create the MaxPlayer account** (ako je MaxPlayer podešen) i **Email the access details**.
6. Klikni **Add customer & create line**.

Sistem automatski napravi liniju na XUI panelu (buketi i trajanje iz paketa), napravi MaxPlayer nalog
s istim podacima i (ako ima email) pošalje kupcu email. Otvara se narudžba gdje vidiš tok aktivacije;
username i password su na stranici pretplate.

**Test paketi (npr. 24h):** linija dobije trajanje paketa. Ako bi je panel napravio već isteklu
(paket na panelu ima trajanje samo za „trial“ ili samo za obične linije), sistem sam izabere pravi tip
linije i provjeri datum isteka odmah poslije pravljenja.

**Produženje postojećeg kupca:** Subscriptions → otvori kupca → upiši broj dana i (ako je platio)
iznos → **Extend line (XUI + MaxPlayer)**.

**Buketi:** učitavaju se preko API-ja automatski čim klikneš **Connect & test** na panelu.
Ako na panelu dodaš nove bukete, klikni **Sync bouquets**.

Koji API URL upisati za XUI panel:
- **Admin API** (npr. `http://televizija.tel/adminapi` + admin ključ): buketi s punim nazivima,
  linije se prave kao admin (ne troše reseller kredite).
- **Reseller API** (npr. `http://televizija.tel/resellerapi`): reseller API ne daje nazive buketa,
  pa sistem učita ID-jeve buketa iz paketa. Nazive dobiješ tako da u postavkama panela otvoriš
  **Bouquet names from another API** i upišeš admin API URL i ključ — ili ih ručno upišeš na
  stranici **Bouquets**.
- Ako panel nema SSL, URL mora počinjati sa `http://` (ne `https://`).

## 11b. Brisanje kupca

1. **Customers** → kod kupca klikni **Delete** (ili otvori kupca → **Delete customer**).
2. Ostavi uključeno **Also delete on XUI panel and MaxPlayer** → linija na XUI panelu i MaxPlayer nalog se brišu.
   Isključi to ako želiš kupca obrisati samo iz billinga (linija na panelu ostaje).
3. Klikni **Delete** i potvrdi u prozoru koji iskoči (ne treba ništa kucati).

Narudžbe, fakture i pretplate tog kupca se brišu; prihod u izvještajima ostaje. Ako kupac ima automatsko
obnavljanje karticom, prvo na pretplati klikni **Cancel auto-renew**.

## 11c. Super Admin: imena buketa za sve resellere

1. Prijavi se kao Super Admin → lijevo **Bouquet names**.
2. **Admin API URL:** `http://televizija.tel/adminapi` · **Admin API key:** admin ključ → **Save & sync bouquets**.
3. Kad piše *Synced … bouquet names* → klikni **Remove admin key**. Imena ostaju sačuvana.
4. Svaki reseller koji poveže panel svojim reseller ključem automatski dobije prava imena
   (ako već ima „Bouquet #…“, to se zamijeni odmah; ručno upisana imena se ne diraju).
5. Novi buketi na panelu kasnije: ponovo upiši ključ → **Save & sync** → **Remove admin key**.

## 11d. Super Admin: uputstvo za MaxPlayer aplikaciju (kupcu nakon plaćanja)

1. Lijevo **Customer app guide**.
2. **App icon:** učitaj MaxPlayer ikonicu (PNG, kvadrat, do 300 KB).
3. **Devices**: štikliraj uređaje (Android, iPhone, Android TV, Fire TV, Samsung Tizen, LG webOS, Apple TV,
   PC). Za svaki možeš upisati link (dugme **Download**) i/ili kratku uputu. **Not supported** je
   unaprijed „Hisense (VIDAA)“ i prikaže se crveno. → **Save**. Desno vidiš kako izgleda kupcu.
4. Kupac nakon plaćanja na stranici narudžbe, u svom nalogu i u emailu dobije: ikonicu, korake,
   **username i password** i dugmad za preuzimanje aplikacije.
5. Važi za pakete s uključenim **Activate MaxPlayer** (i podešenim MaxPlayer-om kod reseller-a).

## 12b. Domena platforme (umjesto IP-a)

Super Admin → **Global settings** → **Platform address (domain)** → npr. `https://billing.tvojadomena.com` → **Save address**.
Svi linkovi (prodavnice, aktivacioni linkovi, emailovi, webhookovi, App API) od tada koriste domenu.
Domena mora prvo pokazivati na server (DNS A zapis → IP servera; Cloudflare narandžasti oblak = HTTPS).
Stara IP adresa i dalje radi.

## 12c. Provjera tipova (poslije update-a)

```bash
cd /root/xui-billing && docker compose exec app npx tsc --noEmit -p tsconfig.json 2>&1 | tail -40
```
Prazan ispis = sve u redu. Ako nešto ispiše, pošalji to developeru.

## 12a. Update bez gubitka podataka

Kupci, linije, narudžbe i podešavanja su u bazi (Docker volume), a ključevi u `.env`. Update mijenja
samo kod — ali koristi uvijek ovu skriptu, ona sama napravi backup i provjeri podatke:

1. FileZillom ubaci novi `xui-billing.zip` u `/root` (prvi put i `orbit-update.sh`).
2. PuTTY:  `bash /root/orbit-update.sh`

Skripta: backup baze + `.env` + foldera u `/root/orbit-backups` (čuva zadnjih 10) → novi kod
(`.env` i baza se ne diraju) → pokretanje → provjera da je broj resellera/kupaca/linija isti.
Ako nešto ne valja, ispiše tačnu komandu za vraćanje.

**Provjera kad nešto ne radi:** `bash /root/orbit-diag.sh` — samo čita i ispiše verziju koja radi,
podešavanja panela/paketa/MaxPlayera, zadnje narudžbe i linije, odgovore XUI panela i MaxPlayera
(bez ključeva i lozinki). U „XUI POZIVI“ red `check_new_line` pokazuje koji datum isteka je panel
stvarno dao svakoj novoj liniji.

**Nikad** ne pokreći `docker compose down -v` (`-v` briše bazu) i ne mijenjaj ime foldera
`/root/xui-billing` (novi folder = nova, prazna baza).

## 12. Svakodnevne komande (PuTTY)

Prvo uvijek: `cd /root/xui-billing`

| Šta | Komanda |
|---|---|
| Status | `docker compose ps` |
| Logovi | `docker compose logs -f --tail=200 app worker` |
| Restart | `docker compose restart` |
| Backup odmah | `./scripts/backup-now.sh` |
| Vrati backup | `./scripts/restore.sh backups/db-DATUM.dump` |

- Automatski backup ide svaki dan u `/root/xui-billing/backups` (čuva 14 dana) — povremeno ga preuzmi FileZillom.
- **Uz backup uvijek preuzmi i `.env`** (sadrži `ENCRYPTION_KEY`).

**HTTPS (domena preko Cloudflarea):** port 443 drži Caddy s Cloudflare certifikatom (skripta
`https-cloudflare.sh`), a nginx modula radi samo na portu 80. Zato u `docker-compose.yml` nginx nema `443:443`.

**Ažuriranje na novu verziju:**
1. FileZillom prebaci novi `xui-billing.zip` u `/root` (zamijeni stari).
2. PuTTY:
   ```bash
   cd /root && cp xui-billing/.env /root/env-backup && unzip -o xui-billing.zip && cp /root/env-backup xui-billing/.env
   cd /root/xui-billing && chmod +x docker/entrypoint.sh scripts/*.sh && docker compose up -d --build
   ```

## VOD praćenje (epizode koje fale)

**Super Admin, jednom:**
1. Napravi besplatan nalog na themoviedb.org → Settings → API → zatraži API key (Developer).
2. Admin → Settings → kartica **VOD monitoring (TMDB)** → zalijepi „API Key” ili „API Read Access Token” → **Test & save**.

**Za svakog resellera kome odobriš:** Admin → Resellers → [reseller] → **Enable VOD monitoring**. Reseller tada u meniju dobija **VOD monitoring**.

**Reseller:**
1. VOD monitoring → upiše adresu servera (DNS), username i password jedne linije koja ima serije bukete → **Test & save line**.
2. **Scan now** (prvi put traje nekoliko minuta za velike liste). Poslije toga provjera ide sama svaki dan.
3. Tabovi: *Missing episodes*, *New episode out* (izašla u zadnjih 14 dana, nema je na panelu), *Not matched* (upiše TMDB broj i klikne Check), *Completed* (sve izašle sezone su na panelu — najavljene sezone se ne računaju), *Not monitored*.
4. **CSV** — lista za onoga ko dodaje sadržaj.

Sistem samo čita listu i ništa ne mijenja na panelu.

## Expiring lines (podsjetnici)
Meni **Expiring lines**: linije koje ističu u 7 ili 30 dana i one koje su istekle a nisu produžene.
Za svaku liniju: **WhatsApp** (otvara poruku spremnu za slanje; sa upisanim brojem ide direktno tom kupcu), **Viber**, **Copy text**, **Email**. Dugme **Email all** šalje podsjetnik svima koji imaju email (preskače one podsjetene u zadnja 24h).

## Statistics
Meni **Statistics**: nove linije, produženja i prihod po mjesecima (12 mjeseci), procenat produženja (90 dana), prodaja po paketima.

## Telegram alerts
Meni **Telegram alerts**: reseller napravi svog bota kod @BotFather, zalijepi token, pritisne Start u botu i klikne **Connect my chat**. Dobija poruku za svaku novu liniju, produženje i neuspjelu aktivaciju, plus jutarnji sažetak.

## Odobravanje resellera i email
Kad odobriš resellera, njegov email se smatra potvrđenim (prodavnica može prodavati odmah). Za već odobrene resellere sa nepotvrđenim emailom: Admin → Resellers → [reseller] → **Confirm email manually**.

## Import all my lines (svi korisnici resellera)
Customers → **Load existing line** → kartica **Import all my lines** → **Import all my lines**.
Panel ne zna dati listu linija (get_lines je prazan), zato modul provjerava ID po ID (get_line) i uzima samo linije čiji je vlasnik (member_id) taj reseller. Radi u pozadini (1–3 sata za veliki panel), nastavlja sam i nakon restarta. Dugmad: **Stop**, **Continue**, **Check for new lines** (samo nove linije poslije zadnjeg importa). Ništa se ne mijenja na panelu; uvezene linije nemaju email dok kupac jednom ne plati, i ne prave MaxPlayer nalog.
