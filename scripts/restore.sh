#!/bin/sh
# Usage: ./scripts/restore.sh backups/db-YYYYMMDD-HHMMSS.dump
# Restores into the running postgres container (stops app + worker during restore).
set -e
[ -f "$1" ] || { echo "Usage: $0 <backup.dump>"; exit 1; }
. ./.env
docker compose stop app worker
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);" -c "CREATE DATABASE \"$POSTGRES_DB\";"
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < "$1"
docker compose start app worker
echo "Restored $1"
