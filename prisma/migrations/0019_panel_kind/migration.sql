-- What a panel "line" really is (line / mag / enigma / restreamer) — devices are counted apart.
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "panelKind" TEXT NOT NULL DEFAULT 'line';
