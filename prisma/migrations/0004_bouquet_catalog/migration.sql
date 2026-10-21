CREATE TABLE IF NOT EXISTS "BouquetCatalog" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BouquetCatalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BouquetCatalog_host_externalId_key" ON "BouquetCatalog"("host", "externalId");
CREATE INDEX IF NOT EXISTS "BouquetCatalog_host_idx" ON "BouquetCatalog"("host");
