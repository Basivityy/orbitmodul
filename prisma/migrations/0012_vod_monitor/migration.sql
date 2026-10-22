-- VOD monitoring: Super Admin switch per reseller, monitoring line, per-series results, TMDB cache.
ALTER TABLE "Reseller" ADD COLUMN IF NOT EXISTS "vodMonitorEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "VodMonitor" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "serverUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "autoScan" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "lastScanAt" TIMESTAMP(3),
    "lastError" TEXT,
    "seriesCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VodMonitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VodSeries" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "cover" TEXT,
    "year" TEXT,
    "tmdbId" TEXT,
    "tmdbOverride" TEXT,
    "tmdbName" TEXT,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "haveCount" INTEGER NOT NULL DEFAULT 0,
    "expectedCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "missing" JSONB NOT NULL DEFAULT '[]',
    "seasons" JSONB NOT NULL DEFAULT '{}',
    "lastAired" TIMESTAMP(3),
    "nextAir" TIMESTAMP(3),
    "error" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VodSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TmdbCache" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TmdbCache_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VodMonitor_resellerId_key" ON "VodMonitor"("resellerId");
CREATE UNIQUE INDEX IF NOT EXISTS "VodSeries_resellerId_seriesId_key" ON "VodSeries"("resellerId", "seriesId");
CREATE INDEX IF NOT EXISTS "VodSeries_resellerId_status_idx" ON "VodSeries"("resellerId", "status");

DO $$ BEGIN
  ALTER TABLE "VodMonitor" ADD CONSTRAINT "VodMonitor_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "VodSeries" ADD CONSTRAINT "VodSeries_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
