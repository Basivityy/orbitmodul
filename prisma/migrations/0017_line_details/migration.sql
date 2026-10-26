-- Connections and notes of a line as read from the panel.
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "maxConnections" INTEGER;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "panelNotes" TEXT;
