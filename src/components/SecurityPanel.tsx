import QRCode from "qrcode";
import type { User } from "@prisma/client";
import { decrypt } from "@/core/crypto";
import { otpauthUrl } from "@/core/totp";
import { SubmitButton } from "./client";
import { Card, DateTime, Field } from "./ui";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { changePasswordAction, disableTotpAction, enableTotpAction, revokeOtherSessionsAction, startTotpAction } from "@/app/dashboard/actions/account";

/** Shared security settings (password, 2FA, sessions) for resellers and admins. */
export async function SecurityPanel({ user }: { user: User }) {
  const sessions = await db.session.findMany({ where: { userId: user.id, twoFactorPending: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 10 });
  let qr: string | null = null;
  let secret: string | null = null;
  if (!user.totpEnabled && user.totpSecretEnc) {
    secret = decrypt(user.totpSecretEnc);
    qr = await QRCode.toDataURL(otpauthUrl(secret, user.email, env.platformName), { margin: 1, width: 200 });
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Two-factor authentication" description="Protect your account with a code from an authenticator app (Google Authenticator, Authy, 1Password).">
        {user.totpEnabled ? (
          <form action={disableTotpAction} className="space-y-3">
            <p><span className="badge-green">enabled</span></p>
            <input className="input" name="password" type="password" placeholder="Current password" required />
            <input className="input" name="code" inputMode="numeric" placeholder="6-digit code" required />
            <SubmitButton className="btn-danger">Disable 2FA</SubmitButton>
          </form>
        ) : qr && secret ? (
          <form action={enableTotpAction} className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg bg-white p-2" />
            <p className="muted">Or enter this key manually: <code className="select-all">{secret}</code></p>
            <input className="input" name="code" inputMode="numeric" placeholder="Enter the 6-digit code" required />
            <SubmitButton>Enable 2FA</SubmitButton>
          </form>
        ) : (
          <form action={startTotpAction}>
            <p className="mb-3"><span className="badge-gray">disabled</span></p>
            <SubmitButton>Set up 2FA</SubmitButton>
          </form>
        )}
      </Card>
      <Card title="Change password">
        <form action={changePasswordAction} className="space-y-3">
          <Field label="Current password" name="current"><input className="input" id="current" name="current" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password" name="password" hint="At least 10 characters with letters and numbers."><input className="input" id="password" name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
          <SubmitButton>Change password</SubmitButton>
        </form>
      </Card>
      <Card title="Active sessions" className="lg:col-span-2" actions={<form action={revokeOtherSessionsAction}><SubmitButton className="btn-secondary btn-sm">Sign out other sessions</SubmitButton></form>} pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Signed in</th><th>IP</th><th>Device</th><th>Expires</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}><td><DateTime value={s.createdAt} /></td><td>{s.ip}</td><td className="max-w-xs truncate text-xs">{s.userAgent}</td><td><DateTime value={s.expiresAt} dateOnly /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
