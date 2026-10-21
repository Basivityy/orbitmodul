#!/bin/sh
set -e

if [ -z "$ENCRYPTION_KEY" ]; then
  echo "FATAL: ENCRYPTION_KEY is not set (openssl rand -base64 32)" >&2
  exit 1
fi

case "$1" in
  web)
    echo "→ applying database migrations"
    npx prisma migrate deploy
    # Safety net: warn if the database schema differs from prisma/schema.prisma
    if ! npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code >/dev/null 2>&1; then
      echo "WARNING: database schema differs from prisma/schema.prisma — run: npx prisma migrate diff --from-url \$DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script"
    fi
    echo "→ seeding (idempotent)"
    npx tsx prisma/seed.ts
    echo "→ starting web on :${PORT:-3000}"
    exec npx next start -p "${PORT:-3000}" -H 0.0.0.0
    ;;
  worker)
    echo "→ starting worker"
    exec npx tsx worker/index.ts
    ;;
  *)
    exec "$@"
    ;;
esac
