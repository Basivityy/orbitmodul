-- Trial (test) lines on the panel are counted apart from paid active lines.
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "panelTrial" BOOLEAN NOT NULL DEFAULT false;
