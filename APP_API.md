# App API — login with an activation code

Base URL: `https://<platform>/api/app/v1` · JSON over POST · CORS open (works from Tizen/webOS web apps) · no API key: the code is the key.

| Call | Body | Use |
|---|---|---|
| `POST /activate` | `{ code, deviceId, deviceName?, store? }` | New code → creates the line (`"activating"`, call again every 3 s). Code that activated a line → signs in (new devices up to the package's connections). |
| `POST /status` | `{ loginCode, deviceId, store? }` | On app start: current server/username/password/expiry. |
| `POST /extend` | `{ loginCode, code, deviceId, store? }` | New code → same line extended (`"extending"`, then poll `/status`). |

`store` = the reseller's store id (slug). When sent, only that store's codes are accepted.

Success:
```json
{ "status": "active", "server": "http://line.example.com:80", "username": "u7k2q9xm", "password": "Xk92hdA1",
  "expiresAt": "2026-11-12T08:17:45.000Z", "maxConnections": 1, "devices": { "used": 1, "limit": 1 },
  "store": { "name": "Store", "extendUrl": "https://…/activate?mode=extend", "contact": "support@…" } }
```
`status`: `active` | `expired` | `activating` | `extending`.

Error: `{ "status": "error", "error": "<code>", "message": "<show to user>" }` — codes: `invalid_code`, `invalid_device`,
`unknown_code`, `device_limit`, `unknown_device`, `extension_code`, `redeem_failed`, `activation_problem`, `store_inactive`, `rate_limited`.

Playback: standard Xtream Codes on `server` (`player_api.php`, `/live/{u}/{p}/{id}.ts`, `get.php?type=m3u_plus`).

Limits: 60 calls / 10 min per IP and 30 / 10 min per code. Devices: reseller resets them on the subscription page.
A ready-made starter app (one HTML file) is downloadable in the reseller dashboard → **App API** → *Download app template*.
