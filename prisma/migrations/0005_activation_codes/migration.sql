DO $$ BEGIN
  CREATE TYPE "ActivationCodeStatus" AS ENUM ('UNUSED', 'USED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ActivationCode" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ActivationCodeStatus" NOT NULL DEFAULT 'UNUSED',
    "batch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedByEmail" TEXT,
    "orderId" TEXT,
    "subscriptionId" TEXT,
    "lineUsername" TEXT,
    CONSTRAINT "ActivationCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ActivationCode_code_key" ON "ActivationCode"("code");
CREATE INDEX IF NOT EXISTS "ActivationCode_resellerId_status_idx" ON "ActivationCode"("resellerId", "status");
CREATE INDEX IF NOT EXISTS "ActivationCode_packageId_idx" ON "ActivationCode"("packageId");
DO $$ BEGIN
  ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
