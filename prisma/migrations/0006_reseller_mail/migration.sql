ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "subject" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "via" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "fromEmail" TEXT;

CREATE TABLE IF NOT EXISTS "ResellerMail" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 587,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT NOT NULL,
    "passEnc" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResellerMail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResellerMail_resellerId_key" ON "ResellerMail"("resellerId");
DO $$ BEGIN
  ALTER TABLE "ResellerMail" ADD CONSTRAINT "ResellerMail_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
