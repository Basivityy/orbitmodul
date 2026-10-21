/** Ports a reseller's SMTP server may use (blocks probing other services on the network). */
export const SMTP_PORTS = [25, 465, 587, 2525];

export function smtpSettingsError(s: { host: string; port: number; username: string; fromEmail: string }): string | null {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.host)) return "Enter the SMTP server name, e.g. smtp.gmail.com or smtp-relay.brevo.com.";
  if (!SMTP_PORTS.includes(s.port)) return `Port must be one of ${SMTP_PORTS.join(", ")} (usually 587).`;
  if (!s.username) return "Enter the SMTP username (login).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.fromEmail)) return "Enter the sender email address.";
  return null;
}

/** Replaces secrets (line passwords) in an email before it is stored in the sent-mail log. */
export function maskSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 3) out = out.split(s).join("••••••");
  }
  return out;
}
