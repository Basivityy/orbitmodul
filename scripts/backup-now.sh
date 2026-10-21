#!/bin/sh
# Immediate backup: ./scripts/backup-now.sh
set -e
. ./.env
mkdir -p backups
F="backups/db-$(date -u +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner > "$F"
echo "Backup written to $F (also back up your .env — it contains ENCRYPTION_KEY)"
