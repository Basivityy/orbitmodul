import { DEFAULT_TEMPLATES } from "@/core/emailTemplates";
import { SubmitButton } from "@/components/client";
import { Card, Flash, PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { savePlatformTemplateAction } from "../actions";

export const metadata = { title: "Platform emails" };

export default async function AdminEmailsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const overrides = await db.emailTemplate.findMany({ where: { resellerId: null } });
  return (
    <>
      <PageHeader title="Email templates" description="Platform defaults. Customer templates can additionally be customized by each reseller for their own store." />
      <Flash sp={sp} />
      <div className="space-y-6">
        {DEFAULT_TEMPLATES.map((t) => {
          const o = overrides.find((x) => x.key === t.key);
          return (
            <Card key={t.key} title={<span>{t.label} <span className={t.audience === "platform" ? "badge-blue" : "badge-gray"}>{t.audience}</span> {o && <span className="badge-green">customized</span>}</span>} description={<>Variables: {t.variables.map((v) => <code key={v} className="mr-1">{`{{${v}}}`}</code>)}</>}>
              <form action={savePlatformTemplateAction} className="space-y-3">
                <input type="hidden" name="key" value={t.key} />
                <input className="input" name="subject" defaultValue={o?.subject ?? t.subject} required />
                <textarea className="input font-mono text-xs" name="body" rows={7} defaultValue={o?.body ?? t.body} required />
                <div className="flex gap-2">
                  <SubmitButton name="op" value="save">Save</SubmitButton>
                  {o && <SubmitButton name="op" value="reset" className="btn-ghost">Reset</SubmitButton>}
                </div>
              </form>
            </Card>
          );
        })}
      </div>
    </>
  );
}
