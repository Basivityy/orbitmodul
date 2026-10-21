#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OrbitModul — SIGURAN UPDATE (podaci se nikad ne brišu)
#
#   1. FileZillom ubaci novi xui-billing.zip u /root
#   2. PuTTY:  bash /root/orbit-update.sh
#
# Šta radi:
#   - prije bilo čega napravi backup baze + .env + cijelog foldera u /root/orbit-backups
#   - raspakuje samo novi kod; .env i baza (Docker volume) se ne diraju
#   - pokrene novu verziju (stara radi dok se nova ne izgradi)
#   - provjeri da modul radi i da je broj kupaca/linija isti kao prije
# Nikad ne koristi:  docker compose down -v   (-v briše bazu!)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="${ORBIT_ROOT:-/root}"
APP="$ROOT/xui-billing"
ZIP="${1:-$ROOT/xui-billing.zip}"
SAFE="$ROOT/orbit-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
KEEP=10

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Provjere prije (ništa se ne mijenja ako nešto nije u redu) ───────────────
[ -f "$ZIP" ] || fail "Nema $ZIP — prvo FileZillom ubaci xui-billing.zip u $ROOT."
[ -d "$APP" ] || fail "Nema foldera $APP."
[ -f "$APP/.env" ] || fail "Nema $APP/.env — update prekinut (bez .env modul ne može čitati bazu)."
command -v unzip >/dev/null || fail "Nema programa unzip:  apt-get install -y unzip"
unzip -tq "$ZIP" >/dev/null 2>&1 || fail "ZIP je oštećen ili upload nije završen. Ubaci ga ponovo."
unzip -Z1 "$ZIP" | grep -qx "xui-billing/package.json" || fail "Ovo nije OrbitModul zip (nema xui-billing/package.json)."

cd "$APP"   # uvijek isti folder → isti Docker projekat i ista baza
docker compose ps --status running --services 2>/dev/null | grep -qx postgres || fail "Baza (postgres) ne radi. Pokreni:  cd $APP && docker compose up -d  pa ponovo update."

mkdir -p "$SAFE" && chmod 700 "$SAFE"

COUNT_SQL='select concat_ws(chr(32), (select count(*) from "Reseller"), (select count(*) from "Customer"), (select count(*) from "Subscription"));'
counts() {
  echo "$COUNT_SQL" | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' 2>/dev/null | tr -d '\r' | tail -1
}

# ── 1. Backup ────────────────────────────────────────────────────────────────
say "1/5 Backup baze"
DB="$SAFE/db-$STAMP.dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$DB" \
  || { rm -f "$DB"; fail "Backup baze nije uspio — update prekinut, ništa nije promijenjeno."; }
[ "$(stat -c %s "$DB")" -gt 1000 ] || { rm -f "$DB"; fail "Backup baze je prazan — update prekinut, ništa nije promijenjeno."; }
BEFORE="$(counts || true)"
ok "Baza: $DB ($(du -h "$DB" | cut -f1))"
[ -n "$BEFORE" ] && ok "Prije update-a (reselleri kupci linije): $BEFORE"

say "2/5 Kopija .env i cijelog foldera"
cp -p .env "$SAFE/env-$STAMP"
chmod 600 "$SAFE/env-$STAMP"
tar czf "$SAFE/app-$STAMP.tar.gz" -C "$ROOT" --exclude='xui-billing/node_modules' --exclude='xui-billing/.next' --exclude='xui-billing/backups' xui-billing
ok "Folder: $SAFE/app-$STAMP.tar.gz"

# ── 2. Novi kod ──────────────────────────────────────────────────────────────
say "3/5 Raspakivanje novog koda (.env i baza se ne diraju)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP"
rm -f "$TMP/xui-billing/.env"                 # zip nikad ne smije pregaziti .env
rm -rf "$TMP/xui-billing/backups"             # ni postojeće backupe
cp -a "$TMP/xui-billing/." "$APP/"
cp -p "$SAFE/env-$STAMP" "$APP/.env"          # .env tačno kakav je bio
chmod +x docker/entrypoint.sh scripts/*.sh
ok "Kod zamijenjen"

# ── 3. Pokretanje ────────────────────────────────────────────────────────────
say "4/5 Build i pokretanje (stara verzija radi dok se nova ne izgradi)"
if ! docker compose up -d --build; then
  fail "Build nije uspio. Podaci su sigurni. Stari kod vrati sa:
  cd $ROOT && tar xzf $SAFE/app-$STAMP.tar.gz && cp $SAFE/env-$STAMP $APP/.env && cd $APP && docker compose up -d --build"
fi

# ── 4. Provjera ──────────────────────────────────────────────────────────────
say "5/5 Provjera"
UP=""
for _ in $(seq 1 60); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then UP=1; break; fi
  sleep 3
done
[ -n "$UP" ] && ok "Modul radi" || warn "Modul se još ne javlja. Pogledaj:  cd $APP && docker compose logs --tail=50 app"

AFTER="$(counts || true)"
[ -n "$AFTER" ] && ok "Poslije update-a (reselleri kupci linije): $AFTER"
if [ -n "$BEFORE" ] && [ -n "$AFTER" ]; then
  read -r b1 b2 b3 <<<"$BEFORE"; read -r a1 a2 a3 <<<"$AFTER"
  if [ "$a1" -lt "$b1" ] || [ "$a2" -lt "$b2" ] || [ "$a3" -lt "$b3" ]; then
    warn "Manje podataka nego prije update-a! Ništa ne diraj i javi se. Vraćanje baze:
  cd $APP && ./scripts/restore.sh $DB"
  else
    ok "Svi podaci su na mjestu"
  fi
fi

# Najnovija verzija ove skripte ostaje u /root za sljedeći update.
cp -f "$APP/scripts/safe-update.sh" "$ROOT/orbit-update.sh" 2>/dev/null && chmod +x "$ROOT/orbit-update.sh" || true
cp -f "$APP/scripts/diag.sh" "$ROOT/orbit-diag.sh" 2>/dev/null && chmod +x "$ROOT/orbit-diag.sh" || true
echo "Verzija koja sada radi: $(docker compose exec -T worker cat /app/VERSION 2>/dev/null || echo '?')"

# Čuva se zadnjih $KEEP backupa (stariji se brišu).
for pat in 'db-*.dump' 'env-*' 'app-*.tar.gz'; do
  ls -1t "$SAFE"/$pat 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
done

printf '\n\033[1;32mGotovo.\033[0m Backup prije ovog update-a: %s (db-, env-, app-%s)\n' "$SAFE" "$STAMP"
