-- Reseller approval: new registrations wait for the Super Admin. Existing resellers stay approved.
DO $$ BEGIN
  CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Reseller" ADD COLUMN IF NOT EXISTS "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "Reseller" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Reseller" ADD COLUMN IF NOT EXISTS "approvalNote" TEXT;

CREATE INDEX IF NOT EXISTS "Reseller_approvalStatus_idx" ON "Reseller"("approvalStatus");
