#!/bin/sh
# Runs inside the "backup" container: daily compressed pg_dump, 14-day retention.
set -e
while true; do
  TS=$(date -u +%Y%m%d-%H%M%S)
  pg_dump --format=custom --no-owner --file="/backups/db-$TS.dump" && echo "[backup] /backups/db-$TS.dump"
  find /backups -name 'db-*.dump' -mtime +14 -delete
  sleep 86400
done
