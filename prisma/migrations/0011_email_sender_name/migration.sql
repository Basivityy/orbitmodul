-- Sender name for customer emails (From name, email header, signature). NULL = store name.
ALTER TABLE "Reseller" ADD COLUMN IF NOT EXISTS "emailFromName" TEXT;
