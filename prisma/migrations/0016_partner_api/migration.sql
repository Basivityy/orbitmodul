-- Website API for resellers: API keys (hashed), webhook, Super Admin switch.
ALTER TABLE "Reseller" ADD COLUMN IF NOT EXISTS "partnerApiEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "ResellerApiKey" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResellerApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ResellerWebhook" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResellerWebhook_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ResellerApiKey_keyHash_key" ON "ResellerApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "ResellerApiKey_resellerId_idx" ON "ResellerApiKey"("resellerId");
CREATE UNIQUE INDEX IF NOT EXISTS "ResellerWebhook_resellerId_key" ON "ResellerWebhook"("resellerId");

DO $$ BEGIN
  ALTER TABLE "ResellerApiKey" ADD CONSTRAINT "ResellerApiKey_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ResellerWebhook" ADD CONSTRAINT "ResellerWebhook_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
