-- Idempotent: safe on databases that already have some of these columns.
ALTER TABLE "PanelIntegration" ADD COLUMN IF NOT EXISTS "namesApiKeyEnc" TEXT;
ALTER TABLE "PanelIntegration" ADD COLUMN IF NOT EXISTS "namesApiUrl" TEXT;
ALTER TABLE "PanelIntegration" ADD COLUMN IF NOT EXISTS "lineOwnerId" TEXT;
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "externalPackageId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "notifyCustomer" BOOLEAN NOT NULL DEFAULT true;
