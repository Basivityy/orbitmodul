import Link from "next/link";
import { emailFooter, emailSenderName } from "@/core/emailLayout";
import { DEFAULT_TEMPLATES } from "@/core/emailTemplates";
import { SubmitButton } from "@/components/client";
import { Card, Flash, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { sampleEmailVars } from "@/lib/customerEmails";
import { db } from "@/lib/db";
import { platformSmtpSource, resolveTemplate } from "@/lib/mailer";
import { saveEmailSenderNameAction, saveEmailTemplateAction } from "../actions/store";
import { sendTemplateTestAction } from "../actions/mail";
import { EmailTemplateEditor } from "./EmailTemplateEditor";

export const metadata = { title: "Email texts" };

export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { user, reseller } = await requireReseller();
  const customerTemplates = DEFAULT_TEMPLATES.filter((t) => t.audience === "customer");
  const [overrides, sample, mailbox, platformMail, recommended] = await Promise.all([
    db.emailTemplate.findMany({ where: { resellerId: reseller.id } }),
    sampleEmailVars(reseller),
    db.resellerMail.findUnique({ where: { resellerId: reseller.id } }),
    platformSmtpSource(),
    Promise.all(customerTemplates.map((t) => resolveTemplate(null, t.key))),
  ]);
  const senderName = emailSenderName(reseller);
  const brand = { title: senderName, color: reseller.primaryColor, footer: emailFooter(reseller) };
  const fromAddress = mailbox?.enabled ? mailbox.fromEmail : platformMail.source ? platformMail.from.match(/<(.+)>/)?.[1] ?? platformMail.from : null;
  const sender = mailbox?.enabled ? `your mailbox ${mailbox.fromEmail}` : platformMail.source ? "the platform address" : null;
  // Login details first: it is the email every customer gets.
  const order = ["subscription_activated", "purchase_received", "subscription_renewed", "subscription_expiring", "payment_failed", "customer_login"];
  const list = customerTemplates.map((t, i) => ({ t, rec: recommended[i] })).sort((a, b) => order.indexOf(a.t.key) - order.indexOf(b.t.key));

  return (
    <>
      <PageHeader
        title="Email texts"
        description="What your customers receive automatically. Each email starts with the recommended text — change it as you like, check the preview and send yourself a test."
        actions={<Link className="btn-secondary" href="/dashboard/mail">Email sending &amp; sent emails</Link>}
      />
      <Flash sp={sp} />
      <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${sender ? "bg-slate-50 dark:bg-slate-800/60" : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"}`}>
        {sender ? (
          <>Emails are sent from <b>{sender}</b>. Customers&apos; replies go to {reseller.contactEmail ?? "your contact email"}. <Link href="/dashboard/mail">Change</Link></>
        ) : (
          <>No email server is set up yet, so emails are not delivered. <Link href="/dashboard/mail">Set up your mailbox</Link> or ask the platform administrator.</>
        )}
      </div>
      <Card title="Sender name" description="The name your customers see in every email: in the inbox (From), in the coloured header and in the signature." className="mb-6">
        <form action={saveEmailSenderNameAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <label className="label" htmlFor="emailFromName">Name in emails</label>
            <input className="input" id="emailFromName" name="emailFromName" defaultValue={reseller.emailFromName ?? ""} placeholder={reseller.storeName} maxLength={80} />
          </div>
          <SubmitButton>Save</SubmitButton>
        </form>
        <p className="hint mt-2">
          Customers see: <b>{senderName}</b>{fromAddress ? <> &lt;{fromAddress}&gt;</> : null}. Empty = your store name (“{reseller.storeName}”).
        </p>
      </Card>
      <div className="space-y-6">
        {list.map(({ t, rec }) => {
          const o = overrides.find((x) => x.key === t.key);
          return (
            <EmailTemplateEditor
              key={t.key}
              def={{ key: t.key, label: t.label, when: t.when, variables: t.variables, credentials: t.credentials }}
              saved={{ subject: o?.subject ?? rec.subject, body: o?.body ?? rec.body }}
              recommended={{ subject: rec.subject, body: rec.body }}
              customized={!!o}
              sample={sample}
              brand={brand}
              defaultTo={user.email}
              saveAction={saveEmailTemplateAction}
              testAction={sendTemplateTestAction}
            />
          );
        })}
      </div>
    </>
  );
}
