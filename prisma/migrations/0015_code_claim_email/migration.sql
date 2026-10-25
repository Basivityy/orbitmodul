-- Activation code: email entered on arrival from the selling site (activation link mailed there).
ALTER TABLE "ActivationCode" ADD COLUMN IF NOT EXISTS "claimEmail" TEXT;
ALTER TABLE "ActivationCode" ADD COLUMN IF NOT EXISTS "claimSentAt" TIMESTAMP(3);
