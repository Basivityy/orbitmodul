# OrbitModul Website API (for resellers' websites)

Base URL: `https://<platform>/api/partner/v1` · Auth: `Authorization: Bearer om_live_…` (Dashboard → Website API & widget) · JSON.

Server to server only — the key creates lines and must never be in browser code. A call with a valid key counts as paid.

| Method | Path | Purpose |
|---|---|---|
| GET | `/ping` | check key |
| GET | `/packages` | packages on sale |
| GET | `/usernames/{username}` | availability |
| POST | `/lines` | new line: `package_id`, `username?`, `email?`, `name?`, `note?`, `amount?`/`amount_minor?`, `external_ref?`, `send_email?`, `wait?` |
| POST | `/lines/extend` | extend: `line_id` or `username`, `package_id`, `email?`, `amount?`, `external_ref?`, `wait?` |
| GET | `/orders/{id\|number\|external_ref}` | status `pending/activating/completed/failed`, `line` when completed |
| GET | `/lines?username=` / `?email=` | find lines |
| GET | `/lines/{id}` | line with login details |
| POST | `/codes` | activation codes: `package_id`, `count`, `batch?` |
| GET | `/codes/{code}` | code status |

`external_ref` makes requests idempotent. `wait` (≤25 s) waits for the line.

Webhook: POST JSON `{ id, event, created, data }`, events `line.created`, `line.extended`, `activation.failed`, `line.expiring`, `ping`.
Header `X-OrbitModul-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>` — reject if older than 5 minutes.

Widget (no programming): `<div data-orbitmodul-store="SLUG"></div><script src="https://<platform>/widget.js" async></script>` (`data-theme="light"`, `data-target="blank"`).
