#!/bin/bash
# OrbitModul — dijagnoza (SAMO ČITA, ništa ne mijenja). Ne ispisuje ključeve ni lozinke.
#   bash /root/orbit-diag.sh
# Ispis kopiraj i pošalji podršci.
APP="${ORBIT_ROOT:-/root}/xui-billing"
cd "$APP" 2>/dev/null || { echo "Nema foldera $APP"; exit 1; }

echo "== VERZIJA"
echo "folder:  $(cat VERSION 2>/dev/null || echo 'stara (bez VERSION)')"
echo "radi:    $(docker compose exec -T worker cat /app/VERSION 2>/dev/null || echo 'stara (bez VERSION) — update nije pokrenut ili build nije uspio')"
echo "server:  $(date -u '+%Y-%m-%d %H:%M UTC')"
grep -E '^(ALLOW_LIVE_PANEL_OPERATIONS|MAXPLAYER_ACCOUNTS_PER_MINUTE)=' .env 2>/dev/null
docker compose ps --format '{{.Service}}: {{.State}}' 2>/dev/null || docker compose ps

docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -P footer=off' <<'SQL'
\echo '== PANEL'
select name, case when "apiUrl" ~* 'reseller' then 'RESELLER API' else 'ADMIN API' end as api, "testMode", "lineOwnerId" as owner, status, left(coalesce("lastError",''),120) as last_error from "PanelIntegration";
\echo '== PAKETI'
select left(name,30) as name, "durationDays" as days, "isTrial" as trial, "externalPackageId" as panel_pkg, "maxPlayerEnabled" as maxplayer, active from "Package" order by "createdAt" desc limit 15;
\echo '== MAXPLAYER'
select enabled, "testMode", ("domainId" is not null) as domain, status, left(coalesce("lastError",''),150) as last_error from "MaxPlayerIntegration";
\echo '== ZADNJE NARUDZBE'
select number, kind, status, "lineUsername" as line, to_char("plannedExpiresAt",'YYYY-MM-DD HH24:MI') as planned_utc, to_char("createdAt",'MM-DD HH24:MI') as created, left(coalesce("errorMessage",''),200) as error from "Order" order by "createdAt" desc limit 8;
\echo '== ZADNJE LINIJE'
select "lineUsername" as line, status, to_char("expiresAt",'YYYY-MM-DD HH24:MI') as expires_utc, "maxPlayerStatus" as mp, left(coalesce("maxPlayerUserId",''),14) as mp_id, "isTest", left(coalesce("maxPlayerError",''),200) as mp_error from "Subscription" order by "updatedAt" desc limit 8;
\echo '== XUI POZIVI'
select to_char("createdAt",'MM-DD HH24:MI:SS') as at, action, success as ok, "statusCode" as http, left(coalesce(message,''),230) as msg from "ApiLog" where service='XUI' order by "createdAt" desc limit 20;
\echo '== MAXPLAYER POZIVI'
select to_char("createdAt",'MM-DD HH24:MI:SS') as at, action, success as ok, "statusCode" as http, left(coalesce(message,''),230) as msg from "ApiLog" where service='MAXPLAYER' order by "createdAt" desc limit 15;
SQL

echo "== WORKER GREŠKE (zadnja 3 sata)"
docker compose logs --no-color --since 3h worker 2>/dev/null | grep -iE "fail|error|limit|maxplayer|expired" | tail -25
