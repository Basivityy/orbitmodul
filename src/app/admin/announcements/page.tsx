import Link from "next/link";
import { AnnouncementCard } from "@/components/AnnouncementCard";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Field, Flash, PageHeader, Toggle } from "@/components/ui";
import { announcementState, DURATIONS, TONES } from "@/lib/announcements";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteAnnouncementAction, saveAnnouncementAction, toggleAnnouncementAction } from "../actions";

export const metadata = { title: "Notifications to resellers" };

const TONE_LABEL: Record<string, string> = { INFO: "Info (blue)", SUCCESS: "Good news (green)", WARNING: "Warning (yellow)", URGENT: "Urgent (red)" };
const STATE_BADGE: Record<string, string> = { live: "badge-green", scheduled: "badge-blue", expired: "badge-gray", off: "badge-gray" };
const STATE_LABEL: Record<string, string> = { live: "showing", scheduled: "scheduled", expired: "ended", off: "hidden" };

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const [list, resellers, editing] = await Promise.all([
    db.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { reseller: { select: { storeName: true } }, _count: { select: { dismissals: true } } } }),
    db.reseller.findMany({ where: { approvalStatus: "APPROVED" }, select: { id: true, storeName: true, owner: { select: { email: true } } }, orderBy: { storeName: "asc" }, take: 1000 }),
    sp.edit ? db.announcement.findUnique({ where: { id: sp.edit } }) : Promise.resolve(null),
  ]);
  const presetTarget = editing ? editing.resellerId ?? "all" : resellers.some((r) => r.id === sp.target) ? sp.target : "all";

  return (
    <>
      <PageHeader title="Notifications to resellers" description="Messages shown at the top of resellers' dashboards — for all resellers or just one. Optionally also sent by email." />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title={editing ? "Edit notification" : "New notification"} className="lg:col-span-3" actions={editing ? <Link className="btn-ghost btn-sm" href="/admin/announcements">Cancel</Link> : undefined}>
          <form action={saveAnnouncementAction} className="space-y-4">
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <Field label="Title" name="title">
              <input className="input" id="title" name="title" defaultValue={editing?.title ?? ""} maxLength={120} required placeholder="e.g. Planned maintenance on Sunday" />
            </Field>
            <Field label="Message" name="body" hint="Plain text. Links (https://…) become clickable.">
              <textarea className="input" id="body" name="body" rows={5} defaultValue={editing?.body ?? ""} maxLength={2000} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Type" name="tone">
                <select className="input" id="tone" name="tone" defaultValue={editing?.tone ?? "INFO"}>
                  {TONES.map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}
                </select>
              </Field>
              <Field label="Who sees it" name="target">
                <select className="input" id="target" name="target" defaultValue={presetTarget}>
                  <option value="all">All resellers</option>
                  {resellers.map((r) => <option key={r.id} value={r.id}>{r.storeName} — {r.owner.email}</option>)}
                </select>
              </Field>
              <Field label="Show for" name="days">
                <select className="input" id="days" name="days" defaultValue={editing ? "keep" : "0"}>
                  {editing && <option value="keep">Keep current end ({editing.endsAt ? editing.endsAt.toISOString().slice(0, 10) : "none"})</option>}
                  {DURATIONS.map((d) => <option key={d.days} value={String(d.days)}>{d.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <Toggle name="dismissible" label="Resellers can close it (“Got it”)" defaultChecked={editing?.dismissible ?? true} hint="Untick for messages that must stay visible." />
              <Toggle name="sendEmail" label="Also send by email" hint="To the approved, active resellers it is meant for." />
              {editing && <Toggle name="showAgain" label="Show again to those who closed it" />}
            </div>
            <SubmitButton>{editing ? "Save changes" : "Publish notification"}</SubmitButton>
          </form>
        </Card>
        <Card title="How resellers see it" className="lg:col-span-2">
          <div className="space-y-3">
            <AnnouncementCard a={{ title: "Planned maintenance on Sunday", body: "The panel will be offline from 02:00 to 03:00. Orders placed in that time are activated automatically afterwards.", tone: "WARNING" }} action={<span className="btn-ghost btn-sm pointer-events-none">Got it ✕</span>} />
            <AnnouncementCard a={{ title: "New feature", body: "You can now edit the emails your customers receive: https://example.com", tone: "SUCCESS" }} />
          </div>
          <p className="hint mt-3">Shown at the top of every dashboard page until it ends, you hide it, or the reseller closes it. Resellers also find all messages under Notifications.</p>
        </Card>
      </div>

      <Card title="Sent notifications" pad={false} className="mt-6">
        {list.length === 0 ? <Empty title="No notifications yet" /> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((a) => {
              const state = announcementState(a);
              return (
                <li key={a.id} className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <AnnouncementCard a={a} />
                    <p className="muted mt-2 text-xs">
                      <span className={STATE_BADGE[state]}>{STATE_LABEL[state]}</span> · {a.reseller ? `only ${a.reseller.storeName}` : "all resellers"} · sent <DateTime value={a.createdAt} />
                      {a.endsAt ? <> · until <DateTime value={a.endsAt} /></> : " · no end date"} · {a.dismissible ? `closed by ${a._count.dismissals}` : "cannot be closed"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link className="btn-secondary btn-sm" href={`/admin/announcements?edit=${a.id}`}>Edit</Link>
                    <form action={toggleAnnouncementAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton className="btn-secondary btn-sm">{a.active ? "Hide" : "Show again"}</SubmitButton>
                    </form>
                    <form action={deleteAnnouncementAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm="Delete this notification?">Delete</SubmitButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
