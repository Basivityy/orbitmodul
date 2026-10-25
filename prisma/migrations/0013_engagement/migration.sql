-- Customer phone (WhatsApp/Viber reminders) and Telegram notifications for resellers.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "phone" TEXT;

CREATE TABLE IF NOT EXISTS "ResellerTelegram" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "botTokenEnc" TEXT NOT NULL,
    "chatId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifySales" BOOLEAN NOT NULL DEFAULT true,
    "notifyFailures" BOOLEAN NOT NULL DEFAULT true,
    "dailySummary" BOOLEAN NOT NULL DEFAULT true,
    "lastSummaryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResellerTelegram_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ResellerTelegram_resellerId_key" ON "ResellerTelegram"("resellerId");

DO $$ BEGIN
  ALTER TABLE "ResellerTelegram" ADD CONSTRAINT "ResellerTelegram_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
