# XUI Billing — SaaS billing platform for XUI One resellers

A multi-tenant platform (think WHMCS, specialised for XUI One) where resellers register, connect
their own XUI One panel and payment gateways, set **their own prices**, sell subscriptions on a
branded store, and get customer lines **activated automatically** after a confirmed payment —
optionally with a MaxPlayer.tv account. The platform owner has a Super Admin panel and charges
resellers a SaaS subscription.

> Bosnian step-by-step installation guide: **[UPUTSTVO.md](UPUTSTVO.md)**

## Stack

Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL 16 + Prisma 6 · Redis 7 +
BullMQ 5 (worker) · Tailwind CSS · Docker Compose · Nginx.

```
src/core/        Pure business logic, zero dependencies, fully unit-tested
  adapters/      XUI One adapter (universal PanelAdapter interface) + MaxPlayer client
  payments/      Stripe, PayPal, Mollie, NOWPayments, Test — one interface, registry
  activation/    Idempotent activation engine (persistence injected)
  crypto, password (scrypt), totp (RFC 6238), pricing, money, signatures, net (SSRF guard)
src/lib/         Server layer: Prisma, sessions/auth, queue, mailer, orders/webhooks, SaaS
src/app/         UI: dashboard/ (reseller), admin/ (super admin), store/[slug]/ (storefront,
                 checkout, customer portal), api/webhooks/*
worker/          BullMQ worker: activation, MaxPlayer, emails, maintenance sweeps
prisma/          schema.prisma, migrations, seed.ts
tests/           unit (core) + integration (real PostgreSQL)
```

## How the main flow works

