import { SubmitButton } from "@/components/client";
import { Card, DateTime, Field, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAdminAction, setAdminStatusAction } from "../actions";

export const metadata = { title: "Administrators" };

export default async function AdminsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireSuperAdmin();
  const sp = await searchParams;
  const admins = await db.user.findMany({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader title="Administrators" description="Super admins manage plans, global settings and administrators. Admins can manage resellers and activations." />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card pad={false} className="lg:col-span-2">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Email</th><th>Role</th><th>2FA</th><th>Status</th><th>Last login</th><th /></tr></thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id}>
                    <td>{a.email}<div className="muted text-xs">{a.name}</div></td>
                    <td>{a.role === "SUPER_ADMIN" ? "super admin" : "admin"}</td>
                    <td>{a.totpEnabled ? <span className="badge-green">on</span> : <span className="badge-amber">off</span>}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td><DateTime value={a.lastLoginAt} /></td>
                    <td>{a.id !== me.id && <form action={setAdminStatusAction}><input type="hidden" name="userId" value={a.id} /><SubmitButton className="btn-ghost btn-sm">{a.status === "ACTIVE" ? "Disable" : "Enable"}</SubmitButton></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Add administrator">
          <form action={createAdminAction} className="space-y-3">
            <Field label="Name" name="name"><input className="input" name="name" /></Field>
            <Field label="Email" name="email"><input className="input" name="email" type="email" required /></Field>
            <Field label="Temporary password" name="password"><input className="input" name="password" type="password" minLength={10} required /></Field>
            <Field label="Role" name="role"><select className="input" name="role"><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super admin</option></select></Field>
            <SubmitButton className="btn-primary w-full">Create</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
