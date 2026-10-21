ALTER TABLE "PanelIntegration" ADD COLUMN IF NOT EXISTS "streamUrl" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "appCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_appCode_key" ON "Subscription"("appCode");

CREATE TABLE IF NOT EXISTS "AppDevice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AppDevice_subscriptionId_deviceId_key" ON "AppDevice"("subscriptionId", "deviceId");
DO $$ BEGIN
  ALTER TABLE "AppDevice" ADD CONSTRAINT "AppDevice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
