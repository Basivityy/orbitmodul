import { AnnouncementCard } from "@/components/AnnouncementCard";
import { Card, DateTime, Empty, PageHeader } from "@/components/ui";
import { announcementState } from "@/lib/announcements";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { reseller } = await requireReseller();
  const now = new Date();
  const list = await db.announcement.findMany({
    where: { active: true, startsAt: { lte: now }, OR: [{ resellerId: null }, { resellerId: reseller.id }] },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return (
    <>
      <PageHeader title="Notifications" description={`Messages from ${env.platformName}. Closed messages stay here.`} />
      <Card pad={false}>
        {list.length === 0 ? (
          <Empty title="No notifications yet" />
        ) : (
          <ul className="space-y-3 p-4 sm:p-5">
            {list.map((a) => (
              <li key={a.id}>
                <AnnouncementCard a={a} footer={<><DateTime value={a.createdAt} />{announcementState(a, now) === "expired" ? " · ended" : ""}</>} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
