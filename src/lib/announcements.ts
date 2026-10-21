import type { Prisma } from "@prisma/client";
import { db } from "./db";

export const TONES = ["INFO", "SUCCESS", "WARNING", "URGENT"] as const;
export type Tone = (typeof TONES)[number];

/** Durations offered in the admin form, in days (0 = until switched off). */
export const DURATIONS = [
  { days: 0, label: "Until I turn it off" },
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

/** Announcements a reseller should see right now (active, started, not expired, for everyone or for them). */
export function visibleWhere(resellerId: string, now = new Date()): Prisma.AnnouncementWhereInput {
  return {
    active: true,
    startsAt: { lte: now },
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, { OR: [{ resellerId: null }, { resellerId }] }],
  };
}

/** Banners for the reseller's dashboard: visible and not closed by the reseller (urgent ones cannot be closed). */
export async function dashboardAnnouncements(resellerId: string) {
  return db.announcement.findMany({
    where: { ...visibleWhere(resellerId), NOT: { dismissals: { some: { resellerId } } } },
    orderBy: [{ createdAt: "desc" }],
    take: 5,
  });
}

export type AnnouncementState = "live" | "scheduled" | "expired" | "off";

export function announcementState(a: { active: boolean; startsAt: Date; endsAt: Date | null }, now = new Date()): AnnouncementState {
  if (!a.active) return "off";
  if (a.startsAt > now) return "scheduled";
  if (a.endsAt && a.endsAt <= now) return "expired";
  return "live";
}