1. Customer opens `/store/<slug>` (or the reseller's own domain), picks a package, enters email, pays.
2. The provider calls `POST /api/webhooks/<provider>/<gatewayToken>`. The token identifies the
   reseller's gateway; authenticity is verified with **that reseller's** secret
   (Stripe signature · PayPal verify-webhook-signature API · Mollie/NOWPayments API re-fetch + HMAC).
3. The paid amount and currency are compared with the order. Mismatches are never activated.
4. `WebhookEvent (provider, reseller, eventId)` is unique → replays are ignored. The order moves
   `PENDING → PAID` with a conditional update, so only the first event wins.
5. An activation job is queued (BullMQ, deterministic job id, exponential backoff).
6. The engine claims the order with a **DB lease** (no two workers at once), **plans and persists**
   username/password/expiry *before* calling the panel, then calls `create_line` with the
   package's bouquets, `exp_date` and `max_connections`. If a previous attempt crashed after the
   panel created the line, the retry finds the planned username via `get_lines` instead of creating
   a duplicate.
7. Subscription is saved (password encrypted), MaxPlayer job is queued (separate — a MaxPlayer
   failure never affects the line or payment), customer gets an email; the order page shows the
   credentials for 24 h; afterwards they are in the customer portal.
8. Anything that could not be activated is listed under *Orders → Needs attention* (reseller) and
   *Failed activations* (super admin) with a safe **Retry** button. A sweeper re-queues paid orders
   whose job was lost (e.g. Redis down) every 2 minutes.

Renewals: Stripe auto-renew (`invoice.paid` with `subscription_cycle`) or a manual renewal from the
portal call `edit_line` with an **absolute** new expiry = max(now, current expiry) + duration, then
`enable_line`. Customers never lose remaining days.

### Pricing policy
Every reseller sets their own prices/currency per package (promo prices, coupons). Orders store a
price **snapshot**. A price change applies to new purchases and manual renewals. Auto-renewing
Stripe subscriptions keep the contracted price they started with.

### Test mode (safety)
* `ALLOW_LIVE_PANEL_OPERATIONS=false` (default) forces **all** line creation/extension and MaxPlayer
  calls to be simulated platform-wide. Reads (test connection, bouquets, credits) are real.
* Each panel and the MaxPlayer integration also have their own *Test mode* switch.
* The built-in **Test gateway** (dashboard only, never shown to customers) runs the whole flow:
  *Packages → open a package → Start test purchase → Simulate successful payment*.

## XUI One API (documented actions only)
`{apiUrl}/?api_key=KEY&action=...` — `user_info` (test + credits), `get_bouquets`, `get_packages`,
`get_lines`, `get_line`, `create_line` (`username`, `password`, `max_connections`, `exp_date`,
`bouquets_selected[]`, `is_trial`, `notes`), `edit_line`, `enable_line`, `disable_line`.
Extra key=value parameters your panel needs on `create_line` can be set per panel.
New panel types: implement `PanelAdapter` (`src/core/adapters/types.ts`) and register it in
`createPanelAdapter`.

## MaxPlayer (endpoints from the supplied documentation)
`GET /status`, `GET /domains`, `POST /users/search`, `POST /users`, `PUT /users/list`,
`GET /customers/{id}` with header `Api-Token`. Activation is idempotent (search by IPTV username,
create only if missing). The documented API has no endpoint to extend a customer's expiry —
renewals keep the same credentials, so the app keeps working while the XUI line is active.

## Payment gateways
| Provider | Confirmation | Auto-renew | Refund from dashboard |
|---|---|---|---|
| Stripe (reseller's own keys) | signed webhook | ✓ | ✓ (card payments) |
| PayPal (reseller's REST app) | server capture on return + verified webhook | — | ✓ |
| Mollie | webhook → payment re-fetched from API | — | ✓ |
| NOWPayments (crypto) | HMAC-SHA512 IPN + API re-check | — | dashboard of NOWPayments |

Money goes directly to the reseller's own account. The platform's own Stripe account
(`PLATFORM_STRIPE_*`) is used **only** for the resellers' SaaS subscription.

## Security
AES-256-GCM encryption for all API keys, gateway credentials and line passwords · scrypt password
hashing · TOTP 2FA for resellers and admins · httpOnly/SameSite session cookies, sessions revocable ·
every reseller query scoped by the reseller id taken from the session (never from the client) ·
Super Admin checks on every admin server action · Redis rate limiting (login, 2FA, register,
checkout, portal) + Nginx rate limits · Prisma parameterised queries (no SQL injection) · React
escaping + HTML-escaped email variables (no XSS) · SSRF guard on reseller-supplied panel URLs ·
secrets redacted from logs · CSV formula-injection protection · audit log · Next.js server actions
check Origin (CSRF) · security headers · daily DB backups.

## Install on a VPS (summary)
```bash
git clone <your repo> xui-billing && cd xui-billing     # or upload and unzip
cp .env.example .env && nano .env                       # fill APP_URL, ENCRYPTION_KEY, passwords …
# NGINX_MODE=http → access by IP (default). For a domain: NGINX_MODE=https + nginx/certs/*.pem
docker compose up -d --build
docker compose logs -f app worker
```
Open `https://<APP_DOMAIN>/login` and sign in with `SUPER_ADMIN_EMAIL`. Enable 2FA.
Full walkthrough: [UPUTSTVO.md](UPUTSTVO.md).

## Development & tests
```bash
npm install
cp .env.example .env   # DATABASE_URL/REDIS_URL pointing to local services
npx prisma migrate deploy && npx tsx prisma/seed.ts
npm run dev            # web on :3000
npm run worker         # background jobs
npm test               # unit + integration (integration needs psql; PGHOST/PGPORT/PGUSER)
npm run typecheck
```
Test suite (40 tests): activation engine (single line per payment, concurrent workers, crash
recovery, retries, renewals, suspension, test mode), XUI and MaxPlayer adapters against mock
servers, all four payment providers (request format, webhook verification, forged signatures),
crypto/TOTP (RFC 6238 vectors), pricing/coupons, SSRF guard, and database-level guarantees on a
real PostgreSQL (unique constraints behind idempotency, activation lease, tenant cascade).

## Notes / limits
* `prisma/migrations/0001_init` was generated from the schema without the Prisma CLI; on start
  the container warns if the database ever drifts from `schema.prisma`.
* PayPal, Mollie and NOWPayments are sold as one-time payments (customers renew from the portal);
  automatic renewals use Stripe.
* Custom domains: the reseller adds a TXT record for verification and a CNAME to the platform. The
  simplest TLS setup is Cloudflare proxy (orange cloud) in front of the CNAME.
* If you run behind Cloudflare, configure Nginx `real_ip` with Cloudflare ranges so rate limits use
  the visitor IP.
