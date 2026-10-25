-- "Import all my lines" job state (one per reseller and panel).
CREATE TABLE IF NOT EXISTS "LineImport" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "memberId" TEXT,
    "nextId" INTEGER NOT NULL DEFAULT 1,
    "ceiling" INTEGER NOT NULL DEFAULT 0,
    "lastHitId" INTEGER NOT NULL DEFAULT 0,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LineImport_resellerId_panelId_key" ON "LineImport"("resellerId", "panelId");

DO $$ BEGIN
  ALTER TABLE "LineImport" ADD CONSTRAINT "LineImport_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LineImport" ADD CONSTRAINT "LineImport_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "PanelIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
