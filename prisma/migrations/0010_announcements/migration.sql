-- Announcements: messages the Super Admin shows on reseller dashboards.
DO $$ BEGIN
  CREATE TYPE "NoticeTone" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tone" "NoticeTone" NOT NULL DEFAULT 'INFO',
    "resellerId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AnnouncementDismissal" (
    "announcementId" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementDismissal_pkey" PRIMARY KEY ("announcementId","resellerId")
);

CREATE INDEX IF NOT EXISTS "Announcement_active_startsAt_idx" ON "Announcement"("active", "startsAt");
CREATE INDEX IF NOT EXISTS "Announcement_resellerId_idx" ON "Announcement"("resellerId");
CREATE INDEX IF NOT EXISTS "AnnouncementDismissal_resellerId_idx" ON "AnnouncementDismissal"("resellerId");

DO $$ BEGIN
  ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AnnouncementDismissal" ADD CONSTRAINT "AnnouncementDismissal_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AnnouncementDismissal" ADD CONSTRAINT "AnnouncementDismissal_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
